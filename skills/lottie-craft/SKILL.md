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

## 3. Faux-3D Discipline (Coins, Cards, Medals)
- **True orthographic cylinder projection, never a flat squish:**
  - `front` & `back`: scale along the flip axis by `|cos θ|` down to `0.01%` at 90° (never `1%`, which flashes a sliver at edge-on) and shift by `±(thickness/2)·sin θ`.
  - `rim` (extruded backing disc): same outer radius as the face **including stroke half-width (`r + strokeWidth / 2`)**, same `|cos θ|` scale, shifted to the **opposite** side `∓(thickness/2)·sin θ` and flipped cleanly across 90°.
  - `edge` (connecting cylinder bridge): solid matching bronze/metallic fill with subtle corner bevel (`rx="3"`), height matching `2 * (r + strokeWidth / 2)`, scaling `0% → 100% → 0%`. **Never put straight vertical stripes inside `edge`** — they clip awkwardly across the curved face ellipse.
  - **Shared Null Rig (`ty: 3`):** Always parent `front`, `back`, `rim`, and `edge` to a single Null rig for toss lift (`y`) and wrist tilt (`r`) so all layers stay pixel-locked under rotation.

## 4. Mandatory Visual Verification Before `npm run done`
**Never trust JSON math alone.** Before finishing any Lottie task or note:
1. Run **`npm run verify-lottie -- <scene>`** (or MCP tool `render_contact_sheet`). It renders 8 key frames — including midpoints and 90° crossings — into `out/<scene>-sheet.png` in ~1s.
2. **Open `out/<scene>-sheet.png`** and inspect every tile for:
   - hidden/swapped shapes or broken paint order,
   - hard-edged glow clipping or seams at 90° crossings,
   - shadow/glow alignment with the main object.
3. If the scene uses SVG filters, also check **`npm run verify-lottie -- <scene> --baked`** to verify the Filter-to-Raster export looks identical to live preview.
4. Only after the visual contact sheet looks clean, run `npm run done -- <scene> <note id> "<summary>"`.
