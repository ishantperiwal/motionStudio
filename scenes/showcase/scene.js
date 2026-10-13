// Showcase: an Affinity SVG menu (DOM), a PixiJS particle burst and a Three.js
// extruded envelope, all driven by one master clock. 1920x1080 · 25 fps.
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { studio } from '@studio/studio.js';
import { rng } from '@studio/ease.js';
import { cursor } from '@studio/kits/cursor.js';
import { loadSvg } from '@studio/kits/svg.js';
import { pixiLayer } from '@studio/layers/pixi.js';
import { threeLayer } from '@studio/layers/three.js';

gsap.registerPlugin(SplitText);
const s = await studio({ id: 'showcase', width: 1920, height: 1080, fps: 25 });
const stage = document.getElementById('stage');

// ---------------------------------------------------------------- Three.js: envelope extruded from SVG
const t3 = threeLayer(s, { parent: stage, zIndex: 1 });
const { THREE } = t3;
t3.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-300, 500, 800); t3.scene.add(key);
const envelopeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 86">
  <path id="body" fill="#2170F4" d="M14 0h92a14 14 0 0 1 14 14v58a14 14 0 0 1-14 14H14A14 14 0 0 1 0 72V14A14 14 0 0 1 14 0Z"/>
  <path id="flap" fill="#FFFFFF" d="M12 14 60 48 108 14 108 28 60 62 12 28Z"/></svg>`;
const svgData = new SVGLoader().parse(envelopeSvg);
const env = new THREE.Group(), spin = new THREE.Group(), float = new THREE.Group();
svgData.paths.forEach((p, i) => {
  const geo = new THREE.ExtrudeGeometry(SVGLoader.createShapes(p), { depth: i === 0 ? 22 : 6, bevelEnabled: true, bevelSize: 2, bevelThickness: 2, bevelSegments: 4 });
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.35, metalness: 0.05 }));
  mesh.position.z = i === 0 ? 0 : 24;
  env.add(mesh);
});
env.scale.set(2.4, -2.4, 2.4);            // SVG y points down
env.position.set(-60 * 2.4, 43 * 2.4, 0); // centre the 120x86 artwork
spin.add(env); float.add(spin); t3.scene.add(float);
float.position.set(-300, -60, 0);
s.onFrame((f) => { float.position.y = -60 + Math.sin(f / 18) * 8; float.rotation.x = Math.sin(f / 30) * 0.08; });

// ---------------------------------------------------------------- DOM: Affinity SVG menu
const art = await loadSvg('./assets/assign-menu.svg', { into: document.getElementById('menu'), width: 550 });
const scale = 550 / 1100;
const members = ['Member – Ishant', 'Member – Priya', 'Member – Rohan', 'Member – Mei', 'Menu Divider', 'Member – Assign to me', 'Unassigned Option'].map((n) => art.get(n));
const surface = art.get('Menu Surface'), header = art.get('Menu Header'), selBg = art.get('Selected BG');
const rowOf = (n) => art.get(n).getBoundingClientRect();
const meiRow = rowOf('Member – Mei'), ishRow = rowOf('Member – Ishant');
gsap.set(surface, { transformOrigin: '50% 0%' });

// ---------------------------------------------------------------- PixiJS: particle burst
const px = await pixiLayer(s, { parent: stage, zIndex: 20 });
const r = rng(42), COLORS = [0x2170F4, 0xF2711C, 0x2FA84F, 0x8B5CF6, 0xF3AD5E];
const parts = Array.from({ length: 46 }, () => {
  const g = new px.PIXI.Graphics().circle(0, 0, 4 + r() * 6).fill(COLORS[Math.floor(r() * COLORS.length)]);
  px.app.stage.addChild(g);
  const a = -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.4, v = 380 + r() * 520;
  return { g, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9 + r() * 0.8, spin: (r() - 0.5) * 8 };
});

// ---------------------------------------------------------------- cursor
const P = cursor(document.getElementById('cursors'), { name: 'Priya', from: '#FFB26B', to: '#F2711C', x: 1980, y: 1160 }).tilt(s);

// ---------------------------------------------------------------- initial state
const split = new SplitText('#title', { type: 'chars' });
gsap.set(split.chars, { opacity: 0, y: 30 });
gsap.set('#sub', { opacity: 0, y: 10 });
gsap.set([surface, header], { opacity: 0 });
gsap.set(members, { opacity: 0, y: 40 });
spin.scale.set(0.001, 0.001, 0.001);
parts.forEach((p) => { p.g.visible = false; });

// ---------------------------------------------------------------- beats
s.beat('title.in', { at: 0, dur: 16, stagger: 1, ease: 'settle', note: 'Title cascades in per character (GSAP SplitText)' },
  (b) => b.each(split.chars, { opacity: 0, y: 30 }, { opacity: 1, y: 0 }));
s.beat('title.sub', { after: 'title.in', overlap: 0.4, dur: 18, ease: 'fade' }, (b) => b.fromTo('#sub', { opacity: 0, y: 10 }, { opacity: 1, y: 0 }));
s.beat('env.enter', { at: 6, dur: 34, ease: 'overshoot', note: 'Three.js envelope (extruded from SVG) pops in' }, (b) => {
  b.fromTo(spin.scale, { x: 0.001, y: 0.001, z: 0.001 }, { x: 1, y: 1, z: 1 });
  b.fromTo(spin.rotation, { y: -1.6 }, { y: 0.35 }, { ease: 'move', dur: 44 });
});
s.beat('menu.open', { at: 22, dur: 18, ease: 'snap', note: 'Affinity menu surface grows from the top' }, (b) => {
  b.fromTo(surface, { opacity: 0, scaleY: 0.4 }, { opacity: 1, scaleY: 1 });
  b.fromTo(header, { opacity: 0 }, { opacity: 1 }, { at: 6, dur: 10, ease: 'fade' });
});
s.beat('menu.items', { after: 'menu.open', overlap: 0.5, dur: 16, stagger: 3, ease: 'settle', note: 'Members cascade in' },
  (b) => b.each(members, { opacity: 0, y: 40 }, { opacity: 1, y: 0 }));
s.beat('cursor.in', { at: 70, dur: 26, note: 'Priya heads for Mei' }, (b) => P.move(b, meiRow.right - 70, meiRow.top + meiRow.height * 0.55));
s.beat('menu.pick', { after: 'cursor.in', gap: 3, dur: 16, ease: 'overshoot', note: 'Selection slides to Mei with follow-through' }, (b) => {
  P.click(b);
  b.fromTo(selBg, { y: 0 }, { y: (meiRow.top - ishRow.top) / scale }, { at: 2 });
});
s.beat('burst', { with: 'menu.pick', offset: 2, dur: 40, params: { gravity: { value: 1400, min: 0, max: 3000, step: 50 }, spread: { value: 1, min: 0.2, max: 2, step: 0.05 } }, note: 'PixiJS particles, computed from the clock' },
  (b) => b.track(px.app.canvas));
s.beat('env.react', { with: 'menu.pick', offset: 3, dur: 22, ease: 'settle', note: 'Envelope reacts to the pick' }, (b) => {
  b.fromTo(spin.scale, { x: 1, y: 1, z: 1 }, { x: 1.12, y: 1.12, z: 1.12 }, { dur: 6, ease: 'snap' });
  b.fromTo(spin.scale, { x: 1.12, y: 1.12, z: 1.12 }, { x: 1, y: 1, z: 1 }, { at: 6, dur: 16 });
  b.fromTo(spin.rotation, { y: 0.35 }, { y: 0.35 + Math.PI * 2 }, { dur: 22, ease: 'move' });
});
s.beat('cursor.out', { at: 140, dur: 22, ease: 'exit' }, (b) => { P.move(b, 1980, 1200); P.fade(b, 1, 0, { at: 4, dur: 16, ease: 'fade' }); });

const B = s.beats;
const origin = { x: meiRow.right - 70, y: meiRow.top + meiRow.height * 0.55 };
s.onFrame((f) => {
  const bt = B['burst'], t = (f - bt.f0) / s.fps, g = bt.params.gravity.value, k = bt.params.spread.value;
  for (const p of parts) {
    const on = t >= 0 && t <= p.life;
    p.g.visible = on;
    if (!on) continue;
    p.g.x = origin.x + p.vx * k * t;
    p.g.y = origin.y + p.vy * k * t + 0.5 * g * t * t;
    p.g.alpha = 1 - t / p.life;
    p.g.rotation = p.spin * t;
    p.g.scale.set(1 - 0.5 * (t / p.life));
  }
});

s.ready({ tail: 20 });
