import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectLottieHealth, patchLayerInLast, roundTripThroughRelottie } from './last.js';
import { applyMotionPrimitive } from './primitives.js';
import { exportLottieAndDotLottie } from './rasterBaker.js';
import { normalizeSvgToLottieLayers } from './svgToLast.js';
import { loadMotionTokens, mergeTokens } from './tokens.js';
import type {
  CompositionSpec,
  ExportResult,
  ImportedAssetRecord,
  LayerAstPatch,
  LottieDocument,
  LottieHealthReport,
  LottieLayer,
  MotionPrimitiveSpec,
  MotionTokens,
  RasterBakeOptions,
  SvgFilterDescriptor,
} from './types.js';

export interface CreateCompositionInput {
  id: string;
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationFrames?: number;
  background?: string;
  tokensPath?: string;
  tokensOverride?: Partial<MotionTokens>;
}

export interface ImportSvgInput {
  sceneId: string;
  assetId?: string;
  svgContent?: string;
  svgPath?: string;
  prefix?: string;
  offset?: [number, number];
  scale?: number;
}

export interface CompiledComposition {
  spec: CompositionSpec;
  doc: LottieDocument;
  filters: SvgFilterDescriptor[];
  defsXml: string;
  health: LottieHealthReport;
  animationPath: string;
}

function assertSafeId(id: string): string {
  if (!/^[\w.-]+$/.test(id)) {
    throw new Error(`Invalid scene id "${id}" (use letters, digits, _, -, .)`);
  }
  return id;
}

