// Zero-dependency dev server: static files, /vendor (node_modules), notes API,
// live-reload events, and a screenshot crop for every note (via Playwright + Chrome).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, PROJECT } from './project.mjs';
import { listRefs, listRefScenes, scenePage, addLink, addFile, deleteRef, safeRefId, hasYtDlp, PREFIX, listMoments, allMoments, addMoment, updateMoment, deleteMoment } from './refs.mjs';
import { listMedia, addMedia, deleteMedia } from './media.mjs';
import { dropDoneNotes, scenesWithNotes } from './done.mjs';

import { CHROME } from './chrome.mjs';   // the capture browser and its settings (see chrome.mjs)
import { startupWarning } from './doctor.mjs';
export { CHROME };
export { ROOT, PROJECT };   // the studio (tool) and the project (its scenes/, notes/, out/): see project.mjs
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.md': 'text/plain; charset=utf-8', '.map': 'application/json', '.lottie': 'application/zip',
};

const inside = (base, p) => { const r = path.resolve(base, '.' + p); return r.startsWith(base + path.sep) || r === base ? r : null; };
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2));
};
const readBody = (req) => new Promise((ok, bad) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { bad(e); } }); });
const safeId = (s) => /^[\w.-]+$/.test(s || '') ? s : null;

async function listScenes() {
  const dir = path.join(PROJECT, 'scenes');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const html = path.join(dir, d.name, 'index.html');
    if (!fs.existsSync(html)) continue;
    const raw = (await fsp.readFile(html, 'utf8')).match(/<title>([^<]*)<\/title>/)?.[1] || d.name;
    const title = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const isLottie = fs.existsSync(path.join(dir, d.name, 'comp.json'));
    out.push({ id: d.name, title, kind: isLottie ? 'lottie' : 'video' });
  }
  return out;
}

let compilerModP = null;
async function getCompiler() {
  if (!compilerModP) {
    const entry = path.join(ROOT, 'dist', 'compiler', 'index.js');
    compilerModP = import(pathToFileURL(entry).href).catch((err) => {
      compilerModP = null;
      throw new Error(`Lottie compiler not built (${err.message}). Run "npm run build".`);
    });
  }
  return compilerModP;
}

const isLottieScene = (scene) => Boolean(scene && fs.existsSync(path.join(PROJECT, 'scenes', scene, 'comp.json')));

async function readJSON(file, fallback) { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; } }
async function writeJSON(file, data) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, JSON.stringify(data, null, 2) + '\n'); }

