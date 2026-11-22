import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  CompositionManager,
  bakeFilteredLayers,
  distillMotionCurve,
  extractLayerKeyframesAtFrame,
  renderLottieContactSheet,
  type LayerAstPatch,
  type MotionPrimitiveSpec,
  type RawPointerSample,
} from '../compiler/index.js';
import { hitTestLottieAtFrame } from './hitTest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.resolve(__dirname, '..', '..');

function resolveProjectDir(): string {
  const argv = process.argv;
  const idx = argv.indexOf('--project');
  if (idx >= 0 && argv[idx + 1]) {
    return path.resolve(argv[idx + 1]!);
  }
  if (process.env.MOTION_PROJECT) {
    return path.resolve(process.env.MOTION_PROJECT);
  }
  return STUDIO_ROOT;
}

const PROJECT_DIR = resolveProjectDir();
const STUDIO_URL = process.env.MOTION_STUDIO_URL || 'http://localhost:5173';
const manager = new CompositionManager(PROJECT_DIR, STUDIO_ROOT);

const BezierSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const SpringSchema = z.union([
  z.string(),
  z.object({
    stiffness: z.number().positive(),
    damping: z.number().positive(),
    mass: z.number().positive().optional(),
  }),
]);

const PrimitiveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('springMove'),
    layerId: z.string(),
    from: z.tuple([z.number(), z.number()]).optional(),
    to: z.tuple([z.number(), z.number()]),
    delta: z.tuple([z.number(), z.number()]).optional(),
    startFrame: z.number().optional(),
    spring: SpringSchema.optional(),
    overshootLimit: z.number().optional(),
  }),
  z.object({
    kind: z.literal('trimStroke'),
    layerId: z.string(),
    startFrame: z.number().optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    ease: z.union([z.string(), BezierSchema]).optional(),
    fromStart: z.number().optional(),
    toStart: z.number().optional(),
    fromEnd: z.number().optional(),
    toEnd: z.number().optional(),
    offset: z.tuple([z.number(), z.number()]).optional(),
    mode: z.union([z.literal(1), z.literal(2)]).optional(),
  }),
  z.object({
    kind: z.literal('staggeredEntrance'),
    layerIds: z.array(z.string()).min(1),
    startFrame: z.number().optional(),
    staggerFrames: z.number().optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    ease: z.union([z.string(), BezierSchema]).optional(),
    spring: SpringSchema.optional(),
    offset: z.tuple([z.number(), z.number()]).optional(),
    fromScale: z.number().optional(),
    fromOpacity: z.number().optional(),
  }),
  z.object({
    kind: z.literal('faux3DFlip'),
    frontLayerId: z.string(),
    backLayerId: z.string(),
    edgeLayerId: z.string().optional(),
    rimLayerId: z.string().optional(),
    shadowLayerId: z.string().optional(),
    glowLayerId: z.string().optional(),
    axis: z.enum(['y', 'x']).optional(),
    turns: z.number().optional(),
    startFrame: z.number().optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    ease: z.union([z.string(), BezierSchema]).optional(),
    thicknessPx: z.number().optional(),
    edgeThicknessScale: z.number().optional(),
    liftPx: z.number().optional(),
    tiltDeg: z.number().optional(),
    perspectiveSkew: z.number().optional(),
  }),
  z.object({
    kind: z.literal('squashAndStretch'),
    layerId: z.string(),
    startFrame: z.number().optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    intensity: z.number().optional(),
    axis: z.enum(['y', 'x']).optional(),
    ease: z.union([z.string(), BezierSchema]).optional(),
  }),
]);

