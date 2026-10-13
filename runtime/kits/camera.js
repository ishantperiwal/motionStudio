// Camera: scales/translates one wrapper element. Views are focus points in the
// wrapped content's coordinates plus a zoom; zoom is interpolated geometrically.
//
//   const cam = camera(s, el, { origin: {x: 100, y: 50}, views: { full: {x, y, zoom} }, start: 'full' })
//   s.beat('cam.in', { dur: 36 }, (b) => cam.to(b, 'detail'))

export function camera(s, el, { origin = { x: 0, y: 0 }, views, start }) {
  const toState = (v) => ({ fx: v.x, fy: v.y, ls: Math.log(v.zoom ?? 1) });
  const state = Object.assign(toState(views[start]), { __label: 'camera' });
  let prev = { ...toState(views[start]) };
  el.style.transformOrigin = '0 0';
  s.onFrame(() => {
    const k = Math.exp(state.ls);
    el.style.transform = `translate(${s.width / 2 - (origin.x + state.fx) * k}px, ${s.height / 2 - (origin.y + state.fy) * k}px) scale(${k})`;
  });
  return {
    state, views,
    to(b, view, x = {}) {
      const v = typeof view === 'string' ? views[view] : view;
      if (!v) throw new Error(`Unknown camera view "${view}"`);
      const next = toState(v);
      b.fromTo(state, { ...prev }, next, x).tag('camera');
      prev = next;
      return b;
    },
  };
}
