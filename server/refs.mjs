// References: someone else's video, kept in the project to borrow how a moment of it moves and looks. A reference
// opens in the editor (inside the References panel) as a scene with id `ref.<id>`. You mark a moment on it (a span,
// optionally a box and a name) and it is saved straight away: cut out and measured here, no AI involved. Claude reads a
// moment's frames and measurements later, when a film note uses it, with that note's request in mind.
// <project>/references/<id>/
//   ref.json        what it is: source (link or file), status, the video's size, frame rate and length
//   source.webm     the whole video (VP9: the render browser can't play H.264), played by the reference's scene page
//   moments/<id>/   one marked moment: moment.json (name, what you wrote, span, box, status), clip.mp4,
//                   frames/f0001.jpg… (every frame, cropped to the box), stills/fNNNN.jpg (full resolution, key frames),
//                   sheet.png, context.png, motion.json (moves, timing, travel, overshoot, a fitted easing and the
//                   nearest token), style.json (the measured colour palette); study.json if Claude kept extra notes
// Statuses: downloading → converting → ready; or failed. A moment: capturing → ready; or failed.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, PROJECT } from './project.mjs';
import { CHROME } from './chrome.mjs';

export const REFS = path.join(PROJECT, 'references');
export const PREFIX = 'ref.';   // a reference's scene id: ref.<id>
const LONG_S = 300;             // longer videos are first fetched small, then only a noted moment at full quality
const HI = 'bv*[height<=1080]/b[height<=1080]/b';
const LO = 'bv*[height<=480]/b[height<=480]/b';

const dirOf = (id) => path.join(REFS, id);
export const readRef = async (id) => { try { return JSON.parse(await fsp.readFile(path.join(dirOf(id), 'ref.json'), 'utf8')); } catch { return null; } };
const writeRef = async (ref) => { await fsp.mkdir(dirOf(ref.id), { recursive: true }); await fsp.writeFile(path.join(dirOf(ref.id), 'ref.json'), JSON.stringify(ref, null, 2) + '\n'); return ref; };
// changes to one reference run one after another, so a late progress update can't undo a status change
const queues = new Map();
const patchRef = (id, change) => {
  const next = (queues.get(id) || Promise.resolve()).then(async () => { const ref = await readRef(id); return ref && writeRef(Object.assign(ref, change)); });
  queues.set(id, next.catch(() => {}));
  return next;
};
export const safeRefId = (s) => /^[a-z0-9][\w-]*$/i.test(s || '') && fs.existsSync(path.join(dirOf(s), 'ref.json')) ? s : null;
export const hasYtDlp = () => spawnSync('yt-dlp', ['--version']).status === 0;
export const jobs = new Map();   // id → the download/convert still running (the CLI waits for it)

// a process, its output as text; onLine sees stdout and stderr line by line (progress)
function run(cmd, args, { cwd, onLine, binary } = {}) {
  return new Promise((ok, bad) => {
    const p = spawn(cmd, args, { cwd });
    const out = [];
    let tail = '';
    p.stdout.on('data', (d) => { out.push(d); if (onLine && !binary) String(d).split(/\r|\n/).forEach((l) => l && onLine(l)); });
    p.stderr.on('data', (d) => { tail = (tail + d).slice(-2000); if (onLine) String(d).split(/\r|\n/).forEach((l) => l && onLine(l)); });
    p.on('error', bad);
    p.on('close', (code) => {
      if (code === 0) ok({ out: binary ? Buffer.concat(out) : Buffer.concat(out).toString('utf8') });
      else bad(new Error(lastLine(tail) || `${cmd} exited with ${code}`));
    });
  });
}
const lastLine = (s) => String(s).trim().split('\n').filter((l) => /\S/.test(l)).pop()?.replace(/^ERROR:\s*/, '').slice(0, 300) || '';

async function probe(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,avg_frame_rate,r_frame_rate:format=duration', '-of', 'json', file]);
  const j = JSON.parse(out), s = j.streams?.[0];
  if (!s) throw new Error('no video in this file');
  const rate = (r) => { const [a, b] = String(r || '0/1').split('/').map(Number); return b ? a / b : a; };
  return { w: +s.width, h: +s.height, fps: rate(s.avg_frame_rate) || rate(s.r_frame_rate) || 30, duration: +j.format?.duration || 0 };
}

const slug = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').split('-').slice(0, 6).join('-').slice(0, 40).replace(/-$/, '') || 'reference';
function freshId(base) {
  let id = slug(base), k = 2;
  while (fs.existsSync(dirOf(id))) id = `${slug(base)}-${k++}`;
  return id;
}

