import { matchPaths } from './geometry.js';
import { applyTurntable } from './turntable.js';
import {
  clampBezierX,
  resolveDurationFrames,
  resolveEaseToken,
  resolveSpringToken,
  round2,
  round4,
} from './tokens.js';
import type {
  CubicBezierTuple,
  Faux3DFlipParams,
  KeyframeTrackParams,
  LottieAnimatedProp,
  LottieBezierPath,
  LottieDocument,
  LottieKeyframe,
  LottieLayer,
  LottiePositionProp,
  LottieProp,
  LottieShapeItem,
  LottieShapeLayer,
  LottieShapePath,
  LottieShapeTrim,
  MotionPrimitiveSpec,
  MotionTokens,
  ShapeMorphParams,
  SpringMoveParams,
  SpringToken,
  SquashAndStretchParams,
  StaggeredEntranceParams,
  TrimStrokeParams,
} from './types.js';

export function bezierToLottieTangents(
  curve: CubicBezierTuple,
  dims: number = 1,
): { o: { x: number[]; y: number[] }; i: { x: number[]; y: number[] } } {
  const [x1, y1, x2, y2] = clampBezierX(curve);
  const rep = (v: number): number[] => Array.from({ length: dims }, () => v);
  return {
    o: { x: rep(x1), y: rep(y1) },
    i: { x: rep(x2), y: rep(y2) },
  };
}

export function makeScalarTrack(
  stops: Array<{ t: number; v: number; ease?: CubicBezierTuple; hold?: boolean }>,
): LottieAnimatedProp<number> {
  const kfs: LottieKeyframe<number>[] = stops.map((stop, idx) => {
    const next = stops[idx + 1];
    if (!next) {
      return { t: round2(stop.t), s: [round4(stop.v)] as unknown as number };
    }
    if (stop.hold) {
      return {
        t: round2(stop.t),
        s: [round4(stop.v)] as unknown as number,
        h: 1,
      };
    }
    const [x1, y1, x2, y2] = clampBezierX(stop.ease ?? [0.16, 1, 0.3, 1]);
    return {
      t: round2(stop.t),
      s: [round4(stop.v)] as unknown as number,
      e: [round4(next.v)] as unknown as number,
      o: { x: [x1], y: [y1] },
      i: { x: [x2], y: [y2] },
    };
  });
  return { a: 1, k: kfs };
}

export function makeVectorTrack(
  stops: Array<{ t: number; v: number[]; ease?: CubicBezierTuple; hold?: boolean }>,
): LottieAnimatedProp<number[]> {
  const kfs: LottieKeyframe<number[]>[] = stops.map((stop, idx) => {
    const next = stops[idx + 1];
    const s = stop.v.map(round4);
    if (!next) {
      return { t: round2(stop.t), s };
    }
    if (stop.hold) {
      return { t: round2(stop.t), s, h: 1 };
    }
    const { o, i } = bezierToLottieTangents(stop.ease ?? [0.16, 1, 0.3, 1], s.length);
    return {
      t: round2(stop.t),
      s,
      e: next.v.map(round4),
      o,
      i,
    };
  });
  return { a: 1, k: kfs };
}

/**
 * Analytically solves a damped harmonic oscillator (stiffness, damping, mass) and
 * distills it into 2–4 minimal keyframes with exact cubic-bezier tangents.
 * Respects `overshootLimit` from Design System Motion Tokens.
 */
export function solveSpringStops(
  from: number,
  to: number,
  spring: Required<SpringToken>,
  fps: number,
  startFrame: number,
  overshootLimit: number,
): Array<{ t: number; v: number; ease?: CubicBezierTuple }> {
  const delta = to - from;
  if (Math.abs(delta) < 1e-4) {
    return [{ t: startFrame, v: to }];
  }

  const { stiffness: k, damping: c, mass: m } = spring;
  const omega0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));

  // Critically damped or overdamped -> smooth 2-keyframe curve
  if (zeta >= 0.98) {
    const settleSec = Math.max(0.16, Math.min(1.5, 4.6 / omega0));
    const durF = Math.max(4, Math.round(settleSec * fps));
    return [
      { t: startFrame, v: from, ease: [0.16, 1, 0.3, 1] },
      { t: startFrame + durF, v: to },
    ];
  }

  // Underdamped oscillator: exact peak/trough times t_n = n * pi / omega_d
  const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
  const tPeak1 = Math.PI / omegaD;
  const rawOvershoot1 = Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
  const overshoot1 = Math.min(overshootLimit, rawOvershoot1);

  const fPeak1 = Math.max(3, Math.round(tPeak1 * fps));

  // Subtle overshoot (< 1.5%) -> clean 2-keyframe settle
  if (overshoot1 < 0.015) {
    const settleF = Math.max(6, Math.round((tPeak1 * 1.35) * fps));
    return [
      { t: startFrame, v: from, ease: [0.22, 1, 0.36, 1] },
      { t: startFrame + settleF, v: to },
    ];
  }

  const vPeak1 = to + delta * overshoot1;
  const rawUndershoot2 = Math.exp((-2 * zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));
  const undershoot2 = Math.min(overshootLimit * 0.45, rawUndershoot2);

  // Moderate spring -> 3 keyframes: start -> overshoot peak -> settled rest
  if (undershoot2 < 0.025) {
    const fSettle = fPeak1 + Math.max(4, Math.round(tPeak1 * 0.9 * fps));
    return [
      { t: startFrame, v: from, ease: [0.22, 0.92, 0.38, 1] },
      { t: startFrame + fPeak1, v: vPeak1, ease: [0.42, 0, 0.25, 1] },
      { t: startFrame + fSettle, v: to },
    ];
  }

  // Playful/bouncy spring -> 4 keyframes: start -> peak -> subtle trough -> rest (Anti-Bake cap = 4)
  const vTrough2 = to - delta * undershoot2;
  const fTrough2 = Math.max(fPeak1 + 3, Math.round(2 * tPeak1 * fps));
  const fSettle = fTrough2 + Math.max(4, Math.round(tPeak1 * 0.85 * fps));
  return [
    { t: startFrame, v: from, ease: [0.2, 0.9, 0.38, 1] },
    { t: startFrame + fPeak1, v: vPeak1, ease: [0.42, 0, 0.58, 1] },
    { t: startFrame + fTrough2, v: vTrough2, ease: [0.38, 0, 0.25, 1] },
    { t: startFrame + fSettle, v: to },
  ];
}

