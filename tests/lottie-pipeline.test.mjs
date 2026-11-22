import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CompositionManager,
  distillMotionCurve,
  fitBezierTrack,
  geometry,
  inspectLottieHealth,
  normalizeSvgToLottieLayers,
  patchLayerInLast,
  roundTripThroughRelottie,
  turntableSvg,
  turntablePose,
  polyBox,
  polyPyramid,
  sampleLottieProp,
  __internals as turntableInternals,
} from '../dist/compiler/index.js';
import { hitTestLottieAtFrame } from '../dist/mcp/hitTest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.resolve(__dirname, '..');

const COIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <defs>
    <filter id="glowFx" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="10" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  <g id="coin-shadow">
    <ellipse cx="200" cy="330" rx="75" ry="18" fill="#111827" opacity="0.4" />
  </g>
  <g id="coin-glow" filter="url(#glowFx)">
    <circle cx="200" cy="200" r="108" fill="#F59E0B" opacity="0.45" />
  </g>
  <g id="coin-edge">
    <rect x="188" y="100" width="24" height="200" rx="10" fill="#B45309" />
  </g>
  <g id="coin-back">
    <circle cx="200" cy="200" r="96" fill="#F59E0B" stroke="#FEF08A" stroke-width="6" />
  </g>
  <g id="coin-front">
    <circle cx="200" cy="200" r="96" fill="#FBBF24" stroke="#FFFBEB" stroke-width="6" />
    <path d="M 165 205 L 190 230 L 240 172" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
  </g>
