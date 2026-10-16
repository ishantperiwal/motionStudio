// Glossy shine · demo · 1920x1080 · 25 fps · loops
// The back of the Motion Ops card (flat, still) and runtime/kits/shine.js: light passes over it once at an even pace,
// the print and the frame catch it, the printed ✦ twinkles as the light's centre crosses it, then a hold. The light
// starts and ends fully off the card, so the first and last frames match and it loops cleanly.
import { studio } from '@studio/studio.js';
import { shine } from '@studio/kits/shine.js';

const s = await studio({ id: 'technique-glossy-shine', width: 1920, height: 1080, fps: 25 });
const card = document.querySelector('#card');
await card.querySelector('img').decode();   // the sheen copies the art's box, so let it load first

const K = 588 / 420;   // the film's card was 420 px wide; these are its values scaled to this one
shine(s, {
  el: card, at: 14, dur: 50,              // 2 s, linear
  frame: 17 * K,                          // the gradient frame ring
  sparkles: [[357 * K, 270 * K]],         // the printed ✦ after "Design"
  sparkleSize: 120 * K,
  name: 'card',
});

s.ready({ tail: 30 });
