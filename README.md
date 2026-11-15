# Motion Studio

Motion videos written in code, directed with notes pinned to frames.

- **One clock.** Every scene is a paused GSAP master timeline addressed in frames. Preview, editor and
  export all call the same `seek(frame)`, so what you review is exactly what exports.
- **Named beats.** Scenes are built from beats (`assign.open`, `chat.send`, …) with start, duration,
  ease, overlap and cascade — absolute or relative to other beats.
- **Notes, not timelines.** In the editor you leave notes on a spot (draw a box) or a span (drag the top
  timeline row, or hold ⇧ while scrubbing). Press **Send to Claude** and a waiting Claude session works
  them, verifies the result in rendered frames, deletes the notes and lists what changed under
  **To check** — where you tick items off or reply to send them back as notes.
- **Any layer.** HTML/CSS, inline SVG (Affinity exports keep their layer names), PixiJS and Three.js,
  all on the same clock. A rough.js kit makes quick animatics/storyboards before the final.

See **[RUN-STUDIO.md](RUN-STUDIO.md)** for a step-by-step guide to running it.

## Requirements
macOS, Node 20+, **Google Chrome** (rendering uses it via Playwright) and **ffmpeg** on PATH. **yt-dlp** for adding
references by link (`brew install yt-dlp`; dropping a video file works without it).
Scenes use the system font (SF Pro), so renders match across Macs.

## Run
```bash
npm install
npm run dev                    # → http://localhost:5173/editor/
npm run new-scene -- my-film   # scaffold scenes/my-film (import map, stage, starter beats)
```

