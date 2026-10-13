// Zero-dependency dev server: static files, /vendor (node_modules), notes API,
// live-reload events, and a screenshot crop for every note (via Playwright + Chrome).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.map': 'application/json',
};

const inside = (base, p) => { const r = path.resolve(base, '.' + p); return r.startsWith(base + path.sep) || r === base ? r : null; };
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2));
};
const readBody = (req) => new Promise((ok, bad) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { bad(e); } }); });
const safeId = (s) => /^[\w.-]+$/.test(s || '') ? s : null;

async function listScenes() {
  const dir = path.join(ROOT, 'scenes');
  const out = [];
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const html = path.join(dir, d.name, 'index.html');
    if (!fs.existsSync(html)) continue;
    const raw = (await fsp.readFile(html, 'utf8')).match(/<title>([^<]*)<\/title>/)?.[1] || d.name;
    const title = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    out.push({ id: d.name, title });
  }
  return out;
}

async function readJSON(file, fallback) { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; } }
async function writeJSON(file, data) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, JSON.stringify(data, null, 2) + '\n'); }

// ---- note screenshots (lazy shared browser) ----
let browserP = null;
async function shot(base, note) {
  try {
    browserP ||= (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({ channel: 'chrome' });
    })();
    const browser = await browserP;
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${base}/scenes/${note.scene}/?render`);
    await page.waitForFunction(() => window.animationReady === true, null, { timeout: 15000 });
    const { width, height } = await page.evaluate(() => ({ width: window.__studio.width, height: window.__studio.height }));
    await page.setViewportSize({ width, height });
    await page.evaluate((f) => window.seek(f), note.frame);
    const pad = 80, r = note.region;
    const clip = r ? {
      x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad),
      width: Math.min(width, r.x + r.w + pad) - Math.max(0, r.x - pad), height: Math.min(height, r.y + r.h + pad) - Math.max(0, r.y - pad),
    } : undefined;
    await page.screenshot({ path: path.join(ROOT, 'notes', note.scene, `${note.id}.png`), clip });
    await page.close();
  } catch (e) { console.warn('[notes] screenshot failed:', e.message); }
}

const exports_ = {};

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
      if (p === '/api/scenes') return send(res, 200, await listScenes());

      let m;
      if (p === '/api/notes' && req.method === 'GET') {
        const scene = safeId(url.searchParams.get('scene'));
        const dir = path.join(ROOT, 'notes', scene || '_');
        const files = fs.existsSync(dir) ? (await fsp.readdir(dir)).filter((f) => f.endsWith('.json') && !f.startsWith('_')) : [];
        const notes = await Promise.all(files.map((f) => readJSON(path.join(dir, f), null)));
        return send(res, 200, notes.filter(Boolean).sort((a, b) => a.created.localeCompare(b.created)));
      }
      // "Send to Claude": drops a flag that a waiting Claude session picks up (tools/wait-for-notes.mjs)
      if (p === '/api/go' && req.method === 'POST') {
        const { scene } = await readBody(req);
        if (!safeId(scene)) return send(res, 400, { error: 'scene required' });
        await writeJSON(path.join(ROOT, 'notes', '_go.json'), { scene, at: new Date().toISOString() });
        return send(res, 200, { ok: true });
      }
      if (p === '/api/go' && req.method === 'GET') return send(res, 200, { pending: fs.existsSync(path.join(ROOT, 'notes', '_go.json')) });

      // Export: runs the renderer (motion blur, H.264, CRF 18) and reports progress
      if (p === '/api/export') {
        const scene = safeId(url.searchParams.get('scene'));
        if (!scene) return send(res, 400, { error: 'scene required' });
        const job = exports_[scene];
        if (req.method === 'POST' && !(job && job.state === 'running')) {
          const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
          const file = `out/${scene}-${stamp}.mp4`;
          const j = exports_[scene] = { state: 'running', done: 0, total: 0, file, started: Date.now() };
          const child = spawn(process.execPath, ['render/render.mjs', scene, '--blur', '6', '--crf', '18', '--out', file], { cwd: ROOT });
          const onData = (d) => { const m = String(d).match(/(\d+)\/(\d+)(?!.*\d+\/\d+)/s); if (m) { j.done = +m[1]; j.total = +m[2]; } };
          child.stdout.on('data', onData); child.stderr.on('data', (d) => { j.log = String(d).slice(-400); });
          child.on('close', (code) => {
            j.state = code === 0 ? 'done' : 'failed';
            if (code === 0) { try { j.size = fs.statSync(path.join(ROOT, file)).size; } catch {} }
          });
        }
        return send(res, 200, exports_[scene] || { state: 'idle' });
      }

      // "To check" list: what Claude changed for notes it has worked (and deleted)
      if (p === '/api/checklist') {
        const scene = safeId(url.searchParams.get('scene'));
        if (!scene) return send(res, 400, { error: 'scene required' });
        const file = path.join(ROOT, 'notes', scene, '_checklist.json');
        const list = await readJSON(file, { items: [] });
        if (req.method === 'DELETE') {
          list.items = list.items.filter((i) => i.id !== url.searchParams.get('id'));
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
        await writeJSON(path.join(ROOT, 'notes', note.scene, `${note.id}.json`), note);
        shot(base, note);   // async; the crop appears beside the note
        return send(res, 200, note);
      }
      if ((m = p.match(/^\/api\/notes\/([\w.-]+)\/([\w.-]+)$/)) && req.method === 'DELETE') {
        for (const ext of ['.json', '.png']) await fsp.rm(path.join(ROOT, 'notes', m[1], m[2] + ext), { force: true });
        return send(res, 200, { ok: true });
      }
      if ((m = p.match(/^\/api\/notes\/([\w.-]+)\/([\w.-]+)$/)) && req.method === 'PATCH') {
        const file = path.join(ROOT, 'notes', m[1], `${m[2]}.json`);
        const note = await readJSON(file, null);
        if (!note) return send(res, 404, { error: 'no such note' });
        Object.assign(note, await readBody(req));
        await writeJSON(file, note);
        return send(res, 200, note);
      }

      // ---------- static ----------
      if (p === '/') { res.writeHead(302, { Location: '/editor/' }); return res.end(); }
      let file = p.startsWith('/vendor/') ? inside(path.join(ROOT, 'node_modules'), p.slice(7)) : inside(ROOT, p);
      if (!file) return send(res, 403, 'forbidden', 'text/plain');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  });

  if (watch) {
    let timer = null, changed = new Set();
    for (const dir of ['scenes', 'runtime', 'tokens', 'editor', 'notes']) {
      const abs = path.join(ROOT, dir);
      fs.mkdirSync(abs, { recursive: true });
      fs.watch(abs, { recursive: true }, (_, f) => {
        if (!f || /(^|\/)\.|~$/.test(f)) return;
        changed.add(`${dir}/${f}`);
        clearTimeout(timer);
        timer = setTimeout(() => { broadcast({ type: 'change', paths: [...changed] }); changed = new Set(); }, 60);
      });
    }
  }

  return new Promise((ok) => server.listen(port, () => {
    if (!quiet) console.log(`Motion Studio → http://localhost:${server.address().port}/editor/`);
    ok(server);
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) startServer({ port: +(process.env.PORT || 5173) });