export function findLayer(doc: LottieDocument, layerId: string): LottieLayer {
  const layer = doc.layers.find(
    (l) => l.ln === layerId || l.nm === layerId || String(l.ind) === layerId,
  );
  if (!layer) {
    const available = doc.layers.map((l) => l.ln ?? l.nm).join(', ');
    throw new Error(`Layer "${layerId}" not found. Available layers: ${available || '(none)'}`);
  }
  return layer;
}

export function getLayerBasePosition(layer: LottieLayer): [number, number] {
  const p = layer.ks.p;
  if (!p) return [0, 0];
  if ('s' in p) {
    const xv = p.x.a === 0 ? p.x.k : (p.x.k[0]?.s as unknown as number[])?.[0] ?? 0;
    const yv = p.y.a === 0 ? p.y.k : (p.y.k[0]?.s as unknown as number[])?.[0] ?? 0;
    return [Number(xv) || 0, Number(yv) || 0];
  }
  if (p.a === 0) {
    return [p.k[0] ?? 0, p.k[1] ?? 0];
  }
  const first = p.k[0]?.s;
  return [first?.[0] ?? 0, first?.[1] ?? 0];
}

export function getLayerBaseScale(layer: LottieLayer): [number, number] {
  const s = layer.ks.s;
  if (!s) return [100, 100];
  if (s.a === 0) return [s.k[0] ?? 100, s.k[1] ?? 100];
  const first = s.k[0]?.s;
  return [first?.[0] ?? 100, first?.[1] ?? 100];
}

export function applySpringMove(
  doc: LottieDocument,
  params: SpringMoveParams,
  tokens: MotionTokens,
): { layerId: string; keyframesX: number; keyframesY: number; endFrame: number } {
  const layer = findLayer(doc, params.layerId);
  const basePos = getLayerBasePosition(layer);
  const from: [number, number] = params.from ?? basePos;
  const to: [number, number] = params.delta
    ? [from[0] + params.delta[0], from[1] + params.delta[1]]
    : params.to;

  const startFrame = params.startFrame ?? 0;
  const spring = resolveSpringToken(params.spring, tokens, 'snappy');
  const limit = params.overshootLimit ?? tokens.overshootLimit ?? 0.18;

  const xStops = solveSpringStops(from[0], to[0], spring, doc.fr, startFrame, limit);
  const yStops = solveSpringStops(from[1], to[1], spring, doc.fr, startFrame, limit);

  const xProp: LottieProp<number> =
    xStops.length <= 1 ? { a: 0, k: round4(to[0]) } : makeScalarTrack(xStops);
  const yProp: LottieProp<number> =
    yStops.length <= 1 ? { a: 0, k: round4(to[1]) } : makeScalarTrack(yStops);

  // Separated X/Y tracks give exact overshoot parity across lottie-ios, lottie-android, and lottie-web
  const separated: LottiePositionProp = { s: true, x: xProp, y: yProp };
  layer.ks.p = separated;

  const endFrame = Math.max(
    xStops[xStops.length - 1]?.t ?? startFrame,
    yStops[yStops.length - 1]?.t ?? startFrame,
  );
  return {
    layerId: layer.ln ?? layer.nm,
    keyframesX: xStops.length,
    keyframesY: yStops.length,
    endFrame,
  };
}

