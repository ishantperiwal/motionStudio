# Liquid glass

An Apple-style liquid glass panel: a frosted slab with a curved rim that really refracts what is behind it. Near the
edge the backdrop is pulled inward and magnified, split into faint colour fringes, and the rim catches the light with a
crisp edge line; a soft contact shadow sits under it. It is a WebGL2 fragment shader on its own transparent canvas,
driven by the studio's frame clock, so it renders deterministically and moves, resizes and fades like any other
element. From the Motion Ops film (the glass panel over the scrolling names), where it replaced a CSS/SVG version.
Kit: `runtime/kits/glass.js`. Demo: `demo/` (1920×1080, 25 fps, 150 frames, loops).

## What makes it work
- **A slab, not a lens.** The middle is flat (the backdrop shows through, only frosted); all the bending happens in a
  curved bevel at the rim. That is what reads as a thick sheet of glass rather than a magnifier.
- **Real refraction.** The bevel's slope tilts the surface normal, and light is refracted through it with Snell's law
  and landed a slab-thickness below. The rim pulls the backdrop in and stretches it, so type sliding under the edge
  bends and speeds up, the way it does under thick glass.
- **Per-channel IOR.** Red, green and blue refract with slightly different indices, so the rim has faint colour fringes
  exactly where the bend is strongest, and nowhere else.
- **Light on the rim only.** A fresnel term brightens the rim, strongest on the side facing the light with a weaker catch
  on the opposite side, plus a 1–2 px specular line right at the edge. The face itself stays quiet: milky and frosted.
- **Scales with the slab.** Bevel, thickness and frost are fractions of the slab's short side, so a small chip and a big
  panel look like the same material, and the look holds while the slab changes size.
- **Composites over the page.** Premultiplied alpha: inside the slab, the glass; outside, only its shadow. The page
  underneath must show the same backdrop the shader reads.

## Parts
The shader's passes, per pixel, every frame (there is no timeline of its own: you move and resize the slab with beats).
In the demo: the slab holds wide on the left (0–12), glides right turning tall (`glass.glide`, 12–72, `move`), holds
(72–88), glides back wide (`glass.back`, 88–148, `move`); the names drift ±180 px over the 150-frame loop.

| # | Part | What happens |
|---|---|---|
| 1 | Slab | A rounded-rect SDF in canvas px; the normal's direction comes from the same box with corners at least `1.1 × bevel` round, so the bevel turns corners without a crease |
| 2 | Bevel | A quarter circle `bevel` wide and `thick` high: slope `dh/ds` tilts the normal, 0 in the flat middle |
| 3 | Refraction | `refract()` through the normal at `1 / ior`, offset `r.xy / max(−r.z, 0.2) × thick × 1.6`; once per channel with `ior ± dispersion` |
| 4 | Frost | Each lookup is a 48-tap golden-angle disk of radius `frost`, taps weighted `1 − 0.5·r/frost` |
| 5 | Tint | `mix(col, white, tint) × (1 + tint/4)`: milky, a touch brighter |
| 6 | Light | Fresnel `(1 − N.z)^2.2 × (0.35 + 0.65·facing^1.5 + 0.45·(−facing)^2)` plus an edge line over the outer 2.2 px, both × `rim` |
| 7 | Shadow | Outside the slab: the box offset 10 px down, Gaussian σ 28 px, × `shadow` |
| 8 | Output | Anti-aliased edge (±0.75 device px), premultiplied, × `opacity` |

