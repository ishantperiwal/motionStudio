// Generates the "untitled" gold coin toss composition matching references/in-11211327/source.webm
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, PROJECT } from '../server/project.mjs';

const ease = JSON.parse(fs.readFileSync(path.join(ROOT, 'tokens', 'motion.json'), 'utf8')).ease;
// a keyframe track from [frame, value, ease to the next stop] (ease: a token name, a bezier, or 'hold')
const tr = (stops) => ({
  a: 1,
  k: stops.map(([t, v, e], j) => {
    const s = Array.isArray(v) ? v : [v];
    const next = stops[j + 1];
    if (!next) return { t, s };
    if (e === 'hold') return { t, s, h: 1 };
    const [x1, y1, x2, y2] = Array.isArray(e) ? e : ease[e];
    return { t, s, e: Array.isArray(next[1]) ? next[1] : [next[1]], o: { x: s.map(() => x1), y: s.map(() => y1) }, i: { x: s.map(() => x2), y: s.map(() => y2) } };
  }),
});
const sc = (v) => [v, v, 100];

const { CompositionManager, geometry: g } = await import(pathToFileURL(path.join(ROOT, 'dist', 'compiler', 'index.js')).href);
const mgr = new CompositionManager(PROJECT, ROOT);

const id = 'untitled';
const width = 512;
const height = 512;
const fps = 60;
const coinEnd = 116; // the coin has left the frame

// Morph sequence after the coin (references/in-11220800): one rainbow blob, star → clover → oval → flower →
// pentagon → triangle → star. Each pose holds 30f (0.5s), each morph takes 27f (0.45s).
const morphIn = 24;
const morphHold = 30;
const morphDur = 27;
const morphEnd = coinEnd + morphIn + 6 * (morphHold + morphDur) + 10; // the last pose (star) has landed

// Glass tiles after the morph (references/in-11220804): the star shrinks away, six tiles burst into a ring over a
// blue glow, the view pushes through the ring, a field of tiles drifts out at different depths (one whips past),
// then the field pulls away and one tile settles in the centre with a glow pulse.
const tilesIn = morphEnd + 4;        // ring bursts out while the star shrinks
const pushAt = tilesIn + 64;         // view pushes through the ring
const fieldIn = pushAt + 20;         // field emerges behind the ring
const gatherAt = fieldIn + 112;      // field pulls away, hero settles
const durationFrames = gatherAt + 120;

const cx = 256;
const cy = 256;
const r = 106;
const rInner = 76;
const thickness = 16;

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

const edgeBandX = (degLeft, degRight, color) => {
  const x0 = cx + r * Math.cos((degLeft * Math.PI) / 180);
  const x1 = cx + r * Math.cos((degRight * Math.PI) / 180);
  const left = Math.min(x0, x1);
  const w = Math.abs(x1 - x0);
  return `<rect x="${left.toFixed(2)}" y="${cy - thickness / 2}" width="${w.toFixed(2)}" height="${thickness}" fill="${color}" />`;
};

// ₹ emblem (Affinity export, 24x36 artboard), centred on the coin at 2.4x (~57x86px)
const rupeePath = 'M1241.128,1069.834L1238.686,1073.447L1233.608,1073.447C1234.129,1074.033 1234.56,1074.701 1234.902,1075.449C1235.244,1076.198 1235.488,1077.061 1235.634,1078.037L1241.128,1078.037L1238.686,1081.65L1235.634,1081.65C1235.439,1082.839 1235.052,1083.933 1234.475,1084.934C1233.897,1085.935 1233.136,1086.798 1232.192,1087.522C1231.248,1088.246 1230.129,1088.812 1228.835,1089.219C1227.541,1089.626 1226.088,1089.829 1224.477,1089.829L1239.321,1105.625L1232.827,1105.625L1218.496,1090.22L1218.496,1086.606L1222.085,1086.606C1223.208,1086.606 1224.249,1086.501 1225.21,1086.289C1226.17,1086.078 1227.024,1085.76 1227.773,1085.337C1228.522,1084.914 1229.144,1084.397 1229.641,1083.787C1230.137,1083.176 1230.483,1082.464 1230.678,1081.65L1217.275,1081.65L1219.716,1078.037L1230.654,1078.037C1230.28,1076.637 1229.478,1075.523 1228.249,1074.692C1227.02,1073.862 1225.348,1073.447 1223.232,1073.447L1217.275,1073.447L1219.716,1069.834L1241.128,1069.834Z';
const emblemSvg = (color) => `
  <g transform="translate(${cx}, ${cy}) scale(2.4) translate(-1229.2, -1087.73)">
    <path d="${rupeePath}" fill="${color}" />
  </g>
`;

