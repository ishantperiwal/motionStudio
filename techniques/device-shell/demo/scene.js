// Device shell · demo · 1920x1080 · 25 fps · loops
// runtime/kits/device.js on its own: the phone turns one full revolution under a fixed three-quarter camera, so you
// see the front, the edge with its buttons, the back with the raised camera island, and the front again. Starts and
// ends on the same pose, so it loops cleanly.
import { studio } from '@studio/studio.js';
import { device } from '@studio/kits/device.js';

const s = await studio({ id: 'technique-device-shell', width: 1920, height: 1080, fps: 25 });
const phone = device({ parent: document.getElementById('stage'), name: 'Phone' });
phone.screen.innerHTML = `<div class="ui"><div class="time">9:41</div><div class="head"></div><div class="num">₹2,430</div>
  <div class="btn"></div>${[270, 346, 422, 498].map((t) => `<div class="row" style="top:${t}px"></div>`).join('')}</div>`;

// the camera: orthographic three-quarter view, a little smaller than life
phone.world.style.transform = 'scale(1.05) rotateX(22deg) rotateZ(-14deg) rotateY(10deg)';

s.beat('phone.turn', { at: 18, dur: 110, ease: [0.65, 0, 0.35, 1], note: 'One full turn: front → edge → back → front' },
  (b) => b.fromTo(phone.el, { rotationY: 0 }, { rotationY: 360 }));

await document.fonts.load('800 52px Inter').catch(() => {});
s.ready({ tail: 22 });
