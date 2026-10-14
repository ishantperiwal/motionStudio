# Thumbnail explainer

A product film that still reads at thumbnail size. It explains one product change through the real UI and a few
big numbers, never through slides. Source: `scenes/zapp-film` (Zapp Account case study), 624 frames at 25 fps, 1920×1200,
seamless loop. Watch `preview.mp4`; `aspects.png` shows each part below at its frame.

## What makes it work
- **The product carries the story.** The phone and its real UI are on screen almost all the time. There are no title cards or bullet points, and no labels explaining what you are looking at.
- **Few words, big type.** At most 2–4 words per idea, sized to survive a thumbnail. Numbers do the talking.
- **Real form, flat light.** Orthographic camera (no perspective), true thickness (extruded body, buttons, camera), no fake shading, shadows or glows.
- **One sticker outline.** A flat white outline around the object silhouette ties everything into one graphic look.
- **Few camera moves, all purposeful.** Each move reveals something; nothing drifts for decoration.
- **Overlapping handoffs.** An exit and the next entrance start together; nothing waits for anything else.
- **Accurate claims.** Every number matches the source wording (period, base, what it counts).
- **Seamless loop.** The last frame leads straight into frame 0, so it can autoplay on repeat.

## Aspects (point at any of these on its own)
| # | Aspect | Frames | What happens | Beats in `scene.js` |
|---|---|---|---|---|
| 1 | Arrival | 0–42 | Phone rises in from bottom right with one full turn while the camera pushes in; lands with it | `phone.fly`, `cam.zoom`, `cam.frame` |
| 2 | Build | 38–130 | UI assembles component by component, each sliding up as one piece (tile + glyph + label + badge together) | `screen.wash`, `fly.*` |
| 3 | Travel | 30–190 | Camera travels down the screen while the content scrolls, revealing lower sections | `cam.travel`, `screen.scroll` |
| 4 | Before / After | 196–360 | Camera squares up; old screen slides in beside the new one, both upright, labelled | `ba.*` |
| 5 | Split exit | 360–396 | The pair splits apart, left and right, each flipping as it leaves, while the camera pans down | `ba.beforeOut`, `phone.out` |
| 6 | Number card | 374–440 | Big number counts up beside a tiny chart that grows with it (Apr → Sep bars, or a "1 in 5" group of people) | `number.*` |
| 7 | Card stack | 440–580 | Each new card lands under the last; the camera pans to centre it. Cards sit exactly on the grid | `number.*` |
| 8 | Loop out | 580–624 | Cards slide off right as the camera eases back to the opening view, so the loop is seamless | `loop.cards`, `loop.camera` |

## Look
- **Ground:** navy `#1F3D5C` with grid lines `#335A80` (6px on a 60px cell), shown at 35% opacity, and a wide vignette. The grid zooms more slowly than the camera.
- **Outline:** white, about 9px, an SVG filter (`#stickerF`) on the object layer.
- **Number cards:**
  - Frosted box: `rgba(14,33,52,.55)` with a 5px backdrop blur.
  - Sized in whole grid cells (12×5), so the edges land on grid lines.
  - Number in Manrope 800 at 98px; 2–4 words in Manrope 700 at 31px, `#C4D7EA`.
  - Chart on the right edge, mirroring the number on the left.
- **Type:** Manrope for numbers and cards; the product's own fonts inside the UI (Inter here).
- **Eases:**
  - Arrival `[0.22, 0.6, 0.3, 1]`.
  - Camera push `[0.55, 0, 0.3, 1]`.
  - Leaving `[0.4, 0, 0.75, 0.55]`.
  - Loop-out camera `[0.7, 0, 0.45, 1]`.
  - Motion tokens `move` / `settle` / `exit` for everything else.

## Avoid (what pulled earlier attempts back toward a presentation)
- Abstract particles or floating decoration.
- Storyboard labels or kicker words over every beat.
- Slide-like panels that enter, sit and leave one at a time.
- Long sentences on screen.
- Busy camera paths.
- Moves that run one after another with dead holds in between.
- Numbers rounded into claims the source doesn't make.
