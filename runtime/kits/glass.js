// Liquid glass: an Apple-style glass slab over the scene that refracts what is behind it. A WebGL2 fragment shader on a
// transparent canvas of its own, driven by the studio clock (it draws in a late s.onFrame hook; no loop of its own).
// From the Motion Ops film (the glass panel over the scrolling names) and its glass-compare test scene.
//   1 slab        a rounded rect in stage px (x, y = top-left, w, h, r), set per frame; flat in the middle
//   2 bevel       a quarter-circle rim `bevel` wide and `thick` high: its slope tilts the surface normal near the edge
//   3 refraction  Snell's law through that normal, landing `thick` below the surface: the rim pulls the backdrop inward
//                 and magnifies it; once per colour channel with the IOR spread by `dispersion` (colour fringes)
//   4 frost       a 48-tap golden-angle disk blur of radius `frost` on every lookup
//   5 tint        a milky white mix (`tint`), a touch brighter
//   6 light       fresnel brightening toward the rim, strongest where the rim faces `light` (and a weaker catch on the
//                 opposite side), plus a crisp 1–2 px specular line right at the edge (`rim`)
//   7 shadow      a tight, soft contact shadow under the slab (`shadow`), only outside it
// Output is premultiplied alpha, so the canvas composites over the page: inside the slab the refracted glass, outside it
// only the shadow. A shader can't read the DOM: the glass sees a *backdrop*, a canvas (or image) holding what is behind
// it in stage space. Draw it each frame (see drawSvgText below for SVG text) and keep the page showing the same thing.
// The approach (SDF slab + bevel normal + per-channel Snell refraction + fresnel rim) follows the common "liquid glass"
// shader recipe popularised by Apple's 2025 Liquid Glass material; this implementation is the studio's own.
//
//   import { glassKit, stageCanvas } from '@studio/kits/glass.js';
//   const bg = stageCanvas(s, { parent: stage, name: 'Backdrop' });          // what's behind the glass, also shown on the page
//   const glass = glassKit(s, { backdrop: bg, zIndex: 5 });
//   const st = { x: 400, y: 300, w: 560, h: 420 };                          // tween this with beats
//   s.beat('glass.glide', { at: 10, dur: 50, ease: 'move', note: '…' }, (b) => b.fromTo(st, { x: 400 }, { x: 960 }));
//   s.onFrame((f) => { drawMyBackdrop(bg, f); glass.set({ ...st, r: 80 }); });   // runs before the glass (order 100)
//   // → { canvas, gl, state, pixelRatio, set(v), draw(f) }

/** The look the user approved in the film. bevel, thick and frost are fractions of the slab's short side. */
export const GLASS_LOOK = {
  bevel: 0.22,          // rim width (× short side)
  thick: 0.16,          // slab height above the backdrop (× short side): how far the rim bends the light
  ior: 1.5,             // index of refraction (green); 1 = no bend
  dispersion: 0.035,    // IOR spread between R/G/B: colour fringes in the rim
  frost: 7 / 520,       // blur radius (× short side): 7 px on a 520 px slab
  tint: 0.12,           // milky white mix, 0–1
  light: -2.35,         // light direction, radians, y-down (−2.35 ≈ from the upper left)
  rim: 0.55,            // fresnel rim light + edge line strength
  shadow: 0.09,         // contact shadow opacity
};

