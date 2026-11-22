# 3D engine (`turntable`)

Compiles small 3D models — convex polyhedra, profiled lathes (including open vessels and recessed ends), extruded closed outlines with holes, and world-lit spheres — into native Lottie vector layers with zero expressions and zero merge paths, turning about any axis under an optional camera tilt and perspective.

## What makes it work

- **Exact 2D projection per family, never flat squashing:**
  - `poly`: each face is an affine flat layer (rotation, skew, scale), culled when facing away and lit from `shade` to `paint`.
  - `lathe` / `disc`: exact analytical contour-generator envelope of circles along the local axis (`profile` of `[x, r]` points with optional cubic handles, or cylinder shorthand `radius`/`depth`/`rim`), emitted as fixed-topology poses (`match: 'vertices'`); flat ends where `r > 0`, optional `recess` + cover veil, and optional `innerProfile` for open hollow vessels.
  - `extrude` / `strip`: exact 2D Minkowski-sum silhouette (build-time `paper.js` booleans) compiled to fixed-topology outer + hole poses with in-plane rotation factored out; shut holes collapse to zero-width slits; affine flat front/back faces swap at edge-on.
  - `sphere`: circle outline plus a world-space directional light (`lightDir`) that sweeps an exact 4-cubic half-ellipse terminator (`shade`) and foreshortened radial-gradient `highlight` across the surface.
- **Exact depth sorting & swap timing:** parts sort by depth within each `stack` (lower stacks always paint beneath higher stacks; stacks are planned independently). Phase layer sets swap exactly at depth crossings or edge-on moments and hold still while hidden. Interpenetrating parts on the same stack are detected at build time via 3D OBB/sphere SAT and warned.
- **Anti-bake mobile health:** transforms key at quarter turns with fitted sine eases (`≤ 0.5 px`); morph poses go at event angles (edge-on, holes shutting) plus adaptive refinement inside the anti-bake keyframe density limits (`≤ 8 kf/s` and `≤ 10` non-hold kf per 1 s window).

## Parts (demo scene)

The live demo (`techniques/3d-engine/demo/`) shows two turntables over a 180-frame (3 s at 60 fps) 360° loop:

| Turntable / Part | Family | Role in demo | Timing |
| --- | --- | --- | --- |
| `pyramid` (`pyr`) | `poly` (`polyPyramid`) | Rotating square pyramid, 20° tilt | f0 → f180 (0° → 360°) |
| `machine` (`body`) | `poly` (`polyBox`) | Chassis (`stack: 0`), 22° tilt, `focal: 1100` | f0 → f180 (0° → 360°) |
| `machine` (`wheelL`, `wheelR`) | `lathe` (`profile` + `recess`) | Beveled wheels with recessed hubs (`stack: 0`) | f0 → f180 |
| `machine` (`badge`) | `extrude` | Non-symmetric holed front emblem (`stack: 0`) | f0 → f180 |
| `machine` (`nozzle`) | `lathe` (`profile`) | Tapered rear cone nozzle (`stack: 0`) | f0 → f180 |
| `machine` (`knobL`, `dial`) | `lathe` (`profile` + `innerProfile`) | Top tapered knob and open hollow dial (`stack: 1`) | f0 → f180 |
| `machine` (`button`) | `sphere` | World-lit dome button with moving terminator & highlight (`stack: 1`) | f0 → f180 |

## Values

- Canvas: `800 × 460`, `60 fps`, `180` frames (`3.0 s` loop), `#15171c` background.
- Pyramid: `polyPyramid(116, 126)`, `tilt: 20°`, `paint: ['#B45309', '#F59E0B', '#FBBF24', '#EA580C', '#FB923C']`, `shade: '#78350F'`.
- Machine: `polyBox(150, 96, 86)`, `tilt: 22°`, `focal: 1100`, `lightDir: [-0.55, -0.5, 0.67]`.
- Compiled health: `360` layers, `4456` keyframes, `maxPerTrack: 10`, `antiBake: true`, `mobileReady: true` (iOS/Android OK).

### 3D verification (`verify-3d`)

Three.js ground truth (top) over native Lottie (bottom) across 0°–314°:

- Machine (8 parts, all 4 families): [verify-3d-machine.png](verify-3d-machine.png)
- Pyramid (`polyPyramid`): [verify-3d-pyramid.png](verify-3d-pyramid.png)

## Use it

Engine source: `src/compiler/turntable.ts` (re-exported from `src/compiler/index.ts`; demo build script: `techniques/3d-engine/demo/build.mjs`).

```js
import { CompositionManager, turntableSvg, polyBox, polyPyramid } from './dist/compiler/index.js';

const spec = {
  kind: 'turntable',
  id: 'machine',
  origin: [400, 240],
  tilt: 22,
  focal: 1100,
  lightDir: [-0.55, -0.5, 0.67],
  angle: [{ t: 0, deg: 0 }, { t: 180, deg: 360 }],
  parts: [
    { type: 'poly', name: 'body', center: [0, 8, 0], ...polyBox(150, 96, 86), paint: '#475569', shade: '#162032' },
    { type: 'lathe', name: 'knob', center: [-38, -53, 0], rotation: [0, 0, -90], profile: [[-12, 18], [12, 13]], side: '#0EA5E9', ends: { pos: { paint: '#7DD3FC' } }, stack: 1 },
    { type: 'extrude', name: 'badge', center: [0, 8, 51], depth: 14, outline: 'M -30 -20 L 30 -20 L 30 20 L -30 20 Z', face: '#E2E8F0', edge: '#475569' },
    { type: 'sphere', name: 'btn', center: [36, -61, 0], radius: 20, paint: '#F97316', shade: '#9A3412', stack: 1 },
  ],
};

// 1. Put `turntableSvg(spec)` inside your scene SVG and import it.
// 2. Apply `mgr.applyPrimitive(sceneId, spec)` and verify with `npm run verify-3d -- <scene>`.
```

## Avoid

- **No surface art wrapped on spheres:** spherical UV projection cannot be represented cleanly in native Lottie; keep spheres to solid/shaded colour + radial highlight.
- **No interpenetrating parts on the same stack:** two solids passing through each other cannot be sorted by centre depth. Separate them or assign explicit `stack` layers (the engine warns on same-stack interpenetration > 1.5 px).
- **No deforming / organic characters:** the engine is for rigid solids; characters and organic morphs stay 2D animation.
- **Flat faces require skew (`lottie-ios 4.4+`):** `poly`, `extrude` faces, and `lathe` ends use native Lottie layer skew (`sk`/`sa`).
- **Always check in-between frames with `verify-3d`:** linear vertex morphing can stray between poses even when poses are exact.
