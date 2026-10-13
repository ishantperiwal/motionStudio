// Figma-style collaborator cursor: tailless arrowhead (upright kite rotated -25deg,
// 3px rounding, white outline), gradient fill, name tag off the bottom-right.
// Positions are tip coordinates in the container's space.
//
// Optional inertial tilt (c.tilt(s, params)): the arrow leans into its horizontal travel
// and springs back with a little follow-through when it stops. It is computed from the
// recorded moves at any frame, so it stays deterministic under seeking.
import { gsap } from 'gsap';
import { resolveEase, resolveDur } from '../ease.js';

const STYLE = `
.ms-cur { position: absolute; left: 0; top: 0; z-index: 50; }
.ms-cur .ptr { position: absolute; left: 0; top: 0; filter: drop-shadow(0 2px 3px rgba(0,0,0,.22)); transform-origin: 0 0; }
.ms-cur .lean { position: absolute; left: 0; top: 0; transform-origin: 12px 22px; }
.ms-cur svg { position: absolute; left: -8px; top: -8px; }
.ms-cur .tag { position: absolute; left: 22px; top: 34px; padding: 4px 10px 5px; border-radius: 4px 12px 12px 12px; color: #fff; font-size: 15px; line-height: 18px; font-weight: 600; white-space: nowrap; }
.ms-cur .ring { position: absolute; left: 0; top: 0; width: 40px; height: 40px; border-radius: 50%; border: 2px solid; opacity: 0; }`;
let styled = false;
let n = 0;

export function cursor(container, { name, from, to, tag = to, x = 0, y = 0, tagSize = 15, showTag = true }) {
  if (!styled) { const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st); styled = true; }
  const id = `ms-cur-${n++}`;
  const d = 'M0 0 L1.4 32.5 L9 19.3 L24 21.9 Z';
  const el = document.createElement('div');
  el.className = 'ms-cur'; el.dataset.name = `Cursor – ${name}`;
  el.innerHTML = `<div class="ring" style="border-color:${tag}"></div>
    <div class="ptr"><div class="lean"><svg width="44" height="52" viewBox="-8 -8 44 52">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
      <path d="${d}" fill="#fff" stroke="#fff" stroke-width="11" stroke-linejoin="round"/>
      <path d="${d}" fill="url(#${id})" stroke="url(#${id})" stroke-width="6" stroke-linejoin="round"/>
    </svg></div><div class="tag" style="${showTag ? '' : 'display:none;'}background:${tag};font-size:${tagSize}px;line-height:${Math.round(tagSize * 1.2)}px;padding:${Math.round(tagSize * .27)}px ${Math.round(tagSize * .67)}px ${Math.round(tagSize * .33)}px;left:${22 + (tagSize - 15)}px;top:${34 + (tagSize - 15)}px">${name}</div></div>`;
  container.appendChild(el);
  const ptr = el.querySelector('.ptr'), ring = el.querySelector('.ring'), lean = el.querySelector('.lean');
  const moves = [];   // { f0, f1, x0, x1, e } in frames, for the tilt
  const xAt = (f) => {
    let xv = x;
    for (const m of moves) {
      if (f < m.f0) break;
      xv = f >= m.f1 ? m.x1 : m.x0 + (m.x1 - m.x0) * m.e((f - m.f0) / (m.f1 - m.f0));
    }
    return xv;
  };
  gsap.set(el, { x, y });
  gsap.set(ring, { xPercent: -50, yPercent: -50, scale: 0.3, opacity: 0 });
  const c = {
    el, x, y,
    /** Glide the tip to (x, y). Pass x.ease etc. to override the beat's ease. */
    move(b, nx, ny, o = {}) {
      const f0 = b.f0 + (o.at || 0), d = o.dur !== undefined ? resolveDur(o.dur) : b.dur;
      moves.push({ f0, f1: f0 + Math.max(d, 1e-4), x0: c.x, x1: nx, e: o.ease !== undefined ? resolveEase(o.ease) : b.ease });
      moves.sort((a, z) => a.f0 - z.f0);
      b.fromTo(el, { x: c.x, y: c.y }, { x: nx, y: ny }, o); c.x = nx; c.y = ny; return b;
    },
    /**
     * Lean into horizontal motion only — angle ∝ horizontal speed (vertical motion never tilts).
     * params (object or () => object):
     *   strength: degrees per px/frame of horizontal speed · max: degree clamp (rarely reached)
     *   bounce: 0 = no follow-through (default), 1 = very springy · freq: smoothing speed (rad/frame)
     */
    tilt(s, params = {}) {
      const P = typeof params === 'function' ? params : () => params;
      s.onFrame((f) => {
        const { strength = 0.2, max = 24, bounce = 0, freq = 0.55 } = P();   // proportional to horizontal speed, settles without rocking
        const zeta = Math.max(0.05, 1 - bounce * 0.85), sub = 6, dt = 1 / sub;
        const target = (t) => Math.max(-max, Math.min(max, (xAt(t + 0.5) - xAt(t - 0.5)) * strength));
        // integrate a damped spring toward the target from 60 frames back (it settles well within that)
        let t = f - 60, a = target(t), w = 0;
        for (let i = 0; i < 60 * sub; i++, t += dt) {
          w += (freq * freq * (target(t) - a) - 2 * zeta * freq * w) * dt;
          a += w * dt;
        }
        gsap.set(lean, { rotation: Math.abs(a) < 0.01 ? 0 : a });
      });
      return c;
    },
    click(b, at = 0) {
      b.fromTo(ptr, { scale: 1 }, { scale: 0.84 }, { at, dur: 3, ease: 'fade' });
      b.fromTo(ptr, { scale: 0.84 }, { scale: 1 }, { at: at + 3, dur: 6, ease: 'fade' });
      b.fromTo(ring, { scale: 0.3, opacity: 0.6 }, { scale: 1.4, opacity: 0 }, { at, dur: 14, ease: 'fade' });
      return b;
    },
    fade(b, a, z, o = {}) { b.fromTo(el, { opacity: a }, { opacity: z }, o); return b; },
  };
  return c;
}