// Morph poses, constructed like a design tool would (geometry kit: straight lines, true arcs, booleans,
// filleted corners), centred on the stage and area-matched to a circle of radius blobR. shapeMorph matches
// their vertices exactly, so the poses keep their geometry while they morph.
const blobR = 70;
const pivot = [cx, cy];
const blobShapes = {
  // ✦: four tips joined by concave arcs
  star: () => g.star(cx, cy, 100, 0, 4, { sideDepth: 20, cornerRadius: 3 }),
  // four circles on the diagonals around a core, notches filleted
  clover: () => g.roundCorners(
    g.union(...[45, 135, 225, 315].map((a) => g.circle(cx + 48 * Math.cos((a * Math.PI) / 180), cy + 48 * Math.sin((a * Math.PI) / 180), 52)), g.circle(cx, cy, 55)),
    10,
  ),
  oval: () => g.ellipse(cx, cy, 100, 66, -26),
  // eight petal circles around a core
  flower: () => g.roundCorners(
    g.union(...Array.from({ length: 8 }, (_, k) => g.circle(cx + 72 * Math.cos((k * Math.PI) / 4 - Math.PI / 2), cy + 72 * Math.sin((k * Math.PI) / 4 - Math.PI / 2), 30)), g.circle(cx, cy, 74)),
    6,
  ),
  pentagon: () => g.polygon(cx, cy, 100, 5, { cornerRadius: 16 }),
  triangle: () => g.polygon(cx, cy, 100, 3, { cornerRadius: 18 }),
};
const blobScale = { star: 0.85 }; // matched area makes the concave ✦ look oversized; trim it
const blobShape = (name) => g.scaleToArea(blobShapes[name](), Math.PI * ((blobScale[name] ?? 1) * blobR) ** 2, pivot);
const blobPath = (name) => g.toLottiePath(blobShape(name));
// three gradient stops per pose (top-left → bottom-right), sampled from the reference's colours
const hex = (h) => [1, 3, 5].map((j) => +(parseInt(h.slice(j, j + 2), 16) / 255).toFixed(4));
const grad = (a, b, c) => [0, ...hex(a), 0.5, ...hex(b), 1, ...hex(c)];
const poseHex = {
  star: ['#FFC21A', '#2F80ED', '#1FB866'],
  clover: ['#8E5CF6', '#F2456A', '#FF6A2B'],
  oval: ['#FF5A3C', '#FF9A1F', '#FFD60A'],
  flower: ['#B8E35A', '#2DBE60', '#139E73'],
  pentagon: ['#2DBE60', '#16A39A', '#2F80ED'],
  triangle: ['#FFD60A', '#9BCB3C', '#1FB866'],
};
const poseNames = ['star', 'clover', 'oval', 'flower', 'pentagon', 'triangle'];
const blobPoses = [...poseNames, 'star'].map((name) => [name, grad(...poseHex[name])]);

// Glass tile, drawn at the stage centre (the layers move it): a dark body, an iridescent rim (a ring filled with a
// gradient: Lottie strokes can't take one), a soft sheen across the top, and one of the morph shapes as its glyph.
const T = 64;
const tileBody = g.rect(cx - T / 2, cy - T / 2, T, T, 16);
const tileRim = g.subtract(g.rect(cx - T / 2, cy - T / 2, T, T, 16), g.rect(cx - T / 2 + 2.2, cy - T / 2 + 2.2, T - 4.4, T - 4.4, 13.8));
const tileSheen = g.intersect(g.rect(cx - T / 2 + 2.2, cy - T / 2 + 2.2, T - 4.4, T - 4.4, 13.8), g.ellipse(cx, cy - T * 0.62, T * 0.72, T * 0.42));
const glyphPath = (name) => g.toSvgPath(g.scaleToArea(blobShapes[name](), Math.PI * ((blobScale[name] ?? 1) * 15) ** 2, pivot));
const tileSvg = (id, glyph, rim) => `
  <g id="${id}">
    <path d="${g.toSvgPath(tileBody)}" fill="url(#tileBody)" />
    <path d="${g.toSvgPath(tileSheen)}" fill="#FFFFFF" opacity="0.07" />
    <path d="${g.toSvgPath(tileRim)}" fill="url(#rim-${rim})" fill-rule="evenodd" />
    <path d="${glyphPath(glyph)}" fill="url(#glyph-${glyph})" />
  </g>`;
