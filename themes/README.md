# Themes

Finished films kept as references. To start something new, point at a theme, or one aspect of it
("the number cards from Thumbnail explainer"), and build from that.

**Gallery:** http://localhost:5174/themes/ (or the "Themes" link in the editor's top bar). Hover a tile to play it;
click for the full preview, its parts at a glance, and its notes. Any folder here with a `THEME.md` shows up automatically.

## A theme folder
| File | Needed | What it is |
|---|---|---|
| `THEME.md` | yes | First line `# Name`, then a one-paragraph summary (shown on the tile). Then whatever makes it work, its parts and the look |
| `preview.mp4` | for hover play | The film, any size (half size is plenty) |
| `poster.png` | recommended | The still shown before hover |
| `aspects.png` | optional | Its parts at a glance, labelled with frames |

A theme can be any kind of video: a Motion Studio scene, a plain-JavaScript frame-by-frame story, anything with a preview.
For a Motion Studio scene, `npm run render -- <scene> --scale 0.5 --out themes/<id>/preview.mp4` makes the preview.

| Theme | What it's for | Source |
|---|---|---|
| [Thumbnail explainer](thumbnail-explainer/THEME.md) | One product change explained through the real UI and a few big numbers; reads at thumbnail size; loops | `scenes/zapp-film` |
