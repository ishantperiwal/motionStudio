import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CompositionManager,
  distillMotionCurve,
  inspectLottieHealth,
  normalizeSvgToLottieLayers,
  patchLayerInLast,
  roundTripThroughRelottie,
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

test('MCP Server exposes all 7 core Lottie Studio tools over stdio JSON-RPC', async () => {
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
      'spawn_proxy_sandbox',
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

test('Dev Server Lottie Studio APIs: health, distill, sandbox, async annotate -> To-Check, and export', async () => {
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

    // 4. Proxy sandbox session round-trip
    const opened = await (await fetch(`${base}/api/sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'sbx-test', sceneId: testId, property: 'position', fps: 60 }),
    })).json();
    assert.equal(opened.status, 'open');

    const submitted = await (await fetch(`${base}/api/sandbox`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'submitted',
        samples: [{ t: 0, x: 0, y: 0 }, { t: 250, x: 120, y: 0 }, { t: 500, x: 100, y: 0 }],
      }),
    })).json();
    assert.equal(submitted.status, 'submitted');
    assert.ok(submitted.distilled?.keyframeCount <= 4);
    await fetch(`${base}/api/sandbox`, { method: 'DELETE' });

    // 5. Export .lottie + .json endpoint
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