const tileDefs = `
    <linearGradient id="tileBody" gradientUnits="userSpaceOnUse" x1="${cx}" y1="${cy - T / 2}" x2="${cx}" y2="${cy + T / 2}">
      <stop offset="0%" stop-color="#231C3A" />
      <stop offset="100%" stop-color="#0A0912" />
    </linearGradient>
    <linearGradient id="rim-cool" gradientUnits="userSpaceOnUse" x1="${cx - T / 2}" y1="${cy - T / 2}" x2="${cx + T / 2}" y2="${cy + T / 2}">
      <stop offset="0%" stop-color="#E4E9FF" />
      <stop offset="45%" stop-color="#8B7BFF" />
      <stop offset="100%" stop-color="#3B6BFF" />
    </linearGradient>
    <linearGradient id="rim-warm" gradientUnits="userSpaceOnUse" x1="${cx - T / 2}" y1="${cy + T / 2}" x2="${cx + T / 2}" y2="${cy - T / 2}">
      <stop offset="0%" stop-color="#FFB27A" />
      <stop offset="50%" stop-color="#FF6A3D" />
      <stop offset="100%" stop-color="#B14CFF" />
    </linearGradient>
    ${poseNames.map((name) => `<linearGradient id="glyph-${name}" gradientUnits="userSpaceOnUse" x1="${cx - 16}" y1="${cy - 16}" x2="${cx + 16}" y2="${cy + 16}">
      ${poseHex[name].map((c, j) => `<stop offset="${j * 50}%" stop-color="${c}" />`).join('\n      ')}
    </linearGradient>`).join('\n    ')}
    <radialGradient id="tileGlowFill" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="120">
      <stop offset="0%" stop-color="#5B6BFF" />
      <stop offset="100%" stop-color="#4B2BD9" />
    </radialGradient>
    <filter id="tileGlowBlur" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="34" />
    </filter>`;
// ring: six tiles, one per morph shape; field: eight tiles at different depths ([angle°, out radius, depth, turn°])
const ringR = 118;
const field = [
  [-100, 0, 1.25, -18],   // the hero: ends in the centre
  [-150, 200, 1.1, -10],
  [-40, 190, 1.15, 9],
  [15, 210, 0.95, -7],
  [75, 175, 1.2, 12],
  [130, 200, 1.0, -12],
  [175, 215, 0.85, 6],
  [40, 0, 1.0, 14],       // whips past the camera
];

// Cosine-spaced 3D cylinder milled ribs shared across BOTH coin-rim (chords) and coin-edge (bridge)
const rimRibs = [];
const edgeRibs = [];
for (let i = 1; i <= 17; i++) {
  const phi = (i / 18) * Math.PI;
  const dx = (r - 2) * Math.cos(phi);
  const xk = cx + dx;
  const halfChord = Math.sqrt(Math.max(0, r * r - dx * dx));
  rimRibs.push(
    `<line x1="${xk.toFixed(2)}" y1="${(cy - halfChord).toFixed(2)}" x2="${xk.toFixed(2)}" y2="${(cy + halfChord).toFixed(2)}" stroke="#78350F" stroke-width="2" opacity="0.32" />`,
  );
  edgeRibs.push(
    `<line x1="${xk.toFixed(2)}" y1="${(cy - thickness / 2).toFixed(2)}" x2="${xk.toFixed(2)}" y2="${(cy + thickness / 2).toFixed(2)}" stroke="#78350F" stroke-width="2" opacity="0.32" />`,
  );
}

