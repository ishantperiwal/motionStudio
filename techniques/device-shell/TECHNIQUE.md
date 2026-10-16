# Device shell

A phone with real form for any product film: a ~42 px thick body with solid side walls, extruded buttons, a raised
camera island with raised lenses, a bezel, a Dynamic Island, and a flat white sticker outline traced around its
silhouette. Everything is built from flat faces in CSS 3D under an orthographic camera, so the form comes from
geometry, not from shading. Give it any UI for the screen and turn it however you like. From the Zapp Account film
(the phone that flies in, builds its UI, and splits away in Before / After). Kit: `runtime/kits/device.js`.
Demo: `demo/` (1920×1080, 25 fps, 150 frames, loops: one full turn).

## What makes it work
- **Real thickness, read from any angle.** The body is 26 stacked rings plus solid walls on the straight edges, so it
  reads as one surface edge-on (rings alone show as stripes). The corners stay as the ring stack.
- **Rings, not plates.** Body layers and the bezel have their centres cut out, so nothing solid sits behind the screen
  for the browser's 3D sort to put in front of it.
- **Parts are geometry.** Buttons and the camera island are extruded: a closed ring of wall facets around the outline,
  plus a flat cap. They stay solid at every angle, with no layer stacks to stripe.
- **Flat light.** No gradients pretending to be light (except the back plate's subtle sheen), no shadows, no glows.
  Faces only differ in colour where the real parts would.
- **One sticker outline.** A flat white outline around the rendered silhouette (an SVG filter on the layer) ties it into
  a graphic look and separates it from any background.
- **Orthographic.** `perspective: none`: no foreshortening, so the phone stays crisp and diagram-like as it turns.

## Parts
| # | Part | What it is |
|---|---|---|
| 1 | Body | 26 rings 1.6 px apart (~42 px), solid side walls on the four straight edges, two antenna bands on the left |
| 2 | Buttons | A long pill on the left, the power button on the right: groove, wall facets, cap 3.5 px up |
| 3 | Back | Back plate with a pill-shaped camera island (8 px up), two lenses (5 px more), a flash |
| 4 | Front | Bezel ring, a 360 × 780 screen (rounded 46 px, clipped), Dynamic Island and home indicator on the glass |
| 5 | Outline | Optional: closes small gaps, dilates by `outlineWidth`, fills it with `outlineColor` |

## Values
- Phone 384 × 804, corner radius 58. Screen 360 × 780 at (12, 12), radius 46, lifted 3 px.
- Body `#2B353E`, antenna bands `#4A5661`, bezel `#090D10` with a thin metal rim `#8A96A0`.
- Buttons: wall `#1E262D`, cap `#5A6672`, groove `#151C22`. Island cap `#56636F`, walls `#6B7782`.
- Outline 9 px white (the Zapp film), gap fill `#26313A`.
- In the film: the camera at `rotateX(30deg) rotateZ(-20deg) rotateY(12deg)` for the three-quarter look, and
  `rotateX(22deg) rotateZ(-14deg) rotateY(10deg)` in the demo.

## Use it
```js
import { device } from '@studio/kits/device.js';

const phone = device({ parent: document.getElementById('stage'), name: 'Phone' });
phone.screen.appendChild(myUi);                                   // 360 × 780; build your UI in here
phone.world.style.transform = 'rotateX(22deg) rotateZ(-14deg)';   // a camera (or drive it per frame)
s.beat('phone.turn', { at: 18, dur: 110 }, (b) => b.fromTo(phone.el, { rotationY: 0 }, { rotationY: 360 }));
```
Returns `{ el, screen, world, layer }`: animate `el` (x, y, z, rotations), treat `world` as the camera, `layer` is the
outlined layer (z-index it against the rest of the scene). Options: `body`, `band`, `screen` (colours), `outline`
(default true), `outlineWidth` (9), `outlineColor` (#fff), `buttons` (true), `backCamera` (true), `zIndex`, `name`.
It builds static geometry, so there's nothing to step per frame.

## Avoid
- Fake depth: a drop shadow, a gradient "light" on the body, a glow. The film rejected all three.
- Solid plates behind the screen: the 3D sort can flip them in front for a frame (flicker on playback).
- A filter or `mix-blend-mode` on an element between the layer and the phone: either flattens the 3D.
- Perspective: it makes the phone look like a photo and breaks the diagram feel of the outline.