export const GLASS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRes;
uniform vec2 uCenter, uHalf; uniform float uRadius, uBevel, uThick, uIor, uDisp, uFrost, uTint, uLight, uRim, uShadow, uOpacity, uDpr;
out vec4 o;
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
vec3 tex(vec2 px) { return texture(uTex, clamp(px / uRes, vec2(0.), vec2(1.))).rgb; }
// frosted lookup: a golden-angle disk of taps (blur radius uFrost px)
vec3 frosted(vec2 px) {
  if (uFrost < 0.5) return tex(px);
  vec3 acc = vec3(0.); float wsum = 0.;
  for (int i = 0; i < 48; i++) { float fi = float(i) + .5, r = sqrt(fi / 48.) * uFrost, a = fi * 2.39996323;   // 48 taps: smooth at a strong frost
    float w = 1. - .5 * (r / uFrost); acc += tex(px + r * vec2(cos(a), sin(a))) * w; wsum += w; }
  return acc / wsum;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);          // canvas px, y down
  vec2 lp = p - uCenter;
  float d = sdBox(lp, uHalf, uRadius);                              // < 0 inside the glass
  // outward normal of the shape (from the SDF's gradient). Its direction comes from the same box with corners at least
  // as round as the bevel is wide: its contours turn the corners smoothly, where the exact box's would meet along the
  // diagonal and crease the surface
  vec2 e = vec2(.75, 0.);
  float rn = max(uRadius, uBevel * 1.1);
  vec2 n2 = normalize(vec2(sdBox(lp + e.xy, uHalf, rn) - sdBox(lp - e.xy, uHalf, rn), sdBox(lp + e.yx, uHalf, rn) - sdBox(lp - e.yx, uHalf, rn)) + 1e-6);
  // soft shadow under the slab (outside it); offset and softness in stage px (× uDpr), so it looks the same at any scale
  float sd = sdBox(lp - vec2(0., 10. * uDpr), uHalf, uRadius), sg = 28. * uDpr;
  float shadow = uShadow * exp(-max(sd, 0.) * max(sd, 0.) / (2. * sg * sg)) * step(0., d);   // a tight, soft contact shadow
  if (d > 1.) { o = vec4(0., 0., 0., shadow) * uOpacity; return; }   // outside: just the shadow, over the page
  // the bevel: a quarter circle across uBevel px in from the edge; its slope tilts the surface normal
  float s = max(-d, 0.), t = clamp(s / uBevel, 0., 1.), u = 1. - t;
  float slope = (uThick / uBevel) * u / sqrt(max(1. - u * u, 1e-3));   // dh/ds of h = thick * sqrt(1 - u^2)
  vec3 N = normalize(vec3(n2 * slope, 1.));                         // the surface normal, facing the viewer
  // refraction through the slab, per colour channel (dispersion), landing uThick below the surface
  vec3 col;
  for (int c = 0; c < 3; c++) {
    float ior = uIor + (float(c) - 1.) * uDisp;
    vec3 r = refract(vec3(0., 0., -1.), N, 1. / ior);
    vec2 off = r.xy / max(-r.z, .2) * uThick * 1.6;
    col[c] = frosted(p + off)[c];
  }
  col = mix(col, vec3(1.), uTint) * (1. + uTint * .25);              // milky white tint, a touch brighter
  // light: fresnel brightening toward the rim, strongest where the rim faces the light (and its opposite catch)
  vec2 L = vec2(cos(uLight), sin(uLight));
  float fres = pow(1. - N.z, 2.2);
  float facing = dot(n2, L);
  float rim = fres * (.35 + .65 * pow(max(facing, 0.), 1.5) + .45 * pow(max(-facing, 0.), 2.));
  float edge = smoothstep(2.2 * uDpr, 0., s) * (.55 + .45 * abs(facing));   // a crisp 1-2 stage px specular line at the edge
  col += uRim * (rim * .9 + edge * .8);
  col = min(col, vec3(1.));
  float a = 1. - smoothstep(-.75, .75, d);                          // anti-aliased edge (device px)
  o = vec4(col * a, a + shadow * (1. - a)) * uOpacity;            // premultiplied
}`;
export const GLASS_VERT = `#version 300 es
in vec2 pos; void main() { gl_Position = vec4(pos, 0., 1.); }`;

const devicePR = () => Math.max(1, Math.min(2, window.devicePixelRatio || 1));   // a sharp canvas at --scale 2 too

/** A transparent stage-sized canvas (CSS = stage px, backing store × pixelRatio), for a backdrop. Draw on it in stage
 *  px after ctx.setTransform(pr, 0, 0, pr, 0, 0) (`canvas.pixelRatio` holds pr). Added to `parent` if given. */
export function stageCanvas(s, { parent, pixelRatio = devicePR(), zIndex, name } = {}) {
  const c = document.createElement('canvas');
  c.width = Math.round(s.width * pixelRatio); c.height = Math.round(s.height * pixelRatio); c.pixelRatio = pixelRatio;
  Object.assign(c.style, { position: 'absolute', left: 0, top: 0, width: s.width + 'px', height: s.height + 'px', pointerEvents: 'none' });
  if (zIndex !== undefined) c.style.zIndex = zIndex;
  if (name) c.dataset.name = name;
  if (parent) parent.appendChild(c);
  return c;
}

export function glassKit(s, o = {}) {
  const { zIndex = 10, pixelRatio = devicePR(), name = 'Liquid glass', order = 100 } = o;
  const W = s.width, H = s.height, D = pixelRatio;
  let backdrop = o.backdrop;
  const state = { x: 0, y: 0, w: 0, h: 0, r: 0, opacity: 1, ...GLASS_LOOK, ...(o.look || {}) };

  const canvas = stageCanvas(s, { parent: o.parent || document.getElementById('stage'), pixelRatio: D, zIndex, name });
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: true, antialias: false });
  if (!gl) throw new Error('glassKit: WebGL2 is not available');
  const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error('glassKit: ' + gl.getShaderInfoLog(x)); return x; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, GLASS_VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, GLASS_FRAG)); gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'pos'); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]].forEach(([k, v]) => gl.texParameteri(gl.TEXTURE_2D, k, v));
  const U = {}; const loc = (n) => (U[n] ??= gl.getUniformLocation(prog, n));
  let uploadedStill = null;

  function draw(f) {
    const st = state;
    if (st.opacity <= 0.001 || st.w <= 0 || st.h <= 0) { canvas.style.display = 'none'; return; }
    canvas.style.display = '';
    // this frame's backdrop (it covers the whole stage at any resolution; the shader samples it in stage space)
    const src = typeof backdrop === 'function' ? backdrop(f) : backdrop;
    if (src && !(src instanceof HTMLImageElement && src === uploadedStill)) {   // a still image goes up once; canvases every frame
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      uploadedStill = src instanceof HTMLImageElement ? src : null;
    }
    const m = Math.min(st.w, st.h), r = Math.max(0, Math.min(st.r, st.w / 2, st.h / 2));   // the shader works in canvas px
    gl.uniform1i(loc('uTex'), 0);
    gl.uniform2f(loc('uRes'), W * D, H * D); gl.uniform2f(loc('uCenter'), (st.x + st.w / 2) * D, (st.y + st.h / 2) * D);
    gl.uniform2f(loc('uHalf'), st.w / 2 * D, st.h / 2 * D); gl.uniform1f(loc('uRadius'), r * D);
    gl.uniform1f(loc('uBevel'), Math.max(m * st.bevel, 0.5) * D); gl.uniform1f(loc('uThick'), m * st.thick * D);
    gl.uniform1f(loc('uIor'), st.ior); gl.uniform1f(loc('uDisp'), st.dispersion); gl.uniform1f(loc('uFrost'), m * st.frost * D);
    gl.uniform1f(loc('uTint'), st.tint); gl.uniform1f(loc('uLight'), st.light); gl.uniform1f(loc('uRim'), st.rim);
    gl.uniform1f(loc('uShadow'), st.shadow); gl.uniform1f(loc('uOpacity'), Math.min(1, st.opacity)); gl.uniform1f(loc('uDpr'), D);
    gl.viewport(0, 0, W * D, H * D); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  s.onFrame(draw, order);   // late: after the scene's own hooks have drawn the backdrop and placed the slab

  const api = {
    canvas, gl, state, pixelRatio: D,
    /** Place the slab and/or change the look for this frame: { x, y, w, h, r, opacity, ...GLASS_LOOK keys }, stage px. */
    set(v) { Object.assign(state, v); return api; },
    /** Swap the backdrop (canvas, image, or (f) => canvas). */
    backdrop(next) { backdrop = next; uploadedStill = null; return api; },
    draw,
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------------------
// drawSvgText(ctx, nodes, opts): draw SVG <text> elements into a 2D canvas where the page shows them, so the glass can
// refract DOM type. For each text: getCTM() places it (its full transform chain up to its <svg>), the computed style
// gives font, size, weight, style, letter-spacing, fill and text-anchor, the opacities of it and its ancestors (up to
// the <svg>) multiply, and the nearest CSS `filter` (e.g. blur(4px)) is applied with its px lengths scaled to canvas px
// (canvas filters work in canvas px, so a blur would otherwise shrink as the text scales). Hidden text (visibility:
// hidden) is still drawn: the usual setup keeps the SVG as the laid-out, animated source of truth, hides it, and the
// backdrop canvas shows it instead.
// Limits: the <svg> must sit at the stage origin with viewBox = stage px (getCTM is relative to its nearest viewport);
// textContent is drawn as one run (no <tspan> positions, textPath, per-glyph x/y or dx/dy), fills are flat colours (no
// gradients/patterns), no strokes, dominant-baseline is ignored (alphabetic), clip-path/mask are ignored, and the font
// must already be loaded (await document.fonts.load) or the canvas draws the fallback. display: none text is skipped.
//   opts: { pixelRatio = ctx.canvas.pixelRatio || 1, root = the text's ownerSVGElement (where opacity/filter lookups stop) }
const pxScale = (str, k) => str.replace(/(-?\d*\.?\d+)px/g, (_, v) => `${(+v * k).toFixed(2)}px`);
export function drawSvgText(ctx, nodes, opts = {}) {
  const D = opts.pixelRatio ?? ctx.canvas.pixelRatio ?? 1;
  ctx.save();
  for (const t of nodes) {
    const M = t.getCTM(); if (!M) continue;
    const root = opts.root || t.ownerSVGElement;
    let alpha = 1, filter = '';
    for (let n = t; n && n !== root; n = n.parentNode) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none') { alpha = 0; break; }
      alpha *= +cs.opacity;
      if (!filter && cs.filter && cs.filter !== 'none') filter = cs.filter;
    }
    if (alpha <= 0.001) continue;
    const cs = getComputedStyle(t);
    ctx.setTransform(D * M.a, D * M.b, D * M.c, D * M.d, D * M.e, D * M.f);
    ctx.globalAlpha = alpha * (+cs.fillOpacity || 1);
    ctx.filter = filter ? pxScale(filter, Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)) * D) : 'none';
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    const anchor = cs.textAnchor;
    ctx.textAlign = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = cs.fill.startsWith('url') ? '#000' : cs.fill;
    ctx.fillText(t.textContent, +(t.getAttribute('x') || 0), +(t.getAttribute('y') || 0));
  }
  ctx.restore();
}