const frontDx = 2.8;
const frontDy = 3.2;
const rFrontFace = +(r - Math.hypot(frontDx, frontDy)).toFixed(2);
const backDx = 2.0;
const backDy = 2.4;
const rBackFace = +(r - Math.hypot(backDx, backDy)).toFixed(2);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="rimMetal" gradientUnits="userSpaceOnUse" x1="${cx - r}" y1="0" x2="${cx + r}" y2="0">
      <stop offset="0%" stop-color="#EE960C" />
      <stop offset="35%" stop-color="#D47308" />
      <stop offset="72%" stop-color="#B45309" />
      <stop offset="100%" stop-color="#8A3B06" />
    </linearGradient>
    <linearGradient id="frontChamfer" gradientUnits="userSpaceOnUse" x1="${cx - r}" y1="${cy - r}" x2="${cx + r}" y2="${cy + r}">
      <stop offset="0%" stop-color="#FFFBEB" />
      <stop offset="45%" stop-color="#FEF08A" />
      <stop offset="100%" stop-color="#FDE047" />
    </linearGradient>
    <linearGradient id="frontFace" gradientUnits="userSpaceOnUse" x1="${cx - r}" y1="${cy - r}" x2="${cx + r}" y2="${cy + r}">
      <stop offset="0%" stop-color="#FDE047" />
      <stop offset="65%" stop-color="#FACC15" />
      <stop offset="100%" stop-color="#F4B810" />
    </linearGradient>
    <linearGradient id="backChamfer" gradientUnits="userSpaceOnUse" x1="${cx - r}" y1="${cy - r}" x2="${cx + r}" y2="${cy + r}">
      <stop offset="0%" stop-color="#FDE68A" />
      <stop offset="100%" stop-color="#F5B014" />
    </linearGradient>
    <linearGradient id="backFace" gradientUnits="userSpaceOnUse" x1="${cx - r}" y1="${cy - r}" x2="${cx + r}" y2="${cy + r}">
      <stop offset="0%" stop-color="#F5B014" />
      <stop offset="100%" stop-color="#E48E0A" />
    </linearGradient>
    <linearGradient id="frontBevel" gradientUnits="userSpaceOnUse" x1="${cx - rInner}" y1="${cy - rInner}" x2="${cx + rInner}" y2="${cy + rInner}">
      <stop offset="0%" stop-color="#C2650B" />
      <stop offset="100%" stop-color="#F59E0B" />
    </linearGradient>
    <linearGradient id="frontDish" gradientUnits="userSpaceOnUse" x1="${cx - rInner}" y1="${cy - rInner}" x2="${cx + rInner}" y2="${cy + rInner}">
      <stop offset="0%" stop-color="#DD7510" />
      <stop offset="100%" stop-color="#F3921F" />
    </linearGradient>
    <linearGradient id="backBevel" gradientUnits="userSpaceOnUse" x1="${cx - rInner}" y1="${cy - rInner}" x2="${cx + rInner}" y2="${cy + rInner}">
      <stop offset="0%" stop-color="#AC5008" />
      <stop offset="100%" stop-color="#DF7B10" />
    </linearGradient>
    <linearGradient id="backDish" gradientUnits="userSpaceOnUse" x1="${cx - rInner}" y1="${cy - rInner}" x2="${cx + rInner}" y2="${cy + rInner}">
      <stop offset="0%" stop-color="#CC620C" />
      <stop offset="100%" stop-color="#E37C16" />
    </linearGradient>
    <linearGradient id="morphGrad" gradientUnits="userSpaceOnUse" x1="${cx - blobR}" y1="${cy - blobR}" x2="${cx + blobR}" y2="${cy + blobR}">
      <stop offset="0%" stop-color="#FFC21A" />
      <stop offset="50%" stop-color="#2F80ED" />
      <stop offset="100%" stop-color="#1FB866" />
    </linearGradient>${tileDefs}
  </defs>
  <g id="morph-blob">
    <path d="${g.toSvgPath(blobShape('star'))}" fill="url(#morphGrad)" />
  </g>
  <g id="coin-rim">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#rimMetal)" />
    ${rimRibs.join('\n    ')}
  </g>
  <g id="coin-edge">
    <rect x="${cx - r}" y="${cy - thickness / 2}" width="${r * 2}" height="${thickness}" rx="0" fill="url(#rimMetal)" />
    ${edgeRibs.join('\n    ')}
  </g>
  <g id="coin-back">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#backChamfer)" />
    <circle cx="${cx + backDx}" cy="${cy + backDy}" r="${rBackFace}" fill="url(#backFace)" />
    <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="url(#backBevel)" />
  </g>
  <g id="coin-back-dish">
    <circle cx="${cx}" cy="${cy}" r="${rInner - 6}" fill="url(#backDish)" />
    <g transform="translate(2, 2.5)" opacity="0.35">
      ${emblemSvg('#9A4406')}
    </g>
    ${emblemSvg('#FDE68A')}
  </g>
  <g id="coin-front">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#frontChamfer)" />
    <circle cx="${cx + frontDx}" cy="${cy + frontDy}" r="${rFrontFace}" fill="url(#frontFace)" />
    <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="url(#frontBevel)" />
  </g>
  <g id="coin-front-dish">
    <circle cx="${cx}" cy="${cy}" r="${rInner - 6}" fill="url(#frontDish)" />
    <g transform="translate(2, 2.5)" opacity="0.35">
      ${emblemSvg('#B95B08')}
    </g>
    ${emblemSvg('#FEF3C7')}
  </g>
  <g id="coin-sheen">
    <path d="M ${cx - 130} ${cy + 90} L ${cx + 90} ${cy - 130} L ${cx + 124} ${cy - 96} L ${cx - 96} ${cy + 124} Z" fill="#FEFCE8" opacity="0.68" />
    <path d="M ${cx - 82} ${cy + 138} L ${cx + 138} ${cy - 82} L ${cx + 152} ${cy - 68} L ${cx - 68} ${cy + 152} Z" fill="#FEFCE8" opacity="0.68" />
  </g>
  <g id="coin-front-matte">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" />
  </g>
  <g id="tile-glow">
    <circle cx="${cx}" cy="${cy}" r="120" fill="url(#tileGlowFill)" filter="url(#tileGlowBlur)" />
  </g>${field.map((_, i) => i).slice(1).concat(0).map((i) => tileSvg(`field-tile-${i}`, i === 0 ? 'star' : poseNames[i % 6], i % 2 ? 'warm' : 'cool')).join('')}${poseNames.map((name, k) => tileSvg(`ring-tile-${k}`, name, 'cool')).join('')}
