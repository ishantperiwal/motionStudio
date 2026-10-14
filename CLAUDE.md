# Motion Studio — working agreement for Claude

Motion Studio makes motion videos from code. A person scrubs a scene in the editor and leaves notes
pinned to a frame or a span (optionally a region, and an easing curve showing what they want). Your job is to turn
those notes into precise scene changes and verify them in rendered frames.

## Layout
- `runtime/` — `studio.js` (master clock, beats, hit-testing), `ease.js` (bezier + tokens),
  `kits/` (camera, cursor, typing, svg, sketch, lottie), `layers/` (pixi, three, p5). Shared by every scene.
- `scenes/<id>/` — `index.html` (markup + import map), `scene.js` (beats), `style.css`, `assets/`.
  Start new ones with `npm run new-scene -- <id>`.

- `tokens/motion.json` — named eases and durations (`move`, `settle`, `overshoot`, …).
- `notes/<scene>/<id>.json` (+ `<id>.png` crop) — feedback queue.
- `render/render.mjs`, `render/probe.mjs` — rendering and motion analysis.
- `editor/` — the editor UI. `server/dev.mjs` — dev server (`npm run dev`, port 5173).

## Scene contract (keep it deterministic)
- All animation goes through `s.beat(name, opts, (b) => …)` using `b.fromTo`, `b.each`, `b.set`.
  Never `gsap.to`/`from`, never timers, `Date.now()` or `Math.random()` (use `rng(seed)` from `ease.js`).
- Initial states are `gsap.set` calls before the beats. Anything computed per frame (typing, particles,
  Three/Pixi objects) lives in `s.onFrame(fn)` and must be a pure function of the frame.
- Beat timing: `at` (frame or `(B) => frame`), `after` + `overlap`/`gap`, or `with` + `offset`.
  Prefer relative timing so changing one beat carries its dependants along. Eases are token names
  or `[x1, y1, x2, y2]`; durations are frames (or duration tokens).
- Give beats short dotted names (`group.action`) and a `note:`; give important elements a
  `data-name` — the editor and notes refer to things by these names.
- Camera moves and the cursor moves that happen with them go in the same beat (same start/end).
- WebGL / canvas layers (`pixiLayer`, `threeLayer`, `p5Layer`) and `lottieKit` never run their own loop;
  they render in a frame hook. In p5, draw from the frame `f`, not `p.frameCount` (random/noise are reseeded each frame).
- Fonts: Inter and Manrope ship as defaults (`/vendor/@fontsource/inter|manrope/files/*.woff2`, via `@font-face`);
  any other font is fine — `npm install @fontsource/<name>` or local files in the scene. Await `document.fonts.load(...)`
  before `s.ready()` so renders never capture the fallback font.
- SVGs from Affinity: `loadSvg()`; Affinity layer names become `data-name`, pivots default to the
  artwork centre. Keep exports flat (no effects).

## Working a note
1. Read the notes: `notes/<scene>/*.json`, oldest first; skip ones that already have a `reply`
   unless asked. Always look at the crop `<id>.png` before acting, not just the JSON: it is often the only
   evidence of what they mean (spot notes on blank areas have empty `elements`), and reading the text alone
   leads to misreadings. Also open every image listed in `refs` — reference
   images the person pasted into the note (⌘V) to show the style or result they want. A note gives `frame` or `range`, `text`, `region`
   (stage px), `elements` (data-names / text in the box, best match first — a tight box puts the element
   they mean at the top), `beats` (names in `scene.js`) and
   optionally `curve` — a cubic-bezier the person picked to show the easing they want; apply it
   exactly unless the text says otherwise.
2. Find the beat(s) in `scenes/<scene>/scene.js` and make the smallest change that does what the
   note says.
3. Verify lightly, then report. Check the change with one or two targeted renders of the affected
   frames; the person reviews playback themselves and will say what's off. Don't scan the whole film or
   run long renders unless asked — it costs their time and adds little.
   - `npm run render -- <scene> --frames a,b` (PNGs in `out/<scene>-frames/`) and look at them;
   - only when the change is about motion: `npm run probe -- <scene> "<data-name>" --range a-b` for
     speed curves (no unintended hard stops, abrupt starts or jumps), or `--sheet a-b:step` for a
     contact sheet across the beat.
4. Once a note is done, delete it (`<id>.json`, `<id>.png` and its `refs` files), add a 1–2 line item to
   `notes/<scene>/_checklist.json` (`{ items: [{ id, frame, range?, region?, text }] }` — copy
   frame/range/region from the note) saying what changed and where to look, and tell the person in chat. They tick items off in the editor's "To check" list, or reply — a reply comes back as a new note
   with `followUp` set to the item's text (treat it as feedback on that change).
   If you could not do a note, leave it and put your question in `"reply"` instead.
While a session is working notes, keep `node tools/wait-for-notes.mjs` running in the background: it exits
when the editor's "Send to Claude" button is pressed — then work the notes and start it again.
The dev server live-reloads the editor when scene files or notes change.

## Themes
`themes/` holds finished films kept as references (gallery at `/themes/`). Read them only when asked; to
register a new one, follow `themes/REGISTERING.md`.

## Rendering
`npm run render -- <scene>` → `out/<scene>.mp4`. Options: `--range a-b`, `--blur 8` (sub-frame motion
blur), `--shutter 0.5`, `--scale 2` (supersampled), `--workers N`, `--crf 16`.
