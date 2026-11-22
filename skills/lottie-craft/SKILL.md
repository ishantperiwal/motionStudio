# Lottie Craft — Rules for Production iOS & Android Animations

Follow these rules whenever creating, editing, or reviewing a Lottie composition (`scenes/<id>/comp.json`) in Motion Studio.

## 1. Anti-Bake & Mobile Parity (iOS / Android)
- **Minimal keyframes only (2–4 per move):** Never bake 60fps dense keyframes. Compute exact cubic-bezier tangent handles (`o` and `i`) with `x ∈ [0, 1]`.
- **Separated X/Y Position (`s: true`):** Always use separated `x` and `y` tracks for springs and overshoot so `lottie-ios` and `lottie-android` match `lottie-web` identically.
- **Zero JS expressions:** Never emit `x` expression fields — they are ignored on iOS and Android.
- **Design system tokens first:** Read `tokens/motion.json` (`ease`, `springs`, `durationScaleMs`, `overshootLimit`) before choosing custom numbers.

## 2. SVG Authoring & Layer Discipline
- **Explicit geometric anchors:** Each top-level `<g id="...">` becomes a named Lottie layer centered on its own bounding box. Name layers semantically (`coin-front`, `coin-back`, `coin-rim`, `coin-edge`, `badge-glow`).
- **Gradients:** Native `<linearGradient>` and `<radialGradient>` compile directly to Lottie `gf` gradient fills (supported on iOS, Android, and Web).
- **Paint order:** SVG `<g>` children paint bottom-to-top (last child on top). The compiler automatically reverses child order into Lottie's `gr.it[]` top-down order.
- **Ambient glows & blurs (Filter-to-Raster):**
  - For soft ambient glows, use **pure `<feGaussianBlur stdDeviation="..."/>`** — NEVER merge `SourceGraphic` back on top of an ambient glow or it will paint a hard-edged solid shape over the blur.
  - Set filter bounds wide enough (`x="-80%" y="-80%" width="260%" height="260%"`) so the raster baker captures full blur bleed with zero box clipping.

## 3. Geometry: Construct Shapes, Never Sample Them
Geometric shapes are built the way a design tool builds them, from straight lines and true arcs, with the
**geometry kit** (`geometry` from `dist/compiler/index.js`, source `src/compiler/geometry.ts`):
- **Primitives:** `circle`, `ellipse`, `rect(…, cornerRadius)`, `polygon(cx, cy, r, sides, { cornerRadius })`,
  `star(cx, cy, outer, inner, points, { sideDepth, cornerRadius })` (`sideDepth` > 0: concave arc sides, the ✦),
  `polyline(points, cornerRadius)`.
- **Booleans:** `union`, `subtract`, `intersect`, `exclude` (exact curve intersections, via paper.js). A clover is
  circles unioned; a cut-out is a subtract. They run at build time: the Lottie gets one finished path (Lottie's own
  merge paths aren't supported by lottie-ios' Core Animation renderer).
- **Corners:** `roundCorners(shape, r)` puts a true circular fillet on every corner, convex or concave (the
  notches booleans leave). The cut grows as corners sharpen (r·tan(turn/2)): keep radii small on thin tips.
