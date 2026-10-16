---
name: motion-principles
description: The motion-design principles every Motion Studio scene follows — key frames as composed layouts (pose-to-pose, staging, grid), consistent easing, stagger, overlapping action, timing. Use before planning, building or retiming any scene, and when working notes about layout, pacing or easing.
---

# Motion principles

The standard, documented principles of motion design, as applied in Motion Studio. Terms come from Disney's 12
Principles of Animation (Thomas & Johnston, *The Illusion of Life*, 1981), Google's Material Design motion guidelines,
and Issara Willenskomer's UX in Motion principles. Each rule gives the official term, then what it means here.

The goal: a film that feels choreographed and designed, not a slide deck with transitions.

## 1. Layout — key frames come first

**Pose-to-pose + Staging.** Key frames are layouts; motion is the transition between layouts. Before animating,
design every resting frame (every moment where things settle) as a still poster:

- **Grid / composition** — place things on a grid: centred, halves, thirds or an even row. Never wherever they
  happened to land.
- **Fill the frame** — size elements to use the space (films also play as thumbnails); negative space is deliberate.
  Keep important content inside **title-safe / action-safe** margins.
- **Even spacing** — equal gaps between elements, equal margins to the frame edges, balanced left and right.
- **Matched weight** — things shown together have a similar visual size.
- **Staging** — one clear focus per frame; the camera and composition point at it.
- **Hold** — each composed frame stays still long enough to read (roughly 0.5–1 s for a thumbnail-sized idea) before
  the next move.

## 2. Movement

1. **Consistent easing (Slow in / slow out) + Parenting.** Things that move at the same time use the same curve and
   similar durations, so they read as one motion. Elements that belong together move together. Break this only on
   request or for a clear reason.
2. **Offset & Delay (stagger)** — from *Follow-through & Overlapping action*. When a set populates (list rows, a deck
   of cards), keep the same easing and add a small stagger (≈ 1–2 frames at 25 fps; Material: 20–80 ms per item) so
   it cascades instead of landing all at once.
3. **Overlapping action / Choreography.** Otherwise overlap: the next move starts before the last one ends. No idle
   waits, no stop-start. Exits and the next focus move run together.
4. **Choreography — make room.** When something enters, what's already on screen shifts at the same time (push /
   pull) so the frame stays balanced. It shows the relationship between the elements.
5. **Entrances decelerate, exits accelerate** (Material). Things arriving ease out into place (`intro`, `move`,
   `settle`); things leaving ease in and speed away (`exit`). Moves within the frame use a standard in-out ease.
6. **Anticipation, Overshoot, Exaggeration — only where they earn it.** The default is a clean ease. Use
   `anticipate`, `overshoot`, `elastic` deliberately, for an object with character or a moment that needs emphasis
   (Material calls this *emphasized* vs *standard* easing).
7. **Timing — duration scales with distance and size.** Similar distances take similar time; bigger or longer moves
   take a little longer, small ones less. No element is much faster or slower than its neighbours; the film keeps
   one rhythm.
8. **Arcs.** Natural movement (a hand, a cursor, a thrown card, a camera swing) follows a gentle curve, not a
   ruler-straight line. Mechanical UI moves (a sheet sliding up) can stay straight.
9. **Secondary action — sparingly.** A small supporting motion (a shine, a pulse, a dot trail) can add life, but never
   competes with the main action and never fires at the same moment as a key move.

10. **The camera never parks** (a *living* / *drifting* camera, as in film and broadcast motion). A camera move
    doesn't end in a dead stop: it eases down into a slow drift in the same direction (a zoom out keeps zooming out,
    a pan keeps creeping), and the drift carries on until the next camera move takes over and blends it away. A hold
    is still a hold for the eye (≈2–4 % zoom per second), just never frozen. The ground moves with it (parallax).
    No reversals: if the next move goes the other way (a zoom out followed by a zoom in), don't drift against it;
    start the next move early and slowly instead, so the camera only ever changes direction through a real move.
    The camera kit does this by default (`drift`).

## How to apply

- **Planning a scene:** list its key frames first and sketch each layout (positions, sizes, spacing on the grid).
  Then build the transitions between them.
- **Writing beats:** use the tokens in `tokens/motion.json` (`move`, `intro`, `settle`, `exit`, `overshoot`, …) so
  easing stays consistent; parallel beats share an ease and duration; sets use a stagger; consecutive moves overlap.
- **Retiming:** move dependent beats along (relative timing), so the choreography holds.
- **Reviewing a render:** check each key frame as a still (grid, fill, spacing, weight), then the moves between them
  (shared easing, overlap, pacing).

These are defaults, not hard rules. The person's instructions always win: a note or chat message that goes against a
principle wins for that moment, and if they say to drop or ignore a principle (for a shot, a scene or the whole
session), stop applying it for that scope. Mention a principle only if it helps them decide.
