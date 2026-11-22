// npm run verify-3d -- <scene> [a,b,c] [--id hp] [--scale 2] [--ortho]   (also: npm run verify-turntable)
// Checks a turntable (the `turntable` primitive in the scene's comp.json) against the real thing: renders the same
// model as true 3D geometry in three.js (flat colours, the same turn angle and rig as each frame) and stacks it over
// the Lottie's frames, cropped like verify-shapes, into `out/<scene>-turntable.png`: 3D on top, Lottie below.
// Without frames it takes eight across the last half-turn. With a focal length the 3D camera is a true perspective
// one (the Lottie scales each part about its own centre instead); --ortho compares without perspective.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { ROOT, PROJECT } from '../server/project.mjs';

const argv = process.argv.slice(2);
const scene = argv[0];
if (!scene || scene.startsWith('--')) {
  console.log('usage: npm run verify-3d -- <scene> [a,b,c] [--id <turntable id>] [--scale 2] [--ortho]');
  process.exit(1);
}
const opt = (k) => { const i = argv.indexOf('--' + k); return i < 0 ? null : argv[i + 1]; };
const framesArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const scale = +(opt('scale') ?? 2);
const ortho = argv.includes('--ortho');

const req = createRequire(path.join(ROOT, 'package.json'));
const sharp = req('sharp');
const { CompositionManager, renderLottieCloseups, launchHeadlessBrowser, turntableAngleAt, turntablePose, sampleLottieProp, geometry: g } = await import(
  pathToFileURL(path.join(ROOT, 'dist', 'compiler', 'index.js')).href
);
const mgr = new CompositionManager(PROJECT, ROOT);
const compiled = await mgr.compile(scene);
const specs = compiled.spec.primitives.filter((p) => p.kind === 'turntable');
const spec = opt('id') ? specs.find((s) => s.id === opt('id')) : specs[0];
if (!spec) {
  console.log(`No turntable${opt('id') ? ` "${opt('id')}"` : ''} in ${scene} (comp.json primitives).`);
  process.exit(1);
}
const tokens = compiled.spec.tokens;
const angleAt = (t) => turntableAngleAt(spec, t, tokens);
const ts = spec.angle.map((s) => s.t);
const [t0, t1] = [Math.min(...ts), Math.max(...ts)];

let frames = framesArg ? framesArg.split(',').map(Number).filter(Number.isFinite) : [];
if (!frames.length) {
  // eight frames across the last half-turn
  let a = t1;
  while (a > t0 && Math.abs(angleAt(t1) - angleAt(a)) < 180) a -= 0.25;
  frames = Array.from({ length: 8 }, (_, k) => Math.round(a + ((t1 - 1 - a) * (k + 0.5)) / 8));
}

// the Lottie close-ups (and the crop the 3D render reuses)
const sheet = await renderLottieCloseups({
  doc: compiled.doc,
  defsXml: compiled.defsXml,
  filters: compiled.filters,
  studioRoot: ROOT,
  outPath: path.join(PROJECT, 'out', `${scene}-turntable-lottie.png`),
  frames,
  scale,
});
fs.rmSync(sheet.outPath, { force: true });

