// Motion Studio Lottie Stage: renders Lottie animations in `lottie-web` SVG mode,
// applies live SVG filter primitives for fast iteration, and provides exact SVG DOM
// reverse-lookup (`hitTest`, `inspectAt`) matching the Motion Studio `window.__studio` contract.
import lottie from 'lottie-web';

const SVG_NS = 'http://www.w3.org/2000/svg';

function parseDefsSvg(defsXml) {
  if (!defsXml || !defsXml.trim()) return null;
  const wrap = `<svg xmlns="${SVG_NS}">${defsXml}</svg>`;
  const doc = new DOMParser().parseFromString(wrap, 'image/svg+xml');
  return doc.querySelector('defs');
}

function summarizeProp(prop, frame) {
  if (!prop) return null;
  if (prop.s === true) {
    return { separated: true, x: summarizeProp(prop.x, frame), y: summarizeProp(prop.y, frame) };
  }
  if (prop.a === 0) return { animated: false, value: prop.k };
  if (prop.a === 1 && Array.isArray(prop.k)) {
    const kfs = prop.k;
    const idx = kfs.findIndex((kf, i) => {
      const next = kfs[i + 1];
      return next ? frame >= kf.t && frame <= next.t : frame >= kf.t;
    });
    return {
      animated: true,
      count: kfs.length,
      activeSegment: idx >= 0 ? kfs.slice(idx, idx + 2) : kfs.slice(-1),
    };
  }
  return null;
}

function summarizeLayer(layer, frame) {
  return {
    ind: layer.ind,
    layerId: layer.ln || layer.nm,
    name: layer.nm,
    type: layer.ty,
    ip: layer.ip,
    op: layer.op,
    tt: layer.tt || 0,
    td: layer.td || 0,
    anchor: summarizeProp(layer.ks?.a, frame),
    position: summarizeProp(layer.ks?.p, frame),
    scale: summarizeProp(layer.ks?.s, frame),
    rotation: summarizeProp(layer.ks?.r, frame),
    opacity: summarizeProp(layer.ks?.o, frame),
  };
}

