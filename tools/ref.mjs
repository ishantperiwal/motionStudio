// References from the command line (the References panel does the same from the editor):
//   npm run ref -- list                       the project's references and their moments
//   npm run ref -- add <link|file>            add a reference (a link is downloaded with yt-dlp) and wait until it's ready
//   npm run ref -- compare <ref>/<moment> <scene> <a-b>
//       one image: the reference moment (top row) over the film's frames a–b (bottom row), at the same four points
//       (start, ⅓, ⅔, end), to check a scene against the moment it borrows from. Written to out/compare/.
//   npm run ref -- remeasure <ref>/<moment>   measure a moment again (one that failed), with its saved span and box
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, PROJECT } from '../server/project.mjs';
import { addLink, addFile, listRefs, listMoments, jobs, readRef, remeasureMoment, PREFIX, REFS } from '../server/refs.mjs';

const [cmd, ...args] = process.argv.slice(2);
const rel = (p) => path.relative(process.cwd(), p) || '.';
const sh = (c, a) => { const r = spawnSync(c, a, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr?.trim().split('\n').pop() || `${c} failed`); return r.stdout; };

if (cmd === 'list') {
  for (const r of await listRefs()) {
    console.log(`${r.id.padEnd(26)} ${r.status.padEnd(11)} ${r.name || ''}`);
    for (const m of await listMoments(r.id)) console.log(`   ${m.id}  ${m.status}  “${m.name}”  frames ${m.range?.join('–')}`);
  }
} else if (cmd === 'add' && args[0]) {
  const arg = args[0];
  const ref = /^https?:\/\//.test(arg) ? await addLink(arg) : await addFile(path.resolve(process.env.INIT_CWD || '.', arg), arg);
  console.log(`adding ${ref.id}…`);
  await jobs.get(ref.id);
  const r = await readRef(ref.id);
  if (r.status !== 'ready') { console.error(`failed: ${r.error}`); process.exit(1); }
  console.log(`ready: ${r.name || r.id} · ${r.video.w}×${r.video.h} · ${r.video.fps} fps · ${r.video.duration.toFixed(1)}s\nopen it from References (R) in the editor`);
} else if (cmd === 'remeasure' && args[0]?.includes('/')) {
  const [ref, mid] = args[0].split('/');
  await remeasureMoment(ref, mid);
  console.log(`measured · references/${ref}/moments/${mid}/`);
} else if (cmd === 'compare' && args.length >= 3) {
  const [refMoment, scene, span] = args;
  const [rid, mid0] = refMoment.replace(PREFIX, '').split('/');
  const mdir = path.join(REFS, rid, 'moments');
  const mid = fs.existsSync(mdir) && fs.readdirSync(mdir).find((d) => d === mid0 || d.startsWith(mid0) || d.endsWith(mid0));
  if (!mid) { console.error(`no moment "${mid0}" on reference "${rid}" (npm run ref -- list)`); process.exit(1); }
  const clip = path.join(mdir, mid, 'clip.mp4');
  const n = +sh('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', clip]).trim();
  const [a, b] = span.split('-').map(Number);
  const at = [0, 1 / 3, 2 / 3, 1];
  const ours = at.map((t) => Math.round(a + t * (b - a)));
  const r = spawnSync(process.execPath, ['render/render.mjs', scene, '--frames', ours.join(',')], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, MOTION_PROJECT: PROJECT } });
  if (r.status !== 0) process.exit(r.status || 1);
  const outDir = path.join(PROJECT, 'out', 'compare'), tmp = path.join(outDir, `.${mid}`);
  fs.mkdirSync(tmp, { recursive: true });
  const cell = 'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x101114';
  at.forEach((t, i) => {
    sh('ffmpeg', ['-v', 'error', '-y', '-i', clip, '-vf', `select=eq(n\\,${Math.round(t * (n - 1))}),${cell}`, '-frames:v', '1', path.join(tmp, `r${i}.png`)]);
    sh('ffmpeg', ['-v', 'error', '-y', '-i', path.join(PROJECT, 'out', `${scene}-frames`, `f${String(ours[i]).padStart(4, '0')}.png`), '-vf', cell, path.join(tmp, `o${i}.png`)]);
  });
  const file = path.join(outDir, `${scene}-${a}-${b}-vs-${rid}.png`);
  const inputs = [0, 1, 2, 3].flatMap((i) => ['-i', path.join(tmp, `r${i}.png`)]).concat([0, 1, 2, 3].flatMap((i) => ['-i', path.join(tmp, `o${i}.png`)]));
  sh('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', '[0][1][2][3]hstack=4[r];[4][5][6][7]hstack=4[o];[r][o]vstack', file]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${rel(file)}\n  top: the reference moment at its start, ⅓, ⅔, end · bottom: ${scene} frames ${ours.join(', ')}`);
} else {
  console.log('usage: npm run ref -- list | add <link|file> | compare <ref>/<moment> <scene> <a-b> | remeasure <ref>/<moment>');
}
process.exit(0);