</svg>`;

await mgr.createComposition({ id, name: id, width, height, fps, durationFrames, background: '#3C176E' });
await mgr.importSvgAsset({ sceneId: id, assetId: 'coin', svgContent: svg });
await mgr.applyPrimitive(id, {
  kind: 'faux3DFlip',
  frontLayerId: 'coin-front',
  backLayerId: 'coin-back',
  rimLayerId: 'coin-rim',
  edgeLayerId: 'coin-edge',
  axis: 'x',
  turns: 1,
  startFrame: 6,
  duration: 110,
  thicknessPx: thickness,
  liftPx: 0,
  tiltDeg: 0,
  edgeThicknessScale: 100,
});

const cosClose = { o: { x: [0.36, 0.36, 0.36], y: [0, 0, 0] }, i: { x: [0.66, 0.66, 0.66], y: [0.44, 0.44, 0.44] } };
const cosOpen = { o: { x: [0.34, 0.34, 0.34], y: [0.56, 0.56, 0.56] }, i: { x: [0.64, 0.64, 0.64], y: [1, 1, 1] } };
const sinRise1 = { o: { x: [0.34], y: [0.56] }, i: { x: [0.64], y: [1] } };
const sinFall1 = { o: { x: [0.36], y: [0] }, i: { x: [0.66], y: [0.44] } };
const halfT = thickness / 2;

const doc = await mgr.readAnimation(id);
const frontLayer = doc.layers.find((l) => (l.ln ?? l.nm) === 'coin-front');
const backLayer = doc.layers.find((l) => (l.ln ?? l.nm) === 'coin-back');

// 1. Rig: parabolic toss from off-screen bottom (650) -> apex hang (246 at f58) -> off-screen bottom (650)
//    plus continuous Z-rotation (+32° -> +24° -> +4° -> -34° -> -42°)
await mgr.patchLayerAst(id, {
  layerId: 'coin-front.rig',
  position: {
    s: true,
    x: { a: 0, k: cx },
    y: {
      a: 1,
      k: [
        { t: 0, s: [650], h: 1 },
        { t: 6, s: [650], e: [246], o: { x: [0.16], y: [0.88] }, i: { x: [0.32], y: [1] } },
        { t: 58, s: [246], e: [650], o: { x: [0.58], y: [0] }, i: { x: [0.84], y: [0.28] } },
        { t: 116, s: [650] },
      ],
    },
  },
  rotation: {
    a: 1,
    k: [
      { t: 6, s: [32], e: [24], o: { x: [0.33], y: [0.5] }, i: { x: [0.67], y: [1] } },
      { t: 32, s: [24], e: [4], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } },
      { t: 58, s: [4], e: [-34], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } },
      { t: 96, s: [-34], e: [-42], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } },
      { t: 116, s: [-42] },
    ],
  },
});

// 2. Pitch-flip timings: crossings at f32 (back -> front) and f96 (front -> back) for 64-frame hero apex
const faceScaleK = [
  { t: 6, s: [100, 100, 100], e: [100, 0.0001, 100], ...cosClose },
  { t: 32, s: [100, 0.0001, 100], e: [100, 100, 100], ...cosOpen },
  { t: 58, s: [100, 100, 100], e: [100, 0.0001, 100], ...cosClose },
  { t: 96, s: [100, 0.0001, 100], e: [100, 100, 100], ...cosOpen },
  { t: 116, s: [100, 100, 100] },
];

await mgr.patchLayerAst(id, {
  layerId: 'coin-back',
  scale: { a: 1, k: faceScaleK },
  opacity: { a: 1, k: [{ t: 6, s: [100], h: 1 }, { t: 32, s: [0], h: 1 }, { t: 96, s: [100], h: 1 }] },
  position: {
    s: true,
    x: { a: 0, k: 0 },
    y: {
      a: 1,
      k: [
        { t: 6, s: [0], e: [halfT], ...sinRise1 },
        { t: 32, s: [halfT], e: [0], ...sinFall1 },
        { t: 58, s: [0], e: [-halfT], ...sinRise1 },
        { t: 96, s: [-halfT], e: [0], ...sinFall1 },
        { t: 116, s: [0] },
      ],
    },
  },
});

await mgr.patchLayerAst(id, {
  layerId: 'coin-front',
  scale: { a: 1, k: faceScaleK },
  opacity: { a: 1, k: [{ t: 6, s: [0], h: 1 }, { t: 32, s: [100], h: 1 }, { t: 96, s: [0], h: 1 }] },
  position: {
    s: true,
    x: { a: 0, k: 0 },
    y: {
      a: 1,
      k: [
        { t: 6, s: [0], e: [-halfT], ...sinRise1 },
        { t: 32, s: [-halfT], e: [0], ...sinFall1 },
        { t: 58, s: [0], e: [halfT], ...sinRise1 },
        { t: 96, s: [halfT], e: [0], ...sinFall1 },
        { t: 116, s: [0] },
      ],
    },
  },
});

await mgr.patchLayerAst(id, {
  layerId: 'coin-rim',
  scale: { a: 1, k: faceScaleK },
  position: {
    s: true,
    x: { a: 0, k: 0 },
    y: {
      a: 1,
      k: [
        { t: 6, s: [0], e: [-halfT], ...sinRise1 },
        { t: 32, s: [-halfT], h: 1 },
        { t: 32.02, s: [halfT], e: [0], ...sinFall1 },
        { t: 58, s: [0], e: [-halfT], ...sinRise1 },
        { t: 96, s: [-halfT], h: 1 },
        { t: 96.02, s: [halfT], e: [0], ...sinFall1 },
        { t: 116, s: [0] },
      ],
    },
  },
});

await mgr.patchLayerAst(id, {
  layerId: 'coin-edge',
  scale: {
    a: 1,
    k: [
      { t: 6, s: [100, 0.01, 100], e: [100, 100, 100], o: { x: [0.34, 0.34, 0.34], y: [0.56, 0.56, 0.56] }, i: { x: [0.64, 0.64, 0.64], y: [1, 1, 1] } },
      { t: 32, s: [100, 100, 100], e: [100, 0.01, 100], o: { x: [0.36, 0.36, 0.36], y: [0, 0, 0] }, i: { x: [0.66, 0.66, 0.66], y: [0.44, 0.44, 0.44] } },
      { t: 58, s: [100, 0.01, 100], e: [100, 100, 100], o: { x: [0.34, 0.34, 0.34], y: [0.56, 0.56, 0.56] }, i: { x: [0.64, 0.64, 0.64], y: [1, 1, 1] } },
      { t: 96, s: [100, 100, 100], e: [100, 0.01, 100], o: { x: [0.36, 0.36, 0.36], y: [0, 0, 0] }, i: { x: [0.66, 0.66, 0.66], y: [0.44, 0.44, 0.44] } },
      { t: 116, s: [100, 0.01, 100] },
    ],
  },
});

// 3. Inner-cavity parallax: dish floor shifts ±6px opposite to exterior coin-rim side
//    (Lottie parenting does NOT inherit opacity, so copy hold opacity keyframes onto both dish layers!)
if (backLayer) {
  await mgr.patchLayerAst(id, {
    layerId: 'coin-back-dish',
    parent: backLayer.ind,
    opacity: { a: 1, k: [{ t: 0, s: [100], h: 1 }, { t: 32, s: [0], h: 1 }, { t: 96, s: [100], h: 1 }] },
    position: {
      s: true,
      x: { a: 0, k: cx },
      y: {
        a: 1,
        k: [
          { t: 6, s: [cy], e: [cy - 6], ...sinRise1 },
          { t: 32, s: [cy - 6], h: 1 },
          { t: 96, s: [cy + 6], e: [cy], ...sinFall1 },
          { t: 116, s: [cy] },
        ],
      },
    },
  });
}

if (frontLayer) {
  await mgr.patchLayerAst(id, {
    layerId: 'coin-front-dish',
    parent: frontLayer.ind,
    opacity: { a: 1, k: [{ t: 0, s: [0], h: 1 }, { t: 32, s: [100], h: 1 }, { t: 96, s: [0], h: 1 }] },
    position: {
      s: true,
      x: { a: 0, k: cx },
      y: {
        a: 1,
        k: [
          { t: 32, s: [cy + 6], e: [cy], ...sinFall1 },
          { t: 58, s: [cy], e: [cy - 6], ...sinRise1 },
          { t: 96, s: [cy - 6] },
        ],
      },
    },
  });
}

// 4. Diagonal sheen alpha-matted onto coin-front during hero apex hang (f42 -> f78)
if (frontLayer) {
  await mgr.patchLayerAst(id, {
    layerId: 'coin-front-matte',
    parent: frontLayer.ind,
    td: 1,
    opacity: { a: 1, k: [{ t: 0, s: [0], h: 1 }, { t: 32, s: [100], h: 1 }, { t: 96, s: [0], h: 1 }] },
    position: { s: true, x: { a: 0, k: cx }, y: { a: 0, k: cy } },
  });
  await mgr.patchLayerAst(id, {
    layerId: 'coin-sheen',
    parent: frontLayer.ind,
    tt: 1,
    opacity: { a: 1, k: [{ t: 0, s: [0], h: 1 }, { t: 32, s: [100], h: 1 }, { t: 96, s: [0], h: 1 }] },
    position: {
      s: true,
      x: {
        a: 1,
        k: [
          { t: 40, s: [cx - 180], e: [cx + 180], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } },
          { t: 78, s: [cx + 180] },
        ],
      },
      y: {
        a: 1,
        k: [
          { t: 40, s: [cy - 180], e: [cy + 180], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } },
          { t: 78, s: [cy + 180] },
        ],
      },
    },
  });
}

// 5. Morph sequence: the blob pops in as the coin leaves, then morphs pose to pose while turning slowly
const morphStart = coinEnd + morphIn;
const morphStops = [{ t: coinEnd, path: blobPath('star'), colors: blobPoses[0][1], hold: true }];
blobPoses.slice(1).forEach(([name, colors], k) => {
  const t0 = morphStart + k * (morphHold + morphDur) + morphHold;
  morphStops.push({ t: t0, path: morphStops.at(-1).path, colors: morphStops.at(-1).colors, ease: 'move' });
  morphStops.push({ t: t0 + morphDur, path: blobPath(name), colors, hold: k < blobPoses.length - 2 });
});
await mgr.applyPrimitive(id, { kind: 'shapeMorph', layerId: 'morph-blob', stops: morphStops });
await mgr.patchLayerAst(id, {
  layerId: 'morph-blob',
  ip: coinEnd,
  op: morphEnd + 22,
  // pops in with the coin's exit; once the last star lands it shrinks away (exit: speeds up as it goes)
  scale: tr([[coinEnd, sc(0), 'overshoot'], [morphStart, sc(100), 'hold'], [morphEnd - 2, sc(100), 'exit'], [morphEnd + 20, sc(0)]]),
  // one continuous turn: eases in with the pop, then keeps drifting so the holds never freeze
  rotation: {
    a: 1,
    k: [
      { t: coinEnd, s: [-60], e: [300], o: { x: [0.2], y: [0.5] }, i: { x: [0.6], y: [1] } },
      { t: morphEnd + 20, s: [300] },
    ],
  },
});

// 6. Glass tiles. Every move uses the motion tokens; tiles that move together share an ease and a duration.
const at = (r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
const xy = (stops) => ({
  s: true,
  x: tr(stops.map(([t, p, e]) => [t, p[0], e])),
  y: tr(stops.map(([t, p, e]) => [t, p[1], e])),
});

// the glow: blooms under the ring, swells and fades as the view pushes through, then pulses under the hero
await mgr.patchLayerAst(id, {
  layerId: 'tile-glow',
  ip: tilesIn,
  opacity: tr([[tilesIn, 0, 'settle'], [tilesIn + 30, 90, 'move'], [pushAt, 80, 'exit'], [pushAt + 36, 0, 'hold'], [gatherAt + 30, 0, 'settle'], [gatherAt + 56, 100, 'move'], [gatherAt + 110, 45]]),
  scale: tr([[tilesIn, sc(40), 'settle'], [tilesIn + 34, sc(100), 'move'], [pushAt, sc(110), 'exit'], [pushAt + 36, sc(260), 'hold'], [gatherAt + 30, sc(50), 'settle'], [gatherAt + 60, sc(110), 'move'], [gatherAt + 110, sc(95)]]),
});

// the ring: each tile bursts from the centre to its place (2f stagger), turns a little while it holds, then flies
// outward past the camera as the view pushes through
for (const [k] of poseNames.entries()) {
  const deg = -90 + k * 60, t0 = tilesIn + 2 * k, turn = k % 2 ? -10 : 10;
  await mgr.patchLayerAst(id, {
    layerId: `ring-tile-${k}`,
    ip: t0,
    op: pushAt + 38,
    position: xy([[t0, [cx, cy], 'settle'], [t0 + 28, at(ringR, deg), 'move'], [pushAt, at(ringR + 6, deg), 'exit'], [pushAt + 36, at(430, deg)]]),
    scale: tr([[t0, sc(0), 'overshoot'], [t0 + 28, sc(100), 'move'], [pushAt, sc(104), 'exit'], [pushAt + 36, sc(250)]]),
    rotation: tr([[t0, turn * 2, 'settle'], [t0 + 28, 0, 'move'], [pushAt + 36, -turn]]),
  });
}

// the field: tiles grow out of the centre behind the ring and drift outward, nearer ones bigger and faster (3f
// stagger); then they pull away into the centre and fade, except the hero, which turns upright and settles
for (const [i, [deg, rOut, depth, turn]] of field.entries()) {
  const t0 = fieldIn + 3 * i;
  const id_ = `field-tile-${i}`;
  if (i === 7) {
    // swoops from just right of centre past the bottom-right, growing huge: flying past the camera (accelerates)
    const w0 = fieldIn + 40;
    await mgr.patchLayerAst(id, {
      layerId: id_, ip: w0, op: w0 + 44,
      position: xy([[w0, [cx + 30, cy + 10], 'exit'], [w0 + 42, [cx + 330, cy + 360]]]),
      scale: tr([[w0, sc(30), 'exit'], [w0 + 42, sc(420)]]),
      rotation: tr([[w0, turn, 'exit'], [w0 + 42, -turn]]),
      opacity: tr([[w0, 0, 'settle'], [w0 + 8, 100]]),
    });
    continue;
  }
  if (i === 0) {
    // the hero drifts in near the top, then turns upright and settles in the centre (overshoot: it has character)
    await mgr.patchLayerAst(id, {
      layerId: id_, ip: t0,
      position: xy([[t0, [cx, cy], 'intro'], [gatherAt, at(150, deg), 'move'], [gatherAt + 40, [cx, cy]]]),
      scale: tr([[t0, sc(0), 'intro'], [gatherAt, sc(100 * depth * 0.8), 'overshoot'], [gatherAt + 40, sc(170)]]),
      rotation: tr([[t0, 0, 'intro'], [gatherAt, turn, 'overshoot'], [gatherAt + 40, 0]]),
      opacity: tr([[t0, 0, 'settle'], [t0 + 10, 100]]),
    });
    continue;
  }
  await mgr.patchLayerAst(id, {
    layerId: id_, ip: t0, op: gatherAt + 40,
    position: xy([[t0, [cx, cy], 'intro'], [gatherAt, at(rOut, deg), 'move'], [gatherAt + 36, at(rOut * 0.25, deg)]]),
    scale: tr([[t0, sc(0), 'intro'], [gatherAt, sc(100 * depth), 'move'], [gatherAt + 36, sc(20)]]),
    rotation: tr([[t0, 0, 'intro'], [gatherAt, turn, 'move'], [gatherAt + 36, turn * 2]]),
    opacity: tr([[t0, 0, 'settle'], [t0 + 10, 100, 'hold'], [gatherAt + 10, 100, 'move'], [gatherAt + 36, 0]]),
  });
}

const compiled = await mgr.compile(id);
console.log(`Built "${id}" → layers: ${compiled.health.layerCount}, kf: ${compiled.health.totalKeyframes}, maxPerTrack: ${compiled.health.maxKeyframesPerTrack}, mobile: ${compiled.health.mobileReady}`);
