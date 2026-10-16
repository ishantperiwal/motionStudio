// Construct reveal: an element is built on a dot lattice, part by part, then a scan bar reveals the real thing.
// From the plugin build in the Motion Ops film (after Jakub Antalik's UI-generation skeleton, transitions.dev).
//   1 lattice   a faint dot grid spreads out from the centre (each dot pops in), ~3 cells past the edges, fading outward
//   2 process   short vertical runs of lattice dots flash darker and bigger now and then
//   3 parts     each part is written in dot by dot with a bigger "writing head": the outline as two halves from
//               top-centre, text rows as dotted runs with heavy end dots, circles, paths; a few dots blink out a frame
//   4 bracket   corner brackets jump from part to part as each starts, with a mono label (LIST 314×526)
//   5 guides    dotted guides past the edges, square corner handles, a size/time readout; gone as the scan ends
//   6 scan      a bar sweeps top → bottom revealing the real element; dots near it grow, passed dots turn light and
//               fade behind it (the trail); the lattice past the edges leaves as it starts
//   7 glow      behind the line the freshly made element glows: a brightened copy of itself, seen only in a band that
//               is strongest at the line and fades smoothly upward (its own ink lights up, not a white wash)
// A pure function of the frame (seeded), drawn in SVG in stage px; it registers <name>.build and <name>.scan beats.
//
//   const c = construct(s, {
//     reveal: card, label: 'CARD', at: 10,                 // the real element (HTML or SVG); box/radius default to its own
//     parts: [                                             // at: frames after the build starts
//       { label: 'TEXT', at: 3, rows: [titleEl, subEl] },  // rows: text elements or [x, yMid, w]
//       { label: 'LIST', at: 6, rect: listEl, rows: names, circles: swatches },   // rect: element or [x, y, w, h, r]
//       { label: 'ICON', at: 9, paths: 'M…' },             // circles: element or [cx, cy, r]; paths: SVG path data
//     ],
//   });   // → { g, at, scanAt, end, scanY(f) }
//   options: glow (true), glowHeight (260 px), glowFilter ('brightness(1.75) saturate(0.85)') — set glow: false to turn it off
import { bezier, rng } from '../ease.js';

const NS = 'http://www.w3.org/2000/svg', MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
const OVER = bezier(0.34, 1.3, 0.64, 1), MOVE = bezier(0.45, 0, 0.2, 1), SCANE = bezier(0.3, 0, 0.7, 1);
const clamp = (v) => Math.max(0, Math.min(1, v)), ramp = (f, a, d) => clamp((f - a) / d), lerp = (a, b, t) => a + (b - a) * t;
const node = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent.appendChild(e); return e; };
const setText = (el, str) => { if (el.textContent !== str) el.textContent = str; };
const many = (v) => (v == null ? [] : typeof v === 'string' || v instanceof Element || typeof v[0] === 'number' ? [v] : [...v]);
// a rounded rect as a right and a left half, both from top-centre to bottom-centre (they meet at the bottom)
const halves = (x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2);
  return [1, -1].map((s) => { const e = s > 0 ? x + w : x, sw = s > 0 ? 1 : 0;
    return `M${x + w / 2},${y} H${e - s * r} A${r},${r} 0 0 ${sw} ${e},${y + r} V${y + h - r} A${r},${r} 0 0 ${sw} ${e - s * r},${y + h} H${x + w / 2}`; }); };

/** An element's box in stage px, [x, y, w, h], measured now (before any entrance transforms). text: the text's own extent. */
export function boxOf(el, text = false) {
  const stage = document.getElementById('stage'), sr = stage.getBoundingClientRect(), k = sr.width / stage.offsetWidth || 1;
  let r = el.getBoundingClientRect();
  if (text) { const rg = document.createRange(); rg.selectNodeContents(el); r = rg.getBoundingClientRect(); }
  return [(r.left - sr.left) / k, (r.top - sr.top) / k, r.width / k, r.height / k];
}
const asRect = (v, r) => (v instanceof Element ? [...boxOf(v), r ?? (parseFloat(getComputedStyle(v).borderTopLeftRadius) || 0)] : [v[0], v[1], v[2], v[3], v[4] ?? r ?? 0]);
const asRow = (v) => { if (!(v instanceof Element)) return v; const [x, y, w, h] = boxOf(v, true); return [x, y + h / 2, w]; };
const asCircle = (v) => { if (!(v instanceof Element)) return v; const [x, y, w, h] = boxOf(v); return [x + w / 2, y + h / 2, Math.min(w, h) / 2]; };

