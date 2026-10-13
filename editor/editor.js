// Motion Studio editor: scrub a scene and leave notes pinned to a frame or a span.
// The timeline lists the notes; the right panel shows only the note you're on.
import { bezier } from '/runtime/ease.js';

const $ = (q, r = document) => r.querySelector(q);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const frameEl = $('#frame'), view = $('#view'), overlay = $('#overlay'), panel = $('#panel');
const ruler = $('#ruler'), lanes = $('#lanes'), playhead = $('#playhead'), rangeBox = $('#rangeBox');
const LABEL_W = 200;

const st = {
  scenes: [], scene: null, S: null, beats: [], frames: 1, fps: 25, w: 1920, h: 1080, k: 1,
  frame: 0, playing: false, loop: false, range: null, comment: false,
  notes: [], pending: null, sel: null, curveOpen: false, checklist: [],
};

// ------------------------------------------------------------------ scene
async function init() {
  st.scenes = await (await fetch('/api/scenes')).json();
  const pick = $('#scenePick');
  st.scenes.forEach((s) => pick.append(h('option', { value: s.id }, s.title)));
  const [hs, hf] = decodeURIComponent(location.hash.slice(1)).split('@');
  st.scene = st.scenes.find((s) => s.id === hs)?.id || st.scenes[0]?.id;
  st.frame = +hf || 0;
  pick.value = st.scene;
  pick.onchange = () => { Object.assign(st, { scene: pick.value, frame: 0, range: null, sel: null, pending: null }); loadScene(); };
  loadScene();
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const { paths = [] } = JSON.parse(e.data);
    if (paths.some((p) => p.startsWith('editor/'))) return location.reload();
    if (paths.some((p) => p.startsWith(`scenes/${st.scene}/`) || p.startsWith('runtime/') || p.startsWith('tokens/'))) loadScene();
    if (paths.some((p) => p.startsWith(`notes/${st.scene}/`))) loadNotes();
  };
}

function loadScene() {
  st.S = null;
  frameEl.src = `/scenes/${st.scene}/?editor&t=${Date.now()}`;
  $('#openScene').href = `/scenes/${st.scene}/`;
}

addEventListener('message', (e) => {
  if (e.data?.type !== 'studio:ready' || e.source !== frameEl.contentWindow) return;
  const S = frameEl.contentWindow.__studio;
  Object.assign(st, { S, beats: S.beats(), frames: S.frames, fps: S.fps, w: S.width, h: S.height });
  frameEl.style.width = st.w + 'px'; frameEl.style.height = st.h + 'px';
  fit(); if (!st.zoomed) fitDefault(); seek(Math.min(st.frame, st.frames - 1), true); loadNotes();
});

function fit() {
  const wrap = $('#viewWrap').getBoundingClientRect();
  const pad = innerHeight > 700 ? 40 : 16, toolsW = 72;   // keep the frame clear of the floating tools on the left
  st.k = Math.max(0.05, Math.min((wrap.width - pad - toolsW) / st.w, (wrap.height - pad) / st.h));
  view.style.width = st.w * st.k + 'px'; view.style.height = st.h * st.k + 'px';
  frameEl.style.transform = `scale(${st.k})`;
  drawOverlay();
}
addEventListener('resize', () => { fit(); layoutTimeline(); });

// ------------------------------------------------------------------ time
let lastInt = -1, hashTimer = null;
function seek(f, force = false) {
  st.frame = clamp(f, 0, st.frames - 1);
  st.S?.seek(st.frame);
  if (st.rec) growRecording();
  const fi = Math.floor(st.frame);
  if (fi === lastInt && !force) return;
  lastInt = fi;
  $('#frameNo').textContent = fi;
  $('#frameTot').textContent = `/ ${st.frames - 1}`;
  $('#secs').textContent = (st.frame / st.fps).toFixed(2) + 's';
  if (st.playing || !dragging) follow();
  placePlayhead();
  for (const lane of lanes.children) {
    const n = lane._note; if (!n) continue;
    lane.classList.toggle('active', n.range ? fi >= n.range[0] && fi <= n.range[1] : Math.abs(fi - n.frame) <= 1);
  }
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, '', `#${st.scene}@${fi}`), 150);
}