</svg>`;

test('SVG-to-LAST normalizer preserves layer IDs, centered anchors, and filter descriptors', () => {
  const res = normalizeSvgToLottieLayers(COIN_SVG, {
    compWidth: 400,
    compHeight: 400,
    durationFrames: 90,
  });

  assert.equal(res.layers.length, 5);
  const ids = res.layers.map((l) => l.ln);
  assert.deepEqual(ids, ['coin-front', 'coin-back', 'coin-edge', 'coin-glow', 'coin-shadow']);

  // Verify explicit centered anchor point on coin-front
  const front = res.layers.find((l) => l.ln === 'coin-front');
  assert.ok(front);
  assert.equal(front.ks.a?.a, 0);
  assert.deepEqual(front.ks.a?.k, [200, 200, 0]);

  // Verify SVG filter detection on coin-glow
  assert.equal(res.filters.length, 1);
  assert.equal(res.filters[0]?.layerId, 'coin-glow');
  assert.ok(res.filters[0]?.kinds.includes('gaussianBlur'));
  assert.ok((res.filters[0]?.bleedPx ?? 0) >= 30);
});

test('Curve distillation (distillMotionCurve) reduces 60Hz samples to 2-4 clean Lottie keyframes', () => {
  // Simulate 60Hz spring-like overshoot gesture over 600ms (37 raw samples)
  const samples = [];
  for (let i = 0; i <= 36; i++) {
    const t = i * (1000 / 60);
    const u = i / 36;
    const x = 180 * (1 - Math.exp(-5.5 * u) * Math.cos(Math.PI * 1.35 * u));
    const y = -40 * Math.sin(Math.PI * u);
    samples.push({ t, x, y });
  }

  const distilled = distillMotionCurve(samples, { fps: 60, maxKeyframes: 4 });
  assert.equal(distilled.dimension, '2d');
  assert.ok(distilled.keyframeCount >= 2 && distilled.keyframeCount <= 4, `expected 2-4 keyframes, got ${distilled.keyframeCount}`);
  assert.ok(distilled.rmsError < 0.15, `expected tight fit, got rmsError=${distilled.rmsError}`);
  // Verify Lottie cubic-bezier x handles stay strictly within [0, 1]
  for (const seg of distilled.segments) {
    assert.ok(seg.bezier[0] >= 0 && seg.bezier[0] <= 1);
    assert.ok(seg.bezier[2] >= 0 && seg.bezier[2] <= 1);
  }
});

test('End-to-end pipeline: Composition, Parametric Primitives, LAST AST Patch, Hit-Test, and Filter-to-Raster .lottie Export', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-lottie-test-'));
  try {
    const mgr = new CompositionManager(tmpDir, STUDIO_ROOT);
    await mgr.createComposition({
      id: 'coin-test',
      name: 'Coin Flip Test',
      width: 400,
      height: 400,
      fps: 60,
      durationFrames: 90,
    });

    await mgr.importSvgAsset({ sceneId: 'coin-test', assetId: 'coin', svgContent: COIN_SVG });

    // Apply Faux-3D Flip + Spring Move + Squash & Stretch
    await mgr.applyPrimitive('coin-test', {
      kind: 'faux3DFlip',
      frontLayerId: 'coin-front',
      backLayerId: 'coin-back',
      edgeLayerId: 'coin-edge',
      shadowLayerId: 'coin-shadow',
      turns: 1,
      startFrame: 6,
      duration: 50,
      liftPx: 28,
    });
    await mgr.applyPrimitive('coin-test', {
      kind: 'springMove',
      layerId: 'coin-glow',
      from: [200, 240],
      to: [200, 200],
      startFrame: 0,
      spring: 'bouncy',
    });

    const compiled = await mgr.compile('coin-test');
    assert.equal(compiled.health.antiBakePass, true, 'Anti-Bake rule must pass');
    assert.equal(compiled.health.mobileReady, true, 'Must be mobile ready');
    assert.ok(compiled.health.maxKeyframesPerTrack <= 5, `Max keyframes per track should stay minimal, got ${compiled.health.maxKeyframesPerTrack}`);

    // Verify relottie LAST AST round-trip
    const rt = roundTripThroughRelottie(compiled.doc);
    assert.equal(rt.ast.hasExpressions, false);

    // Surgical LAST AST patch (change opacity + matte on coin-shadow without regenerating other layers)
    const patched = await mgr.patchLayerAst('coin-test', {
      layerId: 'coin-shadow',
      opacity: { a: 0, k: 65 },
      anchor: [200, 330],
    });
    assert.equal(patched.patchedLayerName, 'coin-shadow');
    const shadowLayer = patched.doc.layers.find((l) => l.ln === 'coin-shadow');
    assert.deepEqual(shadowLayer?.ks.o, { a: 0, k: 65 });

    // SVG DOM hit-test via lottie-web at frame 10 right on the coin center
    const hitRes = await hitTestLottieAtFrame({
      doc: patched.doc,
      frame: 10,
      boundingBox: { x: 160, y: 160, width: 80, height: 80 },
      studioRoot: STUDIO_ROOT,
    });
    assert.ok(hitRes.matches.length >= 1, 'Expected at least 1 culprit layer hit at center');
    assert.ok(
      hitRes.matches.some((m) => m.layerId === 'coin-front' || m.layerId === 'coin-glow'),
      `Expected coin-front or coin-glow in hits, got: ${hitRes.matches.map((m) => m.layerId).join(', ')}`,
    );

    // Filter-to-Raster export -> .json + .lottie
    const exported = await mgr.exportDotLottie('coin-test', { scale: 2, format: 'png' });
    assert.equal(exported.bakedLayers.length, 1, 'coin-glow filter layer should be rasterized');
    assert.equal(exported.bakedLayers[0]?.layerId, 'coin-glow');
    assert.ok(exported.dotLottieBytes > 200, 'Expected non-empty .lottie binary archive');

    const exportedJson = JSON.parse(await fs.readFile(exported.jsonPath, 'utf8'));
    const bakedLayer = exportedJson.layers.find((l) => l.ln === 'coin-glow');
    assert.equal(bakedLayer.ty, 2, 'Filtered layer must swap to LottieImageLayer (ty: 2)');
    assert.equal(exportedJson.assets.length, 1, 'Baked raster image must be embedded in assets[]');
    assert.ok(exportedJson.assets[0].p.startsWith('data:image/png;base64,'));

    // Verify exported health is clean
    const finalHealth = inspectLottieHealth(exportedJson, []);
    assert.equal(finalHealth.antiBakePass, true);
    assert.equal(finalHealth.mobileReady, true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

import { spawn } from 'node:child_process';
import { startServer } from '../server/dev.mjs';

test('All parametric primitives (trimStroke, staggeredEntrance, squashAndStretch) stay minimal-keyframe', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-prims-test-'));
  try {
    const mgr = new CompositionManager(tmpDir, STUDIO_ROOT);
    await mgr.createComposition({ id: 'prims', width: 320, height: 320, fps: 60, durationFrames: 90 });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
      <g id="stroke-ring"><circle cx="160" cy="160" r="80" fill="none" stroke="#4C8DFF" stroke-width="8" /></g>
      <g id="dot-1"><circle cx="100" cy="160" r="14" fill="#F2711C" /></g>
      <g id="dot-2"><circle cx="160" cy="160" r="14" fill="#3FB950" /></g>
      <g id="dot-3"><circle cx="220" cy="160" r="14" fill="#A066FF" /></g>
    </svg>`;
    await mgr.importSvgAsset({ sceneId: 'prims', assetId: 'dots', svgContent: svg });
    await mgr.applyPrimitive('prims', { kind: 'trimStroke', layerId: 'stroke-ring', startFrame: 0, duration: 'short', fromEnd: 0, toEnd: 100 });
    await mgr.applyPrimitive('prims', { kind: 'staggeredEntrance', layerIds: ['dot-1', 'dot-2', 'dot-3'], startFrame: 6, staggerFrames: 4, spring: 'snappy', offset: [0, 36] });
    await mgr.applyPrimitive('prims', { kind: 'squashAndStretch', layerId: 'dot-2', startFrame: 24, duration: 24, intensity: 0.22 });

    const compiled = await mgr.compile('prims');
    assert.equal(compiled.health.antiBakePass, true);
    assert.equal(compiled.health.mobileReady, true);
    assert.ok(compiled.health.maxKeyframesPerTrack <= 4, `Expected <= 4 keyframes per track, got ${compiled.health.maxKeyframesPerTrack}`);

    const ring = compiled.doc.layers.find((l) => l.ln === 'stroke-ring');
    assert.ok(ring && ring.ty === 4 && ring.shapes.some((s) => s.ty === 'tm'), 'trimStroke must add a tm modifier');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('MCP Server exposes the core Lottie Studio tools over stdio JSON-RPC', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-mcp-test-'));
  const proc = spawn(process.execPath, [path.join(STUDIO_ROOT, 'dist', 'mcp', 'index.js'), '--project', tmpDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const rpc = (msg) =>
    new Promise((resolve, reject) => {
      const id = msg.id;
      let buf = '';
      const onData = (chunk) => {
        buf += chunk.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === id) {
              proc.stdout.off('data', onData);
              resolve(parsed);
            }
          } catch {}
        }
      };
      proc.stdout.on('data', onData);
      proc.stdin.write(JSON.stringify(msg) + '\n');
      setTimeout(() => { proc.stdout.off('data', onData); reject(new Error(`RPC timeout for id=${id}`)); }, 8000);
    });

  try {
    const initRes = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    });
    assert.ok(initRes.result?.serverInfo?.name === 'motion-studio-lottie');
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    const listRes = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const names = (listRes.result?.tools || []).map((t) => t.name);
    for (const expected of [
      'create_composition',
      'import_svg_asset',
      'apply_motion_primitive',
      'inspect_annotation',
      'patch_layer_ast',
      'export_dotlottie',
    ]) {
      assert.ok(names.includes(expected), `Missing MCP tool: ${expected}`);
    }

    const createRes = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'create_composition', arguments: { id: 'mcp-coin', width: 400, height: 400, fps: 60, durationFrames: 60 } },
    });
    const created = JSON.parse(createRes.result.content[0].text);
    assert.equal(created.ok, true);
    assert.equal(created.sceneId, 'mcp-coin');

    const importRes = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'import_svg_asset', arguments: { sceneId: 'mcp-coin', assetId: 'coin', svgContent: COIN_SVG } },
    });
    const imported = JSON.parse(importRes.result.content[0].text);
    assert.equal(imported.ok, true);
    assert.ok(imported.layerIds.includes('coin-front'));
  } finally {
    proc.kill('SIGTERM');
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Dev Server Lottie Studio APIs: health, distill, async annotate -> To-Check, and export', async () => {
  const srv = await startServer({ port: 0, watch: false, quiet: true });
  const port = srv.address().port;
  const base = `http://localhost:${port}`;
  const mgr = new CompositionManager(STUDIO_ROOT, STUDIO_ROOT);
  const testId = `_e2e-lottie-${Date.now()}`;

  try {
    await mgr.createComposition({ id: testId, width: 400, height: 400, fps: 60, durationFrames: 60 });
    await mgr.importSvgAsset({ sceneId: testId, assetId: 'coin', svgContent: COIN_SVG });

    // 1. Health endpoint
    const health = await (await fetch(`${base}/api/lottie/health?scene=${testId}`)).json();
    assert.equal(health.health.mobileReady, true);
    assert.equal(health.health.filterLayers.length, 1);

    // 2. Distill endpoint
    const distill = await (await fetch(`${base}/api/lottie/distill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fps: 60,
        samples: [
          { t: 0, x: 0, y: 0 },
          { t: 150, x: 90, y: -15 },
          { t: 300, x: 112, y: -4 },
          { t: 500, x: 100, y: 0 },
        ],
      }),
    })).json();
    assert.ok(distill.keyframeCount >= 2 && distill.keyframeCount <= 4);

    // 3. Async annotate -> logs lightweight MCP payload to _inbox.jsonl without prematurely marking done
    const ann = await (await fetch(`${base}/api/lottie/annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scene: testId,
        frame: 12,
        region: { x: 150, y: 150, w: 100, h: 100 },
        elements: [{ layerId: 'coin-front', name: 'coin-front' }],
        text: 'Make flip midpoint snappier',
      }),
    })).json();
    assert.equal(ann.ok, true);
    assert.equal(ann.payload.frame, 12);
    assert.deepEqual(ann.payload.layers, ['coin-front']);

    // 4. Export .lottie + .json endpoint
    const exp = await (await fetch(`${base}/api/lottie/export?scene=${testId}&scale=2&rasterFmt=png`, { method: 'POST' })).json();
    assert.equal(exp.ok, true);
    assert.equal(exp.bakedLayers.length, 1);
    assert.ok(exp.dotLottieBytes > 200);
  } finally {
    srv.closeAllConnections?.();
    srv.close();
    await fs.rm(path.join(STUDIO_ROOT, 'scenes', testId), { recursive: true, force: true });
    await fs.rm(path.join(STUDIO_ROOT, 'notes', testId), { recursive: true, force: true });
    await fs.rm(path.join(STUDIO_ROOT, 'out', `${testId}.json`), { force: true });
    await fs.rm(path.join(STUDIO_ROOT, 'out', `${testId}.lottie`), { force: true });
  }
});