export function applyTrimStroke(
  doc: LottieDocument,
  params: TrimStrokeParams,
  tokens: MotionTokens,
): { layerId: string; keyframes: number; endFrame: number } {
  const layer = findLayer(doc, params.layerId);
  if (layer.ty !== 4) {
    throw new Error(`trimStroke requires a shape layer (ty: 4), got ty:${layer.ty} on "${params.layerId}"`);
  }
  const shapeLayer = layer as LottieShapeLayer;
  const startFrame = params.startFrame ?? 0;
  const dur = resolveDurationFrames(params.duration, doc.fr, tokens, Math.round(doc.fr * 0.5));
  const ease = resolveEaseToken(params.ease, tokens, 'settle');

  const fromStart = params.fromStart ?? 0;
  const toStart = params.toStart ?? 0;
  const fromEnd = params.fromEnd ?? 0;
  const toEnd = params.toEnd ?? 100;

  const sProp: LottieProp<number> =
    fromStart === toStart
      ? { a: 0, k: fromStart }
      : makeScalarTrack([
          { t: startFrame, v: fromStart, ease },
          { t: startFrame + dur, v: toStart },
        ]);

  const eProp: LottieProp<number> =
    fromEnd === toEnd
      ? { a: 0, k: fromEnd }
      : makeScalarTrack([
          { t: startFrame, v: fromEnd, ease },
          { t: startFrame + dur, v: toEnd },
        ]);

  const oProp: LottieProp<number> = params.offset
    ? makeScalarTrack([
        { t: startFrame, v: params.offset[0], ease },
        { t: startFrame + dur, v: params.offset[1] },
      ])
    : { a: 0, k: 0 };

  const trim: LottieShapeTrim = {
    ty: 'tm',
    nm: 'Trim Paths',
    s: sProp,
    e: eProp,
    o: oProp,
    m: params.mode ?? 1,
  };

  // Replace existing Trim Paths if present, otherwise append at top of layer shapes
  const existingIdx = shapeLayer.shapes.findIndex((item) => item.ty === 'tm');
  if (existingIdx >= 0) {
    shapeLayer.shapes[existingIdx] = trim;
  } else {
    shapeLayer.shapes.push(trim);
  }

  return {
    layerId: layer.ln ?? layer.nm,
    keyframes: 2,
    endFrame: startFrame + dur,
  };
}

export function applyStaggeredEntrance(
  doc: LottieDocument,
  params: StaggeredEntranceParams,
  tokens: MotionTokens,
): { layerIds: string[]; endFrame: number } {
  const startBase = params.startFrame ?? 0;
  const stagger = params.staggerFrames ?? Math.max(2, Math.round(doc.fr * 0.08));
  const dur = resolveDurationFrames(params.duration, doc.fr, tokens, Math.round(doc.fr * 0.4));
  const ease = resolveEaseToken(params.ease, tokens, 'settle');
  const [offX, offY] = params.offset ?? [0, 32];
  const fromOpacity = params.fromOpacity ?? 0;
  const fromScale = params.fromScale ?? 92;

  let maxEnd = startBase;

  params.layerIds.forEach((id, idx) => {
    const layer = findLayer(doc, id);
    const t0 = startBase + idx * stagger;
    const t1 = t0 + dur;
    const basePos = getLayerBasePosition(layer);
    const [sx, sy] = getLayerBaseScale(layer);

    // Opacity (2 keyframes, slightly quicker than travel for crisp motion discipline)
    const fadeDur = Math.max(3, Math.round(dur * 0.65));
    layer.ks.o = makeScalarTrack([
      { t: t0, v: fromOpacity, ease: resolveEaseToken('fade', tokens) },
      { t: t0 + fadeDur, v: 100 },
    ]);

    // Position (spring or parametric cubic-bezier)
    if (params.spring) {
      const res = applySpringMove(
        doc,
        {
          kind: 'springMove',
          layerId: id,
          from: [basePos[0] + offX, basePos[1] + offY],
          to: basePos,
          startFrame: t0,
          spring: params.spring,
        },
        tokens,
      );
      maxEnd = Math.max(maxEnd, res.endFrame);
    } else {
      layer.ks.p = {
        s: true,
        x:
          offX === 0
            ? { a: 0, k: round4(basePos[0]) }
            : makeScalarTrack([
                { t: t0, v: basePos[0] + offX, ease },
                { t: t1, v: basePos[0] },
              ]),
        y:
          offY === 0
            ? { a: 0, k: round4(basePos[1]) }
            : makeScalarTrack([
                { t: t0, v: basePos[1] + offY, ease },
                { t: t1, v: basePos[1] },
              ]),
      };
      maxEnd = Math.max(maxEnd, t1);
    }

    if (fromScale !== 100) {
      layer.ks.s = makeVectorTrack([
        { t: t0, v: [(sx * fromScale) / 100, (sy * fromScale) / 100, 100], ease },
        { t: t1, v: [sx, sy, 100] },
      ]);
    }
  });

  return { layerIds: [...params.layerIds], endFrame: maxEnd };
}

