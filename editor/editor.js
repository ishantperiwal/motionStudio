// Motion Studio editor: scrub a scene and leave notes pinned to a frame or a span.
// The timeline lists the notes; the right panel shows only the note you're on.

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

let frameEl = $('#frame'); const playImg = $('#playImg'), view = $('#view'), overlay = $('#overlay'), panel = $('#panel');
const ruler = $('#ruler'), lanes = $('#lanes'), playhead = $('#playhead'), rangeBox = $('#rangeBox');
const LABEL_W = 200;

const st = {
  scenes: [], scene: null, S: null, beats: [], frames: 1, fps: 25, w: 1920, h: 1080, k: 1,
  frame: 0, playing: false, loop: false, range: null, comment: false,
  notes: [], pending: null, sel: null, curveOpen: false, checklist: [],
  isLottie: false, hoverHit: null, backdrop: 'checker', previewMode: 'live',
};

// Scrub log (diagnostics): what happened around each drag on the ruler, sent to the dev server when the drag ends
// (out/.diag/scrub.log), so a scrub that misbehaves in your own browser can be read back exactly.
const dlogEv = [];
function dlog(type, x) {
  const t = Math.round(performance.now()), last = dlogEv[dlogEv.length - 1];
  if (type === 'move' && last?.type === 'move' && last.buttons === x?.buttons) { last.n++; last.t1 = t; return; }   // runs of moves: one entry
  dlogEv.push({ t, type, ...x, ...(type === 'move' ? { n: 1 } : {}) }); if (dlogEv.length > 400) dlogEv.splice(0, 100);
}
function dflush(why) {
  const body = JSON.stringify({ why, at: new Date().toISOString(), ua: navigator.userAgent, hidden: document.hidden, focus: document.hasFocus(),
    S: !!st.S, frame: Math.round(st.frame), live: liveFrame(), playImg: !playImg.hidden, k: st.k, dpr: devicePixelRatio, ev: dlogEv.splice(0) });
  fetch('/api/diag', { method: 'POST', body, keepalive: true }).catch(() => {});
}
const describe = (el) => el ? `${el.tagName?.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''}` : null;
const liveFrame = () => { try { return st.S?.frame(); } catch { return 'dead'; } };
addEventListener('focus', () => dlog('win-focus', { dragging }));
addEventListener('blur', () => dlog('win-blur', { dragging }));
for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) addEventListener(t, (e) => { if (dragging || ruler.contains(e.target)) dlog(t, { buttons: e.buttons, on: describe(e.target) }); }, true);
addEventListener('pointerdown', (e) => {   // a press over the ruler that the ruler doesn't get: something covers it
  const r = ruler.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom || ruler.contains(e.target)) return;
  dlog('ruler-covered', { by: document.elementsFromPoint(e.clientX, e.clientY).slice(0, 4).map(describe) }); dflush('covered');
}, true);

// ------------------------------------------------------------------ scene
// ?embed: this editor runs inside the References panel, on one reference. The main window only ever shows films.
const EMBED = new URLSearchParams(location.search).has('embed');
const closePanel = () => window.parent.postMessage({ type: 'ms:close-refs' }, location.origin);
async function init() {
  st.scenes = await (await fetch('/api/scenes')).json();
  const pick = $('#scenePick');
  const [hs, hf] = decodeURIComponent(location.hash.slice(1)).split('@');
  const allowed = (s) => (EMBED ? s.kind === 'reference' : s.kind !== 'reference');
  st.scene = st.scenes.find((s) => s.id === hs && allowed(s))?.id || (EMBED ? null : st.scenes.find(allowed)?.id);
  if (EMBED) {
    document.body.classList.add('embed');
    $('#top').prepend(h('a', { class: 'back', href: '/editor/references.html?embed', title: 'Back to all references' }, '← References'),
      h('span', { class: 'ref-name' }, st.scenes.find((s) => s.id === st.scene)?.title || 'Reference'));
    $('#top').append(h('button', { class: 'close-panel', title: 'Close (Esc)', onclick: closePanel }, '✕'));
  }
  st.frame = +hf || 0;
  fillPicker();
  pick.onchange = () => openScene(pick.value);
  loadScene();
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const { paths = [] } = msg;
    if (paths.some((p) => p.startsWith('editor/'))) return location.reload();
    if (!st.scene && paths.some((p) => p.startsWith('scenes/'))) return location.reload();   // first scene created
    if (paths.some((p) => p.startsWith(`scenes/${st.scene}/`) || p.startsWith('runtime/') || p.startsWith('tokens/'))) reloadScene();
    if (paths.some((p) => p.startsWith(`notes/${st.scene}/`))) loadNotes();
    if (st.scene?.startsWith('ref.') && paths.some((p) => p.startsWith(`references/${st.scene.slice(4)}/`))) loadNotes();   // a finding written
  };
}

// The picker lists films and animatics only. References open in the References panel, in their own editor (?embed).
function fillPicker() {
  const pick = $('#scenePick');
  pick.replaceChildren(...st.scenes.filter((s) => s.kind !== 'reference').map((s) => h('option', { value: s.id }, s.title)));
  pick.value = st.scene;
}
async function openScene(id, frame = 0) {
  if (!st.scenes.find((s) => s.id === id)) st.scenes = await (await fetch('/api/scenes')).json();   // e.g. a reference added since
  if (!st.scenes.find((s) => s.id === id)) return;
  Object.assign(st, { scene: id, frame, range: null, sel: null, selF: null, pending: null, findings: [] });
  fillPicker();
  loadScene();
}

// A scene edit reloads the scene without interrupting you: the new version loads in a hidden iframe while the current
// one keeps scrubbing, and they swap once it's ready. If it fails to load (a broken edit), you keep the last good
// version and a badge says so. In a hidden tab the reload waits until you come back (background tabs are throttled).
let staging = null, stagingTimer = null, reloadWhenVisible = false;
function sceneBadge(text) { const b = $('#sceneBadge'); b.textContent = text || ''; b.hidden = !text; }
addEventListener('visibilitychange', () => { dlog(document.hidden ? 'hidden' : 'visible'); if (!document.hidden && reloadWhenVisible) { reloadWhenVisible = false; reloadScene(); } });
function reloadScene() {
  if (!st.S) return loadScene();                       // nothing usable yet: load it directly
  if (document.hidden) { reloadWhenVisible = true; return; }
  dlog('reload');
  staging?.remove(); clearTimeout(stagingTimer);
  staging = document.createElement('iframe');
  staging.title = 'scene (loading)';
  Object.assign(staging.style, { position: 'absolute', left: '0', top: '0', border: '0', width: `${st.w}px`, height: `${st.h}px`, opacity: '0', zIndex: '-1', pointerEvents: 'none' });   // invisible but still rendering (a visibility:hidden frame is throttled and never readies)
  frameEl.after(staging);
  staging.src = `/scenes/${st.scene}/?editor&t=${Date.now()}`;
  sceneBadge('Updating…');
  stagingTimer = setTimeout(() => sceneBadge('Scene didn’t load — showing the last good version'), 10000);
}
function loadScene() {
  dlog('load');
  staging?.remove(); staging = null; clearTimeout(stagingTimer); sceneBadge('');
  st.S = null;
  if (!st.scene) {
    frameEl.srcdoc = `<body style="margin:0;height:100vh;display:grid;place-items:center;background:#16161a;color:#a9a9b3;font:16px -apple-system,system-ui;text-align:center">
      <div><div style="color:#fff;font-weight:600;margin-bottom:8px">No scenes yet</div>Create one with<br><code style="color:#fff">npm run new-scene -- my-film</code></div></body>`;
    return;
  }
  frameEl.removeAttribute('srcdoc');
  st.loadId = (st.loadId || 0) + 1;   // playback frames rendered before this load are stale
  playImg.hidden = true; cachedSet = new Set();
  frameEl.src = `/scenes/${st.scene}/?editor&t=${Date.now()}`;
  $('#openScene').href = `/scenes/${st.scene}/`;
}

addEventListener('message', (e) => {
  if (e.data?.type !== 'studio:ready') return;
  if (staging && e.source === staging.contentWindow) {   // the reloaded scene is ready: swap it in
    clearTimeout(stagingTimer); sceneBadge('');
    staging.id = 'frame'; staging.title = 'scene'; staging.removeAttribute('style');
    frameEl.remove(); frameEl = staging; staging = null;
    st.loadId = (st.loadId || 0) + 1; playImg.hidden = true; cachedSet = new Set();   // frames rendered before it are stale
  } else if (e.source !== frameEl.contentWindow) return;
  const S = frameEl.contentWindow.__studio;
  dlog('ready');
  frameEl.contentWindow.addEventListener('error', (ev) => dlog('scene-error', { msg: ev.message }));
  bindFrameKeys(frameEl.contentWindow);
  Object.assign(st, { S, isLottie: !!S.isLottie, beats: S.beats(), frames: S.frames, fps: S.fps, w: S.width, h: S.height, hoverHit: null });
  syncLottieChrome();
  frameEl.style.width = st.w + 'px'; frameEl.style.height = st.h + 'px';
  fit(); if (!st.zoomed) fitDefault(); seek(Math.min(st.frame, st.frames - 1), true); loadNotes();
  if (st.isLottie) loadLottieHealth(); else loadExportSizes();
});

function fit() {
  const wrap = $('#viewWrap').getBoundingClientRect();
  const pad = innerHeight > 700 ? 40 : 16, toolsW = 72;   // keep the frame clear of the floating tools on the left
  st.k = Math.max(0.05, Math.min((wrap.width - pad - toolsW) / st.w, (wrap.height - pad) / st.h));
  view.style.width = st.w * st.k + 'px'; view.style.height = st.h * st.k + 'px';
  if (st.S?.setView) {   // the scene draws itself at the view size (light on the GPU); the iframe is just that size
    frameEl.style.width = st.w * st.k + 'px'; frameEl.style.height = st.h * st.k + 'px'; frameEl.style.transform = 'none';
    st.S.setView(st.k);
  } else frameEl.style.transform = `scale(${st.k})`;
  drawOverlay();
}
addEventListener('resize', () => { fit(); layoutTimeline(); });

// ------------------------------------------------------------------ time
let lastInt = -1, hashTimer = null;
function seek(f, force = false) {
  st.frame = clamp(f, 0, st.frames - 1);
  if (!st.playing) showFrame(Math.round(st.frame));   // while playing, playLoop shows the frames
  if (st.rec) growRecording();
  const fi = Math.floor(st.frame);
  if (fi === lastInt && !force) return;
  lastInt = fi;
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
  if (p && !st.S) return;
  const was = st.playing;
  st.playing = p;
  $('#playBtn').textContent = p ? '❚❚' : '▶';
  const [a, b] = st.loop && st.range ? st.range : [0, st.frames - 1];
  if (p && st.frame >= b) seek(a);
  if (!p) { clearTimeout(playTimer); cancelAnimationFrame(playTimer); seek(Math.round(st.frame), true); }
  frameTimes = []; showRate();
  if (p && !was) playLoop();
}
// What the view shows:
//  · playing: frames rendered by the server exactly the way export renders them (/api/frame), every frame in order,
//    each only once complete — at most real time; when frames aren't ready it waits (a red badge reports the rate).
//  · scrubbing / stepping: the original live view, upgraded where we can. Frames around the playhead are preloaded
//    as compressed JPEGs (PRELOAD either side, MEM at most — a few MB) and show complete at once; anything else shows
//    the live scene, as before. The frame the playhead rests on (SETTLE ms) is then shown complete.
// The server keeps frames near the playhead on disk (green on the cache bar); memory here stays a fixed MEM frames.
let playTimer = null, frameTimes = [];
// rendered frames held here: f → Promise<object URL of a JPEG>, at most MEM, nearest the playhead
const AHEAD = 10, MEM = 64, PRELOAD = 30, SETTLE = 150, rendered = new Map(), ready = new Map();   // ready: f → URL of a fetched JPEG (compressed; decoded only when shown)
let renderedKey = '';
const viewScale = () => Math.min(1, Math.max(0.25, Math.round(st.k * devicePixelRatio * 4) / 4));   // as the server rounds it
const frameQuery = () => `scene=${encodeURIComponent(st.scene)}&scale=${viewScale()}&focus=${Math.round(st.frame)}`;
function renderedFrame(f) {
  const key = `${st.scene}|${st.loadId}|${viewScale()}`;
  if (key !== renderedKey) { rendered.forEach((pr) => pr.then(URL.revokeObjectURL, () => {})); rendered.clear(); ready.clear(); renderedKey = key; }
  if (!rendered.has(f)) {
    const pr = fetch(`/api/frame?${frameQuery()}&f=${f}`)
      .then((r) => { if (!r.ok) throw new Error(`frame ${f}: ${r.status}`); return r.blob(); })
      .then((b) => { const u = URL.createObjectURL(b); if (rendered.get(f) === pr) ready.set(f, u); return u; });   // kept compressed (~100 KB): only the frame on screen gets decoded
    pr.catch(() => { if (rendered.get(f) === pr) rendered.delete(f); });   // let a failed frame be retried
    rendered.set(f, pr);
    if (rendered.size > MEM) {   // drop the frames farthest from the playhead
      const far = [...rendered.keys()].sort((a, b) => Math.abs(b - st.frame) - Math.abs(a - st.frame)).slice(0, rendered.size - MEM);
      for (const g of far) { rendered.get(g).then(URL.revokeObjectURL, () => {}); rendered.delete(g); ready.delete(g); }
    }
  }
  return rendered.get(f);
}
let showToken = 0, settleTimer = null;
// Scrubbing builds on the original live view: a rendered frame we already have (green, preloaded) shows at once;
// any other frame shows the live scene, exactly as before the cache (it may be a little unfinished). When the
// playhead rests (SETTLE ms), the rendered frame for that spot replaces the live one.
function showFrame(f) {
  if (st.isLottie) {
    if (!playImg.hidden) playImg.hidden = true;
    syncLive();
    return;
  }
  const t = ++showToken;
  clearTimeout(settleTimer);
  if (ready.has(f)) { playImg.src = ready.get(f); playImg.hidden = false; syncLiveSoon(); }
  else {
    if (!playImg.hidden) playImg.hidden = true;
    syncLive();                                                      // the live scene, as before: follows the playhead at once
    if (cachedSet.has(f)) renderedFrame(f).catch(() => {});          // on disk already: fetch it for next time
    else pingFocus();                                                // not rendered: tell the server to render here next
  }
  settleTimer = setTimeout(() => {                                   // rested: show the complete frame for this spot
    renderedFrame(f).then((u) => { if (t === showToken && !st.playing) { playImg.src = u; playImg.hidden = false; } }, () => {});
  }, SETTLE);
  preload();
}
// tell the server where the playhead is (at most every 80 ms): its render queue re-sorts around it at once, and frames
// queued for where you were are dropped once they fall out of its window
let pingAt = 0;
function pingFocus() {
  const now = performance.now(); if (now - pingAt < 80) return; pingAt = now;
  fetch(`/api/cached?${frameQuery()}`).then((r) => r.json()).then((r) => { cachedSet = new Set(r.frames); drawCacheBar(); }).catch(() => {});
}
// keep the rendered frames around the playhead in memory (only ones already on disk, a few at a time)
let preloading = 0;
function preload() {
  const f0 = Math.round(st.frame);
  for (let d = 0; d <= PRELOAD && preloading < 6; d++) for (const g of [f0 + d, f0 - d]) {
    if (preloading >= 6 || g < 0 || g >= st.frames || rendered.has(g) || !cachedSet.has(g)) continue;
    preloading++;
    renderedFrame(g).catch(() => {}).finally(() => { preloading--; if (!st.playing) preload(); });
  }
}
// the live scene underneath follows the playhead a moment later (it's only read for notes); syncLive() catches it up now
let liveTimer = null;
const syncLive = () => {
  clearTimeout(liveTimer);
  if (!st.S) return dragging && dlog('live', { S: false });
  const t = performance.now();
  try { st.S.seek(st.frame); if (sceneErr) { sceneErr = ''; sceneBadge(''); } }
  catch (err) { sceneErr = `Scene error at frame ${Math.round(st.frame)}: ${err.message}`; sceneBadge(sceneErr); dlog('error', { msg: err.message }); }
  if (dragging) dlog('live', { f: Math.round(st.frame), ms: Math.round(performance.now() - t), at: liveFrame() });
};
let sceneErr = '';
const syncLiveSoon = () => { clearTimeout(liveTimer); liveTimer = setTimeout(syncLive, 120); };