// flat colours for the 3D parts: a fill colour, or a gradient's middle stop
const defs = compiled.defsXml;
const colourOf = (paint, fallback) => {
  if (!paint) return fallback;
  const fill = paint.trim().startsWith('<') ? (paint.match(/fill="([^"]+)"/)?.[1] ?? fallback) : paint;
  const ref = fill.match(/^url\(#([^)]+)\)$/);
  if (!ref) return /^#[0-9a-f]{3,8}$/i.test(fill) ? fill.slice(0, 7) : fallback;
  const grad = defs.match(new RegExp(`<(linear|radial)Gradient[^>]*id="${ref[1]}"[\\s\\S]*?</\\1Gradient>`))?.[0] ?? '';
  const stops = [...grad.matchAll(/<stop[^>]*offset="([\d.]+)%?"[^>]*stop-color="([^"]+)"/g)].map((m) => [+m[1] > 1 ? +m[1] / 100 : +m[1], m[2]]);
  if (!stops.length) return fallback;
  return stops.reduce((best, s) => (Math.abs(s[0] - 0.5) < Math.abs(best[0] - 0.5) ? s : best))[1];
};
const endModel = (part, e) => {
  const outer = (Math.sign(part.center[0]) || 1) === e;
  const end = (e > 0 ? part.ends?.pos : part.ends?.neg) ?? (outer ? part.outer : part.inner);
  if (!end) return null;
  return {
    colour: colourOf(end.art ?? end.paint, colourOf(part.side, '#888888')),
    recess: end.recess ? { radius: end.recess.radius, depth: end.recess.depth, wall: colourOf(end.recess.wall, '#444444'), base: colourOf(end.recess.base, '#222222') } : null,
  };
};
const sampleProfilePts = (pts) => {
  const norm = pts.map((p) => (Array.isArray(p) ? { x: p[0], r: Math.max(0, p[1]) } : { x: p.x, r: Math.max(0, p.r), in: p.in, out: p.out }));
  const ord = norm[0].x > norm[norm.length - 1].x ? [...norm].reverse().map((k) => ({ x: k.x, r: k.r, in: k.out, out: k.in })) : norm;
  const out = [];
  for (let j = 0; j < ord.length - 1; j++) {
    const a = ord[j], b = ord[j + 1];
    const p0 = [a.x, a.r], p3 = [b.x, b.r];
    const hasH = (a.out && (a.out[0] || a.out[1])) || (b.in && (b.in[0] || b.in[1]));
    const p1 = hasH ? [a.x + (a.out?.[0] ?? 0), a.r + (a.out?.[1] ?? 0)] : [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3];
    const p2 = hasH ? [b.x + (b.in?.[0] ?? 0), b.r + (b.in?.[1] ?? 0)] : [p0[0] + (2 * (p3[0] - p0[0])) / 3, p0[1] + (2 * (p3[1] - p0[1])) / 3];
    const steps = hasH ? 24 : 4;
    for (let s = j === 0 ? 0 : 1; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
      const r = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
      out.push([Math.max(0, r), x]);
    }
  }
  return { pts: out, xNeg: ord[0].x, rNeg: ord[0].r, xPos: ord[ord.length - 1].x, rPos: ord[ord.length - 1].r };
};
const model = spec.parts.map((p) => {
  if (p.type === 'disc' || p.type === 'lathe') {
    if (Array.isArray(p.profile) && p.profile.length >= 2) {
      const prof = sampleProfilePts(p.profile);
      let inner = null;
      if (Array.isArray(p.innerProfile) && p.innerProfile.length >= 2) {
        const ip = sampleProfilePts(p.innerProfile);
        const openEnd = Math.abs(ip.xPos - prof.xPos) <= Math.abs(ip.xNeg - prof.xNeg) ? 1 : -1;
        inner = {
          pts: ip.pts,
          openEnd,
          xRim: openEnd > 0 ? ip.xPos : ip.xNeg,
          rRim: openEnd > 0 ? ip.rPos : ip.rNeg,
          xFloor: openEnd > 0 ? ip.xNeg : ip.xPos,
          rFloor: openEnd > 0 ? ip.rNeg : ip.rPos,
          paint: colourOf(p.innerPaint, colourOf(p.side, '#555555')),
          base: colourOf(p.innerBase ?? p.innerPaint, colourOf(p.side, '#333333')),
        };
      }
      return {
        type: 'latheProfile',
        profilePts: prof.pts,
        xNeg: prof.xNeg, rNeg: prof.rNeg, xPos: prof.xPos, rPos: prof.rPos,
        inner,
        side: colourOf(p.side, '#888888'),
        ends: { '1': endModel(p, 1), '-1': endModel(p, -1) },
      };
    }
    return {
      type: 'disc', radius: p.radius, depth: p.depth, rim: p.rim ?? 0, side: colourOf(p.side, '#888888'),
      ends: { '1': endModel(p, 1), '-1': endModel(p, -1) },
    };
  }
  if (p.type === 'sphere') {
    const ld = p.lightDir ?? spec.lightDir ?? [-0.55, -0.55, 0.63];
    const len = Math.hypot(...ld) || 1;
    return {
      type: 'sphere',
      radius: p.radius,
      paint: colourOf(p.paint, '#aaaaaa'),
      shade: colourOf(p.shade, '#444444'),
      highlight: p.highlight === false ? null : colourOf(typeof p.highlight === 'string' ? p.highlight : '#ffffff', '#ffffff'),
      highlightOpacity: (p.highlightOpacity ?? 55) / 100,
      lightDir: ld.map((v) => v / len),
    };
  }
  if (p.type === 'poly') return { type: 'poly', vertices: p.vertices, faces: p.faces };
  const contours = g.toLottiePaths(g.fromSvgPath(p.outline));
  return {
    type: 'extrude',
    path: contours[0],
    holes: contours.slice(1),
    z: p.z ?? 0,
    depth: p.depth,
    face: colourOf(p.face, '#aaaaaa'),
    edge: colourOf(p.edge, '#555555'),
  };
});
const rigLayer = compiled.doc.layers.find((l) => l.ln === `${spec.id}.rig`);
// a polyhedron face's colour: shade edge-on to paint facing the camera (as the Lottie lights it)
const L = spec.light ?? 0.6;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const faceColours = (p, pose) => {
  const mid = p.vertices.reduce((a, v) => a.map((x, i) => x + v[i] / p.vertices.length), [0, 0, 0]);
  return p.faces.map((idx, k) => {
    const vs = idx.map((i) => p.vertices[i]);
    const c = vs.reduce((a, v) => a.map((x, i) => x + v[i] / vs.length), [0, 0, 0]);
    let n = [0, 0, 0];
    vs.forEach((a, i) => { const b = vs[(i + 1) % vs.length]; n = [n[0] + a[1] * b[2] - a[2] * b[1], n[1] + a[2] * b[0] - a[0] * b[2], n[2] + a[0] * b[1] - a[1] * b[0]]; });
    if (n.reduce((s, x, i) => s + x * (c[i] - mid[i]), 0) < 0) n = n.map((x) => -x);
    const len = Math.hypot(...n), f = pose.rotation[2].reduce((s, x, i) => s + (x * n[i]) / len, 0);
    const u = Math.min(1, Math.max(0, f) / L), lit = u * u * (3 - 2 * u);
    const [a, b] = [hex(Array.isArray(p.shade) ? p.shade[k % p.shade.length] : p.shade), hex(Array.isArray(p.paint) ? p.paint[k % p.paint.length] : p.paint)];
    return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * lit).toString(16).padStart(2, '0')).join('');
  });
};
const shots = frames.map((t) => ({
  poses: turntablePose(spec, t, tokens),
  colours: spec.parts.map((p, k) => (p.type === 'poly' ? faceColours(p, turntablePose(spec, t, tokens)[k]) : null)),
  deg: angleAt(t),
  pos: rigLayer ? sampleLottieProp(rigLayer.ks.p, t) : spec.origin,
  scl: rigLayer ? sampleLottieProp(rigLayer.ks.s, t)[0] / 100 : 1,
}));

