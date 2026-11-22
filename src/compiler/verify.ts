import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { launchHeadlessBrowser } from './browser.js';
import type { LottieDocument, LottieProp, LottiePositionProp } from './types.js';

export interface ContactSheetOptions {
  sceneId: string;
  doc: LottieDocument;
  defsXml?: string;
  filters?: Array<{ id: string; layerId: string }>;
  studioRoot: string;
  outPath: string;
  frames?: number[];
  tileSize?: number;
  cols?: number;
}

export interface ContactSheetResult {
  outPath: string;
  frames: number[];
  width: number;
  height: number;
}

function collectKeyframeTimes(doc: LottieDocument): number[] {
  const times = new Set<number>([0, Math.max(0, Math.round(doc.op - 1))]);
  const walkProp = (p: LottieProp<unknown> | LottiePositionProp | undefined): void => {
    if (!p) return;
    if ('s' in p) {
      walkProp(p.x);
      walkProp(p.y);
      return;
    }
    if (p.a === 1 && Array.isArray(p.k)) {
      for (const kf of p.k) {
        if (typeof kf.t === 'number') times.add(Math.round(kf.t));
      }
    }
  };
  for (const l of doc.layers) {
    walkProp(l.ks.p);
    walkProp(l.ks.s);
    walkProp(l.ks.r);
    walkProp(l.ks.o);
  }
  return [...times].filter((t) => t >= 0 && t < doc.op).sort((a, b) => a - b);
}

/**
 * Picks up to 8 key frames automatically: includes critical keyframe inflection points
 * (such as 90° flip crossings) plus midpoints between them so visual bugs never hide between keys.
 */
export function selectSmartVerifyFrames(doc: LottieDocument, maxFrames = 8): number[] {
  const last = Math.max(0, Math.round(doc.op - 1));
  const kfTimes = collectKeyframeTimes(doc);
  const candidates = new Set<number>(kfTimes);

  // Add midpoints between consecutive keyframes so mid-motion curves are always inspected
  for (let i = 0; i < kfTimes.length - 1; i++) {
    const a = kfTimes[i]!;
    const b = kfTimes[i + 1]!;
    if (b - a >= 4) candidates.add(Math.round((a + b) / 2));
  }

  const sorted = [...candidates].sort((a, b) => a - b);
  if (sorted.length <= maxFrames) {
    // Fill with evenly spaced frames if sparse
    while (sorted.length < Math.min(maxFrames, last + 1)) {
      const idx = Math.round(((sorted.length) / maxFrames) * last);
      if (!sorted.includes(idx)) sorted.push(idx);
      else break;
    }
    return sorted.sort((a, b) => a - b);
  }

  // Downsample evenly while always keeping first and last
  const picked: number[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const pos = Math.round((i / (maxFrames - 1)) * (sorted.length - 1));
    const f = sorted[pos]!;
    if (!picked.includes(f)) picked.push(f);
  }
  return picked;
}

/**
 * Renders key frames of a Lottie composition in real `lottie-web` SVG mode and composites
 * them into a single labelled PNG contact sheet for instant visual verification.
 */