function setPlaying(p) {
  st.playing = p;
  $('#playBtn').textContent = p ? '❚❚' : '▶';
  const [a, b] = st.loop && st.range ? st.range : [0, st.frames - 1];
  if (p && st.frame >= b) seek(a);
  if (!p) seek(Math.round(st.frame), true);
}
let last = null;
function tick(now) {
  if (st.playing && st.S) {
    if (last != null) {
      let f = st.frame + ((now - last) / 1000) * st.fps;
      const [a, b] = st.loop && st.range ? st.range : [0, st.frames - 1];
      if (f > b) { if (st.loop) f = a + ((f - b) % Math.max(1, b - a)); else { seek(b); setPlaying(false); } }
      if (st.playing) seek(f);
    }
    last = now;
  } else last = null;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function setRange(r) {
  st.range = r && r[1] > r[0] ? [Math.round(r[0]), Math.round(r[1])] : null;
  $('#rangeOut').textContent = st.range ? `${st.range[0]}–${st.range[1]} (${st.range[1] - st.range[0]}f)` : '';
  layoutRange();
}
function setLoop(on) { st.loop = on; $('#loopBtn').classList.toggle('on', on); }

// ------------------------------------------------------------------ timeline (one row per note)
// Timeline zoom: ppf = pixels per frame, v0 = first visible frame. By default the timeline shows
// at most DEFAULT_VIEW seconds, so long videos keep a fine, fast-scrubbing scale.
const DEFAULT_VIEW = 30, MAX_PPF = 40;
let trackW = 600, ppf = 1, v0 = 0;
const xOf = (f) => LABEL_W + (f - v0) * ppf;
const fAt = (clientX) => v0 + (clientX - ruler.getBoundingClientRect().left - LABEL_W) / ppf;
const frameAt = (clientX) => clamp(Math.round(fAt(clientX)), 0, st.frames - 1);
const minPpf = () => trackW / Math.max(1, st.frames - 1);
const visibleF = () => trackW / ppf;
function clampView() {
  ppf = clamp(ppf, minPpf(), MAX_PPF);
  v0 = clamp(v0, 0, Math.max(0, st.frames - 1 - visibleF()));
}
function fitDefault() {
  trackW = Math.max(100, lanes.clientWidth - LABEL_W - 14);
  ppf = trackW / Math.min(st.frames - 1, DEFAULT_VIEW * st.fps); v0 = 0; clampView();
}
function zoomBy(k, clientX) {
  const anchor = clientX != null ? fAt(clientX) : st.frame, ax = xOf(anchor);
  ppf *= k; clampView();
  v0 = anchor - (ax - LABEL_W) / ppf; clampView();
  layoutTimeline();
}
function follow() {   // keep the playhead in view while playing / stepping
  const vis = visibleF();
  if (st.frame < v0 || st.frame > v0 + vis) { v0 = st.frame - vis * 0.1; clampView(); layoutTimeline(); }
}

function buildTimeline() {
  lanes.innerHTML = '';
  const add = h('div', { class: 'lane add' }, h('div', { class: 'name' }, '+ drag here to note a span'));
  add.addEventListener('pointerdown', dragNewRange);
  lanes.append(add);
  const notes = [...st.notes].sort((a, b) => (a.range?.[0] ?? a.frame) - (b.range?.[0] ?? b.frame));
  if (st.pending?.range) notes.unshift(st.pending);
  for (const n of notes) {
    const bar = h('div', { class: `nbar ${n.range ? 'timed' : 'point'}`, title: n.text },
      n.range ? h('div', { class: 'handle l' }) : null, n.range ? h('div', { class: 'handle r' }) : null);
    const lane = h('div', { class: `lane ${st.sel === n.id || n === st.pending ? 'sel' : ''}` },
      h('div', { class: 'name', title: n.text, onclick: () => n !== st.pending && selectNote(n) }, n.reply ? h('span', { class: 'replied', title: 'Claude replied' }, '↩') : null, n.text || 'New note…'),
      bar);
    lane._note = n;
    bar.addEventListener('pointerdown', (e) => dragNote(e, n, bar));
    lanes.append(lane);
  }
  layoutTimeline();
}

function layoutTimeline() {
  if (!st.S) return;
  trackW = Math.max(100, lanes.clientWidth - LABEL_W - 14);
  clampView();
  ruler.innerHTML = '';
  const secStep = [1, 2, 5, 10, 30, 60].find((n) => n * st.fps * ppf >= 44) || 120;
  const minor = ppf >= 6 ? 1 : ppf * 5 >= 6 ? 5 : st.fps;
  const frameLabels = ppf >= 14;   // zoomed right in: label every 5th frame too
  const fEnd = Math.min(st.frames - 1, v0 + visibleF());
  for (let f = Math.ceil(v0 / minor) * minor; f <= fEnd; f += minor) {
    const sec = f % st.fps === 0, label = sec && (f / st.fps) % secStep === 0;
    const fl = !sec && frameLabels && f % 5 === 0;
    ruler.append(h('div', { class: 'tick' + (sec || fl ? '' : ' minor') + (fl ? ' fr' : ''), style: { left: xOf(f) + 'px', opacity: sec && !label ? 0.5 : 1 } }, label ? `${f / st.fps}s` : fl ? `${f % st.fps}f` : ''));
  }
  $('#zoomOut').textContent = `${(visibleF() / st.fps).toFixed(visibleF() / st.fps < 10 ? 1 : 0)}s`;
  for (const lane of lanes.children) if (lane._note) placeBar(lane.querySelector('.nbar'), lane._note.range, lane._note.frame);
  placePlayhead();
  layoutRange();
}
function placePlayhead() {
  const x = xOf(st.frame);
  playhead.style.left = x + 'px';
  playhead.style.display = x < LABEL_W - 1 || x > LABEL_W + trackW + 1 ? 'none' : 'block';
}
function placeBar(bar, range, frame) {
  if (range) { bar.style.left = xOf(range[0]) + 'px'; bar.style.width = Math.max(6, xOf(range[1]) - xOf(range[0])) + 'px'; }
  else bar.style.left = xOf(frame) + 'px';
}
function layoutRange() { rangeBox.style.display = 'none'; }   // spans show as note bars instead

let dragging = false;
ruler.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#zoom')) return;
  deselect();
  ruler.setPointerCapture(e.pointerId);
  dragging = true;
  if (st.playing) setPlaying(false);
  seek(frameAt(e.clientX));
  const move = (ev) => seek(frameAt(ev.clientX));
  const up = () => { dragging = false; ruler.removeEventListener('pointermove', move); ruler.removeEventListener('pointerup', up); };
  ruler.addEventListener('pointermove', move); ruler.addEventListener('pointerup', up);
});