// cache bar on the ruler (like After Effects): green = rendered and ready, dim = not yet
let cachedSet = new Set();
async function pollCache() {
  if (st.S && st.scene && !st.isLottie && !document.hidden) {
    try {
      const r = await (await fetch(`/api/cached?${frameQuery()}`)).json();
      cachedSet = new Set(r.frames); drawCacheBar(); if (!st.playing) preload();
    } catch {}
  }
  setTimeout(pollCache, 400);
}
function drawCacheBar() {
  const c = $('#cacheBar');
  if (!c || !st.S) return;
  const w = ruler.clientWidth, dpr = devicePixelRatio;
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = 4 * dpr; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, 4);
  const fEnd = Math.min(st.frames - 1, Math.ceil(v0 + visibleF()));
  for (let f = Math.max(0, Math.floor(v0)); f <= fEnd; f++) {
    g.fillStyle = cachedSet.has(f) ? '#3ecf6a' : 'rgba(255,255,255,.08)';
    g.fillRect(xOf(f), 0, Math.max(1, ppf), 4);
  }
}
pollCache();
// wait for the frame to be painted; the timeout only matters when the tab is hidden (no paints happen there)
const painted = () => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 500))]);
async function playLoop() {
  if (st.isLottie) {
    let lastT = performance.now();
    const stepLottie = (now) => {
      if (!st.playing || !st.S) return;
      const dt = Math.max(0, (now - lastT) / 1000);
      lastT = now;
      const [a, b] = st.loop && st.range ? st.range : [0, st.frames - 1];
      let next = st.frame + dt * st.fps;
      if (next > b) {
        if (st.loop) next = a + ((next - a) % Math.max(1, b - a + 1));
        else { seek(b, true); setPlaying(false); return; }
      }
      st.frame = next;
      syncLive();
      seek(next);
      playTimer = requestAnimationFrame(stepLottie);
    };
    playTimer = requestAnimationFrame(stepLottie);
    return;
  }
  while (st.playing && st.S) {
    const t0 = performance.now();
    const [a, b] = st.loop && st.range ? st.range : [0, st.frames - 1];
    let f = Math.floor(st.frame) + 1;
    if (f > b) { if (st.loop) { f = a; seek(a); } else { setPlaying(false); break; } }   // looping: move the playhead first, so the server renders around the start (it only renders near the playhead)
    for (let k = 0; k < AHEAD; k++) { const g = f + k; if (g <= b) renderedFrame(g).catch(() => {}); }   // render ahead
    let url;
    try { url = await renderedFrame(f); } catch { if (!st.playing) break; await new Promise((r) => { playTimer = setTimeout(r, 200); }); continue; }
    if (!st.playing) break;
    playImg.src = url; playImg.hidden = false;
    seek(f);
    await painted();
    const wait = 1000 / st.fps - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => { playTimer = setTimeout(r, wait); });
    frameTimes.push(performance.now()); if (frameTimes.length > 12) frameTimes.shift();
    showRate();
  }
}
function showRate() {
  const el = $('#fpsBadge');
  if (!st.playing || frameTimes.length < 6) { el.hidden = true; return; }
  const fps = (frameTimes.length - 1) / ((frameTimes.at(-1) - frameTimes[0]) / 1000);
  const slow = fps < st.fps - 1.5;
  el.hidden = !slow;
  if (slow) el.textContent = `● ${fps.toFixed(0)} fps — waiting for complete frames (real time is ${st.fps})`;
}

function setRange(r) {
  st.rangeAuto = false;              // a range the person marked themselves (cleared below for ones the editor set)
  st.range = r && r[1] > r[0] ? [Math.round(r[0]), Math.round(r[1])] : null;
  $('#rangeOut').textContent = st.range ? `${st.range[0]}–${st.range[1]} (${st.range[1] - st.range[0]}f)` : '';
  layoutRange();
}
function setLoop(on) { st.loop = on; $('#loopItem').setAttribute('aria-checked', String(on)); }

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
    const proc = processing(n), who = agentName(n.sentTo);
    const bar = h('div', { class: `nbar ${n.range ? 'timed' : 'point'}${proc ? ' processing' : ''}`, title: proc ? `With ${who}: ${n.text}` : n.text },
      n.range ? h('div', { class: 'handle l' }) : null, n.range ? h('div', { class: 'handle r' }) : null);
    const lane = h('div', { class: `lane ${st.sel === n.id || n === st.pending ? 'sel' : ''}` },
      h('div', { class: 'name', title: n.text, onclick: () => n !== st.pending && selectNote(n) }, n.reply ? h('span', { class: 'replied', title: `${who} replied` }, '↩') : null, proc ? h('span', { class: 'proc', title: `With ${who}` }) : null, n.text || 'New note…'),
      bar);
    lane._note = n;
    bar.addEventListener('pointerdown', (e) => dragNote(e, n, bar));
    lanes.append(lane);
  }
  // done: what the agents finished (the To check list), in the order they finished it. Green, quieter and read-only;
  // click one to jump there and open its card; ticking it ✓ removes it
  const done = st.scene?.startsWith('ref.') ? [] : st.checklist || [];
  if (done.length) lanes.append(h('div', { class: 'lane done-h' }, h('div', { class: 'name' }, `Done · to check ${done.length}`)));
  for (const it of done) {
    const bar = h('div', { class: `nbar dbar ${it.range ? 'timed' : 'point'}`, title: `Done: ${it.text}` });
    const lane = h('div', { class: `lane done ${st.selD === it.id && !st.sel && !st.pending ? 'sel' : ''}` },
      h('div', { class: 'name', title: it.text, onclick: () => selectDone(it) }, h('span', { class: 'dmark' }, '✓'), it.text), bar);
    lane._note = it; lane._done = true;
    bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectDone(it); });
    lanes.append(lane);
  }
  // a reference's marked moments (click for the frames and what was measured); striped while they're being captured
  for (const f of st.findings || []) {
    const bar = h('div', { class: `nbar fbar ${f.range ? 'timed' : 'point'} ${f.status === 'capturing' ? 'processing' : ''} ${f.status === 'failed' ? 'failed' : ''}`, title: f.status === 'capturing' ? 'Capturing…' : f.text || f.name });
    const lane = h('div', { class: `lane finding ${st.selF === f.id ? 'sel' : ''}` },
      h('div', { class: 'name', title: f.text || f.name, onclick: () => selectFinding(f) }, h('span', { class: 'fmark' }, '◆'), f.name || 'Moment'),
      bar);
    lane._note = f; lane._finding = true;
    bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectFinding(f); });
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
  drawCacheBar();
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

// Every drag goes through onDrag, and is tied to the button that started it (the left one: other buttons never start a
// drag, see below). It ends when that button is released — on pointerup, or on the mouseup for that button, or a move
// where it isn't held — and on pointercancel or a lost pointer capture. Chrome can be wrong about the *other* buttons:
// when a release happens outside it (an app switch, a middle-click or trackpad gesture that opens something) it keeps
// reporting that button as held, every later move looks like a drag, and pointerup never fires while it thinks one is
// still down. So a drag only listens to its own button. It also ends when the window really loses focus or the tab
// hides (⌘-Tab / Alt-Tab away; focus moving into the scene's iframe is not that: the document keeps focus), and any new
// left press ends a drag still running, so a stale one can never block the next click.
const drags = new Set();   // the stop functions of the drags in progress
const BUTTON_BIT = [1, 4, 2, 8, 16];   // MouseEvent.button → its bit in MouseEvent.buttons
function onDrag(target, e, move, end) {
  let done = false;
  const pid = e.pointerId, t0 = e.timeStamp, btn = e.button ?? 0, bit = BUTTON_BIT[btn] ?? 1;
  const stop = (ev) => { if (done) return; done = true; cleanup(); end?.(ev); };
  const mv = (ev) => { if (ev.pointerId !== pid) return; if (!(ev.buttons & bit)) return stop(ev); move(ev); };
  // a press handed over as a made-up pointerdown (see below) can't hold pointer capture: Chrome drops it on the next
  // move, so that drag follows the pointer on the window instead and ignores the lost capture
  const real = e.isTrusted !== false, src = real ? target : window;
  const ends = real ? ['pointerup', 'pointercancel', 'lostpointercapture'] : ['pointerup', 'pointercancel'];
  const released = (ev) => { if (ev.button === btn) stop(ev); };   // its button came up, whatever Chrome thinks of the others
  const left = () => setTimeout(() => { if (!document.hasFocus()) stop({ type: 'window-blur' }); });
  const hid = () => { if (document.hidden) stop({ type: 'hidden' }); };
  const press = (ev) => { if (ev.button === 0 && ev.timeStamp - t0 > 40) stop({ type: 'new-press' }); };   // a later left press (not the one that started it)
  const cleanup = () => {
    drags.delete(stop);
    src.removeEventListener('pointermove', mv); ends.forEach((t) => src.removeEventListener(t, stop));
    removeEventListener('mouseup', released, true);
    removeEventListener('blur', left); document.removeEventListener('visibilitychange', hid);
    removeEventListener('pointerdown', press, true); removeEventListener('mousedown', press, true);
    try { if (target.hasPointerCapture?.(pid)) target.releasePointerCapture(pid); } catch {}
  };
  drags.add(stop);
  src.addEventListener('pointermove', mv); ends.forEach((t) => src.addEventListener(t, stop));
  addEventListener('mouseup', released, true);
  addEventListener('blur', left); document.addEventListener('visibilitychange', hid);
  addEventListener('pointerdown', press, true); addEventListener('mousedown', press, true);
  return () => { done = true; cleanup(); };   // cancel without running end
}
const capture = (el, id) => { try { el.setPointerCapture(id); } catch {} };
// Only the left button starts anything in the editor (scrubbing, note bars, spans, areas, curve handles): a middle or
// right press is stopped here, before any handler sees it.
let lastPointerDown = -1;
addEventListener('pointerdown', (e) => { if (e.button === 0) lastPointerDown = e.timeStamp; else if (e.pointerType === 'mouse') e.stopPropagation(); }, true);
// When Chrome thinks another button is still held, a left press fires no pointerdown at all (only a mousedown): hand the
// editor a pointerdown for it anyway, so every press works the same either way.
addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.timeStamp - lastPointerDown < 40 || !e.isTrusted) return;
  dlog('synth-pointerdown', { buttons: e.buttons, on: describe(e.target) });
  e.target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: e.buttons, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
    shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey }));
}, true);