function buildLottieSceneHtml(spec: CompositionSpec): string {
  const safeTitle = spec.name.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;',
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<meta name="motion-studio-kind" content="lottie">
<script type="importmap">{"imports":{"lottie-web":"/vendor/lottie-web/build/player/esm/lottie_svg.min.js","@studio/":"/runtime/"}}</script>
<link rel="stylesheet" href="/runtime/stage.css">
<style>
  html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
  #stage { --stage-bg: ${spec.background || 'transparent'}; background: var(--stage-bg); }
  #lottie-root { position: absolute; inset: 0; width: 100%; height: 100%; }
  #lottie-root > svg { width: 100% !important; height: 100% !important; display: block; overflow: visible; }
</style>
</head>
<body>
<div id="stage">
  <div id="lottie-root"></div>
</div>
<script type="module">
  import { mountLottieStage } from '@studio/lottie-stage.js';
  await mountLottieStage({
    id: ${JSON.stringify(spec.id)},
    container: document.getElementById('lottie-root'),
    animationUrl: './animation.json',
    filtersUrl: './filters.json',
    compUrl: './comp.json',
  });
</script>
</body>
</html>
`;
}

export class CompositionManager {
  readonly projectDir: string;
  readonly studioRoot: string;

  constructor(projectDir: string, studioRoot?: string) {
    this.projectDir = path.resolve(projectDir);
    this.studioRoot = path.resolve(studioRoot ?? projectDir);
  }

  sceneDir(sceneId: string): string {
    return path.join(this.projectDir, 'scenes', assertSafeId(sceneId));
  }

  compPath(sceneId: string): string {
    return path.join(this.sceneDir(sceneId), 'comp.json');
  }

  animationPath(sceneId: string): string {
    return path.join(this.sceneDir(sceneId), 'animation.json');
  }

  filtersPath(sceneId: string): string {
    return path.join(this.sceneDir(sceneId), 'filters.json');
  }

  async readSpec(sceneId: string): Promise<CompositionSpec> {
    const raw = await fs.readFile(this.compPath(sceneId), 'utf8');
    return JSON.parse(raw) as CompositionSpec;
  }

  async writeSpec(spec: CompositionSpec): Promise<void> {
    spec.updatedAt = new Date().toISOString();
    const dir = this.sceneDir(spec.id);
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
    await fs.writeFile(this.compPath(spec.id), JSON.stringify(spec, null, 2) + '\n', 'utf8');
  }

  async readAnimation(sceneId: string): Promise<LottieDocument> {
    const raw = await fs.readFile(this.animationPath(sceneId), 'utf8');
    return JSON.parse(raw) as LottieDocument;
  }

  async createComposition(input: CreateCompositionInput): Promise<CompiledComposition> {
    const id = assertSafeId(input.id);
    const baseTokens = loadMotionTokens(input.tokensPath, this.studioRoot);
    const tokens = mergeTokens(baseTokens, input.tokensOverride);
    const now = new Date().toISOString();

    const spec: CompositionSpec = {
      schemaVersion: 1,
      id,
      name: input.name ?? id,
      width: input.width ?? 512,
      height: input.height ?? 512,
      fps: input.fps ?? 60,
      durationFrames: input.durationFrames ?? 90,
      background: input.background ?? 'transparent',
      tokensPath: input.tokensPath,
      tokens,
      assets: [],
      primitives: [],
      patches: [],
      createdAt: now,
      updatedAt: now,
    };

    const dir = this.sceneDir(id);
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), buildLottieSceneHtml(spec), 'utf8');
    await this.writeSpec(spec);
    return this.compile(id);
  }

  async importSvgAsset(input: ImportSvgInput): Promise<{
    asset: ImportedAssetRecord;
    compiled: CompiledComposition;
  }> {
    const spec = await this.readSpec(input.sceneId);
    let svgText = input.svgContent;
    if (!svgText && input.svgPath) {
      svgText = await fs.readFile(path.resolve(input.svgPath), 'utf8');
    }
    if (!svgText) {
      throw new Error('importSvgAsset requires either svgContent or svgPath');
    }

    const assetId = assertSafeId(
      input.assetId ?? `asset-${spec.assets.length + 1}`,
    );
    const relSource = `assets/${assetId}.svg`;
    const absSource = path.join(this.sceneDir(spec.id), relSource);
    await fs.mkdir(path.dirname(absSource), { recursive: true });
    await fs.writeFile(absSource, svgText, 'utf8');

    const normalized = normalizeSvgToLottieLayers(svgText, {
      compWidth: spec.width,
      compHeight: spec.height,
      durationFrames: spec.durationFrames,
      prefix: input.prefix,
      offset: input.offset,
      scale: input.scale,
    });

    const record: ImportedAssetRecord = {
      id: assetId,
      sourceFile: relSource,
      prefix: input.prefix,
      layerIds: normalized.layers.map((l) => l.ln ?? l.nm),
      filters: normalized.filters,
      defsXml: normalized.defsXml,
      offset: input.offset,
      scale: input.scale,
    };

    // Replace existing asset with the same id (preserving motion primitives attached by layer name!)
    const existingIdx = spec.assets.findIndex((a) => a.id === assetId);
    if (existingIdx >= 0) {
      spec.assets[existingIdx] = record;
    } else {
      spec.assets.push(record);
    }

    await this.writeSpec(spec);
    const compiled = await this.compile(spec.id);
    return { asset: record, compiled };
  }

  async applyPrimitive(
    sceneId: string,
    primitive: MotionPrimitiveSpec,
  ): Promise<{ compiled: CompiledComposition; summary: Record<string, unknown> }> {
    const spec = await this.readSpec(sceneId);
    spec.primitives.push(primitive);
    await this.writeSpec(spec);
    const compiled = await this.compile(sceneId);
    const summary = {
      primitiveKind: primitive.kind,
      totalPrimitives: spec.primitives.length,
      health: compiled.health,
    };
    return { compiled, summary };
  }

  /**
   * Surgically patches the compiled Lottie via `@lottiefiles/relottie` LAST AST
   * without regenerating unaffected layers, and records the patch in `comp.json`.
   */
  async patchLayerAst(
    sceneId: string,
    patch: LayerAstPatch,
  ): Promise<{
    doc: LottieDocument;
    patchedLayerName: string;
    health: LottieHealthReport;
  }> {
    const spec = await this.readSpec(sceneId);
    let currentDoc: LottieDocument;
    try {
      currentDoc = await this.readAnimation(sceneId);
    } catch {
      currentDoc = (await this.compile(sceneId)).doc;
    }

    const { doc: patchedDoc, patchedLayerName } = patchLayerInLast(currentDoc, patch);
    const filterIds = spec.assets.flatMap((a) => a.filters.map((f) => f.layerId));
    const health = inspectLottieHealth(patchedDoc, filterIds);

    await fs.writeFile(
      this.animationPath(sceneId),
      JSON.stringify(patchedDoc, null, 2) + '\n',
      'utf8',
    );

    spec.patches.push(patch);
    await this.writeSpec(spec);

    return { doc: patchedDoc, patchedLayerName, health };
  }

  async compile(sceneId: string): Promise<CompiledComposition> {
    const spec = await this.readSpec(sceneId);
    const dir = this.sceneDir(sceneId);

    const allLayers: LottieLayer[] = [];
    const allFilters: SvgFilterDescriptor[] = [];
    const defsParts: string[] = [];
    let nextInd = 1;

    // Import each registered SVG asset in order (later assets sit visually on top -> earlier in Lottie layers[])
    for (const asset of spec.assets) {
      const svgRaw = await fs.readFile(path.join(dir, asset.sourceFile), 'utf8');
      const normalized = normalizeSvgToLottieLayers(svgRaw, {
        compWidth: spec.width,
        compHeight: spec.height,
        durationFrames: spec.durationFrames,
        prefix: asset.prefix,
        startIndex: nextInd,
        offset: asset.offset,
        scale: asset.scale,
      });
      nextInd += normalized.layers.length;
      allLayers.unshift(...normalized.layers);
      allFilters.push(...normalized.filters);
      if (normalized.defsXml.trim()) defsParts.push(normalized.defsXml);
    }

    // Re-number ind sequentially 1..N for clean Lottie spec compliance
    allLayers.forEach((layer, i) => {
      layer.ind = i + 1;
    });

    let doc: LottieDocument = {
      v: '5.12.2',
      fr: spec.fps,
      ip: 0,
      op: spec.durationFrames,
      w: spec.width,
      h: spec.height,
      nm: spec.name,
      ddd: 0,
      assets: [],
      layers: allLayers,
    };

    for (const primitive of spec.primitives) {
      applyMotionPrimitive(doc, primitive, spec.tokens);
    }

    for (const patch of spec.patches) {
      doc = patchLayerInLast(doc, patch).doc;
    }

    const { doc: validatedDoc, json } = roundTripThroughRelottie(doc);
    const defsXml = defsParts.join('\n');
    const filterLayerIds = allFilters.map((f) => f.layerId);
    const health = inspectLottieHealth(validatedDoc, filterLayerIds);

    await fs.writeFile(this.animationPath(sceneId), json, 'utf8');
    await fs.writeFile(
      this.filtersPath(sceneId),
      JSON.stringify({ defsXml, filters: allFilters }, null, 2) + '\n',
      'utf8',
    );

    return {
      spec,
      doc: validatedDoc,
      filters: allFilters,
      defsXml,
      health,
      animationPath: this.animationPath(sceneId),
    };
  }

  async exportDotLottie(
    sceneId: string,
    options?: RasterBakeOptions,
  ): Promise<ExportResult> {
    const compiled = await this.compile(sceneId);
    const outDir = path.join(this.projectDir, 'out');
    const cacheDir = path.join(outDir, '.raster-cache');
    return exportLottieAndDotLottie({
      sceneId,
      doc: compiled.doc,
      filters: compiled.filters,
      defsXml: compiled.defsXml,
      outDir,
      options: {
        scale: options?.scale ?? 2,
        format: options?.format ?? 'png',
        quality: options?.quality ?? 90,
        cacheDir,
      },
    });
  }
}