// Hold Shift while scrubbing (ruler drag, arrow keys or playback) to record a span:
// it starts where Shift goes down, follows the playhead, and opens as a note on release.
function startRecording() {
  if (st.rec || !st.S) return;
  const a = Math.round(st.frame);
  st.rec = { a };
  st.range = [a, Math.min(st.frames - 1, a + 1)];
  startNote({});
  st.focusText = false;                       // keep the keyboard for scrubbing while recording
  document.activeElement?.blur?.();
  $('#rec').classList.add('on');
}
function growRecording() {
  const n = st.pending; if (!n) { st.rec = null; return; }
  const f = Math.round(st.frame), a = st.rec.a;
  n.range = [Math.min(a, f), Math.max(a, f, Math.min(a, f) + 1)];
  n.frame = n.range[0]; st.range = n.range;
  const bar = [...lanes.children].find((l) => l._note === n)?.querySelector('.nbar');
  if (bar) placeBar(bar, n.range);
  renderPanelHead();
  $('#rec').textContent = `● REC ${n.range[1] - n.range[0]}f`;
}
function stopRecording() {
  if (!st.rec) return;
  st.rec = null;
  $('#rec').classList.remove('on'); $('#rec').textContent = '● REC';
  const n = st.pending;
  if (!n || n.range[1] - n.range[0] < 2) { st.pending = null; setRange(null); buildTimeline(); renderPanel(); drawOverlay(); return; }
  n.beats = st.beats.filter((b) => b.f1 >= n.range[0] && b.f0 <= n.range[1] && b.f1 > b.f0).map(({ name, f0, f1 }) => ({ name, f0, f1 }));
  st.focusText = false; renderPanel();
  const ta = $('#panel textarea'); ta?.focus({ preventScroll: true });   // type straight away
}
addEventListener('keydown', (e) => { if (e.key === 'Shift' && !e.repeat && !e.target.closest('input, textarea, select')) startRecording(); });
addEventListener('keyup', (e) => { if (e.key === 'Shift') stopRecording(); });
addEventListener('blur', stopRecording);

// Drag a note: a span by either end (or the middle to slide it), a spot along time.
// The viewport shows the frame under whatever you're dragging.
function dragNote(e, n, bar) {
  e.stopPropagation();
  if (st.playing) setPlaying(false);
  bar.setPointerCapture(e.pointerId);
  dragging = true;
  const mode = e.target.classList.contains('l') ? 'start' : e.target.classList.contains('r') ? 'end' : n.range ? 'slide' : 'point';
  const f0 = frameAt(e.clientX), r0 = n.range && [...n.range], p0 = n.frame;
  let moved = false, range = r0, frame = p0;
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - e.clientX) < 3) return;
    moved = true;
    const d = frameAt(ev.clientX) - f0;
    if (mode === 'start') { range = [clamp(r0[0] + d, 0, r0[1] - 1), r0[1]]; seek(range[0]); }
    else if (mode === 'end') { range = [r0[0], clamp(r0[1] + d, r0[0] + 1, st.frames - 1)]; seek(range[1]); }
    else if (mode === 'slide') { const k = clamp(d, -r0[0], st.frames - 1 - r0[1]); range = [r0[0] + k, r0[1] + k]; seek(range[0]); }
    else { frame = clamp(p0 + d, 0, st.frames - 1); seek(frame); }
    placeBar(bar, range, frame);
    if (range) setRange(range);
  };
  const up = () => {
    bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up);
    dragging = false;
    if (!moved) return n === st.pending ? null : selectNote(n);
    if (range) frame = clamp(n.frame, range[0], range[1]);
    Object.assign(n, { range, frame });
    if (n !== st.pending) fetch(`/api/notes/${st.scene}/${n.id}`, json('PATCH', { range, frame }));
    renderPanel();
  };
  bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
}

