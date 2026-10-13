// PixiJS (WebGL) layer driven by the master clock: its own ticker never runs;
// the stage is re-rendered after every seek, so frames stay deterministic.
//   const px = await pixiLayer(s, { parent: stageEl, zIndex: 5 });
//   px.app.stage.addChild(sprite);  s.onFrame((f) => { sprite.x = ...; });
import * as PIXI from 'pixi.js';

export async function pixiLayer(s, { parent, width = s.width, height = s.height, zIndex = 0, resolution = 1 } = {}) {
  const app = new PIXI.Application();
  await app.init({ width, height, backgroundAlpha: 0, antialias: true, autoStart: false, sharedTicker: false, resolution, preference: 'webgl', preserveDrawingBuffer: true });
  app.ticker.stop();
  Object.assign(app.canvas.style, { position: 'absolute', left: 0, top: 0, width: width + 'px', height: height + 'px', zIndex, pointerEvents: 'none' });
  app.canvas.dataset.name = 'Pixi layer';
  (parent || document.getElementById('stage')).appendChild(app.canvas);
  s.onFrame(() => app.render(), 100);   // after every other hook has updated display objects
  return { PIXI, app };
}
