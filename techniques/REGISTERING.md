# Registering a technique

A technique is one motion move kept so any film can reuse it: the code (a kit), the proof (a live demo) and the notes
(`TECHNIQUE.md`). This guide grows as the shelf does: when something proves useful (or doesn't), update it here.

## When
Register a move once it has worked in a real film and you'd want it somewhere else. Effects tied to one scene stay in
that scene; a whole film's look is a [theme](../themes/REGISTERING.md).

## The kit: `runtime/kits/<name>.js`
Kits live with the runtime so every scene can import them (`@studio/kits/<name>.js`).
- One exported function, `(s, options)`, with few options and good defaults: the values that made it work in the film.
- Take the element's geometry as input (or measure it from the element), never the film's coordinates.
- Deterministic: drive everything from `s.onFrame` as a pure function of the frame, with `rng(seed)` for anything
  random. No timers, `Math.random()` or `Date.now()` (see the scene contract in `CLAUDE.md`).
- Register its own named beats with a `note:` (and a `name` option to keep them unique), so the editor and notes can
  point at it.
- A header comment: what the move is, its parts in order, a usage snippet.

## The folder: `techniques/<id>/`
| File | Needed | Notes |
|---|---|---|
| `TECHNIQUE.md` | yes | See below. Its presence is what makes the folder show up in the gallery |
| `demo/` | yes | A small scene (`index.html`, `scene.js`, `style.css`) that uses the kit; plays at `/techniques/<id>/demo/` |
| `preview.mp4` | for hover play | Half size is plenty: `npm run render -- techniques/<id>/demo --scale 0.5 --out techniques/<id>/preview.mp4` |
| `poster.png` | recommended | One still that says what it does: `npm run render -- techniques/<id>/demo --frames <f> --scale 0.5 --png out/poster`, then copy it here |

Scenes in `scenes/` stay on your machine, so the demo lives with the technique. Copy a scene's `index.html` (its import
map uses absolute `/vendor/` and `/runtime/` paths, so it works from any folder). Keep it small: one sample element on a
light neutral background, the move, a hold, then back to its first frame so it loops cleanly. The renderer takes the
folder path in place of a scene id.

## What goes in TECHNIQUE.md
1. `# Name`, the first line.
2. One paragraph saying what it does and where it came from. The gallery shows this paragraph on the tile, so make it
   the pitch.
3. **What makes it work**: the few principles that make it this move and not a generic version of it.
4. **Parts**: a table in order, with timings, so someone can point at one part on its own.
5. **Values**: the concrete numbers (sizes, colours, eases, durations).
6. **Use it**: the import, a short snippet and the options. Name the kit's path (`runtime/kits/<name>.js`): the
   gallery links to it.
7. **Avoid**: what pulled earlier attempts off course.

## Then
Add a row to the table in `techniques/README.md`. The gallery at `/techniques/` picks the folder up on its own.