- **Out:** `toLottiePath` (one closed contour; holes don't morph), `toSvgPath`, `scaleToArea`, `transform`,
  `fromLottiePath`.
- **Morphs:** `shapeMorph` takes poses with any vertex counts and matches them itself (`matchPaths`): same winding,
  start at the top, points spread evenly by exact curve splits, so every pose keeps its exact outline. When part of
  a pose grows from or shrinks to nothing (a hole closing as an arch turns side-on), arc-length matching slides
  points round the outline and the in-betweens twist: build the poses as one parametric outline with the same
  vertices in the same order (degenerate ones collapsing to zero length) and pass `match: 'vertices'`. Native
  players blend poses in straight lines, so put poses where the shape changes character (the angle a hole shuts),
  not at even steps. Shut a hole into a zero-width slit of its last height, not a point, so the in-betweens narrow
  it rather than flatten it, and compare the in-between frames (not just the poses) with a real 3D render.

**Never** describe a geometric shape as a radius-per-angle formula sampled into points: straight sides stop being
straight, corners go lumpy, and smoothing only hides it. Sampled outlines are for truly organic forms only.

## 4. Faux-3D Discipline (Coins, Cards, Medals)
A flat coin or card flipping is `faux3DFlip` (below). An object with depth spinning about the vertical axis (a
headphone, a wheel, a handle) is the turntable kit: see §4b.
- **True orthographic cylinder projection, never a flat squish:**
  - `front` & `back`: scale along the flip axis by `|cos θ|` down to `0.01%` at 90° (never `1%`, which flashes a sliver at edge-on) and shift by `±(thickness/2)·sin θ`.
  - `rim` (extruded backing disc): same outer radius as the face **including stroke half-width (`r + strokeWidth / 2`)**, same `|cos θ|` scale, shifted to the **opposite** side `∓(thickness/2)·sin θ` and flipped cleanly across 90°.
  - `edge` (connecting cylinder bridge): solid matching bronze/metallic fill with subtle corner bevel (`rx="3"`), height matching `2 * (r + strokeWidth / 2)`, scaling `0% → 100% → 0%`. **Never put straight vertical stripes inside `edge`** — they clip awkwardly across the curved face ellipse.
  - **Shared Null Rig (`ty: 3`):** Always parent `front`, `back`, `rim`, and `edge` to a single Null rig for toss lift (`y`) and wrist tilt (`r`) so all layers stay pixel-locked under rotation.

## 4b. 3D Orbits & Camera Perspective (Billboard Rings, Camera Moves)
When a reference or note calls for a 3D ring, carousel, orbit, or camera push/pull where elements stay flat facing the screen and scale with depth:
- **Compute real 3D perspective, never flat 2D swaps:** Evaluate `(x, y, z)` on the 3D rig (orbit angle, Y-axis rotation, subtle camera elevation tilt, camera Z pullback/push-in) with perspective `F / (F + Zc + Z)` and depth-based back-element dimming.
- **Distill to minimal native Lottie keyframes (`fitBezierTrack`):** Never bake 60fps frames. Use `fitBezierTrack(seedKnots, fn, { tol: 1.0 })` (exported from `dist/compiler/index.js`) on each separated axis (`x`, `y`, uniform `scale` with `vec3: true`, `rotation`, `opacity`). Its default knot budget scales safely with duration (`~6 kf/s`, min 9) and clamps Bezier `x` handles to `[0.05, 0.95]` so both short moves and multi-act single-layer animations pass density-based `antiBakePass` and `mobileReady`.
- **When to use what: a coin or card → `faux3DFlip`; a solid → the 3D engine (`turntable` primitive); always run `npm run verify-3d -- <scene> [a,b,c]` before `npm run done`.** Describe the solid once as a small 3D model (`TurntableParams` in `src/compiler/types.ts`) with `origin`, `angle` stops about `axis` (default `[0, -1, 0]`), optional camera `tilt`, `focal` length, `light` (default `0.6`), `lightDir` (world light for spheres), `tol` (morph tolerance, default `0.75 px`), and a `rig` (entrance, bob). Put `turntableSvg(spec)` in the scene's SVG, import it, then `applyPrimitive(scene, spec)`. Four part families:
  - **`poly` (`TurntablePoly`):** convex polyhedra (`vertices`, `faces`, `center`, `rotation`, `paint`, `shade`, `light`, `stack`; helpers `polyPyramid`, `polyBox`). Each face is an exact affine flat layer (rotation + skew + scale), culled when facing away and lit from `shade` to `paint`.
  - **`lathe` / `disc` (`TurntableDisc`):** any surface of revolution spun about local `x` (`center`, `rotation`, `side`, `ends` / `outer` / `inner` with optional `art` or `recess`, `light`, `poses`, `stack`). Give `profile` (`[x, r]` or `{ x, r, in?, out? }` cubic handles) for cones, cups, bottles, vases, or beveled wheels — plus optional `innerProfile`, `innerPaint`, `innerBase` for open vessels — or use the rounded-rim cylinder shorthand (`radius`, `depth`, `rim`).
  - **`extrude` (`TurntableExtrude`; `strip` is an alias):** any closed SVG `outline` (non-symmetric and holes allowed) extruded by `depth` along local `z`, with optional `center`, `rotation`, `face`, `edge`, `edgeLit`, `edgeLitOpacity`, `light`, `poses`, `stack`. Works at any `axis` and `tilt`; builds exact 2D Minkowski-sum silhouettes with fixed-topology poses (shut holes collapse to zero-width slits) and affine front/back faces swapped at edge-on.
  - **`sphere` (`TurntableSphere`):** `center`, `radius`, `paint`, `shade`, optional `highlight` (`false` to disable), `highlightOpacity`, `lightDir`, `stack`. Circle outline plus a world-space light that sweeps an exact 4-cubic half-ellipse terminator and foreshortened radial-gradient highlight across the surface.
  - **Verification & references:** check every turning model with **`npm run verify-3d -- <scene> [a,b,c]`** (`out/<scene>-turntable.png`, three.js over Lottie — inspect both poses and in-between frames). See the live demo in `techniques/3d-engine/` and the headphone in `tools/build-untitled-coin.mjs`.
  - **Limits:** no deforming or organic shapes (characters stay 2D animation); **no surface art wrapped on spheres**; polyhedra must be convex (build concave solids from convex parts); **parts passing through each other on the same stack cannot be sorted cleanly** (the compiler detects >1.5 px 3D overlap and warns — separate them or assign explicit `stack` layers); flat faces use layer skew (**`lottie-ios 4.4+`**); perspective is mild (each part scales about its own centre). The rules below are what the engine does; follow them by hand only for shapes it doesn't model yet.
- **Solid objects turning (a headphone, a mug): project each part's true outline, never squash its flat art.** A
  disc or cylinder seen at angle φ is its side wall (the hull of its two end ovals, each |sin φ| wide, depth·|cos φ|
  apart) plus only the end facing the camera, painted; the hidden end is wall colour, never its artwork. If the wall's
  rim is rounded (radius r), the painted end is r smaller than the wall, or its tips poke past the rounded corners. A strip or
  arch with depth is its outline squeezed by |cos φ| and swept sideways by ±depth/2·|sin φ| (side-on it is a strip,
  not a needle). Give it definition, or it only looks like it's breathing: the outline in a darker edge colour, with
  the one side face toward the camera on top in the lit colour (the φ = 0 face squeezed by |cos φ|, slid by
  ∓depth/2·sin φ; front and back faces swap at 90° / 270°). The edge strip changing sides is what reads as turning.
  **Light every painted face by how much it faces the camera:** opacity over its darker side colour =
  smoothstep(|facing| / 0.6), where facing = cos or sin of φ for that face. A face left fully bright turns into a
  bright sliver that vanishes and pops up bright on the other side, which reads as a glitch. Light the edge as the
  faces fade (side-on, its outer surface faces you), so face and edge are never both bright at once. A face built
  from several stacked layers must not fade layer by layer (they show through one another): keep them solid and
  fade with one cover layer on top in the side colour. Key fades that cut at a swap with exact keyframes and holds,
  not a fitted curve, which can't follow a jump. Put the A/B paint-order swap where the faces are edge-on (zero wide), and check the poses against a
  real 3D render of the same model (three.js is installed) before calling it done.
- **Keep one consistent layer — split ONLY for dynamic Z-order:** Never split a layer just to reduce keyframe count. Split into back-to-front depth-sorted layer phases with an exact `ip` / `op` handoff at a non-overlapping face-on frame (e.g., 180°) **only** when a 360° spin requires foreground and background elements to swap occlusion order.

## 5. Mandatory Visual Verification Before `npm run done`
**Never trust JSON math alone.** Before finishing any Lottie task or note:
1. Run **`npm run verify-lottie -- <scene>`** (or MCP tool `render_contact_sheet`). It renders 8 key frames — including midpoints and 90° crossings — into `out/<scene>-sheet.png` in ~1s.
2. **Open `out/<scene>-sheet.png`** and inspect every tile for:
   - hidden/swapped shapes or broken paint order,
   - hard-edged glow clipping or seams at 90° crossings,
   - shadow/glow alignment with the main object.
3. If the scene uses SVG filters, also check **`npm run verify-lottie -- <scene> --baked`** to verify the Filter-to-Raster export looks identical to live preview.
4. **Shapes you built or changed: look at them full size.** The sheet's tiles hide wobbly edges, kinks and lumpy
   corners. Run **`npm run verify-shapes -- <scene> [a,b,c]`** and open `out/<scene>-shapes.png`: the frames at 2×,
   cropped to the shapes, in one image. Without frames it takes every `shapeMorph` pose and the middle of every morph.
5. Only after the visual contact sheet looks clean, run `npm run done -- <scene> <note id> "<summary>"`.