let dragging = false;
function startScrub(e) {
  if (e.target.closest('#zoom')) return;
  // scrubbing is looking, not leaving: the open note (even a new one with no text yet) stays as it is
  capture(ruler, e.pointerId);
  dragging = true;
  dlog('down', { via: e.type, on: describe(e.target), ptr: e.pointerType, buttons: e.buttons, S: !!st.S, capture: ruler.hasPointerCapture(e.pointerId), focus: document.hasFocus(), active: describe(document.activeElement) });
  if (st.playing) setPlaying(false);
  seek(frameAt(e.clientX));
  onDrag(ruler, e, (ev) => { dlog('move', { buttons: ev.buttons }); seek(frameAt(ev.clientX)); }, (ev) => { dragging = false; dlog('end', { by: ev?.type }); dflush('drag'); });
}
ruler.addEventListener('pointerdown', startScrub);

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
  if (!n || !n.range || n.range[1] - n.range[0] < 2) { st.pending = null; setRange(null); buildTimeline(); renderPanel(); drawOverlay(); return; }
  n.beats = st.beats.filter((b) => b.f1 >= n.range[0] && b.f0 <= n.range[1] && b.f1 > b.f0).map(({ name, f0, f1 }) => ({ name, f0, f1 }));
  st.focusText = false; renderPanel();
  const ta = $('#panel textarea'); ta?.focus({ preventScroll: true });   // type straight away
}
// ⇧ alone records a span; with ⌘ / Ctrl / ⌥ it's part of a shortcut (e.g. ⌘⇧4 for a screenshot), so it never records,
// and adding one of them while recording drops the half-started note
const chord = (e) => e.metaKey || e.ctrlKey || e.altKey;
addEventListener('keydown', (e) => {
  if (chord(e)) { if (st.rec) { st.pending && (st.pending.range = null); stopRecording(); } return; }
  if (e.key === 'Shift' && !e.repeat && !e.target.closest('input, textarea, select')) startRecording();
});
addEventListener('keyup', (e) => { if (e.key === 'Shift') stopRecording(); });
addEventListener('blur', stopRecording);

// Drag a note: a span by either end (or the middle to slide it), a spot along time.
// The viewport shows the frame under whatever you're dragging.
function dragNote(e, n, bar) {
  e.stopPropagation();
  if (st.playing) setPlaying(false);
  capture(bar, e.pointerId);
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
    dragging = false;
    if (!moved) return n === st.pending ? null : selectNote(n);
    if (range) frame = clamp(n.frame, range[0], range[1]);
    Object.assign(n, { range, frame });
    if (n !== st.pending) fetch(`/api/notes/${st.scene}/${n.id}`, json('PATCH', { range, frame }));
    renderPanel();
  };
  onDrag(bar, e, move, up);
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
    dragging = false;
    n.beats = st.beats.filter((b) => b.f1 >= n.range[0] && b.f0 <= n.range[1] && b.f1 > b.f0).map(({ name, f0, f1 }) => ({ name, f0, f1 }));
    seek(n.range[0]);
    $('#panel textarea')?.focus({ preventScroll: true });
  };
  // listen on the window: the row is rebuilt when the note layer is added
  onDrag(window, e, move, up);
}
function renderPanelHead() { const w = $('#panel .where'); if (w && st.pending) w.textContent = where(st.pending); }

// ------------------------------------------------------------------ marking a spot on the frame
// Spot mode: hover highlights the element under the pointer; a click picks that element,
// a drag draws a free box.
let drag = null;
// A spot drag can start anywhere in the viewing area — on the frame or in the margin around it — and the box
// is clipped to the frame's edges. (Starting outside the frame used to begin a native text selection instead.)
const startSpot = (e) => {
  if (st.playing) setPlaying(false);
  e.preventDefault();
  const r = overlay.getBoundingClientRect();
  const cx = (v, max) => clamp(v, 0, max);
  drag = { x0: cx(e.clientX - r.left, r.width), y0: cx(e.clientY - r.top, r.height) };
  drag.x1 = drag.x0; drag.y1 = drag.y0;
  const move = (ev) => { const q = overlay.getBoundingClientRect(); drag.x1 = cx(ev.clientX - q.left, q.width); drag.y1 = cx(ev.clientY - q.top, q.height); drawOverlay(); };
  const up = () => {
    dismissDrag = null;
    let x = Math.min(drag.x0, drag.x1) / st.k, y = Math.min(drag.y0, drag.y1) / st.k;
    let w = Math.abs(drag.x1 - drag.x0) / st.k, hh = Math.abs(drag.y1 - drag.y0) / st.k;
    drag = null;
    if (w < 12 && hh < 12) { x -= 30; y -= 30; w = 60; hh = 60; }   // a click marks a 60px spot
    const region = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) };
    const span = openSpan();
    if (span) { span.region = region; st.areaSel = true; setComment(false); retarget(span); renderPanel(); }   // area for the open span note
    else startNote({ region });
  };
  const cancel = onDrag(window, e, move, up);
  dismissDrag = () => { cancel(); drag = null; dismissDrag = null; drawOverlay(); };
  drawOverlay();
};
overlay.addEventListener('pointerdown', (e) => { if (!st.comment) { deselect(); return; } st.hoverHit = null; startSpot(e); });
overlay.addEventListener('pointermove', (e) => {
  if (!st.comment || drag || !st.isLottie || !st.S?.inspectAt) return;
  const r = overlay.getBoundingClientRect();
  const sx = (e.clientX - r.left) / st.k, sy = (e.clientY - r.top) / st.k;
  const hit = st.S.inspectAt(sx, sy);
  const prevId = st.hoverHit?.layerId || null;
  st.hoverHit = hit;
  if ((hit?.layerId || null) !== prevId) drawOverlay();
});
overlay.addEventListener('pointerleave', () => {
  if (st.hoverHit) { st.hoverHit = null; drawOverlay(); }
});

function drawOverlay() {
  overlay.innerHTML = '';
  const box = (r, cls, label) => overlay.append(h('div', { class: `region ${cls}`, style: { left: r.x * st.k + 'px', top: r.y * st.k + 'px', width: r.w * st.k + 'px', height: r.h * st.k + 'px' } }, label ? h('span', { class: 'lbl' }, label) : null));
  if (st.comment && !drag && st.hoverHit?.rect) {
    const [rx, ry, rw, rh] = st.hoverHit.rect;
    box({ x: rx, y: ry, w: rw, h: rh }, 'hover-hit', st.hoverHit.layerId || st.hoverHit.name);
  }
  if (drag) {
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    overlay.append(h('div', { class: 'region', style: { left: x + 'px', top: y + 'px', width: Math.abs(drag.x1 - drag.x0) + 'px', height: Math.abs(drag.y1 - drag.y0) + 'px' } }));
  }
  const shown = st.pending || st.notes.find((x) => x.id === st.sel);
  if (shown?.region) overlay.append(editBox(shown));
  const fnd = !shown && st.selF && st.findings?.find((f) => f.id === st.selF);
  if (fnd?.region) box(fnd.region, 'saved found', 'studied');
}

// The open note's box can be adjusted: drag inside it to move, drag the corner grip to resize.
// On release it's treated like a freshly drawn box — elements and beats are re-detected, and a
// saved note is re-saved (the server re-takes its crop).
function editBox(n) {
  const k = st.k, label = st.pending ? null : n.elements?.[0]?.name;
  const place = (el, r) => Object.assign(el.style, { left: r.x * st.k + 'px', top: r.y * st.k + 'px', width: r.w * st.k + 'px', height: r.h * st.k + 'px' });
  const el = h('div', { class: `region edit ${st.pending ? '' : 'saved'} ${n.range && st.areaSel ? 'picked' : ''}`, title: 'Drag to move · corner to resize' },
    label ? h('span', { class: 'lbl' }, label) : null, h('div', { class: 'grip', title: 'Drag to resize' }));
  place(el, n.region);
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    if (st.playing) setPlaying(false);
    if (n.range) { st.areaSel = true; el.classList.add('picked'); }   // a span note's area can be selected on its own (⌫ removes just the area)
    const mode = e.target.classList.contains('grip') ? 'size' : 'move';
    const sx = e.clientX, sy = e.clientY, r0 = { ...n.region }, W = st.S.width, H = st.S.height;
    capture(el, e.pointerId);
    el.classList.add('dragging');
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / st.k, dy = (ev.clientY - sy) / st.k;
      n.region = mode === 'move'
        ? { ...r0, x: Math.round(clamp(r0.x + dx, 0, W - r0.w)), y: Math.round(clamp(r0.y + dy, 0, H - r0.h)) }
        : { ...r0, w: Math.round(clamp(r0.w + dx, 12, W - r0.x)), h: Math.round(clamp(r0.h + dy, 12, H - r0.y)) };
      place(el, n.region);
    };
    const up = () => {
      el.classList.remove('dragging');
      if (n.region.x !== r0.x || n.region.y !== r0.y || n.region.w !== r0.w || n.region.h !== r0.h) retarget(n);
    };
    onDrag(el, e, mv, up);
  });
  return el;
}
function retarget(n) {
  const fi = n.frame ?? Math.floor(st.frame);
  syncLive();
  const hits = st.S.hitTest(n.region, n.range || [fi, fi]);
  const elements = hits.elements.slice(0, 6).map(({ name, layerId, text, rect, keyframes }) => ({ name, ...(layerId ? { layerId } : {}), text, rect, ...(keyframes ? { keyframes } : {}) }));
  const beats = hits.beats.map(({ name, f0, f1 }) => ({ name, f0, f1 }));
  if (n === st.pending || !n.id) Object.assign(n, { elements, beats });
  else save(n, { region: n.region, elements, beats });
  const t = $('#panel .target');
  if (t) t.lastChild.textContent = elements.slice(0, 3).map((x) => x.name).join(' · ');
  else if (elements.length && !typing()) renderPanel();
  drawOverlay();
}

// the span (duration) note that's open, if any: drawing a box while it's open marks its area instead of a new note
const openSpan = () => { const n = st.pending || st.notes.find((x) => x.id === st.sel); return n?.range ? n : null; };
function setComment(on) {
  st.comment = on;
  overlay.classList.toggle('comment', on);
  $('#viewWrap').classList.toggle('comment-on', on);
  $('#commentBtn').classList.toggle('on', on);
  const cue = [...document.querySelectorAll('#panel .cue.add')].find((b) => /area/.test(b.textContent)); if (cue) { cue.classList.toggle('on', on); cue.textContent = on ? 'draw the area…' : '+ area'; }
}

// ------------------------------------------------------------------ notes
async function loadNotes() {
  if (!st.scene) return;
  const [fresh, check, findings] = await Promise.all([
    fetch(`/api/notes?scene=${st.scene}`).then((r) => r.json()),
    fetch(`/api/checklist?scene=${st.scene}`).then((r) => r.json()).catch(() => ({ items: [] })),
    st.scene.startsWith('ref.') ? fetch(`/api/moments?ref=${st.scene.slice(4)}`).then((r) => r.json()).catch(() => []) : [],
  ]);
  st.checklist = check.items || [];
  st.findings = findings;
  if (st.selF && !findings.find((f) => f.id === st.selF)) st.selF = null;
  // keep the open note's object (it may hold typing that hasn't round-tripped yet)
  const open = st.notes.find((x) => x.id && x.id === st.sel);
  st.notes = fresh.map((f) => (open && f.id === open.id ? Object.assign(open, { ...f, text: open.text, curve: open.curve ?? null, motion: open.motion ?? null, region: open.region, elements: open.elements, beats: open.beats, useRefs: open.useRefs, media: open.media }) : f));   // the open note's local edits (text, box) win
  // the open note was resolved elsewhere (e.g. by Claude): drop it and the time range it had selected,
  // so a spot note drawn next doesn't inherit that range and turn into a span note
  if (st.sel && !st.notes.find((n) => n.id === st.sel)) { st.sel = null; setRange(null); }
  buildTimeline(); drawOverlay();
  if (!typing()) renderPanel();          // never yank the text box out from under the cursor

}
const typing = () => document.activeElement?.closest?.('#panel');
// sent with "Send to Claude" and not finished yet (Claude deletes a note when it's done, or replies to it)
const processing = (n) => !!(n?.sentAt && !n.reply);

function startNote({ region = null }) {
  const fi = Math.floor(st.frame), range = region && st.rangeAuto ? null : st.range;   // a spot never inherits a range the editor selected for you
  syncLive();
  const hits = region ? st.S.hitTest(region, range || [fi, fi])
    : { beats: range ? st.beats.filter((b) => b.f1 >= range[0] && b.f0 <= range[1] && b.f1 > b.f0).map((b) => ({ name: b.name, f0: b.f0, f1: b.f1 })) : [], elements: [] };
  let elements = hits.elements.slice(0, 6).map(({ name, layerId, text, rect, keyframes }) => ({ name, ...(layerId ? { layerId } : {}), text, rect, ...(keyframes ? { keyframes } : {}) }));
  st.pending = { text: '', frame: fi, range, region, beats: hits.beats.map(({ name, f0, f1 }) => ({ name, f0, f1 })), elements, curve: null, motion: null };
  st.sel = null; st.selF = null; st.curveOpen = false; st.editing = true; st.focusText = true;
  setComment(false);
  buildTimeline(); renderPanel(); drawOverlay();
}

