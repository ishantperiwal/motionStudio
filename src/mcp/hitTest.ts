import fs from 'node:fs/promises';
import path from 'node:path';
import { launchHeadlessBrowser } from '../compiler/browser.js';
import { extractLayerKeyframesAtFrame } from '../compiler/last.js';
import type { LottieDocument } from '../compiler/types.js';

export interface HitTestBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationHitInput {
  doc: LottieDocument;
  frame: number;
  x?: number;
  y?: number;
  boundingBox?: HitTestBox;
  studioRoot: string;
}

export interface HitLayerMatch {
  layerId: string;
  name: string;
  ind: number;
  iou: number;
  rect: { x: number; y: number; width: number; height: number };
  keyframes: Record<string, unknown>;
}

export interface AnnotationInspectResult {
  frame: number;
  queryBox: HitTestBox;
  method: 'playwright-lottie-svg' | 'fallback-transform-bounds';
  matches: HitLayerMatch[];
}

function normalizeQueryBox(input: AnnotationHitInput): HitTestBox {
  if (input.boundingBox) {
    return {
      x: input.boundingBox.x,
      y: input.boundingBox.y,
      width: Math.max(4, input.boundingBox.width),
      height: Math.max(4, input.boundingBox.height),
    };
  }
  const cx = input.x ?? input.doc.w / 2;
  const cy = input.y ?? input.doc.h / 2;
  return { x: cx - 24, y: cy - 24, width: 48, height: 48 };
}

/**
 * Performs an exact SVG DOM bounding-box hit-test on `lottie-web` rendered in SVG mode
 * at `frame`, resolving the culprit Lottie layer IDs and their current keyframe values.
 */
export async function hitTestLottieAtFrame(
  input: AnnotationHitInput,
): Promise<AnnotationInspectResult> {
  const queryBox = normalizeQueryBox(input);
  const { doc, frame, studioRoot } = input;

  try {
    const lottieScriptPath = path.join(
      studioRoot,
      'node_modules',
      'lottie-web',
      'build',
      'player',
      'lottie_svg.min.js',
    );
    const lottieCode = await fs.readFile(lottieScriptPath, 'utf8');
    const browser = await launchHeadlessBrowser();
    try {
      const page = await browser.newPage({
        viewport: { width: Math.max(64, Math.ceil(doc.w)), height: Math.max(64, Math.ceil(doc.h)) },
      });
      await page.setContent(
        `<!doctype html><html><head><style>html,body,#stage{margin:0;padding:0;width:${doc.w}px;height:${doc.h}px;overflow:hidden;background:transparent;}</style></head><body><div id="stage"></div></body></html>`,
      );
      await page.addScriptTag({ content: lottieCode });

      const rawHits = await page.evaluate(
        ({ animationData, targetFrame, box }) => {
          const w = window as unknown as {
            lottie: {
              loadAnimation: (cfg: Record<string, unknown>) => {
                goToAndStop: (f: number, isFrame: boolean) => void;
              };
            };
          };
          const container = document.getElementById('stage')!;
          const anim = w.lottie.loadAnimation({
            container,
            renderer: 'svg',
            loop: false,
            autoplay: false,
            animationData,
          });
          anim.goToAndStop(targetFrame, true);

          const svg = container.querySelector('svg');
          if (!svg) return [];

          const hits: Array<{
            id: string;
            iou: number;
            rect: { x: number; y: number; width: number; height: number };
          }> = [];
          const qArea = box.width * box.height;
          const qRight = box.x + box.width;
          const qBottom = box.y + box.height;

          const groups = svg.querySelectorAll('g[id], g[class*="ms-layer"]');
          for (const g of groups) {
            const style = getComputedStyle(g);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) {
              continue;
            }
            const r = g.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;

            const ix = Math.max(0, Math.min(r.right, qRight) - Math.max(r.left, box.x));
            const iy = Math.max(0, Math.min(r.bottom, qBottom) - Math.max(r.top, box.y));
            const inter = ix * iy;
            if (inter <= 0) continue;

            const area = r.width * r.height;
            const iou = inter / Math.max(1, area + qArea - inter);
            const id = g.getAttribute('id') || g.getAttribute('aria-label') || '';
            if (!id) continue;

            hits.push({
              id,
              iou,
              rect: {
                x: Math.round(r.left),
                y: Math.round(r.top),
                width: Math.round(r.width),
                height: Math.round(r.height),
              },
            });
          }

          hits.sort((a, b) => b.iou - a.iou);
          return hits;
        },
        { animationData: doc, targetFrame: frame, box: queryBox },
      );

      const matches: HitLayerMatch[] = [];
      const seen = new Set<string>();
      for (const h of rawHits) {
        const layer = doc.layers.find((l) => l.ln === h.id || l.nm === h.id);
        if (!layer) continue;
        const lid = layer.ln ?? layer.nm;
        if (seen.has(lid)) continue;
        seen.add(lid);
        matches.push({
          layerId: lid,
          name: layer.nm,
          ind: layer.ind,
          iou: Math.round(h.iou * 1000) / 1000,
          rect: h.rect,
          keyframes: extractLayerKeyframesAtFrame(layer, frame),
        });
      }

      return {
        frame,
        queryBox,
        method: 'playwright-lottie-svg',
        matches,
      };
    } finally {
      await browser.close();
    }
  } catch {
    // Pure-math fallback if Chromium is unavailable: match active layers near query center
    const cx = queryBox.x + queryBox.width / 2;
    const cy = queryBox.y + queryBox.height / 2;
    const active = doc.layers
      .filter((l) => frame >= l.ip && frame <= l.op && !l.hd)
      .map((layer) => {
        const pos =
          layer.ks.p && 'a' in layer.ks.p && layer.ks.p.a === 0
            ? [layer.ks.p.k[0] ?? doc.w / 2, layer.ks.p.k[1] ?? doc.h / 2]
            : [doc.w / 2, doc.h / 2];
        const dist = Math.hypot((pos[0] ?? 0) - cx, (pos[1] ?? 0) - cy);
        const score = 1 / (1 + dist / 100);
        return {
          layerId: layer.ln ?? layer.nm,
          name: layer.nm,
          ind: layer.ind,
          iou: Math.round(score * 1000) / 1000,
          rect: { x: Math.round((pos[0] ?? 0) - 40), y: Math.round((pos[1] ?? 0) - 40), width: 80, height: 80 },
          keyframes: extractLayerKeyframesAtFrame(layer, frame),
        };
      })
      .sort((a, b) => b.iou - a.iou)
      .slice(0, 6);

    return {
      frame,
      queryBox,
      method: 'fallback-transform-bounds',
      matches: active,
    };
  }
}
