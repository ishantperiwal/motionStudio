// npm run verify-shapes -- <scene> [a,b,c] [--scale 2]
// Close-ups for checking shape edges: renders the frames at 2x, crops them all to the same box around the shapes
// and tiles them into one labelled PNG (`out/<scene>-shapes.png`). Without frames it takes every shapeMorph pose
// and the middle of every morph.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, PROJECT } from '../server/project.mjs';

const argv = process.argv.slice(2);
const scene = argv[0];
if (!scene || scene.startsWith('--')) {
  console.log('usage: npm run verify-shapes -- <scene> [a,b,c] [--scale 2]');
  process.exit(1);
}
const opt = (k) => { const i = argv.indexOf('--' + k); return i < 0 ? null : argv[i + 1]; };
const framesArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const scale = +(opt('scale') ?? 2);

const { CompositionManager, renderLottieCloseups } = await import(
  pathToFileURL(path.join(ROOT, 'dist', 'compiler', 'index.js')).href
);
const mgr = new CompositionManager(PROJECT, ROOT);
const compiled = await mgr.compile(scene);

let frames = framesArg ? framesArg.split(',').map((s) => Number(s.trim())).filter(Number.isFinite) : [];
if (!frames.length) {
  // every pose (the middle of its hold, so it has settled) and the middle of every morph
  for (const p of compiled.spec.primitives.filter((p) => p.kind === 'shapeMorph')) {
    p.stops.forEach((s, i) => {
      const next = p.stops[i + 1];
      frames.push(next ? Math.round((s.t + next.t) / 2) : s.t);
    });
  }
  frames = [...new Set(frames)].sort((a, b) => a - b).slice(0, 16);
}
if (!frames.length) {
  console.log('No frames: pass them (npm run verify-shapes -- <scene> a,b,c); this scene has no shapeMorph to pick from.');
  process.exit(1);
}

const sheet = await renderLottieCloseups({
  doc: compiled.doc,
  defsXml: compiled.defsXml,
  filters: compiled.filters,
  studioRoot: ROOT,
  outPath: path.join(PROJECT, 'out', `${scene}-shapes.png`),
  frames,
  scale,
});
const c = sheet.crop;
console.log(`Shape close-ups → ${sheet.outPath}`);
console.log(`  frames: [${sheet.frames.join(', ')}] · ${scale}x · crop ${Math.round(c.w)}x${Math.round(c.h)} at ${Math.round(c.x)},${Math.round(c.y)} · ${sheet.width}x${sheet.height}`);