test('SVG linearGradient & radialGradient compile to native Lottie gf gradient fills', () => {
  const gradSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <defs>
      <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FEF08A" />
        <stop offset="100%" stop-color="#D97706" />
      </linearGradient>
    </defs>
    <g id="coin-face">
      <circle cx="100" cy="100" r="60" fill="url(#goldGrad)" />
    </g>
  </svg>`;
  const res = normalizeSvgToLottieLayers(gradSvg, { compWidth: 200, compHeight: 200, durationFrames: 60 });
  const face = res.layers[0];
  assert.ok(face && face.ty === 4);
  const group = face.shapes[0];
  assert.ok(group && group.ty === 'gr');
  const leaf = group.it[0];
  assert.ok(leaf && leaf.ty === 'gr');
  const gf = leaf.it.find((item) => item.ty === 'gf');
  assert.ok(gf && gf.ty === 'gf', 'Expected native Lottie gradient fill (gf)');
  assert.equal(gf.t, 1);
  assert.equal(gf.g.p, 2);
});

test('Geometry kit constructs exact shapes, booleans and fillets, and matches morph paths without changing them', () => {
  // rounded triangle: 3 straight sides + 3 fillet arcs
  const tri = geometry.toLottiePath(geometry.polygon(0, 0, 100, 3, { cornerRadius: 18 }));
  assert.equal(tri.v.length, 6);
  // a straight side's handles lie exactly on the line between its two vertices
  const straight = tri.v.filter((p, j) => {
    const q = tri.v[(j + 1) % 6];
    const d = [q[0] - p[0], q[1] - p[1]];
    const cross = (h) => Math.abs(h[0] * d[1] - h[1] * d[0]) / Math.hypot(...d);
    return Math.hypot(...d) > 50 && cross(tri.o[j]) < 1e-6 && cross(tri.i[(j + 1) % 6]) < 1e-6;
  });
  assert.equal(straight.length, 3, 'three sides stay true straight lines');

  // boolean union of circles is one contour; filleting it keeps one contour
  const clover = geometry.roundCorners(
    geometry.union(...[45, 135, 225, 315].map((a) => geometry.circle(48 * Math.cos((a * Math.PI) / 180), 48 * Math.sin((a * Math.PI) / 180), 52)), geometry.circle(0, 0, 55)),
    10,
  );
  const cloverPath = geometry.toLottiePath(clover);
  assert.ok(cloverPath.v.length >= 8);
  assert.throws(() => geometry.toLottiePath(geometry.subtract(geometry.circle(0, 0, 50), geometry.circle(0, 0, 20))), /contours/);

  // matching: equal counts, start at the top, and every split point lies on the original outline
  const [a, b] = geometry.matchPaths([tri, cloverPath], 96);
  assert.equal(a.v.length, 96);
  assert.equal(b.v.length, 96);
  assert.ok(a.v[0][1] < -80 && Math.abs(a.v[0][0]) < 2, 'triangle starts at the top of its rounded tip');
  const area = (p) => geometry.area(geometry.fromLottiePath(p));
  assert.ok(Math.abs(area(a) - area(tri)) / area(tri) < 1e-4, 'matched triangle keeps its exact outline');
  assert.ok(Math.abs(area(b) - area(cloverPath)) / area(cloverPath) < 1e-4, 'matched clover keeps its exact outline');
});

test('fitBezierTrack distills 3D perspective orbit curves into <= 9 mobile-safe Lottie keyframes', () => {
  // 180° 3D perspective ring sweep: x = 256 + 180*cos(phi)*persp, scale = 140*persp
  const pose = (t) => {
    const u = Math.max(0, Math.min(1, t / 60));
    const p = u * u * (3 - 2 * u);
    const phi = Math.PI * p;
    const z = -180 * Math.sin(phi);
    const zc = 220 * Math.sin(Math.PI * p) ** 2;
    const persp = 440 / (440 + zc + z);
    return { x: 256 + 180 * Math.cos(phi) * persp, scale: 140 * persp };
  };
  const fx = fitBezierTrack([0, 30, 60], (t) => pose(t).x, { maxKnots: 9, tol: 1.0 });
  const fs = fitBezierTrack([0, 30, 60], (t) => pose(t).scale, { maxKnots: 9, tol: 1.0, vec3: true });

  assert.ok(fx.count <= 9 && fx.count >= 3, `expected 3..9 x knots, got ${fx.count}`);
  assert.ok(fs.count <= 9 && fs.count >= 3, `expected 3..9 scale knots, got ${fs.count}`);
  assert.ok(fx.maxErr < 1.5, `expected tight x fit (<1.5px), got ${fx.maxErr}`);
  assert.ok(fs.maxErr < 1.5, `expected tight scale fit (<1.5%), got ${fs.maxErr}`);
  for (const kf of fx.track.k.slice(0, -1)) {
    assert.ok(kf.o.x[0] >= 0 && kf.o.x[0] <= 1, 'o.x must stay in [0, 1] for iOS/Android');
    assert.ok(kf.i.x[0] >= 0 && kf.i.x[0] <= 1, 'i.x must stay in [0, 1] for iOS/Android');
  }
  assert.equal(fs.track.k[0].s.length, 3, 'vec3 scale keyframes emit [v, v, 100]');
  assert.equal(fs.track.k[0].s[2], 100);
});

test('Anti-bake health uses keyframe density: clean multi-act layer passes, baked bursts fail', () => {
  const makeDoc = (kfs, op = 480) => ({
    v: '5.9.0',
    fr: 60,
    ip: 0,
    op,
    w: 512,
    h: 512,
    nm: 'density-test',
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: 'dot',
        ln: 'dot',
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { s: true, x: { a: 1, k: kfs }, y: { a: 0, k: 256 } },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        ao: 0,
        shapes: [],
        ip: 0,
        op,
        st: 0,
      },
    ],
  });

  // 1. Clean 6-second multi-act 3D orbit distilled with fitBezierTrack (> 10 keyframes, low density ~3 kf/s)
  const longFit = fitBezierTrack(
    [0, 90, 180, 270, 360],
    (t) => 256 + 160 * Math.cos((t / 120) * Math.PI * 2),
    { fps: 60, tol: 1.0 },
  );
  assert.ok(longFit.count > 10, `6s 3-revolution curve should naturally use > 10 knots, got ${longFit.count}`);
  assert.ok(longFit.maxErr < 1.5, `expected tight multi-act fit, got ${longFit.maxErr}`);
  const cleanHealth = inspectLottieHealth(makeDoc(longFit.track.k, 360), []);
  assert.equal(cleanHealth.antiBakePass, true, 'Clean 6s multi-act layer must pass density anti-bake');

  // 2. Baked 1-second track (20 keyframes in 60 frames = 19 kf/s) -> must FAIL
  const baked1s = Array.from({ length: 20 }, (_, i) => ({
    t: i * 3,
    s: [100 + i * 10],
    ...(i < 19 ? { e: [100 + (i + 1) * 10], o: { x: [0.33], y: [0.33] }, i: { x: [0.67], y: [0.67] } } : {}),
  }));
  const bakedHealth = inspectLottieHealth(makeDoc(baked1s, 60), []);
  assert.equal(bakedHealth.antiBakePass, false, 'Baked 1s track must fail anti-bake');
  assert.ok(bakedHealth.issues.some((i) => i.code === 'ANTI_BAKE_VIOLATION'));

  // 3. Hidden 0.5-second baked burst inside a 10-second track -> must FAIL via 1s sliding window
  const hiddenBurst = [
    ...Array.from({ length: 14 }, (_, i) => ({
      t: i * 2,
      s: [100 + i * 5],
      e: [100 + (i + 1) * 5],
      o: { x: [0.33], y: [0.33] },
      i: { x: [0.67], y: [0.67] },
    })),
    { t: 600, s: [200] },
  ];
  const burstHealth = inspectLottieHealth(makeDoc(hiddenBurst, 600), []);
  assert.equal(burstHealth.antiBakePass, false, 'Baked burst inside long track must still fail anti-bake');
});

test('Turntable kit compiles a 3D model (strip + discs) into exact, phase-swapped, mobile-safe native layers', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-turntable-test-'));
  try {
    const cup = (name, x) => ({
      type: 'disc', name, center: [x, 34, 0], radius: 41, depth: 36, rim: 5, stack: 1, side: '#3730A3',
      outer: { name: 'shell', paint: '#6366F1' },
      inner: { name: 'cushion', paint: '#4A407A', recess: { radius: 22, depth: 12, wall: '#251F42', base: '#110D1F' } },
    });
    const spec = {
      kind: 'turntable',
      id: 'hp',
      origin: [256, 252],
      angle: [{ t: 0, deg: 0 }, { t: 96, deg: 360 }],
      focal: 900,
      parts: [
        {
          type: 'strip', name: 'band', depth: 26, face: '#818CF8', edge: '#2B2775', edgeLit: '#5B5FE6',
          outline: 'M -98 5 L -98 0 A 98 98 0 0 1 98 0 L 98 5 L 78 5 L 78 0 A 78 78 0 0 0 -78 0 L -78 5 Z',
        },
        cup('left', -88),
        cup('right', 88),
      ],
    };
    const layers = turntableSvg(spec);
    const ids = [...layers.matchAll(/<g id="([^"]+)"/g)].map((m) => m[1]);
    // the band (under both cups in every phase) is drawn once; the cups come in two phase sets
    assert.deepEqual(ids.slice(0, 4), ['hp-band-edge', 'hp-band-edge-lit', 'hp-band-front', 'hp-band-back']);
    assert.deepEqual(ids.slice(4, 11), ['hp-a-left-wall', 'hp-a-left-cushion-hole', 'hp-a-left-cushion-base', 'hp-a-left-cushion', 'hp-a-left-cushion-veil', 'hp-a-right-wall', 'hp-a-right-shell']);
    assert.equal(ids.length, 18);

    const mgr = new CompositionManager(tmpDir, STUDIO_ROOT);
    await mgr.createComposition({ id: 'tt', width: 512, height: 512, fps: 60, durationFrames: 96 });
    await mgr.importSvgAsset({ sceneId: 'tt', assetId: 'model', svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${layers}\n</svg>` });
    const { compiled } = await mgr.applyPrimitive('tt', spec);
    assert.equal(compiled.health.antiBakePass, true, 'turntable tracks stay within the anti-bake density limits');
    assert.equal(compiled.health.mobileReady, true);
    const doc = compiled.doc;
    const layer = (id) => doc.layers.find((l) => l.ln === id);
    const rig = layer('hp.rig');
    assert.equal(rig.ty, 3, 'a null rig carries the model');
    for (const id of ids) assert.equal(layer(id).parent, rig.ind, `${id} hangs from the rig`);

    // band silhouette: one vertex count at every pose; side-on (90°, frame 24) it is the true strip, 26 px wide
    const band = layer('hp-band-edge').shapes.flatMap(function find(it) { return it.ty === 'gr' ? it.it.flatMap(find) : [it]; }).find((it) => it.ty === 'sh');
    const kfs = band.ks.k;
    assert.equal(new Set(kfs.map((k) => k.s[0].v.length)).size, 1, 'band poses morph vertex for vertex');
    const side = kfs.find((k) => Math.abs(k.t - 24) < 0.01).s[0].v.map((v) => v[0]);
    assert.ok(Math.abs(Math.max(...side) - Math.min(...side) - 26) < 0.05, `side-on band is 26 px wide, got ${Math.max(...side) - Math.min(...side)}`);
    // its notch shuts exactly where the sweep reaches the squeezed inner arch: tan φ = 78 / 13
    const shutT = (Math.atan2(78, 13) / (2 * Math.PI)) * 96;
    assert.ok(kfs.some((k) => Math.abs(k.t - shutT) < 0.02), 'a pose sits where the notch shuts');

    // phase A (left cup far, right cup near) is shown for the first half-turn and swaps out at 180° (frame 48)
    const wallA = layer('hp-a-left-wall').ks.o.k;
    assert.deepEqual(wallA.map((k) => [k.t, k.s[0]]), [[0, 100], [48, 0]]);
    assert.equal(wallA[0].h, 1, 'phases cut on hold keys');
    const wallB = layer('hp-b-left-wall').ks.o.k;
    assert.deepEqual(wallB.map((k) => [k.t, k.s[0]]), [[0, 0], [48, 100]]);
    // lighting: the shell is fully lit while it faces the camera (sin φ ≥ 0.6) and dark edge-on
    const shell = layer('hp-a-right-shell').ks.o.k;
    const litFrom = (Math.asin(0.6) / (2 * Math.PI)) * 96;
    assert.equal(shell[0].s[0], 0);
    assert.ok(shell.some((k) => Math.abs(k.t - litFrom) < 0.02 && k.s[0] === 100), 'fully lit from asin(0.6)');
    // transforms are keyed at quarter turns, not baked
    const xs = layer('hp-a-right-wall').ks.p.x.k;
    assert.ok(xs.length <= 4, `right cup x uses quarter-turn keys within its phase, got ${xs.length}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('3D engine: polyhedron faces are exact affine layers (rotation, skew, scale), culled and lit; lathes take any axis and tilt', async () => {
  const { faceTransform, placeArt } = turntableInternals;
  const pyr = polyPyramid(120, 130);
  const spec = {
    kind: 'turntable', id: 'e', origin: [256, 256], tilt: 20,
    angle: [{ t: 0, deg: 0 }, { t: 120, deg: 360 }],
    parts: [
      { type: 'poly', name: 'pyr', center: [-100, 10, 0], ...pyr, paint: '#F59E0B', shade: '#7C2D12' },
      { type: 'lathe', name: 'cup', center: [100, 0, 0], rotation: [0, 0, 30], radius: 48, depth: 40, rim: 6, side: '#3730A3', ends: { pos: { name: 'shell', paint: '#818CF8' } } },
    ],
  };
  // the decomposition is exact: the art's corners land on the projected vertices at any turn
  for (const t of [7, 33, 61, 94]) {
    const pose = turntablePose(spec, t)[0];
    const pl = { c: pose.center, m: pose.rotation, p: 1 };
    const stage = (v) => [0, 1].map((i) => spec.origin[i] + pose.center[i] + pose.rotation[i].reduce((s, x, j) => s + x * v[j], 0));
    for (const face of pyr.faces) {
      const vs = face.map((i) => pyr.vertices[i]);
      const c = [0, 1, 2].map((i) => vs.reduce((s, v) => s + v[i], 0) / vs.length);
      // the same art frame the engine uses: down = y laid into the face, right = down × normal
      let n = [0, 0, 0];
      vs.forEach((a, i) => { const b = vs[(i + 1) % vs.length]; n = [n[0] + a[1] * b[2] - a[2] * b[1], n[1] + a[2] * b[0] - a[0] * b[2], n[2] + a[0] * b[1] - a[1] * b[0]]; });
      const ln = Math.hypot(...n); n = n.map((x) => x / ln);
      if (n.reduce((s, x, i) => s + x * c[i], 0) < 0) n = n.map((x) => -x);
      let d = [-n[0] * n[1], 1 - n[1] * n[1], -n[2] * n[1]];
      if (Math.hypot(...d) < 1e-6) d = n[1] < 0 ? [0, 0, 1] : [0, 0, -1];
      const ld = Math.hypot(...d); d = d.map((x) => x / ld);
      const r = [d[1] * n[2] - d[2] * n[1], d[2] * n[0] - d[0] * n[2], d[0] * n[1] - d[1] * n[0]];
      const v = faceTransform(spec, pl, { c, n, d, r });
      for (const p of vs) {
        const q = [0, 1, 2].map((i) => p[i] - c[i]);
        const got = placeArt(v, [q.reduce((s, x, i) => s + x * r[i], 0), q.reduce((s, x, i) => s + x * d[i], 0)]);
        const want = stage(p);
        assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 1e-6, `face corner off by ${Math.hypot(got[0] - want[0], got[1] - want[1])}`);
      }
    }
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-engine-test-'));
  try {
    const layers = turntableSvg(spec);
    const ids = [...layers.matchAll(/<g id="([^"]+)"/g)].map((m) => m[1]);
    // looked at from above, the pyramid's base is never seen: it gets no layer
    assert.ok(!ids.some((id) => id.endsWith('-pyr-f0')), 'the hidden base face is culled away entirely');
    assert.ok(ids.some((id) => id.startsWith('e-a-')) && ids.some((id) => id.startsWith('e-b-')), 'the pyramid and cup swap paint order in two phases');
    const mgr = new CompositionManager(tmpDir, STUDIO_ROOT);
    await mgr.createComposition({ id: 'eng', width: 512, height: 512, fps: 60, durationFrames: 120 });
    await mgr.importSvgAsset({ sceneId: 'eng', assetId: 'model', svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${layers}\n</svg>` });
    const { compiled } = await mgr.applyPrimitive('eng', spec);
    assert.equal(compiled.health.antiBakePass, true);
    assert.equal(compiled.health.mobileReady, true);
    // the keyed transforms stay within ~0.5 px of the true face corners while the face shows
    const doc = compiled.doc;
    const face = doc.layers.find((l) => /-pyr-f1$/.test(l.ln) && l.ln.startsWith('e-a-'));
    assert.ok(face.ks.sk && face.ks.sk.a === 1, 'a sloped face is keyed with skew');
    const [ax, ay] = face.ks.a.k;
    const vs = pyr.faces[1].map((i) => pyr.vertices[i]);
    let worst = 0;
    for (let t = 1; t < 59; t += 1.5) {
      if (sampleLottieProp(face.ks.o, t)[0] < 50) continue;
      const pose = turntablePose(spec, t)[0];
      const v = [...sampleLottieProp(face.ks.p, t), ...sampleLottieProp(face.ks.r, t), ...sampleLottieProp(face.ks.sk, t), ...sampleLottieProp(face.ks.s, t).slice(0, 2)];
      // the drawn art's corners, relative to the anchor, from the imported path
      const sh = face.shapes.flatMap(function find(it) { return it.ty === 'gr' ? it.it.flatMap(find) : [it]; }).find((it) => it.ty === 'sh');
      const art = sh.ks.k.v.map(([x, y]) => [x - ax, y - ay]);
      const got = art.map((q) => placeArt(v, q));
      const want = vs.map((p) => [0, 1].map((i) => spec.origin[i] + pose.center[i] + pose.rotation[i].reduce((s, x, j) => s + x * p[j], 0)));
      for (const w of want) worst = Math.max(worst, Math.min(...got.map((g) => Math.hypot(g[0] - w[0], g[1] - w[1]))));
    }
    assert.ok(worst < 0.8, `keyed face corners within 0.8 px of the truth, got ${worst.toFixed(3)}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('3D engine stage 2: extrude (non-symmetric holed outline on tilted axis) fits <= 0.5 px at poses, constant vertices, clean edge-on swap', async () => {
  const { ExtrudeModel, shapeError } = turntableInternals;
  const spec = {
    kind: 'turntable',
    id: 'ext',
    origin: [256, 256],
    axis: [0.18, -1, 0],
    tilt: 22,
    angle: [{ t: 0, deg: 0 }, { t: 180, deg: 360 }],
    parts: [
      {
        type: 'extrude',
        name: 'p',
        depth: 36,
        outline:
          'M -60 -95 L 12 -95 A 55 55 0 0 1 12 15 L -24 15 L -24 95 L -60 95 Z ' +
          'M -24 -64 L -24 -16 L 10 -16 A 24 24 0 0 0 10 -64 Z',
        face: '#60A5FA',
        edge: '#1E3A8A',
        edgeLit: '#3B82F6',
      },
    ],
  };

  // 1. Pose fit within 0.5 px of exact Minkowski-sum silhouette across sampled orientations
  const model = new ExtrudeModel(spec.parts[0], spec.origin);
  for (const f of [0, 15, 30, 47, 75, 110, 137, 165]) {
    const R = turntablePose(spec, f)[0].rotation;
    const raw = model.projectRaw(R);
    const fixed = model.poseContours(R, [null])[0];
    const err = shapeError(raw.outer, fixed);
    assert.ok(err <= 0.5, `extrude pose at f${f} must be <= 0.5 px of exact Minkowski silhouette, got ${err.toFixed(3)} px`);
  }

  // 2. End-to-end compile: constant vertex counts across all poses (outer + hole), clean front/back swap at edge-on, mobile-safe
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-extrude-test-'));
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${turntableSvg(spec)}\n</svg>`;
    const mgr = new CompositionManager(tmpDir, STUDIO_ROOT);
    await mgr.createComposition({ id: 'ext', width: 512, height: 512, fps: 60, durationFrames: 180 });
    await mgr.importSvgAsset({ sceneId: 'ext', assetId: 'p', svgContent: svg });
    const { compiled } = await mgr.applyPrimitive('ext', spec);
    assert.equal(compiled.health.antiBakePass, true, 'extrude scene passes anti-bake');
    assert.equal(compiled.health.mobileReady, true, 'extrude scene is mobileReady');

    const findAllSh = (a, out = []) => { for (const x of a || []) { if (x.ty === 'sh') out.push(x); if (x.it) findAllSh(x.it, out); } return out; };
    const edge = compiled.doc.layers.find((l) => l.ln === 'ext-p-edge');
    const shs = findAllSh(edge.shapes);
    assert.equal(shs.length, 2, 'extrude edge layer carries outer + hole contours natively (no merge paths)');
    for (const sh of shs) {
      const counts = new Set(sh.ks.k.map((k) => k.s[0].v.length));
      assert.equal(counts.size, 1, 'extrude contour vertex count is constant across all poses');
    }

    // Front and back faces never show simultaneously (front > 0 iff m[2][2] > 0; back > 0 iff m[2][2] < 0)
    const front = compiled.doc.layers.find((l) => l.ln === 'ext-p-front');
    const back = compiled.doc.layers.find((l) => l.ln === 'ext-p-back');
    for (let f = 0; f < 180; f += 3) {
      const fz = turntablePose(spec, f)[0].rotation[2][2];
      const fo = sampleLottieProp(front.ks.o, f)[0];
      const bo = sampleLottieProp(back.ks.o, f)[0];
      if (fz > 0.05) assert.equal(bo, 0, `back must be hidden when front faces camera at f${f}`);
      if (fz < -0.05) assert.equal(fo, 0, `front must be hidden when back faces camera at f${f}`);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('3D engine stage 2: lathe profiles (cone, open cup, curved bottle) fit <= 0.5 px at poses, constant vertices, mobile-safe', async () => {
  const { LatheProfileModel, shapeError } = turntableInternals;
  const spec = {
    kind: 'turntable',
    id: 'lathe',
    origin: [400, 260],
    axis: [0.3, -1, 0],
    tilt: 26,
    angle: [{ t: 0, deg: 0 }, { t: 180, deg: 360 }],
    parts: [
      { type: 'lathe', name: 'cone', center: [-170, 0, 0], rotation: [0, 0, -90], profile: [[-55, 48], [55, 0]], side: '#6366F1', ends: { neg: { paint: '#4338CA' } } },
      { type: 'lathe', name: 'cup', center: [0, 0, 0], rotation: [0, 0, -90], profile: [[-34, 38], [34, 48]], innerProfile: [[-24, 32], [34, 42]], side: '#E07A5F', innerPaint: '#8C3B28', innerBase: '#4E1D12', ends: { pos: { paint: '#F4B9A4' }, neg: { paint: '#B55339' } } },
      { type: 'lathe', name: 'bottle', center: [170, 0, 0], rotation: [0, 0, -90], profile: [[-70, 38], { x: -8, r: 40, out: [24, 0] }, { x: 34, r: 15, in: [-14, 0] }, [70, 15]], side: '#10B981', ends: { pos: { paint: '#6EE7B7' }, neg: { paint: '#047857' } } },
    ],
  };

  // 1. Exact envelope fit <= 0.5 px across psi ∈ [0°, 90°] and constant vertex count on all three profiles
  for (const part of spec.parts) {
    const m = new LatheProfileModel(part, [0, 0]);
    const vertCounts = new Set();
    for (const psi of [0, 10, 25, 45, 65, 80, 90]) {
      const p = m.pose(psi);
      vertCounts.add(p.v.length);
      const poly = m.upperEnvelope(psi);
      const full = [...poly, ...poly.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
      const exact = { c: true, v: full, i: full.map(() => [0, 0]), o: full.map(() => [0, 0]) };
      const err = shapeError(p, exact);
      assert.ok(err <= 0.5, `lathe "${part.name}" pose at psi=${psi}° must be <= 0.5 px, got ${err.toFixed(3)} px`);
    }
    assert.equal(vertCounts.size, 1, `lathe "${part.name}" keeps constant vertex count`);
  }

  // 2. End-to-end compile: cone apex gets no +x end cap, cup emits inner-wall + inner-base, anti-bake & mobile pass
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-lathe-test-'));
  try {
    const layersXml = turntableSvg(spec);
    assert.ok(!layersXml.includes('cone-pos'), 'cone apex (r = 0) gets no end cap layer');
    assert.ok(layersXml.includes('cup-pos-inner-wall') && layersXml.includes('cup-pos-inner-base'), 'open cup emits inner-wall and inner-base layers');
    const mgr = new CompositionManager(tmpDir, STUDIO_ROOT);
    await mgr.createComposition({ id: 'lt', width: 800, height: 520, fps: 60, durationFrames: 180 });
    await mgr.importSvgAsset({ sceneId: 'lt', assetId: 'lt', svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520">${layersXml}\n</svg>` });
    const { compiled } = await mgr.applyPrimitive('lt', spec);
    assert.equal(compiled.health.antiBakePass, true);
    assert.equal(compiled.health.mobileReady, true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('3D engine stage 2: sphere terminator & highlight, interpenetration warnings, and registered demo mobile health', async () => {
  const { SphereModel, detectInterpenetrations } = turntableInternals;
  const spec = {
    kind: 'turntable',
    id: 'sp',
    origin: [320, 240],
    tilt: 20,
    lightDir: [-0.55, -0.45, 0.7],
    angle: [{ t: 0, deg: 0 }, { t: 180, deg: 360 }],
    parts: [
      { type: 'poly', name: 'box', center: [-80, 0, 0], ...polyBox(80, 80, 80), paint: '#38BDF8', shade: '#0C4A6E' },
      { type: 'sphere', name: 'orb', center: [80, 0, 0], radius: 48, paint: '#F97316', shade: '#9A3412' },
    ],
  };

  // 1. Sphere terminator always has exactly 4 vertices and matches x = -lz * R at midpoint
  const sm = new SphereModel(spec.parts[1], [0, 0]);
  for (const lz of [-1, -0.5, 0, 0.5, 1]) {
    const p = sm.shadePose(lz);
    assert.equal(p.v.length, 4, 'sphere terminator always has 4 vertices');
    assert.ok(Math.abs(p.v[1][0] - -lz * 48) < 1e-6, 'terminator midpoint sits at x = -lz * R');
  }

  // 2. Interpenetration detection: clean scene -> 0 warnings; overlapping same-stack -> warning; different stacks -> 0 warnings
  assert.deepEqual(detectInterpenetrations(spec), []);
  const overlapSpec = { ...spec, parts: [spec.parts[0], { ...spec.parts[1], center: [-30, 0, 0] }] };
  assert.equal(detectInterpenetrations(overlapSpec).length, 1, 'detects interpenetrating parts on the same stack');
  const diffStackSpec = { ...spec, parts: [spec.parts[0], { ...spec.parts[1], center: [-30, 0, 0], stack: 1 }] };
  assert.deepEqual(detectInterpenetrations(diffStackSpec), [], 'explicitly stacked parts do not warn');

  // 3. Registered 3D engine demo (`techniques/3d-engine/demo/animation.json`) passes anti-bake and mobile health with zero merge paths / expressions
  const demoDoc = JSON.parse(await fs.readFile(path.join(STUDIO_ROOT, 'techniques', '3d-engine', 'demo', 'animation.json'), 'utf8'));
  const demoHealth = inspectLottieHealth(demoDoc, []);
  assert.equal(demoHealth.antiBakePass, true, '3D engine demo passes anti-bake');
  assert.equal(demoHealth.mobileReady, true, '3D engine demo is mobileReady');
  assert.equal(demoHealth.issues.filter((i) => i.severity === 'error').length, 0, '3D engine demo has zero health errors');
  const demoJson = JSON.stringify(demoDoc);
  assert.ok(!demoJson.includes('"x":"'), '3D engine demo uses zero JS expressions');
  assert.ok(!demoJson.includes('"ty":"mm"'), '3D engine demo contains zero merge paths');
});