function dragNewRange(e) {
  if (st.playing) setPlaying(false);
  e.preventDefault();
  dragging = true;
  const a = frameAt(e.clientX);
  st.range = [a, Math.min(st.frames - 1, a + 1)];
  startNote({});                     // the note layer appears now and grows as you drag
  const n = st.pending, bar = () => [...lanes.children].find((l) => l._note === n)?.querySelector('.nbar');
  seek(a);
  const move = (ev) => {
    const f = frameAt(ev.clientX);
    n.range = [Math.min(a, f), Math.max(a, f, Math.min(a, f) + 1)];
    n.frame = n.range[0]; st.range = n.range;
    placeBar(bar(), n.range); seek(f); renderPanelHead();
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    dragging = false;
    n.beats = st.beats.filter((b) => b.f1 >= n.range[0] && b.f0 <= n.range[1] && b.f1 > b.f0).map(({ name, f0, f1 }) => ({ name, f0, f1 }));
    seek(n.range[0]);
    $('#panel textarea')?.focus({ preventScroll: true });
  };
  // listen on the window: the row is rebuilt when the note layer is added
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
function renderPanelHead() { const w = $('#panel .where'); if (w && st.pending) w.textContent = where(st.pending); }

// ------------------------------------------------------------------ marking a spot on the frame
// Spot mode: hover highlights the element under the pointer; a click picks that element,
// a drag draws a free box.
let drag = null;
overlay.addEventListener('pointerdown', (e) => {
  if (!st.comment) { deselect(); return; }
  if (st.playing) setPlaying(false);
  overlay.setPointerCapture(e.pointerId);
  const r = overlay.getBoundingClientRect();
  drag = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top };
  drawOverlay();
});
overlay.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const r = overlay.getBoundingClientRect();
  drag.x1 = clamp(e.clientX - r.left, 0, r.width); drag.y1 = clamp(e.clientY - r.top, 0, r.height);
  drawOverlay();
});
overlay.addEventListener('pointerup', () => {
  if (!drag) return;
  let x = Math.min(drag.x0, drag.x1) / st.k, y = Math.min(drag.y0, drag.y1) / st.k;
  let w = Math.abs(drag.x1 - drag.x0) / st.k, hh = Math.abs(drag.y1 - drag.y0) / st.k;
  drag = null;
  if (w < 12 && hh < 12) { x -= 30; y -= 30; w = 60; hh = 60; }   // a click marks a 60px spot
  startNote({ region: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) } });
});

function drawOverlay() {
  overlay.innerHTML = '';
  const box = (r, cls, label) => overlay.append(h('div', { class: `region ${cls}`, style: { left: r.x * st.k + 'px', top: r.y * st.k + 'px', width: r.w * st.k + 'px', height: r.h * st.k + 'px' } }, label ? h('span', { class: 'lbl' }, label) : null));
  if (drag) {
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    overlay.append(h('div', { class: 'region', style: { left: x + 'px', top: y + 'px', width: Math.abs(drag.x1 - drag.x0) + 'px', height: Math.abs(drag.y1 - drag.y0) + 'px' } }));
  }
  const shown = st.pending || st.notes.find((x) => x.id === st.sel);
  if (shown?.region) box(shown.region, st.pending ? '' : 'saved', st.pending ? null : shown.elements?.[0]?.name);
}

function setComment(on) {
  st.comment = on;
  overlay.classList.toggle('comment', on);
  $('#commentBtn').classList.toggle('on', on);
}

// ------------------------------------------------------------------ notes
async function loadNotes() {
  if (!st.scene) return;
  const [fresh, check] = await Promise.all([
    fetch(`/api/notes?scene=${st.scene}`).then((r) => r.json()),
    fetch(`/api/checklist?scene=${st.scene}`).then((r) => r.json()).catch(() => ({ items: [] })),
  ]);
  st.checklist = check.items || [];
  // keep the open note's object (it may hold typing that hasn't round-tripped yet)
  const open = st.notes.find((x) => x.id && x.id === st.sel);
  st.notes = fresh.map((f) => (open && f.id === open.id ? Object.assign(open, { ...f, text: open.text, curve: open.curve ?? null }) : f));
  if (st.sel && !st.notes.find((n) => n.id === st.sel)) st.sel = null;
  buildTimeline(); drawOverlay();
  if (!typing()) renderPanel();          // never yank the text box out from under the cursor

}
const typing = () => document.activeElement?.closest?.('#panel');

function startNote({ region = null }) {
  const fi = Math.floor(st.frame), range = st.range;
  const hits = region ? st.S.hitTest(region, range || [fi, fi])
    : { beats: range ? st.beats.filter((b) => b.f1 >= range[0] && b.f0 <= range[1] && b.f1 > b.f0).map((b) => ({ name: b.name, f0: b.f0, f1: b.f1 })) : [], elements: [] };
  let elements = hits.elements.slice(0, 6).map(({ name, text, rect }) => ({ name, text, rect }));
  st.pending = { text: '', frame: fi, range, region, beats: hits.beats.map(({ name, f0, f1 }) => ({ name, f0, f1 })), elements, curve: null };
  st.sel = null; st.curveOpen = false; st.editing = true; st.focusText = true;
  setComment(false);
  buildTimeline(); renderPanel(); drawOverlay();
}

