import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DotLottie } from '@dotlottie/dotlottie-js';
import { launchHeadlessBrowser } from './browser.js';
import { inspectLottieHealth, roundTripThroughRelottie } from './last.js';
import { round2, round4 } from './tokens.js';
import type {
  ExportResult,
  LottieDocument,
  LottieImageAsset,
  LottieImageLayer,
  LottieLayer,
  LottieProp,
  RasterBakeOptions,
  SvgFilterDescriptor,
} from './types.js';

export interface BakedLayerInfo {
  layerId: string;
  assetId: string;
  width: number;
  height: number;
  bytes: number;
  format: 'png' | 'webp';
  dataUrl: string;
}

function buildIsolatedSvg(
  filter: SvgFilterDescriptor,
  defsXml: string,
): { svg: string; originX: number; originY: number; logicalW: number; logicalH: number } {
  const pad = Math.max(8, filter.bleedPx);
  const originX = Math.floor(filter.bounds.x - pad);
  const originY = Math.floor(filter.bounds.y - pad);
  const logicalW = Math.max(4, Math.ceil(filter.bounds.width + pad * 2));
  const logicalH = Math.max(4, Math.ceil(filter.bounds.height + pad * 2));

  const defsBlock = defsXml.trim()
    ? defsXml
    : filter.filterXml.trim()
      ? `<defs>${filter.filterXml}</defs>`
      : '';

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${logicalW}" height="${logicalH}" viewBox="${originX} ${originY} ${logicalW} ${logicalH}">`,
    defsBlock,
    filter.sourceSvgFragment,
    '</svg>',
  ].join('\n');

  return { svg, originX, originY, logicalW, logicalH };
}

async function rasterizeWithPlaywright(
  svg: string,
  logicalW: number,
  logicalH: number,
  scale: number,
  format: 'png' | 'webp',
  quality: number,
): Promise<Buffer> {
  const browser = await launchHeadlessBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: logicalW, height: logicalH },
      deviceScaleFactor: scale,
    });
    const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;width:${logicalW}px;height:${logicalH}px;background:transparent;overflow:hidden;}svg{display:block;width:${logicalW}px;height:${logicalH}px;}</style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    const pngBuf = await page.screenshot({
      type: 'png',
      omitBackground: true,
      clip: { x: 0, y: 0, width: logicalW, height: logicalH },
    });
    if (format === 'webp') {
      const sharpMod = await import('sharp');
      return sharpMod.default(pngBuf).webp({ quality }).toBuffer();
    }
    return pngBuf;
  } finally {
    await browser.close();
  }
}