// ---------------------------------------------------------------------------------------------- list
export async function listRefs() {
  if (!fs.existsSync(REFS)) return [];
  const out = [];
  for (const d of await fsp.readdir(REFS, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const ref = await readRef(d.name);
    if (!ref) continue;
    // ?v= the file's time: a re-made file never shows the browser's cached copy of the old one
    const has = (f) => { try { return `/references/${d.name}/${f}?v=${Math.round(fs.statSync(path.join(dirOf(d.name), f)).mtimeMs)}`; } catch { return null; } };
    out.push({ ...ref, scene: PREFIX + d.name, files: { source: has('source.webm') }, moments: (await listMoments(d.name)).length });
  }
  return out.sort((a, b) => b.created.localeCompare(a.created));
}
// ---------------------------------------------------------------------------------------------- moments
const momentsDir = (id) => path.join(dirOf(id), 'moments');
const readJSON = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// what the editor shows for a moment: its record, the measured numbers (the main move and the palette) and its stills
export async function listMoments(id) {
  const mdir = momentsDir(id);
  if (!fs.existsSync(mdir)) return [];
  const out = [];
  for (const d of await fsp.readdir(mdir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(mdir, d.name), m = readJSON(path.join(dir, 'moment.json'));
    if (!m) continue;
    const motion = readJSON(path.join(dir, 'motion.json')), style = readJSON(path.join(dir, 'style.json'));
    let frames = 0; try { frames = fs.readdirSync(path.join(dir, 'frames')).filter((x) => x.endsWith('.jpg')).length; } catch {}
    const main = motion?.moves?.length ? [...motion.moves].sort((p, q) => q.frames - p.frames)[0] : null;   // the longest move
    out.push({
      ...m, id: d.name, ref: id, base: `/references/${id}/moments/${d.name}/`, v: Math.round(fs.statSync(path.join(dir, 'moment.json')).mtimeMs),
      frames, fps: motion?.fps || null, seconds: motion ? motion.frames / motion.fps : null,
      move: main && { seconds: main.seconds, studioFrames: main.studioFrames, ease: main.ease, overshoot: main.overshoot, travel: main.travel, fastestAt: main.fastestAt, shape: main.shape },
      moves: motion?.moves?.length || 0, palette: style?.palette || [], stills: style?.stills || [], study: readJSON(path.join(dir, 'study.json')),
    });
  }
  return out.sort((a, b) => (a.range?.[0] ?? a.frame) - (b.range?.[0] ?? b.frame));
}
// every moment in the project, for a film note's "+ reference"
export async function allMoments() {
  const out = [];
  for (const r of await listRefs()) for (const m of await listMoments(r.id)) if (m.status === 'ready') out.push({ ...m, refName: r.name || r.id, scene: r.scene });
  return out;
}
// mark a moment: saved at once, then cut out and measured in the background (status capturing → ready)
export async function addMoment(id, { range, frame, region, text, name }) {
  const ref = await readRef(id);
  if (!ref || ref.status !== 'ready') throw new Error('this reference isn\'t ready');
  const { fps, duration } = ref.video;
  const [f0, f1] = range?.length === 2 ? range : [frame - Math.round(fps / 2), frame + Math.round(fps / 2)];
  const created = new Date().toISOString();
  const mid = `${created.replace(/[:.]/g, '-').slice(0, 19)}-${slug(name || text || 'moment')}`;
  const dir = path.join(momentsDir(id), mid);
  const m = { name: (name || '').trim() || (text || '').trim().split(/[.\n]/)[0].slice(0, 48) || `Moment at ${(f0 / fps).toFixed(1)}s`,
    text: (text || '').trim(), frame: f0, range: [f0, f1], region: region || null, created, status: 'capturing' };
  await fsp.mkdir(dir, { recursive: true });
  const write = (x) => fsp.writeFile(path.join(dir, 'moment.json'), JSON.stringify(x, null, 2) + '\n');
  await write(m);
  capture(ref, { dir, inS: Math.max(0, f0 / fps), outS: Math.min(duration, (f1 + 1) / fps), region: m.region })
    .then(() => write({ ...m, status: 'ready' }), (e) => write({ ...m, status: 'failed', error: e.message }));
  return { ...m, id: mid };
}
// measure a moment again, with its saved span and box (one that failed, say)
export async function remeasureMoment(id, mid) {
  const ref = await readRef(id);
  if (!ref || ref.status !== 'ready') throw new Error('this reference isn\'t ready');
  const dir = path.join(momentsDir(id), mid);
  const { error: _error, ...m } = JSON.parse(await fsp.readFile(path.join(dir, 'moment.json'), 'utf8'));
  const { fps, duration } = ref.video;
  const write = (x) => fsp.writeFile(path.join(dir, 'moment.json'), JSON.stringify(x, null, 2) + '\n');
  await write({ ...m, status: 'capturing' });
  try {
    await capture(ref, { dir, inS: Math.max(0, m.range[0] / fps), outS: Math.min(duration, (m.range[1] + 1) / fps), region: m.region });
    await write({ ...m, status: 'ready' });
  } catch (e) {
    await write({ ...m, status: 'failed', error: e.message });
    throw e;
  }
}
export async function updateMoment(id, mid, change) {
  if (!/^[\w.-]+$/.test(mid)) return null;
  const file = path.join(momentsDir(id), mid, 'moment.json'), m = readJSON(file);
  if (!m) return null;
  for (const k of ['name', 'text']) if (typeof change[k] === 'string') m[k] = change[k].trim();
  await fsp.writeFile(file, JSON.stringify(m, null, 2) + '\n');
  return m;
}
export async function deleteMoment(id, mid) {
  if (!/^[\w.-]+$/.test(mid)) return;
  await fsp.rm(path.join(momentsDir(id), mid), { recursive: true, force: true });
}

// the editor's scene picker lists ready references after the films
export async function listRefScenes() {
  return (await listRefs()).filter((r) => r.status === 'ready').map((r) => ({ id: r.scene, title: r.name || r.id, kind: 'reference' }));
}

// ---------------------------------------------------------------------------------------------- the scene page
// A reference plays in the editor like any scene: the video, seeked frame by frame through the runtime
// (s.waitFor holds each frame until the video has got there, so rendered and cropped frames are exact).
export async function scenePage(id) {
  const ref = await readRef(id);
  if (!ref || ref.status !== 'ready') return null;
  const { w, h, fps, frames } = ref.video;
  const v = fs.statSync(path.join(dirOf(id), 'source.webm')).mtimeMs | 0;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(ref.name || id)}</title>
<script type="importmap">{"imports":{"gsap":"/vendor/gsap/index.js","gsap/":"/vendor/gsap/","@studio/":"/runtime/"}}</script>
<link rel="stylesheet" href="/runtime/stage.css">
<style>#stage { background: #000; } #ref { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }</style>
</head>
<body>
<div id="stage"><video id="ref" data-name="Reference video" muted playsinline preload="auto" src="/references/${id}/source.webm?v=${v}"></video></div>
<script type="module">
import { studio } from '@studio/studio.js';
const video = document.getElementById('ref'), fps = ${fps};
const s = await studio({ id: ${JSON.stringify(PREFIX + id)}, width: ${w}, height: ${h}, fps, frames: ${frames} });
if (video.readyState < 2) await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));
s.onFrame((f) => {
  const t = (f + 0.5) / fps;   // the middle of the frame: never lands on the one before
  if (Math.abs(video.currentTime - t) < 0.25 / fps) return;
  s.waitFor(new Promise((r) => { video.addEventListener('seeked', () => r(), { once: true }); video.currentTime = t; }));
});
s.ready();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------- add: a link
export async function addLink(url) {
  if (!/^https?:\/\/\S+$/i.test(url || '')) throw new Error('That doesn’t look like a link');
  if (!hasYtDlp()) throw new Error('Links need yt-dlp. Install it once with: brew install yt-dlp (dropping a video file works without it)');
  const host = new URL(url).hostname.replace(/^www\./, '');
  const ref = await writeRef({ id: freshId(`${host.split('.')[0]}-${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')}`),
    name: '', source: { kind: 'link', url, host }, created: new Date().toISOString(), status: 'downloading', progress: 0 });
  track(ref.id, download(ref));
  return ref;
}
const track = (id, p) => { const j = p.catch((e) => patchRef(id, { status: 'failed', error: e.message })).finally(() => jobs.delete(id)); jobs.set(id, j); };