// Clicking anywhere empty — the area around the frame, the frame itself (outside Spot / ⌘-click),
// the ruler, or a blank part of the timeline — deselects the note. Unsaved typing is saved first.
function deselect() {
  if (st.rec) return;                         // recording a span: keep the new note
  if (st.selF && !st.pending && !st.sel) { st.selF = null; setRange(null); buildTimeline(); renderPanel(); drawOverlay(); return; }
  if (!st.pending && !st.sel) return;
  if (st.pending?.text?.trim()) persist(st.pending);
  else if (st.sel) { const n = st.notes.find((x) => x.id === st.sel); if (n) { clearTimeout(saveTimer); persist(n); } }
  st.pending = null; st.sel = null; st.editing = false; st.curveOpen = false;
  setRange(null);
  buildTimeline(); renderPanel(); drawOverlay();
}
$('#viewWrap').addEventListener('pointerdown', (e) => {
  if (e.target.closest('#view, #tools')) return;
  if (st.comment) startSpot(e);      // spot mode: a drag from the margin starts the box at the frame's edge
  else deselect();
});
lanes.addEventListener('pointerdown', (e) => { if (!e.target.closest('.nbar, .name, .add')) deselect(); });

function selectNote(n) {
  if (st.pending && st.pending.text?.trim()) persist(st.pending);
  st.pending = null; st.sel = n.id; st.selF = null; st.selD = null; st.curveOpen = false; st.editing = false; st.pick = null;
  st.areaSel = false;                  // picking the note (timeline bar) selects the note, not its area
  setPlaying(false);
  seek(n.frame, true);
  setRange(n.range || null);
  for (const lane of lanes.children) lane.classList.toggle('sel', !lane._finding && !lane._done && lane._note?.id === n.id);
  renderPanel(); drawOverlay();
}
function selectFinding(f) {
  if (st.pending && st.pending.text?.trim()) persist(st.pending);
  st.pending = null; st.sel = null; st.selF = f.id; st.selD = null; st.editing = false; st.fOpen = null;
  setPlaying(false);
  seek(f.range?.[0] ?? f.frame ?? 0, true);
  setRange(f.range || null);
  for (const lane of lanes.children) lane.classList.toggle('sel', !!lane._finding && lane._note?.id === f.id);
  renderPanel(); drawOverlay();
}

// a done item (green lane, or its To check card): jump there and show its card in the To check list
function selectDone(it) {
  if (st.pending && st.pending.text?.trim()) persist(st.pending);
  st.pending = null; st.sel = null; st.selF = null; st.selD = it.id; st.editing = false;
  if (st.replyTo !== it.id) st.replyTo = null;
  setPlaying(false); seek(it.frame, true); setRange(it.range || null); st.rangeAuto = true;
  for (const lane of lanes.children) lane.classList.toggle('sel', !!lane._done && lane._note?.id === it.id);
  renderPanel(); drawOverlay();
  panel.querySelector('.check-it.sel')?.scrollIntoView({ block: 'nearest' });
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
      n.id = note.id; n.created = note.created; n._fresh = true;   // still a draft until ✓ or it's closed
      if (st.pending === n) { st.pending = null; st.sel = n.id; }
      if (!st.notes.includes(n)) st.notes.push(n);
      buildTimeline();
    } else {
      await fetch(`/api/notes/${st.scene}/${n.id}`, json('PATCH', { text: n.text, curve: n.curve ?? null, motion: n.motion ?? null, range: n.range, frame: n.frame, elements: n.elements, beats: n.beats, region: n.region, useRefs: n.useRefs || [], media: n.media || [] }));
      const lane = [...lanes.children].find((l) => !l._done && (l._note === n || l._note?.id === n.id));
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
function removeArea(n) {
  n.region = null; n.elements = []; st.areaSel = false;
  if (n !== st.pending && n.id) save(n, { region: null, elements: [] });
  renderPanel(); drawOverlay();
}
// Escape = dismiss whatever note work is in progress: a spot being drawn, a span being recorded, a new note
// (discarded, even if autosave already created it), or an open note (closed; its saved text stays).
let dismissDrag = null;
async function dismissNote() {
  if (dismissDrag) { dismissDrag(); return; }
  if (st.rec) { st.rec = null; $('#rec').classList.remove('on'); $('#rec').textContent = '● REC'; }
  const open = st.notes.find((x) => x.id === st.sel);
  const n = st.pending || (open?._fresh ? open : null);   // a brand-new note
  if (n && n.text?.trim()) { clearTimeout(saveTimer); delete n._fresh; await persist(n); st.pending = null; st.sel = null; }   // has text: kept as a draft
  else if (n) { clearTimeout(saveTimer); await queue; if (n.id) { await removeNote(n); return; } st.pending = null; }   // empty: thrown away
  else if (st.sel) { clearTimeout(saveTimer); await queue; st.sel = null; }
  else if (st.comment) setComment(false);
  st.editing = false; setRange(null);
  buildTimeline(); renderPanel(); drawOverlay();
  document.activeElement?.blur?.();
}

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
    n.motion ? `Wanted movement: ${motionSummary(n)} (${JSON.stringify(n.motion.steps)})` : null,
    n.useRefs?.length ? `Reference moments: ${n.useRefs.map((u) => `references/${u.ref}/moments/${u.id}/ (${u.name})`).join(', ')}` : null,
    n.media?.length ? `Attached: ${n.media.map((m) => `${m.label} = ${m.path}`).join(', ')}` : null,
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

// The movement on a note (optional, under its easing): a square stands in for the element. Each step is where it
// ends up, measured from where it starts: { x, y } in stage px, scale %, rotate °. Steps play one after another,
// each with the note's easing.
const moveSubject = (n) => n.elements?.[0]?.name || 'the element';
const STILL = { x: 0, y: 0, scale: 100, rotate: 0 };
function motionSummary(n) {
  const steps = n.motion?.steps;
  if (!steps?.length) return '';
  const end = steps[steps.length - 1];
  const ease = Object.entries(st.S?.tokens?.ease || {}).find(([, p]) => n.curve && p.join() === n.curve.join())?.[0];
  return [
    ease || 'custom ease',
    end.x ? `${Math.abs(end.x)}px ${end.x > 0 ? 'right' : 'left'}` : null,
    end.y ? `${Math.abs(end.y)}px ${end.y > 0 ? 'down' : 'up'}` : null,
    end.scale !== 100 ? `scale ${end.scale}%` : null,
    end.rotate ? `rotate ${end.rotate}°` : null,
    steps.length > 1 ? `${steps.length} steps` : null,
  ].filter(Boolean).join(' · ');
}

// y of a cubic-bezier ease at progress x (Newton on x, then bisection)
function easeAt(c, x) {
  const bz = (a, b, t) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t * t + t ** 3;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const dx = bz(c[0], c[2], t) - x;
    const d = 3 * c[0] * (1 - t) ** 2 + 6 * (c[2] - c[0]) * (1 - t) * t + 3 * (1 - c[2]) * t * t;
    if (Math.abs(dx) < 1e-5 || Math.abs(d) < 1e-6) break;
    t = clamp(t - dx / d, 0, 1);
  }
  return bz(c[1], c[3], t);
}

function movementEditor(n, commit) {
  const wrap = h('div', { class: 'mv' });
  if (!n.motion) {
    wrap.append(h('button', { class: 'cue add', title: 'Show how far it moves, scales or turns, not just its timing',
      onclick: () => { st.mvStep = 0; commit({ subject: moveSubject(n), steps: [{ ...STILL, x: Math.round(st.w / 6) }] }); } }, '+ Show the movement'));
    return wrap;
  }
  const subject = n.motion.subject || moveSubject(n);
  const steps = n.motion.steps.map((s) => ({ ...STILL, ...s }));
  const sel = clamp(st.mvStep ?? steps.length - 1, 0, steps.length - 1);
  const span = n.range ? `f${n.range[0]}–${n.range[1]}` : `f${n.frame}`;
  const keep = () => commit({ subject, steps });
  wrap.append(h('div', { class: 'mv-ask' }, ...(subject === moveSubject({})
    ? [`The square stands in for what this note is about (${span}). Drag it the way you want that to move in the animation.`]
    : ['The square is ', h('b', {}, subject), ` (${span}). Drag it the way you want ${subject} to move in the animation.`]),
    ' It plays with the easing above.'));

  // the stage, scaled down; the square starts in the middle
  const W = 300, H = clamp(Math.round((W * st.h) / st.w), 120, 190), k = W / st.w, S = 26;
  const svg = svgEl('svg', { class: 'mv-stage', viewBox: `0 0 ${W} ${H}` });
  const cx = W / 2, cy = H / 2;
  const ghost = svgEl('rect', { class: 'mv-ghost', x: cx - S / 2, y: cy - S / 2, width: S, height: S, rx: 6 });
  const trail = svgEl('polyline', { class: 'mv-trail' });
  const dots = steps.map(() => svgEl('circle', { class: 'mv-dot', r: 3.5 }));
  const sq = svgEl('g', { class: 'mv-sq' });
  sq.append(svgEl('rect', { x: -S / 2, y: -S / 2, width: S, height: S, rx: 6 }));
  svg.append(ghost, trail, ...dots, sq);
  const place = (s) => sq.setAttribute('transform', `translate(${cx + s.x * k} ${cy + s.y * k}) rotate(${s.rotate}) scale(${s.scale / 100})`);
  const drawPath = () => {
    trail.setAttribute('points', [STILL, ...steps].map((s) => `${cx + s.x * k},${cy + s.y * k}`).join(' '));
    dots.forEach((d, i) => { d.setAttribute('cx', cx + steps[i].x * k); d.setAttribute('cy', cy + steps[i].y * k); d.classList.toggle('on', i === sel); });
  };

  // plays the steps in a loop (each 0.8s, then a short rest); stops while you drag or slide
  let held = false;
  const STEP = 800, REST = 500, t0 = performance.now();
  const lerp = (a, b, e) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, scale: a.scale + (b.scale - a.scale) * e, rotate: a.rotate + (b.rotate - a.rotate) * e });
  const tick = (now) => {
    if (!wrap.isConnected) return;
    if (!held) {
      const t = (now - t0) % (steps.length * STEP + REST);
      const i = Math.min(steps.length - 1, Math.floor(t / STEP));
      const e = t >= steps.length * STEP ? 1 : easeAt(n.curve, (t - i * STEP) / STEP);
      place(lerp(i ? steps[i - 1] : STILL, steps[i], e));
    }
    requestAnimationFrame(tick);
  };
  const hold = () => { held = true; place(steps[sel]); drawPath(); };
  sq.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    capture(sq, e.pointerId); hold();
    const r = svg.getBoundingClientRect(), ux = W / r.width;
    const off = { x: (e.clientX - r.left) * ux - (cx + steps[sel].x * k), y: (e.clientY - r.top) * ux - (cy + steps[sel].y * k) };
    onDrag(sq, e, (ev) => {
      let x = ((ev.clientX - r.left) * ux - off.x - cx) / k, y = ((ev.clientY - r.top) * ux - off.y - cy) / k;
      if (ev.shiftKey) (Math.abs(x) > Math.abs(y) ? (y = 0) : (x = 0));   // ⇧ keeps it straight across or up/down
      steps[sel].x = Math.round(clamp(x, -st.w, st.w)); steps[sel].y = Math.round(clamp(y, -st.h, st.h));
      hold();
    }, () => keep());
  });
  drawPath(); place(steps[sel]);
  requestAnimationFrame(tick);
  wrap.append(svg);

  // scale and turn for the selected step
  const slider = (label, key, min, max, unit) => {
    const out = h('span', { class: 'mv-val' }, `${steps[sel][key]}${unit}`);
    return h('label', { class: 'mv-slider' }, h('span', {}, label),
      h('input', { type: 'range', min, max, step: 5, value: steps[sel][key],
        oninput: (e) => { steps[sel][key] = +e.target.value; out.textContent = `${steps[sel][key]}${unit}`; hold(); },
        onchange: () => keep() }),
      out);
  };
  wrap.append(h('div', { class: 'mv-sliders' }, slider('Scale', 'scale', 25, 200, '%'), slider('Turn', 'rotate', -180, 180, '°')));

  // steps: a move can have several (pull back, then jump; a bounce)
  wrap.append(h('div', { class: 'pills mv-steps' },
    steps.length > 1 ? steps.map((_, i) => h('button', { class: i === sel ? 'on' : '', title: `Edit step ${i + 1}`, onclick: () => { st.mvStep = i; commit({ subject, steps }); } }, `Step ${i + 1}`)) : null,
    h('button', { title: 'Add another step after the last one', onclick: () => { steps.push({ ...steps[steps.length - 1] }); st.mvStep = steps.length - 1; keep(); } }, '+ step'),
    steps.length > 1 ? h('button', { class: 'ghost', onclick: () => { steps.splice(sel, 1); st.mvStep = Math.max(0, sel - 1); keep(); } }, `remove step ${sel + 1}`) : null,
    h('button', { class: 'ghost', onclick: () => commit(null) }, 'remove movement')));
  return wrap;
}

