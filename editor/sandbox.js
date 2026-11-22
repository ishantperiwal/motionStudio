// Motion Studio — After Effects-lite Motion Feel Editor
// Clear prompt block + Live Stage (Shift-lock H/V drag) + Right-side Graph Editor
// (box-select, dynamic tabs for selected properties, double-click curve to insert keyframe,
// draggable Bezier handles) + Bottom Timeline with Position (P), Scale (S), Rotation (R).

const SVG_NS = 'http://www.w3.org/2000/svg';
let nextKfId = 1;
const makeKf = (t, v, ease = [0.33, 0, 0.67, 1]) => ({ id: `kf${nextKfId++}`, t, v, ease: [...ease] });

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : String(c));
  return node;
}

function svgNode(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

function evalCubic(t, p1, p2) {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function evalBezierY(xTarget, ease) {
  if (xTarget <= 0) return 0;
  if (xTarget >= 1) return 1;
  const [x1, y1, x2, y2] = ease || [0.33, 0, 0.67, 1];
  let u = xTarget;
  for (let i = 0; i < 8; i++) {
    const err = evalCubic(u, x1, x2) - xTarget;
    if (Math.abs(err) < 1e-6) break;
    const d = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(d) < 1e-6) break;
    u = clamp(u - err / d, 0, 1);
  }
  return evalCubic(u, y1, y2);
}

const EASE_PRESETS = {
  'Easy Ease': [0.33, 0, 0.67, 1],
  'Settle': [0.16, 1, 0.3, 1],
  'Snappy': [0.2, 0, 0, 1],
  'Overshoot': [0.34, 1.45, 0.64, 1],
  'Linear': [0, 0, 1, 1],
};

const PROP_ORDER = ['position', 'scale', 'rotation'];
const PROP_LABELS = { position: 'Position', scale: 'Scale', rotation: 'Rotation' };

function sortKfs(list) {
  list.sort((a, b) => a.t - b.t);
}

function evalTrack(kfs, frame, fallback) {
  if (!kfs.length) return Array.isArray(fallback) ? [...fallback] : fallback;
  if (frame <= kfs[0].t) return Array.isArray(kfs[0].v) ? [...kfs[0].v] : kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (frame >= last.t) return Array.isArray(last.v) ? [...last.v] : last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (frame >= a.t && frame <= b.t) {
      const span = Math.max(0.0001, b.t - a.t);
      const u = (frame - a.t) / span;
      const e = evalBezierY(u, a.ease);
      if (Array.isArray(a.v)) {
        return a.v.map((av, idx) => av + (b.v[idx] - av) * e);
      }
      return a.v + (b.v - a.v) * e;
    }
  }
  return Array.isArray(last.v) ? [...last.v] : last.v;
}

function toLottieScalarTrack(kfs) {
  if (!kfs.length) return null;
  sortKfs(kfs);
  return kfs.map((kf, idx) => {
    const next = kfs[idx + 1];
    if (!next) return { t: r2(kf.t), s: [r2(kf.v)] };
    const [x1, y1, x2, y2] = kf.ease || [0.33, 0, 0.67, 1];
    return {
      t: r2(kf.t),
      s: [r2(kf.v)],
      e: [r2(next.v)],
      o: { x: [r3(clamp(x1, 0, 1))], y: [r3(y1)] },
      i: { x: [r3(clamp(x2, 0, 1))], y: [r3(y2)] },
    };
  });
}

function toLottieVecTrack(kfs, third = 0) {
  if (!kfs.length) return null;
  sortKfs(kfs);
  return kfs.map((kf, idx) => {
    const next = kfs[idx + 1];
    const s = [r2(kf.v[0]), r2(kf.v[1]), third];
    if (!next) return { t: r2(kf.t), s };
    const [x1, y1, x2, y2] = kf.ease || [0.33, 0, 0.67, 1];
    const cx1 = r3(clamp(x1, 0, 1)), cy1 = r3(y1), cx2 = r3(clamp(x2, 0, 1)), cy2 = r3(y2);
    return {
      t: r2(kf.t),
      s,
      e: [r2(next.v[0]), r2(next.v[1]), third],
      o: { x: [cx1, cx1, cx1], y: [cy1, cy1, cy1] },
      i: { x: [cx2, cx2, cx2], y: [cy2, cy2, cy2] },
    };
  });
}