const three = fs.readFileSync(path.join(ROOT, 'node_modules', 'three', 'build', 'three.cjs'), 'utf8');
const { w: W, h: H } = compiled.doc;
const browser = await launchHeadlessBrowser(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']);
const tiles3d = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  await page.setContent(`<html><body style="margin:0;background:#15171c"><canvas id="c" style="width:${W}px;height:${H}px;display:block"></canvas></body></html>`);
  await page.addScriptTag({ content: `var module={exports:{}};var exports=module.exports;${three};window.THREE=module.exports;` });
  await page.evaluate(({ model, origin, W, H, scale, focal }) => {
    const T = window.THREE;
    const renderer = new T.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true });
    renderer.setPixelRatio(scale);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x15171c);
    const scene = new T.Scene();
    let cam;
    // model space (y down, z toward the camera, around the turning axis) → three (y up); the image centred on the axis
    if (focal) {
      const fullW = 2 * Math.max(origin[0], W - origin[0]), fullH = 2 * Math.max(origin[1], H - origin[1]);
      cam = new T.PerspectiveCamera((2 * Math.atan(fullH / 2 / focal) * 180) / Math.PI, fullW / fullH, 1, focal * 4);
      cam.setViewOffset(fullW, fullH, fullW / 2 - origin[0], fullH / 2 - origin[1], W, H);
      cam.position.set(0, 0, focal);
    } else {
      cam = new T.OrthographicCamera(-origin[0], W - origin[0], origin[1], origin[1] - H, -4000, 4000);
      cam.position.set(0, 0, 1000);
    }
    const mat = (c) => new T.MeshBasicMaterial({ color: new T.Color(c), side: T.DoubleSide });
    const rig = new T.Group();
    scene.add(rig);
    const holders = [], faceMats = [], sphereMats = [];
    for (const p of model) {
      // each part in its own frame (local px, y flipped), placed every shot by the engine's own pose
      const turn = new T.Group();
      turn.matrixAutoUpdate = false;
      rig.add(turn);
      holders.push(turn);
      faceMats.push([]);
      sphereMats.push(null);
      if (p.type === 'sphere') {
        const sm = new T.ShaderMaterial({
          uniforms: {
            uPaint: { value: new T.Color(p.paint) },
            uShade: { value: new T.Color(p.shade) },
            uHighlight: { value: new T.Color(p.highlight || '#ffffff') },
            uHlOpacity: { value: p.highlight ? p.highlightOpacity : 0 },
            uLightDir: { value: new T.Vector3(p.lightDir[0], -p.lightDir[1], p.lightDir[2]) },
          },
          vertexShader: `
            varying vec3 vN;
            void main() {
              vN = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3 uPaint;
            uniform vec3 uShade;
            uniform vec3 uHighlight;
            uniform float uHlOpacity;
            uniform vec3 uLightDir;
            varying vec3 vN;
            void main() {
              vec3 N = normalize(vN);
              vec3 L = normalize(uLightDir);
              vec3 col = dot(N, L) >= 0.0 ? uPaint : uShade;
              if (uHlOpacity > 0.001 && L.z > 0.0) {
                vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
                float d = max(0.0, dot(N, H));
                float spot = smoothstep(0.92, 0.996, d);
                float lzFade = smoothstep(0.0, 0.35, L.z);
                col = mix(col, uHighlight, spot * lzFade * uHlOpacity);
              }
              gl_FragColor = vec4(col, 1.0);
              #include <colorspace_fragment>
            }
          `,
        });
        sphereMats[sphereMats.length - 1] = { mat: sm, ld: p.lightDir };
        turn.add(new T.Mesh(new T.SphereGeometry(p.radius, 64, 48), sm));
        continue;
      }
      if (p.type === 'poly') {
        for (const idx of p.faces) {
          const pos = [];
          for (let k = 1; k < idx.length - 1; k++) for (const i of [idx[0], idx[k], idx[k + 1]]) pos.push(p.vertices[i][0], -p.vertices[i][1], p.vertices[i][2]);
          const geo = new T.BufferGeometry();
          geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
          const m = mat('#888888');
          faceMats[faceMats.length - 1].push(m);
          turn.add(new T.Mesh(geo, m));
        }
        continue;
      }
      if (p.type === 'extrude' || p.type === 'strip') {
        const buildContour = (ct, target) => {
          const n = ct.v.length;
          target.moveTo(ct.v[0][0], -ct.v[0][1]);
          for (let j = 0; j < n; j++) {
            const a = ct.v[j], b = ct.v[(j + 1) % n], o = ct.o[j], i = ct.i[(j + 1) % n];
            target.bezierCurveTo(a[0] + o[0], -(a[1] + o[1]), b[0] + i[0], -(b[1] + i[1]), b[0], -b[1]);
          }
          return target;
        };
        const sh = buildContour(p.path, new T.Shape());
        for (const h of p.holes || []) sh.holes.push(buildContour(h, new T.Path()));
        const geo = new T.ExtrudeGeometry(sh, { depth: p.depth, bevelEnabled: false, curveSegments: 48 });
        const mesh = new T.Mesh(geo, [mat(p.face), mat(p.edge)]);
        mesh.position.z = -p.depth / 2;
        turn.add(mesh);
        continue;
      }
      if (p.type === 'latheProfile') {
        const grp = new T.Group();
        const prof = p.profilePts.map(([r, x]) => new T.Vector2(r, x));
        const wall = new T.Mesh(new T.LatheGeometry(prof, 96), mat(p.side));
        wall.rotation.z = -Math.PI / 2;
        grp.add(wall);
        if (p.inner) {
          const iprof = p.inner.pts.map(([r, x]) => new T.Vector2(r, x));
          const iwall = new T.Mesh(new T.LatheGeometry(iprof, 96), mat(p.inner.paint));
          iwall.rotation.z = -Math.PI / 2;
          grp.add(iwall);
          if (p.inner.rFloor > 0.5) {
            const floor = new T.Mesh(new T.CircleGeometry(p.inner.rFloor, 96), mat(p.inner.base));
            floor.position.x = p.inner.xFloor;
            floor.rotation.y = (p.inner.openEnd * Math.PI) / 2;
            grp.add(floor);
          }
        }
        for (const e of [1, -1]) {
          const rEnd = e > 0 ? p.rPos : p.rNeg;
          const xEnd = e > 0 ? p.xPos : p.xNeg;
          if (rEnd <= 0.5) continue;
          const end = p.ends[String(e)];
          const cap = new T.Group();
          cap.position.x = xEnd;
          cap.rotation.y = (e * Math.PI) / 2;
          if (p.inner && p.inner.openEnd === e) {
            if (rEnd - p.inner.rRim > 0.5) {
              cap.add(new T.Mesh(new T.RingGeometry(p.inner.rRim, rEnd, 96), mat(end ? end.colour : p.side)));
            }
          } else if (!end) {
            cap.add(new T.Mesh(new T.CircleGeometry(rEnd, 96), mat(p.side)));
          } else if (!end.recess) {
            cap.add(new T.Mesh(new T.CircleGeometry(rEnd, 96), mat(end.colour)));
          } else {
            cap.add(new T.Mesh(new T.RingGeometry(end.recess.radius, rEnd, 96), mat(end.colour)));
            const hole = new T.Mesh(new T.CylinderGeometry(end.recess.radius, end.recess.radius, end.recess.depth, 64, 1, true), mat(end.recess.wall));
            hole.rotation.x = Math.PI / 2;
            hole.position.z = -end.recess.depth / 2;
            cap.add(hole);
            const base = new T.Mesh(new T.CircleGeometry(end.recess.radius, 64), mat(end.recess.base));
            base.position.z = -end.recess.depth;
            cap.add(base);
          }
          grp.add(cap);
        }
        turn.add(grp);
        continue;
      }
      // a disc along x: a lathe (axis y) of its side and rounded rim, turned onto x; flat ends at ±depth/2
      const disc = new T.Group();
      const r = p.rim, R = p.radius, hd = p.depth / 2, prof = [];
      for (let k = 0; k <= 12; k++) { const a = (-Math.PI / 2) * (1 - k / 12); prof.push(new T.Vector2(R - r + r * Math.cos(a), -hd + r + r * Math.sin(a))); }
      for (let k = 0; k <= 12; k++) { const a = (Math.PI / 2) * (k / 12); prof.push(new T.Vector2(R - r + r * Math.cos(a), hd - r + r * Math.sin(a))); }
      const wall = new T.Mesh(new T.LatheGeometry(prof, 96), mat(p.side));
      wall.rotation.z = -Math.PI / 2; // lathe +y → +x
      disc.add(wall);
      for (const e of [1, -1]) {
        const end = p.ends[String(e)];
        const cap = new T.Group();
        cap.position.x = e * hd;
        cap.rotation.y = (e * Math.PI) / 2; // the cap's +z faces out along ±x
        if (!end) {
          cap.add(new T.Mesh(new T.CircleGeometry(R - r, 96), mat(p.side)));
        } else if (!end.recess) {
          cap.add(new T.Mesh(new T.CircleGeometry(R - r, 96), mat(end.colour)));
        } else {
          cap.add(new T.Mesh(new T.RingGeometry(end.recess.radius, R - r, 96), mat(end.colour)));
          const hole = new T.Mesh(new T.CylinderGeometry(end.recess.radius, end.recess.radius, end.recess.depth, 64, 1, true), mat(end.recess.wall));
          hole.rotation.x = Math.PI / 2; // along the cap's z
          hole.position.z = -end.recess.depth / 2;
          cap.add(hole);
          const base = new T.Mesh(new T.CircleGeometry(end.recess.radius, 64), mat(end.recess.base));
          base.position.z = -end.recess.depth;
          cap.add(base);
        }
        disc.add(cap);
      }
      turn.add(disc);
    }
    window.__shot = (poses, colours, pos, scl) => {
      // model (y down) → three (y up): flip y on both sides of each part's rotation and in its centre
      poses.forEach((ps, k) => {
        const R = ps.rotation, c = ps.center;
        holders[k].matrix.set(
          R[0][0], -R[0][1], R[0][2], c[0],
          -R[1][0], R[1][1], -R[1][2], -c[1],
          R[2][0], -R[2][1], R[2][2], c[2],
          0, 0, 0, 1,
        );
        if (colours[k]) colours[k].forEach((col, f) => faceMats[k][f].color.set(col));
        if (sphereMats[k]) {
          const ld = sphereMats[k].ld;
          const lv = [
            R[0][0] * ld[0] + R[0][1] * ld[1] + R[0][2] * ld[2],
            R[1][0] * ld[0] + R[1][1] * ld[1] + R[1][2] * ld[2],
            R[2][0] * ld[0] + R[2][1] * ld[1] + R[2][2] * ld[2],
          ];
          sphereMats[k].mat.uniforms.uLightDir.value.set(lv[0], -lv[1], lv[2]);
        }
      });
      rig.updateMatrixWorld(true);
      rig.scale.setScalar(Math.max(1e-4, scl));
      rig.position.set(pos[0] - origin[0], -(pos[1] - origin[1]), 0);
      renderer.render(scene, cam);
    };
  }, { model, origin: spec.origin, W, H, scale, focal: ortho ? 0 : spec.focal ?? 0 });
  const c = sheet.crop;
  for (const s of shots) {
    await page.evaluate(({ poses, colours, pos, scl }) => window.__shot(poses, colours, pos, scl), s);
    tiles3d.push(await page.screenshot({ clip: { x: c.x, y: c.y, width: c.w, height: c.h } }));
  }
} finally {
  await browser.close();
}