// Media: files attached to a note, as A1, A2… (the note's text can talk about "A1"). Drop or paste a file onto the open
// note, or pick one from the project's media library (your uploads and the references' videos) with "+ media". Files
// are kept in <project>/media/; Claude copies what a scene uses into its assets.
const upload = async (file) => {
  const r = await fetch(`/api/media/upload?name=${encodeURIComponent(file.name || 'pasted.png')}`, { method: 'POST', body: file });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'upload failed');
  return d;
};
const nextLabel = (n) => `A${Math.max(0, ...(n.media || []).map((m) => +String(m.label).slice(1) || 0)) + 1}`;
function attach(n, item) {
  if ((n.media || []).some((m) => m.id === item.id)) return;
  const m = { label: nextLabel(n), id: item.id, name: item.name, kind: item.kind, url: item.url, path: item.path, from: item.from };
  n.media = [...(n.media || []), m];
  if (n !== st.pending && n.id) save(n, { media: n.media });
}
async function attachFiles(n, files) {
  const keep = $('#panel textarea')?.value;
  for (const f of files) { try { attach(n, await upload(f)); } catch (e) { alert(e.message); } }
  renderPanel();
  const ta = $('#panel textarea'); if (ta && keep != null) { ta.value = keep; ta.focus({ preventScroll: true }); }
}
const openNote = () => st.pending || st.notes.find((x) => x.id === st.sel);
const upIcon = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10.5V2.5M4.75 5.75 8 2.5l3.25 3.25M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// SVG copied as markup (Figma, Affinity, an editor) arrives as text: paste it as an .svg file
const svgPaste = (cd) => {
  const t = (cd?.getData('image/svg+xml') || cd?.getData('text/plain') || '').trim();
  if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>][\s\S]*<\/svg>$/i.test(t)) return null;
  return new File([t], 'pasted.svg', { type: 'image/svg+xml' });
};
addEventListener('paste', (e) => {
  const n = openNote(), files = [...(e.clipboardData?.files || [])];
  if (!files.length) { const svg = svgPaste(e.clipboardData); if (svg) files.push(svg); }
  if (!n || !files.length) return;            // plain text pastes behave as usual
  e.preventDefault(); attachFiles(n, files);
});
panel.addEventListener('dragover', (e) => { if (openNote() && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); panel.classList.add('dropping'); } });
panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('dropping'); });
panel.addEventListener('drop', (e) => {
  panel.classList.remove('dropping');
  const n = openNote(), files = [...(e.dataTransfer?.files || [])];
  if (!n || !files.length) return;
  e.preventDefault(); attachFiles(n, files);
});
const mediaThumb = (m) => m.kind === 'video' ? h('video', { src: `${m.url}#t=0.1`, muted: true, preload: 'metadata' })
  : m.kind === 'font' ? h('span', { class: 'ph' }, 'Aa') : h('img', { src: m.url, alt: '' });

