// References from the command line (the References page does the same from the browser):
//   npm run ref -- <id>              study the reference's noted moments: cut each out and save its frames, full-size
//                                    stills, contact sheet, measurements and colour palette in
//                                    references/<id>/findings/<note id>/, and print a summary
//   npm run ref -- add <link|file>   add a reference (a link is downloaded with yt-dlp) and wait until it's ready
//   npm run ref -- list              the project's references
import path from 'node:path';
import { PROJECT } from '../server/project.mjs';
import { studyNotes, addLink, addFile, listRefs, jobs, readRef, PREFIX } from '../server/refs.mjs';

const [cmd, arg] = process.argv.slice(2);
const rel = (p) => path.relative(process.cwd(), p) || '.';

if (cmd === 'list') {
  for (const r of await listRefs()) console.log(`${r.id.padEnd(28)} ${r.status.padEnd(11)} ${r.name || ''}${r.files.doc ? '  · studied' : ''}`);
} else if (cmd === 'add' && arg) {
  const ref = /^https?:\/\//.test(arg) ? await addLink(arg) : await addFile(path.resolve(process.env.INIT_CWD || '.', arg), arg);
  console.log(`adding ${ref.id}…`);
  await jobs.get(ref.id);
  const r = await readRef(ref.id);
  if (r.status !== 'ready') { console.error(`failed: ${r.error}`); process.exit(1); }
  console.log(`ready: ${r.name || r.id} · ${r.video.w}×${r.video.h} · ${r.video.fps} fps · ${r.video.duration.toFixed(1)}s\nopen it in the editor: http://localhost:5173/editor/#${PREFIX}${r.id}@0`);
} else if (cmd && cmd !== 'add') {
  const id = cmd.startsWith(PREFIX) ? cmd.slice(PREFIX.length) : cmd;
  const { ref, moments } = await studyNotes(id);
  if (!moments.length) { console.log(`No open notes on ${PREFIX}${id}: mark a moment in the editor first (a span note, a box, a line).`); process.exit(0); }
  console.log(`${ref.name || id}  (${ref.source.url || ref.source.file}) · ${ref.video.fps} fps · project ${PROJECT}`);
  for (const { note, dir, motion, style } of moments) {
    console.log(`\nnote ${note.id}: “${(note.text || '').trim()}”`);
    console.log(`  frames ${note.range ? note.range.join('–') : note.frame} · ${motion.momentS.map((s) => s.toFixed(2)).join('–')}s${note.region ? ` · box ${note.region.w}×${note.region.h} at ${note.region.x},${note.region.y}` : ''}`);
    console.log(`  ${rel(dir)}/  (sheet.png, context.png, stills/, frames/, motion.json, style.json, clip.mp4)`);
    console.log(`  stills ${style.stills.map((f) => path.basename(f, '.jpg')).join(' ')}`);
    console.log(`  palette (${style.area}) ${style.palette.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(' · ')}`);
    console.log(`  change ${motion.overview.change}`);
    for (const m of motion.moves) console.log(`  move f${m.fromFrame}–f${m.toFrame} · ${m.seconds}s (${m.studioFrames}f at 25) · ${m.shape}${m.travel ? ` · ${m.travel.px}px ${m.travel.direction}` : ''} · ease ${m.ease?.nearestToken || JSON.stringify(m.ease?.bezier)}`);
    if (!motion.moves.length) console.log('  no clear move found: look at the sheet');
  }
} else {
  console.log('usage: npm run ref -- <id> | add <link|file> | list');
}
process.exit(0);
