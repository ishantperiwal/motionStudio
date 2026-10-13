// Motion Studio runtime: one paused GSAP master timeline, addressed in frames.
//
// A scene declares named *beats*. Each beat resolves its start/duration/ease from its
// options (absolute or relative to other beats), then adds tweens through the beat helper. Everything is driven by
// seek(frame), so preview, editor and render always show identical frames.

import { gsap } from 'gsap';
import { loadTokens, resolveEase, resolveDur, easePoints, getTokens } from './ease.js';

const q = new URLSearchParams(location.search);
export const MODE = q.has('render') ? 'render' : q.has('editor') ? 'editor' : 'play';

export async function studio(config) {
  const { id, width = 1920, height = 1080, fps = 25 } = config;
  const stage = config.stage || document.getElementById('stage');
  await loadTokens();

  const tl = gsap.timeline({ paused: true });
  const beats = [], byName = {}, hooks = [];
  let frames = config.frames || 0, current = 0;

  const ref = (n) => {
    const r = n === '<' ? beats[beats.length - 1] : byName[n];
    if (!r) throw new Error(`Beat "${n}" is not declared yet`);
    return r;
  };

  function beat(name, opts = {}, fn) {
    if (byName[name]) throw new Error(`Duplicate beat "${name}"`);
    const o = { ...opts };
    const params = {};
    for (const [k, def] of Object.entries(opts.params || {})) params[k] = typeof def === 'object' ? { ...def } : { value: def };

    let f0;
    if (typeof o.at === 'function') f0 = o.at(byName);
    else if (typeof o.at === 'number') f0 = o.at;
    else if (o.after) { const p = ref(o.after); f0 = p.f1 - (o.overlap || 0) * (p.f1 - p.f0) + (o.gap || 0); }
    else if (o.with) { const p = ref(o.with); f0 = p.f0 + (o.offset || 0); }
    else f0 = beats.length ? beats[beats.length - 1].f1 : 0;
    f0 = Math.round(f0 + (o.shift || 0));

    const dur = resolveDur(o.dur ?? 0);
    const easeSpec = o.ease ?? 'move';
    const ease = resolveEase(easeSpec);
    const rec = {
      name, f0, f1: f0 + dur, dur, easeSpec, stagger: o.stagger || 0,
      overlap: o.overlap, after: o.after, shift: o.shift || 0, note: opts.note || '',
      params, tags: new Set(opts.tags || []), targets: new Set(),
      usesEase: false, usesStagger: opts.stagger !== undefined,
      defaults: { dur: opts.dur, ease: opts.ease ?? 'move', stagger: opts.stagger, overlap: opts.overlap },
      firstStart: Infinity, lastStart: f0,
    };

    const track = (tg) => {
      if (!tg) return;
      if (typeof tg === 'string') gsap.utils.toArray(tg).forEach((e) => rec.targets.add(e));
      else if (tg instanceof Element) rec.targets.add(tg);
      else if (Array.isArray(tg) || tg instanceof NodeList) [...tg].forEach(track);
      else if (tg.__label) rec.tags.add(tg.__label);
    };
    const b = {
      name, f0, dur, ease, stagger: rec.stagger, rec,
      p: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v.value])),
      // x: { at: frames from beat start, dur: frames, ease: spec, i: stagger index }
      fromTo(targets, from, to, x = {}) {
        if (x.i) rec.usesStagger = true;
        const start = f0 + (x.at || 0) + (x.i || 0) * rec.stagger;
        const d = x.dur !== undefined ? resolveDur(x.dur) : dur;
        if (x.ease === undefined) rec.usesEase = true;
        const e = x.ease === undefined ? ease : resolveEase(x.ease);
        tl.fromTo(targets, from, { ...to, duration: Math.max(d, 0.0001) / fps, ease: e, immediateRender: false }, start / fps);
        track(targets);
        rec.f1 = Math.max(rec.f1, start + d);
        rec.firstStart = Math.min(rec.firstStart, start);
        rec.lastStart = Math.max(rec.lastStart, start);
        return b;
      },
      // cascade: same tween over a list, offset by the beat's stagger
      each(list, from, to, x = {}) {
        rec.usesStagger = true;
        gsap.utils.toArray(list).forEach((el, i) => b.fromTo(el, from, to, { ...x, i: (x.i || 0) + i }));
        return b;
      },
      set(targets, vars, at = 0) {
        tl.set(targets, vars, (f0 + at) / fps);
        track(targets);
        rec.f1 = Math.max(rec.f1, f0 + at);
        return b;
      },
      track(...els) { els.forEach(track); return b; },
      tag(tag) { rec.tags.add(tag); return b; },
      until(f1) { rec.f1 = Math.max(rec.f1, f1); return b; },
    };
    if (fn) fn(b);
    beats.push(rec); byName[name] = rec;
    return rec;
  }

  function seek(f) {
    current = Math.max(0, Math.min(frames - 1, f));
    tl.seek(current / fps, false);
    for (const h of hooks) h.fn(current);
    return current;
  }

  const beatInfo = (r) => ({
    name: r.name, f0: r.f0, f1: r.f1, dur: r.dur, stagger: r.stagger, overlap: r.overlap, after: r.after,
    shift: r.shift, note: r.note, usesEase: r.usesEase, usesStagger: r.usesStagger,
    ease: easePoints(r.easeSpec), easeToken: typeof r.easeSpec === 'string' ? r.easeSpec : null,
    params: r.params, tags: [...r.tags], defaults: r.defaults,
  });

  function describe(el) {
    const name = el.dataset?.name || el.id || '';
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean)[0] : el.className?.baseVal?.split(' ')[0];
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const text = (own || (el.children.length === 0 ? el.textContent.trim() : '')).slice(0, 60);
    return { name: name || `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`, named: !!name, text };
  }

  // What is under a region (stage px) at the current frame?
  function hitTest(region, range = [current, current]) {
    const hit = (r) => r.width > 0 && r.height > 0 && r.right > region.x && r.left < region.x + region.w && r.bottom > region.y && r.top < region.y + region.h;
    const visible = (el) => !el.checkVisibility || el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const inRange = (r) => r.f1 >= range[0] - 2 && r.f0 <= range[1] + 2;
    const beatsHit = [];
    for (const r of beats) {
      if (!inRange(r)) continue;
      const on = [...r.targets].some((el) => el.isConnected && visible(el) && hit(el.getBoundingClientRect()));
      if (on || r.tags.has('camera')) beatsHit.push({ name: r.name, f0: r.f0, f1: r.f1, via: on ? 'region' : 'camera' });
    }
    const area = region.w * region.h, out = [];
    for (const el of stage.querySelectorAll('*')) {
      const rc = el.getBoundingClientRect();
      if (!hit(rc) || !visible(el)) continue;
      const ix = Math.max(0, Math.min(rc.right, region.x + region.w) - Math.max(rc.left, region.x));
      const iy = Math.max(0, Math.min(rc.bottom, region.y + region.h) - Math.max(rc.top, region.y));
      const a = rc.width * rc.height;
      if (a > area * 4 && ix * iy < a * 0.5) continue;      // big containers that merely pass through
      const d = describe(el);
      if (!d.named && !d.text) continue;
      const inter = ix * iy;
      out.push({ ...d, fit: inter / (a + area - inter), rect: [rc.left, rc.top, rc.width, rc.height].map(Math.round) });
    }
    // best match first: how closely the element fills the box (a tight box ranks its element top); names break ties
    out.sort((a, b) => (b.fit + 0.15 * b.named) - (a.fit + 0.15 * a.named));
    return { beats: beatsHit, elements: out.slice(0, 10) };
  }

  function fit() {
    if (MODE !== 'play') return;
    const k = Math.min(innerWidth / width, innerHeight / height);
    stage.style.transform = `scale(${k})`;
  }

  const api = {
    id, width, height, fps, tl, beat, seek,
    beats: byName,
    get frames() { return frames; },
    /** Per-frame hook (after tweens are applied). Higher order runs later; layers render at 100. */
    onFrame(fn, order = 0) { hooks.push({ fn, order }); hooks.sort((a, b) => a.order - b.order); return api; },
    /** Finish building. tail = frames to hold after the last beat. */
    ready({ tail = 0 } = {}) {
      const end = Math.max(0, ...beats.map((r) => r.f1));
      frames = config.frames || Math.ceil(end + tail) + 1;
      if (config.frames && end > frames - 1) console.warn(`[studio] beats run to frame ${end}, past the last frame ${frames - 1}`);
      tl.set({}, {}, (frames - 1) / fps);
      seek(0);
      window.__timelines = { ...(window.__timelines || {}), [id]: tl };   // HyperFrames-style registration
      window.FPS = fps; window.FRAME_COUNT = frames;
      window.seek = seek;
      window.__studio = {
        id, width, height, fps, frames, mode: MODE, tokens: getTokens(),
        seek, frame: () => current, beats: () => beats.map(beatInfo), hitTest,
      };
      window.animationReady = true;
      if (window.parent !== window) window.parent.postMessage({ type: 'studio:ready', id }, '*');
      if (MODE === 'play') {
        fit(); addEventListener('resize', fit);
        const t0 = performance.now();
        const loop = (now) => { seek(((now - t0) / 1000 * fps) % frames); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      }
      return api;
    },
  };
  stage.style.width = width + 'px'; stage.style.height = height + 'px';
  return api;
}