const trash = `<svg width="15" height="15" viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderPanel() {
  if (!(st.pending || st.notes.find((x) => x.id === st.sel))?.region) st.areaSel = false;
  panel.innerHTML = '';
  const n = st.pending || st.notes.find((x) => x.id === st.sel);
  const fnd = !n && st.selF && st.findings?.find((f) => f.id === st.selF);
  if (fnd) return renderFinding(fnd);
  if (!n) {
    if (st.checklist?.length) {
      const dropItem = async (it) => {
        await fetch(`/api/checklist?scene=${st.scene}&id=${encodeURIComponent(it.id)}`, { method: 'DELETE' });
        st.checklist = st.checklist.filter((x) => x !== it);
        if (st.selD === it.id) st.selD = null;
        buildTimeline();
      };
      // a reply turns the item back into a note at the same frame / span (and region, if known), and sends it straight
      // to the picked agent (↑ / Enter); "Save as draft" keeps it unsent, to send later with others
      const sendReply = async (it, text, { send = true } = {}) => {
        if (!text.trim()) return;
        const range = it.range || null, frame = it.frame;
        const beats = st.beats.filter((b) => (range ? b.f1 >= range[0] && b.f0 <= range[1] : frame >= b.f0 && frame <= b.f1) && b.f1 > b.f0).map(({ name, f0, f1 }) => ({ name, f0, f1 }));
        const note = await (await fetch('/api/notes', json('POST', { scene: st.scene, frame, range, region: it.region || null, text: text.trim(), followUp: it.text, beats, elements: it.elements || [], curve: null, useRefs: it.useRefs || [], media: it.media || [] }))).json();   // a reply keeps the references and files the change was built from
        await dropItem(it);
        st.replyTo = null;
        st.notes.push(note); st.sel = note.id; st.editing = false;
        setPlaying(false); seek(frame, true); setRange(range);
        buildTimeline(); renderPanel(); drawOverlay();
        if (send) await sendNotes([note.id]);   // like a note's own ↑: just this reply
      };
      const checkAll = async () => {
        await fetch(`/api/checklist?scene=${st.scene}&id=*`, { method: 'DELETE' });
        st.checklist = []; st.replyTo = null; st.selD = null; buildTimeline(); renderPanel();
      };
      panel.append(h('div', { class: 'check-h' }, h('span', {}, 'To check ', h('span', { class: 'muted' }, `${st.checklist.length}`)),
        h('button', { class: 'check-all', title: 'All checked — clear the list', onclick: checkAll }, '✓ Check all')),
        ...st.checklist.map((it) => {
          const replying = st.replyTo === it.id;
          const queued = it.status === 'queued';
          const card = h('div', { class: `check-it ${queued ? 'queued' : ''} ${replying ? 'replying' : ''} ${st.selD === it.id ? 'sel' : ''}`, title: 'Jump there', onclick: () => selectDone(it) },
            h('span', { class: 'fr' }, it.range ? `${it.range[0]}–${it.range[1]}` : `f ${it.frame}`, queued ? h('span', { class: 'q-tag' }, `Queued · ${agentName(it.agent)}`) : null),
            h('span', { class: 'tx' }, it.text),
            // while replying: ✕ cancels the reply, ↑ sends it (✓ never dismisses an item you're replying to)
            h('div', { class: 'check-btns' },
              replying
                ? h('button', { class: 'reply-btn', title: 'Cancel reply', onclick: (e) => { e.stopPropagation(); st.replyTo = null; renderPanel(); } }, '✕')
                : h('button', { class: 'reply-btn', title: 'More to say? Reply — it comes back as a note here', onclick: (e) => { e.stopPropagation(); st.replyTo = it.id; renderPanel(); } }, '↩'),
              replying
                ? h('button', { class: 'resolve small send', title: `Send reply to ${pickedName()} (Enter)`, onclick: (e) => { e.stopPropagation(); sendReply(it, card.querySelector('textarea')?.value || ''); } }, '↑')
                : h('button', { class: 'resolve small', title: 'Checked — remove', onclick: async (e) => { e.stopPropagation(); await dropItem(it); renderPanel(); } }, '✓')));
          const hasAtt = it.media?.length || it.useRefs?.length;
          if (hasAtt) card.append(h('div', { class: 'att-row check-att', onclick: (e) => e.stopPropagation() },
            ...(it.media || []).map((m) => h('a', { class: 'att-chip', href: m.url, target: '_blank', title: `${m.label} · ${m.name}${m.from === 'reference' ? ' (a reference video)' : ''}` },
              mediaThumb(m), h('b', {}, m.label), h('span', {}, m.name))),
            ...(it.useRefs || []).map((u) => h('span', { class: 'att-chip ref', title: `Reference moment: ${u.name}${u.refName ? ` · ${u.refName}` : ''} · click to inspect frames`, onclick: (e) => { e.stopPropagation(); openRefMoment(u, it, 'To check'); } },
              h('span', { class: 'fmark' }, '◆'), h('span', {}, u.name)))));
          if (replying) {
            const ta = h('textarea', { placeholder: `What else should change here? (Enter sends to ${pickedName()} · ⇧Enter for a new line)`, onclick: (e) => e.stopPropagation(),
              onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(it, ta.value); } if (e.key === 'Escape') { st.replyTo = null; renderPanel(); } } });   // Enter sends, ⇧Enter = new line
            card.append(h('div', { class: 'reply-box', onclick: (e) => e.stopPropagation() }, ta,
              h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => sendReply(it, ta.value) }, 'Send ↵'), h('button', { title: 'Keep it as a draft note, to send later', onclick: () => sendReply(it, ta.value, { send: false }) }, 'Save as draft'), h('button', { onclick: () => { st.replyTo = null; renderPanel(); } }, 'Cancel'))));
            requestAnimationFrame(() => ta.focus({ preventScroll: true }));
          }
          return card;
        }));
    }
    panel.append(h('p', { class: 'muted hint' }, 'Use ✎ Spot (S) and draw a tight box around what you mean (or click a spot); drag across the top timeline row to note a span. Click a note row in the timeline to open it.'));
    return;
  }
  const editing = n === st.pending || st.editing || !n.text?.trim();
  const isRef = st.scene?.startsWith('ref.'), sent = processing(n);
  const del = h('button', { class: 'del', title: 'Delete this note (⌫)', onclick: () => removeNote(n) });
  del.innerHTML = trash;

  // Clicking a processing bar in the timeline shows the warm amber "Queued · <Agent>" card
  if (sent && !editing && !isRef) {
    const frLbl = n.range ? `${n.range[0]}–${n.range[1]}` : `f ${n.frame}`;
    const card = h('div', { class: 'proc-card' },
      h('div', { class: 'proc-head' },
        h('div', { class: 'proc-meta' },
          h('span', { class: 'fr' }, frLbl),
          h('span', { class: 'q-tag', title: `Sent to ${agentName(n.sentTo)}; moves to To check once finished` }, `Queued · ${agentName(n.sentTo)}`)),
        del),
      n.followUp ? h('div', { class: 'followup' }, h('b', {}, 'Follow-up on: '), n.followUp) : null,
      n.elements?.length ? h('div', { class: 'target' }, h('span', { class: 'muted' }, 'In the box: '), n.elements.slice(0, 3).map((e) => e.name).join(' · ')) : null,
      h('div', { class: 'proc-tx', title: `With ${agentName(n.sentTo)} · click to edit`, onclick: () => { st.editing = true; st.focusText = true; renderPanel(); } }, n.text));
    const chips = [
      ...(n.media || []).map((m) => h('a', { class: 'att-chip', href: m.url, target: '_blank', title: `${m.label} · ${m.name}` }, mediaThumb(m), h('b', {}, m.label), h('span', {}, m.name))),
      ...(n.useRefs || []).map((u) => h('span', { class: 'att-chip ref', onclick: (e) => { e.stopPropagation(); openRefMoment(u, n); } }, h('span', { class: 'fmark' }, '◆'), h('span', {}, u.name))),
      n.curve ? h('span', { class: 'att-chip' }, miniCurve(n.curve), h('span', {}, motionSummary(n) || `cubic-bezier(${n.curve.join(', ')})`)) : null,
    ].filter(Boolean);
    if (chips.length) card.append(h('div', { class: 'att-row' }, chips));
    panel.append(card);
    if (n.reply) panel.append(h('div', { class: 'reply' }, h('b', {}, agentName(n.sentTo)), n.reply));
    return;
  }

  const head = h('div', { class: 'head' },
    h('span', { class: 'where' }, where(n)),
    h('div', { class: 'head-btns' },
      isRef
        ? h('button', { class: 'resolve save-moment', title: 'Save this moment (⌘↵): its frames and measurements are captured at once', onclick: () => saveMoment(n) }, '◆ Save')
        : sent
        ? h('span', { class: 'q-tag', title: `Sent to ${agentName(n.sentTo)}; moves to To check once finished` }, `Queued · ${agentName(n.sentTo)}`)
        : [n.id && n.text?.trim() && !editing ? h('span', { class: 'saved draft', title: 'Saved, not sent yet' }, 'Draft') : null,
           h('button', { class: 'resolve send', title: `Send this note to ${pickedName()} (⌘↵). The top Send button sends all unsent notes`, onclick: () => sendNote(n) }, '↑')],
      del));
  panel.append(head);

  if (n.followUp) panel.append(h('div', { class: 'followup' }, h('b', {}, 'Follow-up on: '), n.followUp));
  if (n.elements?.length) panel.append(h('div', { class: 'target' }, h('span', { class: 'muted' }, 'In the box: '), n.elements.slice(0, 3).map((e) => e.name).join(' · ')));
  const rerender = () => { const keep = $('#panel textarea')?.value; renderPanel(); if (keep != null && $('#panel textarea')) $('#panel textarea').value = keep; };
  const setUse = (list) => { save(n, { useRefs: list }); rerender(); };
  const setCurve = (c) => { save(n, { curve: c }); st.curveOpen = !!c; const keep = $('#panel textarea')?.value; renderPanel(); if (keep != null && $('#panel textarea')) $('#panel textarea').value = keep; };

  // the note box: the text and what's attached to it (files as A1, A2…; moments from references), in one box. Once sent,
  // the box drops its border and the note reads as sent text
  const box = h('div', { class: `composer ${editing ? 'editing' : sent ? 'sent' : 'draft'}` });
  if (editing) {
    const ta = h('textarea', {
      value: n.text || '', placeholder: isRef ? 'Name this moment, or say what you like about it (optional)' : 'What should change here?  Drop or paste a file to attach it',
      oninput: (e) => save(n, { text: e.target.value }),
      onkeydown: (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); isRef ? saveMoment(n) : sendNote(n); }   // Enter alone is a new line
        if (e.key === 'Escape') { e.preventDefault(); dismissNote(); }   // closes; a note with text stays as a draft
      },
    });
    box.append(ta);
    requestAnimationFrame(() => { if (document.activeElement !== ta && st.focusText) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); st.focusText = false; } });
  } else {
    box.append(h('div', { class: 'text-view', title: sent ? 'Sent to Claude · click to edit' : 'Click to edit', onclick: () => { st.editing = true; st.focusText = true; renderPanel(); } }, n.text));
  }
  const removable = !sent;
  const chips = [
    ...(n.media || []).map((m) => h('a', { class: 'att-chip', href: m.url, target: '_blank', title: `${m.label} · ${m.name}${m.from === 'reference' ? ' (a reference video)' : ''}` },
      mediaThumb(m), h('b', {}, m.label), h('span', {}, m.name),
      removable ? h('button', { class: 'x', title: 'Remove from this note', onclick: (e) => { e.preventDefault(); e.stopPropagation(); n.media = n.media.filter((x) => x !== m); if (n.id) save(n, { media: n.media }); rerender(); } }, '×') : null)),
    ...(isRef ? [] : (n.useRefs || []).map((u) => h('span', { class: 'att-chip ref', title: `Reference moment: ${u.name}${u.refName ? ` · ${u.refName}` : ''} · click to inspect frames`, onclick: (e) => { e.stopPropagation(); openRefMoment(u, n); } },
      h('span', { class: 'fmark' }, '◆'), h('span', {}, u.name),
      removable ? h('button', { class: 'x', title: 'Remove', onclick: (e) => { e.stopPropagation(); setUse((n.useRefs || []).filter((x) => x !== u)); } }, '×') : null))),
  ];
  if (chips.length) box.append(h('div', { class: 'att-row' }, chips));
  panel.append(box);

  // what can be added to the note, together in one row (hidden once it's with Claude)
  if (!sent) panel.append(h('div', { class: 'cues' },
    n.curve
      ? h('button', { class: `cue ${st.curveOpen ? 'on' : ''}`, title: 'The motion you want — click to edit', onclick: () => { st.curveOpen = !st.curveOpen; renderPanel(); } },
          miniCurve(n.curve), motionSummary(n) || `cubic-bezier(${n.curve.join(', ')})`)
      : h('button', { class: 'cue add', title: 'Show the easing you want (and, optionally, the movement)', onclick: () => setCurve([...(st.S.tokens?.ease?.move || [0.45, 0, 0.2, 1])]) }, '+ motion'),
    n.range
      ? (n.region
          ? h('button', { class: 'cue', title: 'Remove the marked area', onclick: () => removeArea(n) }, '✕ area')
          : h('button', { class: `cue add ${st.comment ? 'on' : ''}`, title: 'Draw a box on the frame to mark an area for this span (S)', onclick: () => setComment(!st.comment) }, st.comment ? 'draw the area…' : '+ area'))
      : null,
    isRef ? null : h('button', { class: `cue add ${st.pick === 'ref' ? 'on' : ''}`, title: 'Point at a moment marked on a reference: Claude borrows its motion and/or look', onclick: async () => { st.pick = st.pick === 'ref' ? null : 'ref'; if (st.pick) st.allMoments = await (await fetch('/api/moments')).json(); rerender(); } }, '+ reference'),
    isRef ? null : h('button', { class: `cue add ${st.pick === 'media' ? 'on' : ''}`, title: 'Attach a file from the media library, or upload one (you can also drop or paste files here)', onclick: async () => { st.pick = st.pick === 'media' ? null : 'media'; if (st.pick) st.allMedia = await (await fetch('/api/media')).json(); rerender(); } }, '+ media')));
  if (!isRef && st.pick === 'ref') {
    const list = (st.allMoments || []).filter((f) => !(n.useRefs || []).some((u) => u.ref === f.ref && u.id === f.id));
    panel.append(h('div', { class: 'f-pick' }, list.length ? list.map((f) => h('button', { class: 'f-item', onclick: () => {
      st.pick = null;
      setUse([...(n.useRefs || []), { ref: f.ref, id: f.id, name: f.name, refName: f.refName, scene: f.scene, frame: f.range?.[0] ?? f.frame }]);
    } }, f.stills?.[0] ? h('img', { src: `${f.base}${f.stills[0]}?v=${f.v}` }) : h('span', { class: 'ph' }),
      h('span', { class: 'tx' }, h('b', {}, f.name), h('span', { class: 'muted' }, `${f.refName} · ${f.seconds ? f.seconds.toFixed(1) + 's' : ''}`), f.text && f.text !== f.name ? h('span', {}, f.text) : null)))
      : h('div', { class: 'muted' }, 'No moments yet. Open References (R), add a video, and mark a moment on it.')));
  }
  if (!isRef && st.pick === 'media') {
    const input = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { st.pick = null; attachFiles(n, [...input.files]); } });
    const list = (st.allMedia || []).filter((m) => !(n.media || []).some((x) => x.id === m.id));
    panel.append(h('div', { class: 'f-pick' }, input,
      (() => { const b = h('button', { class: 'f-upload', title: 'Or drop a file on the note', onclick: () => input.click() }); b.innerHTML = upIcon; b.append('Upload a video, image or GIF'); return b; })(),
      list.map((m) => h('button', { class: 'f-item', onclick: () => { st.pick = null; attach(n, m); rerender(); } }, mediaThumb(m),
        h('span', { class: 'tx' }, h('b', {}, m.name), h('span', { class: 'muted' }, `${m.kind}${m.from === 'reference' ? ' · reference video' : ''}`))))));
  }
  if (n.curve && st.curveOpen) {
    const tokens = Object.entries(st.S.tokens?.ease || {});
    panel.append(h('div', { class: 'curve' },
      bezierEditor(n.curve, () => {}, (c) => setCurve(c)),
      h('div', { class: 'pills' }, ...tokens.map(([name, pts]) => h('button', { class: pts.join() === n.curve.join() ? 'on' : '', onclick: () => setCurve([...pts]) }, name)),
        h('button', { class: 'ghost', onclick: () => { save(n, { motion: null }); setCurve(null); } }, 'remove')),
      sent ? null : movementEditor(n, (motion) => { save(n, { motion }); rerender(); })));
  }
  if (n.reply) panel.append(h('div', { class: 'reply' }, h('b', {}, agentName(n.sentTo)), n.reply));
}

function frameSeq(f, opts = {}) {
  const n = f.frames || 0, fps = f.fps || st.fps, pad = (i) => String(i).padStart(4, '0');
  const src = (i) => `${f.base}frames/f${pad(i)}.jpg?v=${f.v}`;
  const keys = (f.stills || []).map((file) => ({ file, frame: +file.match(/f(\d+)/)?.[1] || null }));
  const img = h('img', { src: n ? src(1) : '', alt: '' });
  const fill = h('i', { class: 'fill' }), cap = h('span', { class: 'cap' });
  const bar = h('div', { class: 'bar' }, fill, ...keys.filter((k) => k.frame && n).map((k) => h('b', { style: { left: `${((k.frame - 1) / Math.max(1, n - 1)) * 100}%` } })));
  const show = (i) => {
    img.src = src(i);
    fill.style.width = `${((i - 1) / Math.max(1, n - 1)) * 100}%`;
    cap.textContent = `f${i} · ${((i - 1) / fps).toFixed(2)}s`;
  };
  let warm = false;
  const view = h('div', { class: 'view', title: n ? 'Move across to scrub every frame' : '' }, img, cap);
  if (n) {
    view.addEventListener('pointerenter', () => { if (!warm) { warm = true; for (let i = 1; i <= n; i++) new Image().src = src(i); } view.classList.add('scrub'); });
    view.addEventListener('pointermove', (e) => { const r = view.getBoundingClientRect(); show(clamp(Math.round(((e.clientX - r.left) / r.width) * (n - 1)) + 1, 1, n)); });
    view.addEventListener('pointerleave', () => { view.classList.remove('scrub'); img.src = src(1); fill.style.width = '0'; cap.textContent = ''; });
  }
  let open = opts.openKeys !== undefined ? opts.openKeys : st.fOpen === 'keys';
  const keysEl = keys.length ? h('div', { class: 'f-keys', hidden: !open }, keys.map((k) => h('a', { href: `${f.base}${k.file}`, target: '_blank', title: 'Open full size' },
    h('img', { src: `${f.base}${k.file}?v=${f.v}`, loading: 'lazy' }), h('span', {}, k.frame ? `f${k.frame}` : '')))) : null;
  const toggle = h('button', { class: `chip ${open ? 'on' : ''}`, onclick: () => {
    if (opts.onToggleKeys) return opts.onToggleKeys(!open);
    if (opts.openKeys !== undefined) { open = !open; toggle.classList.toggle('on', open); if (keysEl) keysEl.hidden = !open; return; }
    st.fOpen = open ? null : 'keys'; renderPanel();
  } }, `Stills ${keys.length}`);
  const box = h('div', { class: 'f-seq' }, view, n ? bar : null,
    h('div', { class: 'meta' }, h('span', {}, n ? `▦ ${n} frames · ${(n / fps).toFixed(1)}s` : '▦ frames'), keys.length ? toggle : null),
    keysEl);
  return box;
}

async function openRefMoment(u, note, status) {
  if (EMBED) return;
  $('#refMomentModal')?._close?.();
  const close = () => {
    const m = $('#refMomentModal');
    if (!m || m.classList.contains('closing')) return;
    removeEventListener('keydown', onKey, true);
    m.classList.add('closing');
    setTimeout(() => m.remove(), 180);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  const seqWrap = h('div', { class: 'rm-seq' }, h('div', { class: 'muted' }, 'Loading reference frames…'));
  const side = h('div', { class: 'rm-side' });
  const statusLbl = processing(note) ? `With ${agentName(note.sentTo)}` : status || (note.reply ? 'Replied' : 'Draft');
  const noteCard = h('div', { class: 'rm-card' },
    h('h4', {}, h('span', {}, `Note · ${where(note)}`), h('span', { class: `rm-pill ${processing(note) ? 'proc' : ''}` }, statusLbl)),
    note.followUp ? h('div', { class: 'rm-follow' }, h('b', {}, 'Follow-up on: '), note.followUp) : null,
    h('div', { class: 'rm-comment' }, note.text?.trim() || 'No comment on this note.'));
  side.append(noteCard);

  const openBtn = h('button', { class: 'rm-open', title: 'Open this reference in the References panel', onclick: () => {
    close();
    openRefs(`/editor/?embed#${u.scene || `ref.${u.ref}`}@${u.frame ?? 0}`);
  } }, 'Open in References');
  const closeBtn = h('button', { class: 'rm-close', title: 'Close (Esc)', onclick: close }, '×');
  const head = h('div', { class: 'rm-head' },
    h('span', { class: 'fmark' }, '◆'),
    h('span', { class: 'rm-title' }, u.name || 'Reference moment'),
    u.refName ? h('span', { class: 'rm-sub' }, `· ${u.refName}`) : null,
    h('span', { class: 'spacer' }), openBtn, closeBtn);
  const modal = h('div', { id: 'refMomentModal', onclick: (e) => { if (e.target.id === 'refMomentModal') close(); } },
    h('div', { class: 'sheet' }, head, h('div', { class: 'rm-body' }, seqWrap, side)));
  modal._close = close;
  document.body.append(modal);
  addEventListener('keydown', onKey, true);
  setPlaying(false);

  try {
    const list = await (await fetch(`/api/moments?ref=${encodeURIComponent(u.ref)}`)).json();
    const f = list.find((x) => x.id === u.id);
    if (!modal.isConnected) return;
    seqWrap.innerHTML = '';
    if (!f) { seqWrap.append(h('div', { class: 'muted' }, 'Moment not found on this reference.')); return; }
    if (f.status === 'capturing') seqWrap.append(h('div', { class: 'muted' }, 'Cutting out the frames and measuring them…'));
    else if (f.status === 'failed') seqWrap.append(h('div', { class: 'muted' }, f.error || 'Capture failed.'));
    else seqWrap.append(frameSeq(f, { openKeys: true }));

    const refDetails = [];
    if (f.text && f.text !== f.name) refDetails.push(h('div', { class: 'rm-comment' }, f.text));
    if (f.move?.ease) refDetails.push(h('div', { class: 'muted' }, `${f.move.seconds}s (${f.move.studioFrames} f at 25 fps) · ${f.move.ease.nearestToken || 'custom'} [${f.move.ease.bezier.join(', ')}]`));
    else if (f.seconds) refDetails.push(h('div', { class: 'muted' }, `${f.seconds.toFixed(2)}s · ${f.frames} frames`));
    if (f.palette?.length) refDetails.push(h('div', { class: 'f-pal' }, f.palette.slice(0, 8).map((c) => h('span', { class: 'sw', title: `${c.hex} · ${Math.round(c.share * 100)}%`, style: { background: c.hex } }))));
    if (refDetails.length) side.append(h('div', { class: 'rm-card' }, h('h4', {}, 'Reference moment'), ...refDetails));
  } catch {
    if (modal.isConnected) { seqWrap.innerHTML = ''; seqWrap.append(h('div', { class: 'muted' }, 'Could not load reference frames.')); }
  }
}
// A moment marked on a reference: its frames to scrub and what was measured (no write-up: Claude reads the frames when
// a film note uses it). Claude's notes from earlier studies, if any, sit behind a chip.
function renderFinding(f) {
  const del = h('button', { class: 'del', title: 'Delete this moment', onclick: async () => {
    if (!confirm(`Delete the moment “${f.name}”? Its frames and measurements are removed.`)) return;
    await fetch(`/api/moments/${f.ref}/${f.id}`, { method: 'DELETE' });
    st.selF = null; setRange(null); loadNotes();
  } });
  del.innerHTML = trash;
  const state = f.status === 'capturing' ? h('span', { class: 'saved proc' }, 'Capturing…') : f.status === 'failed' ? h('span', { class: 'saved', style: { color: 'var(--warn)' } }, 'Failed') : h('span', { class: 'saved found' }, '◆ Moment');
  panel.append(h('div', { class: 'head' }, h('span', { class: 'where' }, where(f)), h('div', { class: 'head-btns' }, state, del)));
  const name = h('input', { class: 'f-name', value: f.name || '', placeholder: 'Name this moment', spellcheck: false,
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    onblur: (e) => { const v = e.target.value.trim(); if (v && v !== f.name) { f.name = v; fetch(`/api/moments/${f.ref}/${f.id}`, json('PATCH', { name: v })).then(() => buildTimeline()); } } });
  panel.append(h('div', { class: 'f-top' }, name, f.text && f.text !== f.name ? h('div', { class: 'f-sum' }, f.text) : null));
  if (f.status === 'failed') { panel.append(h('div', { class: 'reply' }, f.error || 'The capture failed')); return; }
  if (f.status === 'capturing') { panel.append(h('p', { class: 'muted hint' }, 'Cutting out the frames and measuring them… a few seconds.')); return; }
  panel.append(frameSeq(f));
  const mv = f.move, stats = [{ label: 'Moment', value: `${(f.seconds || 0).toFixed(2)}s`, sub: `${f.frames} frames` }];
  if (mv) {
    stats.push({ label: 'Main move', value: `${mv.seconds}s`, sub: `${mv.studioFrames} f at 25 fps` });
    if (mv.overshoot) stats.push({ label: 'Overshoot', value: `${Math.round(mv.overshoot.by * 100)}%` });
    else if (mv.travel) stats.push({ label: 'Travel', value: `${mv.travel.px}px`, sub: mv.travel.direction });
  }
  panel.append(h('div', { class: 'f-sec' }, h('h4', {}, 'Measured'),
    h('div', { class: 'f-stats' }, stats.map((x) => h('div', { class: 'stat' }, h('span', { class: 'l' }, x.label), h('b', {}, x.value), x.sub ? h('span', { class: 's' }, x.sub) : null))),
    mv?.ease ? h('div', { class: 'f-ease' }, mv.ease.bezier ? miniCurve(mv.ease.bezier) : null,
      h('div', {}, h('b', {}, mv.ease.nearestToken || 'custom ease'), h('code', {}, `[${mv.ease.bezier.join(', ')}] · ${mv.shape}`))) : h('div', { class: 'muted' }, f.moves ? '' : 'No single clear move: a texture, a shimmer or several things at once. Claude reads the frames.'),
    f.palette?.length ? h('div', { class: 'f-pal' }, f.palette.slice(0, 10).map((c) => h('button', { class: 'sw', title: `${c.hex} · ${Math.round(c.share * 100)}% (click to copy)`, style: { background: c.hex },
      onclick: async (e) => { try { await navigator.clipboard.writeText(c.hex); } catch {} const b = e.currentTarget; b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 900); } }))) : null));
  if (f.study) {
    const st2 = f.study, list = (title, items) => items?.length ? h('div', {}, h('h5', {}, title), h('ul', {}, items.map((t) => h('li', {}, typeof t === 'string' ? t : [t.role, t.name, t.spec].filter(Boolean).join(' · '))))) : null;
    panel.append(h('div', { class: 'f-more' }, h('button', { class: `chip ${st.fOpen === 'study' ? 'on' : ''}`, onclick: () => { st.fOpen = st.fOpen === 'study' ? null : 'study'; renderPanel(); } }, '▤ Earlier study')));
    if (st.fOpen === 'study') panel.append(h('div', { class: 'f-drawer' }, st2.summary ? h('div', {}, st2.summary) : null,
      list('Motion', st2.motion?.points), list('Type', st2.style?.type), list('Style', st2.style?.points)));
  }
}

