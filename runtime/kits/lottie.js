// Lottie, stepped by the master clock: the animation never plays on its own; each frame is set from the
// scene's frame, so preview and export match.
//   const waves = await lottieKit(s, { container: el, path: 'assets/waves.json', loop: true });
//   const pop = await lottieKit(s, { container: el2, path: 'assets/pop.json', at: 120 });   // starts at frame 120, holds its last frame
import lottie from 'lottie-web';

export async function lottieKit(s, { container, path, animationData, at = 0, speed = 1, loop = false, renderer = 'svg', fit = 'xMidYMid meet' }) {
  const anim = lottie.loadAnimation({ container, renderer, loop: false, autoplay: false, path, animationData,
    rendererSettings: { preserveAspectRatio: fit } });
  if (!anim.isLoaded) await new Promise((ok) => anim.addEventListener('DOMLoaded', ok));
  const fr = anim.frameRate, last = anim.totalFrames - 1;
  s.onFrame((f) => {
    const t = ((f - at) / s.fps) * fr * speed;   // scene frames → Lottie frames
    const k = t < 0 ? 0 : loop ? t % anim.totalFrames : Math.min(t, last);
    anim.goToAndStop(k, true);
  });
  return anim;
}