// 3D over Lottie, four frames to a row
const [tw, th] = [Math.round(sheet.crop.w * scale), Math.round(sheet.crop.h * scale)];
const pad = 8, cols = Math.min(4, frames.length), rows = Math.ceil(frames.length / cols);
const label = (text) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${12 + text.length * 8}" height="24"><rect width="100%" height="24" rx="5" fill="rgba(12,14,18,.82)"/>` +
  `<text x="7" y="17" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#fff">${text}</text></svg>`,
);
const comps = [];
for (let k = 0; k < frames.length; k++) {
  const x = pad + (k % cols) * (tw + pad), y = pad + Math.floor(k / cols) * (2 * th + 2 * pad);
  const top = await sharp(tiles3d[k]).resize(tw, th, { fit: 'fill' }).png().toBuffer();
  comps.push({ input: top, left: x, top: y }, { input: sheet.tiles[k], left: x, top: y + th + 2 });
  comps.push({ input: label(`3D f${frames[k]} ${Math.round(shots[k].deg % 360)}°`), left: x + 6, top: y + 6 }, { input: label(`Lottie f${frames[k]}`), left: x + 6, top: y + th + 8 });
}
const outPath = path.join(PROJECT, 'out', `${scene}-turntable.png`);
await sharp({ create: { width: cols * (tw + pad) + pad, height: rows * (2 * th + 2 * pad) + pad, channels: 4, background: { r: 17, g: 18, b: 20, alpha: 1 } } })
  .composite(comps)
  .png()
  .toFile(outPath);
console.log(`Turntable "${spec.id}" 3D vs Lottie → ${outPath}`);
console.log(`  frames: [${frames.join(', ')}] · ${scale}x · ${ortho || !spec.focal ? 'orthographic' : `perspective (focal ${spec.focal})`} · 3D on top, Lottie below`);
