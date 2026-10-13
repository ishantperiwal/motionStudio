// Cubic-bezier easing (y may leave 0..1 for anticipation / overshoot) and motion tokens.

export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  const fn = (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - t, d = dx(u);
      if (Math.abs(e) < 1e-7) return sy(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    let lo = 0, hi = 1; u = t;
    for (let i = 0; i < 40; i++) { const x = sx(u); if (Math.abs(x - t) < 1e-7) break; if (x < t) lo = u; else hi = u; u = (lo + hi) / 2; }
    return sy(u);
  };
  fn.points = [x1, y1, x2, y2];
  return fn;
}

let tokens = { ease: {}, dur: {} };
export async function loadTokens() {
  try { tokens = await (await fetch('/tokens/motion.json', { cache: 'no-store' })).json(); } catch { /* defaults */ }
  return tokens;
}
export const getTokens = () => tokens;

// spec: token name | [x1,y1,x2,y2] | 'none' | function
export function resolveEase(spec) {
  if (typeof spec === 'function') return spec;
  if (spec === 'none' || spec === 'linear') return (t) => t;
  if (Array.isArray(spec)) return bezier(...spec);
  const pts = tokens.ease?.[spec];
  if (!pts) throw new Error(`Unknown ease token "${spec}"`);
  return bezier(...pts);
}
export function easePoints(spec) {
  if (Array.isArray(spec)) return spec;
  if (typeof spec === 'string') return tokens.ease?.[spec] || (spec === 'none' ? [0, 0, 1, 1] : null);
  return spec?.points || null;
}
export function resolveDur(spec) {
  return typeof spec === 'string' ? tokens.dur?.[spec] ?? 0 : spec ?? 0;
}

// deterministic PRNG for anything "random"
export function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