/**
 * Faux-3D Flip using true orthographic cylinder projection & strict layer discipline:
 * - `frontLayerId` & `backLayerId`: faces compressed non-linearly by |cos(theta)| with
 *   exact ±(thickness/2)*sin(theta) horizontal parallax so the active face leads the turn
 * - `rimLayerId`: extruded backing disc matching |cos(theta)| shifted to the OPPOSITE side
 *   ∓(thickness/2)*sin(theta), creating a seamless curved 3D rim silhouette
 * - `edgeLayerId`: cylinder bridge spanning [ -h*sin(theta), +h*sin(theta) ] (peaks at 90°)
 * - `shadowLayerId` & `glowLayerId`: grounded shadow & attached aura moving with the toss arc
 * - Minimal keyframes (strict Anti-Bake compliance) with sinusoidal cubic-bezier tangents.
 */
export function applyFaux3DFlip(
  doc: LottieDocument,
  params: Faux3DFlipParams,
  tokens: MotionTokens,
): { frontLayerId: string; backLayerId: string; edgeLayerId?: string; rimLayerId?: string; keyframesPerLayer: number; endFrame: number } {
  const front = findLayer(doc, params.frontLayerId);
  const back = findLayer(doc, params.backLayerId);
  const edge = params.edgeLayerId ? findLayer(doc, params.edgeLayerId) : undefined;
  const rim = params.rimLayerId ? findLayer(doc, params.rimLayerId) : undefined;
  const shadow = params.shadowLayerId ? findLayer(doc, params.shadowLayerId) : undefined;
  const glow = params.glowLayerId ? findLayer(doc, params.glowLayerId) : undefined;

  const axis = params.axis ?? 'y';
  const turns = Math.max(0.5, params.turns ?? 1);
  const start = params.startFrame ?? 0;
  const totalDur = resolveDurationFrames(params.duration, doc.fr, tokens, Math.round(doc.fr * 0.85));
  const halfFlips = Math.max(1, Math.round(turns * 2));

  // Weighted timing across half-flips: faster launch, graceful deceleration into final face
  const weights: number[] = [];
  for (let h = 0; h < halfFlips; h++) {
    weights.push(1 + (h / Math.max(1, halfFlips)) * 0.28);
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const boundaries: number[] = [start];
  let acc = start;
  for (let h = 0; h < halfFlips; h++) {
    acc += (totalDur * (weights[h] ?? 1)) / weightSum;
    boundaries.push(round2(acc));
  }

  // Exact sinusoidal cubic-bezier approximations:
  // cos(theta) 1 -> 0 over [0, pi/2]  (accelerates smoothly into edge-on)
  const cosClose: CubicBezierTuple = [0.36, 0.0, 0.66, 0.44];
  // cos(theta) 0 -> 1 over [pi/2, pi] (decelerates smoothly out of edge-on)
  const cosOpen: CubicBezierTuple = [0.34, 0.56, 0.64, 1.0];
  // sin(theta) 0 -> 1 over [0, pi/2]  (fast rise into peak thickness at 90°)
  const sinRise: CubicBezierTuple = [0.34, 0.56, 0.64, 1.0];
  // sin(theta) 1 -> 0 over [pi/2, pi] (smooth collapse back to 0 at 180°)
  const sinFall: CubicBezierTuple = [0.36, 0.0, 0.66, 0.44];

  const halfThick = (params.thicknessPx ?? 24) / 2;
  const edgePeak = params.edgeThicknessScale ?? 100;

  const [fsx, fsy] = getLayerBaseScale(front);
  const [bsx, bsy] = getLayerBaseScale(back);
  const [rsx, rsy] = rim ? getLayerBaseScale(rim) : [100, 100];
  const [esx, esy] = edge ? getLayerBaseScale(edge) : [100, 100];

  const [fbx, fby] = getLayerBasePosition(front);
  const [bbx, bby] = getLayerBasePosition(back);
  const [rbx, rby] = rim ? getLayerBasePosition(rim) : [fbx, fby];
  const [ebx, eby] = edge ? getLayerBasePosition(edge) : [fbx, fby];

  const scaleVec = (sx: number, sy: number, factor: number): number[] =>
    axis === 'y' ? [round2(sx * factor), sy, 100] : [sx, round2(sy * factor), 100];

  const frontScale: Array<{ t: number; v: number[]; ease?: CubicBezierTuple }> = [];
  const backScale: Array<{ t: number; v: number[]; ease?: CubicBezierTuple }> = [];
  const rimScale: Array<{ t: number; v: number[]; ease?: CubicBezierTuple }> = [];
  const edgeScale: Array<{ t: number; v: number[]; ease?: CubicBezierTuple }> = [];

  const frontOpacity: Array<{ t: number; v: number; hold?: boolean }> = [];
  const backOpacity: Array<{ t: number; v: number; hold?: boolean }> = [];

  // Parallax X (or Y for X-axis flips) stops
  const frontShift: Array<{ t: number; v: number; ease?: CubicBezierTuple; hold?: boolean }> = [];
  const backShift: Array<{ t: number; v: number; ease?: CubicBezierTuple; hold?: boolean }> = [];
  const rimShift: Array<{ t: number; v: number; ease?: CubicBezierTuple; hold?: boolean }> = [];

  const fBaseMain = axis === 'y' ? fbx : fby;
  const bBaseMain = axis === 'y' ? bbx : bby;
  const rBaseMain = axis === 'y' ? rbx : rby;

  for (let h = 0; h < halfFlips; h++) {
    const t0 = boundaries[h]!;
    const t1 = boundaries[h + 1]!;
    const tMid = round2((t0 + t1) / 2);
    const showingFrontFirst = h % 2 === 0;
    const isLast = h === halfFlips - 1;

    if (h === 0) {
      frontScale.push({ t: t0, v: scaleVec(fsx, fsy, 1), ease: cosClose });
      backScale.push({ t: t0, v: scaleVec(bsx, bsy, 1), ease: cosClose });
      rimScale.push({ t: t0, v: scaleVec(rsx, rsy, 1), ease: cosClose });
      edgeScale.push({ t: t0, v: scaleVec(esx, esy, 0.01), ease: sinRise });

      frontOpacity.push({ t: t0, v: showingFrontFirst ? 100 : 0, hold: true });
      backOpacity.push({ t: t0, v: showingFrontFirst ? 0 : 100, hold: true });

      frontShift.push({ t: t0, v: fBaseMain, ease: sinRise });
      backShift.push({ t: t0, v: bBaseMain, ease: sinRise });
      rimShift.push({ t: t0, v: rBaseMain, ease: sinRise });
    }

    // 90° edge-on crossing:
    // Entering side: visible face shifts to +halfThick, rim shifts to -halfThick, edge spans full thickness.
    // Right across 90° (tMid + 0.01f), emerging face starts at -halfThick while rim flips to +halfThick!
    const tMidNext = round2(tMid + 0.02);

    frontScale.push({ t: tMid, v: scaleVec(fsx, fsy, 0.0001), ease: cosOpen });
    backScale.push({ t: tMid, v: scaleVec(bsx, bsy, 0.0001), ease: cosOpen });
    rimScale.push({ t: tMid, v: scaleVec(rsx, rsy, 0.0001), ease: cosOpen });
    edgeScale.push({ t: tMid, v: scaleVec(esx, esy, edgePeak / 100), ease: sinFall });

    frontOpacity.push({ t: tMid, v: showingFrontFirst ? 0 : 100, hold: true });
    backOpacity.push({ t: tMid, v: showingFrontFirst ? 100 : 0, hold: true });

    // Front/back parallax: front is always on +h while turning away, -h while turning into view
    if (showingFrontFirst) {
      frontShift.push({ t: tMid, v: fBaseMain + halfThick, ease: sinFall });
      backShift.push({ t: tMid, v: bBaseMain - halfThick, ease: sinFall });
      rimShift.push({ t: tMid, v: rBaseMain - halfThick, hold: true });
      rimShift.push({ t: tMidNext, v: rBaseMain + halfThick, ease: sinFall });
    } else {
      backShift.push({ t: tMid, v: bBaseMain + halfThick, ease: sinFall });
      frontShift.push({ t: tMid, v: fBaseMain - halfThick, ease: sinFall });
      rimShift.push({ t: tMid, v: rBaseMain - halfThick, hold: true });
      rimShift.push({ t: tMidNext, v: rBaseMain + halfThick, ease: sinFall });
    }

    // Completed 180° face
    frontScale.push({ t: t1, v: scaleVec(fsx, fsy, 1), ...(isLast ? {} : { ease: cosClose }) });
    backScale.push({ t: t1, v: scaleVec(bsx, bsy, 1), ...(isLast ? {} : { ease: cosClose }) });
    rimScale.push({ t: t1, v: scaleVec(rsx, rsy, 1), ...(isLast ? {} : { ease: cosClose }) });
    edgeScale.push({ t: t1, v: scaleVec(esx, esy, 0.01), ...(isLast ? {} : { ease: sinRise }) });

    frontShift.push({ t: t1, v: fBaseMain, ...(isLast ? {} : { ease: sinRise }) });
    backShift.push({ t: t1, v: bBaseMain, ...(isLast ? {} : { ease: sinRise }) });
    rimShift.push({ t: t1, v: rBaseMain, ...(isLast ? {} : { ease: sinRise }) });
  }

  front.ks.s = makeVectorTrack(frontScale);
  back.ks.s = makeVectorTrack(backScale);
  front.ks.o = makeScalarTrack(frontOpacity);
  back.ks.o = makeScalarTrack(backOpacity);
  if (rim) rim.ks.s = makeVectorTrack(rimScale);
  if (edge) edge.ks.s = makeVectorTrack(edgeScale);

  // Create/reuse a Null rig layer (`ty: 3`) for shared toss lift & tilt so front/back/rim/edge
  // stay 100% locked in the coin's local coordinate frame with zero parallax drift under rotation!
  const liftPx = params.liftPx ?? 0;
  const tiltDeg = params.tiltDeg ?? 0;
  const tApex = round2(start + totalDur * 0.46);
  const tEnd = boundaries[boundaries.length - 1] ?? start + totalDur;

  const makeLiftTrack = (baseY: number): LottieProp<number> => {
    if (liftPx === 0) return { a: 0, k: round4(baseY) };
    return makeScalarTrack([
      { t: start, v: baseY, ease: [0.18, 0.88, 0.35, 1] },
      { t: tApex, v: baseY - liftPx, ease: [0.58, 0.0, 0.78, 0.25] },
      { t: tEnd, v: baseY },
    ]);
  };

  const rigId = `${front.ln ?? front.nm}.rig`;
  const existingRig = doc.layers.find((l) => l.ln === rigId);
  const rigInd = existingRig ? existingRig.ind : Math.max(0, ...doc.layers.map((l) => l.ind)) + 1;
  const rigLayer: LottieLayer = {
    ddd: 0,
    ind: rigInd,
    ty: 3,
    nm: rigId,
    ln: rigId,
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r:
        tiltDeg !== 0
          ? makeScalarTrack([
              { t: start, v: 0, ease: [0.25, 0.8, 0.4, 1] },
              { t: tApex, v: tiltDeg, ease: [0.45, 0, 0.3, 1] },
              { t: tEnd, v: 0 },
            ])
          : { a: 0, k: 0 },
      p: { s: true, x: { a: 0, k: round4(fbx) }, y: makeLiftTrack(fby) },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] },
    },
    ao: 0,
    ip: 0,
    op: doc.op,
    st: 0,
    bm: 0,
  };
  if (existingRig) {
    Object.assign(existingRig, rigLayer);
  } else {
    doc.layers.push(rigLayer);
  }

  // Convert child positions into rig-local coordinates (centered at [0, 0]) and parent to rig
  const toLocal = (stops: Array<{ t: number; v: number; ease?: CubicBezierTuple; hold?: boolean }>, origin: number) =>
    stops.map((st) => ({ ...st, v: round4(st.v - origin) }));

  front.parent = rigInd;
  back.parent = rigInd;
  if (rim) rim.parent = rigInd;
  if (edge) edge.parent = rigInd;

  if (axis === 'y') {
    front.ks.p = { s: true, x: makeScalarTrack(toLocal(frontShift, fbx)), y: { a: 0, k: 0 } };
    back.ks.p = { s: true, x: makeScalarTrack(toLocal(backShift, fbx)), y: { a: 0, k: round4(bby - fby) } };
    if (rim) rim.ks.p = { s: true, x: makeScalarTrack(toLocal(rimShift, fbx)), y: { a: 0, k: round4(rby - fby) } };
    if (edge) edge.ks.p = { a: 0, k: [round4(ebx - fbx), round4(eby - fby), 0] };
  } else {
    front.ks.p = { s: true, x: { a: 0, k: 0 }, y: makeScalarTrack(toLocal(frontShift, fby)) };
    back.ks.p = { s: true, x: { a: 0, k: round4(bbx - fbx) }, y: makeScalarTrack(toLocal(backShift, fby)) };
    if (rim) rim.ks.p = { s: true, x: { a: 0, k: round4(rbx - fbx) }, y: makeScalarTrack(toLocal(rimShift, fby)) };
    if (edge) edge.ks.p = { a: 0, k: [round4(ebx - fbx), round4(eby - fby), 0] };
  }

  // Attached glow breathes & follows the coin lift cleanly
  if (glow) {
    const [gbx, gby] = getLayerBasePosition(glow);
    const [gsx, gsy] = getLayerBaseScale(glow);
    glow.ks.p = { s: true, x: { a: 0, k: round4(gbx) }, y: makeLiftTrack(gby) };
    glow.ks.s = makeVectorTrack([
      { t: start, v: [gsx, gsy, 100], ease: [0.25, 0.85, 0.4, 1] },
      { t: tApex, v: [round2(gsx * 0.72), round2(gsy * 1.06), 100], ease: [0.45, 0, 0.3, 1] },
      { t: tEnd, v: [gsx, gsy, 100] },
    ]);
    glow.ks.o = makeScalarTrack([
      { t: start, v: 65, ease: [0.25, 0.85, 0.4, 1] },
      { t: tApex, v: 100, ease: [0.45, 0, 0.3, 1] },
      { t: tEnd, v: 65 },
    ]);
  }

  // Ground shadow compresses & softens at toss apex, tightens on landing
  if (shadow) {
    const [ssx, ssy] = getLayerBaseScale(shadow);
    shadow.ks.s = makeVectorTrack([
      { t: start, v: [ssx, ssy, 100], ease: [0.18, 0.88, 0.35, 1] },
      { t: tApex, v: [round2(ssx * 0.48), round2(ssy * 0.62), 100], ease: [0.58, 0.0, 0.78, 0.25] },
      { t: tEnd, v: [ssx, ssy, 100] },
    ]);
    shadow.ks.o = makeScalarTrack([
      { t: start, v: 55, ease: [0.18, 0.88, 0.35, 1] },
      { t: tApex, v: 18, ease: [0.58, 0.0, 0.78, 0.25] },
      { t: tEnd, v: 55 },
    ]);
  }

  if (params.perspectiveSkew && params.perspectiveSkew !== 0) {
    const sk = params.perspectiveSkew;
    for (const l of [front, back, ...(rim ? [rim] : [])]) {
      l.ks.sk = makeScalarTrack([
        { t: start, v: 0, ease: cosClose },
        { t: tApex, v: sk, ease: cosOpen },
        { t: tEnd, v: 0 },
      ]);
      l.ks.sa = { a: 0, k: axis === 'y' ? 0 : 90 };
    }
  }

  return {
    frontLayerId: front.ln ?? front.nm,
    backLayerId: back.ln ?? back.nm,
    edgeLayerId: edge ? edge.ln ?? edge.nm : undefined,
    rimLayerId: rim ? rim.ln ?? rim.nm : undefined,
    keyframesPerLayer: frontScale.length,
    endFrame: tEnd,
  };
}

