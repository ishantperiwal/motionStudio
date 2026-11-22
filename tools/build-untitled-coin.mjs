// Generates the "untitled" gold coin toss composition matching references/in-11211327/source.webm
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, PROJECT } from '../server/project.mjs';

const { CompositionManager } = await import(pathToFileURL(path.join(ROOT, 'dist', 'compiler', 'index.js')).href);
const mgr = new CompositionManager(PROJECT, ROOT);

const id = 'untitled';
const width = 512;
const height = 512;
const fps = 60;
const durationFrames = 120;

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

const dollarSvg = (color) => `
  <path d="M ${cx} ${cy - 44} L ${cx} ${cy - 28} M ${cx} ${cy + 28} L ${cx} ${cy + 44}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" />
  <path d="M ${cx + 19} ${cy - 18} C ${cx + 17} ${cy - 31}, ${cx - 19} ${cy - 31}, ${cx - 19} ${cy - 14} C ${cx - 19} ${cy - 1}, ${cx + 20} ${cy + 1}, ${cx + 20} ${cy + 14} C ${cx + 20} ${cy + 31}, ${cx - 18} ${cy + 31}, ${cx - 20} ${cy + 16}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
`;

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
  </defs>
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
    <g transform="translate(${cx}, ${cy}) scale(1, -1) translate(${-cx}, ${-cy})">
      <g transform="translate(2, -2.5)" opacity="0.35">
        ${dollarSvg('#9A4406')}
      </g>
      ${dollarSvg('#FDE68A')}
    </g>
  </g>
  <g id="coin-front">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#frontChamfer)" />
    <circle cx="${cx + frontDx}" cy="${cy + frontDy}" r="${rFrontFace}" fill="url(#frontFace)" />
    <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="url(#frontBevel)" />
  </g>
  <g id="coin-front-dish">
    <circle cx="${cx}" cy="${cy}" r="${rInner - 6}" fill="url(#frontDish)" />
    <g transform="translate(2, 2.5)" opacity="0.35">
      ${dollarSvg('#B95B08')}
    </g>
    ${dollarSvg('#FEF3C7')}
  </g>
  <g id="coin-sheen">
    <path d="M ${cx - 130} ${cy + 90} L ${cx + 90} ${cy - 130} L ${cx + 124} ${cy - 96} L ${cx - 96} ${cy + 124} Z" fill="#FEFCE8" opacity="0.68" />
    <path d="M ${cx - 82} ${cy + 138} L ${cx + 138} ${cy - 82} L ${cx + 152} ${cy - 68} L ${cx - 68} ${cy + 152} Z" fill="#FEFCE8" opacity="0.68" />
  </g>
  <g id="coin-front-matte">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" />
  </g>
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

const compiled = await mgr.compile(id);
console.log(`Built "${id}" → layers: ${compiled.health.layerCount}, kf: ${compiled.health.totalKeyframes}, maxPerTrack: ${compiled.health.maxKeyframesPerTrack}, mobile: ${compiled.health.mobileReady}`);
