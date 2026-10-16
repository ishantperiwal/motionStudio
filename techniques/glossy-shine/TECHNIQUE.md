# Glossy shine

Light passes once over a glossy printed card and the print catches it: the ink, the lines and the gradient frame
brighten where the light is (not a white haze over everything), a faint glow tinted with the card's own cyan and yellow
rides with it, the frame glints, and the printed ✦ twinkles into a star exactly as the light's centre crosses it. A
soft, even, unhurried pass of 2 s with the card flat and still. From the Motion Ops film (the back of the hero card,
after it flips). Kit: `runtime/kits/shine.js`. Demo: `demo/` (1920×1080, 25 fps, 95 frames, loops).

## What makes it work
- **The art catches the light, not a layer on top of it.** The main layer is a brightened copy of the card's own print,
  revealed only under the band, so bright ink and the frame light up and the dark ground barely does. That reads as
  gloss on a printed surface; a white stripe reads as an overlay.
- **No core, no edge.** The band is a raised cosine to the power 1.5, sampled at 25 stops: broad, soft both sides,
  with nothing that looks like a highlight bar or a blur.
- **The card's own colours.** The faint face glow is cyan at the leading edge, white in the middle, warm yellow
  trailing: the colours of its frame, so the light feels like it belongs to the object.
- **The frame is the glossiest part.** The same band, much stronger, only on the frame ring; the ring also glows faintly
  all round, swelling in and out over the pass.
- **One detail pays it off.** A printed sparkle fires exactly when the light's centre crosses it (its position along
  the gradient line is computed from the angle), so the pass has a moment.
- **Constant pace, edge to edge.** Linear, starting fully beyond one edge and leaving fully past the other at full
  strength: it never fades in or out on the card, so it doesn't appear or vanish.

## Parts
All run together from `at` to `at + dur` (default 50 frames). `x` is the band's centre, % along the gradient line,
going linearly from −62 to 162.

| # | Part | When | What happens |
|---|---|---|---|
| 1 | Sheen | `at` → `at + dur` | A copy of the art with `brightness(1.9) saturate(1.25) contrast(1.05)`, masked by a white band (half-width 34%) at 0.85: the print brightens where the light is |
| 2 | Glow | `at` → `at + dur` | A screen-blend band (half-width 50%) at 0.12 over the face, cyan → white → warm yellow from leading to trailing edge |
| 3 | Frame glint | `at` → `at + dur` | The same band (half-width 40%) at 0.6, only on the frame ring (17 px at 420 wide); plus a white ring glow `0.12 × sin(πt)^0.6` |
| 4 | Sparkle | centred where `x` crosses the ✦ (`at + 30` in the demo) | A four-point star with a bloom: opacity `exp(−((x − p)/13)²)`, scale 0.3 → 0.95, turning −25° → 20° as the light passes |

## Values
- **Band:** angle 105° (light travels left to right, leaning slightly); falloff `(0.5 + 0.5·cos πk)^1.5` for
  k ∈ [−1, 1], 25 stops; widths 34% (sheen), 50% (glow), 40% (frame), each the half-width on either side of the centre.
- **Travel:** −62% → 162%, linear, 50 frames at 25 fps (2 s). The card is flat and still the whole time.
- **Strengths:** sheen mask 0.85, glow 0.12, frame 0.6, all-round ring 0.12 (enveloped).
- **Tint (rgb):** leading `150, 236, 245` (cyan), trailing `246, 238, 170` (warm yellow), white at the centre.
- **Sheen filter:** `brightness(1.9) saturate(1.25) contrast(1.05)`.
- **Sparkle:** 120 px star (at a 420 px card): core 2.5 px white, bloom to 34 px; arms 2 px × 100% and 2 px × 70%;
  Gaussian width 13 (% of the gradient line). Screen blend. In the film: card px `357, 270` on a 420 × 621.7 card.
- **Demo:** ground `#ECEEF1`; the card back at 1.4× (588 × 870.4, radius 42), frame ring 23.8 px, star 168 px; the
  shine runs frames 14–64, then a 30-frame hold.

## Use it
```js
import { shine } from '@studio/kits/shine.js';

const card = document.querySelector('#card');           // positioned, rounded, overflow: hidden; the art is an <img> in it
await card.querySelector('img').decode();               // the sheen copies the art's box
shine(s, {
  el: card, at: 14,                                     // or at: (B) => B['card.flip'].f1 + 1
  frame: 24,                                            // the frame ring's width (element px)
  sparkles: [[500, 378]],                               // printed ✦s, element-local px
});
// adds the beat shine.sweep (name: 'card' → card.sweep)
```
Returns `{ at, end, x(f), layers: { sheen, glow, ring, glints } }`. The kit injects its own CSS (once), adds its layers
inside `el` and sets `isolation: isolate` on it so the screen blends mix with the art only. See `demo/scene.js`.

| Option | Default | |
|---|---|---|
| `el` | | The element holding the art: positioned, with its corner radius and `overflow: hidden` (the layers inherit the radius) |
| `art` | the first `img` inside | The image to brighten; its box is measured relative to `el`, so size it in CSS or `await img.decode()` first. `false` for no sheen |
| `at`, `dur` | `0`, `50` | Start (frame or `(beats) => frame`) and duration in frames |
| `angle`, `from`, `to` | `105`, `-62`, `162` | Gradient angle (CSS degrees) and the band centre's travel, % of the gradient line; keep `from`/`to` beyond the band's width so it enters and leaves off the card |
| `frame` | `17` | Frame ring width in element px; `0` for no frame layer |
| `sparkles` | `[]` | `[[x, y], …]` in element-local px |
| `sparkleSize`, `sparkleWidth` | `120`, `13` | The star's size (px) and how long it lasts (% of the gradient line) |
| `widths` | `{ sheen: 34, glow: 50, frame: 40 }` | Band half-widths, % |
| `strength` | `{ sheen: 0.85, glow: 0.12, frame: 0.6, ring: 0.12 }` | Peak alphas |
| `tint` | `{ lead: [150, 236, 245], trail: [246, 238, 170] }` | Leading and trailing colours (rgb); match the card's own |
| `filter` | `brightness(1.9) saturate(1.25) contrast(1.05)` | The sheen's filter |
| `name` | `'shine'` | Beat prefix (`<name>.sweep`); give each shine its own; `false` for none |

## Avoid
- A blur-based diagonal stripe, or a crisp CC Light Sweep-style band: both read as an effect laid over the card.
- A bright core with a soft blur around it: the light should have no core at all.
- Sweeping fast. 2 s across one card is the pace; it should feel unhurried.
- Fading the light in or out on the card: it seems to appear and vanish. Start and end it fully off the card.
- Tilting the card while it plays: keep it flat and still, and let the light do the moving.
- A dark hairline or ring shadow around the card edge: the gradient frame is the edge.
