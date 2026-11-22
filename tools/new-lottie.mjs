// npm run new-lottie -- <id> [--size 512x512] [--fps 60] [--frames 90]
// Scaffolds a cel-shaded, high-contrast Faux-3D flipping coin Lottie composition
// (periwinkle bezel, white dish, crisp ink strokes, bold $ emblem, jet-black extruded
// 3D rim with curved white specular highlights, subtle cool glow, minimal keyframes).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, PROJECT } from '../server/project.mjs';

const argv = process.argv.slice(2);
const id = argv[0] || 'coin-flip-demo';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
if (!/^[\w.-]+$/.test(id)) {
  console.log('usage: npm run new-lottie -- <id> [--size 512x512] [--fps 60] [--frames 90]');
  process.exit(1);
}
const [width, height] = opt('size', '512x512').split('x').map(Number);
const fps = +opt('fps', 60);
const durationFrames = +opt('frames', 90);

const { CompositionManager } = await import(pathToFileURL(path.join(ROOT, 'dist', 'compiler', 'index.js')).href);
const mgr = new CompositionManager(PROJECT, ROOT);

const cx = Math.round(width / 2);
const cy = Math.round(height / 2);
const r = Math.round(Math.min(width, height) * 0.27); // ~138px
const rInner = Math.round(r * 0.76);                  // ~105px
const rOuter = r + 3;                                 // flush with 6px ink outline
const thickness = 30;

// Helper for circular arc path centered at (cx, cy)
const arcPath = (rad, deg0, deg1) => {
  const a0 = (deg0 * Math.PI) / 180;
  const a1 = (deg1 * Math.PI) / 180;
  const x0 = (cx + rad * Math.cos(a0)).toFixed(2);
  const y0 = (cy + rad * Math.sin(a0)).toFixed(2);
  const x1 = (cx + rad * Math.cos(a1)).toFixed(2);
  const y1 = (cy + rad * Math.sin(a1)).toFixed(2);
  const large = Math.abs(deg1 - deg0) > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${rad} ${rad} 0 ${large} 1 ${x1} ${y1}`;
};

// Helper for solid pie-wedge sector centered at (cx, cy) for full-thickness rim reflections
const wedgePath = (rad, deg0, deg1) => {
  const a0 = (deg0 * Math.PI) / 180;
  const a1 = (deg1 * Math.PI) / 180;
  const x0 = (cx + rad * Math.cos(a0)).toFixed(2);
  const y0 = (cy + rad * Math.sin(a0)).toFixed(2);
  const x1 = (cx + rad * Math.cos(a1)).toFixed(2);
  const y1 = (cy + rad * Math.sin(a1)).toFixed(2);
  const large = Math.abs(deg1 - deg0) > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${rad} ${rad} 0 ${large} 1 ${x1} ${y1} Z`;
};

// Crisp geometric "$" emblem path centered at (cx, cy)
const dollarGroup = `
  <path d="M ${cx} ${cy - 54} L ${cx} ${cy - 36} M ${cx} ${cy + 36} L ${cx} ${cy + 54}" fill="none" stroke="#2D3347" stroke-width="11" stroke-linecap="round" />
  <path d="M ${cx + 24} ${cy - 22} C ${cx + 22} ${cy - 38}, ${cx - 24} ${cy - 38}, ${cx - 24} ${cy - 18} C ${cx - 24} ${cy - 2}, ${cx + 25} ${cy + 0}, ${cx + 25} ${cy + 18} C ${cx + 25} ${cy + 38}, ${cx - 22} ${cy + 38}, ${cx - 25} ${cy + 20}" fill="none" stroke="#2D3347" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" />
`;

// Subtle recessed top-left inner shadow crescent inside the white dish
const dishShadowArc = arcPath(rInner - 4, 185, 295);

// Exact Y-projection helper so coin-edge specular bands match coin-rim arcs to the pixel
const edgeBand = (degTop, degBot) => {
  const y0 = cy + rOuter * Math.sin((degTop * Math.PI) / 180);
  const y1 = cy + rOuter * Math.sin((degBot * Math.PI) / 180);
  return `<rect x="${cx - thickness / 2}" y="${y0.toFixed(2)}" width="${thickness}" height="${(y1 - y0).toFixed(2)}" fill="#FFFFFF" />`;
};

const starterSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="coinGlow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="36" />
    </filter>
  </defs>
  <g id="coin-shadow">
    <ellipse cx="${cx}" cy="${cy + r + 58}" rx="${Math.round(r * 0.72)}" ry="${Math.round(r * 0.13)}" fill="#060812" opacity="0.52" />
  </g>
  <g id="coin-glow" filter="url(#coinGlow)">
    <circle cx="${cx}" cy="${cy}" r="${Math.round(r * 0.84)}" fill="#7B93F8" opacity="0.26" />
  </g>
  <g id="coin-rim">
    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="#07090F" />
    <path d="${wedgePath(rOuter, 205, 245)}" fill="#FFFFFF" />
    <path d="${wedgePath(rOuter, -65, -25)}" fill="#FFFFFF" />
    <path d="${wedgePath(rOuter, 125, 136)}" fill="#FFFFFF" />
    <path d="${wedgePath(rOuter, 142, 150)}" fill="#FFFFFF" />
    <path d="${wedgePath(rOuter, 30, 38)}" fill="#FFFFFF" />
    <path d="${wedgePath(rOuter, 44, 55)}" fill="#FFFFFF" />
  </g>
  <g id="coin-edge">
    <rect x="${cx - thickness / 2}" y="${cy - rOuter}" width="${thickness}" height="${rOuter * 2}" rx="3" fill="#07090F" />
    ${edgeBand(245, 205)}
    ${edgeBand(30, 38)}
    ${edgeBand(44, 55)}
  </g>
  <g id="coin-back">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#B4C3F5" stroke="#07090F" stroke-width="6" />
    <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="#F6F8FF" stroke="#07090F" stroke-width="5" />
    <path d="${dishShadowArc}" fill="none" stroke="#CBD5F5" stroke-width="6" stroke-linecap="round" />
    ${dollarGroup}
  </g>
  <g id="coin-front">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#B4C3F5" stroke="#07090F" stroke-width="6" />
    <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="#F6F8FF" stroke="#07090F" stroke-width="5" />
    <path d="${dishShadowArc}" fill="none" stroke="#CBD5F5" stroke-width="6" stroke-linecap="round" />
    ${dollarGroup}
  </g>
</svg>`;

await mgr.createComposition({ id, name: id, width, height, fps, durationFrames, background: '#1A2240' });
await mgr.importSvgAsset({ sceneId: id, assetId: 'coin', svgContent: starterSvg });
await mgr.applyPrimitive(id, {
  kind: 'faux3DFlip',
  frontLayerId: 'coin-front',
  backLayerId: 'coin-back',
  rimLayerId: 'coin-rim',
  edgeLayerId: 'coin-edge',
  shadowLayerId: 'coin-shadow',
  glowLayerId: 'coin-glow',
  axis: 'y',
  turns: 1,
  startFrame: 6,
  duration: 60,
  thicknessPx: thickness,
  liftPx: 40,
  tiltDeg: -22,
  edgeThicknessScale: 100,
});

const compiled = await mgr.compile(id);
console.log(`Lottie composition "${id}" created → http://localhost:5173/editor/#${id}@0`);
console.log(`  layers: ${compiled.health.layerCount}, totalKeyframes: ${compiled.health.totalKeyframes}, maxPerTrack: ${compiled.health.maxKeyframesPerTrack}, filters: [${compiled.health.filterLayers.join(', ')}]`);
