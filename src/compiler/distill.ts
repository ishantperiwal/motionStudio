import { clampBezierX, round2, round4 } from './tokens.js';
import type {
  CubicBezierTuple,
  DistilledCurveResult,
  DistilledSegment,
  LottieKeyframe,
  RawPointerSample,
} from './types.js';

interface Point2D {
  x: number;
  y: number;
}

function evalCubicBezier1D(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function evalCubicBezierYAtX(xTarget: number, c: CubicBezierTuple): number {
  if (xTarget <= 0) return 0;
  if (xTarget >= 1) return 1;
  const [x1, y1, x2, y2] = c;

  // Newton-Raphson + bisection fallback for exact t where B_x(t) = xTarget
  let u = xTarget;
  for (let iter = 0; iter < 8; iter++) {
    const x = evalCubicBezier1D(u, x1, x2) - xTarget;
    if (Math.abs(x) < 1e-6) break;
    const dx =
      3 * (1 - u) * (1 - u) * x1 +
      6 * (1 - u) * u * (x2 - x1) +
      3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    u = Math.max(0, Math.min(1, u - x / dx));
  }
  if (Math.abs(evalCubicBezier1D(u, x1, x2) - xTarget) > 1e-4) {
    let lo = 0;
    let hi = 1;
    for (let iter = 0; iter < 24; iter++) {
      u = (lo + hi) / 2;
      const x = evalCubicBezier1D(u, x1, x2);
      if (x < xTarget) lo = u;
      else hi = u;
    }
  }
  return evalCubicBezier1D(u, y1, y2);
}

function perpendicularDistance(pt: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(pt.x - a.x, pt.y - a.y);
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(pt.x - projX, pt.y - projY);
}

/**
 * Ramer-Douglas-Peucker simplification returning indices into `pts`.
 */
function rdpIndices(pts: Point2D[], start: number, end: number, epsilon: number): number[] {
  if (end <= start + 1) return [start, end];
  const a = pts[start];
  const b = pts[end];
  if (!a || !b) return [start, end];

  let maxDist = -1;
  let maxIdx = start;
  for (let i = start + 1; i < end; i++) {
    const p = pts[i];
    if (!p) continue;
    const d = perpendicularDistance(p, a, b);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpIndices(pts, start, maxIdx, epsilon);
    const right = rdpIndices(pts, maxIdx, end, epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

/**
 * Adaptive RDP that targets at most `maxKnots` (default 4) while preserving
 * key overshoot / anticipation extrema.
 */
function simplifyToTargetKnots(pts: Point2D[], maxKnots: number): number[] {
  if (pts.length <= maxKnots) {
    return pts.map((_, i) => i);
  }

  // Normalize points to [0, 1] x [0, 1] for isotropic RDP distance
  const minX = pts[0]?.x ?? 0;
  const maxX = pts[pts.length - 1]?.x ?? 1;
  const spanX = Math.max(1e-6, maxX - minX);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanY = Math.max(1e-6, maxY - minY);
  const norm: Point2D[] = pts.map((p) => ({
    x: (p.x - minX) / spanX,
    y: (p.y - minY) / spanY,
  }));

  // Check if curve is nearly monotonic and smooth -> 3 knots or 2 knots is plenty
  let lo = 0.001;
  let hi = 0.6;
  let best = [0, pts.length - 1];

  for (let iter = 0; iter < 24; iter++) {
    const mid = (lo + hi) / 2;
    const idxs = rdpIndices(norm, 0, norm.length - 1, mid);
    if (idxs.length <= maxKnots) {
      best = idxs;
      hi = mid;
    } else {
      lo = mid;
    }
  }

  // If RDP collapsed to 2 points on a curve with significant overshoot or inflection,
  // re-insert the single most prominent interior extremum (up to 3 knots)
  if (best.length === 2 && maxKnots >= 3) {
    let extremumIdx = -1;
    let extremumDev = 0;
    const firstY = norm[0]?.y ?? 0;
    const lastY = norm[norm.length - 1]?.y ?? 1;
    const loY = Math.min(firstY, lastY);
    const hiY = Math.max(firstY, lastY);
    for (let i = 1; i < norm.length - 1; i++) {
      const py = norm[i]?.y ?? 0;
      const overshoot = Math.max(0, py - hiY, loY - py);
      if (overshoot > extremumDev) {
        extremumDev = overshoot;
        extremumIdx = i;
      }
    }
    if (extremumIdx > 0 && extremumDev > 0.04) {
      best = [0, extremumIdx, pts.length - 1];
    }
  }

  return best;
}

/**
 * Fits a single cubic-bezier `[x1, y1, x2, y2]` to normalized segment samples `(u, v)`
 * where `(0,0) -> (1,1)`, minimizing squared error via least-squares seed +
 * coordinate-descent refinement.
 */
function fitCubicBezierToSegment(samples: Point2D[]): { bezier: CubicBezierTuple; mse: number } {
  if (samples.length <= 2) {
    return { bezier: [0.25, 0.1, 0.25, 1], mse: 0 };
  }

  const loss = (c: CubicBezierTuple): number => {
    let sum = 0;
    for (const s of samples) {
      const pred = evalCubicBezierYAtX(s.x, c);
      const err = pred - s.y;
      sum += err * err;
    }
    return sum / samples.length;
  };

  // Evaluate canonical motion presets as warm starts so we don't get stuck in local minima
  const seeds: CubicBezierTuple[] = [
    [0.16, 1, 0.3, 1],       // settle
    [0.45, 0, 0.2, 1],       // move
    [0.25, 0.1, 0.25, 1],    // ease
    [0.42, 0, 0.58, 1],      // ease-in-out
    [0.34, 1.4, 0.64, 1],    // overshoot
    [0.55, 0, 1, 0.45],      // accelerate
    [0, 0.55, 0.45, 1],      // decelerate
    [0, 0, 1, 1],            // linear
  ];

  let best: CubicBezierTuple = seeds[0] ?? [0.16, 1, 0.3, 1];
  let bestLoss = loss(best);
  for (const seed of seeds) {
    const l = loss(seed);
    if (l < bestLoss) {
      bestLoss = l;
      best = [...seed];
    }
  }

  // Coordinate-descent refinement over [x1, y1, x2, y2]
  const steps = [0.16, 0.08, 0.04, 0.015, 0.005];
  for (const step of steps) {
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (let dim = 0; dim < 4; dim++) {
        for (const dir of [-1, 1]) {
          const cand: CubicBezierTuple = [...best];
          const nextVal = cand[dim]! + dir * step;
          if (dim === 0 || dim === 2) {
            cand[dim] = Math.max(0.01, Math.min(0.99, nextVal));
          } else {
            cand[dim] = Math.max(-0.8, Math.min(1.8, nextVal));
          }
          const l = loss(cand);
          if (l + 1e-9 < bestLoss) {
            bestLoss = l;
            best = cand;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
  }

  return { bezier: clampBezierX(best), mse: bestLoss };
}

export interface DistillOptions {
  fps?: number;
  startFrame?: number;
  maxKeyframes?: 3 | 4;
  durationFrames?: number;
}

/**
 * Distills raw 60Hz pointer coordinates/timestamps (or pose-pinned values)
 * into 2–4 clean, minimal Lottie keyframes with fitted cubic-bezier tangents.
 */
export function distillMotionCurve(
  rawSamples: RawPointerSample[],
  opts: DistillOptions = {},
): DistilledCurveResult {
  if (rawSamples.length < 2) {
    throw new Error('distillMotionCurve requires at least 2 samples');
  }

  const fps = opts.fps ?? 60;
  const startFrame = opts.startFrame ?? 0;
  const maxKeyframes = opts.maxKeyframes ?? 4;

  // Sort by timestamp and deduplicate identical timestamps
  const sorted = [...rawSamples].sort((a, b) => a.t - b.t);
  const deduped: RawPointerSample[] = [];
  for (const s of sorted) {
    const prev = deduped[deduped.length - 1];
    if (!prev || s.t > prev.t + 1e-4) {
      deduped.push(s);
    } else {
      deduped[deduped.length - 1] = s;
    }
  }
  if (deduped.length < 2) {
    throw new Error('distillMotionCurve requires samples spanning a positive time interval');
  }

  const tStart = deduped[0]!.t;
  const tEnd = deduped[deduped.length - 1]!.t;
  const durationMs = Math.max(16, tEnd - tStart);
  const durationFrames =
    opts.durationFrames ?? Math.max(4, Math.round((durationMs / 1000) * fps));

  const hasY = deduped.some((s) => s.y !== undefined && Math.abs((s.y ?? 0) - (deduped[0]?.y ?? 0)) > 1e-3);
  const dimension: '1d' | '2d' = hasY ? '2d' : '1d';

  // Choose primary signal for knot placement:
  // In 1D use x; in 2D use signed projection along dominant displacement axis + arc length
  const x0 = deduped[0]!.x;
  const y0 = deduped[0]!.y ?? 0;
  const dxTotal = deduped[deduped.length - 1]!.x - x0;
  const dyTotal = (deduped[deduped.length - 1]!.y ?? 0) - y0;
  const distTotal = Math.hypot(dxTotal, dyTotal);

  const primarySeries: Point2D[] = deduped.map((s) => {
    const u = (s.t - tStart) / durationMs;
    if (!hasY) return { x: u, y: s.x };
    const dx = s.x - x0;
    const dy = (s.y ?? 0) - y0;
    const val = distTotal > 1e-3 ? (dx * dxTotal + dy * dyTotal) / distTotal : Math.hypot(dx, dy);
    return { x: u, y: val };
  });

  const knotIndices = simplifyToTargetKnots(primarySeries, maxKeyframes);

  const fitAxis = (
    values: number[],
  ): {
    keyframes: LottieKeyframe<number>[];
    segments: DistilledSegment[];
    sqErrSum: number;
    maxErr: number;
    count: number;
  } => {
    const keyframes: LottieKeyframe<number>[] = [];
    const segments: DistilledSegment[] = [];
    let sqErrSum = 0;
    let maxErr = 0;
    let count = 0;

    for (let k = 0; k < knotIndices.length; k++) {
      const idx0 = knotIndices[k]!;
      const u0 = (deduped[idx0]!.t - tStart) / durationMs;
      const f0 = round2(startFrame + u0 * durationFrames);
      const v0 = values[idx0]!;

      const nextKnot = knotIndices[k + 1];
      if (nextKnot === undefined) {
        keyframes.push({ t: f0, s: [round4(v0)] as unknown as number });
        break;
      }

      const u1 = (deduped[nextKnot]!.t - tStart) / durationMs;
      const v1 = values[nextKnot]!;
      const du = Math.max(1e-6, u1 - u0);
      const dv = v1 - v0;

      let bezier: CubicBezierTuple = [0.25, 0.1, 0.25, 1];
      if (Math.abs(dv) > 1e-4) {
        const segSamples: Point2D[] = [];
        for (let i = idx0; i <= nextKnot; i++) {
          const ui = (deduped[i]!.t - tStart) / durationMs;
          segSamples.push({
            x: (ui - u0) / du,
            y: (values[i]! - v0) / dv,
          });
        }
        const fit = fitCubicBezierToSegment(segSamples);
        bezier = fit.bezier;
        for (const s of segSamples) {
          const pred = evalCubicBezierYAtX(s.x, bezier);
          const err = Math.abs(pred - s.y);
          sqErrSum += err * err;
          if (err > maxErr) maxErr = err;
          count++;
        }
      }

      segments.push({ t0: round4(u0), t1: round4(u1), v0: round4(v0), v1: round4(v1), bezier });
      keyframes.push({
        t: f0,
        s: [round4(v0)] as unknown as number,
        e: [round4(v1)] as unknown as number,
        o: { x: [bezier[0]], y: [bezier[1]] },
        i: { x: [bezier[2]], y: [bezier[3]] },
      });
    }

    return { keyframes, segments, sqErrSum, maxErr, count };
  };

  const xValues = deduped.map((s) => s.x);
  const xFit = fitAxis(xValues);

  let yFit: ReturnType<typeof fitAxis> | undefined;
  if (hasY) {
    const yValues = deduped.map((s) => s.y ?? 0);
    yFit = fitAxis(yValues);
  }

  // Combined 2D/1D keyframes convenience array
  const keyframes: LottieKeyframe<number[]>[] = knotIndices.map((idx0, k) => {
    const u0 = (deduped[idx0]!.t - tStart) / durationMs;
    const f0 = round2(startFrame + u0 * durationFrames);
    const sx = round4(xValues[idx0]!);
    const sy = round4(deduped[idx0]!.y ?? 0);
    const sVec = hasY ? [sx, sy, 0] : [sx];

    const nextKnot = knotIndices[k + 1];
    if (nextKnot === undefined) {
      return { t: f0, s: sVec };
    }
    const ex = round4(xValues[nextKnot]!);
    const ey = round4(deduped[nextKnot]!.y ?? 0);
    const eVec = hasY ? [ex, ey, 0] : [ex];
    const segX = xFit.segments[k]?.bezier ?? [0.25, 0.1, 0.25, 1];
    const segY = yFit?.segments[k]?.bezier ?? segX;

    return {
      t: f0,
      s: sVec,
      e: eVec,
      o: hasY ? { x: [segX[0], segY[0], segX[0]], y: [segX[1], segY[1], segX[1]] } : { x: [segX[0]], y: [segX[1]] },
      i: hasY ? { x: [segX[2], segY[2], segX[2]], y: [segX[3], segY[3], segX[3]] } : { x: [segX[2]], y: [segX[3]] },
    };
  });

  const totalCount = Math.max(1, xFit.count + (yFit?.count ?? 0));
  const totalSq = xFit.sqErrSum + (yFit?.sqErrSum ?? 0);
  const rmsError = round4(Math.sqrt(totalSq / totalCount));
  const maxError = round4(Math.max(xFit.maxErr, yFit?.maxErr ?? 0));
  const primaryBezier = xFit.segments[0]?.bezier ?? [0.16, 1, 0.3, 1];

  return {
    dimension,
    keyframeCount: keyframes.length,
    durationMs: round2(durationMs),
    durationFrames,
    keyframes,
    xKeyframes: xFit.keyframes,
    yKeyframes: yFit?.keyframes,
    segments: xFit.segments,
    rmsError,
    maxError,
    primaryBezier,
  };
}
