// npm run new-scene -- <id> [--size 1920x1080] [--fps 25]
// Creates scenes/<id>/ in the project (see server/project.mjs) with the import map, a stage, and a starter scene.js.
// A project folder outside the studio also gets a RUN-STUDIO.md (once, never overwritten): its own commands to run the
// studio, the notes watcher and renders.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PROJECT } from '../server/project.mjs';

const argv = process.argv.slice(2);
const id = argv[0];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
if (!id || !/^[\w.-]+$/.test(id)) { console.log('usage: npm run new-scene -- <id> [--size 1920x1080] [--fps 25]'); process.exit(1); }
const dir = path.join(PROJECT, 'scenes', id);
if (fs.existsSync(dir)) { console.error(`scenes/${id} already exists`); process.exit(1); }
const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const fps = +opt('fps', 25);

fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${id}</title>
<script type="importmap">{"imports":{"gsap":"/vendor/gsap/index.js","gsap/":"/vendor/gsap/","roughjs":"/vendor/roughjs/bundled/rough.esm.js","pixi.js":"/vendor/pixi.js/dist/pixi.mjs","three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/","lottie-web":"/vendor/lottie-web/build/player/esm/lottie_svg.min.js","@studio/":"/runtime/"}}</script>
<link rel="stylesheet" href="/runtime/stage.css">
<link rel="stylesheet" href="style.css">
</head>
<body>
<div id="stage">
  <div id="cam">
    <div id="card" class="a" data-name="Card">Hello</div>
  </div>
</div>
<script type="module" src="scene.js"></script>
</body>
</html>
`);
fs.writeFileSync(path.join(dir, 'style.css'), `#stage { --stage-bg: #E8F1FF; color: #1F1F20; }
#cam { position: absolute; left: 0; top: 0; width: ${w}px; height: ${h}px; }
#card { left: ${Math.round(w / 2 - 200)}px; top: ${Math.round(h / 2 - 60)}px; width: 400px; height: 120px; border-radius: 20px; background: #fff;
  display: flex; align-items: center; justify-content: center; font: 700 48px/1 -apple-system, system-ui; box-shadow: 0 20px 50px rgba(28, 58, 110, .14); }
`);
fs.writeFileSync(path.join(dir, 'scene.js'), `// ${id} · ${w}x${h} · ${fps} fps
import { gsap } from 'gsap';
import { studio } from '@studio/studio.js';
import { camera } from '@studio/kits/camera.js';

const s = await studio({ id: '${id}', width: ${w}, height: ${h}, fps: ${fps} });
const cam = camera(s, document.getElementById('cam'), {
  start: 'wide',
  views: { wide: { x: ${w / 2}, y: ${h / 2}, zoom: 1 }, close: { x: ${w / 2}, y: ${h / 2}, zoom: 1.6 } },
});

// initial state
gsap.set('#card', { opacity: 0, y: 40 });

// beats: name them; they show up in notes and the probe
s.beat('card.in', { at: 10, dur: 20, ease: 'settle', note: 'Card rises in' },
  (b) => b.fromTo('#card', { opacity: 0, y: 40 }, { opacity: 1, y: 0 }));
s.beat('cam.push', { after: 'card.in', gap: 10, dur: 30, note: 'Push in' }, (b) => cam.to(b, 'close'));

s.ready({ tail: 25 });
`);
console.log(`${PROJECT === ROOT ? `scenes/${id}` : dir} created → http://localhost:5173/editor/#${id}@0`);

const guide = path.join(PROJECT, 'RUN-STUDIO.md');
if (PROJECT !== ROOT && !fs.existsSync(guide)) {
  // paths as seen from where this command was typed, so the guide's commands work from there
  const here = process.env.INIT_CWD || process.cwd();
  const studio = path.relative(here, ROOT) || '.', project = path.relative(here, PROJECT) || '.';
  const q = (p) => (/[\s"]/.test(p) ? JSON.stringify(p) : p);
  const npm = studio === '.' ? 'npm' : `npm --prefix ${q(studio)}`, P = `--project ${q(project)}`;
  const name = path.basename(PROJECT) === 'film' ? path.basename(path.dirname(PROJECT)) : path.basename(PROJECT);
  fs.writeFileSync(guide, `# Run the studio for ${name}

This folder holds the ${name} films: \`scenes/\` (one folder per film), \`notes/\` (the editor's notes and "To check"
lists) and \`out/\` (exports and rendered frames: keep it out of git). The studio itself is \`${studio}\`; its own guide is
its \`RUN-STUDIO.md\`. Run every command below from \`${path.basename(here)}/\`.

## Every time
1. Start the studio for ${name}:
   \`\`\`bash
   ${npm} run dev -- ${P}
   \`\`\`
   It prints \`Motion Studio → http://localhost:5173/editor/ (project: …)\`. Another studio already on 5173? Put
   \`PORT=5174 \` in front. In Claude Code you can also add this command as an entry in \`.claude/launch.json\`.
2. Start the notes watcher, so **▶ Send to Claude** works: in a Claude Code session, say
   > Start the notes watcher for ${name}.

   Claude runs this in the background (it exits when you press Send; Claude works the notes and starts it again):
   \`\`\`bash
   node ${q(path.join(studio, 'tools/wait-for-notes.mjs'))} ${P}
   \`\`\`
3. Open the editor at the address it printed and pick a film at the top.

## Other commands
Every studio command takes the same \`${P}\`:
\`\`\`bash
${npm} run render -- ${id} --frames 0,100 ${P}
${npm} run render -- ${id} ${P}
${npm} run new-scene -- my-next-film ${P}
\`\`\`
Frames go to \`out/<film>-frames/\`, videos to \`out/\`, new films to \`scenes/\`. Check a watcher is running with
\`pgrep -fl wait-for-notes\` (its command line names the project).
`);
  console.log(`${guide} written: how to run the studio and the notes watcher for this project`);
}
