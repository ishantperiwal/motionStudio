# Registering a theme

A theme is a finished film kept as a reference, so a new piece can start from it, or from one part of it.
This guide grows as the compendium does: when something proves useful (or doesn't), update it here.

## When
Register a film once it has turned out well and you'd want to point at it again. Rough attempts, animatics
and rejected versions stay out.

## The folder: `themes/<id>/`
| File | Needed | Notes |
|---|---|---|
| `THEME.md` | yes | See below. Its presence is what makes the folder show up in the gallery |
| `preview.mp4` | for hover play | Half size is plenty: `npm run render -- <scene> --scale 0.5 --out themes/<id>/preview.mp4` |
| `poster.png` | recommended | One still that says what the theme is (shown before hover) |
| `aspects.png` | optional | Its parts at a glance, each labelled with its frame |

Any kind of video works (a Motion Studio scene, a plain-JavaScript frame-by-frame story, …) as long as it has
a preview. If it lives in this repo, keep its source here too (e.g. `scenes/<id>`), so the parts can be read in code.

## What goes in THEME.md
1. `# Name`, the first line.
2. One paragraph saying what it's for and where it came from (source, length, frame size). The gallery shows
   this paragraph on the tile, so make it the pitch.
3. **What makes it work**: the few principles that make it this theme and not a generic version of it.
4. **Aspects**: its parts as a table (frames, what happens, the beats or code behind it), so someone can
   point at one part on its own ("the split exit from …").
5. **Look**: colours, type, outline, eases, layout rules: the concrete values.
6. **Avoid**: what pulled earlier attempts off course.

What matters most: name the parts so they can be referenced, give concrete values rather than adjectives, and
record what to avoid. Keep it short.

## Then
Add a row to the table in `themes/README.md`. The gallery at `/themes/` picks the folder up on its own.