export function createMotionStudioMcpServer(): McpServer {
  const server = new McpServer({
    name: 'motion-studio-lottie',
    version: '1.0.0',
  });

  // 1. create_composition
  server.tool(
    'create_composition',
    'Initialize a new Lottie composition with canvas dimensions, framerate, duration, and Product Motion Tokens.',
    {
      id: z.string().describe('Unique scene/composition identifier (e.g. "coin-flip")'),
      name: z.string().optional().describe('Display name'),
      width: z.number().int().positive().default(512),
      height: z.number().int().positive().default(512),
      fps: z.number().positive().default(60),
      durationFrames: z.number().int().positive().default(90),
      background: z.string().optional().describe('Stage preview background CSS value (default transparent)'),
      tokensPath: z.string().optional().describe('Optional path to a custom Product Motion Tokens JSON file'),
    },
    async (args) => {
      const compiled = await manager.createComposition(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                sceneId: compiled.spec.id,
                width: compiled.spec.width,
                height: compiled.spec.height,
                fps: compiled.spec.fps,
                durationFrames: compiled.spec.durationFrames,
                editorUrl: `${STUDIO_URL}/editor/#${compiled.spec.id}@0`,
                animationPath: compiled.animationPath,
                tokensLoaded: {
                  eases: Object.keys(compiled.spec.tokens.ease),
                  springs: Object.keys(compiled.spec.tokens.springs ?? {}),
                  overshootLimit: compiled.spec.tokens.overshootLimit,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 2. import_svg_asset
  server.tool(
    'import_svg_asset',
    'Ingest an SVG string or file, normalize via SVGO into structured Lottie shape groups with explicit anchor points and filter metadata.',
    {
      sceneId: z.string(),
      assetId: z.string().optional(),
      svgContent: z.string().optional().describe('Raw SVG XML markup'),
      svgPath: z.string().optional().describe('Absolute or workspace path to an SVG file'),
      prefix: z.string().optional().describe('Optional namespace prefix for generated layer IDs'),
      offset: z.tuple([z.number(), z.number()]).optional(),
      scale: z.number().positive().optional(),
    },
    async (args) => {
      const { asset, compiled } = await manager.importSvgAsset(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                assetId: asset.id,
                layerIds: asset.layerIds,
                filtersDetected: asset.filters.map((f) => ({
                  layerId: f.layerId,
                  kinds: f.kinds,
                  bleedPx: f.bleedPx,
                })),
                health: compiled.health,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 3. apply_motion_primitive
  server.tool(
    'apply_motion_primitive',
    'Attach a parametric minimal-keyframe motion primitive (springMove, trimStroke, staggeredEntrance, faux3DFlip, squashAndStretch) driven by Motion Tokens.',
    {
      sceneId: z.string(),
      primitive: PrimitiveSchema,
    },
    async ({ sceneId, primitive }) => {
      const { compiled, summary } = await manager.applyPrimitive(
        sceneId,
        primitive as MotionPrimitiveSpec,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                sceneId,
                ...summary,
                layers: compiled.doc.layers.map((l) => ({
                  id: l.ln ?? l.nm,
                  name: l.nm,
                  ind: l.ind,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 4. inspect_annotation
  server.tool(
    'inspect_annotation',
    'Perform an SVG DOM bounding-box hit-test on lottie-web at a given frame and region to resolve culprit layer IDs and active keyframe values.',
    {
      sceneId: z.string(),
      frame: z.number().min(0),
      x: z.number().optional(),
      y: z.number().optional(),
      boundingBox: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .optional(),
      note: z.string().optional(),
      noteId: z.string().optional().describe('Optional existing note ID in notes/<scene>/<noteId>.json'),
    },
    async (args) => {
      const doc = await manager.readAnimation(args.sceneId);
      let frame = args.frame;
      let box = args.boundingBox;
      let noteText = args.note;

      if (args.noteId) {
        const noteFile = path.join(PROJECT_DIR, 'notes', args.sceneId, `${args.noteId}.json`);
        try {
          const saved = JSON.parse(await fs.readFile(noteFile, 'utf8')) as {
            frame?: number;
            region?: { x: number; y: number; w: number; h: number };
            text?: string;
            elements?: Array<{ name: string; layerId?: string; rect?: number[] }>;
          };
          if (saved.frame !== undefined) frame = saved.frame;
          if (!box && saved.region) {
            box = {
              x: saved.region.x,
              y: saved.region.y,
              width: saved.region.w,
              height: saved.region.h,
            };
          }
          if (!noteText && saved.text) noteText = saved.text;

          // If the live UI already recorded SVG DOM hits, enrich with exact keyframes immediately
          if (saved.elements && saved.elements.length > 0) {
            const uiMatches = saved.elements
              .map((el) => {
                const lid = el.layerId ?? el.name;
                const layer = doc.layers.find((l) => l.ln === lid || l.nm === lid);
                if (!layer) return null;
                return {
                  layerId: layer.ln ?? layer.nm,
                  name: layer.nm,
                  ind: layer.ind,
                  rect: el.rect,
                  keyframes: extractLayerKeyframesAtFrame(layer, frame),
                };
              })
              .filter(Boolean);

            if (uiMatches.length > 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        sceneId: args.sceneId,
                        frame,
                        note: noteText,
                        method: 'ui-live-svg-dom',
                        matches: uiMatches,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
          }
        } catch {
          // Fall through to Playwright hit-test
        }
      }

      const result = await hitTestLottieAtFrame({
        doc,
        frame,
        x: args.x,
        y: args.y,
        boundingBox: box,
        studioRoot: STUDIO_ROOT,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                sceneId: args.sceneId,
                note: noteText,
                ...result,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 5. patch_layer_ast
  server.tool(
    'patch_layer_ast',
    'Surgically patch keyframes, anchor points, mattes (tt/td), or timing on a specific Lottie layer via @lottiefiles/relottie LAST AST without regenerating the composition.',
    {
      sceneId: z.string(),
      patch: z.object({
        layerId: z.string(),
        anchor: z.tuple([z.number(), z.number()]).optional(),
        position: z.unknown().optional(),
        scale: z.unknown().optional(),
        rotation: z.unknown().optional(),
        opacity: z.unknown().optional(),
        ip: z.number().optional(),
        op: z.number().optional(),
        tt: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        td: z.union([z.literal(0), z.literal(1)]).optional(),
        parent: z.number().int().optional(),
        hd: z.boolean().optional(),
        name: z.string().optional(),
      }),
    },
    async ({ sceneId, patch }) => {
      const res = await manager.patchLayerAst(sceneId, patch as LayerAstPatch);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                sceneId,
                patchedLayerId: patch.layerId,
                patchedLayerName: res.patchedLayerName,
                health: res.health,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // 6. spawn_proxy_sandbox
  server.tool(
    'spawn_proxy_sandbox',
    'Activate the Ephemeral Proxy Sandbox modal in the Motion Studio UI for a single-shape feel demonstration (live drag or pose-pinning), returning raw performance data and distilled 3–4 Lottie keyframes.',
    {
      sceneId: z.string(),
      layerId: z.string().optional(),
      property: z.enum(['position', 'scale', 'rotation', 'flip', 'stagger']).default('position'),
      prompt: z.string().default('Drag or pin poses to demonstrate the motion feel you want'),
      shape: z.enum(['card', 'circle', 'coin', 'pill']).default('card'),
      fps: z.number().positive().default(60),
      waitForSubmission: z.boolean().default(true),
      timeoutMs: z.number().int().positive().default(120000),
    },
    async (args) => {
      const sessionId = `sbx-${crypto.randomBytes(4).toString('hex')}`;
      const payload = {
        id: sessionId,
        sceneId: args.sceneId,
        layerId: args.layerId ?? null,
        property: args.property,
        prompt: args.prompt,
        shape: args.shape,
        fps: args.fps,
        status: 'open' as const,
        createdAt: new Date().toISOString(),
      };

      const sandboxFile = path.join(PROJECT_DIR, 'notes', '_sandbox.json');
      await fs.mkdir(path.dirname(sandboxFile), { recursive: true });
      await fs.writeFile(sandboxFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');

      // Notify live dev server if running so SSE pops open the modal immediately
      try {
        await fetch(`${STUDIO_URL}/api/sandbox`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // Dev server might not be running yet; file is still persisted for pickup
      }

      if (!args.waitForSubmission) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: true,
                  status: 'awaiting_user',
                  sessionId,
                  editorUrl: `${STUDIO_URL}/editor/#${args.sceneId}@0`,
                  message: 'Proxy sandbox opened in editor. Poll or wait for user submission.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const deadline = Date.now() + args.timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          const cur = JSON.parse(await fs.readFile(sandboxFile, 'utf8')) as {
            id: string;
            status: string;
            samples?: RawPointerSample[];
            mode?: string;
            distilled?: unknown;
          };
          if (cur.id !== sessionId) break;
          if (cur.status === 'cancelled') {
            return {
              content: [{ type: 'text', text: JSON.stringify({ ok: false, status: 'cancelled', sessionId }) }],
            };
          }
          if (cur.status === 'submitted') {
            if (cur.distilled) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        ok: true,
                        status: 'submitted',
                        sessionId,
                        mode: cur.mode ?? 'keyframe-editor',
                        distilled: cur.distilled,
                        ...(cur.samples ? { sampleCount: cur.samples.length, rawSamples: cur.samples } : {}),
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
            if (cur.samples && cur.samples.length >= 2) {
              const distilled = distillMotionCurve(cur.samples, { fps: args.fps, maxKeyframes: 4 });
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        ok: true,
                        status: 'submitted',
                        sessionId,
                        mode: cur.mode ?? 'pointer',
                        sampleCount: cur.samples.length,
                        rawSamples: cur.samples,
                        distilled,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
          }
        } catch {
          // continue polling
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              status: 'timeout',
              sessionId,
              message: `Timed out after ${args.timeoutMs}ms waiting for proxy sandbox submission.`,
            }),
          },
        ],
      };
    },
  );

  // 7. export_dotlottie
  server.tool(
    'export_dotlottie',
    'Run the Filter-to-Raster export bridge (rasterizing SVG blur/glow/shadow layers at target DPI) and package production .json and .lottie files.',
    {
      sceneId: z.string(),
      scale: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
      format: z.enum(['png', 'webp']).default('png'),
      quality: z.number().int().min(50).max(100).default(90),
    },
    async ({ sceneId, scale, format, quality }) => {
      const result = await manager.exportDotLottie(sceneId, { scale, format, quality });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, ...result }, null, 2),
          },
        ],
      };
    },
  );

  // 8. distill_motion_curve (utility tool for direct curve distillation)
  server.tool(
    'distill_motion_curve',
    'Run Ramer-Douglas-Peucker simplification + cubic-bezier fitting on raw pointer samples to emit 3–4 minimal Lottie keyframes.',
    {
      samples: z
        .array(
          z.object({
            t: z.number(),
            x: z.number(),
            y: z.number().optional(),
          }),
        )
        .min(2),
      fps: z.number().positive().default(60),
      startFrame: z.number().default(0),
      maxKeyframes: z.union([z.literal(3), z.literal(4)]).default(4),
      durationFrames: z.number().int().positive().optional(),
    },
    async ({ samples, fps, startFrame, maxKeyframes, durationFrames }) => {
      const distilled = distillMotionCurve(samples, {
        fps,
        startFrame,
        maxKeyframes,
        durationFrames,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(distilled, null, 2) }],
      };
    },
  );

  // 9. render_contact_sheet (instant visual verification of key frames before reporting done)
  server.tool(
    'render_contact_sheet',
    'Render smartly selected key frames (including 90° crossings & midpoints) of a Lottie composition into a single labelled PNG contact sheet for visual verification.',
    {
      sceneId: z.string(),
      frames: z.array(z.number().int().min(0)).optional().describe('Optional explicit frame list; omit to auto-pick key inflection frames'),
      baked: z.boolean().default(false).describe('If true, renders the Filter-to-Raster baked export preview instead of live SVG FX'),
    },
    async ({ sceneId, frames, baked }) => {
      const compiled = await manager.compile(sceneId);
      let doc = compiled.doc;
      let filters = compiled.filters;
      let defsXml = compiled.defsXml;
      if (baked && filters.length > 0) {
        const res = await bakeFilteredLayers(doc, filters, defsXml, {
          scale: 2,
          format: 'png',
          cacheDir: path.join(PROJECT_DIR, 'out', '.raster-cache'),
        });
        doc = res.doc;
        filters = [];
        defsXml = '';
      }
      const outPath = path.join(PROJECT_DIR, 'out', `${sceneId}${baked ? '-baked' : ''}-sheet.png`);
      const sheet = await renderLottieContactSheet({
        sceneId,
        doc,
        defsXml,
        filters,
        studioRoot: STUDIO_ROOT,
        outPath,
        frames,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, ...sheet, health: compiled.health }, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

// Start stdio server when run directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createMotionStudioMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
