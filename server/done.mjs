// Finishing a note, in code rather than by convention: the note becomes a "To check" item and the note itself goes,
// in one step. Used by `npm run done` (tools/done.mjs) and by the dev server's safety net, so a note never sits next
// to its own done item.
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT } from './project.mjs';

const notesDir = (scene) => path.join(PROJECT, 'notes', scene);
const checklistFile = (scene) => path.join(notesDir(scene), '_checklist.json');
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const write = (file, data) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(tmp, file); };
const removeNote = (scene, id) => { for (const ext of ['.json', '.png']) fs.rmSync(path.join(notesDir(scene), id + ext), { force: true }); };

// The note `id` on `scene` is done: `text` (1–2 lines: what changed, where to look) goes into the To check list with
// the note's frame, span, region and attachments, then the note and its crop are deleted. Returns the item.
export function finishNote(scene, id, text) {
  if (!text?.trim()) throw new Error('say what changed (1–2 lines): it becomes the To check item');
  const list = read(checklistFile(scene), { items: [] });
  const already = list.items.find((i) => i.id === id);
  const note = read(path.join(notesDir(scene), id + '.json'), null);
  if (!note && !already) throw new Error(`no note "${id}" on scene "${scene}" (see notes/${scene}/)`);
  const src = note || already;
  const item = { id, frame: src.frame, ...(src.range ? { range: src.range } : {}), region: src.region ?? null, text: text.trim(),
    ...(src.useRefs?.length ? { useRefs: src.useRefs } : {}), ...(src.media?.length ? { media: src.media } : {}) };
  list.items = [...list.items.filter((i) => i.id !== id), item];   // done again: the newer summary, at the end
  write(checklistFile(scene), list);   // the item first: if anything stops here, the safety net below removes the note
  removeNote(scene, id);
  return item;
}

// Safety net: any note whose id is already in its scene's To check list is done; remove it. Returns the removed ids.
export function dropDoneNotes(scene) {
  const ids = new Set((read(checklistFile(scene), { items: [] }).items || []).map((i) => i.id));
  const gone = [];
  for (const id of ids) if (fs.existsSync(path.join(notesDir(scene), id + '.json'))) { removeNote(scene, id); gone.push(id); }
  return gone;
}
export const scenesWithNotes = () => { try { return fs.readdirSync(path.join(PROJECT, 'notes'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };
