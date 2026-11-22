# Motion Studio — working agreement for Claude

Motion Studio makes motion videos from code. A person scrubs a scene in the editor and leaves notes
pinned to a frame or a span (optionally a region, and an easing curve showing what they want). Your job is to turn
those notes into precise scene changes and verify them in rendered frames.

**Motion principles apply by default.** Before planning, building or retiming any scene (animatics excepted: there,
only staging and timing matter), read `skills/motion-principles/SKILL.md` and follow it: key frames are composed
layouts first, then consistent easing, stagger, overlapping action and even timing between them. For **Lottie
compositions** (`scenes/<id>/comp.json`), also read `skills/lottie-craft/SKILL.md` and **always run
`npm run verify-lottie -- <scene>`** (and inspect `out/<scene>-sheet.png`) before calling `npm run done`.

## Layout
A studio copy is the tool. A project's own work (its `scenes/`, `notes/` and `out/`) can live in a separate project
folder; when none is set they live inside the studio folder, as below. See [Project folder](#project-folder).
- `runtime/` — `studio.js` (master clock, beats, hit-testing), `ease.js` (bezier + tokens),
  `kits/` (camera, cursor, typing, svg, sketch, lottie, construct, shine, glass), `layers/` (pixi, three, p5). Shared by every scene.
- `scenes/<id>/` — `index.html` (markup + import map), `scene.js` (beats), `style.css`, `assets/`.
  Start new ones with `npm run new-scene -- <id>`.

- `skills/` — skills that ship with Motion Studio (plain Markdown, tool-agnostic): `motion-principles/` is the
  motion-design ruleset every scene follows.
- `themes/<id>/` — finished films kept as references. `techniques/<id>/` — reusable motion moves, each a `TECHNIQUE.md`,
  a live `demo/` scene and a kit in `runtime/kits/` (e.g. `construct-reveal` → `construct.js`).
- `tokens/motion.json` — named eases and durations (`move`, `settle`, `overshoot`, …).
- `notes/<scene>/<id>.json` (+ `<id>.png` crop) — feedback queue.
- `references/<id>/` — other people's videos and the moments marked on them (see [References](#references)).
  `media/` — the project's media library: files to use in films or attach to notes. Both per project.
- `render/render.mjs`, `render/probe.mjs` — rendering and motion analysis.
- `editor/` — the editor UI. `server/dev.mjs` — dev server (`npm run dev`, port 5173).
- `server/project.mjs` — where the project folder is (the one setting below). `server/refs.mjs` — references: download,
  their scene page, moments and measurements (`npm run ref`); `server/media.mjs` — the media library; the panel is
  `editor/references.html` (References and Files tabs).

## Project folder
Recommended layout: one studio copy per project, next to a folder holding that project's films:
```
my-project/
  motion-studio/   ← a clone of the studio (tool only; project.txt says ../film)
  film/            ← scenes/, notes/, out/ (out/ is renders: keep it out of git)
```
Set the project folder, first one set wins:
- `--project <dir>` on any command (`npm run dev -- --project ../film`, `npm run render -- <scene> --frames 0 --project ../film`);
- `MOTION_PROJECT=<dir>` in the environment;
- `project.txt` in the studio folder: one line, the project folder relative to the studio (gitignored, per copy).
  This is the set-and-forget option: every command (dev, render, probe, new-scene, wait-for-notes) then uses it.

The first `new-scene` in a project folder outside the studio creates the folder if needed and writes its
`RUN-STUDIO.md`: that project's own commands for the studio, the notes watcher and renders (never overwritten).

Unset, the project is the studio folder itself. A relative `--project` / `MOTION_PROJECT` is from where you typed the
command. The dev server serves `/scenes/`, `/notes/`, `/out/`, `/references/` and `/media/` from the project and everything else (`/runtime/`,
`/vendor/`, `/editor/`, `/themes/`, `/techniques/`, `/tokens/`) from the studio, so scenes keep using absolute
`/runtime/` and `/vendor/` paths and relative paths for their own files. In this file, `scenes/`, `notes/` and `out/`
mean the project's. Check which project a running studio uses in its startup line (`… (project: <dir>)`).

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
- Video in a scene: use WebM (VP9), not MP4/H.264. Frames are rendered by Playwright's own Chromium (`npx playwright
  install chromium`), which can't decode H.264; it never uses the user's Chrome app (a hidden instance of it stops their
  Chrome from opening on macOS).
- SVGs from Affinity: `loadSvg()`; Affinity layer names become `data-name`, pivots default to the
  artwork centre. Keep exports flat (no effects).

## Working a note
1. Read the notes: `notes/<scene>/*.json`, oldest first; skip ones that already have a `reply`
   unless asked, and work only notes sent to you: they have `sentAt`, and `sentTo` is your agent id (`claude`; a sent
   note without `sentTo` is Claude's). A note without `sentAt` is a draft the person hasn't sent yet, and one whose
   `sentTo` names another agent (`antigravity`, `codex`) is theirs: leave both. Always look at the crop `<id>.png` before acting, not just the JSON: it is often the only
   evidence of what they mean (spot notes on blank areas have empty `elements`), and reading the text alone
   leads to misreadings. A note gives `frame` or `range`, `text`, `region`
   (stage px), `elements` (data-names / text in the box, best match first — a tight box puts the element
   they mean at the top), `beats` (names in `scene.js`) and
   optionally `curve` — a cubic-bezier the person picked to show the easing they want; apply it
   exactly unless the text says otherwise. Optionally also:
   - `media`: files attached as `A1`, `A2`… (`[{ label, name, kind, path, from }]`; `path` is relative to the
     project). The text says what each is for, e.g. "use A1 as the base footage" or "make it look like A2". Open
     images to look at them; for a video, grab a few frames (`ffmpeg -ss <t> -i <path> -frames:v 1 …`). **To use
     one in a scene, copy it into `scenes/<scene>/assets/`** (never point a scene at `media/` or `references/`):
     images, GIFs, SVGs and fonts as they are; a video converted to WebM (`ffmpeg -i <path> -an -c:v libvpx-vp9
     -crf 30 -b:v 0 -g <fps> assets/<name>.webm`), then played frame by frame (seek it in `s.onFrame` and hand the
     seek to `s.waitFor`, as the reference scene page does in `server/refs.mjs`). `from: "reference"` files are
     someone else's videos; using them as footage is the person's call (stock and experiments): do it when asked.
   - `useRefs`: moments marked on references to borrow from (see [References](#references)).
   Notes show as "With Claude" in the editor from Send until you delete them (or reply).
2. Find the beat(s) in `scenes/<scene>/scene.js` and make the smallest change that does what the
   note says.
3. Verify lightly, then report. Check the change with one or two targeted renders of the affected
   frames; the person reviews playback themselves and will say what's off. Don't scan the whole film or
   run long renders unless asked — it costs their time and adds little.
   - `npm run render -- <scene> --frames a,b` (PNGs in `out/<scene>-frames/`) and look at them;
   - only when the change is about motion: `npm run probe -- <scene> "<data-name>" --range a-b` for
     speed curves (no unintended hard stops, abrupt starts or jumps), or `--sheet a-b:step` for a
     contact sheet across the beat.
4. Once a note is done, finish it with one command (never by editing `notes/` by hand):
   `npm run done -- <scene> <note id> "<what changed and where to look, 1–2 lines>"`. It writes the "To check" item
   into `notes/<scene>/_checklist.json` (frame, span, region, `useRefs` and `media` carried over, so a reply keeps
   them) and deletes the note and its crop (attached media stays in the library). Then tell the person in chat.
   (As a safety net the dev server also removes any note whose id is already in the To check list.) They tick items off in the editor's "To check" list, or reply — a reply comes back as a new note
   with `followUp` set to the item's text (treat it as feedback on that change).
   If you could not do a note, leave it and put your question in `"reply"` instead.
Whenever you start the studio (`npm run dev`), also start the watcher for the same project (see RUN-STUDIO.md):
pass it the same `--project` as the studio, unless `project.txt` sets it. There is one watcher per project and agent:
starting one replaces any earlier one (say, in another chat), so Send comes to the session that started it last. Read
its first line once it's running: if it says it replaced an earlier watcher, tell the person. If your own watcher exits
with `WATCHER REPLACED`, another session has taken over: don't start it again; tell the person instead.
While a session is working notes, keep `node tools/wait-for-notes.mjs` running in the background: it exits
when the editor's "Send to Claude" button is pressed — then work the notes and start it again. The editor can send to
other agents too (a picker next to Send); each waits with `--agent <id>` (`antigravity`, `codex`) and follows this
file, reading its own name and id where it says Claude (notes on a `ref.<id>`
scene are references to study: see [References](#references)).
The dev server live-reloads the editor when scene files or notes change.

## References
A reference is someone else's video whose motion and/or look the person wants in a film. They add it in the
References panel (Motion Studio menu → References, or **R**: paste a link, downloaded with `yt-dlp`, or drop a file)
and open it there in its own editor (a scene with id `ref.<id>`). On it they **mark moments**: a span, optionally a box
and a name or a line about it, then **◆ Save**. A moment is saved and measured at once by the studio (no Claude step):
`references/<id>/moments/<moment id>/` holds `moment.json` (name, text, span, box), `clip.mp4`, `frames/f0001.jpg…`
(every frame, cropped to the box plus a margin), `stills/fNNNN.jpg` (full resolution, at the key frames), `sheet.png`
(the cropped frames labelled; orange = moving), `context.png` (start, middle, end; box drawn), `motion.json` (per move:
frames, seconds, `studioFrames` at 25 fps, fastest point, travel, overshoot, a fitted cubic-bezier, the nearest token
in `tokens/motion.json`) and `style.json` (the measured colour palette). Older moments may also have `study.json`, notes
from an earlier way of working: useful, but the frames come first.

**Using one.** A film note points at moments in `useRefs` (`[{ ref, id, name }]`, added with "+ reference"), or names
one in its text. There is no stored write-up: read the moment's source with this note's request in mind, every time.
1. Read in order and stop when you have enough: the note's text; `context.png`, `sheet.png` and `motion.json` (the
   overview); then full-size stills when the note asks about the look (type, texture and colour need detail) or the
   sheet leaves something unclear; then individual frames, zoomed into the part in question (`ffmpeg … -vf
   crop=…,scale=…`), for busy moments where the measurements merge several things. The numbers are approximate:
   trust the frames, use the numbers for timing, easing and colours.
2. Build it with the scene contract and the motion principles: map timing onto the film's frame rate and beats.
3. **Compare before reporting:** `npm run ref -- compare <ref>/<moment id> <scene> <a-b>` writes one image with
   the moment's frames (top) over the film's frames a–b (bottom) at the same four points; look at it, and for
   details crop the same area of a reference still and a film frame side by side. Fix what doesn't match.
4. **When a follow-up says it's not close enough, go back to the source.** Reopen the moment's stills and frames
   (zoomed into what the note is about), compare side by side again, then change it, and say in the "To check" item
   what the comparison showed.

Borrow how it moves and looks; a reference's artwork is the person's call to reuse (see `media` above). References
stay in their project; turning a moment into a technique for everyone happens only when the person asks
(`techniques/REGISTERING.md`). From chat: `npm run ref -- add <link or file>`, `npm run ref -- list`.

## Animatics
"Animatic" means a storyboard in motion: it shows the idea so it can be course-corrected before anything is
made properly. Keep it to what tells the story:
- Plain paper (`--stage-bg: #FAF8F2`), no background, grid, brand look or finished art; no real screenshots.
- Everything drawn rough with the `sketch` kit; only the elements the story needs. Labels and placeholders are fine.
- `shotHud` on top: each shot's title and one-line action.
- Motion only for staging and timing (what enters, what happens, roughly when), not polish.

## Lottie compositions
A scene whose folder has a `comp.json` is a Lottie composition, made to ship to iOS, Android and the web: no
`scene.js`, no beats. Rules for building one: `skills/lottie-craft/SKILL.md` (read it first, every time).
- **Files** (`scenes/<id>/`): `comp.json` is the source: size, fps, `durationFrames`, `tokens`, `assets` (SVGs in
  `assets/`, each top-level `<g id>` becomes a named layer), `primitives` (motion moves: `position`, `scale`,
  `rotation`, `opacity`, `springMove`, `trimStroke`, `staggeredEntrance`, `faux3DFlip`, `squashAndStretch`,
  `keyframeTrack`) and `patches` (per-layer edits applied last). `animation.json` (the Lottie) and `filters.json`
  are compiled from it: never edit them by hand. `index.html` is the player page (`runtime/lottie-stage.js`).
- **The compiler** is TypeScript in `src/compiler/`; every tool loads it from `dist/`, so run `npm run build` after
  changing `src/` (and once after cloning). The dev server says "Lottie compiler not built" when `dist/` is missing.
- **Changing one:** if `tools/build-<id>.mjs` exists, it is the source (it rebuilds `comp.json` from scratch, so edits
  to `comp.json` are lost on its next run): change it and run `node tools/build-<id>.mjs`. Otherwise edit
  `comp.json`'s `primitives` / `patches` and recompile; `npm run verify-lottie -- <id>` recompiles `animation.json`
  as it checks. Times are frames at the composition's own `fps` (often 60, not the studio's 25).
- **New one:** `npm run new-lottie -- <id> [--size 512x512] [--fps 60] [--frames 90]` (scaffolds a flipping coin to
  start from).
- **Notes on a Lottie scene** have no crop `<id>.png`: read `region` and `elements` (Lottie layer names under the box,
  from the live SVG) instead, and render the note's frame with `npm run verify-lottie -- <id> --frames <f>` to see it.
  Each send also appends a line to `notes/_inbox.jsonl` (same note as `layers`, `boundingBox`, `distilledCurve`); the
  note JSON stays the one to work and finish. `distilledCurve` is a curve fitted from a motion the person
  demonstrated in the Proxy Sandbox: apply it like `curve`.
- **Verify** with `npm run verify-lottie -- <id>` and look at `out/<id>-sheet.png` (8 key frames, crossings
  included); with SVG filters, also `--baked`. `npm run test:lottie` runs the pipeline tests. Then `npm run done` as usual.
- **MCP:** `npm run mcp` serves the same pipeline as tools (`create_composition`, `import_svg_asset`,
  `apply_motion_primitive`, `patch_layer_ast`, `inspect_annotation`, `distill_motion_curve`, `spawn_proxy_sandbox`,
  `render_contact_sheet`, `export_dotlottie`). Use them when connected; the npm commands above do the same without.
- **Export:** the editor's **⤓ Export .lottie** writes `out/<id>.json` and `out/<id>.lottie` (filters baked to images).

## Themes
`themes/` holds finished films kept as references (gallery at `/themes/`). Read them only when asked; to
register a new one, follow `themes/REGISTERING.md`.

## Techniques
`techniques/` holds reusable motion moves, each with a live demo and a kit (gallery at `/techniques/`). Read a
technique's `TECHNIQUE.md` when asked for it, or when a scene calls for that move (an element built and then revealed →
`construct-reveal`; light passing over a glossy card → `glossy-shine`; a frosted glass panel that refracts what's
behind it → `liquid-glass`), and use its kit rather than rebuilding the move. To register a new one, follow
`techniques/REGISTERING.md`.

## Rendering
`npm run render -- <scene>` → `out/<scene>.mp4` (the project's `out/`). Options: `--range a-b`, `--blur 8` (sub-frame motion
blur), `--shutter 0.5`, `--scale 2` (supersampled), `--workers N`, `--crf 16`. `--out file.webm` encodes WebM (VP9, ~25% smaller;
`--vp9crf 30`); the editor's Export has an MP4 / WebM picker. A folder path in place of the scene id
renders a scene page kept elsewhere (`npm run render -- techniques/<id>/demo …`). A relative `--out` / `--png` is from the
folder the renderer runs in (the studio, under npm).
