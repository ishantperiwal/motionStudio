// npm run new-scene -- <id> [--size 1920x1080] [--fps 25]
// Creates scenes/<id>/ with the import map, a stage, and a starter scene.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const id = argv[0];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
if (!id || !/^[\w.-]+$/.test(id)) { console.log('usage: npm run new-scene -- <id> [--size 1920x1080] [--fps 25]'); process.exit(1); }
const dir = path.join(ROOT, 'scenes', id);
if (fs.existsSync(dir)) { console.error(`scenes/${id} already exists`); process.exit(1); }
const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const fps = +opt('fps', 25);

fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${id}</title>
<script type="importmap">{"imports":{"gsap":"/vendor/gsap/index.js","gsap/":"/vendor/gsap/","roughjs":"/vendor/roughjs/bundled/rough.esm.js","pixi.js":"/vendor/pixi.js/dist/pixi.mjs","three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/","@studio/":"/runtime/"}}</script>
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
console.log(`scenes/${id} created → http://localhost:5173/editor/#${id}@0`);
