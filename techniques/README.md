# Techniques

One reusable motion move each, with a live demo and the code to use it. To use one, point at it by name ("build the
panel with the construct reveal"), import its kit and call it.

**Gallery:** http://localhost:5173/techniques/ (or "Technique library" in the editor's Motion Studio menu). Hover a
tile to play it; click for the live demo, links to its code, and its notes. Any folder here with a `TECHNIQUE.md` shows
up automatically.

## Techniques and themes
| | [Themes](../themes/README.md) | Techniques |
|---|---|---|
| Keeps | A whole finished film: its look, its parts, its pacing | One move (a reveal, a build, a transition) that works in any film |
| Code | None (scenes stay with their project) | A kit in `runtime/kits/` and a demo scene in `demo/` |
| Use it | As a reference to start a new film from | Import the kit; the demo shows the call |

To add one, see [REGISTERING.md](REGISTERING.md).

| Technique | What it does | Kit | Made for |
|---|---|---|---|
| [Construct reveal](construct-reveal/TECHNIQUE.md) | A UI element is built on a dot lattice part by part, then a scan bar reveals the real thing | `runtime/kits/construct.js` | Motion Ops film (the card and the plugin panel) |
| [Glossy shine](glossy-shine/TECHNIQUE.md) | Light passes over a glossy printed card: the print and frame catch it, a printed sparkle twinkles as it crosses | `runtime/kits/shine.js` | Motion Ops film (the back of the hero card) |
| [Liquid glass](liquid-glass/TECHNIQUE.md) | A frosted glass slab (WebGL shader) that refracts what's behind it: the rim bends and magnifies the backdrop with colour fringes and catches the light | `runtime/kits/glass.js` | Motion Ops film (the glass panel over the names) |
