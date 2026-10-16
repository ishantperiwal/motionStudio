// Liquid glass · demo · 1920x1080 · 25 fps · 6 s · loops
// The Motion Ops film's aqua backdrop (a 120 px grid and rows of big names drifting in alternate directions) and
// runtime/kits/glass.js: one glass slab glides from left to right and back, changing shape as it goes (wide → tall →
// wide), so the rim's refraction, colour fringes and light are seen over moving type. The backdrop is drawn on a canvas
// each frame (the page shows that canvas; the glass refracts it). Everything is a pure function of the frame, and the
// first and last frames match, so it loops cleanly.
import { studio } from '@studio/studio.js';
import { glassKit, stageCanvas } from '@studio/kits/glass.js';

const s = await studio({ id: 'technique-liquid-glass', width: 1920, height: 1080, fps: 25 });
const W = 1920, H = 1080, LOOP = 150;
const C = { ground: '#BCD9D2', grid: '#CBE3DD', name: '#A3C9C0' };

// ---- the backdrop: grid + rows of names, drawn on a canvas in the stage (the glass reads the same canvas)
const ROWS = [
  'Ease In · Spring · Gentle · Standard · Snappy · ease-out · Sine.inOut · ',
  'Linear · Bouncy · Quick · Emphasized · cubic-bezier(.4, 0, .2, 1) · ',
  'Custom · FastOutSlowIn · Ease Out · Anticipate · moving → slow · ',
  'a bit snappier? · feels sluggish · can it settle softer? · too bouncy · ',
  'Power2.out · easeInOutCubic · Overshoot · Decelerate · Elastic · ',
];
const bg = stageCanvas(s, { parent: document.getElementById('stage'), zIndex: 0, name: 'Backdrop (grid + names)' });
const g = bg.getContext('2d'), D = bg.pixelRatio;
function drawBackdrop(f) {
  g.setTransform(D, 0, 0, D, 0, 0);
  g.fillStyle = C.ground; g.fillRect(0, 0, W, H);
  g.fillStyle = C.grid; for (let x = -3.5; x < W; x += 120) g.fillRect(x, 0, 7, H); for (let y = -3.5; y < H; y += 120) g.fillRect(0, y, W, 7);
  g.fillStyle = C.name; g.font = '900 150px InterLocal'; g.textBaseline = 'alphabetic';
  const drift = 180 * Math.sin((2 * Math.PI * f) / LOOP);   // the rows slide past each other and back over the loop
  ROWS.forEach((row, i) => {
    const w = g.measureText(row).width, dir = i % 2 ? 1 : -1, x = ((dir * drift + i * 377) % w + w) % w - w;
    for (let k = 0; k < 4; k++) g.fillText(row, x + k * w, 200 + i * 205);
  });
}

// ---- the glass: one slab, its centre and size tweened by beats (stage px)
const glass = glassKit(s, { backdrop: bg, zIndex: 2, name: 'Liquid glass' });
const A = { cx: 620, cy: 540, w: 640, h: 420 }, B = { cx: 1300, cy: 540, w: 460, h: 540 };
const st = { ...A };
s.beat('glass.glide', { at: 12, dur: 60, ease: 'move', note: 'The slab glides right over the names, turning from wide to tall' },
  (b) => b.fromTo(st, { ...A }, { ...B }));
s.beat('glass.back', { after: 'glass.glide', gap: 16, dur: 60, ease: 'move', note: 'Holds, then glides back, wide again (loops)' },
  (b) => b.fromTo(st, { ...B }, { ...A }));
s.onFrame((f) => {
  drawBackdrop(f);
  glass.set({ x: st.cx - st.w / 2, y: st.cy - st.h / 2, w: st.w, h: st.h, r: 84 });
});

await document.fonts.load('900 150px InterLocal');
s.ready({ tail: 1 });