async function download(ref) {
  const dir = dirOf(ref.id), url = ref.source.url;
  const info = JSON.parse((await run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', url])).out);
  const lowres = (info.duration || 0) > LONG_S;
  await patchRef(ref.id, { name: Array.from((info.title || info.description || '').replace(/\s+/g, ' ').trim()).slice(0, 80).join(''),   // by character: never half an emoji
    source: { ...ref.source, title: info.title || null, uploader: info.uploader || info.channel || null, duration: info.duration || null }, lowres });
  let last = 0;
  await run('yt-dlp', ['--no-playlist', '--no-warnings', '--newline', '-f', lowres ? LO : HI, '-o', 'download.%(ext)s', url], {
    cwd: dir,
    onLine: (l) => {
      const m = l.match(/\[download\]\s+([\d.]+)%/);
      if (m && Date.now() - last > 400) { last = Date.now(); patchRef(ref.id, { progress: Math.round(+m[1]) }); }
    },
  });
  const file = (await fsp.readdir(dir)).find((f) => /^download\.(?!part$)\w+$/.test(f));
  if (!file) throw new Error('the download finished but no video file appeared');
  await convert(ref.id, path.join(dir, file));
}

// ---------------------------------------------------------------------------------------------- add: a file
export async function addFile(input, filename) {
  const ext = (path.extname(filename || '').toLowerCase().match(/^\.(mp4|mov|m4v|webm|mkv|avi|gif)$/) || [])[0];
  if (!ext) throw new Error('Drop a video file (mp4, mov, webm, mkv, m4v, avi or gif)');
  const base = path.basename(filename, path.extname(filename));
  const ref = await writeRef({ id: freshId(base), name: base, source: { kind: 'file', file: path.basename(filename) },
    created: new Date().toISOString(), status: 'converting' });
  const upload = path.join(dirOf(ref.id), `upload${ext}`);
  if (typeof input === 'string') await fsp.copyFile(input, upload);   // a path (the CLI)
  else await new Promise((ok, bad) => { const w = fs.createWriteStream(upload); input.pipe(w); w.on('finish', ok); w.on('error', bad); input.on('error', bad); });   // a request body
  track(ref.id, convert(ref.id, upload));
  return ref;
}

// One playable copy: VP9 WebM (plays in the editor, and in the render browser, which can't decode H.264), a steady
// frame rate, a keyframe every second so scrubbing stays quick, long side at most 1920. No sound.
async function convert(id, file) {
  await patchRef(id, { status: 'converting', progress: null });
  const dst = path.join(dirOf(id), 'source.webm'), v = await probe(file);
  const fps = Math.min(60, Math.round(v.fps) || 30);
  await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-map', '0:v:0', '-an',
    '-vf', `fps=${fps},scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '28', '-b:v', '0', '-g', String(fps), '-pix_fmt', 'yuv420p', dst]);
  await fsp.rm(file, { force: true });
  const s = await probe(dst);
  await patchRef(id, { status: 'ready', error: null, video: { w: s.w, h: s.h, fps, duration: s.duration, frames: Math.max(1, Math.round(s.duration * fps)) } });
}

export async function deleteRef(id) { await fsp.rm(dirOf(id), { recursive: true, force: true }); }

export async function capture(ref, { dir, inS, outS, region }) {
  await fsp.mkdir(dir, { recursive: true });   // (moment.json in the folder stays; what a capture makes is replaced)
  for (const f of ['frames', 'stills', 'clip.mp4', 'sheet.png', 'context.png', 'motion.json', 'style.json']) await fsp.rm(path.join(dir, f), { recursive: true, force: true });
  const base = dirOf(ref.id);
  const moment = [inS, outS];   // in the reference's own time, for motion.json
  let src = path.join(base, 'source.webm'), vw = ref.video.w, vh = ref.video.h, srcFps = ref.video.fps, tmp = null;
  // a long video was fetched small: fetch just this moment at full quality, and map the box onto it
  if (ref.lowres && ref.source.kind === 'link' && hasYtDlp()) {
    try {
      await run('yt-dlp', ['--no-playlist', '--no-warnings', '-f', HI, '--download-sections', `*${inS.toFixed(3)}-${outS.toFixed(3)}`,
        '--force-keyframes-at-cuts', '-o', 'hi.%(ext)s', ref.source.url], { cwd: dir });
      const hi = (await fsp.readdir(dir)).find((f) => /^hi\.\w+$/.test(f));
      const v = await probe(path.join(dir, hi));
      const k = v.w / vw;
      if (region) region = { x: region.x * k, y: region.y * k, w: region.w * k, h: region.h * k };
      tmp = src = path.join(dir, hi); outS = Math.min(outS - inS, v.duration || outS - inS); inS = 0; vw = v.w; vh = v.h; srcFps = v.fps;
    } catch (e) { console.warn(`[refs] full-quality fetch failed, using the small copy: ${e.message}`); }
  }
  const fps = Math.min(60, Math.round(srcFps) || 30);
  const even = (v) => Math.max(2, Math.floor(v / 2) * 2);

  // 1. the moment on its own, at a steady frame rate
  const clip = path.join(dir, 'clip.mp4');
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', inS.toFixed(3), '-i', src, '-t', (outS - inS).toFixed(3), '-an', '-vf', `fps=${fps}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip]);
  if (tmp) await fsp.rm(tmp, { force: true });

  // 2. the area to study: the box with a margin, or the whole picture
  const pad = region ? Math.round(Math.max(16, 0.12 * Math.max(region.w, region.h))) : 0;
  const crop = region ? (() => {
    const x = Math.max(0, Math.round(region.x - pad)), y = Math.max(0, Math.round(region.y - pad));
    return { x, y, w: even(Math.min(vw, Math.round(region.x + region.w + pad)) - x), h: even(Math.min(vh, Math.round(region.y + region.h + pad)) - y) };
  })() : { x: 0, y: 0, w: even(vw), h: even(vh) };
  const cropF = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`;

  // 3. every frame of the moment, cropped (long side ≤ 480 px)
  const fdir = path.join(dir, 'frames');
  await fsp.mkdir(fdir);
  const k = Math.min(1, 480 / Math.max(crop.w, crop.h));
  await run('ffmpeg', ['-v', 'error', '-y', '-i', clip, '-vf', `${cropF},scale=${even(crop.w * k)}:${even(crop.h * k)}`, '-q:v', '3', path.join(fdir, 'f%04d.jpg')]);
  const n = (await fsp.readdir(fdir)).filter((f) => f.endsWith('.jpg')).length;
  if (!n) throw new Error('no frames came out of the noted moment');

  // 4. the whole picture at the start, middle and end of the moment (the box is drawn on the sheet)
  const ctx = [1, Math.ceil(n / 2), n];
  for (const [i, f] of ctx.entries()) {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', clip, '-vf', `select=eq(n\\,${f - 1}),scale=960:-2`, '-frames:v', '1', '-q:v', '3', path.join(dir, `ctx-${i}.jpg`)]);
  }

  // 5. measure, 6. the labelled sheets
  const motion = await measure(clip, crop, fps, n, { source: ref.source, inS: moment[0], outS: moment[1], region });
  await fsp.writeFile(path.join(dir, 'motion.json'), JSON.stringify(motion, null, 1) + '\n');
  await sheets(dir, { n, fps, crop, region, vw, ctx, motion });
  for (let i = 0; i < 3; i++) await fsp.rm(path.join(dir, `ctx-${i}.jpg`), { force: true });

  // 7. full-resolution stills at the key frames (first, last, each move's start, fastest frame and landing; then
  // evenly spaced to make 8 or so): what style is studied from, and the key frames a finding shows
  const keys = new Set([1, n]);
  for (const m of motion.moves) {
    keys.add(m.fromFrame); keys.add(m.toFrame);
    keys.add(Math.min(m.toFrame, m.fromFrame + Math.max(1, Math.round(m.fastestAt * m.frames))));
  }
  for (let i = 1; keys.size < Math.min(8, n) && i < 8; i++) keys.add(Math.round(1 + (i * (n - 1)) / 7));
  const sdir = path.join(dir, 'stills');
  await fsp.mkdir(sdir);
  const stills = [...keys].sort((a, b) => a - b);
  for (const f of stills) {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', clip, '-vf', `select=eq(n\\,${f - 1})`, '-frames:v', '1', '-q:v', '2', path.join(sdir, `f${String(f).padStart(4, '0')}.jpg`)]);
  }

  // 8. the colours of the studied area across the stills
  const palette = await measurePalette(stills.map((f) => path.join(sdir, `f${String(f).padStart(4, '0')}.jpg`)), crop);
  await fsp.writeFile(path.join(dir, 'style.json'), JSON.stringify({
    about: 'Measured colours of the studied area (the box with a margin, or the whole picture) across the stills, most used first. share = part of the area. Roles (background, accent, text…) are for you to judge from the stills.',
    area: region ? 'box' : 'whole picture', stills: stills.map((f) => `stills/f${String(f).padStart(4, '0')}.jpg`), palette,
  }, null, 1) + '\n');
}

// k-means on the pixels of the studied area (each still scaled down to ≤ 96 px wide): up to 8 colours, near-duplicates
// merged, ones under 1% dropped
async function measurePalette(files, crop) {
  const w = Math.max(8, Math.min(96, crop.w) & ~1), hgt = Math.max(8, Math.round(crop.h * w / crop.w) & ~1);
  const px = [];
  for (const f of files) {
    const { out } = await run('ffmpeg', ['-v', 'error', '-i', f, '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${w}:${hgt}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { binary: true });
    for (let i = 0; i + 2 < out.length; i += 3) px.push([out[i], out[i + 1], out[i + 2]]);
  }
  if (!px.length) return [];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // start from far-apart colours (deterministic), then refine
  const cs = [px[0]];
  while (cs.length < 8) {
    let best = null, bd = -1;
    for (let i = 0; i < px.length; i += 7) { const d = Math.min(...cs.map((c) => d2(c, px[i]))); if (d > bd) { bd = d; best = px[i]; } }
    if (bd < 200) break;
    cs.push(best);
  }
  let assign = new Array(px.length).fill(0);
  for (let it = 0; it < 12; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => { let k = 0, bd = Infinity; cs.forEach((c, j) => { const d = d2(c, p); if (d < bd) { bd = d; k = j; } }); assign[i] = k; const s = sum[k]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    sum.forEach((s, j) => { if (s[3]) cs[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = cs.map((_, j) => assign.filter((a) => a === j).length);
  let list = cs.map((c, j) => ({ c, n: counts[j] })).filter((x) => x.n);
  // merge colours that are near-identical
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (d2(list[i].c, list[j].c) < 18 ** 2) { const a = list[i], b = list[j], t = a.n + b.n; a.c = a.c.map((v, k) => (v * a.n + b.c[k] * b.n) / t); a.n = t; list.splice(j--, 1); }
  }
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  return list.sort((a, b) => b.n - a.n).map((x) => ({ hex: hex(x.c), share: Math.round((x.n / px.length) * 1000) / 1000 })).filter((x) => x.share >= 0.01);
}

// ---------------------------------------------------------------------------------------------- measurement
// The studied area in grayscale (≤ 160 px wide), compared frame to frame:
//   change[i]  how much of it changed since the frame before (0–1). For a solid thing sliding less than its own size
//              per frame, and for fades, this rises and falls with the speed, so adding it up gives the progress.
//   where[i]   the centre of that change, in video px: follows a thing that travels (halfway between frames)
// A move is a run of change: it starts where change rises past a share of the peak and is followed out until change
// has all but died, so a long slow tail still counts. Each move gets a duration, its direction and distance, a check
// for overshoot (the thing turning back at the end) and an easing fitted to its progress.
async function measure(clip, crop, fps, n, ref) {
  const sw = Math.max(16, Math.min(160, crop.w) & ~1), sh = Math.max(16, Math.round(crop.h * sw / crop.w) & ~1);
  const { out } = await run('ffmpeg', ['-v', 'error', '-i', clip, '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${sw}:${sh},format=gray`,
    '-f', 'rawvideo', '-'], { binary: true });
  const size = sw * sh, count = Math.min(n, Math.floor(out.length / size)), kx = crop.w / sw, ky = crop.h / sh;
  const G = Array.from({ length: count }, (_, i) => out.subarray(i * size, (i + 1) * size));
  const THR = 10;   // a pixel counts as changed past this (0–255): above compression noise
  const change = [0], where = [null];
  for (let i = 1; i < count; i++) {
    const a = G[i - 1], b = G[i];
    let sum = 0, cx = 0, cy = 0, wsum = 0;
    for (let p = 0; p < size; p++) {
      const d = Math.abs(b[p] - a[p]);
      if (d <= THR) continue;
      sum += d; cx += (p % sw) * d; cy += ((p / sw) | 0) * d; wsum += d;
    }
    change.push(sum / size / 255);
    where.push(wsum > 255 * 2 ? [crop.x + (cx / wsum + 0.5) * kx, crop.y + (cy / wsum + 0.5) * ky] : null);
  }

  // moves: rise past `hi`, then followed both ways while change stays above `lo`
  const sm = change.map((_, i) => (change[Math.max(0, i - 1)] + 2 * change[i] + change[Math.min(count - 1, i + 1)]) / 4);
  const peak = Math.max(...sm, 0), noise = [...sm].sort((a, b) => a - b)[Math.floor(count * 0.2)] || 0;
  const hi = Math.max(peak * 0.12, noise * 3, 0.001), lo = Math.max(peak * 0.01, noise * 1.5, 0.0002);
  const runs = [];
  for (let i = 1; i < count; i++) {
    if (change[i] < hi || sm[i] < hi) continue;   // raw and smoothed: smoothing alone leaks into the still frame before a move
    let a = i, b = i;
    // followed through a pause of up to 3 frames when motion picks up again: the instant a thing turns back at the
    // end of an overshoot, or holds before an anticipation
    const goes = (j) => j >= 1 && j < count && change[j] >= lo;
    for (;;) { const k = [1, 2, 3, 4].find((d) => goes(a - d)); if (!k) break; a -= k; }
    for (;;) { const k = [1, 2, 3, 4].find((d) => goes(b + d)); if (!k) break; b += k; }
    const prev = runs[runs.length - 1];
    if (prev && a <= prev[1] + 1) prev[1] = Math.max(prev[1], b); else runs.push([a, b]);
    i = b;
  }
  const tokens = readTokens();
  const moves = runs.filter(([a, b]) => b - a >= 1).map(([a, b]) => describeMove(a - 1, b, { change, where, fps, tokens, crop }));

  const bars = '▁▂▃▄▅▆▇█', spark = (arr) => { const m = Math.max(...arr, 1e-9); return arr.map((v) => (v < m * 0.04 ? '·' : bars[Math.min(7, Math.floor((v / m) * 7.99))])).join(''); };
  return {
    about: 'Measured from pixels, so approximate: check it against the frames. Frame numbers are frames of the marked moment at its own rate (frame 1 = frames/f0001.jpg). Times in seconds; studioFrames are at 25 fps. A move runs from the still frame before it (fromFrame) to the frame it comes to rest on (toFrame); progress is 0 at fromFrame and 1 at toFrame.',
    source: ref.source.url || ref.source.file, momentS: [ref.inS, ref.outS], fps, frames: count, studied: { box: ref.region, crop },
    overview: { change: spark(change) },
    moves,
    perFrame: change.map((c, i) => ({ f: i + 1, change: r4(c), where: where[i] && where[i].map(Math.round) })),
  };
}

