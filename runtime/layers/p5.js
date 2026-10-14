// p5.js layer driven by the master clock: p5's own loop never runs (noLoop); the sketch is redrawn after
// every seek with the scene frame, and random/noise are seeded, so frames stay deterministic.
//   const sk = await p5Layer(s, {
//     setup: (p) => { p.noStroke(); },
//     draw: (p, f) => { p.clear(); p.circle(200 + f * 4, 300, 80); },   // draw from f, never from p.frameCount
//   });
let loading;
const loadP5 = () => (window.p5 ? Promise.resolve(window.p5) : (loading ||= new Promise((ok, fail) => {
  const tag = document.createElement('script');
  tag.src = '/vendor/p5/lib/p5.min.js';
  tag.onload = () => ok(window.p5); tag.onerror = fail;
  document.head.appendChild(tag);
})));

export async function p5Layer(s, { parent, setup, draw, width = s.width, height = s.height, zIndex = 0, seed = 1, renderer } = {}) {
  const P5 = await loadP5();
  let inst;
  await new Promise((ready) => {
    inst = new P5((p) => {
      p.setup = () => {
        const c = p.createCanvas(width, height, renderer === 'webgl' ? p.WEBGL : p.P2D);
        Object.assign(c.elt.style, { position: 'absolute', left: 0, top: 0, zIndex, pointerEvents: 'none' });
        c.elt.dataset.name = 'p5 layer';
        p.pixelDensity(1); p.noLoop();
        setup?.(p);
        ready();
      };
      p.draw = () => {};   // drawing happens in the frame hook below
    }, parent || document.getElementById('stage'));
  });
  s.onFrame((f) => {
    inst.randomSeed(seed); inst.noiseSeed(seed);   // same frame, same randomness
    draw?.(inst, f);
  }, 100);   // after other hooks have updated shared state
  return inst;
}
