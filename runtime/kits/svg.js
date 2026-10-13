// Load an SVG (e.g. an Affinity export) inline so every named group can be animated.
// Affinity layer names (affinity:id / serif:id) become data-name, so beats, the
// editor's hit-testing and notes all refer to the names you gave layers in Affinity.
//
//   const art = await loadSvg('./assets/menu.svg', { into: el, width: 550 });
//   art.get('Member – Mei')            // first match
//   art.all('Avatar Circle')           // every match
//   art.get('Member – Mei › Avatar – M')  // path through groups
import { gsap } from 'gsap';

export async function loadSvg(url, { into, width, height, pivots = true } = {}) {
  const txt = await (await fetch(url, { cache: 'no-store' })).text();
  const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true);
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width) {
    const w = width ?? (height ? (height * vb.width) / vb.height : vb.width);
    svg.setAttribute('width', w);
    svg.setAttribute('height', height ?? (w * vb.height) / vb.width);
  }
  svg.style.overflow = 'visible';
  for (const el of svg.querySelectorAll('*')) {
    const n = el.getAttribute('affinity:id') || el.getAttribute('serif:id');
    if (n) el.dataset.name = n;
  }
  if (into) into.appendChild(svg);
  const named = [...svg.querySelectorAll('[data-name]')];
  // Animated layers pivot around their own artwork centre unless told otherwise.
  if (pivots && into) named.forEach((el) => gsap.set(el, { transformOrigin: '50% 50%' }));
  const match = (path, root = svg) => {
    const [head, ...rest] = path.split(/\s*›\s*/);
    const hits = [...root.querySelectorAll('[data-name]')].filter((e) => e.dataset.name === head);
    return rest.length ? hits.flatMap((h) => match(rest.join(' › '), h)) : hits;
  };
  return {
    svg, names: [...new Set(named.map((e) => e.dataset.name))],
    get(path) { const e = match(path)[0]; if (!e) throw new Error(`SVG layer "${path}" not found in ${url}`); return e; },
    all: (path) => match(path),
  };
}
