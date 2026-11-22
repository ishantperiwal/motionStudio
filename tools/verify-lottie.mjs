// npm run verify-lottie -- <scene> [--frames 6,15,19,20,21,26,34,66] [--baked]
// Renders key frames of a Lottie composition into a single labelled contact sheet PNG
// (`out/<scene>-sheet.png`) for instant visual inspection before reporting work done.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, PROJECT } from '../server/project.mjs';

const argv = process.argv.slice(2);
const scene = argv[0];
if (!scene || scene.startsWith('--')) {
  console.log('usage: npm run verify-lottie -- <scene> [--frames a,b,c] [--baked]');
  process.exit(1);
}
const opt = (k) => { const i = argv.indexOf('--' + k); return i < 0 ? null : argv[i + 1]; };
const framesArg = opt('frames');
const frames = framesArg ? framesArg.split(',').map((s) => Number(s.trim())).filter(Number.isFinite) : undefined;
const baked = argv.includes('--baked');

const { CompositionManager, bakeFilteredLayers, renderLottieContactSheet } = await import(
  pathToFileURL(path.join(ROOT, 'dist', 'compiler', 'index.js')).href
);

const mgr = new CompositionManager(PROJECT, ROOT);
const compiled = await mgr.compile(scene);
let doc = compiled.doc;
let filters = compiled.filters;
let defsXml = compiled.defsXml;

if (baked && filters.length > 0) {
  const res = await bakeFilteredLayers(doc, filters, defsXml, {
    scale: 2,
    format: 'png',
    cacheDir: path.join(PROJECT, 'out', '.raster-cache'),
  });
  doc = res.doc;
  filters = [];
  defsXml = '';
}

const outPath = path.join(PROJECT, 'out', `${scene}${baked ? '-baked' : ''}-sheet.png`);
const sheet = await renderLottieContactSheet({
  sceneId: scene,
  doc,
  defsXml,
  filters,
  studioRoot: ROOT,
  outPath,
  frames,
});

console.log(`Contact sheet → ${sheet.outPath}`);
console.log(`  frames: [${sheet.frames.join(', ')}] · ${sheet.width}x${sheet.height} · ${compiled.health.totalKeyframes} kf · ${compiled.health.mobileReady ? 'iOS/Android OK' : 'CHECK ISSUES'}`);
