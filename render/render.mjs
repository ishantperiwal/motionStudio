// Render a scene to frames / contact sheet / MP4.
//
//   npm run render -- my-film                       → out/my-film.mp4 (the project's out/: see server/project.mjs)
//   npm run render -- my-film --frames 0,100,200    → PNGs in out/my-film-frames/
//   npm run render -- my-film --range 150-200 --png out/x
//   npm run render -- my-film --sheet 0-250:10      → out/my-film-sheet-*.png (5x4 tiles)
//   npm run render -- techniques/x/demo ...         → a scene page in another folder (outputs named techniques-x-demo)
//   options: --blur 8 (sub-frame motion blur) --shutter 0.5 --scale 2 --workers 12 --browsers 4 --out file.mp4 --crf 16
//            --out file.webm encodes WebM (VP9) instead, --vp9crf 30 sets its quality
//            --size 1600x900 makes the video exactly that size (use with --scale ≈ 1600/1920; frames are drawn at --scale)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { startServer, PROJECT, CHROME } from '../server/dev.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
if (!argv[0] || argv[0].startsWith('--')) { console.log('usage: npm run render -- <scene | folder/with/scene> [--frames a,b | --range a-b | --sheet a-b:step] [--png dir] [--out file.mp4] [--blur N] [--scale 2] [--workers 12] [--browsers 4]'); process.exit(1); }
// a scene id (scenes/<id>/), or a path to any folder holding a scene page, e.g. a technique's demo
const dirArg = argv[0].replace(/^\/+|\/+$/g, ''), pageUrl = dirArg.includes('/') ? `/${dirArg}/` : `/scenes/${dirArg}/`, scene = dirArg.replace(/\//g, '-');

// Speed: a frame takes ~35 ms to seek and draw but ~375 ms to save as an ordinary PNG, and one browser saves its pages'
// screenshots one at a time. So frames are captured with Chrome's fast PNG mode (still lossless, ~4× quicker), and the
// workers (pages) are spread over several browsers so the captures run side by side (~13× overall on a 15-core Mac).
const workers = +opt('workers', Math.max(1, Math.min(16, os.cpus().length - 3)));
const browserCount = Math.max(1, Math.min(workers, +opt('browsers', Math.min(4, Math.ceil(workers / 3)))));
const blur = +opt('blur', 1), shutter = +opt('shutter', 0.5), scale = +opt('scale', 1);
const outDir = path.join(PROJECT, 'out');
fs.mkdirSync(outDir, { recursive: true });

// Stop (from the editor) sends SIGTERM to this process group: remove the temporary frames and the half-written file, then exit
const tmpDirs = [];
let partialOut = null;
const cleanTmp = () => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
process.on('SIGTERM', () => { cleanTmp(); if (partialOut) fs.rmSync(partialOut, { force: true }); process.exit(143); });

const server = await startServer({ port: 0, watch: false, quiet: true });
const base = `http://localhost:${server.address().port}`;
const browsers = await Promise.all(Array.from({ length: browserCount }, () => chromium.launch(CHROME)));
let opened = 0;

async function openPage() {
  const page = await browsers[opened++ % browsers.length].newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  const cdp = await page.context().newCDPSession(page);
  page.on('pageerror', (e) => console.error('[scene error]', e.message));
  await page.goto(`${base}${pageUrl}?render`);
  await page.waitForFunction(() => window.animationReady === true, null, { timeout: 30000 });
  const meta = await page.evaluate(() => ({ w: window.__studio.width, h: window.__studio.height, fps: window.__studio.fps, frames: window.__studio.frames }));
  await page.setViewportSize({ width: meta.w, height: meta.h });
  return { page, cdp, meta };
}

// jobs: [{ t: frame time (may be fractional), file }]
async function run(jobs) {
  const pages = await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, openPage));
  let next = 0, done = 0;
  await Promise.all(pages.map(async ({ page, cdp, meta }) => {
    const clip = { x: 0, y: 0, width: meta.w, height: meta.h, scale };   // the stage at --scale (this session doesn't see Playwright's pixel-ratio emulation, so the scale goes here)
    while (next < jobs.length) {
      const j = jobs[next++];
      await page.evaluate(async (t) => { window.seek(t); await window.__settle?.(); }, j.t);
      // let the compositor paint the new frame before capturing (otherwise heavy 3D frames can be grabbed half-drawn)
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip, captureBeyondViewport: false });   // lossless, just lighter compression
      await fs.promises.writeFile(j.file, Buffer.from(data, 'base64'));
      if (++done % 10 === 0) process.stdout.write(`\r${done}/${jobs.length}`);
    }
  }));
  if (jobs.length >= 50) process.stdout.write(`\r${jobs.length}/${jobs.length}\n`);
  return pages[0].meta;
}