// cubic-bezier editor (the value graph only); y may leave 0..1 (anticipation / overshoot)
function bezierEditor(points, onInput, onCommit) {
  const W = 300, H = 210, pad = 20, Y0 = -0.6, Y1 = 1.6, SH = 0, SNAP = 4;   // SNAP: degrees from flat within which an arm snaps flat
  const p = [...points];
  const X = (x) => pad + x * (W - 2 * pad), Y = (y) => pad + ((Y1 - y) / (Y1 - Y0)) * (H - 2 * pad);
  const ix = (px) => (px - pad) / (W - 2 * pad), iy = (py) => Y1 - ((py - pad) / (H - 2 * pad)) * (Y1 - Y0);
  const svg = svgEl('svg', { class: 'bz', viewBox: `0 0 ${W} ${H + SH}` });
  for (const y of [0, 1]) svg.append(svgEl('line', { class: 'grid', x1: pad, x2: W - pad, y1: Y(y), y2: Y(y) }));
  svg.append(svgEl('line', { class: 'base', x1: X(0), y1: Y(0), x2: X(1), y2: Y(1) }));
  const arm1 = svgEl('line', { class: 'arm' }), arm2 = svgEl('line', { class: 'arm' }), curve = svgEl('path', { class: 'curve' });
  svg.append(arm1, arm2, curve);
  const hs = [0, 1].map(() => { const c = svgEl('circle', { class: 'h', r: 7 }); svg.append(c); return c; });
  const set = (el, a) => Object.entries(a).forEach(([k, v]) => el.setAttribute(k, v));
  function draw() {
    curve.setAttribute('d', `M${X(0)},${Y(0)} C${X(p[0])},${Y(p[1])} ${X(p[2])},${Y(p[3])} ${X(1)},${Y(1)}`);
    set(arm1, { x1: X(0), y1: Y(0), x2: X(p[0]), y2: Y(p[1]) }); set(arm2, { x1: X(1), y1: Y(1), x2: X(p[2]), y2: Y(p[3]) });
    set(hs[0], { cx: X(p[0]), cy: Y(p[1]) }); set(hs[1], { cx: X(p[2]), cy: Y(p[3]) });
  }
  hs.forEach((c, i) => c.addEventListener('pointerdown', (e) => {
    capture(c, e.pointerId);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      p[i * 2] = r2(clamp(ix(((ev.clientX - r.left) / r.width) * W), 0, 1));
      p[i * 2 + 1] = r2(clamp(iy(((ev.clientY - r.top) / r.height) * (H + SH)), Y0, Y1));
      // snap the arm flat (a true ease-in / ease-out) when it's within SNAP° of horizontal; hold ⌘ to move freely
      const ay = i ? 1 : 0, dx = X(p[i * 2]) - X(i), dy = Y(p[i * 2 + 1]) - Y(ay);
      const snapped = !ev.metaKey && Math.abs(dx) > 4 && Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI < SNAP;
      if (snapped) p[i * 2 + 1] = ay;
      (i ? arm2 : arm1).classList.toggle('snap', snapped);
      draw(); onInput([...p]);
    };
    const up = () => { arm1.classList.remove('snap'); arm2.classList.remove('snap'); onCommit([...p]); };
    onDrag(c, e, move, up);
  }));
  draw();
  return svg;
}

// ------------------------------------------------------------------ chrome
$('#playBtn').onclick = () => setPlaying(!st.playing);
// Export: pick a size on the slider (100 px steps of the width or the height, the other side following the aspect
// ratio; each with a rough file-size estimate), export, stop while it runs, then download
const EST_BPPF = 0.0067;   // bytes per pixel per frame, used until this scene has a real export to calibrate from
let exportCalib = null;
const WEBM_RATIO = 0.74;   // a WebM (VP9) is about this much of an MP4 (H.264) at the same quality (measured on this studio's films)
const exportFmt = () => $('#exportFmt').value || 'mp4';
const exportLabel = () => `⤓ Export ${exportFmt() === 'webm' ? 'WebM' : 'MP4'}`;
const fmtSize = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
let exportAxis = 'w', exportKeep = null;   // which side steps by 100 px; the size to keep across reloads
try { const k = JSON.parse(localStorage.getItem('ms.exportSize') || 'null'); if (k) { exportAxis = k.axis; exportKeep = k.side; } } catch {}
// the sizes on the slider: every 100 px of the chosen side up to the full size (the full size itself last), at least 200 px
function exportSteps() {
  const full = exportAxis === 'w' ? st.w : st.h, sides = [];
  for (let v = 200; v < full; v += 100) sides.push(v);
  sides.push(full);
  return sides.map((side) => {
    const k = side / full, W = Math.round((st.w * k) / 2) * 2, H = Math.round((st.h * k) / 2) * 2;   // even sides (video needs them)
    return { side, W, H, scale: W / st.w };
  });
}
const exportEstimate = ({ W, H }) => {   // H.264 needs relatively more bits per pixel at small sizes, so size scales a little slower than pixel count
  const c = exportCalib, mp4 = c ? (c.bytes / (c.fmt === 'webm' ? WEBM_RATIO : 1)) * (st.frames / c.frames) * Math.pow((W * H) / (c.w * c.h), 0.8) : EST_BPPF * W * H * st.frames;
  return mp4 * (exportFmt() === 'webm' ? WEBM_RATIO : 1);
};
const exportPick = () => exportSteps()[+$('#exportSlider').value] || exportSteps().at(-1);
function showExportSize() {
  const p = exportPick();
  $('#exportSizeLbl').textContent = `${p.W}×${p.H} · ~${fmtSize(exportEstimate(p))}`;
  $('#exportSize').title = `Export size: ${Math.round(p.scale * 100)}% of ${st.w}×${st.h}. ` + (exportCalib ? 'The estimate is scaled from this scene\'s last export.' : 'The estimate is rough until this scene has been exported once.');
}
function fillExportSizes() {
  const steps = exportSteps(), sl = $('#exportSlider');
  sl.max = String(steps.length - 1);
  const i = exportKeep ? steps.findIndex((p) => p.side === exportKeep) : -1;
  sl.value = String(i >= 0 ? i : steps.length - 1);
  $('#exportAxis').textContent = exportAxis.toUpperCase();
  showExportSize();
}
const keepExportSize = () => { exportKeep = exportPick().side; try { localStorage.setItem('ms.exportSize', JSON.stringify({ axis: exportAxis, side: exportKeep })); } catch {} };
// a finished export offers its download until you take it or change what you'd export (size, side, format): then the
// button goes back to Export (the file stays in out/)
function resetExportBtn() { clearTimeout(exportTimer); const b = $('#exportBtn'); delete b.dataset.file; b.classList.remove('on'); b.textContent = exportLabel(); }
$('#exportSlider').oninput = () => { showExportSize(); keepExportSize(); resetExportBtn(); };
$('#exportAxis').onclick = () => {   // switch the stepping side, staying as close as possible to the current size
  const W = exportPick().W; exportAxis = exportAxis === 'w' ? 'h' : 'w';
  const steps = exportSteps(), i = steps.reduce((b, p, j) => (Math.abs(p.W - W) < Math.abs(steps[b].W - W) ? j : b), 0);
  exportKeep = steps[i].side; fillExportSizes(); keepExportSize(); resetExportBtn();
};
async function loadExportSizes() {
  try { exportCalib = (await (await fetch(`/api/export?scene=${st.scene}&calib`)).json()).calib; } catch { exportCalib = null; }
  fillExportSizes();
  try { const j = await (await fetch(`/api/export?scene=${st.scene}`)).json(); if (j.state === 'running' || j.state === 'stopping') pollExport(); } catch {}   // pick a running export back up after a reload
}
try { const f = localStorage.getItem('ms.exportFmt'); if (f) $('#exportFmt').value = f; } catch {}
$('#exportBtn').textContent = exportLabel();
$('#exportFmt').onchange = () => {
  try { localStorage.setItem('ms.exportFmt', exportFmt()); } catch {}
  fillExportSizes(); resetExportBtn();
};
let exportTimer = null;
function exportUi(running) {
  $('#exportBtn').disabled = running; $('#exportSlider').disabled = running; $('#exportAxis').disabled = running; $('#exportFmt').disabled = running; $('#exportStop').hidden = !running;
}
async function pollExport() {
  clearTimeout(exportTimer);
  const b = $('#exportBtn');
  const j = await (await fetch(`/api/export?scene=${st.scene}`)).json();
  if (j.state === 'running' || j.state === 'stopping') {
    exportUi(true);
    b.textContent = j.state === 'stopping' ? 'Stopping…' : j.total ? `Exporting ${Math.round((j.done / j.total) * 100)}%` : 'Exporting…';
    exportTimer = setTimeout(pollExport, 700); return;
  }
  exportUi(false);
  if (j.state === 'done') {
    b.textContent = `⤓ Download (${(j.size / 1e6).toFixed(1)} MB)`; b.dataset.file = j.file; b.classList.add('on');
    loadExportSizes();   // the new file sharpens the estimates
    exportTimer = setTimeout(() => { delete b.dataset.file; b.classList.remove('on'); b.textContent = exportLabel(); }, 60000);
  } else if (j.state === 'stopped') b.textContent = exportLabel();
  else if (j.state === 'failed') { b.textContent = 'Export failed — retry'; console.error(j.log); }
}
$('#exportBtn').onclick = async () => {
  const b = $('#exportBtn');
  if (b.dataset.file) { const a = h('a', { href: '/' + b.dataset.file, download: '' }); document.body.append(a); a.click(); a.remove(); resetExportBtn(); return; }   // downloaded: back to Export
  delete b.dataset.file; b.classList.remove('on');
  const p = exportPick();
  await fetch(`/api/export?scene=${st.scene}&scale=${p.scale}&w=${p.W}&h=${p.H}&fmt=${exportFmt()}`, { method: 'POST' });
  pollExport();
};
$('#exportStop').onclick = async () => { $('#exportStop').disabled = true; await fetch(`/api/export?scene=${st.scene}`, { method: 'DELETE' }); $('#exportStop').disabled = false; pollExport(); };
const AGENT_NAMES = { claude: 'Claude', antigravity: 'Antigravity', codex: 'Codex' };
const sendAgent = () => $('#sendAgent')?.value || 'claude';
const agentName = (id) => AGENT_NAMES[id] || 'Claude';   // who a note was sent to (notes from before the picker went to Claude)
const pickedName = () => AGENT_NAMES[sendAgent()];        // who the next Send goes to
const sendLabel = () => `▶ Send to ${pickedName()}`;
try { const a = localStorage.getItem('ms.sendAgent'); if (a && AGENT_NAMES[a]) $('#sendAgent').value = a; } catch {}
$('#sendBtn').textContent = sendLabel();
$('#sendAgent').onchange = () => {
  try { localStorage.setItem('ms.sendAgent', sendAgent()); } catch {}
  $('#sendBtn').textContent = sendLabel();
  renderPanel();
};
// Send to the selected agent. The top button sends every unsent note on the scene; a note's own ↑ / ⌘↵ (and a reply's
// ↑ / Enter) passes `ids` and sends just that note
async function sendNotes(ids) {
  const b = $('#sendBtn'), agent = sendAgent(), who = agentName(agent);
  if (!ids && st.pending?.text?.trim()) await persist(st.pending);
  await queue;
  await fetch('/api/go', json('POST', { scene: st.scene, agent, ...(ids ? { ids } : {}) }));
  b.textContent = `Sent — ${who} is on it`; b.classList.add('on');
  setTimeout(() => { b.textContent = sendLabel(); b.classList.remove('on'); }, 4000);
  loadNotes();   // the sent notes turn to "With <Agent>"
}
// On a reference, a note is a moment to keep: saved at once (frames and measurements captured in the background); the
// note itself goes away and the moment's green bar takes its place
async function saveMoment(n) {
  clearTimeout(saveTimer);
  await queue;
  const r = await fetch(`/api/moments/${st.scene.slice(4)}`, json('POST', { range: n.range, frame: n.frame, region: n.region, text: n.text || '' }));
  if (!r.ok) { alert((await r.json().catch(() => ({}))).error || 'Couldn’t save the moment'); return; }
  const m = await r.json();
  if (n.id) await fetch(`/api/notes/${st.scene}/${n.id}`, { method: 'DELETE' });
  st.notes = st.notes.filter((x) => x !== n); st.pending = null; st.sel = null; st.editing = false; st.selF = m.id;
  document.activeElement?.blur?.();   // out of the text box, so the panel can switch to the moment
  await loadNotes();
}
async function sendNote(n) {
  clearTimeout(saveTimer);
  if (!n.text?.trim()) return;
  delete n._fresh; st.editing = false; st.pick = null;
  document.activeElement?.blur?.();   // out of the text box, so the panel redraws as sent
  await persist(n);
  if (st.isLottie) {
    // Non-blocking Lottie flow: immediately append to To-Check list asynchronously while dispatching lightweight MCP payload
    fetch('/api/lottie/annotate', json('POST', {
      scene: st.scene,
      noteId: n.id,
      agent: sendAgent(),
      frame: n.frame,
      range: n.range,
      region: n.region,
      elements: n.elements || [],
      curve: n.curve || null,
      motion: n.motion || null,
      text: n.text,
    })).catch(() => {});
  }
  await sendNotes([n.id]);   // just this note: drafts elsewhere on the scene stay unsent
}
$('#sendBtn').onclick = () => sendNotes();
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
// the Motion Studio menu (the name, top left): loop, preview the scene on its own, theme library
const brandBtn = $('#brandBtn'), brandMenu = $('#brandMenu');
function setMenu(open) {
  brandMenu.hidden = !open; brandBtn.setAttribute('aria-expanded', String(open));
  if (open) { const r = brandBtn.getBoundingClientRect(); brandMenu.style.left = `${r.left}px`; brandMenu.style.top = `${r.bottom + 4}px`; brandMenu.firstElementChild.focus({ preventScroll: true }); }
}
brandBtn.onclick = (e) => { e.stopPropagation(); setMenu(brandMenu.hidden); };
brandMenu.onclick = (e) => { if (e.target.closest('#loopItem')) setLoop(!st.loop); if (e.target.closest('#referencesLink')) openRefs(); if (e.target.closest('button, a')) setMenu(false); };