export async function renderLottieContactSheet(
  opts: ContactSheetOptions,
): Promise<ContactSheetResult> {
  const frames =
    opts.frames && opts.frames.length > 0
      ? opts.frames.map((f) => Math.max(0, Math.min(Math.round(opts.doc.op - 1), Math.round(f))))
      : selectSmartVerifyFrames(opts.doc, 8);

  const tileW = opts.tileSize ?? 280;
  const tileH = Math.round((tileW * opts.doc.h) / Math.max(1, opts.doc.w));
  const cols = opts.cols ?? Math.min(4, frames.length);
  const rows = Math.ceil(frames.length / cols);
  const pad = 8;
  const sheetW = cols * tileW + (cols + 1) * pad;
  const sheetH = rows * tileH + (rows + 1) * pad;

  const lottieScriptPath = path.join(
    opts.studioRoot,
    'node_modules',
    'lottie-web',
    'build',
    'player',
    'lottie_svg.min.js',
  );
  const lottieCode = await fs.readFile(lottieScriptPath, 'utf8');
  const browser = await launchHeadlessBrowser();

  const tileBuffers: Buffer[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: tileW, height: tileH },
      deviceScaleFactor: 1,
    });
    const html = `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;width:${tileW}px;height:${tileH}px;overflow:hidden;
        background-color:#1c1e24;
        background-image:linear-gradient(45deg,#262932 25%,transparent 25%),linear-gradient(-45deg,#262932 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#262932 75%),linear-gradient(-45deg,transparent 75%,#262932 75%);
        background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0;}
      #stage{position:relative;width:${tileW}px;height:${tileH}px;}
      #stage>svg{width:100%!important;height:100%!important;display:block;}
      #lbl{position:absolute;top:6px;left:6px;padding:2px 7px;border-radius:5px;background:rgba(12,14,18,.82);color:#fff;font:700 12px/1.2 -apple-system,system-ui,sans-serif;border:1px solid rgba(255,255,255,.16);}
    </style></head><body><div id="stage"></div><div id="lbl"></div></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await loadLottie(page, lottieCode, opts.doc, opts.defsXml, opts.filters);

    for (const f of frames) {
      await page.evaluate((fr) => {
        const lbl = document.getElementById('lbl');
        if (lbl) lbl.textContent = `f${fr}`;
      }, f);
      await showFrame(page, f);
      tileBuffers.push(await page.screenshot({ type: 'png' }));
    }
  } finally {
    await browser.close();
  }

  const composites = tileBuffers.map((input, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    return {
      input,
      left: pad + col * (tileW + pad),
      top: pad + row * (tileH + pad),
    };
  });

  await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
  await sharp({
    create: {
      width: sheetW,
      height: sheetH,
      channels: 4,
      background: { r: 17, g: 18, b: 20, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toFile(opts.outPath);

  return { outPath: opts.outPath, frames, width: sheetW, height: sheetH };
}

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof launchHeadlessBrowser>>['newPage']>>;

/** Loads the Lottie into the page's #stage (lottie-web SVG mode), with live SVG filters re-attached. */
async function loadLottie(
  page: Page,
  lottieCode: string,
  doc: LottieDocument,
  defsXml?: string,
  filters?: Array<{ id: string; layerId: string }>,
): Promise<void> {
  await page.addScriptTag({ content: lottieCode });
  await page.evaluate(
    ({ animationData, defsXml, filters }) => {
      const w = window as unknown as {
        lottie: {
          loadAnimation: (cfg: Record<string, unknown>) => {
            goToAndStop: (f: number, isFrame: boolean) => void;
          };
        };
        __anim?: { goToAndStop: (f: number, isFrame: boolean) => void };
      };
      const container = document.getElementById('stage')!;
      const anim = w.lottie.loadAnimation({
        container,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
      });
      w.__anim = anim;

      const svg = container.querySelector('svg');
      if (svg && filters && filters.length > 0 && defsXml) {
        const ns = 'http://www.w3.org/2000/svg';
        let defs = svg.querySelector('defs');
        if (!defs) {
          defs = document.createElementNS(ns, 'defs');
          svg.prepend(defs);
        }
        const parsed = new DOMParser().parseFromString(`<svg xmlns="${ns}">${defsXml}</svg>`, 'image/svg+xml').querySelector('defs');
        if (parsed) {
          for (const c of [...parsed.children]) defs.append(document.importNode(c, true));
        }
        for (const f of filters) {
          const fid = String(f.id || '').split('+')[0];
          if (!fid) continue;
          const g = svg.querySelector(`#${CSS.escape(f.layerId)}`);
          if (g) g.setAttribute('filter', `url(#${fid})`);
        }
      }
    },
    { animationData: doc, defsXml: defsXml ?? '', filters: filters ?? [] },
  );
}