function describeMove(s, e, { change, where, fps, tokens, crop }) {
  // s = the still frame it starts from, e = the frame it comes to rest on (indexes into the moment's frames)
  const frames = e - s, seg = change.slice(s + 1, e + 1);
  const progressOf = (turn) => {   // motion after `turn` (an overshoot coming back) counts backwards
    const cum = [0]; seg.forEach((v, i) => cum.push(cum[cum.length - 1] + (turn != null && i > turn ? -v : v)));
    return cum.map((v) => v / (cum[cum.length - 1] || 1));
  };
  let prog = progressOf(null);
  // a thing that travels: direction and distance from the centre of change, and whether it turns back at the end
  let travel = null, overshoot = null;
  const W = where.slice(s + 1, e + 1), pts = W.filter(Boolean);
  if (pts.length >= Math.max(2, frames * 0.6)) {
    const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1], dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy);
    if (dist > 0.05 * Math.min(crop.w, crop.h)) {
      travel = { dx: Math.round(dx), dy: Math.round(dy), px: Math.round(dist), direction: dirName(dx, dy),
        note: 'measured between the centres of the first and last steps, so a little short of the full distance' };
      const proj = W.map((w) => w && ((w[0] - x0) * dx + (w[1] - y0) * dy) / (dist * dist));
      let far = -Infinity, farI = -1;
      proj.forEach((v, i) => { if (v != null && v > far) { far = v; farI = i; } });
      const after = proj.slice(farI + 1).filter((v) => v != null);
      if (after.length && far - Math.min(...after) > 0.04) {
        overshoot = { turnsBackAtFrame: s + 2 + farI };
        prog = progressOf(farI);
        overshoot.by = r2(Math.max(...prog) - 1);   // past the resting place, as a share of the whole move
      }
    }
  }
  const peakI = seg.indexOf(Math.max(...seg)), at = (peakI + 0.5) / frames;
  let fit = fitBezier(prog);
  const near = Object.entries(tokens).map(([name, c]) => ({ name, c, err: curveErr(c, prog) })).sort((p, q) => p.err - q.err)[0];
  if (fit && near && near.err <= fit.err + 0.004) fit = { c: near.c, err: near.err };   // a token that fits as well: use its curve
  const sec = frames / fps;
  return {
    fromFrame: s + 1, toFrame: e + 1, frames, seconds: r2(sec), studioFrames: Math.round(sec * 25),
    fastestAt: r2(at),
    shape: overshoot ? `goes ${Math.round(overshoot.by * 100)}% past where it lands, then settles back` : at < 0.3 ? 'fast start, long slow-down (ease-out)' : at > 0.7 ? 'slow start, fast end (ease-in)' : 'gentle start and end (ease-in-out)',
    travel, overshoot,
    ease: fit && { bezier: fit.c.map(r2), fitError: r3(fit.err), nearestToken: near && near.err < 0.035 ? near.name : null, nearestTokenError: near && r3(near.err) },
    progress: prog.map(r3),
  };
}
const dirName = (dx, dy) => (Math.abs(dx) > 2 * Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : Math.abs(dy) > 2 * Math.abs(dx) ? (dy > 0 ? 'down' : 'up') : `${dy > 0 ? 'down' : 'up'}-${dx > 0 ? 'right' : 'left'}`);
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000, r4 = (v) => Math.round(v * 10000) / 10000;

