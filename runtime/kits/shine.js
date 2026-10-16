// Glossy shine: light passes over a glossy printed card, once, at an even pace, and the print catches it.
// From the back of the hero card in the Motion Ops film (the navy card with the yellow-green → cyan frame).
//   1 sheen     a brightened copy of the element's own art, seen only where the light is (masked by the moving band),
//               so the ink, lines and frame catch the light more than the dark ground: not a white haze
//   2 glow      a faint screen-blend glow on the face, tinted cyan at the leading edge → white → warm yellow trailing
//   3 frame     the same band, stronger, only on the frame ring; plus a faint all-round ring glow that swells in and out
//   4 sparkle   printed sparkles (✦) twinkle into a four-point star with a bloom as the light's centre crosses them
// The band is a raised cosine^1.5 (no bright core, no hard edge) at `angle`, travelling linearly from fully beyond one
// edge to fully past the other, so it never appears or vanishes mid-card. A pure function of the frame; the layers are
// added inside `el` (CSS injected once); it registers a <name>.sweep beat. Keep the element flat and still while it plays.
//
//   const sh = shine(s, {
//     el: card,                       // positioned, rounded, overflow: hidden; contains the art
//     at: 12,                         // frame or (beats) => frame; dur defaults to 50 (2 s at 25 fps)
//     frame: 24,                      // the frame ring's width in element px (0: no frame layer)
//     sparkles: [[500, 378]],         // element-local px, on printed ✦s (optional)
//   });   // → { at, end, x(f), layers: { sheen, glow, ring, glints } }
const clamp = (v) => Math.max(0, Math.min(1, v)), ramp = (f, a, d) => clamp((f - a) / d), lerp = (a, b, t) => a + (b - a) * t;
const CSS = `
.shine-layer { position: absolute; inset: 0; pointer-events: none; opacity: 0; border-radius: inherit; }
.shine-sheen { overflow: hidden; z-index: 2; }
.shine-sheen > img { position: absolute; display: block; max-width: none; }
.shine-glow, .shine-ring { mix-blend-mode: screen; z-index: 3; }
/* the ring layer only shows on the frame: the padding box minus the content box */
.shine-ring { -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
/* a four-point star with a soft bloom (drawn at 120 px; sized by transform) */
.shine-glint { position: absolute; left: 0; top: 0; width: 120px; height: 120px; pointer-events: none; opacity: 0; z-index: 4; mix-blend-mode: screen;
  background: radial-gradient(circle, rgba(255,255,255,1) 0 2.5px, rgba(255,255,255,.55) 5px, rgba(220,250,255,.18) 18px, rgba(255,255,255,0) 34px),
    linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.95) 50%, rgba(255,255,255,0)) center / 100% 2px no-repeat,
    linear-gradient(0deg, rgba(255,255,255,0), rgba(255,255,255,.95) 50%, rgba(255,255,255,0)) center / 2px 70% no-repeat; }`;
function injectCss() {
  if (document.getElementById('studio-shine-css')) return;
  const st = document.createElement('style'); st.id = 'studio-shine-css'; st.textContent = CSS; document.head.appendChild(st);
}
const layer = (cls, parent, name) => { const d = document.createElement('div'); d.className = `shine-layer ${cls}`; d.dataset.name = name; parent.appendChild(d); return d; };
// an element's box relative to `root`, in root's own (untransformed) px: walks offsetParents, so transforms don't matter
function offsetIn(el, root) {
  let x = 0, y = 0, n = el;
  while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  if (n === root) return [x, y, el.offsetWidth, el.offsetHeight];
  const r = el.getBoundingClientRect(), rr = root.getBoundingClientRect(), k = rr.width / root.offsetWidth || 1;   // fallback
  return [(r.left - rr.left) / k, (r.top - rr.top) / k, r.width / k, r.height / k];
}