async function showFrame(page: Page, frame: number): Promise<void> {
  await page.evaluate((fr) => {
    const w = window as unknown as { __anim?: { goToAndStop: (x: number, b: boolean) => void } };
    w.__anim?.goToAndStop(fr, true);
  }, frame);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export interface CloseupOptions {
  doc: LottieDocument;
  defsXml?: string;
  filters?: Array<{ id: string; layerId: string }>;
  studioRoot: string;
  outPath: string;
  frames: number[];
  /** render scale (default 2: edges at double size) */
  scale?: number;
  /** space kept around the shapes, in output px (default 24) */
  margin?: number;
}

export interface CloseupResult {
  outPath: string;
  frames: number[];
  width: number;
  height: number;
  /** the shared crop, in composition px */
  crop: { x: number; y: number; w: number; h: number };
  /** each frame cropped (PNG), in `frames` order */
  tiles: Buffer[];
}

/**
 * Close-ups for checking shape edges: renders frames at `scale` on a plain dark background, crops every frame to
 * the same box around everything drawn (so tiles line up), and tiles them labelled into one PNG.
 */
export async function renderLottieCloseups(opts: CloseupOptions): Promise<CloseupResult> {
  const scale = opts.scale ?? 2;
  const margin = opts.margin ?? 24;
  const bg = { r: 21, g: 23, b: 28 };
  const frames = opts.frames.map((f) => Math.max(0, Math.min(Math.round(opts.doc.op - 1), Math.round(f))));
  const lottieCode = await fs.readFile(
    path.join(opts.studioRoot, 'node_modules', 'lottie-web', 'build', 'player', 'lottie_svg.min.js'),
    'utf8',
  );
  const browser = await launchHeadlessBrowser();
  const shots: Buffer[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: opts.doc.w, height: opts.doc.h }, deviceScaleFactor: scale });
    await page.setContent(
      `<!doctype html><html><head><style>
        html,body{margin:0;padding:0;width:${opts.doc.w}px;height:${opts.doc.h}px;overflow:hidden;background:rgb(${bg.r},${bg.g},${bg.b});}
        #stage{width:100%;height:100%;}#stage>svg{width:100%!important;height:100%!important;display:block;}
      </style></head><body><div id="stage"></div></body></html>`,
      { waitUntil: 'load' },
    );
    await loadLottie(page, lottieCode, opts.doc, opts.defsXml, opts.filters);
    for (const f of frames) {
      await showFrame(page, f);
      shots.push(await page.screenshot({ type: 'png' }));
    }
  } finally {
    await browser.close();
  }

  // one box around what's drawn in any frame
  const fullW = Math.round(opts.doc.w * scale);
  const fullH = Math.round(opts.doc.h * scale);
  let box = { x0: fullW, y0: fullH, x1: 0, y1: 0 };
  for (const shot of shots) {
    // pixels that differ from the background (a blank frame adds nothing)
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 3;
        if (Math.abs(data[i]! - bg.r) + Math.abs(data[i + 1]! - bg.g) + Math.abs(data[i + 2]! - bg.b) <= 12) continue;
        if (x < box.x0) box.x0 = x;
        if (x >= box.x1) box.x1 = x + 1;
        if (y < box.y0) box.y0 = y;
        if (y >= box.y1) box.y1 = y + 1;
      }
    }
  }
  if (box.x1 <= box.x0) box = { x0: 0, y0: 0, x1: fullW, y1: fullH };
  const left = Math.max(0, box.x0 - margin);
  const top = Math.max(0, box.y0 - margin);
  const tileW = Math.min(fullW, box.x1 + margin) - left;
  const tileH = Math.min(fullH, box.y1 + margin) - top;

  const pad = 8;
  const cols = Math.max(1, Math.min(frames.length, 4, Math.floor(2400 / (tileW + pad))));
  const rows = Math.ceil(frames.length / cols);
  const sheetW = cols * tileW + (cols + 1) * pad;
  const sheetH = rows * tileH + (rows + 1) * pad;
  const label = (f: number): Buffer =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="24"><rect width="64" height="24" rx="5" fill="rgba(12,14,18,.82)"/>` +
        `<text x="8" y="17" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#fff">f${f}</text></svg>`,
    );
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  const tiles: Buffer[] = [];
  for (const [idx, shot] of shots.entries()) {
    const x = pad + (idx % cols) * (tileW + pad);
    const y = pad + Math.floor(idx / cols) * (tileH + pad);
    tiles.push(await sharp(shot).extract({ left, top, width: tileW, height: tileH }).png().toBuffer());
    composites.push({ input: tiles[idx]!, left: x, top: y });
    composites.push({ input: label(frames[idx]!), left: x + 6, top: y + 6 });
  }
  await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
  await sharp({ create: { width: sheetW, height: sheetH, channels: 4, background: { r: 17, g: 18, b: 20, alpha: 1 } } })
    .composite(composites)
    .png()
    .toFile(opts.outPath);

  return {
    outPath: opts.outPath,
    frames,
    width: sheetW,
    height: sheetH,
    crop: { x: left / scale, y: top / scale, w: tileW / scale, h: tileH / scale },
    tiles,
  };
}