function readTokens() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tokens', 'motion.json'), 'utf8')).ease || {}; } catch { return {}; }
}
// y at x on a CSS cubic-bezier
function bezY([x1, y1, x2, y2], x) {
  const B = (t, p1, p2) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 22; i++) { t = (lo + hi) / 2; if (B(t, x1, x2) < x) lo = t; else hi = t; }
  return B(t, y1, y2);
}
const curveErr = (c, ys) => Math.sqrt(ys.reduce((s, y, i) => s + (bezY(c, i / (ys.length - 1)) - y) ** 2, 0) / ys.length);
// least-squares cubic-bezier through a progress curve (0 = start, 1 = end): a coarse grid, then a finer one around the best
function fitBezier(ys) {
  if (ys.length < 4) return null;
  let best = null;
  const tryC = (c) => { const err = curveErr(c, ys); if (!best || err < best.err) best = { c, err }; };
  const g = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], gy = [-0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6];   // y past 0–1: anticipation, overshoot
  for (const x1 of g) for (const y1 of gy) for (const x2 of g) for (const y2 of gy) tryC([x1, y1, x2, y2]);
  const [bx1, by1, bx2, by2] = best.c, f = [-0.075, -0.05, -0.025, 0, 0.025, 0.05, 0.075], cl = (v) => Math.min(1, Math.max(0, v));
  for (const a of f) for (const b of f) for (const c of f) for (const d of f) tryC([cl(bx1 + a), by1 + b, cl(bx2 + c), by2 + d]);
  return best;
}