// Clicking anywhere empty — the area around the frame, the frame itself (outside Spot / ⌘-click),
// the ruler, or a blank part of the timeline — deselects the note. Unsaved typing is saved first.
function deselect() {
  if (st.rec) return;                         // recording a span: keep the new note
  if (!st.pending && !st.sel) return;
  if (st.pending?.text?.trim()) persist(st.pending);
  else if (st.sel) { const n = st.notes.find((x) => x.id === st.sel); if (n) { clearTimeout(saveTimer); persist(n); } }
  st.pending = null; st.sel = null; st.editing = false; st.curveOpen = false;
  setRange(null);
  buildTimeline(); renderPanel(); drawOverlay();
}
$('#viewWrap').addEventListener('pointerdown', (e) => { if (!e.target.closest('#view, #tools')) deselect(); });
lanes.addEventListener('pointerdown', (e) => { if (!e.target.closest('.nbar, .name, .add')) deselect(); });

function selectNote(n) {
  if (st.pending && st.pending.text?.trim()) persist(st.pending);
  st.pending = null; st.sel = n.id; st.curveOpen = false; st.editing = false;
  setPlaying(false);
  seek(n.frame, true);
  setRange(n.range || null);
  for (const lane of lanes.children) lane.classList.toggle('sel', lane._note?.id === n.id);
  renderPanel(); drawOverlay();
}

// Saving: typing autosaves (debounced); ✓ saves immediately and switches the note to its saved
// view. Every save goes through one queue, so a note is created exactly once and later edits
// always land on it.
let saveTimer = null, queue = Promise.resolve();
function persist(n) {
  queue = queue.then(async () => {
    if (n === st.pending || !n.id) {
      if (!n.text?.trim()) return;
      const { scene: _s, id: _i, created: _c, ...body } = n;
      const note = await (await fetch('/api/notes', json('POST', { ...body, scene: st.scene }))).json();
      n.id = note.id; n.created = note.created;
      if (st.pending === n) { st.pending = null; st.sel = n.id; }
      if (!st.notes.includes(n)) st.notes.push(n);
      buildTimeline();
    } else {
      await fetch(`/api/notes/${st.scene}/${n.id}`, json('PATCH', { text: n.text, curve: n.curve ?? null, range: n.range, frame: n.frame, elements: n.elements, region: n.region }));
      const lane = [...lanes.children].find((l) => l._note === n || l._note?.id === n.id);
      if (lane) lane.querySelector('.name').lastChild.textContent = n.text;
    }
  }).catch((e) => console.error('note save failed', e));
  return queue;
}
function save(n, patch) {
  Object.assign(n, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(n), 300);
}
async function commit(n) {          // ✓ — save now and show the saved view
  clearTimeout(saveTimer);
  if (!n.text?.trim()) return;
  st.editing = false;
  await persist(n);
  renderPanel(); drawOverlay();
}
async function removeNote(n) {      // delete button / ⌫ — removes the note
  clearTimeout(saveTimer);
  await queue;
  if (n.id) await fetch(`/api/notes/${st.scene}/${n.id}`, { method: 'DELETE' });
  if (n === st.pending) st.pending = null;
  st.notes = st.notes.filter((x) => x !== n && x.id !== n.id);
  st.sel = null; st.editing = false; setRange(null);
  buildTimeline(); renderPanel(); drawOverlay();
}
const resolve = removeNote;

// Everything about a note and its frame, as text to paste anywhere (⌘C with a note selected).
function noteContext(n) {
  const fi = n.frame, sec = (f) => (f / st.fps).toFixed(2) + 's';
  const active = st.beats.filter((b) => fi >= b.f0 && fi <= b.f1).map((b) => `${b.name} (${b.f0}→${b.f1})`);
  return [
    `Motion Studio note — scene "${st.scene}" · notes/${st.scene}/${n.id}.json`,
    n.range ? `Frames ${n.range[0]}–${n.range[1]} (${sec(n.range[0])}–${sec(n.range[1])}, ${n.range[1] - n.range[0]}f)` : `Frame ${fi} (${sec(fi)})`,
    `Note: ${n.text}`,
    n.followUp ? `Follow-up on Claude's change: ${n.followUp}` : null,
    n.curve ? `Wanted easing: cubic-bezier(${n.curve.join(', ')})` : null,
    n.region ? `Region (stage px): x ${n.region.x}, y ${n.region.y}, ${n.region.w}×${n.region.h}` : null,
    n.elements?.length ? `In the box (best match first): ${n.elements.map((e) => e.name + (e.text && e.text !== e.name ? ` “${e.text}”` : '')).join(', ')}` : null,
    n.beats?.length ? `Beats: ${n.beats.map((b) => `${b.name} (${b.f0}→${b.f1})`).join(', ')}` : null,
    `Animating at frame ${fi}: ${active.join(', ') || 'nothing (a hold)'}`,
    n.reply ? `Claude: ${n.reply}` : null,
  ].filter(Boolean).join('\n');
}