### Editor
| Do | How |
|---|---|
| Play / step | Space · ←/→ (⌥ ×10). Playing shows frames rendered exactly as export does (never half-drawn). Scrubbing is instant: rendered frames near the playhead are preloaded in memory; elsewhere it shows the live scene, and swaps in the rendered frame once you rest for 0.15 s. The green bar under the ruler marks rendered frames (limits in `PREVIEW`, server/dev.mjs) |
| Note a spot | ✎ Spot or **S**, then draw a tight box (or click) |
| Note a span | Drag across the top timeline row, or hold **⇧** while scrubbing / stepping / playing |
| Adjust a span | Drag a note bar's ends — the viewport shows the frame under the end you drag |
| Save / send / edit / delete a note | Typing saves as you go · **↑** on the note (or ⌘↵) sends it to Claude, with any other unsent notes on the scene · Enter is a new line · Esc closes (a note with text stays as a **Draft**) · click the text to edit · 🗑 (or ⌫ with the note selected) |
| Show the easing you want | **+ easing** on a note — curve editor with speed graph and presets |
| Ask Claude to work the notes | **▶ Send to Claude** (needs a Claude session running `tools/wait-for-notes.mjs`). Sent notes show moving stripes until Claude has worked them. The picker next to it sends to Antigravity or Codex instead (their session runs the watcher with `--agent antigravity` / `--agent codex`) |
| Review Claude's changes | **To check** list (shown when no note is selected): click to jump, ✓ when checked, ↩ to reply |
| Export | **⤓ Export MP4** — 1080p, motion blur, H.264 CRF 18, saved to `out/` |
| Copy a note with its context | ⌘C with the note selected |
| Show Claude a moment from another video | Motion Studio menu → **References**: paste a link or drop a file, open it, mark the moment you like and **◆ Save**; then **+ reference** on a film note uses it. Drop files onto a note to attach them. See [References and media](#references-and-media) |
| Zoom the timeline | −/+ (or pinch / ⌘-scroll), 0 resets to the 30 s view; ⇧-scroll to pan |

## Command line
```bash
npm run render -- my-film                      # out/my-film.mp4
npm run render -- my-film --blur 6 --scale 2   # motion blur, supersampled
npm run render -- my-film --frames 0,120,200   # stills → out/my-film-frames/
npm run render -- my-film --sheet 0-250:10     # contact sheets (20 frames each)
npm run probe -- my-film "<data-name>" --range 120-180   # speed curve + rough-spot flags
```

## Writing a scene
Every scene follows the motion-design principles in [`skills/motion-principles/SKILL.md`](skills/motion-principles/SKILL.md)
(key frames as composed layouts, consistent easing, stagger, overlapping action, timing). Point your AI agent at it,
or read it yourself.

```js
import { gsap } from 'gsap';
import { studio } from '@studio/studio.js';
const s = await studio({ id: 'hello', width: 1920, height: 1080, fps: 25 });
gsap.set('#card', { opacity: 0, y: 40 });                       // initial state
s.beat('card.in', { at: 10, dur: 'medium', ease: 'settle' },    // a beat
  (b) => b.fromTo('#card', { opacity: 0, y: 40 }, { opacity: 1, y: 0 }));
s.beat('items.in', { after: 'card.in', overlap: 0.5, dur: 14, stagger: 3 },
  (b) => b.each('.item', { opacity: 0, x: -20 }, { opacity: 1, x: 0 }));
s.ready({ tail: 25 });                                          // hold 25 frames at the end
```
Conventions: the root is `#stage`; give important elements a `data-name` (notes refer to them by it);
everything animates through beats (no `gsap.to`, no timers, no `Math.random` — use `rng(seed)`).

Kits (`runtime/kits/`): `camera` (focus + zoom views), `cursor` (collaborator cursor, clicks,
proportional tilt, optional name tag), `typer` (uneven seeded typing), `loadSvg` (Affinity SVGs),
`sketch` / `shotHud` (animatics), `construct` (an element built on a dot lattice, then revealed by a scan), `shine` (light passing over a glossy printed card). Layers: `pixiLayer`,
`threeLayer`, `p5Layer`. Lottie: `lottieKit`. Tokens: `tokens/motion.json`.

## Themes and techniques
[`themes/`](themes/README.md) keeps finished films as references (gallery at `/themes/`). [`techniques/`](techniques/README.md)
keeps single reusable moves, each with a live demo and a kit you import (gallery at `/techniques/`; both are in the
editor's Motion Studio menu). So far: the construct reveal (`runtime/kits/construct.js`) and the glossy shine (`runtime/kits/shine.js`).

## References and media
Borrow how another video moves and looks, and bring in your own files. Open **References** in the Motion Studio menu
(or press **R**): a panel over the editor with two tabs.
- **References:** paste a link (a tweet, YouTube, Instagram, Pinterest, Vimeo…, downloaded with `yt-dlp`) or drop a
  video. Click one to open it in its own editor inside the panel, and **mark the moments you like**: drag a span, box
  what matters if you want, name it, **◆ Save**. Each moment is cut out and measured on the spot (every frame,
  full-size stills, duration, easing, overshoot, palette) and shows as a green bar; click it to scrub its frames.
- **Files:** your own footage, screenshots, icons and fonts (upload or drop), plus the references' videos.

On a note in your film:
- **+ reference** points at a marked moment: *"land the card like this"*. Claude reads that moment's frames for your
  request, builds it, and compares the result side by side with the reference (`npm run ref -- compare`) before
  reporting. A follow-up ("still not close") goes back to the same frames.
- **Drop or paste a file onto the note**, or use **+ media**, to attach it as **A1**, **A2**…: *"use A1 as the
  background footage"*, *"make the icon look like A2"*.

References and media live in your project (`references/`, `media/`), never in the studio's git.

## Scenes
None ship with the studio. Create one with `npm run new-scene -- my-film`; each scene lives in
`scenes/<id>/` and shows up in the editor's scene picker.
Scenes, notes and exports can live in a project folder outside the studio (`echo ../film > project.txt`, or
`--project <dir>` / `MOTION_PROJECT`): see [RUN-STUDIO.md](RUN-STUDIO.md#keep-your-films-outside-the-studio-recommended).

## Licenses
GSAP 3.13 (with plugins) is free under GreenSock's own license — fine for internal use; check it before
distributing this tool. PixiJS, Three.js, rough.js: MIT. Playwright: Apache-2.0.