// ---------------------------------------------------------------------------------------------- sheets
// Drawn as a small HTML page and photographed with Playwright's Chromium (this ffmpeg can't draw text).
async function sheets(dir, { n, fps, crop, region, vw, ctx, motion }) {
  const step = Math.max(1, Math.ceil(n / 48)), cells = [];
  for (let f = 1; f <= n; f += step) cells.push(f);
  if (cells[cells.length - 1] !== n) cells.push(n);
  const inMove = (f) => motion.moves.some((m) => f >= m.fromFrame && f <= m.toFrame);
  const cols = Math.min(8, cells.length), cw = Math.min(240, Math.floor(1920 / cols) - 8);
  const k = 960 / vw, box = region && `left:${region.x * k}px;top:${region.y * k}px;width:${region.w * k}px;height:${region.h * k}px`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#101114;color:#e7e8ea;font:600 13px -apple-system,system-ui,sans-serif}
    #sheet,#context{display:inline-block;padding:14px}
    h1{font-size:14px;margin:0 0 10px;font-weight:650} h1 span{color:#8b8f98;font-weight:500}
    .grid{display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:6px}
    .c{position:relative;background:#000;border:2px solid #222;border-radius:4px;overflow:hidden}
    .c.m{border-color:#F2711C} .c img{display:block;width:100%}
    .c b{position:absolute;left:0;top:0;background:rgba(0,0,0,.72);padding:2px 6px;font-size:12px;border-bottom-right-radius:4px}
    .row{display:flex;gap:10px} .ctx{position:relative;width:960px} .ctx img{display:block;width:960px}
    .ctx i{position:absolute;border:3px solid #F2711C;border-radius:3px}
    .ctx b{position:absolute;left:0;top:0;background:rgba(0,0,0,.72);padding:3px 8px;font-size:14px}
  </style>
  <div id="sheet"><h1>${step === 1 ? "Every frame" : `Every ${step}${step === 2 ? "nd" : step === 3 ? "rd" : "th"} frame`} of the moment <span>· ${n} frames at ${fps} fps · orange = moving · f = frames/fNNNN.jpg</span></h1>
  <div class="grid">${cells.map((f) => `<div class="c${inMove(f) ? ' m' : ''}"><img src="frames/f${String(f).padStart(4, '0')}.jpg"><b>f${f} · ${(f - 1) / fps < 10 ? ((f - 1) / fps).toFixed(2) : ((f - 1) / fps).toFixed(1)}s</b></div>`).join('')}</div></div>
  <div id="context"><h1>The whole picture <span>· start, middle and end of the moment${region ? ' · orange = the box' : ''}</span></h1>
  <div class="row">${ctx.map((f, i) => `<div class="ctx"><img src="ctx-${i}.jpg">${box ? `<i style="${box}"></i>` : ''}<b>f${f}</b></div>`).join('')}</div></div>`;
  const file = path.join(dir, '_sheet.html');
  await fsp.writeFile(file, html);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(CHROME);
  try {
    const page = await browser.newPage({ viewport: { width: 3000, height: 1000 } });
    await page.goto(`file://${file}`);
    await page.evaluate(() => Promise.all([...document.images].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
    await page.locator('#sheet').screenshot({ path: path.join(dir, 'sheet.png') });
    await page.locator('#context').screenshot({ path: path.join(dir, 'context.png') });
  } finally { await browser.close(); await fsp.rm(file, { force: true }); }
}
