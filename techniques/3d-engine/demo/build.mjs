// Builds the live 3D-engine demo scene (rotating pyramid + 8-part tilted machine using poly, lathe, extrude, sphere)
// into `scenes/demo-3d-engine/` (for verify-3d / verify-lottie) and copies the playable bundle into `techniques/3d-engine/demo/`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const { CompositionManager, turntableSvg, polyBox, polyPyramid } = await import(
  pathToFileURL(path.join(ROOT, 'dist', 'compiler', 'index.js')).href
);

const sceneId = 'demo-3d-engine';
const width = 800;
const height = 460;
const fps = 60;
const durationFrames = 180; // 3s clean 360° loop

// 1. Left: rotating square pyramid (poly)
const pyramidSpec = {
  kind: 'turntable',
  id: 'pyramid',
  origin: [185, 240],
  tilt: 20,
  angle: [{ t: 0, deg: 0 }, { t: durationFrames, deg: 360 }],
  parts: [
    {
      type: 'poly',
      name: 'pyr',
      center: [0, 0, 0],
      ...polyPyramid(116, 126),
      paint: ['#B45309', '#F59E0B', '#FBBF24', '#EA580C', '#FB923C'],
      shade: '#78350F',
    },
  ],
};

// 2. Right: 8-part tilted machine combining polyBox, lathe profiles (beveled recessed wheels, tapered knob, open dial,
//    cone nozzle), non-symmetric holed extrude badge, and world-lit sphere button.
const machineSpec = {
  kind: 'turntable',
  id: 'machine',
  origin: [540, 245],
  tilt: 22,
  focal: 1100,
  lightDir: [-0.55, -0.5, 0.67],
  angle: [{ t: 0, deg: 0 }, { t: durationFrames, deg: 360 }],
  parts: [
    // Stack 0: chassis + side/front/back attachments (5 parts sorting by 3D depth)
    {
      type: 'poly',
      name: 'body',
      center: [0, 8, 0],
      ...polyBox(150, 96, 86),
      paint: ['#334155', '#475569', '#64748B', '#1E293B', '#3B4B66', '#3B4B66'],
      shade: '#162032',
      stack: 0,
    },
    {
      type: 'lathe',
      name: 'wheelL',
      center: [-89, 28, 0],
      profile: [[-13, 24], [-10, 32], [10, 32], [13, 24]],
      side: '#1E293B',
      ends: {
        neg: { paint: '#94A3B8', recess: { radius: 13, depth: 7, wall: '#334155', base: '#0F172A' } },
        pos: { paint: '#475569' },
      },
      stack: 0,
    },
    {
      type: 'lathe',
      name: 'wheelR',
      center: [89, 28, 0],
      profile: [[-13, 24], [-10, 32], [10, 32], [13, 24]],
      side: '#1E293B',
      ends: {
        pos: { paint: '#94A3B8', recess: { radius: 13, depth: 7, wall: '#334155', base: '#0F172A' } },
        neg: { paint: '#475569' },
      },
      stack: 0,
    },
    {
      type: 'extrude',
      name: 'badge',
      center: [-8, 8, 51],
      depth: 14,
      outline:
        'M -38 -24 L 24 -24 A 14 14 0 0 1 38 -10 L 38 10 A 14 14 0 0 1 24 24 L -38 24 Z ' +
        'M -22 -11 L -22 11 L 4 11 A 11 11 0 0 0 4 -11 Z',
      face: '#E2E8F0',
      edge: '#475569',
      edgeLit: '#94A3B8',
      edgeLitOpacity: 55,
      stack: 0,
    },
    {
      type: 'lathe',
      name: 'nozzle',
      center: [0, 8, -56],
      rotation: [0, 90, 0],
      profile: [[-12, 26], [12, 12]],
      side: '#6366F1',
      ends: { pos: { paint: '#A5B4FC' }, neg: { paint: '#3730A3' } },
      stack: 0,
    },
    // Stack 1: top-deck controls (3 parts sorting against each other by depth, always above chassis top under +22° tilt)
    {
      type: 'lathe',
      name: 'knobL',
      center: [-38, -53, -20],
      rotation: [0, 0, -90],
      profile: [[-12, 18], [12, 13]],
      side: '#0EA5E9',
      ends: { pos: { paint: '#7DD3FC' }, neg: { paint: '#0369A1' } },
      stack: 1,
    },
    {
      type: 'lathe',
      name: 'dial',
      center: [-38, -53, 20],
      rotation: [0, 0, -90],
      profile: [[-12, 15], [12, 18]],
      innerProfile: [[-7, 10], [12, 13]],
      side: '#14B8A6',
      innerPaint: '#0F766E',
      innerBase: '#115E59',
      ends: { pos: { paint: '#5EEAD4' }, neg: { paint: '#0F766E' } },
      stack: 1,
    },
    {
      type: 'sphere',
      name: 'button',
      center: [36, -61, 4],
      radius: 20,
      paint: '#F97316',
      shade: '#9A3412',
      highlight: '#FFF7ED',
      highlightOpacity: 62,
      stack: 1,
    },
  ],
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${turntableSvg(pyramidSpec)}
  ${turntableSvg(machineSpec)}
</svg>`;

const mgr = new CompositionManager(ROOT, ROOT);
await mgr.createComposition({ id: sceneId, name: '3D Engine Demo', width, height, fps, durationFrames, background: '#15171c' });
await mgr.importSvgAsset({ sceneId, assetId: 'demo', svgContent: svg });
await mgr.applyPrimitive(sceneId, pyramidSpec);
await mgr.applyPrimitive(sceneId, machineSpec);
const compiled = await mgr.compile(sceneId);
const h = compiled.health;
console.log(`Built "${sceneId}" → layers: ${h.layerCount}, kf: ${h.totalKeyframes}, maxPerTrack: ${h.maxKeyframesPerTrack}, density: ${h.maxKeyframeDensityPerSec}/s, antiBake: ${h.antiBakePass}, mobile: ${h.mobileReady}`);

// Copy compiled playable bundle into techniques/3d-engine/demo/
const srcDir = path.join(ROOT, 'scenes', sceneId);
for (const file of ['animation.json', 'comp.json', 'filters.json']) {
  const from = path.join(srcDir, file);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(__dirname, file));
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>3D engine – demo</title>
<meta name="motion-studio-kind" content="lottie">
<script type="importmap">{"imports":{"lottie-web":"/vendor/lottie-web/build/player/esm/lottie_svg.min.js","@studio/":"/runtime/"}}</script>
<link rel="stylesheet" href="/runtime/stage.css">
<style>
  html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
  #stage { --stage-bg: #15171c; background: var(--stage-bg); }
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
    id: 'demo-3d-engine',
    container: document.getElementById('lottie-root'),
    animationUrl: './animation.json',
    filtersUrl: './filters.json',
    compUrl: './comp.json',
  });
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html, 'utf8');
console.log(`Copied playable demo → ${__dirname}`);
