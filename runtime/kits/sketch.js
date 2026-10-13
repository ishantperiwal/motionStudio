// Storyboard / animatic kit: hand-drawn shapes (rough.js, seeded so frames stay
// deterministic), handwritten labels, and a shot HUD with on-screen-title placeholders.
//
//   const sk = sketch(svgEl, { seed: 1 });
//   const row = sk.group(svgEl, 'Row – New email');
//   sk.rect(row, 0, 0, 560, 110, { r: 14, fill: '#f1f1f1' });
//   sk.text(row, 20, 40, 'Duplicate charge', { size: 24 });
//
//   const hud = shotHud(s, stageEl, shots);   // shots: [{ id, at, dur, title, onscreen, action }]
import rough from 'roughjs';

export const HAND = "'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', cursive";
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const rrect = (x, y, w, h, r) => `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

export function sketch(svg, { seed = 1, roughness = 1.1, ink = '#2b2b2b' } = {}) {
  const rc = rough.svg(svg);
  let n = seed;
  const opts = (o) => ({ roughness, bowing: 0.7, strokeWidth: 2, stroke: ink, fillStyle: 'solid', seed: n++, ...o });
  const add = (p, node) => { (p || svg).appendChild(node); return node; };
  return {
    group(parent, name, attrs = {}) { const g = el('g', attrs); if (name) g.dataset.name = name; return add(parent, g); },
    rect(p, x, y, w, h, o = {}) { const { r, ...rest } = o; return add(p, r ? rc.path(rrect(x, y, w, h, r), opts(rest)) : rc.rectangle(x, y, w, h, opts(rest))); },
    circle(p, cx, cy, d, o = {}) { return add(p, rc.circle(cx, cy, d, opts(o))); },
    line(p, x1, y1, x2, y2, o = {}) { return add(p, rc.line(x1, y1, x2, y2, opts(o))); },
    path(p, d, o = {}) { return add(p, rc.path(d, opts({ fill: undefined, ...o }))); },
    /** A rough "scribble" standing in for a line of text. */
    scribble(p, x, y, w, o = {}) { return add(p, rc.line(x, y, x + w, y, opts({ strokeWidth: 6, stroke: '#c9c9c9', roughness: 1.6, ...o }))); },
    text(p, x, y, str, { size = 22, color = ink, weight = 400, anchor = 'start', font = HAND } = {}) {
      const t = el('text', { x, y, 'font-size': size, fill: color, 'font-weight': weight, 'text-anchor': anchor, 'font-family': font });
      t.textContent = str;
      return add(p, t);
    },
  };
}

// Shot HUD: shot counter + timecode (top), planned on-screen title and action note (bottom),
// and a strip of shot segments. Purely informational — it's what makes it read as an animatic.
export function shotHud(s, stage, shots) {
  const hud = document.createElement('div');
  hud.className = 'ms-hud';
  hud.innerHTML = `<style>
    .ms-hud { position: absolute; inset: 0; pointer-events: none; z-index: 60; font-family: -apple-system, "SF Pro Text", system-ui, sans-serif; }
    .ms-hud .top { position: absolute; left: 36px; top: 28px; display: flex; gap: 14px; align-items: baseline; color: #3b3b3b; }
    .ms-hud .num { font: 700 15px/1 -apple-system, system-ui; letter-spacing: 1.5px; background: #2b2b2b; color: #fff; padding: 6px 10px; border-radius: 6px; }
    .ms-hud .name { font: 600 20px/1 ${HAND}; }
    .ms-hud .tc { font: 500 14px/1 ui-monospace, Menlo, monospace; color: #7a7a7a; }
    .ms-hud .tag { position: absolute; right: 36px; top: 30px; font: 600 13px/1 -apple-system, system-ui; letter-spacing: 2px; color: #9a9a9a; }
    .ms-hud .bottom { position: absolute; left: 0; right: 0; bottom: 0; padding: 16px 36px 30px; background: rgba(243, 240, 232, .94); border-top: 1px solid #ddd8cc; }
    .ms-hud .act { font: 400 17px/1.3 ${HAND}; color: #6b6b6b; margin-bottom: 12px; }
    .ms-hud .strip { display: flex; gap: 4px; height: 8px; }
    .ms-hud .seg { position: relative; background: #ddd8cc; border-radius: 4px; overflow: hidden; }
    .ms-hud .seg i { position: absolute; left: 0; top: 0; bottom: 0; background: #2b2b2b; }
  </style>
  <div class="top"><span class="num"></span><span class="name"></span><span class="tc"></span></div>
  <div class="tag">ANIMATIC</div>
  <div class="bottom"><div class="act"></div><div class="strip">${shots.map((sh) => `<div class="seg" style="flex:${sh.dur}"><i></i></div>`).join('')}</div></div>`;
  stage.appendChild(hud);
  const q = (c) => hud.querySelector(c), segs = [...hud.querySelectorAll('.seg i')];
  const tc = (f) => (f / s.fps).toFixed(1) + 's';
  shots.forEach((sh, i) => s.beat(`shot.${i + 1}.${sh.id}`, { at: sh.at, dur: sh.dur, note: sh.action }));
  s.onFrame((f) => {
    const i = Math.max(0, shots.findIndex((sh) => f >= sh.at && f < sh.at + sh.dur));
    const sh = shots[i] || shots[shots.length - 1];
    q('.num').textContent = `SHOT ${i + 1}/${shots.length}`;
    q('.name').textContent = sh.title;
    q('.tc').textContent = `${tc(sh.at)} – ${tc(sh.at + sh.dur)}`;
    q('.act').textContent = sh.action;
    segs.forEach((seg, k) => { const x = shots[k]; seg.style.width = `${Math.max(0, Math.min(1, (f - x.at) / x.dur)) * 100}%`; });
  }, 50);
  return hud;
}
