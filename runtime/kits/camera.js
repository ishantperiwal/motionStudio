// Camera: scales/translates one wrapper element. Views are focus points in the
// wrapped content's coordinates plus a zoom; zoom is interpolated geometrically.
// It never parks: after each move it keeps drifting slowly the same way (`drift`, as a fraction of that move per
// second) until the next move starts, which blends the drift away over its own duration. drift: 0 turns it off.
//
//   const cam = camera(s, el, { origin: {x: 100, y: 50}, views: { full: {x, y, zoom} }, start: 'full', drift: 0.04 })
//   s.beat('cam.in', { dur: 36 }, (b) => cam.to(b, 'detail'))

export function camera(s, el, { origin = { x: 0, y: 0 }, views, start, drift = 0.04 }) {
  const toState = (v) => ({ fx: v.x, fy: v.y, ls: Math.log(v.zoom ?? 1) });
  const state = Object.assign(toState(views[start]), { __label: 'camera' });
  let prev = { ...toState(views[start]) };
  el.style.transformOrigin = '0 0';
  const moves = [];   // { f0, f1, d: { fx, fy, ls } } in frames, the delta of each move
  const smooth = (t) => t * t * (3 - 2 * t);
  const driftAt = (f) => {   // the drift carried over from earlier moves (a pure function of the frame)
    const o = { fx: 0, fy: 0, ls: 0 };
    moves.forEach((m, i) => {
      const next = moves[i + 1], tEnd = next ? next.f0 : Infinity, secs = (Math.min(f, tEnd) - m.f1 + 8) / s.fps;   // starts in the move's ease-out tail
      if (secs <= 0) return;
      const fade = next && f > next.f0 ? 1 - smooth(Math.min(1, (f - next.f0) / Math.max(1, next.f1 - next.f0))) : 1;
      for (const k of ['fx', 'fy', 'ls']) if (!next || m.d[k] * next.d[k] >= 0) o[k] += m.d[k] * drift * secs * fade;   // never drift against the next move (no reversals)
    });
    return o;
  };
  s.onFrame((f) => {
    const dr = drift ? driftAt(f) : { fx: 0, fy: 0, ls: 0 }, fx = state.fx + dr.fx, fy = state.fy + dr.fy, k = Math.exp(state.ls + dr.ls);
    el.style.transform = `translate(${s.width / 2 - (origin.x + fx) * k}px, ${s.height / 2 - (origin.y + fy) * k}px) scale(${k})`;
  });
  return {
    state, views,
    to(b, view, x = {}) {
      const v = typeof view === 'string' ? views[view] : view;
      if (!v) throw new Error(`Unknown camera view "${view}"`);
      const next = toState(v);
      b.fromTo(state, { ...prev }, next, x).tag('camera');
      const f0 = b.f0 + (x.at || 0), dur = typeof x.dur === 'number' ? x.dur : b.dur;
      moves.push({ f0, f1: f0 + dur, d: { fx: next.fx - prev.fx, fy: next.fy - prev.fy, ls: next.ls - prev.ls } }); moves.sort((a, c) => a.f0 - c.f0);
      prev = next;
      return b;
    },
  };
}