export function shine(s, o = {}) {
  const { el, dur = 50, angle = 105, from = -62, to = 162, frame = 17, name = 'shine', sparkleSize = 120, sparkleWidth = 13,
    filter = 'brightness(1.9) saturate(1.25) contrast(1.05)' } = o;
  const W = { sheen: 34, glow: 50, frame: 40, ...o.widths };                         // band widths, % of the gradient line
  const A = { sheen: 0.85, glow: 0.12, frame: 0.6, ring: 0.12, ...o.strength };      // peak alphas
  const T = { lead: [150, 236, 245], trail: [246, 238, 170], ...o.tint };            // cyan leading, warm yellow trailing (rgb)
  const at = typeof o.at === 'function' ? o.at(s.beats) : o.at ?? 0, end = at + dur;
  const label = el.dataset.name || 'element';
  injectCss();
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.style.isolation = 'isolate';   // the screen blends mix with the art, not with what's behind the element

  // 1) the sheen: a brightened copy of the art, placed exactly over it
  const art = o.art === undefined ? el.querySelector('img') : o.art;
  let sheen = null;
  if (art) {
    sheen = layer('shine-sheen', el, `${label} – sheen`);
    const im = art.cloneNode(false), [x, y, w, h] = offsetIn(art, el);
    im.removeAttribute('id'); delete im.dataset.name;
    Object.assign(im.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, filter, objectFit: getComputedStyle(art).objectFit });
    sheen.appendChild(im);
  }
  // 2) the tinted glow; 3) the frame ring
  const glow = layer('shine-glow', el, `${label} – light sweep (face)`);
  const ring = frame > 0 ? layer('shine-ring', el, `${label} – light sweep (frame)`) : null;
  if (ring) ring.style.padding = `${frame}px`;
  // 4) sparkles: where each sits along the gradient line (%), so it fires as the band's centre crosses it
  const w = el.offsetWidth, h = el.offsetHeight, rad = (angle * Math.PI) / 180, sn = Math.sin(rad), cs = Math.cos(rad);
  const L = Math.abs(w * sn) + Math.abs(h * cs);   // CSS linear-gradient line length
  const glints = (o.sparkles || []).map(([gx, gy], i) => {
    const g = layer('shine-glint', el, `${label} – sparkle ${i + 1}`); g.classList.remove('shine-layer');
    return { g, gx, gy, p: 50 + (100 * ((gx - w / 2) * sn - (gy - h / 2) * cs)) / L };
  });

  const soft = (k) => (0.5 + 0.5 * Math.cos(Math.PI * k)) ** 1.5;   // a broad, soft falloff: no bright core, no hard edge
  const tint = (a) => (k, v) => { const c = k < 0 ? T.lead.map((t) => lerp(255, t, -k)) : T.trail.map((t) => lerp(255, t, k));
    return `rgba(${c.map(Math.round).join(',')},${(a * v).toFixed(3)})`; };
  const white = (a) => (k, v) => `rgba(255,255,255,${(a * v).toFixed(3)})`;
  const x = (f) => lerp(from, to, ramp(f, at, dur));   // the band's centre, % along the gradient line (linear: an even pace)

  s.onFrame((f) => {
    const lt = ramp(f, at, dur), on = lt > 0 && lt < 1, c = x(f);
    const env = Math.sin(Math.PI * clamp(lt)) ** 0.6;   // only the faint all-round ring glow swells in and out
    const stops = (bw, col) => Array.from({ length: 25 }, (_, i) => { const k = -1 + i / 12; return `${col(k, soft(k))} ${(c + k * bw).toFixed(1)}%`; }).join(', ');
    const op = on ? '1' : '0';
    if (sheen) { sheen.style.webkitMaskImage = sheen.style.maskImage = on ? `linear-gradient(${angle}deg, ${stops(W.sheen, white(A.sheen))})` : 'none'; sheen.style.opacity = op; }
    glow.style.background = on ? `linear-gradient(${angle}deg, ${stops(W.glow, tint(A.glow))})` : 'none'; glow.style.opacity = op;
    if (ring) { ring.style.background = on ? `linear-gradient(${angle}deg, ${stops(W.frame, tint(A.frame))}), rgba(255,255,255,${(A.ring * env).toFixed(3)})` : 'none'; ring.style.opacity = op; }
    for (const { g, gx, gy, p } of glints) {
      const v = on ? Math.exp(-(((c - p) / sparkleWidth) ** 2)) : 0;
      g.style.opacity = v.toFixed(3);
      g.style.transform = `translate(${gx - 60}px, ${gy - 60}px) scale(${((0.3 + 0.65 * v) * sparkleSize / 120).toFixed(3)}) rotate(${lerp(-25, 20, clamp((c - p + 30) / 60)).toFixed(1)}deg)`;
    }
  });

  if (name) s.beat(`${name}.sweep`, { at, dur, ease: 'linear', note: 'Glossy shine: light passes over the card at an even pace; the print, the frame and the sparkle catch it' }, (b) => b.track(el));
  return { at, end, x, layers: { sheen, glow, ring, glints: glints.map((q) => q.g) } };
}
