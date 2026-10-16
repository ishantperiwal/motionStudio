# Construct reveal

A UI element is built in front of you the way an agent would generate it, then becomes real: a faint dot lattice
spreads out, the element's outline and parts are written in as dotted lines while a selection bracket jumps from part
to part, guides and a size readout frame it, and a crisp scan bar sweeps down revealing the real UI, leaving a short
trail of light dots behind. About 1.2 s for a whole panel. From the Motion Ops film (the card build and the plugin
panel), after Jakub Antalik's UI-generation skeleton (transitions.dev). Kit: `runtime/kits/construct.js`. Demo:
`demo/` (1920×1080, 25 fps, 127 frames, loops).

## What makes it work
- **A machine building, not a hand drawing.** Everything is dots on one grid; strokes are dotted; labels are mono
  readouts. Monochrome ink, one accent (the scan bar).
- **The skeleton is the real element.** Outline, rows and shapes are measured from the actual UI, so the scan reads as
  the same thing becoming real, not a swap.
- **Reading order with a guide for the eye.** Outline first, then the parts top to bottom; the bracket lands on each as
  it starts, so you always know where to look.
- **Alive while it works.** The lattice keeps flashing in short vertical runs and the odd dot blinks out, so the build
  never sits still.
- **Fast and hard-edged.** Parts start 3 frames apart and write in 4–9 frames; the scan is a crisp line, not a fade.
- **The trail joins the two.** Dots the scan has passed stay a beat as light dots on the revealed UI, then fade.
- **It's still warm.** The UI just above the line glows — its own print brightened, fading smoothly upward — as if it
  has only just been made.

## Parts
Frames are from the build start (`at`) unless they say `scanAt` or `end` (= `scanAt + scan`).

| # | Part | When | What happens |
|---|---|---|---|
| 1 | Lattice | `at + 1` + distance from centre / 45 | A faint dot grid spreads out from the element's centre, each dot popping in over 3 frames with an overshoot; it runs 3 cells past the edges, fading with distance |
| 2 | Processing | 3 frames after each dot lands | Short vertical runs (1–4 dots) of the lattice flash bigger and darker for 2 frames, every 9–22 frames, one frame later per dot down the run |
| 3 | Outline | `at` → `at + 9` | The element's outline is written as two halves from top-centre that meet at the bottom |
| 4 | Parts | each part's `at` | Each part is written dot by dot with a bigger, darker writing head: its frame (6 frames), then its contents from +2, item `i` at `+ i × 0.5` (rows 4, circles 5, paths 8 frames). Text rows are dotted lines with heavy end dots. 7% of dots blink out for a frame now and then |
| 5 | Bracket | in at `at + 1`; jumps over 3 frames | Four corner brackets jump to each part as it starts, with a mono label (`LIST 472×380`); fade out as the scan starts |
| 6 | Guides, handles, readout | `at + 2` … `at + 9`; out from `end − 4` | Dotted guides along the edges run 70 px past them; square handles pop onto the corners; `560 × 700  t+0.96s` under the bottom-left corner counts up |
| 7 | Scan | `scanAt` → `end` (16 frames) | A bar sweeps from just above the element to just below it, revealing the real element above the line. Dots just below the line grow and darken; the lattice past the edges fades out |
| 8 | Trail | during the scan, gone by `end + 6` | Passed dots turn light, shrink and fade over 96 px above the line |
| 9 | Glow | during the scan, gone by `end + 8` | Behind the line the freshly made element glows: a brightened copy of itself (`brightness(1.75) saturate(0.85)`), seen only in a band that is full at the line and fades upward over 260 px on an eased (^2.2) falloff — its own ink lights up, not a white wash |

`scanAt` defaults to one frame after the last part is written. In the film: the plugin built in 14 frames and scanned
in 16; the larger card built in 20 and scanned in 26.

## Values
- **Lattice:** pitch 17.5 px, dots r 1.8 at 0.3 opacity, spreading 45 px per frame; opacity falls to 0 over 3.4 cells
  outside the box. Processing: about 5% of the inner dots start a run; a flash is ×1.55 size at 0.8.
- **Written dots:** outline r 2, gap 7, 0.75; inner frames r 1.7, 0.55; rows r 1.6, 0.6 with end dots r 3.4, 0.85;
  circles and paths r 1.7, 0.6. Writing head ×1.4 at 0.95 for a dot's first 3 frames.
- **Bracket:** arms 22 px, 4 px square caps, 14 px outside the part; jump ease `[0.45, 0, 0.2, 1]`; label 20 px mono 500,
  10 px above.