export function construct(s, o = {}) {
  const { reveal, label = 'FRAME', parts = [], scan = 16, name = 'construct', seed = 1, pitch = 17.5, spread = 45, scale: k = 1,
    glow = true, glowHeight = 260, glowFilter = 'brightness(1.75) saturate(0.85)' } = o;
  const C = { ink: '#10213F', light: '#CFE0FF', accent: '#2A6FD6', paper: '#F7FBFA', ...o.colors };
  const at = typeof o.at === 'function' ? o.at(s.beats) : o.at ?? 0;
  const [bx, by, bw, bh] = o.box || boxOf(reveal);
  const radius = o.radius ?? (reveal instanceof HTMLElement ? parseFloat(getComputedStyle(reveal).borderTopLeftRadius) || 0 : 0);
  let into = o.into;
  if (!into) {   // a full-stage SVG on top of the stage
    into = node('svg', { width: s.width, height: s.height, viewBox: `0 0 ${s.width} ${s.height}` }, document.getElementById('stage'));
    Object.assign(into.style, { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' });
  }
  const g = node('g', {}, into); g.dataset.name = `${label} build (construct reveal)`;
  const dotsG = node('g', {}, g);
  const R = rng(seed), D = [];
  let last = 0;   // when the last part finishes writing (frames after `at`)
  const dot = (x, y, t, r, op, x2 = {}) => { const d = { el: node('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 0, fill: C.ink }, dotsG), x, y, t, r, op, last: '', ...x2 }; D.push(d); return d; };

  // 1) the lattice, spreading out from the centre; 2) short vertical runs of it that flash ("processing")
  const P = pitch * k, cx = bx + bw / 2, cy = by + bh / 2, grid = new Map();
  for (let gy = -3; gy * P <= bh + 3 * P; gy++) for (let gx = -3; gx * P <= bw + 3 * P; gx++) {
    const x = bx + 0.5 * P + gx * P, y = by + 0.5 * P + gy * P, out = Math.max(0, bx - x, x - bx - bw, by - y, y - by - bh);   // px outside the box
    const op = 0.3 * Math.max(0, 1 - out / (3.4 * P));
    if (op > 0.01) grid.set(`${gx},${gy}`, dot(x, y, at + 1 + Math.hypot(x - cx, y - cy) / (spread * k), 1.8 * k, op, { lattice: true, outside: out > 0 }));
  }
  const inner = [...grid].filter(([, d]) => !d.outside);
  for (let n = Math.round(inner.length * 0.05); n > 0; n--) {
    const [gx, gy] = inner[Math.floor(R() * inner.length)][0].split(',').map(Number);
    const len = 1 + Math.floor(R() * 4), period = 9 + Math.floor(R() * 14), phase = Math.floor(R() * 30);
    for (let i = 0; i < len; i++) { const d = grid.get(`${gx},${gy + i}`); if (d && !d.outside) Object.assign(d, { period, phase: phase + i }); }   // the flash runs down the column
  }

  // 3) the parts, written in dot by dot (t0: frames after `at`)
  function trace(path, t0, dur, gap, r, op) {
    const p = node('path', { d: path }, g), len = p.getTotalLength(), n = Math.max(2, Math.round(len / (gap * k)));
    for (let i = 0; i <= n; i++) { const q = p.getPointAtLength((i / n) * len); dot(q.x, q.y, at + t0 + (i / n) * dur, r * k, op, { drop: R() < 0.07 ? Math.floor(R() * 37) : -1 }); }
    p.remove(); last = Math.max(last, t0 + dur);
  }
  const writeRow = ([x, y, w], t0) => { trace(`M${x},${y} H${x + w}`, t0, 4, 7, 1.6, 0.6); dot(x, y, at + t0, 3.4 * k, 0.85); dot(x + w, y, at + t0 + 4, 3.4 * k, 0.85); };
  const circlePath = ([x, y, r]) => `M${x},${y - r} a${r},${r} 0 1,1 0,${2 * r} a${r},${r} 0 1,1 0,${-2 * r}`;
  const seq = [];   // what the bracket visits, in order
  if (o.outline !== false) { halves(bx, by, bw, bh, radius).forEach((d) => trace(d, 0, 9, 7, 2, 0.75)); seq.push({ label, at: 0, box: [bx, by, bw, bh] }); }
  for (const pt of parts) {
    const rects = many(pt.rect).map((v) => asRect(v, pt.r)), rows = many(pt.rows ?? pt.row).map(asRow), circles = many(pt.circles ?? pt.circle).map(asCircle), paths = many(pt.paths ?? pt.path);
    const t1 = pt.at + (rects.length ? 2 : 0), step = pt.step ?? 0.5;   // contents start just after their frame, item i at +i·step
    rects.forEach(([x, y, w, h, r]) => halves(x, y, w, h, r).forEach((d) => trace(d, pt.at, pt.dur ?? 6, 7, 1.7, 0.55)));
    rows.forEach((v, i) => writeRow(v, t1 + i * step));
    circles.forEach((v, i) => trace(circlePath(v), t1 + i * step, 5, 6, 1.7, 0.6));
    const pb = paths.map((d, i) => { trace(d, t1 + i * step, 8, 7, 1.7, 0.6); const p = node('path', { d }, g), b = p.getBBox(); p.remove(); return [b.x, b.y, b.width, b.height]; });
    const boxes = [...rects, ...rows.map(([x, y, w]) => [x, y - 11 * k, w, 22 * k]), ...circles.map(([x, y, r]) => [x - r, y - r, 2 * r, 2 * r]), ...pb];
    const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
    seq.push({ label: pt.label || 'PART', at: pt.at, box: pt.box || [x0, y0, Math.max(...boxes.map((b) => b[0] + b[2])) - x0, Math.max(...boxes.map((b) => b[1] + b[3])) - y0] });
  }
  if (!seq.length) seq.push({ label, at: 0, box: [bx, by, bw, bh] });
  seq.sort((a, b) => a.at - b.at);
  const scanAt = o.scanAt ?? at + Math.ceil(last) + 1, end = scanAt + scan;

  // 4) the selection bracket
  const brG = node('g', {}, g);
  const brC = [0, 1, 2, 3].map(() => node('path', { fill: 'none', stroke: C.ink, 'stroke-width': 4 * k, 'stroke-linecap': 'square' }, brG));
  const brL = node('text', { 'font-size': 20 * k, fill: C.ink, 'font-family': MONO, 'font-weight': 500 }, brG);
  // 5) guides past the edges, corner handles, the size/time readout
  const GD = 70 * k, guideG = node('g', {}, g);
  const guides = [[bx - GD, by, bx + bw + GD, by], [bx - GD, by + bh, bx + bw + GD, by + bh], [bx, by - GD, bx, by + bh + GD], [bx + bw, by - GD, bx + bw, by + bh + GD]]
    .map(([x1, y1, x2, y2]) => node('path', { d: `M${x1},${y1} L${x2},${y2}`, fill: 'none', stroke: C.ink, 'stroke-width': 1.8 * k, 'stroke-linecap': 'round', 'stroke-dasharray': `0 ${6 * k}`, opacity: 0 }, guideG));
  const handles = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => node('rect', { x: bx + i * bw - 5.5 * k, y: by + j * bh - 5.5 * k, width: 11 * k, height: 11 * k, fill: C.paper, stroke: C.ink, 'stroke-width': 1.5 * k, opacity: 0 }, guideG));
  const readout = node('text', { x: bx, y: by + bh + 30 * k, 'font-size': 15.6 * k, fill: C.ink, 'font-family': MONO, 'font-weight': 500, opacity: 0 }, guideG);
  readout.style.whiteSpace = 'pre';
  // 6) the scan bar: white core, accent band, round knobs at both ends
  const scanG = node('g', {}, g), SX = 38 * k;
  node('rect', { x: bx - SX, y: -2 * k, width: bw + 2 * SX, height: 9 * k, fill: C.accent }, scanG);
  node('rect', { x: bx - SX, y: -5 * k, width: bw + 2 * SX, height: 5 * k, fill: '#fff' }, scanG);
  [bx - SX, bx + bw + SX].forEach((x) => { node('circle', { cx: x, cy: 0, r: 14 * k, fill: C.accent }, scanG); node('circle', { cx: x, cy: 0, r: 6 * k, fill: '#fff' }, scanG); });
  const scanY = (f) => lerp(by - 10 * k, by + bh + 10 * k, SCANE(ramp(f, scanAt, scan)));

  // the real element: shown above the scan line only (SVG: a clipPath in its own user space, which should be stage px)
  let clipR = null, rTop = by, rH = bh;
  if (reveal instanceof SVGElement) {
    const defs = node('defs', {}, into.ownerSVGElement || into), id = `construct-${name}-${seed}-${Math.round(bx)}-${Math.round(by)}`;
    clipR = node('rect', { x: bx - 2000, y: by - 2000, width: bw + 4000, height: 0 }, node('clipPath', { id }, defs));
    reveal.setAttribute('clip-path', `url(#${id})`);
  } else if (reveal) [, rTop, , rH] = boxOf(reveal);
  // 7) the glow: a copy of the element over itself, brightened, masked to a band just above the scan line
  let glowEl = null, glowMask = null;
  if (glow && reveal instanceof HTMLElement) {
    glowEl = reveal.cloneNode(true); glowEl.removeAttribute('id'); glowEl.dataset.name = `${label} glow (construct reveal)`;
    const cs = getComputedStyle(reveal); for (const prop of cs) glowEl.style.setProperty(prop, cs.getPropertyValue(prop));   // keeps its own look even if it was styled by id
    Object.assign(glowEl.style, { position: 'absolute', left: `${reveal.offsetLeft}px`, top: `${reveal.offsetTop}px`, width: `${reveal.offsetWidth}px`, height: `${reveal.offsetHeight}px`,
      margin: '0', pointerEvents: 'none', filter: glowFilter, boxShadow: 'none', display: 'none' });
    (reveal.offsetParent || reveal.parentNode).appendChild(glowEl);
  } else if (glow && reveal instanceof SVGElement) {
    if (!reveal.id) reveal.id = `construct-reveal-${name}-${seed}`;
    const defs = node('defs', {}, into.ownerSVGElement || into), mid = `${reveal.id}-glow`;
    const m = node('mask', { id: mid, maskUnits: 'userSpaceOnUse', x: -1e4, y: -1e4, width: 2e4, height: 2e4 }, defs);
    const lg = node('linearGradient', { id: `${mid}-g`, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0 }, defs);
    for (let i = 0; i <= 12; i++) node('stop', { offset: i / 12, 'stop-color': '#fff', 'stop-opacity': Math.pow(i / 12, 2.2).toFixed(3) }, lg);
    glowMask = { rect: node('rect', { x: bx - 100, width: bw + 200, fill: `url(#${mid}-g)` }, m), lg };
    glowEl = node('use', { href: `#${reveal.id}`, mask: `url(#${mid})` }, reveal.parentNode); glowEl.style.filter = glowFilter; glowEl.style.display = 'none';
  }
  const paint = (d, r, op, fill) => { const key = `${r.toFixed(2)}|${op.toFixed(2)}|${fill}`; if (key !== d.last) { d.el.setAttribute('r', r.toFixed(2)); d.el.setAttribute('fill-opacity', op.toFixed(2)); d.el.setAttribute('fill', fill); d.last = key; } };

  s.onFrame((f) => {
    const sy = scanY(f), fi = Math.floor(f);
    if (clipR) clipR.setAttribute('height', (f >= end ? 1e5 : f >= scanAt ? Math.max(0, sy - by + 2000) : 0).toFixed(1));
    else if (reveal) {   // HTML: clipped at the line; the sides and top keep room for its shadow
      const cut = f >= scanAt ? sy - rTop : 0;
      reveal.style.clipPath = f >= end ? '' : cut <= 0 ? 'inset(0 0 100% 0)' : `inset(-100px -100px ${Math.max(0, rH - cut).toFixed(1)}px -100px)`;
    }
    if (glowEl) {   // brightest at the line, eased falloff upward; fades out as the scan ends
      const on = f >= scanAt && f < end + 10, fade = 1 - ramp(f, end - 4, 12), T = glowHeight * k;
      glowEl.style.display = on ? '' : 'none';
      if (on && glowMask) {
        glowMask.lg.setAttribute('y1', (sy - T).toFixed(1)); glowMask.lg.setAttribute('y2', sy.toFixed(1));
        glowMask.rect.setAttribute('y', (sy - T).toFixed(1)); glowMask.rect.setAttribute('height', T.toFixed(1)); glowMask.rect.setAttribute('opacity', fade.toFixed(3));
      } else if (on) {
        const line = sy - rTop, stops = Array.from({ length: 13 }, (_, i) => { const u = i / 12; return `rgba(0,0,0,${(fade * Math.pow(u, 2.2)).toFixed(3)}) ${(line - T + u * T).toFixed(1)}px`; }).join(', ');
        glowEl.style.webkitMaskImage = glowEl.style.maskImage = `linear-gradient(180deg, rgba(0,0,0,0) 0px, ${stops}, rgba(0,0,0,0) ${(line + 1).toFixed(1)}px)`;
      }
    }
    const live = f >= at && f < end + 7;
    g.style.display = live ? '' : 'none';
    if (!live) return;
    const scanning = f >= scanAt && f < end, outFade = 1 - ramp(f, scanAt, 6), trailFade = 1 - ramp(f, end, 6), TL = 96 * k;
    for (const d of D) {
      const v = ramp(f, d.t, 3);
      let r = 0, op = d.op;
      if (v > 0) {
        r = d.r * Math.max(0, OVER(v));
        if (v < 1 && !d.lattice) { r *= 1.4; op = 0.95; }                                           // the writing head
        if (d.period && f > d.t + 3 && (fi + d.phase) % d.period < 2) { r *= 1.55; op = 0.8; }     // processing
        if (d.drop >= 0 && v >= 1 && (fi + d.drop) % 37 === 0) r = 0;                               // blinks out for a frame
        if (scanning) { const near = clamp(1 - (d.y - sy) / (84 * k)); r *= 1 + 0.5 * near; op = lerp(op, 0.95, near); }   // read by the scan
        if (d.outside) op *= outFade;                                                               // the lattice past the edges leaves
      }
      if (f >= scanAt && v > 0 && d.y < sy) {   // the trail: passed dots turn light, shrink and fade above the line
        const t = (sy - d.y) / TL;
        if (t >= 1) paint(d, 0, 0, C.light); else paint(d, r * (1 - 0.45 * t), Math.min(0.9, op * trailFade + 0.2) * (1 - t) * (1 - t) * trailFade * (d.outside ? outFade : 1), C.light);
      } else paint(d, r, op, C.ink);
    }
    // the bracket jumps (eased, 3 frames) to the part being written
    let i = 0; seq.forEach((p, j) => { if (f >= at + p.at) i = j; });
    const pv = seq[Math.max(0, i - 1)].box, nw = seq[i].box, jv = MOVE(ramp(f, at + seq[i].at, 3)), M = 14 * k, L = 22 * k;
    const x = lerp(pv[0], nw[0], jv) - M, y = lerp(pv[1], nw[1], jv) - M, w = lerp(pv[2], nw[2], jv) + 2 * M, h = lerp(pv[3], nw[3], jv) + 2 * M;
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx2, cy2, sx, sy2], j) => brC[j].setAttribute('d', `M${(cx2 + sx * L).toFixed(1)},${cy2.toFixed(1)} H${cx2.toFixed(1)} V${(cy2 + sy2 * L).toFixed(1)}`));
    brG.setAttribute('opacity', (ramp(f, at + 1, 3) * (1 - ramp(f, scanAt, 3))).toFixed(3));
    brL.setAttribute('x', x.toFixed(1)); brL.setAttribute('y', (y - 10 * k).toFixed(1));
    const on = jv < 0.5 ? seq[Math.max(0, i - 1)] : seq[i];   // the label switches halfway through the jump
    setText(brL, `${on.label} ${Math.round(on.box[2])}×${Math.round(on.box[3])}`);
    // guides, handles and readout; they leave as the scan finishes
    const gOut = 1 - ramp(f, end - 4, 6);
    guides.forEach((el, j) => el.setAttribute('opacity', (0.5 * ramp(f, at + 2 + j, 6) * gOut).toFixed(3)));
    handles.forEach((el, j) => el.setAttribute('opacity', (0.8 * OVER(ramp(f, at + 6 + j, 5)) * gOut).toFixed(3)));
    readout.setAttribute('opacity', (0.7 * ramp(f, at + 2, 6) * gOut).toFixed(3));
    setText(readout, `${Math.round(bw)} × ${Math.round(bh)}  t+${Math.max(0, (Math.min(f, end) - at) / s.fps).toFixed(2)}s`);
    scanG.style.display = scanning ? '' : 'none';
    scanG.setAttribute('transform', `translate(0 ${sy.toFixed(1)})`);
    scanG.setAttribute('opacity', clamp(Math.min((f - scanAt) / 2, (end - f) / 2)).toFixed(3));
  });

  if (name) {
    s.beat(`${name}.build`, { at, dur: scanAt - at, ease: 'linear', note: 'Construct reveal: the lattice spreads, the parts are written in, the bracket jumps between them' }, (b) => b.track(g));
    s.beat(`${name}.scan`, { at: scanAt, dur: scan, ease: 'linear', note: 'Construct reveal: the scan reveals the real element, a light dot trail and a glow behind it' }, (b) => b.track(g, ...(reveal ? [reveal] : [])));
  }
  return { g, at, scanAt, end, scanY };
}