/**
 * Area-preserving squash and stretch (4 minimal keyframes: neutral -> stretch -> squash -> settle).
 */
export function applySquashAndStretch(
  doc: LottieDocument,
  params: SquashAndStretchParams,
  tokens: MotionTokens,
): { layerId: string; keyframes: number; endFrame: number } {
  const layer = findLayer(doc, params.layerId);
  const [sx, sy] = getLayerBaseScale(layer);
  const start = params.startFrame ?? 0;
  const dur = resolveDurationFrames(params.duration, doc.fr, tokens, Math.round(doc.fr * 0.45));
  const intensity = Math.max(0.05, Math.min(0.45, params.intensity ?? 0.22));
  const axis = params.axis ?? 'y';
  const settleEase = resolveEaseToken(params.ease, tokens, 'settle');

  const stretchFactor = 1 + intensity;
  const stretchCross = 1 / stretchFactor;
  const squashFactor = 1 - intensity * 0.85;
  const squashCross = 1 / squashFactor;

  const pair = (main: number, cross: number): number[] =>
    axis === 'y'
      ? [round2(sx * cross), round2(sy * main), 100]
      : [round2(sx * main), round2(sy * cross), 100];

  const t1 = start + Math.round(dur * 0.28);
  const t2 = start + Math.round(dur * 0.58);
  const t3 = start + dur;

  layer.ks.s = makeVectorTrack([
    { t: start, v: [sx, sy, 100], ease: [0.22, 0.85, 0.36, 1] },
    { t: t1, v: pair(stretchFactor, stretchCross), ease: [0.45, 0, 0.55, 1] },
    { t: t2, v: pair(squashFactor, squashCross), ease: settleEase },
    { t: t3, v: [sx, sy, 100] },
  ]);

  return { layerId: layer.ln ?? layer.nm, keyframes: 4, endFrame: t3 };
}