async function rasterizeWithSharp(
  svg: string,
  logicalW: number,
  logicalH: number,
  scale: number,
  format: 'png' | 'webp',
  quality: number,
): Promise<Buffer> {
  const sharpMod = await import('sharp');
  const pipeline = sharpMod
    .default(Buffer.from(svg, 'utf8'), { density: Math.round(72 * scale) })
    .resize(Math.round(logicalW * scale), Math.round(logicalH * scale), {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  return format === 'webp' ? pipeline.webp({ quality }).toBuffer() : pipeline.png().toBuffer();
}

async function rasterizeSvgNode(
  svg: string,
  logicalW: number,
  logicalH: number,
  renderScale: number,
  pixelW: number,
  pixelH: number,
  format: 'png' | 'webp',
  quality: number,
  cacheDir?: string,
): Promise<Buffer> {
  const hash = crypto
    .createHash('sha256')
    .update(`${svg}|${logicalW}x${logicalH}@${renderScale}->${pixelW}x${pixelH}|${format}|${quality}`)
    .digest('hex')
    .slice(0, 16);
  const cacheFile = cacheDir ? path.join(cacheDir, `${hash}.${format}`) : undefined;

  if (cacheFile) {
    try {
      return await fs.readFile(cacheFile);
    } catch {
      // cache miss
    }
  }

  const needsResize = pixelW !== Math.round(logicalW * renderScale) || pixelH !== Math.round(logicalH * renderScale);
  const renderFormat = needsResize ? 'png' : format;
  let buf: Buffer;
  try {
    buf = await rasterizeWithPlaywright(svg, logicalW, logicalH, renderScale, renderFormat, quality);
  } catch {
    buf = await rasterizeWithSharp(svg, logicalW, logicalH, renderScale, renderFormat, quality);
  }

  if (needsResize) {
    const sharpMod = await import('sharp');
    const resized = sharpMod.default(buf).resize(pixelW, pixelH, { kernel: 'lanczos3' });
    buf = await (format === 'webp' ? resized.webp({ quality }) : resized.png({ compressionLevel: 9 })).toBuffer();
  }

  if (cacheFile) {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, buf);
  }
  return buf;
}

function scaleLottieScaleProp(
  prop: LottieProp<number[]> | undefined,
  invScaleX: number,
  invScaleY: number = invScaleX,
): LottieProp<number[]> {
  if (!prop) {
    return { a: 0, k: [round4(100 * invScaleX), round4(100 * invScaleY), 100] };
  }
  if (prop.a === 0) {
    return {
      a: 0,
      k: [
        round4((prop.k[0] ?? 100) * invScaleX),
        round4((prop.k[1] ?? 100) * invScaleY),
        prop.k[2] ?? 100,
      ],
    };
  }
  return {
    a: 1,
    k: prop.k.map((kf) => ({
      ...kf,
      s: [
        round4((kf.s[0] ?? 100) * invScaleX),
        round4((kf.s[1] ?? 100) * invScaleY),
        kf.s[2] ?? 100,
      ],
      ...(kf.e
        ? {
            e: [
              round4((kf.e[0] ?? 100) * invScaleX),
              round4((kf.e[1] ?? 100) * invScaleY),
              kf.e[2] ?? 100,
            ],
          }
        : {}),
    })),
  };
}

function getLayerAnchor(layer: LottieLayer): [number, number] {
  const a = layer.ks.a;
  if (!a) return [0, 0];
  if (a.a === 0) return [a.k[0] ?? 0, a.k[1] ?? 0];
  const first = a.k[0]?.s;
  return [first?.[0] ?? 0, first?.[1] ?? 0];
}

/**
 * Filter-to-Raster Baker:
 * Renders any layer flagged with SVG filter primitives (`feGaussianBlur`, `feDropShadow`,
 * glows, inner shadows) offscreen at target DPI and swaps those nodes into embedded
 * `LottieImageLayer`s (`ty: 2`) while preserving all motion keyframes & anchor math.
 */
export async function bakeFilteredLayers(
  sourceDoc: LottieDocument,
  filters: SvgFilterDescriptor[],
  defsXml: string,
  opts: RasterBakeOptions = {},
): Promise<{ doc: LottieDocument; baked: BakedLayerInfo[] }> {
  const doc = structuredClone(sourceDoc);
  if (filters.length === 0) {
    return { doc, baked: [] };
  }

  const scale = Math.max(0.125, Math.min(3, opts.scale ?? 2));
  const renderScale = Math.max(1, Math.min(3, Math.ceil(scale)));
  const format = opts.format ?? 'png';
  const quality = opts.quality ?? 90;
  const filterByLayer = new Map<string, SvgFilterDescriptor>();
  for (const f of filters) {
    filterByLayer.set(f.layerId, f);
  }

  const baked: BakedLayerInfo[] = [];
  const nextLayers: LottieLayer[] = [];

  for (const layer of doc.layers) {
    const id = layer.ln ?? layer.nm;
    const filter = filterByLayer.get(id);
    if (!filter) {
      nextLayers.push(layer);
      continue;
    }

    const { svg, originX, originY, logicalW, logicalH } = buildIsolatedSvg(filter, defsXml);
    const pixelW = Math.max(4, Math.round(logicalW * scale));
    const pixelH = Math.max(4, Math.round(logicalH * scale));
    const imgBuf = await rasterizeSvgNode(
      svg,
      logicalW,
      logicalH,
      renderScale,
      pixelW,
      pixelH,
      format,
      quality,
      opts.cacheDir,
    );

    const assetId = `img_fx_${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const mime = format === 'webp' ? 'image/webp' : 'image/png';
    const dataUrl = `data:${mime};base64,${imgBuf.toString('base64')}`;

    const asset: LottieImageAsset = {
      id: assetId,
      w: pixelW,
      h: pixelH,
      u: '',
      p: dataUrl,
      e: 1,
    };
    doc.assets = [...doc.assets.filter((a) => a.id !== assetId), asset];

    const [ax, ay] = getLayerAnchor(layer);
    const actualScaleX = pixelW / logicalW;
    const actualScaleY = pixelH / logicalH;
    const newAnchorX = round2((ax - originX) * actualScaleX);
    const newAnchorY = round2((ay - originY) * actualScaleY);
    const invScaleX = 1 / actualScaleX;
    const invScaleY = 1 / actualScaleY;

    const imgLayer: LottieImageLayer = {
      ddd: 0,
      ind: layer.ind,
      ty: 2,
      nm: layer.nm,
      ln: layer.ln,
      cl: layer.cl,
      refId: assetId,
      sr: layer.sr,
      ks: {
        ...layer.ks,
        a: { a: 0, k: [newAnchorX, newAnchorY, 0] },
        s: scaleLottieScaleProp(layer.ks.s, invScaleX, invScaleY),
      },
      ao: layer.ao,
      ip: layer.ip,
      op: layer.op,
      st: layer.st,
      bm: layer.bm,
      ...(layer.parent !== undefined ? { parent: layer.parent } : {}),
      ...(layer.tt !== undefined ? { tt: layer.tt } : {}),
      ...(layer.td !== undefined ? { td: layer.td } : {}),
      ...(layer.hd !== undefined ? { hd: layer.hd } : {}),
    };

    nextLayers.push(imgLayer);
    baked.push({
      layerId: id,
      assetId,
      width: pixelW,
      height: pixelH,
      bytes: imgBuf.byteLength,
      format,
      dataUrl,
    });
  }

  doc.layers = nextLayers;
  return { doc, baked };
}

/**
 * Runs the Filter-to-Raster export pass, validates through relottie LAST AST,
 * and packages both `.json` and `.lottie` (via `@dotlottie/dotlottie-js`).
 */
export async function exportLottieAndDotLottie(params: {
  sceneId: string;
  doc: LottieDocument;
  filters: SvgFilterDescriptor[];
  defsXml: string;
  outDir: string;
  options?: RasterBakeOptions;
}): Promise<ExportResult> {
  const { sceneId, doc, filters, defsXml, outDir, options } = params;
  await fs.mkdir(outDir, { recursive: true });

  const { doc: bakedDoc, baked } = await bakeFilteredLayers(doc, filters, defsXml, options);
  const { json, doc: normalizedDoc } = roundTripThroughRelottie(bakedDoc);
  const health = inspectLottieHealth(normalizedDoc, []);

  const jsonPath = path.join(outDir, `${sceneId}.json`);
  const dotLottiePath = path.join(outDir, `${sceneId}.lottie`);

  await fs.writeFile(jsonPath, json, 'utf8');

  const dotLottie = new DotLottie({
    generator: 'Motion Studio Lottie Compiler',
  });
  dotLottie.addAnimation({
    id: sceneId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: normalizedDoc as any,
  });
  await dotLottie.build();
  const arrayBuf = await dotLottie.toArrayBuffer();
  const dotBuf = Buffer.from(arrayBuf);
  await fs.writeFile(dotLottiePath, dotBuf);

  return {
    sceneId,
    jsonPath,
    dotLottiePath,
    jsonBytes: Buffer.byteLength(json, 'utf8'),
    dotLottieBytes: dotBuf.byteLength,
    bakedLayers: baked.map(({ dataUrl: _d, ...rest }) => rest),
    health,
  };
}