export function openProxySandbox({ session, onSubmit, onCancel }) {
  document.getElementById('sandboxModal')?.remove();

  const STAGE_W = 460;
  const STAGE_H = 260;
  const CX = STAGE_W / 2;
  const CY = STAGE_H / 2;
  const fps = session?.fps || 60;
  let totalFrames = session?.durationFrames || Math.round(fps * 0.9);
  let frame = 0;
  let playing = false;
  let rafId = 0;

  const initProp = session?.property === 'scale' ? 'scale' : session?.property === 'rotation' ? 'rotation' : 'position';
  const tracks = { position: [], scale: [], rotation: [] };
  if (initProp === 'scale') {
    tracks.scale = [
      makeKf(0, [80, 80], [0.22, 1, 0.36, 1]),
      makeKf(Math.round(totalFrames * 0.65), [115, 115]),
    ];
  } else if (initProp === 'rotation') {
    tracks.rotation = [
      makeKf(0, -25, [0.22, 1, 0.36, 1]),
      makeKf(Math.round(totalFrames * 0.65), 25),
    ];
  } else {
    tracks.position = [
      makeKf(0, [-120, 0], [0.22, 1, 0.36, 1]),
      makeKf(Math.round(totalFrames * 0.7), [120, 0]),
    ];
  }

  const statics = { position: [0, 0], scale: [100, 100], rotation: 0 };

  // Multi-keyframe selection (by stable kf.id). Select all initial keyframes by default!
  const selectedIds = new Set(tracks[initProp].map((k) => k.id));
  let activeProp = initProp;

  const isSelected = (kf) => selectedIds.has(kf.id);
  const selectedForProp = (prop) => tracks[prop].filter((k) => selectedIds.has(k.id));
  const selectedProps = () => PROP_ORDER.filter((p) => tracks[p].some((k) => selectedIds.has(k.id)));
  const allSelectedEntries = () => {
    const out = [];
    for (const p of PROP_ORDER) {
      for (const kf of tracks[p]) if (selectedIds.has(kf.id)) out.push({ prop: p, kf });
    }
    return out;
  };

  function ensureValidActiveProp() {
    const sp = selectedProps();
    if (sp.length > 0 && !sp.includes(activeProp)) {
      activeProp = sp[0];
    }
  }

  function selectAllOnProp(prop, additive = false) {
    if (!additive) selectedIds.clear();
    const list = tracks[prop];
    const allAlready = list.length > 0 && list.every((k) => selectedIds.has(k.id));
    if (additive && allAlready) {
      list.forEach((k) => selectedIds.delete(k.id));
    } else {
      list.forEach((k) => selectedIds.add(k.id));
    }
    activeProp = prop;
    ensureValidActiveProp();
  }

  const curVal = (prop, f = frame) => evalTrack(tracks[prop], f, statics[prop]);
  const findKfAt = (prop, f) => tracks[prop].findIndex((k) => Math.abs(k.t - f) < 0.5);

  function upsertKeyframe(prop, f, val, selectMode = 'add') {
    const fi = clamp(Math.round(f), 0, totalFrames);
    const list = tracks[prop];
    const existing = findKfAt(prop, fi);
    const vCopy = Array.isArray(val) ? [...val] : val;
    let kf;
    if (existing >= 0) {
      kf = list[existing];
      kf.v = vCopy;
    } else {
      kf = makeKf(fi, vCopy);
      list.push(kf);
      sortKfs(list);
    }
    if (selectMode === 'only') {
      selectedIds.clear();
      selectedIds.add(kf.id);
      activeProp = prop;
    } else if (selectMode === 'add') {
      selectedIds.add(kf.id);
      activeProp = prop;
    }
    renderAll();
    return kf;
  }

  function dropKeyframeNow(prop) {
    const val = curVal(prop, frame);
    upsertKeyframe(prop, frame, val, 'add');
    flashShortcut(`${PROP_LABELS[prop]} keyframe added at f${Math.round(frame)}`);
  }

  function toggleKeyframeAtPlayhead(prop) {
    const fi = Math.round(frame);
    const idx = findKfAt(prop, fi);
    if (idx >= 0) {
      selectedIds.delete(tracks[prop][idx].id);
      tracks[prop].splice(idx, 1);
      ensureValidActiveProp();
      renderAll();
    } else {
      dropKeyframeNow(prop);
    }
  }

  function deleteSelectedKeyframes() {
    if (!selectedIds.size) return;
    for (const p of PROP_ORDER) {
      tracks[p] = tracks[p].filter((k) => !selectedIds.has(k.id));
    }
    selectedIds.clear();
    ensureValidActiveProp();
    renderAll();
  }

  function setValueAtPlayhead(prop, newVal, autoCreate = false) {
    statics[prop] = Array.isArray(newVal) ? [...newVal] : newVal;
    const list = tracks[prop];
    const fi = Math.round(frame);
    const idx = findKfAt(prop, fi);
    if (idx >= 0) {
      list[idx].v = Array.isArray(newVal) ? [...newVal] : newVal;
      selectedIds.add(list[idx].id);
      activeProp = prop;
    } else if (list.length > 0 || autoCreate) {
      upsertKeyframe(prop, fi, newVal, 'add');
      return;
    }
    renderAll();
  }

  function applyEaseToSelected(easeTuple) {
    let applied = 0;
    for (const p of PROP_ORDER) {
      const list = tracks[p];
      if (list.length < 2) continue;
      for (let i = 0; i < list.length - 1; i++) {
        // Apply to segment if either endpoint is selected
        if (selectedIds.has(list[i].id) || selectedIds.has(list[i + 1].id)) {
          list[i].ease = [...easeTuple];
          applied++;
        }
      }
    }
    if (applied === 0 && tracks[activeProp].length >= 2) {
      tracks[activeProp].slice(0, -1).forEach((k) => { k.ease = [...easeTuple]; });
    }
    renderAll();
  }

  const stopPlay = () => {
    playing = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    playBtn.textContent = '▶';
  };

  function startPlay() {
    if (playing) return stopPlay();
    playing = true;
    playBtn.textContent = '❚❚';
    let lastT = performance.now();
    const tick = (now) => {
      if (!playing) return;
      const dt = (now - lastT) / 1000;
      lastT = now;
      frame += dt * fps;
      if (frame > totalFrames) frame = 0;
      renderStage();
      renderTimelineCursor();
      renderGraphPlayhead();
      renderPropReadouts();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  const closeModal = (cancelled = false) => {
    stopPlay();
    removeEventListener('keydown', onKey, true);
    modal.remove();
    if (cancelled) onCancel?.();
  };

  // ---------------- DOM construction ----------------
  const toastEl = el('span', { class: 'mfe-toast' }, '');
  let toastTimer = 0;
  function flashShortcut(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  const askHeading = session?.layerId
    ? `Define the motion feel for "${session.layerId}"`
    : 'Define the motion feel';
  const askText = session?.prompt ||
    'Drag the block (hold Shift to lock horizontal/vertical), box-select keyframes across tracks, and double-click any curve in the Graph Editor to drop and sculpt new keyframes.';

  // Stage
  const pathSvg = svgNode('svg', { class: 'mfe-stage-svg', viewBox: `0 0 ${STAGE_W} ${STAGE_H}` });
  const guideH = svgNode('line', { x1: 24, y1: CY, x2: STAGE_W - 24, y2: CY, class: 'mfe-axis' });
  const guideV = svgNode('line', { x1: CX, y1: 18, x2: CX, y2: STAGE_H - 18, class: 'mfe-axis' });
  const motionPath = svgNode('path', { class: 'mfe-motion-path', d: '' });
  const kfDotsGroup = svgNode('g', {});
  pathSvg.append(guideH, guideV, motionPath, kfDotsGroup);

  const stageObj = el('div', { class: 'mfe-obj', title: 'Drag to move (hold Shift to lock horizontal/vertical)' },
    el('span', { class: 'mfe-obj-core' }));
  const axisPill = el('div', { class: 'mfe-axis-pill', hidden: true }, '');
  const stageEl = el('div', { class: 'mfe-stage', style: { width: STAGE_W + 'px', height: STAGE_H + 'px' } },
    pathSvg, stageObj, axisPill);

  stageEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stopPlay();
    stageEl.setPointerCapture(e.pointerId);
    const startMouseX = e.clientX, startMouseY = e.clientY;
    const [startX, startY] = curVal('position');
    let lockedAxis = null;

    const onMove = (ev) => {
      let dx = ev.clientX - startMouseX;
      let dy = ev.clientY - startMouseY;
      if (ev.shiftKey) {
        if (!lockedAxis && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
          lockedAxis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
        }
        if (lockedAxis === 'h') dy = 0;
        else if (lockedAxis === 'v') dx = 0;
        axisPill.textContent = lockedAxis === 'v' ? 'Shift: Vertical lock' : 'Shift: Horizontal lock';
        axisPill.hidden = false;
      } else {
        lockedAxis = null;
        axisPill.hidden = true;
      }
      const nx = clamp(Math.round(startX + dx), -CX + 34, CX - 34);
      const ny = clamp(Math.round(startY + dy), -CY + 34, CY - 34);
      setValueAtPlayhead('position', [nx, ny], true);
    };
    const onUp = () => {
      axisPill.hidden = true;
      stageEl.removeEventListener('pointermove', onMove);
      stageEl.removeEventListener('pointerup', onUp);
    };
    stageEl.addEventListener('pointermove', onMove);
    stageEl.addEventListener('pointerup', onUp);
  });

  // Right-side Graph Editor with dynamic selected-property tabs + box-select + double-click insert
  const GW = 340, GH = 230, GPAD_L = 34, GPAD_R = 14, GPAD_T = 22, GPAD_B = 22;
  const graphTabsEl = el('div', { class: 'mfe-gtabs' });
  const graphSvg = svgNode('svg', { class: 'mfe-graph-svg', viewBox: `0 0 ${GW} ${GH}` });
  const easeRow = el('div', { class: 'mfe-ease-row' },
    ...Object.entries(EASE_PRESETS).map(([label, pts]) =>
      el('button', { class: 'mfe-pill', title: `Apply ${label} [${pts.join(', ')}]`, onclick: () => applyEaseToSelected(pts) }, label),
    ),
  );

  let graphPlayheadLine = null;
  let graphState = { minT: 0, maxT: totalFrames, minV: -150, maxV: 150, prop: activeProp };

  function graphValueOf(prop, v) {
    if (prop === 'position') return v[0];
    if (prop === 'scale') return v[0];
    return v;
  }

  function renderGraphTabs() {
    graphTabsEl.innerHTML = '';
    const sp = selectedProps();
    // Only show tabs for properties that have selected keyframes (1, 2, or 3 tabs dynamically!)
    const visibleProps = sp.length > 0 ? sp : PROP_ORDER.filter((p) => tracks[p].length > 0);
    if (!visibleProps.length) {
      graphTabsEl.append(el('span', { class: 'muted' }, 'Select keyframes to edit graph'));
      return;
    }
    if (!visibleProps.includes(activeProp)) activeProp = visibleProps[0];

    for (const p of visibleProps) {
      const selCount = selectedForProp(p).length;
      const totalCount = tracks[p].length;
      const badge = selCount > 0 ? `${selCount}` : `${totalCount}`;
      graphTabsEl.append(
        el('button', {
          class: `mfe-gtab ${activeProp === p ? 'on' : ''}`,
          onclick: () => { activeProp = p; renderGraph(); renderTimeline(); },
        }, `${PROP_LABELS[p]} (${badge})`),
      );
    }
  }

  function getGraphDomain(prop) {
    const list = tracks[prop];
    const selList = selectedForProp(prop);
    const focus = selList.length >= 2 ? selList : list;

    let minT = 0, maxT = Math.max(1, totalFrames);
    if (selList.length >= 2) {
      const t0 = Math.min(...selList.map((k) => k.t));
      const t1 = Math.max(...selList.map((k) => k.t));
      const span = Math.max(6, t1 - t0);
      minT = Math.max(0, t0 - span * 0.12);
      maxT = Math.min(totalFrames, t1 + span * 0.12);
    }

    const vals = focus.map((k) => graphValueOf(prop, k.v));
    if (prop === 'position') vals.push(-120, 120);
    else if (prop === 'scale') vals.push(75, 125);
    else vals.push(-35, 35);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(24, (hi - lo) * 0.25);
    return { minT, maxT: Math.max(minT + 1, maxT), minV: lo - pad, maxV: hi + pad };
  }

  function renderGraph() {
    renderGraphTabs();
    graphSvg.innerHTML = '';

    const sp = selectedProps();
    const visibleProps = sp.length > 0 ? sp : PROP_ORDER.filter((p) => tracks[p].length > 0);
    const prop = visibleProps.includes(activeProp) ? activeProp : (visibleProps[0] || activeProp);
    const list = tracks[prop];
    const selList = selectedForProp(prop);

    const { minT, maxT, minV, maxV } = getGraphDomain(prop);
    graphState = { minT, maxT, minV, maxV, prop };

    const X = (t) => GPAD_L + ((t - minT) / Math.max(0.001, maxT - minT)) * (GW - GPAD_L - GPAD_R);
    const Y = (val) => GPAD_T + ((maxV - val) / Math.max(1, maxV - minV)) * (GH - GPAD_T - GPAD_B);
    const invT = (px) => clamp(minT + ((px - GPAD_L) / (GW - GPAD_L - GPAD_R)) * (maxT - minT), 0, totalFrames);
    const invV = (py) => maxV - ((py - GPAD_T) / (GH - GPAD_T - GPAD_B)) * (maxV - minV);

    // Value grid
    for (let i = 0; i <= 4; i++) {
      const val = minV + ((maxV - minV) * i) / 4;
      const y = Y(val);
      graphSvg.append(
        svgNode('line', { x1: GPAD_L, y1: y, x2: GW - GPAD_R, y2: y, class: 'g-grid' }),
        Object.assign(svgNode('text', { x: GPAD_L - 5, y: y + 3, class: 'g-lbl', 'text-anchor': 'end' }), { textContent: String(Math.round(val)) }),
      );
    }
    const baseVal = prop === 'scale' ? 100 : 0;
    if (baseVal >= minV && baseVal <= maxV) {
      graphSvg.append(svgNode('line', { x1: GPAD_L, y1: Y(baseVal), x2: GW - GPAD_R, y2: Y(baseVal), class: 'g-zero' }));
    }

    graphPlayheadLine = svgNode('line', { x1: X(frame), y1: GPAD_T - 6, x2: X(frame), y2: GH - GPAD_B + 4, class: 'g-playhead' });
    graphSvg.append(graphPlayheadLine);

    if (!list.length) {
      const msg = svgNode('text', { x: GW / 2, y: GH / 2, class: 'g-empty', 'text-anchor': 'middle' });
      msg.textContent = `Press Alt+Shift+${prop[0].toUpperCase()} or click ◆ to add keyframes`;
      graphSvg.append(msg);
      return;
    }

    // Determine visible keyframe subset: show selected keyframes (or full track if <2 selected on this prop)
    const showAllOnTrack = selList.length === 0;
    const minShownT = selList.length >= 2 ? Math.min(...selList.map((k) => k.t)) : list[0].t;
    const maxShownT = selList.length >= 2 ? Math.max(...selList.map((k) => k.t)) : list[list.length - 1].t;

    // Context dashed curve across full visible domain
    let fullD = '';
    for (let s = 0; s <= 100; s++) {
      const t = minT + (s / 100) * (maxT - minT);
      const v = graphValueOf(prop, evalTrack(list, t, statics[prop]));
      fullD += `${s === 0 ? 'M' : 'L'}${X(t).toFixed(1)},${Y(v).toFixed(1)} `;
    }
    graphSvg.append(svgNode('path', { d: fullD, class: selList.length >= 2 ? 'g-curve-dim' : 'g-curve' }));

    // Highlighted solid curve across the selected keyframe span
    let selD = '';
    for (let s = 0; s <= 100; s++) {
      const t = minShownT + (s / 100) * Math.max(0.01, maxShownT - minShownT);
      const v = graphValueOf(prop, evalTrack(list, t, statics[prop]));
      selD += `${s === 0 ? 'M' : 'L'}${X(t).toFixed(1)},${Y(v).toFixed(1)} `;
    }
    if (selList.length >= 2) {
      graphSvg.append(svgNode('path', { d: selD, class: 'g-curve' }));
    }

    // Invisible wide hit-target on the curve: DOUBLE-CLICK to insert a keyframe right on the line!
    const curveHit = svgNode('path', { d: fullD, class: 'g-curve-hit' });
    curveHit.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      stopPlay();
      const r = graphSvg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * GW;
      const t = Math.round(invT(px));
      const cur = evalTrack(list, t, statics[prop]);
      const inserted = upsertKeyframe(prop, t, cur, 'add');
      frame = inserted.t;
      flashShortcut(`Added ${PROP_LABELS[prop]} keyframe @ f${inserted.t} — drag to sculpt`);
    });
    graphSvg.append(curveHit);

    // Draggable Bezier handles for every segment touching a selected keyframe
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      const activeSeg = showAllOnTrack
        ? i === 0
        : (isSelected(a) && isSelected(b)) || (selList.length === 1 && (isSelected(a) || isSelected(b)));
      if (!activeSeg) continue;

      const va = graphValueOf(prop, a.v), vb = graphValueOf(prop, b.v);
      const dt = Math.max(0.01, b.t - a.t);
      const dv = vb - va;
      const ease = a.ease || [0.33, 0, 0.67, 1];
      const effDv = Math.abs(dv) < 1 ? 40 : dv;
      const h1x = X(a.t + ease[0] * dt), h1y = Y(va + ease[1] * effDv);
      const h2x = X(a.t + ease[2] * dt), h2y = Y(va + ease[3] * effDv);

      graphSvg.append(
        svgNode('line', { x1: X(a.t), y1: Y(va), x2: h1x, y2: h1y, class: 'g-arm' }),
        svgNode('line', { x1: X(b.t), y1: Y(vb), x2: h2x, y2: h2y, class: 'g-arm' }),
      );

      const makeHandle = (which, cx, cy) => {
        const h = svgNode('circle', { cx, cy, r: 5.5, class: 'g-handle' });
        h.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); e.preventDefault(); stopPlay();
          h.setPointerCapture(e.pointerId);
          const onMove = (ev) => {
            const r = graphSvg.getBoundingClientRect();
            const px = ((ev.clientX - r.left) / r.width) * GW;
            const py = ((ev.clientY - r.top) / r.height) * GH;
            const u = clamp((invT(px) - a.t) / dt, 0.01, 0.99);
            const vNorm = clamp((invV(py) - va) / effDv, -0.8, 1.8);
            const next = [...(a.ease || [0.33, 0, 0.67, 1])];
            if (which === 0) { next[0] = r3(u); next[1] = r3(vNorm); }
            else { next[2] = r3(u); next[3] = r3(vNorm); }
            a.ease = next;
            renderGraph();
            renderStage();
          };
          const onUp = () => {
            h.removeEventListener('pointermove', onMove);
            h.removeEventListener('pointerup', onUp);
          };
          h.addEventListener('pointermove', onMove);
          h.addEventListener('pointerup', onUp);
        });
        graphSvg.append(h);
      };
      makeHandle(0, h1x, h1y);
      makeHandle(1, h2x, h2y);
    }

    // Draggable keyframe diamonds in the Graph Editor (move freely left/right + up/down!)
    const renderedKfs = selList.length >= 2 ? list.filter((k) => k.t >= minT && k.t <= maxT) : list;
    renderedKfs.forEach((kf) => {
      const val = graphValueOf(prop, kf.v);
      const selOn = isSelected(kf);
      const pt = svgNode('rect', {
        x: X(kf.t) - 5.5,
        y: Y(val) - 5.5,
        width: 11,
        height: 11,
        transform: `rotate(45 ${X(kf.t)} ${Y(val)})`,
        class: `g-kf ${selOn ? 'sel' : ''}`,
      });
      pt.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault(); stopPlay();
        if (e.shiftKey) {
          if (selectedIds.has(kf.id)) selectedIds.delete(kf.id);
          else selectedIds.add(kf.id);
        } else if (!selectedIds.has(kf.id)) {
          selectedIds.clear();
          selectedIds.add(kf.id);
        }
        frame = kf.t;
        pt.setPointerCapture(e.pointerId);
        renderAll();

        // Capture initial positions of all selected keyframes on this prop for group dragging
        const dragGroup = selectedForProp(prop).map((item) => ({
          kf: item,
          t0: item.t,
          v0: graphValueOf(prop, item.v),
        }));
        const r0 = graphSvg.getBoundingClientRect();
        const startT = invT(((e.clientX - r0.left) / r0.width) * GW);
        const startV = invV(((e.clientY - r0.top) / r0.height) * GH);

        const onMove = (ev) => {
          const r = graphSvg.getBoundingClientRect();
          const dt = invT(((ev.clientX - r.left) / r.width) * GW) - startT;
          const dv = invV(((ev.clientY - r.top) / r.height) * GH) - startV;
          for (const g of dragGroup) {
            g.kf.t = Math.round(clamp(g.t0 + dt, 0, totalFrames));
            const nv = Math.round(g.v0 + dv);
            if (prop === 'position') g.kf.v[0] = clamp(nv, -CX + 30, CX - 30);
            else if (prop === 'scale') { g.kf.v[0] = clamp(nv, 10, 260); g.kf.v[1] = g.kf.v[0]; }
            else g.kf.v = clamp(nv, -360, 360);
          }
          sortKfs(list);
          frame = kf.t;
          renderAll();
        };
        const onUp = () => {
          pt.removeEventListener('pointermove', onMove);
          pt.removeEventListener('pointerup', onUp);
        };
        pt.addEventListener('pointermove', onMove);
        pt.addEventListener('pointerup', onUp);
      });
      graphSvg.append(pt);
    });
  }

  // Box-select (marquee drag) inside the Graph Editor + double-click anywhere near curve
  graphSvg.addEventListener('pointerdown', (e) => {
    if (e.target !== graphSvg && !e.target.classList?.contains('g-grid') && !e.target.classList?.contains('g-zero')) return;
    stopPlay();
    e.preventDefault();
    graphSvg.setPointerCapture(e.pointerId);
    const rect = graphSvg.getBoundingClientRect();
    const toSvg = (ev) => ({
      x: ((ev.clientX - rect.left) / rect.width) * GW,
      y: ((ev.clientY - rect.top) / rect.height) * GH,
    });
    const p0 = toSvg(e);
    const marquee = svgNode('rect', { x: p0.x, y: p0.y, width: 0, height: 0, class: 'g-marquee' });
    graphSvg.append(marquee);
    const baseSelection = e.shiftKey ? new Set(selectedIds) : new Set();
    let dragged = false;

    const onMove = (ev) => {
      const p1 = toSvg(ev);
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 4) dragged = true;
      const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
      const w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
      marquee.setAttribute('x', String(x));
      marquee.setAttribute('y', String(y));
      marquee.setAttribute('width', String(w));
      marquee.setAttribute('height', String(h));

      const { minT, maxT, minV, maxV, prop } = graphState;
      const X = (t) => GPAD_L + ((t - minT) / Math.max(0.001, maxT - minT)) * (GW - GPAD_L - GPAD_R);
      const Y = (val) => GPAD_T + ((maxV - val) / Math.max(1, maxV - minV)) * (GH - GPAD_T - GPAD_B);

      selectedIds.clear();
      baseSelection.forEach((id) => selectedIds.add(id));
      for (const kf of tracks[prop]) {
        const kx = X(kf.t), ky = Y(graphValueOf(prop, kf.v));
        if (kx >= x && kx <= x + w && ky >= y && ky <= y + h) {
          selectedIds.add(kf.id);
        }
      }
      renderTimeline();
    };
    const onUp = () => {
      marquee.remove();
      graphSvg.removeEventListener('pointermove', onMove);
      graphSvg.removeEventListener('pointerup', onUp);
      if (dragged) renderAll();
    };
    graphSvg.addEventListener('pointermove', onMove);
    graphSvg.addEventListener('pointerup', onUp);
  });

  function renderGraphPlayhead() {
    if (!graphPlayheadLine) return;
    const { minT, maxT } = graphState;
    const x = GPAD_L + ((frame - minT) / Math.max(0.001, maxT - minT)) * (GW - GPAD_L - GPAD_R);
    graphPlayheadLine.setAttribute('x1', String(x));
    graphPlayheadLine.setAttribute('x2', String(x));
  }

  // Stage render
  function renderStage() {
    const [px, py] = curVal('position');
    const [sx, sy] = curVal('scale');
    const rot = curVal('rotation');
    stageObj.style.transform = `translate(${CX + px}px, ${CY + py}px) translate(-50%, -50%) rotate(${rot.toFixed(1)}deg) scale(${(sx / 100).toFixed(3)}, ${(sy / 100).toFixed(3)})`;

    if (tracks.position.length >= 2) {
      let d = '';
      for (let s = 0; s <= 60; s++) {
        const t = (s / 60) * totalFrames;
        const [x, y] = curVal('position', t);
        d += `${s === 0 ? 'M' : 'L'}${(CX + x).toFixed(1)},${(CY + y).toFixed(1)} `;
      }
      motionPath.setAttribute('d', d);
    } else {
      motionPath.setAttribute('d', '');
    }
    kfDotsGroup.innerHTML = '';
    tracks.position.forEach((kf) => {
      const selOn = isSelected(kf);
      kfDotsGroup.append(svgNode('circle', {
        cx: CX + kf.v[0],
        cy: CY + kf.v[1],
        r: selOn ? 5 : 3.5,
        class: `mfe-path-dot ${selOn ? 'sel' : ''}`,
      }));
    });
  }

  function makeScrubber(label, getV, setV, step = 1, unit = '') {
    const span = el('span', { class: 'mfe-scrub', title: `Drag left/right to scrub ${label}` });
    const valNode = el('b', {}, '');
    span.append(el('i', {}, label), valNode, unit);
    span.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault(); stopPlay();
      span.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = getV();
      const onMove = (ev) => {
        const next = Math.round((v0 + (ev.clientX - x0) * step) * 10) / 10;
        setV(next);
      };
      const onUp = () => {
        span.removeEventListener('pointermove', onMove);
        span.removeEventListener('pointerup', onUp);
      };
      span.addEventListener('pointermove', onMove);
      span.addEventListener('pointerup', onUp);
    });
    span._update = () => { valNode.textContent = String(Math.round(getV())); };
    return span;
  }

  // Timeline & Property Rows
  const playBtn = el('button', { class: 'mfe-play', title: 'Play / Pause (Space)', onclick: startPlay }, '▶');
  const frameReadout = el('span', { class: 'mfe-fr' }, '');
  const durInput = el('input', {
    type: 'number',
    min: 12,
    max: 300,
    value: totalFrames,
    title: 'Duration in frames',
    onchange: (e) => {
      totalFrames = clamp(Math.round(+e.target.value || 54), 12, 300);
      e.target.value = totalFrames;
      frame = clamp(frame, 0, totalFrames);
      renderAll();
    },
  });

  const rulerEl = el('div', { class: 'mfe-ruler' });
  const tlPlayhead = el('div', { class: 'mfe-tl-head' });
  const trackRowsWrap = el('div', { class: 'mfe-tracks' });
  const tlGridEl = el('div', { class: 'mfe-tl-grid' },
    el('div', { class: 'mfe-tl-head-row' },
      el('div', { class: 'mfe-row-l muted' }, 'Property (click to select all)'),
      el('div', { class: 'mfe-ruler-wrap' }, rulerEl, tlPlayhead),
    ),
    trackRowsWrap,
  );

  function scrubRuler(e) {
    stopPlay();
    rulerEl.setPointerCapture(e.pointerId);
    const update = (ev) => {
      const r = rulerEl.getBoundingClientRect();
      frame = Math.round(clamp((ev.clientX - r.left) / r.width, 0, 1) * totalFrames);
      renderStage();
      renderTimelineCursor();
      renderGraphPlayhead();
      renderPropReadouts();
    };
    update(e);
    const onUp = () => {
      rulerEl.removeEventListener('pointermove', update);
      rulerEl.removeEventListener('pointerup', onUp);
    };
    rulerEl.addEventListener('pointermove', update);
    rulerEl.addEventListener('pointerup', onUp);
  }
  rulerEl.addEventListener('pointerdown', scrubRuler);

  // Box-select (marquee drag) across all Timeline keyframe lanes!
  trackRowsWrap.addEventListener('pointerdown', (e) => {
    if (!e.target.classList?.contains('mfe-lane')) return;
    stopPlay();
    e.preventDefault();
    trackRowsWrap.setPointerCapture(e.pointerId);
    const gridRect = tlGridEl.getBoundingClientRect();
    const x0 = e.clientX - gridRect.left, y0 = e.clientY - gridRect.top;
    const boxEl = el('div', { class: 'mfe-tl-marquee', style: { left: x0 + 'px', top: y0 + 'px', width: '0px', height: '0px' } });
    tlGridEl.append(boxEl);
    const baseSelection = e.shiftKey ? new Set(selectedIds) : new Set();

    const onMove = (ev) => {
      const x1 = ev.clientX - gridRect.left, y1 = ev.clientY - gridRect.top;
      const left = Math.min(x0, x1), top = Math.min(y0, y1);
      const width = Math.abs(x1 - x0), height = Math.abs(y1 - y0);
      Object.assign(boxEl.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });

      const absL = gridRect.left + left, absR = absL + width;
      const absT = gridRect.top + top, absB = absT + height;

      selectedIds.clear();
      baseSelection.forEach((id) => selectedIds.add(id));
      for (const d of trackRowsWrap.querySelectorAll('.mfe-diamond')) {
        const dr = d.getBoundingClientRect();
        const cx = dr.left + dr.width / 2, cy = dr.top + dr.height / 2;
        if (cx >= absL && cx <= absR && cy >= absT && cy <= absB) {
          selectedIds.add(d.dataset.kfid);
        }
      }
      for (const d of trackRowsWrap.querySelectorAll('.mfe-diamond')) {
        d.classList.toggle('sel', selectedIds.has(d.dataset.kfid));
      }
    };

    const onUp = () => {
      boxEl.remove();
      trackRowsWrap.removeEventListener('pointermove', onMove);
      trackRowsWrap.removeEventListener('pointerup', onUp);
      ensureValidActiveProp();
      renderAll();
    };
    trackRowsWrap.addEventListener('pointermove', onMove);
    trackRowsWrap.addEventListener('pointerup', onUp);
  });

  const scrubbers = [];
  const rowDefs = [
    {
      prop: 'position',
      name: 'Position',
      key: '⌥⇧P',
      makeControls: () => {
        const sx = makeScrubber('X', () => curVal('position')[0], (v) => setValueAtPlayhead('position', [clamp(v, -CX + 30, CX - 30), curVal('position')[1]], true), 1);
        const sy = makeScrubber('Y', () => curVal('position')[1], (v) => setValueAtPlayhead('position', [curVal('position')[0], clamp(v, -CY + 30, CY - 30)], true), 1);
        scrubbers.push(sx, sy);
        return [sx, sy];
      },
    },
    {
      prop: 'scale',
      name: 'Scale',
      key: '⌥⇧S',
      makeControls: () => {
        const sc = makeScrubber('', () => curVal('scale')[0], (v) => { const c = clamp(v, 10, 260); setValueAtPlayhead('scale', [c, c], true); }, 0.8, '%');
        scrubbers.push(sc);
        return [sc];
      },
    },
    {
      prop: 'rotation',
      name: 'Rotation',
      key: '⌥⇧R',
      makeControls: () => {
        const rt = makeScrubber('', () => curVal('rotation'), (v) => setValueAtPlayhead('rotation', clamp(v, -360, 360), true), 0.8, '°');
        scrubbers.push(rt);
        return [rt];
      },
    },
  ];

  const rowRefs = {};
  for (const def of rowDefs) {
    const kfBtn = el('button', {
      class: 'mfe-kf-btn',
      title: `Add / remove ${def.name} keyframe at playhead (${def.key})`,
      onclick: (e) => { e.stopPropagation(); toggleKeyframeAtPlayhead(def.prop); },
    }, '◆');
    const lane = el('div', { class: 'mfe-lane', title: 'Drag to box-select keyframes' });
    const rowLeft = el('div', {
      class: 'mfe-row-l',
      title: `Click to select all ${def.name} keyframes (Shift+click to add)`,
      onclick: (e) => {
        if (e.target.closest('.mfe-scrub, .mfe-kf-btn')) return;
        selectAllOnProp(def.prop, e.shiftKey);
        renderAll();
      },
    },
      kfBtn,
      el('span', { class: 'mfe-row-name' }, def.name),
      el('kbd', {}, def.key),
      el('div', { class: 'mfe-scrubs' }, ...def.makeControls()),
    );
    const row = el('div', { class: 'mfe-row' }, rowLeft, lane);
    trackRowsWrap.append(row);
    rowRefs[def.prop] = { row, kfBtn, lane };
  }

  function renderPropReadouts() {
    frameReadout.textContent = `f ${Math.round(frame)} / ${totalFrames} · ${(frame / fps).toFixed(2)}s`;
    scrubbers.forEach((s) => s._update());
    for (const { prop } of rowDefs) {
      rowRefs[prop].kfBtn.classList.toggle('on', findKfAt(prop, Math.round(frame)) >= 0);
    }
  }

  function renderTimelineCursor() {
    tlPlayhead.style.left = `${(frame / Math.max(1, totalFrames)) * 100}%`;
  }

  function renderTimeline() {
    rulerEl.innerHTML = '';
    const step = totalFrames <= 60 ? 10 : 15;
    for (let f = 0; f <= totalFrames; f += step) {
      const style = f === 0 ? { left: '0%', transform: 'translateX(6px)' } : { left: `${(f / totalFrames) * 100}%` };
      rulerEl.append(el('span', { class: 'mfe-tick', style }, `${f}f`));
    }
    for (const { prop } of rowDefs) {
      const { row, lane } = rowRefs[prop];
      row.classList.toggle('active', activeProp === prop);
      lane.innerHTML = '';
      tracks[prop].forEach((kf) => {
        const selOn = isSelected(kf);
        const d = el('div', {
          class: `mfe-diamond ${selOn ? 'sel' : ''}`,
          style: { left: `${(kf.t / Math.max(1, totalFrames)) * 100}%` },
          title: `${PROP_LABELS[prop]} @ f${kf.t} (Shift+click multi-select · drag to retime · Del to remove)`,
        });
        d.dataset.kfid = kf.id;
        d.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); e.preventDefault(); stopPlay();
          if (e.shiftKey) {
            if (selectedIds.has(kf.id)) selectedIds.delete(kf.id);
            else selectedIds.add(kf.id);
          } else if (!selectedIds.has(kf.id)) {
            selectedIds.clear();
            selectedIds.add(kf.id);
          }
          activeProp = prop;
          frame = kf.t;
          d.setPointerCapture(e.pointerId);
          renderAll();

          const dragItems = allSelectedEntries().map((item) => ({ ...item, t0: item.kf.t }));
          const laneRect = lane.getBoundingClientRect();
          const startFrame = clamp((e.clientX - laneRect.left) / laneRect.width, 0, 1) * totalFrames;

          const onMove = (ev) => {
            const curF = clamp((ev.clientX - laneRect.left) / laneRect.width, 0, 1) * totalFrames;
            const df = Math.round(curF - startFrame);
            for (const item of dragItems) {
              item.kf.t = clamp(item.t0 + df, 0, totalFrames);
            }
            for (const p of PROP_ORDER) sortKfs(tracks[p]);
            frame = kf.t;
            renderAll();
          };
          const onUp = () => {
            d.removeEventListener('pointermove', onMove);
            d.removeEventListener('pointerup', onUp);
          };
          d.addEventListener('pointermove', onMove);
          d.addEventListener('pointerup', onUp);
        });
        lane.append(d);
      });
    }
    renderTimelineCursor();
  }

  function renderAll() {
    renderStage();
    renderGraph();
    renderTimeline();
    renderPropReadouts();
  }

  // Keyboard shortcuts
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); closeModal(true); return; }
    if (e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); startPlay(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); stopPlay(); frame = clamp(Math.round(frame) + (e.shiftKey ? 5 : 1), 0, totalFrames); renderAll(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); stopPlay(); frame = clamp(Math.round(frame) - (e.shiftKey ? 5 : 1), 0, totalFrames); renderAll(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); e.stopImmediatePropagation(); deleteSelectedKeyframes(); return; }
    if (e.key === 'F9') { e.preventDefault(); e.stopImmediatePropagation(); applyEaseToSelected(EASE_PRESETS['Easy Ease']); flashShortcut('Easy Ease applied (F9)'); return; }

    const k = e.key.toLowerCase();
    if (e.altKey && e.shiftKey && (k === 'p' || k === 's' || k === 'r')) {
      e.preventDefault(); e.stopImmediatePropagation();
      dropKeyframeNow(k === 'p' ? 'position' : k === 's' ? 'scale' : 'rotation');
      return;
    }
    if (!e.altKey && !e.ctrlKey && !e.metaKey && (k === 'p' || k === 's' || k === 'r')) {
      e.preventDefault(); e.stopImmediatePropagation();
      selectAllOnProp(k === 'p' ? 'position' : k === 's' ? 'scale' : 'rotation', e.shiftKey);
      renderAll();
    }
  };

  async function submit() {
    stopPlay();
    const posKfs = toLottieVecTrack(tracks.position, 0);
    const scaleKfs = toLottieVecTrack(tracks.scale, 100);
    const rotKfs = toLottieScalarTrack(tracks.rotation);

    const primaryTrack = tracks[activeProp].length ? tracks[activeProp] : tracks.position.length ? tracks.position : tracks.scale.length ? tracks.scale : tracks.rotation;
    const primaryBezier = primaryTrack?.[0]?.ease || [0.33, 0, 0.67, 1];
    const totalKfCount = tracks.position.length + tracks.scale.length + tracks.rotation.length;

    const authored = {
      dimension: '2d',
      fps,
      durationFrames: totalFrames,
      durationMs: Math.round((totalFrames / fps) * 1000),
      keyframeCount: totalKfCount,
      primaryBezier,
      tracks: {
        ...(posKfs ? { position: posKfs } : {}),
        ...(scaleKfs ? { scale: scaleKfs } : {}),
        ...(rotKfs ? { rotation: rotKfs } : {}),
      },
      summary: [
        tracks.position.length ? `Position (${tracks.position.length} kf)` : null,
        tracks.scale.length ? `Scale (${tracks.scale.length} kf)` : null,
        tracks.rotation.length ? `Rotation (${tracks.rotation.length} kf)` : null,
      ].filter(Boolean).join(' · '),
    };

    if (session?.id) {
      await fetch('/api/sandbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'submitted', mode: 'keyframe-editor', distilled: authored, tracks: authored.tracks }),
      }).catch(() => {});
    }

    closeModal(false);
    onSubmit?.({ sessionId: session?.id || null, mode: 'keyframe-editor', distilled: authored, tracks: authored.tracks });
  }

  const applyStarter = (fn) => {
    stopPlay();
    fn();
    selectedIds.clear();
    for (const p of PROP_ORDER) tracks[p].forEach((k) => selectedIds.add(k.id));
    ensureValidActiveProp();
    frame = 0;
    renderAll();
    startPlay();
  };

  const modal = el('div', { id: 'sandboxModal', onclick: (e) => { if (e.target.id === 'sandboxModal') closeModal(true); } },
    el('div', { class: 'mfe-sheet' },
      el('div', { class: 'mfe-ask' },
        el('div', { class: 'mfe-ask-body' },
          el('div', { class: 'mfe-ask-eyebrow' }, askHeading),
          el('div', { class: 'mfe-ask-text' }, askText),
        ),
        el('button', { class: 'sbx-close', title: 'Close (Esc)', onclick: () => closeModal(true) }, '×'),
      ),
      el('div', { class: 'mfe-main' },
        el('div', { class: 'mfe-stage-col' },
          stageEl,
          el('div', { class: 'mfe-stage-hint muted' },
            'Drag block · hold ', el('kbd', {}, 'Shift'), ' to lock H/V · ',
            el('kbd', {}, '⌥⇧P'), ' ', el('kbd', {}, '⌥⇧S'), ' ', el('kbd', {}, '⌥⇧R'), ' drop keyframes',
          ),
        ),
        el('div', { class: 'mfe-graph-col' },
          el('div', { class: 'mfe-graph-head' }, graphTabsEl, el('span', { class: 'muted' }, 'Dbl-click line to add ◆ · F9 ease')),
          graphSvg,
          easeRow,
        ),
      ),
      el('div', { class: 'mfe-tl' },
        el('div', { class: 'mfe-tl-bar' },
          playBtn,
          frameReadout,
          toastEl,
          el('span', { class: 'spacer' }),
          el('label', { class: 'mfe-dur-lbl muted' }, 'Frames ', durInput),
          el('button', {
            class: 'ghost',
            title: 'Delete selected keyframes (Del)',
            onclick: deleteSelectedKeyframes,
          }, 'Remove ◆'),
        ),
        tlGridEl,
      ),
      el('div', { class: 'mfe-foot' },
        el('span', { class: 'muted', style: { fontSize: '11.5px' } }, 'Starters:'),
        ...[
          ['Slide', () => {
            tracks.position = [makeKf(0, [-120, 0], [0.22, 1, 0.36, 1]), makeKf(Math.round(totalFrames * 0.7), [120, 0])];
            tracks.scale = []; tracks.rotation = []; activeProp = 'position';
          }],
          ['Elastic', () => {
            tracks.position = [
              makeKf(0, [-130, 0], [0.2, 0.9, 0.35, 1]),
              makeKf(Math.round(totalFrames * 0.42), [132, 0], [0.42, 0, 0.58, 1]),
              makeKf(Math.round(totalFrames * 0.66), [86, 0], [0.42, 0, 0.58, 1]),
              makeKf(Math.round(totalFrames * 0.84), [108, 0], [0.38, 0, 0.3, 1]),
              makeKf(totalFrames, [100, 0]),
            ];
            tracks.scale = []; tracks.rotation = []; activeProp = 'position';
          }],
          ['Snap + Pop', () => {
            tracks.position = [makeKf(0, [-110, 0], [0.16, 1, 0.3, 1]), makeKf(Math.round(totalFrames * 0.55), [100, 0])];
            tracks.scale = [
              makeKf(0, [82, 82], [0.2, 0.9, 0.35, 1]),
              makeKf(Math.round(totalFrames * 0.38), [118, 118], [0.4, 0, 0.3, 1]),
              makeKf(Math.round(totalFrames * 0.68), [100, 100]),
            ];
            tracks.rotation = []; activeProp = 'position';
          }],
          ['Wiggle', () => {
            tracks.position = [];
            tracks.scale = [];
            tracks.rotation = [
              makeKf(0, 0, [0.25, 0.8, 0.4, 1]),
              makeKf(Math.round(totalFrames * 0.25), -16, [0.42, 0, 0.58, 1]),
              makeKf(Math.round(totalFrames * 0.52), 12, [0.42, 0, 0.58, 1]),
              makeKf(Math.round(totalFrames * 0.76), -5, [0.42, 0, 0.58, 1]),
              makeKf(totalFrames, 0),
            ];
            activeProp = 'rotation';
          }],
        ].map(([label, fn]) => el('button', { class: 'mfe-pill', onclick: () => applyStarter(fn) }, label)),
        el('span', { class: 'spacer' }),
        el('button', { onclick: () => closeModal(true) }, 'Cancel'),
        el('button', { class: 'primary', onclick: submit }, session?.id ? 'Send Motion Feel' : 'Attach Motion Feel'),
      ),
    ),
  );

  document.body.append(modal);
  addEventListener('keydown', onKey, true);
  renderAll();

  return { close: () => closeModal(false) };
}