const probe = await openPage();
const { fps, frames } = probe.meta;
await probe.page.close();
const parseRange = (s) => { const [a, b] = s.split('-').map(Number); return [a, Number.isFinite(b) ? b : a]; };
const ffmpeg = (args) => { const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status) throw new Error('ffmpeg failed'); };

try {
  if (opt('sheet')) {
    const [rng, step = '10'] = opt('sheet').split(':');
    const [a, b] = parseRange(rng);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-sheet-')); tmpDirs.push(tmp);
    const list = []; for (let f = a; f <= Math.min(b, frames - 1); f += +step) list.push(f);
    await run(list.map((f, i) => ({ t: f, file: path.join(tmp, `${String(i).padStart(5, '0')}.png`) })));
    const out = opt('out', path.join(outDir, `${scene}-sheet-%d.png`));
    ffmpeg(['-framerate', '1', '-i', path.join(tmp, '%05d.png'), '-vf', 'scale=480:-1,tile=5x4:padding=4', '-start_number', '0', out]);
    console.log(`sheet: frames ${list[0]}…${list.at(-1)} every ${step} → ${out.replace('%d', '*')} (20 per sheet, row-major)`);
  } else if (opt('frames') || opt('png')) {
    const list = opt('frames') ? opt('frames').split(',').map(Number) : (() => { const [a, b] = parseRange(opt('range', `0-${frames - 1}`)); return Array.from({ length: b - a + 1 }, (_, i) => a + i); })();
    const dir = opt('png', path.join(outDir, `${scene}-frames`));
    fs.mkdirSync(dir, { recursive: true });
    await run(list.map((f) => ({ t: f, file: path.join(dir, `f${String(f).padStart(4, '0')}.png`) })));
    console.log(`${list.length} frame(s) → ${dir}`);
  } else {
    const [a, b] = parseRange(opt('range', `0-${frames - 1}`));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-render-'));
    tmpDirs.push(tmp);
    const jobs = [];
    for (let f = a, i = 0; f <= b; f++) for (let k = 0; k < blur; k++, i++) {
      // sub-frame samples spread across the shutter window centred on the frame
      const t = blur === 1 ? f : f + ((k + 0.5) / blur - 0.5) * shutter;
      jobs.push({ t: Math.max(0, Math.min(frames - 1, t)), file: path.join(tmp, `${String(i).padStart(6, '0')}.png`) });
    }
    console.log(`rendering ${b - a + 1} frames${blur > 1 ? ` × ${blur} sub-frames` : ''} with ${workers} workers…`);
    await run(jobs);
    const out = opt('out', path.join(outDir, `${scene}.mp4`));
    const vf = blur > 1 ? [`tmix=frames=${blur}`, `select='eq(mod(n\\,${blur})\\,${blur - 1})'`, `setpts=N/${fps}/TB`] : [];
    const size = opt('size', ''), sz = size.match(/^(\d+)x(\d+)$/);
    vf.push(sz ? `scale=${sz[1]}:${sz[2]}:flags=lanczos` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2');   // exact size, or at least even sides (H.264/VP9 need them)
    partialOut = path.resolve(out);   // only from here on is the file ours to remove if stopped mid-encode (a relative --out is from the cwd, as ffmpeg sees it)
    const codec = out.endsWith('.webm')   // WebM: VP9 in constant-quality mode (its CRF scale differs from H.264's: ~30 here ≈ H.264 18)
      ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', opt('vp9crf', '30'), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2']
      : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', opt('crf', '16'), '-preset', 'slow', '-movflags', '+faststart'];
    ffmpeg(['-framerate', String(fps * blur), '-i', path.join(tmp, '%06d.png'), ...(vf.length ? ['-vf', vf.join(',')] : []), '-r', String(fps), ...codec, out]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`→ ${out}`);
  }
} finally {
  cleanTmp();
  await Promise.all(browsers.map((b) => b.close()));
  server.close();
}
