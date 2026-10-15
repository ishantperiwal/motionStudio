// Motion probe: track an element's on-screen centre frame by frame and report speed,
// so motion quality (smooth starts, flat endings, hard stops, jumps) can be checked
// without watching. Target = data-name (e.g. "Cursor – Priya") or a CSS selector.
//
//   npm run probe -- my-film "<data-name>" --range 270-330
//   npm run probe -- my-film "#cam" --range 600-680 --scale     (camera: tracks zoom too)
import { chromium } from 'playwright';
import { startServer, CHROME } from '../server/dev.mjs';

const [scene, target] = process.argv.slice(2);
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
if (!scene || !target) { console.log('usage: npm run probe -- <scene> <data-name | selector> [--range a-b]'); process.exit(1); }

const server = await startServer({ port: 0, watch: false, quiet: true });
const browser = await chromium.launch(CHROME);
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://localhost:${server.address().port}/scenes/${scene}/?render`);
await page.waitForFunction(() => window.animationReady === true);
const frames = await page.evaluate(() => window.__studio.frames);
const [a, b] = (opt('range', `0-${frames - 1}`)).split('-').map(Number);

const samples = await page.evaluate(({ target, a, b }) => {
  const el = document.querySelector(`[data-name="${CSS.escape(target)}"]`) || document.querySelector(target);
  if (!el) return null;
  const out = [];
  for (let f = a; f <= b; f++) {
    window.seek(f);
    const r = el.getBoundingClientRect();
    out.push({ f, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, o: +getComputedStyle(el).opacity });
  }
  return out;
}, { target, a, b });
await browser.close(); server.close();
if (!samples) { console.error(`No element "${target}"`); process.exit(1); }

const sp = samples.map((s, i) => (i ? Math.hypot(s.x - samples[i - 1].x, s.y - samples[i - 1].y) : 0));
const zs = samples.map((s, i) => (i ? Math.abs(Math.log(s.w / samples[i - 1].w || 1)) : 0));
const max = Math.max(...sp, 1e-9), zmax = Math.max(...zs, 1e-9);
const bars = '▁▂▃▄▅▆▇█';
const spark = (arr, m) => arr.map((v) => (v < m * 0.01 ? '·' : bars[Math.min(7, Math.floor((v / m) * 7.99))])).join('');
console.log(`${target}  frames ${a}–${b}`);
console.log(`move  ${spark(sp, max)}   peak ${max.toFixed(1)} px/f`);
if (zmax > 1e-4) console.log(`zoom  ${spark(zs, zmax)}`);

// flag rough spots
const flags = [];
for (let i = 2; i < sp.length; i++) {
  const prev = sp[i - 1], cur = sp[i];
  if (samples[i].o < 0.05 || samples[i - 1].o < 0.05) continue;   // invisible: exits / entrances off-camera
  if (prev > max * 0.3 && cur < max * 0.03) flags.push(`f${samples[i].f}: hard stop (${prev.toFixed(1)} → ${cur.toFixed(1)} px/f)`);
  if (cur > max * 0.3 && prev < max * 0.03 && sp[i - 2] < max * 0.03) flags.push(`f${samples[i].f}: abrupt start (0 → ${cur.toFixed(1)} px/f)`);
  const nb = (sp[i - 1] + (sp[i + 1] ?? sp[i - 1])) / 2;
  if (cur > max * 0.2 && nb > 0 && cur > nb * 2.5) flags.push(`f${samples[i].f}: jump (${cur.toFixed(1)} vs ~${nb.toFixed(1)} px/f around it)`);
}
console.log(flags.length ? 'flags:\n  ' + flags.join('\n  ') : 'flags: none — starts and stops are eased');
if (process.argv.includes('--table')) for (let i = 0; i < samples.length; i++) console.log(`${samples[i].f}\t${samples[i].x.toFixed(1)}\t${samples[i].y.toFixed(1)}\t${sp[i].toFixed(2)}\topacity ${samples[i].o}`);