export function applyKeyframeTrack(
  doc: LottieDocument,
  params: KeyframeTrackParams,
): { layerId: string; property: string; keyframes: number } {
  const layer = findLayer(doc, params.layerId);
  const kfs = params.keyframes;

  switch (params.property) {
    case 'position':
      layer.ks.p = { a: 1, k: kfs as LottieKeyframe<number[]>[] };
      break;
    case 'positionX': {
      const base = getLayerBasePosition(layer);
      const curY: LottieProp<number> =
        layer.ks.p && 's' in layer.ks.p && layer.ks.p.s
          ? layer.ks.p.y
          : { a: 0, k: base[1] };
      layer.ks.p = { s: true, x: { a: 1, k: kfs as LottieKeyframe<number>[] }, y: curY };
      break;
    }
    case 'positionY': {
      const base = getLayerBasePosition(layer);
      const curX: LottieProp<number> =
        layer.ks.p && 's' in layer.ks.p && layer.ks.p.s
          ? layer.ks.p.x
          : { a: 0, k: base[0] };
      layer.ks.p = { s: true, x: curX, y: { a: 1, k: kfs as LottieKeyframe<number>[] } };
      break;
    }
    case 'scale':
      layer.ks.s = { a: 1, k: kfs as LottieKeyframe<number[]>[] };
      break;
    case 'rotation':
      layer.ks.r = { a: 1, k: kfs as LottieKeyframe<number>[] };
      break;
    case 'opacity':
      layer.ks.o = { a: 1, k: kfs as LottieKeyframe<number>[] };
      break;
  }

  return { layerId: layer.ln ?? layer.nm, property: params.property, keyframes: kfs.length };
}