- **Guides:** 1.8 px round dots every 6 px at 0.5; handles 11 px squares, paper fill, 1.5 px ink stroke, overshoot in;
  readout 15.6 px mono at 0.7.
- **Scan:** ease `[0.3, 0, 0.7, 1]`, from 10 px above the box to 10 px below; a 9 px accent band with a 5 px white core
  on top, 38 px past each edge, knobs r 14 (accent) with r 6 (white); fades in and out over 2 frames. Dots within 84 px
  below the line grow ×1.5 towards 0.95.
- **Trail:** light dots shrink to 55% and fade by (1 − t)² over 96 px.
- **Pop-in ease:** `[0.34, 1.3, 0.64, 1]`.
- **Colours:** ink `#10213F`, light (trail) `#CFE0FF`, accent `#2A6FD6`, paper `#F7FBFA`. The demo: ground `#ECEEF1`,
  panel `#0F2648`.
- **Type:** `ui-monospace, 'SF Mono', Menlo` 500 for the bracket label and readout.

## Use it
```js
import { construct } from '@studio/kits/construct.js';

await document.fonts.load('600 20px Inter');            // rows are measured from the real text
const $ = (q) => document.querySelector(q);
const panel = construct(s, {
  reveal: $('#panel'), label: 'PANEL', at: 40,          // the real element: its box and corner radius are measured
  parts: [                                              // at: frames after the build starts, 3+ apart
    { label: 'TEXT', at: 3, rows: [$('.title'), $('.sub')] },
    { label: 'LIST', at: 6, rect: $('.list'), rows: document.querySelectorAll('.list .name') },
    { label: 'BUTTON', at: 10, rect: $('.btn'), rows: $('.btn span') },
  ],
});
// it adds the beats construct.build and construct.scan; chain on them: s.beat('panel.open', { after: 'construct.scan', … })
```
Returns `{ g, at, scanAt, end, scanY(f) }`. See `demo/scene.js` for a full example (icon, curve path, list, button).

| Option | Default | |
|---|---|---|
| `reveal` | | The real element. HTML: clipped with `clip-path: inset()` (100 px kept around it for a shadow). SVG: a clipPath in its own user space, so keep it in stage px. Hidden until the scan, unclipped after it |
| `box`, `radius` | the element's own | `[x, y, w, h]` in stage px; the outline's corner radius |
| `label` | `'FRAME'` | The outline's bracket label |
| `parts` | `[]` | `{ label, at, rect, r, rows, circles, paths, box?, dur?, step? }`. Each shape is one item or a list. `rect`: element or `[x, y, w, h, r]`. `rows`: a text element (measured to its text) or `[x, yMid, w]`. `circles`: element or `[cx, cy, r]`. `paths`: SVG path data in stage px. `box` overrides what the bracket frames |
| `at` | `0` | Build start: a frame or `(beats) => frame` |
| `scanAt`, `scan` | after the last part, `16` | Scan start and duration (frames) |
| `name` | `'construct'` | Beat prefix (`<name>.build`, `<name>.scan`); give each build its own; `false` for none |
| `into` | a full-stage SVG on top | An SVG group in stage px to draw in |
| `seed`, `pitch`, `spread`, `scale` | `1`, `17.5`, `45`, `1` | `scale` multiplies every size (for a build inside a scaled group, or a much bigger element) |
| `colors` | see Values | `{ ink, light, accent, paper }` |
| `glow`, `glowHeight`, `glowFilter` | `true`, `260`, `'brightness(1.75) saturate(0.85)'` | The glow behind the line: a copy of `reveal` (HTML: a clone with its computed styles; SVG: a `<use>` with a mask) brightened by `glowFilter`, over `glowHeight` px. `glow: false` turns it off |

Measure before any entrance transform is applied to the element, and after its fonts load.

## Avoid
- Holding the finished skeleton, or writing parts slower than ~9 frames: it turns into a loading screen.
- Parts less than 3 frames apart: the bracket snaps before it lands.
- A skeleton that doesn't match the real element (rows longer than the text, a different radius): the reveal reads as
  a swap.
- A dotted line per word or per glyph: one line per text line, one rect per container.
- Colour, glow or blur on the dots; a soft or feathered scan edge; fading the real element in instead of scanning.
- A white gradient laid over the element as the glow (reads as a flat wash): brighten the element itself. And don't
  oversaturate it (it turns electric blue): keep saturation at or below 1.
- Two builds at once competing for the eye: stagger them so one scans while the next starts.