// ---- note screenshots (lazy shared browser) ----
let browserP = null;
async function shot(base, note) {
  try {
    browserP ||= (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch(CHROME);
    })();
    const browser = await browserP;
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${base}/scenes/${note.scene}/?render`);
    await page.waitForFunction(() => window.animationReady === true, null, { timeout: 15000 });
    const { width, height } = await page.evaluate(() => ({ width: window.__studio.width, height: window.__studio.height }));
    await page.setViewportSize({ width, height });
    await page.evaluate(async (f) => { window.seek(f); await window.__settle?.(); }, note.frame);
    const pad = 80, r = note.region;
    const clip = r ? {
      x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad),
      width: Math.min(width, r.x + r.w + pad) - Math.max(0, r.x - pad), height: Math.min(height, r.y + r.h + pad) - Math.max(0, r.y - pad),
    } : undefined;
    await page.screenshot({ path: path.join(PROJECT, 'notes', note.scene, `${note.id}.png`), clip });
    await page.close();
  } catch (e) { console.warn('[notes] screenshot failed:', e.message); }
}

// ---- rendered frames: the editor shows these (playing, scrubbing, stepping) instead of the live scene, so a frame
// is never half-drawn. Warm pages render them exactly like export (seek → paint → screenshot) and write JPEGs to
// out/.preview. Hard limits, whatever the film's length:
//   · only frames within PREVIEW.windowSec of the playhead are kept; ones that fall outside are deleted
//   · all scenes together use at most PREVIEW.diskMB on disk (oldest deleted first); frames never sit in memory
//   · the render pages close after PREVIEW.idleMin minutes without use
export const PREVIEW = { pages: 3, windowSec: 20, diskMB: 300, idleMin: 5 };
const PREVIEW_DIR = path.join(PROJECT, 'out', '.preview');
let sceneVersion = 0;   // bumped by the file watcher; stale frames are dropped on the next request
const previews = {};    // `${scene}@${scale}` → { ver, scale, dir, pages, ready, queue, have: Map(f → bytes), inflight, focus, last, fps, frames }
const disk = new Map(); // file → { bytes, t } across all scenes, for the disk cap
let diskBytes = 0;
const forget = (file) => { const e = disk.get(file); if (e) { diskBytes -= e.bytes; disk.delete(file); } fs.rm(file, { force: true }, () => {}); };

function startPages(p, base, scene) {
  browserP ||= (async () => {
    const b = await (await import('playwright')).chromium.launch(CHROME);
    b.on('disconnected', () => { browserP = null; for (const q of Object.values(previews)) { q.ready = null; q.pages = []; } });   // relaunched on next use
    return b;
  })();
  p.pages = [];
  const opened = [];   // every page this attempt opens, so a failed start can close them all
  p.ready = Promise.all(Array.from({ length: PREVIEW.pages }, async () => {   // set before any await, so concurrent requests share it
    const page = await (await browserP).newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: p.scale });
    opened.push(page);
    await page.goto(`${base}/scenes/${scene}/?render`);
    await page.waitForFunction(() => window.animationReady === true, null, { timeout: 30000 });
    const m = await page.evaluate(() => ({ width: window.__studio.width, height: window.__studio.height, fps: window.__studio.fps, frames: window.__studio.frames }));
    await page.setViewportSize({ width: m.width, height: m.height });
    Object.assign(p, { fps: m.fps, frames: m.frames });
    p.pages.push({ page, busy: false });
  })).then(() => pumpPreview(p));
  // a failed start (usually a scene that doesn't load) closes the pages it opened and keeps the browser: dropping the
  // browser here used to leave it running, so each failure leaked a whole Chrome
  p.ready.catch((e) => { console.warn('[preview] render pages failed to start:', e.message); p.ready = null; p.pages = []; opened.forEach((pg) => pg.close().catch(() => {})); });   // retried on the next request
}
async function previewPool(base, scene, scale, focus) {
  const key = `${scene}@${scale}`;   // one pool per view size, so two editors at different sizes don't undo each other
  let p = previews[key];
  if (p && p.ver !== sceneVersion) { dropPool(p); p = null; }
  if (!p) {
    p = previews[key] = { ver: sceneVersion, scale, dir: path.join(PREVIEW_DIR, scene, `${sceneVersion}-${scale}`), queue: [], have: new Map(), inflight: new Map(), focus: 0 };
    fs.mkdirSync(p.dir, { recursive: true });
  }
  p.last = Date.now();
  if (Number.isFinite(focus)) p.focus = Math.round(focus);   // before the pages start, so the first frames rendered are around the playhead
  if (!p.ready) startPages(p, base, scene);   // first use, or reopened after idling
  await p.ready;
  return p;
}
function dropPool(p) {
  p.closed = true;
  p.queue.splice(0).forEach((j) => j.bad(new Error('scene changed')));
  p.ready?.then(() => p.pages.forEach((x) => x.page.close().catch(() => {})), () => {});
  for (const f of p.have.keys()) forget(path.join(p.dir, `${f}.jpg`));
  fs.rm(p.dir, { recursive: true, force: true }, () => {});
}
const windowF = (p) => Math.round(PREVIEW.windowSec * (p.fps || 25));
const inWindow = (p, f) => Math.abs(f - p.focus) <= windowF(p);
function previewFrame(p, f) {
  const file = path.join(p.dir, `${f}.jpg`);
  if (p.have.has(f)) { disk.get(file).t = Date.now(); return Promise.resolve(file); }
  if (p.inflight.has(f)) return p.inflight.get(f);
  const job = new Promise((ok, bad) => p.queue.push({ f, ok, bad }));
  p.inflight.set(f, job);
  pumpPreview(p);
  return job;
}
// the next frame to render: a requested one nearest the playhead, else (idle) the nearest frame in the window not yet
// rendered — so the window around the playhead fills in by itself, ahead of the playhead first
function nextJob(p) {
  p.queue = p.queue.filter((j) => inWindow(p, j.f) || (j.bad(new Error('outside the window')), p.inflight.delete(j.f), false));
  if (p.queue.length) { p.queue.sort((a, b) => Math.abs(a.f - p.focus) - Math.abs(b.f - p.focus)); return p.queue.shift(); }
  const W = windowF(p), last = (p.frames || 1) - 1;
  for (let d = 0; d <= W; d++) for (const f of [p.focus + d, p.focus - d - 1]) {
    if (f < 0 || f > last || p.have.has(f) || p.inflight.has(f)) continue;
    const j = { f, ok: () => {}, bad: () => {} };
    p.inflight.set(f, new Promise((ok, bad) => Object.assign(j, { ok, bad })).catch(() => {}));
    return j;
  }
  return null;
}
function pumpPreview(p) {
  for (const w of p.pages) {
    if (w.busy || p.closed) continue;
    const j = nextJob(p);
    if (!j) return;
    w.busy = true;
    const file = path.join(p.dir, `${j.f}.jpg`);
    (async () => {
      await w.page.evaluate(async (f) => { window.seek(f); await window.__settle?.(); }, j.f);
      await w.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const buf = await w.page.screenshot({ type: 'jpeg', quality: 85 });   // a screenshot always waits for the frame to be fully drawn
      if (p.closed) throw new Error('scene changed');
      await fsp.mkdir(p.dir, { recursive: true });   // in case the folder was removed from outside
      await fsp.writeFile(file, buf);
      return buf.length;
    })().then((bytes) => {
      p.have.set(j.f, bytes); disk.set(file, { bytes, t: Date.now() }); diskBytes += bytes;
      j.ok(file); trimPreview(p);
    }, j.bad).finally(() => { p.inflight.delete(j.f); w.busy = false; pumpPreview(p); });
  }
}
function trimPreview(p) {
  for (const f of p.have.keys()) if (!inWindow(p, f)) { p.have.delete(f); forget(path.join(p.dir, `${f}.jpg`)); }
  const cap = PREVIEW.diskMB * 1024 * 1024;
  if (diskBytes <= cap) return;
  for (const [file] of [...disk].sort((a, b) => a[1].t - b[1].t)) {   // oldest first, across all scenes
    if (diskBytes <= cap) break;
    for (const q of Object.values(previews)) { const f = +path.basename(file, '.jpg'); if (file.startsWith(q.dir + path.sep)) q.have.delete(f); }
    forget(file);
  }
}
setInterval(() => {   // idle render pages close; their frames stay on disk for when they're needed again
  for (const [k, p] of Object.entries(previews)) if (p.ver !== sceneVersion && Date.now() - p.last > 10000) { dropPool(p); delete previews[k]; }   // stale and unused
  for (const p of Object.values(previews)) if (p.ready && Date.now() - p.last > PREVIEW.idleMin * 60000) {
    const pages = p.pages; p.ready.then(() => pages.forEach((x) => x.page.close().catch(() => {})), () => {}); p.ready = null; p.pages = [];
  }
}, 60000).unref();

// themes/<id>/THEME.md and techniques/<id>/TECHNIQUE.md (+ preview.mp4, poster.png, aspects.png; a technique's live
// demo/): the galleries at /themes/ and /techniques/ list them
function listShelf(shelf, docFile) {
  const dir = path.join(ROOT, shelf);
  let ids = [];
  try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, docFile))).map((d) => d.name); } catch { return []; }
  return ids.map((id) => {
    const md = fs.readFileSync(path.join(dir, id, docFile), 'utf8');
    const title = (md.match(/^#\s+(.+)$/m) || [, id])[1].trim();
    const summary = (md.replace(/^#.*$/m, '').trim().split(/\n\s*\n/)[0] || '').replace(/[*`_]/g, '').replace(/\s+/g, ' ').trim();
    const has = (f) => fs.existsSync(path.join(dir, id, f)) ? `/${shelf}/${id}/${f}` : null;
    const kit = md.match(/runtime\/kits\/[\w-]+\.js/)?.[0];   // the reusable code a technique names
    return { id, title, summary, preview: has('preview.mp4'), poster: has('poster.png'), aspects: has('aspects.png'), demo: has('demo/index.html')?.replace(/index\.html$/, '') ?? null,
      kit: kit && fs.existsSync(path.join(ROOT, kit)) ? `/${kit}` : null, doc: `/${shelf}/${id}/${docFile}`, updated: fs.statSync(path.join(dir, id, docFile)).mtimeMs };
  }).sort((a, b) => b.updated - a.updated);
}
const listThemes = () => listShelf('themes', 'THEME.md'), listTechniques = () => listShelf('techniques', 'TECHNIQUE.md');