// ------------------------------------------------------------------ right panel: one note, always editable
function where(n) {
  const sec = (f) => (f / st.fps).toFixed(2) + 's';
  return n.range ? `Frames ${n.range[0]}–${n.range[1]} · ${n.range[1] - n.range[0]}f · ${sec(n.range[1] - n.range[0])}` : `Frame ${n.frame} · ${sec(n.frame)}`;
}

function miniCurve(c) {
  const svg = svgEl('svg', { class: 'mini', viewBox: '-4 -14 48 48' });
  svg.append(svgEl('path', { d: `M0,30 C${c[0] * 40},${30 - c[1] * 30} ${c[2] * 40},${30 - c[3] * 30} 40,0` }));
  return svg;
}

const trash = `<svg width="15" height="15" viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderPanel() {
  panel.innerHTML = '';
  const n = st.pending || st.notes.find((x) => x.id === st.sel);
  if (!n) {
    if (st.checklist?.length) {
      const dropItem = async (it) => {
        await fetch(`/api/checklist?scene=${st.scene}&id=${encodeURIComponent(it.id)}`, { method: 'DELETE' });
        st.checklist = st.checklist.filter((x) => x !== it);
      };
      // a reply turns the item back into a note at the same frame / span (and region, if known)
      const sendReply = async (it, text) => {
        if (!text.trim()) return;
        const range = it.range || null, frame = it.frame;
        const beats = st.beats.filter((b) => (range ? b.f1 >= range[0] && b.f0 <= range[1] : frame >= b.f0 && frame <= b.f1) && b.f1 > b.f0).map(({ name, f0, f1 }) => ({ name, f0, f1 }));
        const note = await (await fetch('/api/notes', json('POST', { scene: st.scene, frame, range, region: it.region || null, text: text.trim(), followUp: it.text, beats, elements: it.elements || [], curve: null }))).json();
        await dropItem(it);
        st.replyTo = null;
        st.notes.push(note); st.sel = note.id; st.editing = false;
        setPlaying(false); seek(frame, true); setRange(range);
        buildTimeline(); renderPanel(); drawOverlay();
      };
      panel.append(h('div', { class: 'check-h' }, 'To check', h('span', { class: 'muted' }, `${st.checklist.length}`)),
        ...st.checklist.map((it) => {
          const replying = st.replyTo === it.id;
          const card = h('div', { class: `check-it ${replying ? 'replying' : ''}`, title: 'Jump there', onclick: () => { setPlaying(false); seek(it.frame, true); setRange(it.range || null); } },
            h('span', { class: 'fr' }, it.range ? `${it.range[0]}–${it.range[1]}` : `f ${it.frame}`),
            h('span', { class: 'tx' }, it.text),
            h('div', { class: 'check-btns' },
              h('button', { class: 'reply-btn', title: 'More to say? Reply — it comes back as a note here', onclick: (e) => { e.stopPropagation(); st.replyTo = replying ? null : it.id; renderPanel(); } }, '↩'),
              h('button', { class: 'resolve small', title: 'Checked — remove', onclick: async (e) => { e.stopPropagation(); await dropItem(it); renderPanel(); } }, '✓')));
          if (replying) {
            const ta = h('textarea', { placeholder: 'What else should change here? (Enter to add · ⇧Enter for a new line)', onclick: (e) => e.stopPropagation(),
              onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(it, ta.value); } if (e.key === 'Escape') { st.replyTo = null; renderPanel(); } } });   // Enter sends, ⇧Enter = new line
            card.append(h('div', { class: 'reply-box', onclick: (e) => e.stopPropagation() }, ta,
              h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => sendReply(it, ta.value) }, 'Add as note ↵'), h('button', { onclick: () => { st.replyTo = null; renderPanel(); } }, 'Cancel'))));
            requestAnimationFrame(() => ta.focus({ preventScroll: true }));
          }
          return card;
        }));
    }
    panel.append(h('p', { class: 'muted hint' }, 'Use ✎ Spot (S) and draw a tight box around what you mean (or click a spot); drag across the top timeline row to note a span. Click a note row in the timeline to open it.'));
    return;
  }
  const editing = n === st.pending || st.editing || !n.text?.trim();
  const del = h('button', { class: 'del', title: 'Delete this note (⌫)', onclick: () => removeNote(n) });
  del.innerHTML = trash;
  const head = h('div', { class: 'head' },
    h('span', { class: 'where' }, where(n)),
    h('div', { class: 'head-btns' },
      editing
        ? h('button', { class: 'resolve', title: 'Save note (⌘↵)', onclick: () => commit(n) }, '✓')
        : h('span', { class: 'saved' }, 'Saved'),
      del));
  panel.append(head);

  if (n.followUp) panel.append(h('div', { class: 'followup' }, h('b', {}, 'Follow-up on: '), n.followUp));
  if (n.elements?.length) panel.append(h('div', { class: 'target' }, h('span', { class: 'muted' }, 'In the box: '), n.elements.slice(0, 3).map((e) => e.name).join(' · ')));
  if (editing) {
    const ta = h('textarea', {
      value: n.text || '', placeholder: 'What should change here?',
      oninput: (e) => save(n, { text: e.target.value }),
      onkeydown: (e) => {
        if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) || e.key === 'Escape') { e.preventDefault(); commit(n); }
      },
    });
    panel.append(ta);
    requestAnimationFrame(() => { if (document.activeElement !== ta && st.focusText) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); st.focusText = false; } });
  } else {
    panel.append(h('div', { class: 'text-view', title: 'Click to edit', onclick: () => { st.editing = true; st.focusText = true; renderPanel(); } }, n.text));
  }

  const setCurve = (c) => { save(n, { curve: c }); st.curveOpen = !!c; const keep = $('#panel textarea')?.value; renderPanel(); if (keep != null && $('#panel textarea')) $('#panel textarea').value = keep; };
  panel.append(h('div', { class: 'cues' },
    n.curve
      ? h('button', { class: `cue ${st.curveOpen ? 'on' : ''}`, title: 'Easing you want — click to edit', onclick: () => { st.curveOpen = !st.curveOpen; renderPanel(); } },
          miniCurve(n.curve), `cubic-bezier(${n.curve.join(', ')})`)
      : h('button', { class: 'cue add', onclick: () => setCurve([...(st.S.tokens?.ease?.move || [0.45, 0, 0.2, 1])]) }, '+ easing')));
  if (n.curve && st.curveOpen) {
    const tokens = Object.entries(st.S.tokens?.ease || {});
    panel.append(h('div', { class: 'curve' },
      bezierEditor(n.curve, () => {}, (c) => setCurve(c)),
      h('div', { class: 'pills' }, ...tokens.map(([name, pts]) => h('button', { class: pts.join() === n.curve.join() ? 'on' : '', onclick: () => setCurve([...pts]) }, name)),
        h('button', { class: 'ghost', onclick: () => setCurve(null) }, 'remove'))));
  }
  if (n.reply) panel.append(h('div', { class: 'reply' }, h('b', {}, 'Claude'), n.reply));
}

// cubic-bezier editor with a speed graph; y may leave 0..1 (anticipation / overshoot)
function bezierEditor(points, onInput, onCommit) {
  const W = 300, H = 210, pad = 20, Y0 = -0.6, Y1 = 1.6, SH = 54;
  const p = [...points];
  const X = (x) => pad + x * (W - 2 * pad), Y = (y) => pad + ((Y1 - y) / (Y1 - Y0)) * (H - 2 * pad);
  const ix = (px) => (px - pad) / (W - 2 * pad), iy = (py) => Y1 - ((py - pad) / (H - 2 * pad)) * (Y1 - Y0);
  const svg = svgEl('svg', { class: 'bz', viewBox: `0 0 ${W} ${H + SH}` });
  for (const y of [0, 1]) svg.append(svgEl('line', { class: 'grid', x1: pad, x2: W - pad, y1: Y(y), y2: Y(y) }));
  svg.append(svgEl('line', { class: 'base', x1: X(0), y1: Y(0), x2: X(1), y2: Y(1) }));
  const arm1 = svgEl('line', { class: 'arm' }), arm2 = svgEl('line', { class: 'arm' }), curve = svgEl('path', { class: 'curve' }), speed = svgEl('path', { class: 'speed' });
  const sl = svgEl('text', { x: pad, y: H + 8 }); sl.textContent = 'speed';
  svg.append(speed, sl, arm1, arm2, curve);
  const hs = [0, 1].map(() => { const c = svgEl('circle', { class: 'h', r: 7 }); svg.append(c); return c; });
  const set = (el, a) => Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v));
  function draw() {
    curve.setAttribute('d', `M${X(0)},${Y(0)} C${X(p[0])},${Y(p[1])} ${X(p[2])},${Y(p[3])} ${X(1)},${Y(1)}`);
    set(arm1, { x1: X(0), y1: Y(0), x2: X(p[0]), y2: Y(p[1]) }); set(arm2, { x1: X(1), y1: Y(1), x2: X(p[2]), y2: Y(p[3]) });
    set(hs[0], { cx: X(p[0]), cy: Y(p[1]) }); set(hs[1], { cx: X(p[2]), cy: Y(p[3]) });
    const e = bezier(...p), n = 80, d = 1 / n, vs = [];
    for (let i = 0; i <= n; i++) { const t = i / n, a = Math.max(0, t - d), b = Math.min(1, t + d); vs.push(Math.abs((e(b) - e(a)) / (b - a))); }
    const mx = Math.max(...vs, 1e-6), base = H + SH - 4, top = H + 14;
    speed.setAttribute('d', `M${X(0)},${base} ` + vs.map((v, i) => `L${X(i / n)},${base - (v / mx) * (base - top)}`).join(' ') + ` L${X(1)},${base} Z`);
  }
  hs.forEach((c, i) => c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      p[i * 2] = r2(clamp(ix(((ev.clientX - r.left) / r.width) * W), 0, 1));
      p[i * 2 + 1] = r2(clamp(iy(((ev.clientY - r.top) / r.height) * (H + SH)), Y0, Y1));
      draw(); onInput([...p]);
    };
    const up = () => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); onCommit([...p]); };
    c.addEventListener('pointermove', move); c.addEventListener('pointerup', up);
  }));
  draw();
  return svg;
}

// ------------------------------------------------------------------ chrome
$('#playBtn').onclick = () => setPlaying(!st.playing);
$('#exportBtn').onclick = async () => {
  const b = $('#exportBtn');
  if (b.dataset.file) { const a = h('a', { href: '/' + b.dataset.file, download: '' }); document.body.append(a); a.click(); a.remove(); return; }
  await fetch(`/api/export?scene=${st.scene}`, { method: 'POST' });
  b.disabled = true;
  const poll = async () => {
    const j = await (await fetch(`/api/export?scene=${st.scene}`)).json();
    if (j.state === 'running') { b.textContent = j.total ? `Exporting ${Math.round((j.done / j.total) * 100)}%` : 'Exporting…'; return setTimeout(poll, 700); }
    b.disabled = false;
    if (j.state === 'done') { b.textContent = `⤓ Download (${(j.size / 1e6).toFixed(1)} MB)`; b.dataset.file = j.file; b.classList.add('on'); setTimeout(() => { delete b.dataset.file; b.classList.remove('on'); b.textContent = '⤓ Export MP4'; }, 60000); }
    else { b.textContent = 'Export failed — retry'; console.error(j.log); }
  };
  poll();
};
$('#sendBtn').onclick = async () => {
  const b = $('#sendBtn');
  if (st.pending?.text?.trim()) await persist(st.pending);
  await fetch('/api/go', json('POST', { scene: st.scene }));
  b.textContent = 'Sent — Claude is on it'; b.classList.add('on');
  setTimeout(() => { b.textContent = '▶ Send to Claude'; b.classList.remove('on'); }, 4000);
};
$('#zoomIn').onclick = () => { st.zoomed = true; zoomBy(1.5); };
$('#zoomMinus').onclick = () => { st.zoomed = true; zoomBy(1 / 1.5); };
$('#zoomOut').onclick = () => { st.zoomed = false; fitDefault(); layoutTimeline(); };
$('#zoomAll').onclick = () => { st.zoomed = true; ppf = minPpf(); v0 = 0; layoutTimeline(); };
// pinch / ⌘-wheel zooms around the pointer; horizontal or ⇧-wheel scrolls through time
$('#tl').addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); st.zoomed = true; zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX); return; }
  const dx = e.shiftKey ? e.deltaY : e.deltaX;
  if (Math.abs(dx) > Math.abs(e.deltaY) || e.shiftKey) { e.preventDefault(); v0 += dx / ppf; clampView(); layoutTimeline(); }
}, { passive: false });
$('#loopBtn').onclick = () => setLoop(!st.loop);
$('#commentBtn').onclick = () => setComment(!st.comment);
addEventListener('copy', (e) => {
  const n = st.notes.find((x) => x.id === st.sel);
  if (!n || e.target.closest?.('input, textarea') || getSelection().toString()) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', noteContext(n));
});

addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  const fi = Math.round(st.frame);
  switch (e.key) {
    case ' ': e.preventDefault(); setPlaying(!st.playing); break;
    case 'ArrowRight': if (!st.rec) setPlaying(false); seek(fi + (e.altKey ? 10 : 1)); break;
    case 'ArrowLeft': if (!st.rec) setPlaying(false); seek(fi - (e.altKey ? 10 : 1)); break;
    case 'Home': seek(st.range ? st.range[0] : 0); break;
    case 'End': seek(st.range ? st.range[1] : st.frames - 1); break;
    case 'x': case 'X': setRange(null); break;
    case 'Backspace': case 'Delete': {   // remove the selected note (the text box keeps its own Backspace)
      const n = st.pending || st.notes.find((x) => x.id === st.sel);
      if (n) { e.preventDefault(); removeNote(n); }
      break;
    }
    case '=': case '+': st.zoomed = true; zoomBy(1.5); break;
    case '-': case '_': st.zoomed = true; zoomBy(1 / 1.5); break;
    case '0': st.zoomed = false; fitDefault(); layoutTimeline(); break;
    case 'l': case 'L': setLoop(!st.loop); break;
    case 's': case 'S': case 'c': case 'C': if (!e.metaKey && !e.ctrlKey) setComment(!st.comment); break;
    case 'Escape':
      if (st.pending) { st.pending = null; setRange(null); buildTimeline(); renderPanel(); drawOverlay(); }
      else if (st.comment) setComment(false);
      else if (st.sel) { st.sel = null; setRange(null); buildTimeline(); renderPanel(); drawOverlay(); }
      break;
    default: return;
  }
});

init();
