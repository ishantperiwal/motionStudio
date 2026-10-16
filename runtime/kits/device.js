// Device shell: a phone with real form, built from flat faces in CSS 3D. From the Zapp Account film.
//   1 body      26 stacked rings (~42 px thick) plus solid side walls, so it reads as one surface edge-on
//   2 buttons   extruded pills on the sides: a groove, a closed ring of wall facets, a flat cap (solid from any angle)
//   3 back      a backplate with a raised camera island, two raised lenses and a flash
//   4 front     a bezel ring, a 360×780 screen for your UI, a Dynamic Island and home indicator on the glass
//   5 outline   an optional flat sticker outline traced around the rendered silhouette (an SVG filter on the layer)
// No fake shading, shadows or glows: the form comes from geometry. It builds its own layer (outline → orthographic
// 3D context → world → phone), centred in `parent`. Animate `el` (x, y, rotationX/Y/Z…) or `world` (a camera
// transform). The screen is empty: put your UI in `screen`. Static geometry, so nothing to step per frame.
//
//   const phone = device({ parent: stageEl, name: 'Phone' });
//   phone.screen.appendChild(myUi);                 // 360 × 780, rounded, clipped
//   b.fromTo(phone.el, { rotationY: -30 }, { rotationY: 30 });
//   // → { el, screen, world, layer }
const W = 384, H = 804, R = 58, SLABS = 26, DEPTH = 1.6, THICK = SLABS * DEPTH;
const CSS = `
.dv-layer { position: absolute; inset: 0; pointer-events: none; }
.dv-persp { position: absolute; inset: 0; perspective: none; }
.dv-world { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; }
.dv-phone { position: absolute; left: ${-W / 2}px; top: ${-H / 2}px; width: ${W}px; height: ${H}px; transform-style: preserve-3d; }
.dv-phone * { box-sizing: border-box; }
.dv-slabs { position: absolute; inset: 0; transform-style: preserve-3d; }
/* rings, not solid plates: nothing solid sits behind the screen for the 3D sort to misplace */
.dv-slab, .dv-bezel { -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
.dv-slab { position: absolute; inset: 0; border-radius: ${R}px; background: var(--dv-body); padding: 26px; }
.dv-wall { position: absolute; backface-visibility: hidden; background: var(--dv-body); }
.dv-wall i { position: absolute; display: block; background: var(--dv-band); }
.dv-btn { position: absolute; transform-style: preserve-3d; }
.dv-btn i { position: absolute; inset: 0; display: block; }
.dv-btn b { position: absolute; left: 0; top: 0; display: block; background: #1E262D; }
.dv-btn .groove { inset: -1.5px; background: #151C22; }
.dv-btn .cap { background: #5A6672; }
.dv-bezel { position: absolute; inset: 0; border-radius: ${R}px; background: #090D10; padding: 14px;
  box-shadow: inset 0 0 0 2px #8A96A0, inset 0 0 0 3.5px #2A343C, inset 0 0 0 5px #090D10; }
.dv-back { position: absolute; inset: 0; border-radius: ${R}px; backface-visibility: hidden; transform-style: preserve-3d;
  background: linear-gradient(150deg, #5D6A75 0%, #2E3942 40%, #1B232A 100%); box-shadow: inset 0 0 0 2px #7D8994; }
.dv-bump { position: absolute; left: 24px; top: 24px; width: 88px; height: 158px; transform-style: preserve-3d; }
.dv-xw { position: absolute; left: 0; top: 0; display: block; }
.dv-bump > .dv-xw { background: #6B7782; }
.dv-bump .cap { position: absolute; inset: 0; border-radius: 44px; background: #56636F; box-shadow: inset 0 0 0 1.5px #7C8893; }
.dv-lens { position: absolute; left: 12px; width: 64px; height: 64px; transform-style: preserve-3d; }
.dv-lens > .dv-xw { background: #6E7984; }
.dv-lens .glass { position: absolute; inset: 0; border-radius: 50%; background: #0E1318; box-shadow: inset 0 0 0 5px #9AA4AE, inset 0 0 0 11px #161D23; }
.dv-lens .glass::after { content: ''; position: absolute; left: 23px; top: 23px; width: 18px; height: 18px; border-radius: 50%; background: #1E2A44; }
.dv-flash { position: absolute; left: 128px; top: 76px; width: 18px; height: 18px; border-radius: 50%; background: #CFC6AE; box-shadow: inset 0 0 0 2px #8D8672; }
.dv-glass { position: absolute; left: 12px; top: 12px; width: 360px; height: 780px; transform-style: preserve-3d; }
.dv-screen { position: absolute; inset: 0; border-radius: 46px; overflow: hidden; background: var(--dv-screen); }
.dv-island { position: absolute; left: 123px; top: 11px; width: 114px; height: 33px; border-radius: 20px; background: #15191D; box-shadow: inset 0 0 0 1px rgba(255,255,255,.04); }
.dv-island::after { content: ''; position: absolute; right: 11px; top: 11.5px; width: 10px; height: 10px; border-radius: 50%; background: #1C232B; }
.dv-home { position: absolute; left: 113px; top: 763px; width: 134px; height: 7px; border-radius: 4px; background: rgba(17, 24, 29, .45); }`;