export async function mountLottieStage({ id, container, animationUrl, filtersUrl, compUrl }) {
  const [animData, filterMeta, compSpec, tokens] = await Promise.all([
    fetch(animationUrl, { cache: 'no-store' }).then((r) => r.json()),
    fetch(filtersUrl, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { defsXml: '', filters: [] })).catch(() => ({ defsXml: '', filters: [] })),
    fetch(compUrl, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/tokens/motion.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { ease: {}, dur: {} })).catch(() => ({ ease: {}, dur: {} })),
  ]);

  const width = animData.w || compSpec?.width || 512;
  const height = animData.h || compSpec?.height || 512;
  const fps = animData.fr || compSpec?.fps || 60;
  const frames = Math.max(1, Math.round((animData.op || 60) - (animData.ip || 0)));

  const stage = document.getElementById('stage');
  document.documentElement.style.width = '100%';
  document.documentElement.style.height = '100%';
  document.documentElement.style.background = 'transparent';
  document.body.style.width = '100%';
  document.body.style.height = '100%';
  document.body.style.background = 'transparent';
  stage.style.width = width + 'px';
  stage.style.height = height + 'px';

  let currentData = animData;
  let previewMode = 'live'; // 'live' | 'baked'
  let current = 0;
  let viewK = 1;
  let anim = null;

  function applyLiveSvgFilters() {
    if (previewMode !== 'live') return;
    const svg = container.querySelector('svg');
    if (!svg || !filterMeta?.filters?.length) return;
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS(SVG_NS, 'defs');
      svg.prepend(defs);
    }
    const parsedDefs = parseDefsSvg(filterMeta.defsXml);
    if (parsedDefs) {
      for (const child of [...parsedDefs.children]) {
        const fid = child.getAttribute('id');
        if (fid && !defs.querySelector(`#${CSS.escape(fid)}`)) {
          defs.append(document.importNode(child, true));
        }
      }
    }
    for (const f of filterMeta.filters) {
      const firstId = String(f.id || '').split('+')[0];
      if (!firstId) continue;
      const g = svg.querySelector(`#${CSS.escape(f.layerId)}`);
      if (g) {
        g.setAttribute('filter', `url(#${firstId})`);
        g.dataset.msFilter = firstId;
      }
    }
  }

  async function mountData(data) {
    if (anim) {
      try { anim.destroy(); } catch {}
      anim = null;
    }
    container.innerHTML = '';
    currentData = data;
    anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: structuredClone(data),
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        progressiveLoad: false,
      },
    });
    if (!anim.isLoaded) {
      await new Promise((ok) => anim.addEventListener('DOMLoaded', ok));
    }
    applyLiveSvgFilters();
    anim.goToAndStop(current, true);
  }

  await mountData(animData);

  function seek(f) {
    current = Math.max(0, Math.min(frames - 1, f));
    if (anim) anim.goToAndStop(current, true);
    return current;
  }

  function setView(k) {
    viewK = k;
    stage.style.transform = `scale(${k})`;
    stage.style.transformOrigin = '0 0';
  }

  function setBackdrop(mode) {
    if (mode === 'light') {
      stage.style.background = '#f5f6f8';
      stage.style.backgroundImage = 'none';
    } else if (mode === 'dark') {
      stage.style.background = '#13151a';
      stage.style.backgroundImage = 'none';
    } else {
      stage.style.background = '#1c1e24';
      stage.style.backgroundImage =
        'linear-gradient(45deg, #262932 25%, transparent 25%), linear-gradient(-45deg, #262932 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #262932 75%), linear-gradient(-45deg, transparent 75%, #262932 75%)';
      stage.style.backgroundSize = '24px 24px';
      stage.style.backgroundPosition = '0 0, 0 12px, 12px -12px, -12px 0';
    }
  }

  let bakedKey = '';
  let lastBakedInfo = null;
  async function setPreviewMode(mode, opts = {}) {
    const fxRes = Number(opts.fxRes);
    const scale = Math.max(0.125, Math.min(3, Number(opts.scale) || 2));
    const rasterFmt = opts.rasterFmt === 'webp' ? 'webp' : 'png';
    const nextKey = mode === 'baked' ? `${Number.isFinite(fxRes) && fxRes > 0 ? `r${Math.round(fxRes)}` : `s${scale}`}:${rasterFmt}` : '';
    if (mode === previewMode && nextKey === bakedKey) return lastBakedInfo || { mode: previewMode };
    if (mode === 'baked') {
      const q = Number.isFinite(fxRes) && fxRes > 0
        ? `fxRes=${Math.round(fxRes)}`
        : `scale=${scale}`;
      const res = await fetch(
        `/api/lottie/preview-baked?scene=${encodeURIComponent(id)}&${q}&rasterFmt=${rasterFmt}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('Failed to build raster-baked preview');
      const baked = await res.json();
      previewMode = 'baked';
      bakedKey = nextKey;
      lastBakedInfo = { mode: 'baked', bakedBytes: baked.bakedBytes || 0, bakedCount: baked.bakedCount || 0 };
      await mountData(baked.doc);
      return lastBakedInfo;
    } else {
      previewMode = 'live';
      bakedKey = '';
      lastBakedInfo = { mode: 'live', bakedBytes: 0, bakedCount: 0 };
      await mountData(animData);
      return lastBakedInfo;
    }
  }

  function getLayerElementRects() {
    const svg = container.querySelector('svg');
    if (!svg) return [];
    const results = [];
    const seen = new Set();
    const layers = currentData.layers || [];
    for (const layer of layers) {
      const lid = layer.ln || layer.nm;
      if (!lid || seen.has(lid)) continue;
      const g = svg.querySelector(`#${CSS.escape(lid)}`) || svg.querySelector(`.ms-layer-${lid.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
      if (!g) continue;
      const st = getComputedStyle(g);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) <= 0.01) continue;
      const r = g.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      seen.add(lid);
      results.push({
        layer,
        layerId: lid,
        name: layer.nm || lid,
        rect: {
          left: r.left / viewK,
          top: r.top / viewK,
          right: r.right / viewK,
          bottom: r.bottom / viewK,
          width: r.width / viewK,
          height: r.height / viewK,
        },
      });
    }
    return results;
  }

  function hitTest(region, range = [current, current]) {
    const area = Math.max(1, region.w * region.h);
    const out = [];
    for (const entry of getLayerElementRects()) {
      const rc = entry.rect;
      if (rc.right <= region.x || rc.left >= region.x + region.w || rc.bottom <= region.y || rc.top >= region.y + region.h) {
        continue;
      }
      const ix = Math.max(0, Math.min(rc.right, region.x + region.w) - Math.max(rc.left, region.x));
      const iy = Math.max(0, Math.min(rc.bottom, region.y + region.h) - Math.max(rc.top, region.y));
      const inter = ix * iy;
      if (inter <= 0) continue;
      const a = rc.width * rc.height;
      const fit = inter / Math.max(1, a + area - inter);
      out.push({
        name: entry.layerId,
        layerId: entry.layerId,
        label: entry.name,
        ind: entry.layer.ind,
        named: true,
        text: entry.layer.ty === 2 ? 'raster' : (filterMeta?.filters?.some((f) => f.layerId === entry.layerId) ? 'svg-fx' : 'vector'),
        fit,
        rect: [rc.left, rc.top, rc.width, rc.height].map(Math.round),
        keyframes: summarizeLayer(entry.layer, current),
      });
    }
    out.sort((a, b) => b.fit - a.fit);

    const primBeats = buildBeats().filter((b) => b.f1 >= range[0] - 2 && b.f0 <= range[1] + 2);
    return {
      beats: primBeats.map(({ name, f0, f1 }) => ({ name, f0, f1, via: 'lottie-primitive' })),
      elements: out.slice(0, 10),
    };
  }

  function inspectAt(x, y) {
    const res = hitTest({ x: x - 2, y: y - 2, w: 4, h: 4 });
    return res.elements[0] || null;
  }

  function buildBeats() {
    const prims = compSpec?.primitives || [];
    return prims.map((p, idx) => {
      const f0 = p.startFrame ?? 0;
      const dur = typeof p.duration === 'number' ? p.duration : Math.round(fps * 0.5);
      const target = p.layerId || p.frontLayerId || (p.layerIds ? p.layerIds.join(',') : `prim-${idx + 1}`);
      return {
        name: `${p.kind}:${target}`,
        f0,
        f1: Math.min(frames - 1, f0 + dur),
        dur,
        stagger: p.staggerFrames || 0,
        note: p.kind,
        tags: ['lottie'],
      };
    });
  }

  setBackdrop(compSpec?.background && compSpec.background !== 'transparent' ? 'dark' : 'checker');

  const api = {
    id,
    isLottie: true,
    width,
    height,
    fps,
    frames,
    tokens: compSpec?.tokens || tokens,
    filtersCount: filterMeta?.filters?.length || 0,
    previewMode: () => previewMode,
    seek,
    frame: () => current,
    setView,
    setBackdrop,
    setPreviewMode,
    hitTest,
    inspectAt,
    beats: buildBeats,
    layers: () => (currentData.layers || []).map((l) => summarizeLayer(l, current)),
  };

  window.__studio = api;
  window.seek = seek;
  window.animationReady = true;
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'studio:ready', id, isLottie: true }, '*');
  }
  return api;
}
