// Construct reveal · demo · 1920x1080 · 25 fps · loops
// A sample panel (plain HTML) is built on a dot lattice by runtime/kits/construct.js, a scan reveals the real one, it
// holds, then leaves so the loop starts clean. The parts are measured from the panel itself, so they always line up.
import { studio } from '@studio/studio.js';
import { construct, boxOf } from '@studio/kits/construct.js';

const s = await studio({ id: 'technique-construct-reveal', width: 1920, height: 1080, fps: 25 });
await Promise.all(['500', '600', '700'].map((w) => document.fonts.load(`${w} 20px InterLocal`)));   // text rows are measured from the real text
const $ = (q) => document.querySelector(q), $$ = (q) => [...document.querySelectorAll(q)];

// the two drawn shapes, in stage px (same points as their inline SVGs)
const [ix, iy] = boxOf($('.icon')), [ax, ay] = boxOf($('.arrow'));
const curve = `M${ix + 17},${iy + 45} C${ix + 31},${iy + 45} ${ix + 33},${iy + 19} ${ix + 47},${iy + 19}`;
const arrow = `M${ax + 4},${ay + 12} H${ax + 20} M${ax + 14},${ay + 6} L${ax + 20},${ay + 12} L${ax + 14},${ay + 18}`;

// the outline (CARD) writes first; each part starts 3 frames after the last, so the bracket finishes each jump
const build = construct(s, {
  reveal: $('#card'), label: 'CARD', name: 'card', at: 8, scan: 18,
  parts: [
    { label: 'ICON', at: 3, circles: $('.icon'), paths: curve },
    { label: 'TEXT', at: 6, rows: [$('.title'), $('.sub')], step: 1 },
    { label: 'LIST', at: 9, rect: $('.list'), rows: $$('.nm'), circles: $$('.sw'), step: 0.6 },
    { label: 'BUTTON', at: 13, rect: $('.btn'), rows: $('.lbl'), paths: arrow },
  ],
});

s.beat('card.out', { at: build.end + 54, dur: 14, ease: 'exit', note: 'After a hold the panel leaves, so the loop starts on an empty frame' },
  (b) => b.fromTo('#card', { opacity: 1, y: 0 }, { opacity: 0, y: 24 }));

s.ready({ tail: 8 });