let filters = 0;
function injectCss() {
  if (document.getElementById('studio-device-css')) return;
  const st = document.createElement('style'); st.id = 'studio-device-css'; st.textContent = CSS; document.head.appendChild(st);
}
// a flat sticker outline around whatever the layer renders: close small gaps, dilate, fill
function outlineFilter(width, color, fill) {
  const id = `dvSticker${++filters}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', 0); svg.setAttribute('height', 0); svg.style.position = 'absolute';
  svg.innerHTML = `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="c1"/><feMorphology in="c1" operator="erode" radius="2" result="closed"/>
    <feMorphology in="closed" operator="dilate" radius="${width}" result="d"/><feFlood flood-color="${color}"/><feComposite in2="d" operator="in" result="o"/>
    <feFlood flood-color="${fill}"/><feComposite in2="closed" operator="in" result="fill"/>
    <feMerge><feMergeNode in="o"/><feMergeNode in="fill"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  document.body.appendChild(svg);
  return id;
}
const node = (tag, cls, parent, name) => { const e = document.createElement(tag); if (cls) e.className = cls; if (name) e.dataset.name = name; parent?.appendChild(e); return e; };
// extrude a flat outline straight up (local z) by h: one wall facet per outline segment
const extrude = (parent, pts, h, z0 = 0, cls = 'dv-xw') => pts.forEach(([x0, y0], k) => {
  const [x1, y1] = pts[(k + 1) % pts.length], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  if (L < 0.01) return;
  const w = node('b', cls, parent);
  Object.assign(w.style, { width: `${h}px`, height: `${L + 0.4}px`, transformOrigin: '0 0',
    transform: `translate3d(${x0}px, ${y0}px, ${z0}px) rotateZ(${Math.atan2(-dx, dy) * 180 / Math.PI}deg) rotateY(-90deg)` });
});
const roundRect = (w, h, r, seg = 6) => {
  const pts = [];
  [[w - r, r, -90], [w - r, h - r, 0], [r, h - r, 90], [r, r, 180]].forEach(([cx, cy, a0]) => {
    for (let k = 0; k <= seg; k++) { const a = ((a0 + (90 * k) / seg) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  });
  return pts;
};
const circle = (r, n = 28) => Array.from({ length: n }, (_, k) => [r + r * Math.cos((2 * Math.PI * k) / n), r + r * Math.sin((2 * Math.PI * k) / n)]);
const pill = (w, len, seg = 8) => {   // points around a vertical pill, clockwise
  const r = w / 2, pts = [];
  for (let k = 0; k <= seg; k++) { const a = Math.PI + (Math.PI * k) / seg; pts.push([r + r * Math.cos(a), r + r * Math.sin(a)]); }
  for (let k = 0; k <= seg; k++) { const a = (Math.PI * k) / seg; pts.push([r + r * Math.cos(a), len - r + r * Math.sin(a)]); }
  return pts;
};

export function device({
  parent, name = 'Phone',
  body = '#2B353E', band = '#4A5661', screen = '#fff',
  outline = true, outlineWidth = 9, outlineColor = '#fff',
  buttons = true, backCamera = true, zIndex,
} = {}) {
  injectCss();
  const layer = node('div', 'dv-layer', parent || document.getElementById('stage'), `${name} – layer`);
  if (zIndex != null) layer.style.zIndex = zIndex;
  if (outline) layer.style.filter = `url(#${outlineFilter(outlineWidth, outlineColor, '#26313A')})`;
  const world = node('div', 'dv-world', node('div', 'dv-persp', layer));
  const el = node('div', 'dv-phone', world, name);
  el.style.setProperty('--dv-body', body); el.style.setProperty('--dv-band', band); el.style.setProperty('--dv-screen', screen);

  // 1 body: rings back from the glass, then solid walls on the straight edges (the corners stay as the ring stack)
  const slabs = node('div', 'dv-slabs', el, `${name} – body`);
  for (let i = 1; i <= SLABS; i++) node('div', 'dv-slab', slabs).style.transform = `translateZ(${-i * DEPTH}px)`;
  [['left', -0.2, R, THICK, H - 2 * R, 'rotateY(-90deg)'], ['right', W - 0.8, R, THICK, H - 2 * R, 'rotateY(90deg)'],
   ['top', R, 0, W - 2 * R, THICK, 'rotateX(90deg)'], ['bottom', R, H, W - 2 * R, THICK, 'rotateX(-90deg)']].forEach(([side, x, y, w, h, rot]) => {
    const wall = node('div', 'dv-wall', null, `${name} – side ${side}`);
    const vertical = side === 'left' || side === 'right';
    Object.assign(wall.style, { left: `${vertical ? x - w / 2 : x}px`, top: `${vertical ? y : y - h / 2}px`, width: `${w}px`, height: `${h}px`,
      transform: `translateZ(${-THICK / 2}px) ${rot}` });
    slabs.after(wall);
    if (side === 'left') [34, h - 34].forEach((at) => Object.assign(node('i', '', wall).style, { left: 0, right: 0, top: `${at - 3.5}px`, height: '7px' }));   // antenna bands
  });

  // 2 buttons: one long pill on the left, the power button on the right
  if (buttons) {
    const PILL = Math.round(THICK * 0.48), BTN_H = 3.5;
    [['left', 176, 96], ['right', 220, 90]].forEach(([side, top, len]) => {
      const btn = node('div', 'dv-btn', el, `${name} – side button`);
      Object.assign(btn.style, { left: `${(side === 'left' ? -0.6 : W + 0.6) - PILL / 2}px`, top: `${top}px`, width: `${PILL}px`, height: `${len}px`,
        transform: `translateZ(${-THICK / 2}px) rotateY(${side === 'left' ? -90 : 90}deg)` });
      const groove = node('i', 'groove', btn), cap = node('i', 'cap', btn);
      groove.style.borderRadius = `${PILL / 2 + 2}px`;
      Object.assign(cap.style, { borderRadius: `${PILL / 2}px`, transform: `translateZ(${BTN_H}px)` });
      extrude(btn, pill(PILL, len), BTN_H, 0, '');   // facets styled by .dv-btn b
    });
  }

  // 3 back: plate, raised camera island (8 px), two raised lenses (5 px) and a flash
  node('div', 'dv-bezel', el, `${name} – bezel`);
  const back = node('div', 'dv-back', el, `${name} – back`);
  back.style.transform = `translateZ(${-THICK - 0.5}px) rotateY(180deg)`;
  if (backCamera) {
    const ISLAND = 8, LENS = 5, bump = node('div', 'dv-bump', back, `${name} – camera island`);
    extrude(bump, roundRect(88, 158, 44), ISLAND);
    node('div', 'cap', bump).style.transform = `translateZ(${ISLAND}px)`;
    [12, 82].forEach((top) => {
      const lens = node('div', 'dv-lens', bump); lens.style.top = `${top}px`;
      extrude(lens, circle(32), LENS, ISLAND);
      node('div', 'glass', lens).style.transform = `translateZ(${ISLAND + LENS}px)`;
    });
    node('div', 'dv-flash', back, `${name} – flash`);
  }

  // 4 front: the screen (empty, for your UI) with the island and home indicator flush on the glass
  const glass = node('div', 'dv-glass', el, `${name} – glass`);
  glass.style.transform = 'translateZ(3px)';
  const scr = node('div', 'dv-screen', glass, `${name} – screen`);
  node('div', 'dv-island', glass, 'Dynamic Island').style.transform = 'translateZ(1.5px)';
  node('div', 'dv-home', glass, 'Home indicator').style.transform = 'translateZ(1.5px)';

  return { el, screen: scr, world, layer };
}