// References: a panel over the editor (editor/references.html in a frame). Picking one there opens it here.
function openRefs(src = '/editor/references.html?embed') {
  if (EMBED || $('#refsModal')) return;
  const close = () => {
    const m = $('#refsModal');
    if (!m || m.classList.contains('closing')) return;
    removeEventListener('keydown', onKey, true);
    m.classList.add('closing');
    setTimeout(() => m.remove(), 240);   // after the closing animation (editor.css)
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  const modal = h('div', { id: 'refsModal', onclick: (e) => { if (e.target.id === 'refsModal') close(); } },
    h('div', { class: 'sheet' }, h('iframe', { src, title: 'References' })));
  modal._close = close;
  document.body.append(modal);
  addEventListener('keydown', onKey, true);
  setPlaying(false);
}
addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data?.type) return;
  if (e.data.type === 'ms:close-refs') $('#refsModal')?._close();
});
addEventListener('pointerdown', (e) => { if (!brandMenu.hidden && !e.target.closest('#brandMenu, #brandBtn')) setMenu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !brandMenu.hidden) { e.stopImmediatePropagation(); setMenu(false); brandBtn.focus(); } }, true);
$('#commentBtn').onclick = () => setComment(!st.comment);
addEventListener('copy', (e) => {
  const n = st.notes.find((x) => x.id === st.sel);
  if (!n || e.target.closest?.('input, textarea') || getSelection().toString()) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', noteContext(n));
});

const boundFrameWins = new WeakSet();
function bindFrameKeys(win) {
  try {
    if (!win || boundFrameWins.has(win)) return;
    boundFrameWins.add(win);
    win.addEventListener('keydown', onGlobalKeyDown);
  } catch {}
}
frameEl?.addEventListener('load', () => bindFrameKeys(frameEl.contentWindow));

// Keep focus off non-text controls after pointer clicks / select changes so Space always plays/pauses.
addEventListener('click', (e) => {
  const ctrl = e.target?.closest?.('button, input[type="range"]');
  if (ctrl && e.detail > 0) ctrl.blur();
});
addEventListener('change', (e) => {
  const ctrl = e.target?.closest?.('select, input[type="range"]');
  if (ctrl) ctrl.blur();
});

const isTextTarget = (el) => !!el?.closest?.('textarea, [contenteditable="true"], [contenteditable=""]') ||
  (el?.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit|reset|file|color|image|hidden)$/i.test(el.type || 'text'));

function onGlobalKeyDown(e) {
  if (isTextTarget(e.target)) return;
  const isSpace = e.key === ' ' || e.code === 'Space';
  if (isSpace) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (e.repeat) return;
    const ctrl = e.target?.closest?.('button, select, input[type="range"]');
    if (ctrl) ctrl.blur();
    setPlaying(!st.playing);
    return;
  }
  if (e.target?.closest?.('select')) return;
  const fi = Math.round(st.frame);
  switch (e.key) {
    case 'ArrowRight': if (!st.rec) setPlaying(false); seek(fi + (e.altKey ? 10 : 1)); break;
    case 'ArrowLeft': if (!st.rec) setPlaying(false); seek(fi - (e.altKey ? 10 : 1)); break;
    case 'Home': seek(st.range ? st.range[0] : 0); break;
    case 'End': seek(st.range ? st.range[1] : st.frames - 1); break;
    case 'x': case 'X': setRange(null); break;
    case 'Backspace': case 'Delete': {   // remove the selected note (the text box keeps its own Backspace)
      const n = st.pending || st.notes.find((x) => x.id === st.sel);
      if (n && n.range && n.region && st.areaSel) { e.preventDefault(); removeArea(n); }   // the area is selected: remove only the area
      else if (n) { e.preventDefault(); removeNote(n); }
      break;
    }
    case '=': case '+': st.zoomed = true; zoomBy(1.5); break;
    case '-': case '_': st.zoomed = true; zoomBy(1 / 1.5); break;
    case '0': st.zoomed = false; fitDefault(); layoutTimeline(); break;
    case 'l': case 'L': setLoop(!st.loop); break;
    case 'r': case 'R': if (!e.metaKey && !e.ctrlKey) openRefs(); break;
    case 's': case 'S': case 'c': case 'C': if (!e.metaKey && !e.ctrlKey) setComment(!st.comment); break;
    case 'Escape': if (EMBED && !st.pending && !st.sel && !st.selF && !st.comment && !st.rec) closePanel(); else { dismissNote(); if (st.selF) { st.selF = null; setRange(null); buildTimeline(); renderPanel(); drawOverlay(); } } break;
    default: return;
  }
}
addEventListener('keydown', onGlobalKeyDown);

// ------------------------------------------------------------------ Lottie Studio chrome
function syncLottieChrome() {
  const on = !!st.isLottie;
  $('#exportGroup').hidden = on;
  $('#lottieExportGroup').hidden = !on;
  $('#lottieHealth').hidden = !on;
  $('#bgBtn').hidden = !on;
  $('#fxPreviewBtn').hidden = !(on && (st.S?.filtersCount || 0) > 0);
  $('#cacheBar').style.display = on ? 'none' : 'block';
  if (on) {
    $('#fpsBadge').hidden = true;
    const b = $('#lottieExportBtn');
    if (b && b.dataset.scene !== st.scene) {
      delete b.dataset.file;
      b.dataset.scene = st.scene;
      b.classList.remove('on');
      b.textContent = '⤓ Export .lottie';
      const dl = $('#lottieDownloadJson');
      if (dl) dl.hidden = true;
    }
  }
}

async function loadLottieHealth() {
  if (!st.isLottie || !st.scene) return;
  const pill = $('#lottieHealth');
  try {
    const { health } = await (await fetch(`/api/lottie/health?scene=${encodeURIComponent(st.scene)}`)).json();
    const kb = Math.max(1, Math.round((health.jsonBytes || 0) / 1024));
    const fx = health.filterLayers?.length || 0;
    const status = !health.mobileReady ? 'Mobile issue' : !health.antiBakePass ? 'Dense keyframes' : fx > 0 ? `${fx} FX to bake` : 'iOS/Android OK';
    pill.textContent = `${health.totalKeyframes} kf · ${kb} KB · ${status}`;
    pill.className = `health-pill ${!health.mobileReady ? 'err' : (!health.antiBakePass || fx > 0) ? 'warn' : ''}`;
    pill.title = (health.issues || []).map((i) => `[${i.severity}] ${i.message}`).join('\n') || 'Minimal keyframes & mobile ready';
    pill.hidden = false;
  } catch {
    pill.hidden = true;
  }
}

const BACKDROPS = ['checker', 'dark', 'light'];
$('#bgBtn').onclick = () => {
  if (!st.S?.setBackdrop) return;
  st.backdrop = BACKDROPS[(BACKDROPS.indexOf(st.backdrop) + 1) % BACKDROPS.length];
  st.S.setBackdrop(st.backdrop);
  $('#bgBtn').title = `Canvas backdrop: ${st.backdrop} (click to cycle)`;
};

$('#fxPreviewBtn').onclick = async () => {
  if (!st.S?.setPreviewMode) return;
  const btn = $('#fxPreviewBtn');
  const next = st.previewMode === 'live' ? 'baked' : 'live';
  btn.disabled = true;
  try {
    await st.S.setPreviewMode(next);
    st.previewMode = next;
    btn.classList.toggle('on', next === 'baked');
    btn.innerHTML = next === 'baked' ? '<span>▣</span>Baked' : '<span>◎</span>FX';
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
};

$('#lottieExportBtn').onclick = async () => {
  const btn = $('#lottieExportBtn'), jsonLink = $('#lottieDownloadJson');
  if (btn.dataset.file) {
    const a = h('a', { href: btn.dataset.file, download: '' }); document.body.append(a); a.click(); a.remove();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Baking FX & packaging…';
  try {
    const scale = $('#lottieScale').value || '2';
    const rasterFmt = $('#lottieRasterFmt').value || 'png';
    const res = await fetch(`/api/lottie/export?scene=${encodeURIComponent(st.scene)}&scale=${scale}&rasterFmt=${rasterFmt}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lottie export failed');
    const kb = Math.max(1, Math.round((data.dotLottieBytes || 0) / 1024));
    btn.textContent = `⤓ .lottie (${kb} KB)`;
    btn.dataset.file = data.dotLottieUrl;
    btn.dataset.scene = st.scene;
    btn.classList.add('on');
    jsonLink.href = data.jsonUrl;
    jsonLink.download = `${st.scene}.json`;
    jsonLink.hidden = false;
    const a = h('a', { href: data.dotLottieUrl, download: `${st.scene}.lottie` });
    document.body.append(a); a.click(); a.remove();
    loadLottieHealth();
  } catch (err) {
    btn.textContent = 'Export failed — retry';
    console.error(err);
  } finally {
    btn.disabled = false;
  }
};
$('#lottieScale').onchange = $('#lottieRasterFmt').onchange = () => {
  const btn = $('#lottieExportBtn');
  delete btn.dataset.file; btn.classList.remove('on'); btn.textContent = '⤓ Export .lottie';
  $('#lottieDownloadJson').hidden = true;
};

init();
