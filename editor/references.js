// References gallery: add a video (a link, or a file dropped anywhere), delete one, click one to open it in the
// editor, where you note the moments you like and Send to Claude like any scene. Server side: server/refs.mjs.

const $ = (q) => document.querySelector(q);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((c) => c != null && c !== false));
  return el;
}
const say = (text, err) => { const m = $('#msg'); m.textContent = text || ''; m.hidden = !text; m.classList.toggle('err', !!err); };
const BUSY = ['downloading', 'converting'];
// inside the editor (a panel over it): picking a reference opens it there; Esc closes the panel
const EMBED = window.parent !== window;
const toEditor = (msg) => window.parent.postMessage(msg, location.origin);
if (EMBED) {
  document.documentElement.classList.add('embed');
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.target.closest?.('input')) toEditor({ type: 'ms:close-refs' }); });
  document.getElementById('closePanel').onclick = () => toEditor({ type: 'ms:close-refs' });
}
const openRef = (r) => { location.href = `/editor/?embed#${r.scene}@0`; };   // the reference's editor, in this same panel
let refs = [];

async function load() {
  const d = await (await fetch('/api/refs')).json();
  refs = d.refs;
  if (!d.ytdlp) $('#link').placeholder = 'Drop a video file anywhere (links need yt-dlp: brew install yt-dlp)';
  const grid = $('#grid');
  grid.replaceChildren();
  if (!refs.length) grid.append(h('div', { class: 'empty' }, 'No references yet.'));
  for (const r of refs) {
    const busy = BUSY.includes(r.status);
    const media = h('div', { class: 'media' });
    if (r.files.source && r.status === 'ready') {
      const v = h('video', { muted: true, playsInline: true, loop: true, preload: 'metadata', src: `${r.files.source}#t=0.05` });
      media.append(v);
      media.addEventListener('mouseenter', () => v.play().catch(() => {}));
      media.addEventListener('mouseleave', () => v.pause());
    } else media.append(r.status === 'failed' ? 'Couldn’t get this video' : r.status === 'downloading' ? `Downloading… ${r.progress ? r.progress + '%' : ''}` : 'Preparing…');
    const sub = r.status === 'failed' ? r.error : r.summary || (r.source.kind === 'link' ? r.source.url : r.source.file);
    grid.append(h('div', { class: `tile${busy ? ' busy' : ''}`, onclick: () => r.status === 'ready' && openRef(r) },
      h('button', { class: 'del', title: 'Delete this reference', onclick: (e) => { e.stopPropagation(); remove(r); } }, 'Delete'),
      media, h('div', { class: 'meta' }, h('b', {}, r.name || r.id), h('p', { title: sub || '' }, sub || ''))));
  }
}

async function remove(r) {
  if (!confirm(`Delete “${r.name || r.id}”? Its video, notes and write-up are removed from this project.`)) return;
  const res = await fetch(`/api/refs/${r.id}`, { method: 'DELETE' });
  if (!res.ok) say((await res.json().catch(() => ({}))).error || 'Couldn’t delete it', true);
  load();
}

async function addLink(url) {
  say('');
  const res = await fetch('/api/refs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  if (!res.ok) return say((await res.json().catch(() => ({}))).error || 'Couldn’t add it', true);
  $('#link').value = '';
  load();
}
function addFile(file) {
  say('');
  if (!/^video\/|^image\/gif$/.test(file.type) && !/\.(mp4|mov|m4v|webm|mkv|avi|gif)$/i.test(file.name)) return say(`“${file.name}” isn’t a video file`, true);
  const xhr = new XMLHttpRequest();   // not fetch: XHR reports upload progress for big files
  xhr.open('POST', `/api/refs/upload?name=${encodeURIComponent(file.name)}`);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) say(`Uploading ${file.name}… ${Math.round((e.loaded / e.total) * 100)}%`); };
  xhr.onloadend = () => {
    if (xhr.status === 200) { say(''); return load(); }
    let d = {}; try { d = JSON.parse(xhr.responseText); } catch {}
    say(d.error || 'Upload failed', true);
  };
  xhr.send(file);
}
$('#add').onsubmit = (e) => { e.preventDefault(); const u = $('#link').value.trim(); if (u) addLink(u); };

// a file dropped anywhere (or a link dragged in from another tab); ⌘V of a link or a file outside the field
let depth = 0;
const files = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => { if (files(e)) { e.preventDefault(); depth++; document.body.classList.add('dragging'); } });
addEventListener('dragover', (e) => { if (files(e)) e.preventDefault(); });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
addEventListener('drop', (e) => {
  depth = 0; document.body.classList.remove('dragging');
  if (files(e)) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) addFile(f); return; }
  const u = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').trim().split('\n')[0];
  if (/^https?:\/\//.test(u)) { e.preventDefault(); addLink(u); }
});
addEventListener('paste', (e) => {
  if (e.target.closest?.('input')) return;
  const f = e.clipboardData?.files?.[0];
  if (f) { e.preventDefault(); return addFile(f); }
  const t = e.clipboardData?.getData('text/plain')?.trim();
  if (t && /^https?:\/\/\S+$/.test(t)) { e.preventDefault(); addLink(t); }
});

// live: download progress and finished conversions
const es = new EventSource('/api/events');
let t = null;
es.onmessage = (e) => {
  const { paths = [] } = JSON.parse(e.data);
  if (paths.some((p) => p.startsWith('editor/references'))) return location.reload();
  if (paths.some((p) => p.startsWith('references/'))) { clearTimeout(t); t = setTimeout(load, 150); }
};
setInterval(() => { if (refs.some((r) => BUSY.includes(r.status))) load(); }, 2000);
load();
