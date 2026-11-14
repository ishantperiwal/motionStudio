// The project's media library: files you bring in to use in films (your own footage, screenshots, icons, logos) or
// to point at in a note. They live in <project>/media/ as they are; Claude converts what a scene needs when it uses
// one (a video becomes WebM in the scene's assets/). The references' downloaded videos are listed alongside.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECT } from './project.mjs';
import { listRefs } from './refs.mjs';

export const MEDIA = path.join(PROJECT, 'media');
const KINDS = { video: /\.(mp4|mov|m4v|webm|mkv|avi)$/i, gif: /\.gif$/i, svg: /\.svg$/i, image: /\.(png|jpe?g|webp|avif)$/i, font: /\.(woff2?|ttf|otf)$/i };
export const kindOf = (name) => Object.keys(KINDS).find((k) => KINDS[k].test(name)) || null;
const clean = (name) => path.basename(name).normalize('NFKD').replace(/[^\w.\- ]/g, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';

export async function listMedia() {
  const out = [];
  if (fs.existsSync(MEDIA)) for (const f of await fsp.readdir(MEDIA)) {
    const kind = kindOf(f);
    if (!kind) continue;
    const st = fs.statSync(path.join(MEDIA, f));
    out.push({ id: f, name: f, kind, from: 'upload', url: `/media/${encodeURIComponent(f)}`, path: `media/${f}`, bytes: st.size, added: st.mtime.toISOString() });
  }
  out.sort((a, b) => b.added.localeCompare(a.added));
  for (const r of await listRefs()) if (r.status === 'ready' && r.files.source) {
    out.push({ id: `ref:${r.id}`, name: r.name || r.id, kind: 'video', from: 'reference', ref: r.id, url: r.files.source, path: `references/${r.id}/source.webm`, added: r.created });
  }
  return out;
}

// save an upload (a request body, or a path from the command line) under a free name
export async function addMedia(input, filename) {
  const name0 = clean(filename || '');
  if (!kindOf(name0)) throw new Error('Add a video, image, GIF, SVG or font file');
  await fsp.mkdir(MEDIA, { recursive: true });
  const ext = path.extname(name0), base = path.basename(name0, ext);
  let name = name0, k = 2;
  while (fs.existsSync(path.join(MEDIA, name))) name = `${base}-${k++}${ext}`;
  const dst = path.join(MEDIA, name);
  if (typeof input === 'string') await fsp.copyFile(input, dst);
  else await new Promise((ok, bad) => { const w = fs.createWriteStream(dst); input.pipe(w); w.on('finish', ok); w.on('error', bad); input.on('error', bad); });
  return (await listMedia()).find((m) => m.id === name);
}

export async function deleteMedia(id) {
  if (!id || id.startsWith('ref:') || id !== path.basename(id)) return;   // a reference's video goes with the reference
  await fsp.rm(path.join(MEDIA, id), { force: true });
}
