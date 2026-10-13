// Render a scene to frames / contact sheet / MP4.
//
//   npm run render -- inbox                         → out/inbox.mp4
//   npm run render -- inbox --frames 0,100,200      → PNGs in out/inbox-frames/
//   npm run render -- inbox --range 600-700 --png out/x
//   npm run render -- inbox --sheet 0-1000:10       → out/inbox-sheet-*.png (5x4 tiles)
//   options: --blur 8 (sub-frame motion blur) --shutter 0.5 --scale 2 --workers 4 --out file.mp4 --crf 16
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { startServer, ROOT } from '../server/dev.mjs';

const argv = process.argv.slice(2);
const scene = argv[0];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
if (!scene || scene.startsWith('--')) { console.log('usage: npm run render -- <scene> [--frames a,b | --range a-b | --sheet a-b:step] [--png dir] [--out file.mp4] [--blur N] [--scale 2] [--workers 4]'); process.exit(1); }

const workers = +opt('workers', Math.max(1, Math.min(6, os.cpus().length - 2)));
const blur = +opt('blur', 1), shutter = +opt('shutter', 0.5), scale = +opt('scale', 1);
const outDir = path.join(ROOT, 'out');
fs.mkdirSync(outDir, { recursive: true });

const server = await startServer({ port: 0, watch: false, quiet: true });
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome' });

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => console.error('[scene error]', e.message));
  await page.goto(`${base}/scenes/${scene}/?render`);
  await page.waitForFunction(() => window.animationReady === true, null, { timeout: 30000 });
  const meta = await page.evaluate(() => ({ w: window.__studio.width, h: window.__studio.height, fps: window.__studio.fps, frames: window.__studio.frames }));
  await page.setViewportSize({ width: meta.w, height: meta.h });
  return { page, meta };
}

// jobs: [{ t: frame time (may be fractional), file }]
async function run(jobs) {
  const pages = await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, openPage));
  let next = 0, done = 0;
  await Promise.all(pages.map(async ({ page }) => {
    while (next < jobs.length) {
      const j = jobs[next++];
      await page.evaluate((t) => window.seek(t), j.t);
      await page.screenshot({ path: j.file });
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-sheet-'));
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
    ffmpeg(['-framerate', String(fps * blur), '-i', path.join(tmp, '%06d.png'), ...(vf.length ? ['-vf', vf.join(',')] : []),
      '-r', String(fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', opt('crf', '16'), '-preset', 'slow', '-movflags', '+faststart', out]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`→ ${out}`);
  }
} finally {
  await browser.close();
  server.close();
}