## Values
The look approved in the film (`GLASS_LOOK` in the kit; "× side" = × the slab's short side):

| Param | Default | |
|---|---|---|
| `bevel` | `0.22` × side | Rim width: how far in from the edge the bending reaches |
| `thick` | `0.16` × side | Slab height: how far the rim moves the backdrop (bigger = stronger pull) |
| `ior` | `1.5` | Index of refraction (green). `1` = no bend |
| `dispersion` | `0.035` | IOR spread between R/G/B: colour fringes. `0` = none |
| `frost` | `7/520` × side | Blur radius (7 px on a 520 px slab). `0` = clear glass |
| `tint` | `0.12` | Milky white mix |
| `light` | `−2.35` rad | Light direction, y-down: from the upper left |
| `rim` | `0.55` | Rim light + edge line strength |
| `shadow` | `0.09` | Contact shadow opacity (offset 10 px, σ 28 px, fixed) |

Shadow offset/softness and the edge line are in stage px (× pixel ratio), so `--scale 2` renders look the same, only
sharper. Demo: ground `#BCD9D2`, grid `#CBE3DD` (7 px lines on a 120 px grid), names Inter 900 150 px `#A3C9C0` on
rows 205 px apart; slab 640×420 ↔ 460×540, radius 84.

## Use it
```js
import { glassKit, stageCanvas, drawSvgText, GLASS_LOOK } from '@studio/kits/glass.js';

const stage = document.getElementById('stage');
const bg = stageCanvas(s, { parent: stage, zIndex: 0, name: 'Backdrop' });   // the page shows it; the glass reads it
const ctx = bg.getContext('2d');
const glass = glassKit(s, { backdrop: bg, zIndex: 5, look: { frost: 0 } });   // look: overrides of GLASS_LOOK

const st = { cx: 620, cy: 540, w: 640, h: 420 };
s.beat('glass.glide', { at: 12, dur: 60, ease: 'move', note: 'Slab glides right' }, (b) => b.fromTo(st, { cx: 620 }, { cx: 1300 }));
s.onFrame((f) => {                                                    // order 0: before the glass draws (order 100)
  ctx.setTransform(bg.pixelRatio, 0, 0, bg.pixelRatio, 0, 0);
  drawMyBackdrop(ctx, f);                                             // stage px
  glass.set({ x: st.cx - st.w / 2, y: st.cy - st.h / 2, w: st.w, h: st.h, r: 84 });
});
```
`glassKit(s, options)` → `{ canvas, gl, state, pixelRatio, set(v), backdrop(next), draw(f) }`.
- `set({ x, y, w, h, r, opacity, ...look })`: place the slab (stage px, `x, y` = top-left, `r` = corner radius, clamped
  to half the short side) and/or change any look param for this frame. Call it from `s.onFrame` (or tween
  `glass.state` directly in a beat). `opacity ≤ 0.001` (or a zero size) hides the canvas.
- `backdrop(next)`: swap the backdrop.

| Option | Default | |
|---|---|---|
| `backdrop` | | What the glass refracts: a canvas (re-uploaded every frame, so redraw it freely), an image (uploaded once) or `(f) => canvas`. It must cover the whole stage, at any resolution |
| `parent` | `#stage` | Where the glass canvas goes |
| `zIndex` | `10` | The glass canvas's z-index: above the backdrop, under whatever should sit on the glass |
| `look` | `GLASS_LOOK` | Overrides of the look params above |
| `pixelRatio` | `devicePixelRatio` (1–2) | Canvas resolution; `--scale 2` renders get a 3840×2160 canvas |
| `order` | `100` | The `s.onFrame` order it draws in: after the scene's hooks |
| `name` | `'Liquid glass'` | The canvas's `data-name` |

`stageCanvas(s, { parent, pixelRatio, zIndex, name })` → a transparent stage-sized canvas (backing store × pixel ratio,
`canvas.pixelRatio` set), for the backdrop. `GLASS_FRAG` / `GLASS_VERT` are exported for a hand-rolled layer.

### The backdrop: a shader can't read the DOM
WebGL only sees textures, so the glass refracts a canvas, not the page. Draw what is behind the glass onto a canvas in
stage space each frame and show that canvas on the page in place of (or exactly over) the DOM it copies; the glass
canvas sits above it. Anything above the glass canvas (cards, labels) is not refracted.
- **Canvas art** (grids, shapes, scrolling text drawn with `fillText`): draw it straight into the backdrop, as the demo
  does.
- **SVG text** kept as the animated source of truth: hide the SVG layer (`visibility: hidden`, so it is still laid out
  and animated) and each frame call `drawSvgText(ctx, textNodes)`. It places every `<text>` with `getCTM()`, takes
  font, weight, size, letter-spacing, fill and anchor from the computed style, multiplies the opacities up to the
  `<svg>`, and applies the nearest CSS `filter` with its px scaled to canvas px (canvas filters work in canvas px, so a
  `blur()` would otherwise shrink as the text scales).
  Limits: the `<svg>` must sit at the stage origin with a stage-px viewBox; one run per `<text>` (no `<tspan>`
  positions, textPath, per-glyph x/y/dx/dy), flat fills only (no gradients/patterns), no strokes, `dominant-baseline`
  and clip-path/mask ignored; the font must be loaded first (`await document.fonts.load(...)`). Anything else in the
  SVG (shapes, images) you draw yourself, the same way: `ctx.setTransform(pr × getCTM())`.
- **Images/video**: `drawImage` them into the backdrop at their stage box.

### Costs
Per frame: one full-canvas `texImage2D` of the backdrop and one full-screen pass whose glass pixels each do 3 × 48
texture lookups (outside the slab it exits early). Measured on the demo in headless Chromium (Apple Silicon), backdrop
drawing included: ~6 ms/frame at 1×, ~30 ms at `--scale 2` (4× the pixels). Frost dominates: `frost: 0` drops the
taps to 3. Large slabs at 2× are the expensive case; renders stay deterministic (the same frames rendered in any order
are byte-identical PNGs).

### Compared with the CSS `backdrop-filter` + SVG displacement approach
The film first built its glass in the DOM: a copy of the backdrop bent by an SVG `feDisplacementMap` (a rim-weighted
map), clipped to the panel, under a `backdrop-filter: blur()` layer and a gradient rim. It needs no canvas copy of the
backdrop, but the bend is a fixed 8-bit map (stepped unless blurred, and rebuilt whenever the panel's shape or radius
changes) and there is no real dispersion or light model: the rim is a painted gradient. The shader bends by the actual
shape every frame, so resizing and corner radius just work, and its fringes and rim light come from the same surface
normal. `scenes/glass-compare` (if you have it) shows the two side by side.

## Avoid
- Showing the DOM version of the backdrop while the glass reads a canvas copy that drifts from it: the glass then
  shows a different picture than its surroundings. Make the canvas the visible backdrop.
- Putting the glass canvas above elements that should sit on top of the glass: z-index it under them.
- Absolute px for bevel/thickness: the look changes as the slab resizes. Keep them as fractions of the short side.
- Strong dispersion or rim: past ~0.06 / ~0.8 it reads as a chromatic-aberration effect and a glowing outline, not glass.
- A lens with no flat middle (bevel ≈ half the side): it turns into a magnifying glass.
- Drawing the backdrop after the glass (a hook with order > 100): the glass refracts last frame's picture.