function findShapeItem<T extends LottieShapeItem['ty']>(
  items: LottieShapeItem[],
  ty: T,
): Extract<LottieShapeItem, { ty: T }> | null {
  for (const item of items) {
    if (item.ty === ty) return item as Extract<LottieShapeItem, { ty: T }>;
    if (item.ty === 'gr') {
      const found = findShapeItem(item.it, ty);
      if (found) return found;
    }
  }
  return null;
}

function findAllShapeItems(items: unknown[], ty: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (item.ty === ty) out.push(item);
    if (item.ty === 'gr' && Array.isArray(item.it)) {
      findAllShapeItems(item.it, ty, out);
    }
  }
  return out;
}

/**
 * Morphs a shape layer's path (default first path, or `pathIndex`) (and gradient colours) through a list of poses:
 * one keyframe per pose, holds as hold keyframes. Poses may have any vertex counts: they're matched exactly
 * (`matchPaths`) so native players interpolate them.
 */
export function applyShapeMorph(
  doc: LottieDocument,
  params: ShapeMorphParams,
  tokens: MotionTokens,
): { layerId: string; poses: number; keyframes: number } {
  const layer = findLayer(doc, params.layerId);
  if (layer.ty !== 4) throw new Error(`shapeMorph: "${params.layerId}" is not a shape layer`);
  const shapes = (layer as LottieShapeLayer).shapes;
  const allSh = findAllShapeItems(shapes, 'sh');
  const sh = allSh[params.pathIndex ?? 0];
  if (!sh) throw new Error(`shapeMorph: "${params.layerId}" has no path #${params.pathIndex ?? 0} to morph`);
  if (params.stops.length < 2) throw new Error('shapeMorph: needs at least two stops');
  // same vertex count, winding and start point for every pose, by exact curve splitting (or as built, vertex for vertex)
  const counts = new Set(params.stops.map((s) => s.path.v.length));
  if (params.match === 'vertices' && counts.size > 1) throw new Error(`shapeMorph: match 'vertices' needs poses with the same vertex count (got ${[...counts].join(', ')})`);
  const matched = params.match === 'vertices' ? params.stops.map((s) => s.path) : matchPaths(params.stops.map((s) => s.path), params.points ?? 96);
  const stops = params.stops.map((s, idx) => ({ ...s, path: matched[idx]! }));
  const roundPath = (p: LottieBezierPath): LottieBezierPath => ({
    c: p.c,
    v: p.v.map(([x, y]) => [round2(x), round2(y)]),
    i: p.i.map(([x, y]) => [round2(x), round2(y)]),
    o: p.o.map(([x, y]) => [round2(x), round2(y)]),
  });

  const pathKfs = stops.map((stop, idx): LottieKeyframe<LottieBezierPath[]> => {
    const next = stops[idx + 1];
    const s = [roundPath(stop.path)];
    if (!next) return { t: round2(stop.t), s };
    if (stop.hold) return { t: round2(stop.t), s, h: 1 };
    const [x1, y1, x2, y2] = resolveEaseToken(stop.ease, tokens, 'move');
    return { t: round2(stop.t), s, e: [roundPath(next.path)], o: { x: x1, y: y1 }, i: { x: x2, y: y2 } };
  });
  sh.ks = { a: 1, k: pathKfs } as unknown as LottieShapePath['ks'];
  let keyframes = pathKfs.length;

  if (stops.some((s) => s.colors)) {
    const gf = findShapeItem(shapes, 'gf');
    if (!gf) throw new Error(`shapeMorph: "${params.layerId}" has no gradient fill for colors`);
    const colorStops = stops.map((s) => s.colors ?? stops.find((x) => x.colors)!.colors!);
    const len = colorStops[0]!.length;
    if (colorStops.some((c) => c.length !== len)) throw new Error('shapeMorph: every colors array needs the same length');
    gf.g = {
      p: len / 4,
      k: makeVectorTrack(
        stops.map((stop, idx) => ({
          t: stop.t,
          v: colorStops[idx]!,
          ease: resolveEaseToken(stop.ease, tokens, 'move'),
          hold: stop.hold,
        })),
      ),
    };
    keyframes += stops.length;
  }

  return { layerId: layer.ln ?? layer.nm, poses: stops.length, keyframes };
}

export function applyMotionPrimitive(
  doc: LottieDocument,
  spec: MotionPrimitiveSpec,
  tokens: MotionTokens,
): Record<string, unknown> {
  switch (spec.kind) {
    case 'springMove':
      return applySpringMove(doc, spec, tokens);
    case 'trimStroke':
      return applyTrimStroke(doc, spec, tokens);
    case 'staggeredEntrance':
      return applyStaggeredEntrance(doc, spec, tokens);
    case 'faux3DFlip':
      return applyFaux3DFlip(doc, spec, tokens);
    case 'squashAndStretch':
      return applySquashAndStretch(doc, spec, tokens);
    case 'keyframeTrack':
      return applyKeyframeTrack(doc, spec);
    case 'shapeMorph':
      return applyShapeMorph(doc, spec, tokens);
    case 'turntable':
      return applyTurntable(doc, spec, tokens) as unknown as Record<string, unknown>;
  }
}