const exports_ = {}, exportProcs = {};
// size calibration for export estimates: the scene's latest finished export (bytes, dimensions, frame count via ffprobe)
const calibCache = {};
function exportCalib(scene) {
  const dir = path.join(PROJECT, 'out');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => new RegExp(`^${scene}-\\d+(-(\\d+pct|\\d+x\\d+))?\\.(mp4|webm)$`).test(f)); } catch { return null; }
  const latest = files.map((f) => ({ f, st: fs.statSync(path.join(dir, f)) })).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)[0];
  if (!latest) return null;
  const key = `${latest.f}:${latest.st.mtimeMs}`;
  if (calibCache[scene]?.key === key) return calibCache[scene].v;
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames,duration', '-of', 'json', path.join(dir, latest.f)], { encoding: 'utf8' });
  let v = null;
  try { const st = JSON.parse(r.stdout).streams[0]; v = { bytes: latest.st.size, w: +st.width, h: +st.height, frames: +st.nb_frames || Math.round(+st.duration * 25), fmt: latest.f.endsWith('.webm') ? 'webm' : 'mp4' }; } catch {}
  calibCache[scene] = { key, v };
  return v;
}

export function startServer({ port = 5173, watch = true, quiet = false } = {}) {
  const clients = new Set();
  const broadcast = (msg) => { for (const c of clients) c.write(`data: ${JSON.stringify(msg)}\n\n`); };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = decodeURIComponent(url.pathname);
      const base = `http://localhost:${server.address().port}`;

      // ---------- API ----------
      if (p === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 1000\n\n'); clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      if (p === '/api/scenes') return send(res, 200, [...await listScenes(), ...await listRefScenes()]);   // films, then references
      // one fully rendered frame (JPEG). scale: device pixels per stage pixel (the editor's view size); focus: the playhead
      if (p === '/api/frame' || p === '/api/cached') {
        const scene = safeId(url.searchParams.get('scene'));
        if (!scene) return send(res, 400, { error: 'scene required' });
        const scale = Math.min(1, Math.max(0.25, Math.round((+url.searchParams.get('scale') || 1) * 4) / 4));
        const focus = url.searchParams.has('focus') ? +url.searchParams.get('focus') : NaN;
        const pool = await previewPool(base, scene, scale, focus);
        if (Number.isFinite(focus)) { trimPreview(pool); pumpPreview(pool); }
        if (p === '/api/cached') return send(res, 200, { frames: [...pool.have.keys()], window: windowF(pool), total: pool.frames });   // for the cache bar
        const f = Math.round(+url.searchParams.get('f'));
        if (!Number.isFinite(f)) return send(res, 400, { error: 'f required' });
        let jpg;
        try { jpg = await fsp.readFile(await previewFrame(pool, f)); }
        catch (e) {   // a cached file that has gone missing: forget it and render it again
          if (e.code !== 'ENOENT') throw e;
          pool.have.delete(f); forget(path.join(pool.dir, `${f}.jpg`));
          jpg = await fsp.readFile(await previewFrame(pool, f));
        }
        return send(res, 200, jpg, 'image/jpeg');
      }
      if (p === '/api/themes') return send(res, 200, listThemes());
      if (p === '/api/techniques') return send(res, 200, listTechniques());

      let m;
      // References (server/refs.mjs): other people's videos, opened in the editor as scenes `ref.<id>` to note moments on
      if (p === '/api/refs' && req.method === 'GET') return send(res, 200, { refs: await listRefs(), ytdlp: hasYtDlp() });
      if (p === '/api/refs' && req.method === 'POST') {
        try { return send(res, 200, await addLink((await readBody(req)).url?.trim())); } catch (e) { return send(res, 400, { error: e.message }); }
      }
      if (p === '/api/refs/upload' && req.method === 'POST') {
        try { return send(res, 200, await addFile(req, url.searchParams.get('name'))); } catch (e) { return send(res, 400, { error: e.message }); }
      }
      if ((m = p.match(/^\/api\/refs\/([\w-]+)$/)) && req.method === 'DELETE') {
        const id = safeRefId(m[1]);
        if (!id) return send(res, 404, { error: 'no such reference' });
        await deleteRef(id);
        await fsp.rm(path.join(PROJECT, 'notes', PREFIX + id), { recursive: true, force: true });   // its notes go with it
        return send(res, 200, { ok: true });
      }
      // moments marked on a reference (?ref=<id>), or every one in the project (a film note's "+ reference")
      if (p === '/api/moments' && req.method === 'GET') {
        const id = url.searchParams.get('ref');
        return send(res, 200, id ? (safeRefId(id) ? await listMoments(id) : []) : await allMoments());
      }
      if ((m = p.match(/^\/api\/moments\/([\w-]+)$/)) && req.method === 'POST') {   // mark one: saved now, measured in the background
        if (!safeRefId(m[1])) return send(res, 404, { error: 'no such reference' });
        try { return send(res, 200, await addMoment(m[1], await readBody(req))); } catch (e) { return send(res, 400, { error: e.message }); }
      }
      if ((m = p.match(/^\/api\/moments\/([\w-]+)\/([\w.-]+)$/)) && safeRefId(m[1])) {
        if (req.method === 'PATCH') return send(res, 200, await updateMoment(m[1], m[2], await readBody(req)));
        if (req.method === 'DELETE') { await deleteMoment(m[1], m[2]); return send(res, 200, { ok: true }); }
      }
      // the media library: files to use in films or point at in notes
      if (p === '/api/media' && req.method === 'GET') return send(res, 200, await listMedia());
      if (p === '/api/media/upload' && req.method === 'POST') {
        try { return send(res, 200, await addMedia(req, url.searchParams.get('name'))); } catch (e) { return send(res, 400, { error: e.message }); }
      }
      if ((m = p.match(/^\/api\/media\/([^/]+)$/)) && req.method === 'DELETE') { await deleteMedia(m[1]); return send(res, 200, { ok: true }); }
      if ((m = p.match(/^\/scenes\/ref\.([\w-]+)\/(index\.html)?$/))) {   // a reference's scene page
        const html = safeRefId(m[1]) && await scenePage(m[1]);
        return html ? send(res, 200, html, 'text/html; charset=utf-8') : send(res, 404, 'not ready', 'text/plain');
      }

      if (p === '/api/notes' && req.method === 'GET') {
        const scene = safeId(url.searchParams.get('scene'));
        const dir = path.join(PROJECT, 'notes', scene || '_');
        const files = fs.existsSync(dir) ? (await fsp.readdir(dir)).filter((f) => f.endsWith('.json') && !f.startsWith('_')) : [];
        const notes = await Promise.all(files.map((f) => readJSON(path.join(dir, f), null)));
        return send(res, 200, notes.filter(Boolean).sort((a, b) => a.created.localeCompare(b.created)));
      }
      // "Send to <Agent>": drops a flag that a waiting agent session picks up (tools/wait-for-notes.mjs)
      if (p === '/api/go' && req.method === 'POST') {
        const { scene, agent, ids } = await readBody(req);
        const only = Array.isArray(ids) && ids.length ? new Set(ids) : null;   // a note's own ↑ sends just that note; the top button, all
        if (!safeId(scene)) return send(res, 400, { error: 'scene required' });
        const target = ['claude', 'antigravity', 'codex'].includes(agent) ? agent : 'claude';
        // every open note on the scene is now with the chosen agent until it finishes them (deletes them, or replies).
        // A note already with another agent stays with it: two agents never work the same note.
        const at = new Date().toISOString(), ndir = path.join(PROJECT, 'notes', scene);
        for (const f of fs.existsSync(ndir) ? await fsp.readdir(ndir) : []) {
          if (!f.endsWith('.json') || f.startsWith('_')) continue;
          const note = await readJSON(path.join(ndir, f), null);
          if (!note || note.reply) continue;
          if (only && !only.has(note.id)) continue;
          if (note.sentAt && (note.sentTo || 'claude') !== target) continue;
          await writeJSON(path.join(ndir, f), { ...note, sentAt: at, sentTo: target });
        }
        const flagName = target === 'claude' ? '_go.json' : `_go.${target}.json`;
        await writeJSON(path.join(PROJECT, 'notes', flagName), { scene, agent: target, at });
        return send(res, 200, { ok: true, agent: target });
      }
      if (p === '/api/go' && req.method === 'GET') {
        const ndir = path.join(PROJECT, 'notes');
        const pending = fs.existsSync(ndir) && (await fsp.readdir(ndir)).some((f) => /^_go(\.[a-z]+)?\.json$/.test(f));
        return send(res, 200, { pending });
      }
      // the editor's scrub log (diagnostics): one JSON line per ruler drag, in out/.diag/scrub.log
      if (p === '/api/diag' && req.method === 'POST') {
        const d = await readBody(req);
        await fsp.mkdir(path.join(PROJECT, 'out', '.diag'), { recursive: true });
        await fsp.appendFile(path.join(PROJECT, 'out', '.diag', 'scrub.log'), JSON.stringify(d) + '\n');
        return send(res, 200, { ok: true });
      }

      // Export: runs the renderer (motion blur, H.264, CRF 18) and reports progress
      if (p === '/api/export') {
        const scene = safeId(url.searchParams.get('scene'));
        if (!scene) return send(res, 400, { error: 'scene required' });
        const job = exports_[scene];
        if (req.method === 'POST' && !(job && job.state === 'running')) {
          const scale = Math.min(1, Math.max(0.1, +url.searchParams.get('scale') || 1));   // 1 = full size, 0.5 = half, …
          const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
          const ext = url.searchParams.get('fmt') === 'webm' ? 'webm' : 'mp4';   // WebM: VP9, ~25% smaller, for the web
          const even = (v) => Math.max(2, Math.round(v / 2) * 2), w = even(+url.searchParams.get('w') || 0), h = even(+url.searchParams.get('h') || 0);   // the exact size picked (even sides)
          const size = url.searchParams.get('w') && url.searchParams.get('h') ? `${w}x${h}` : '';
          const file = `out/${scene}-${stamp}${scale < 1 ? `-${size || `${Math.round(scale * 100)}pct`}` : ''}.${ext}`;
          const j = exports_[scene] = { state: 'running', done: 0, total: 0, file, scale, started: Date.now() };
          // its own process group, so Stop can end the renderer together with its browsers and ffmpeg
          const child = spawn(process.execPath, ['render/render.mjs', scene, '--blur', '6', '--crf', '18', '--scale', String(scale), ...(size && scale < 1 ? ['--size', size] : []), '--out', path.join(PROJECT, file)], { cwd: ROOT, detached: true, env: { ...process.env, MOTION_PROJECT: PROJECT } });
          exportProcs[scene] = child;
          const onData = (d) => { const m = String(d).match(/(\d+)\/(\d+)(?!.*\d+\/\d+)/s); if (m) { j.done = +m[1]; j.total = +m[2]; } };
          child.stdout.on('data', onData); child.stderr.on('data', (d) => { j.log = String(d).slice(-400); });
          child.on('close', (code) => {
            delete exportProcs[scene];
            if (j.state === 'stopping') { j.state = 'stopped'; fs.rmSync(path.join(PROJECT, file), { force: true }); return; }
            j.state = code === 0 ? 'done' : 'failed';
            if (code === 0) { try { j.size = fs.statSync(path.join(PROJECT, file)).size; } catch {} }
          });
        }
        if (req.method === 'DELETE' && job && job.state === 'running') {   // Stop: end the whole export process group
          job.state = 'stopping';
          const child = exportProcs[scene];
          try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
        }
        if (req.method === 'GET' && url.searchParams.has('calib')) return send(res, 200, { calib: exportCalib(scene) });
        return send(res, 200, exports_[scene] || { state: 'idle' });
      }

      // "To check" list: what Claude changed for notes it has worked (and deleted)
      if (p === '/api/checklist') {
        const scene = safeId(url.searchParams.get('scene'));
        if (!scene) return send(res, 400, { error: 'scene required' });
        const file = path.join(PROJECT, 'notes', scene, '_checklist.json');
        const list = await readJSON(file, { items: [] });
        if (req.method === 'DELETE') {
          const id = url.searchParams.get('id');
          list.items = id === '*' ? [] : list.items.filter((i) => i.id !== id);   // '*' = "check all"
          await writeJSON(file, list);
        }
        return send(res, 200, list);
      }
      if (p === '/api/notes' && req.method === 'POST') {
        const n = await readBody(req);
        if (!safeId(n.scene)) return send(res, 400, { error: 'scene required' });
        const created = new Date().toISOString();
        const slug = (n.text || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32).replace(/^-|-$/g, '');
        const note = { id: `${created.replace(/[:.]/g, '-').slice(0, 19)}-${slug}`, created, ...n, reply: null };
        await writeJSON(path.join(PROJECT, 'notes', note.scene, `${note.id}.json`), note);
        if (!isLottieScene(note.scene)) shot(base, note);   // async; Lottie scenes already carry SVG DOM layer hits
        return send(res, 200, note);
      }

      // ---------- Lottie Studio APIs (health, baked preview, .lottie export, curve distillation) ----------
      if (p === '/api/lottie/health' && req.method === 'GET') {
        const scene = safeId(url.searchParams.get('scene'));
        if (!scene || !isLottieScene(scene)) return send(res, 404, { error: 'not a Lottie composition' });
        const { CompositionManager, inspectLottieHealth } = await getCompiler();
        const mgr = new CompositionManager(PROJECT, ROOT);
        const [spec, doc] = await Promise.all([mgr.readSpec(scene), mgr.readAnimation(scene)]);
        const filterIds = spec.assets.flatMap((a) => a.filters.map((f) => f.layerId));
        return send(res, 200, {
          scene,
          health: inspectLottieHealth(doc, filterIds),
          layers: doc.layers.map((l) => ({ id: l.ln || l.nm, name: l.nm, ind: l.ind, ty: l.ty })),
        });
      }
      if (p === '/api/lottie/preview-baked' && req.method === 'GET') {
        const scene = safeId(url.searchParams.get('scene'));
        if (!scene || !isLottieScene(scene)) return send(res, 404, { error: 'not a Lottie composition' });
        const scale = Math.min(3, Math.max(1, Math.round(+url.searchParams.get('scale') || 2)));
        const { CompositionManager, bakeFilteredLayers } = await getCompiler();
        const mgr = new CompositionManager(PROJECT, ROOT);
        const compiled = await mgr.compile(scene);
        const cacheDir = path.join(PROJECT, 'out', '.raster-cache');
        const baked = await bakeFilteredLayers(compiled.doc, compiled.filters, compiled.defsXml, { scale, format: 'png', cacheDir });
        return send(res, 200, { doc: baked.doc, bakedCount: baked.baked.length });
      }
      if (p === '/api/lottie/export' && req.method === 'POST') {
        const scene = safeId(url.searchParams.get('scene'));
        if (!scene || !isLottieScene(scene)) return send(res, 404, { error: 'not a Lottie composition' });
        const scale = Math.min(3, Math.max(1, Math.round(+url.searchParams.get('scale') || 2)));
        const format = url.searchParams.get('rasterFmt') === 'webp' ? 'webp' : 'png';
        const { CompositionManager } = await getCompiler();
        const mgr = new CompositionManager(PROJECT, ROOT);
        const resExport = await mgr.exportDotLottie(scene, { scale, format });
        return send(res, 200, {
          ok: true,
          ...resExport,
          jsonUrl: `/out/${path.basename(resExport.jsonPath)}`,
          dotLottieUrl: `/out/${path.basename(resExport.dotLottiePath)}`,
        });
      }
      if (p === '/api/lottie/distill' && req.method === 'POST') {
        const body = await readBody(req);
        const { distillMotionCurve } = await getCompiler();
        const distilled = distillMotionCurve(body.samples || [], {
          fps: body.fps || 60,
          startFrame: body.startFrame || 0,
          maxKeyframes: body.maxKeyframes === 3 ? 3 : 4,
          durationFrames: body.durationFrames,
        });
        return send(res, 200, distilled);
      }
      // Async MCP annotation dispatch: immediately appends a queued card to To-Check List + logs lightweight payload
      if (p === '/api/lottie/annotate' && req.method === 'POST') {
        const body = await readBody(req);
        const scene = safeId(body.scene);
        if (!scene) return send(res, 400, { error: 'scene required' });
        const agent = ['claude', 'antigravity', 'codex'].includes(body.agent) ? body.agent : 'claude';
        const at = new Date().toISOString();
        const region = body.region || null;
        const payload = {
          id: body.noteId || `${at.replace(/[:.]/g, '-').slice(0, 19)}-ann`,
          scene,
          agent,
          at,
          frame: body.frame ?? 0,
          range: body.range ?? null,
          x: region ? Math.round(region.x + region.w / 2) : (body.x ?? null),
          y: region ? Math.round(region.y + region.h / 2) : (body.y ?? null),
          boundingBox: region ? { x: region.x, y: region.y, width: region.w, height: region.h } : null,
          layers: (body.elements || []).map((e) => e.layerId || e.name),
          motion: body.motion || null,
          curve: body.curve || null,
          note: body.text || '',
        };
        const inboxFile = path.join(PROJECT, 'notes', '_inbox.jsonl');
        await fsp.mkdir(path.dirname(inboxFile), { recursive: true });
        await fsp.appendFile(inboxFile, JSON.stringify(payload) + '\n');
        // Note stays in the timeline as an orange processing lane until the agent finishes it (npm run done → green To-Check bar)
        return send(res, 200, { ok: true, payload });
      }
      if ((m = p.match(/^\/api\/notes\/([\w.-]+)\/([\w.-]+)$/)) && req.method === 'DELETE') {
        const note = await readJSON(path.join(PROJECT, 'notes', m[1], `${m[2]}.json`), null);
        for (const r of note?.refs || []) if (safeId(r)) await fsp.rm(path.join(PROJECT, 'notes', m[1], r), { force: true });
        for (const ext of ['.json', '.png']) await fsp.rm(path.join(PROJECT, 'notes', m[1], m[2] + ext), { force: true });
        return send(res, 200, { ok: true });
      }
      if ((m = p.match(/^\/api\/notes\/([\w.-]+)\/([\w.-]+)$/)) && req.method === 'PATCH') {
        const file = path.join(PROJECT, 'notes', m[1], `${m[2]}.json`);
        const note = await readJSON(file, null);
        if (!note) return send(res, 404, { error: 'no such note' });
        const before = JSON.stringify(note.region ?? null);
        Object.assign(note, await readBody(req));
        await writeJSON(file, note);
        if (JSON.stringify(note.region ?? null) !== before && !isLottieScene(m[1])) shot(base, note);   // box moved/resized → re-take the crop
        return send(res, 200, note);
      }

      // ---------- static ----------
      if (p === '/') { res.writeHead(302, { Location: '/editor/' }); return res.end(); }
      // the project's own folders come from the project; everything else (editor, runtime, themes, …) from the studio
      let file = p.startsWith('/vendor/') ? inside(path.join(ROOT, 'node_modules'), p.slice(7))
        : inside(/^\/(scenes|notes|out|references|media)(\/|$)/.test(p) ? PROJECT : ROOT, p);
      if (!file) return send(res, 403, 'forbidden', 'text/plain');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
      const type = MIME[path.extname(file)] || 'application/octet-stream', size = fs.statSync(file).size;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range) {   // byte ranges: a <video> needs them to seek
        const start = range[1] ? +range[1] : Math.max(0, size - +range[2]), end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
        if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  });

  if (watch) {
    for (const scene of scenesWithNotes()) try { dropDoneNotes(scene); } catch {}   // tidy anything left half-finished
    let timer = null, changed = new Set();
    for (const dir of ['scenes', 'runtime', 'tokens', 'editor', 'notes', 'references', 'media']) {
      const abs = path.join(['scenes', 'notes', 'references', 'media'].includes(dir) ? PROJECT : ROOT, dir);
      fs.mkdirSync(abs, { recursive: true });
      fs.watch(abs, { recursive: true }, (_, rawF) => {
        if (!rawF) return;
        const f = String(rawF).replace(/\\/g, '/');
        if (/(^|\/)\.|~$/.test(f)) return;
        if (dir === 'references' && !/(^|\/)(ref|moment)\.json$/.test(f)) return;   // not every frame file being written
        // the To check list changed (an agent finished a note): a note already in it is done, so it goes (server/done.mjs)
        const m = dir === 'notes' && f.match(/^([^/]+)\/_checklist\.json$/);
        if (m) try { dropDoneNotes(m[1]); } catch {}
        changed.add(`${dir}/${f}`);
        if (!['notes', 'editor', 'references', 'media'].includes(dir)) sceneVersion++;   // scene, runtime or tokens changed: playback frames are stale
        clearTimeout(timer);
        timer = setTimeout(() => { broadcast({ type: 'change', paths: [...changed] }); changed = new Set(); }, 60);
      });
    }
  }

  return new Promise((ok) => server.listen(port, () => {
    if (!quiet) console.log(`Motion Studio → http://localhost:${server.address().port}/editor/${PROJECT !== ROOT ? `   (project: ${PROJECT})` : ''}`);
    if (!quiet) { const warn = startupWarning(); if (warn) console.log(warn); }   // anything missing, said up front
    ok(server);
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.rmSync(PREVIEW_DIR, { recursive: true, force: true });   // frames from an earlier run may not match the scene any more (only here: render.mjs imports this file too)
  startServer({ port: +(process.env.PORT || 5173) });
  // Playwright takes over SIGINT/SIGTERM to close its browsers but leaves the process running; make Ctrl+C (and a
  // plain kill) stop the studio, closing the render browser first
  const quit = async () => { try { await (await browserP)?.close(); } catch {} process.exit(0); };
  process.once('SIGINT', quit); process.once('SIGTERM', quit);
}
