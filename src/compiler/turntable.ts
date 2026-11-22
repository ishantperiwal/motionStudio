// The 3D engine (`turntable` primitive): a small 3D model (convex polyhedra, lathes, extruded strips) turning about
// any axis under an optional camera tilt, compiled into native Lottie layers. Native players have no 3D for shapes,
// so every part is its exact 2D projection (a flat face is an exact affine copy of its face-on art):
// - a disc is its side wall (the hull of its two end ovals, |sin φ| wide, depth·|cos φ| apart) plus only the end
//   facing the camera, painted; a strip is its outline squeezed by |cos φ| and swept ±depth/2·|sin φ| (a Minkowski
//   sum, its notches closing into creases and then zero-width slits) under its one lit side face;
// - paint order follows depth, in phase layer sets that swap exactly where the faces are edge-on; a phase's
//   layers hold still while it is hidden;
// - every face fades into its side colour as it turns away (opacity = smoothstep(|facing| / light));
// - outlines morph vertex for vertex through poses placed where they change character (a notch shutting), each
//   in-between eased to the true outline; transforms are keyed at quarter turns with fitted sine-shaped eases.
// `turntableSvg(spec)` draws the layers (put them in the scene's SVG); the `turntable` primitive (`spec`) moves them.
import { fitEaseToSamples } from './distill.js';
import * as geo from './geometry.js';
import { measureTrackDensity } from './last.js';
import { applyShapeMorph, findLayer } from './primitives.js';
import { resolveEaseToken } from './tokens.js';
import type {
  CubicBezierTuple,
  LottieBezierPath,
  LottieDocument,
  LottieKeyframe,
  LottieLayer,
  LottieProp,
  MotionTokens,
  ShapeMorphStop,
  TurntableDisc,
  TurntableDiscEnd,
  TurntableExtrude,
  TurntableLight,
  TurntableParams,
  TurntablePart,
  TurntablePoly,
  TurntableProfilePoint,
  TurntableSphere,
  TurntableStrip,
} from './types.js';

type Pt = [number, number];
type Cubic = [Pt, Pt, Pt, Pt];

const D2R = Math.PI / 180;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smoothstep = (v: number): number => v * v * (3 - 2 * v);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const CUT = 0.05; // frames between a fade's last value and its cut at a phase swap

// ---------------------------------------------------------------------------
// Turn angle over time
// ---------------------------------------------------------------------------

function easeY(e: CubicBezierTuple, tau: number): number {
  const [x1, y1, x2, y2] = e;
  const bx = (u: number): number => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  let lo = 0, hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < tau) lo = mid;
    else hi = mid;
  }
  const u = (lo + hi) / 2;
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
}

class TurnAngle {
  readonly segs: Array<{ t0: number; t1: number; d0: number; d1: number; e: CubicBezierTuple }> = [];
  readonly t0: number;
  readonly t1: number;
  readonly stops: number[];

  constructor(spec: TurntableParams, tokens: MotionTokens) {
    const stops = [...spec.angle].sort((a, b) => a.t - b.t);
    if (stops.length < 2) throw new Error('turntable: `angle` needs at least two stops');
    for (let k = 0; k < stops.length - 1; k++) {
      const a = stops[k]!, b = stops[k + 1]!;
      const e: CubicBezierTuple = a.ease === undefined || a.ease === 'linear' ? [0, 0, 1, 1] : resolveEaseToken(a.ease, tokens, 'linear');
      this.segs.push({ t0: a.t, t1: b.t, d0: a.deg, d1: b.deg, e });
    }
    this.t0 = stops[0]!.t;
    this.t1 = stops[stops.length - 1]!.t;
    this.stops = stops.map((s) => s.t);
  }

  /** degrees at frame t */
  at(t: number): number {
    const s = this.segs.find((g) => t <= g.t1) ?? this.segs[this.segs.length - 1]!;
    if (t <= s.t0) return s.d0;
    if (t >= s.t1) return s.d1;
    return s.d0 + (s.d1 - s.d0) * easeY(s.e, (t - s.t0) / (s.t1 - s.t0));
  }

  /** frames in [a, b] where the angle is α modulo `period` */
  crossings(alpha: number, period: number, a = this.t0, b = this.t1): number[] {
    const out: number[] = [];
    const steps = Math.max(16, Math.ceil((b - a) * 2));
    let ta = a, va = this.at(a);
    for (let k = 1; k <= steps; k++) {
      const tb = a + ((b - a) * k) / steps, vb = this.at(tb);
      const lo = Math.min(va, vb), hi = Math.max(va, vb);
      for (let m = Math.ceil((lo - alpha) / period); alpha + m * period <= hi; m++) {
        const target = alpha + m * period;
        let x0 = ta, x1 = tb;
        const up = vb >= va;
        for (let it = 0; it < 50; it++) {
          const mid = (x0 + x1) / 2;
          if ((this.at(mid) < target) === up) x0 = mid;
          else x1 = mid;
        }
        out.push(va === target ? ta : vb === target ? tb : (x0 + x1) / 2);
      }
      ta = tb;
      va = vb;
    }
    return uniqueTimes(out);
  }
}

function uniqueTimes(ts: number[], eps = 1e-3): number[] {
  const sorted = [...ts].sort((a, b) => a - b);
  return sorted.filter((t, k) => k === 0 || t - sorted[k - 1]! > eps);
}

/** the turn angle (degrees) of a turntable at frame t */
export function turntableAngleAt(spec: TurntableParams, t: number, tokens?: MotionTokens): number {
  return new TurnAngle(spec, tokens ?? ({ ease: {} } as unknown as MotionTokens)).at(t);
}

/** folds a turn angle onto [0°, 90°]: every outline here depends only on |cos φ| and |sin φ| */
const fold = (deg: number): number => {
  const m = ((deg % 180) + 180) % 180;
  return m <= 90 ? m : 180 - m;
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const lerpPt = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const [p0, p1, p2, p3] = c;
  const a = lerpPt(p0, p1, t), b = lerpPt(p1, p2, t), d = lerpPt(p2, p3, t);
  const e = lerpPt(a, b, t), f = lerpPt(b, d, t), g = lerpPt(e, f, t);
  return [[p0, a, e, g], [g, f, d, p3]];
}

function cubicAt(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0] + w3 * c[3][0], w0 * c[0][1] + w1 * c[1][1] + w2 * c[2][1] + w3 * c[3][1]];
}

function cubicsOfPath(p: LottieBezierPath): Cubic[] {
  const n = p.v.length;
  return p.v.map((a, j) => {
    const b = p.v[(j + 1) % n]!;
    return [a, [a[0] + p.o[j]![0], a[1] + p.o[j]![1]], [b[0] + p.i[(j + 1) % n]![0], b[1] + p.i[(j + 1) % n]![1]], b] as Cubic;
  });
}

function samplePath(p: LottieBezierPath, per = 10): Pt[] {
  return cubicsOfPath(p).flatMap((c) => Array.from({ length: per }, (_, k) => cubicAt(c, k / per)));
}

function distToPolyline(q: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!, b = poly[(k + 1) % poly.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 1e-12 ? clamp01(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2) : 0;
    const ex = a[0] + t * dx - q[0], ey = a[1] + t * dy - q[1];
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** how far apart two outlines are (symmetric Hausdorff distance over sampled points) */
function outlineDistance(a: LottieBezierPath, b: LottieBezierPath): number {
  const pa = samplePath(a), pb = samplePath(b);
  let worst = 0;
  for (const q of pa) worst = Math.max(worst, distToPolyline(q, pb));
  for (const q of pb) worst = Math.max(worst, distToPolyline(q, pa));
  return worst;
}

/** the filled cells of a path (nonzero winding) on a grid: [row][…x0, x1 spans] */
function fillSpans(poly: Pt[], y0: number, rows: number, cell: number): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const y = y0 + (r + 0.5) * cell;
    const hits: Array<[number, number]> = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!, b = poly[(k + 1) % poly.length]!;
      if ((a[1] <= y) === (b[1] <= y)) continue;
      hits.push([a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), b[1] > a[1] ? 1 : -1]);
    }
    hits.sort((p, q) => p[0] - q[0]);
    const spans: number[] = [];
    let w = 0;
    for (const [x, d] of hits) {
      const was = w !== 0;
      w += d;
      if (!was && w !== 0) spans.push(x);
      else if (was && w === 0) spans.push(x);
    }
    out.push(spans);
  }
  return out;
}

/**
 * How visibly two filled outlines differ, in px: over every point covered by one and not the other, the most
 * distance across the gap (to both outlines). A zero-width slit covers nothing, so it costs nothing.
 */
function shapeError(a: LottieBezierPath, b: LottieBezierPath, cell = 0.5): number {
  const pa = samplePath(a, 10), pb = samplePath(b, 10);
  let y0 = Infinity, y1 = -Infinity;
  for (const p of [...pa, ...pb]) {
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  const rows = Math.ceil((y1 - y0) / cell) + 1;
  const sa = fillSpans(pa, y0, rows, cell), sb = fillSpans(pb, y0, rows, cell);
  const diff: Pt[] = [];
  for (let r = 0; r < rows; r++) {
    // where exactly one of the two covers the row
    const edges = [...sa[r]!.map((x) => [x, 0] as const), ...sb[r]!.map((x) => [x, 1] as const)].sort((p, q) => p[0] - q[0]);
    const inside = [false, false];
    const y = y0 + (r + 0.5) * cell;
    for (let k = 0; k < edges.length - 1; k++) {
      inside[edges[k]![1]] = !inside[edges[k]![1]];
      if (inside[0] === inside[1]) continue;
      const [xa, xb] = [edges[k]![0], edges[k + 1]![0]];
      for (let x = xa + Math.min(cell, (xb - xa) / 2) / 2; x < xb; x += cell) diff.push([x, y]);
    }
  }
  const stride = Math.max(1, Math.floor(diff.length / 300));
  let worst = 0;
  for (let k = 0; k < diff.length; k += stride) {
    const q = diff[k]!;
    worst = Math.max(worst, distToPolyline(q, pa) + distToPolyline(q, pb));
  }
  return worst;
}

function lerpPath(a: LottieBezierPath, b: LottieBezierPath, u: number): LottieBezierPath {
  return {
    c: a.c,
    v: a.v.map((p, j) => lerpPt(p, b.v[j]!, u)),
    i: a.i.map((p, j) => lerpPt(p, b.i[j]!, u)),
    o: a.o.map((p, j) => lerpPt(p, b.o[j]!, u)),
  };
}

/** the blend amount u that brings a toward b closest to p, vertex for vertex (handles included) */
function projectBlend(a: LottieBezierPath, b: LottieBezierPath, p: LottieBezierPath): number {
  let num = 0, den = 0;
  for (let j = 0; j < a.v.length; j++) {
    for (const [pa, pb, pp] of [
      [a.v[j]!, b.v[j]!, p.v[j]!],
      [[a.v[j]![0] + a.i[j]![0], a.v[j]![1] + a.i[j]![1]], [b.v[j]![0] + b.i[j]![0], b.v[j]![1] + b.i[j]![1]], [p.v[j]![0] + p.i[j]![0], p.v[j]![1] + p.i[j]![1]]],
      [[a.v[j]![0] + a.o[j]![0], a.v[j]![1] + a.o[j]![1]], [b.v[j]![0] + b.o[j]![0], b.v[j]![1] + b.o[j]![1]], [p.v[j]![0] + p.o[j]![0], p.v[j]![1] + p.o[j]![1]]],
    ] as Array<[Pt, Pt, Pt]>) {
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      num += (pp[0] - pa[0]) * dx + (pp[1] - pa[1]) * dy;
      den += dx * dx + dy * dy;
    }
  }
  return den > 1e-9 ? Math.max(-0.25, Math.min(1.25, num / den)) : 0;
}

const translatePath = (p: LottieBezierPath, dx: number, dy: number): LottieBezierPath => ({ ...p, v: p.v.map(([x, y]) => [x + dx, y + dy]) });
const svgD = (p: LottieBezierPath): string => geo.toSvgPath(geo.fromLottiePath(p));

// ---------------------------------------------------------------------------
// Strip: a symmetric outline extruded along z. At turn ψ its silhouette is the outline squeezed by c = cos ψ and
// swept sideways ±d (d = depth/2·sin ψ): split at its horizontal tangents into y-monotone runs, each run slides
// out by ±d along its outward normal's side, convex turning points stretch into flats 2d wide and concave ones
// (notches) close: the two runs cross at a crease, and once they cross all the way the notch is a zero-width slit.
// Every pose has the same vertices in the same order, so they morph vertex for vertex.
// ---------------------------------------------------------------------------

interface Slot { p: Pt; hin: Pt; hout: Pt; shift: number }
interface StripJunction {
  before: number[]; // segment indices, in path order, ending at the notch
  after: number[]; // starting from it
  first: number; // slot range of the notch itself (inclusive, cyclic)
  last: number;
  dir: number; // x direction the outline travels across the notch
  yJ: number; // notch y
  yM: number; // its mouth: the nearer far end of the two runs
  shutPsi: number | null; // ψ where it shuts
  slitTop: number; // once shut, the slit runs from the mouth to here
  slitFor: Map<number, number>; // the slit chosen for each last open pose
}

class StripModel {
  readonly segs: Array<{ c: Cubic; sigma: number }> = [];
  readonly slotIn: number[] = [];
  readonly slotOut: number[] = [];
  readonly baseSlots: Slot[] = [];
  readonly junctions: StripJunction[] = [];
  readonly xc: number;
  readonly hd: number;
  readonly outline: LottieBezierPath; // model px
  private cache = new Map<string, LottieBezierPath>();

  constructor(readonly part: TurntableStrip, readonly home: Pt) {
    const shape = geo.fromSvgPath(part.outline);
    this.outline = geo.toLottiePath(shape);
    const b = (shape as unknown as { bounds: { left: number; right: number } }).bounds;
    this.xc = (b.left + b.right) / 2;
    this.hd = part.depth / 2;
    const mirror: LottieBezierPath = { c: true, v: this.outline.v.map(([x, y]) => [2 * this.xc - x, y]), i: this.outline.i.map(([x, y]) => [-x, y]), o: this.outline.o.map(([x, y]) => [-x, y]) };
    if (outlineDistance(this.outline, mirror) > 0.5) {
      throw new Error(`turntable: strip "${part.name}" outline must be mirror-symmetric about its centre column (x = ${r3(this.xc)})`);
    }
    // y-monotone pieces, x relative to the centre column
    for (const c0 of cubicsOfPath(this.outline)) {
      const c: Cubic = c0.map(([x, y]) => [x - this.xc, y]) as Cubic;
      if (Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]) < 1e-6 && Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) < 1e-6) continue;
      const [y0, y1, y2, y3] = c.map((p) => p[1]) as [number, number, number, number];
      const qa = 3 * (-y0 + 3 * y1 - 3 * y2 + y3), qb = 6 * (y0 - 2 * y1 + y2), qc = 3 * (y1 - y0);
      const roots: number[] = [];
      if (Math.abs(qa) < 1e-9) {
        if (Math.abs(qb) > 1e-9) roots.push(-qc / qb);
      } else {
        const disc = qb * qb - 4 * qa * qc;
        if (disc >= 0) roots.push((-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa));
      }
      let rest = c, t0 = 0;
      for (const t of roots.filter((t) => t > 1e-4 && t < 1 - 1e-4).sort((p, q) => p - q)) {
        const [l, r] = splitCubic(rest, (t - t0) / (1 - t0));
        this.segs.push({ c: l, sigma: 0 });
        rest = r;
        t0 = t;
      }
      this.segs.push({ c: rest, sigma: 0 });
    }
    for (const s of this.segs) {
      const ys = s.c.map((p) => p[1]);
      const flat = ys.every((y) => Math.abs(y - ys[0]!) < 1e-6);
      s.sigma = flat ? 0 : Math.sign(ys[3]! - ys[0]!) || Math.sign(ys[2]! - ys[1]!);
    }
    const n = this.segs.length;
    let area = 0;
    for (const s of this.segs) for (let k = 0; k < 8; k++) {
      const p = cubicAt(s.c, k / 8), q = cubicAt(s.c, (k + 1) / 8);
      area += p[0] * q[1] - q[0] * p[1];
    }
    const orient = area >= 0 ? 1 : -1; // clockwise on screen (y down): a run going down is on the right
    const shiftOf = (sigma: number): number => sigma * orient;

    // slots: one per vertex, two at a turning point (each side slides its own way)
    for (let j = 0; j < n; j++) {
      const prev = this.segs[(j + n - 1) % n]!, next = this.segs[j]!;
      const p = next.c[0];
      const hin: Pt = [prev.c[2][0] - prev.c[3][0], prev.c[2][1] - prev.c[3][1]];
      const hout: Pt = [next.c[1][0] - next.c[0][0], next.c[1][1] - next.c[0][1]];
      if (prev.sigma !== 0 && next.sigma !== 0 && prev.sigma !== next.sigma) {
        this.slotIn[j] = this.baseSlots.push({ p, hin, hout: [0, 0], shift: shiftOf(prev.sigma) }) - 1;
        this.slotOut[j] = this.baseSlots.push({ p, hin: [0, 0], hout, shift: shiftOf(next.sigma) }) - 1;
      } else {
        const s = prev.sigma !== 0 ? prev.sigma : next.sigma;
        this.slotIn[j] = this.slotOut[j] = this.baseSlots.push({ p, hin, hout, shift: shiftOf(s) }) - 1;
      }
    }
    // a flat run between two turning sides: its inner vertices stay put
    for (let j = 0; j < n; j++) {
      if (this.segs[(j + n - 1) % n]!.sigma === 0 && this.segs[j]!.sigma === 0) this.baseSlots[this.slotIn[j]!]!.shift = 0;
    }

    // turning points (a vertex, or a flat run) whose sides slide toward each other: notches
    for (let j = 0; j < n; j++) {
      const prev = this.segs[(j + n - 1) % n]!;
      if (prev.sigma === 0) continue;
      let e = j; // the vertex where the next non-flat side starts
      while (this.segs[e % n]!.sigma === 0 && e < j + n) e++;
      e %= n;
      const next = this.segs[e]!;
      if (next.sigma !== -prev.sigma) continue;
      const before: number[] = [];
      for (let k = (j + n - 1) % n; this.segs[k]!.sigma === prev.sigma && before.length < n; k = (k + n - 1) % n) before.unshift(k);
      const after: number[] = [];
      for (let k = e; this.segs[k]!.sigma === next.sigma && after.length < n; k = (k + 1) % n) after.push(k);
      const pj = this.segs[j]!.c[0], pe = next.c[0];
      let dir = Math.sign(pe[0] - pj[0]);
      if (dir === 0) {
        const tin = prev.c[3][0] - prev.c[2][0] || prev.c[3][0] - prev.c[0][0];
        const tout = next.c[1][0] - next.c[0][0] || next.c[3][0] - next.c[0][0];
        dir = Math.sign(tin + tout);
      }
      if (dir === 0 || (shiftOf(next.sigma) - shiftOf(prev.sigma)) * dir >= 0) continue; // convex: it stretches
      const yFarB = this.segs[before[0]!]!.c[0][1], yFarA = this.segs[after[after.length - 1]!]!.c[3][1];
      const yJ = pj[1];
      this.junctions.push({
        before, after, first: this.slotIn[j]!, last: this.slotOut[e]!, dir, yJ,
        yM: Math.abs(yFarB - yJ) < Math.abs(yFarA - yJ) ? yFarB : yFarA,
        shutPsi: null, slitTop: yJ, slitFor: new Map(),
      });
    }
    for (const jn of this.junctions) {
      if (this.mouthGap(jn, 90) >= 0) continue;
      let lo = 0, hi = 90;
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2;
        if (this.mouthGap(jn, mid) >= 0) lo = mid;
        else hi = mid;
      }
      jn.shutPsi = hi;
    }
  }

  /** x on a run at height y (unsqueezed), with the segment and its parameter */
  private runAt(segIdx: number[], y: number): { x: number; seg: number; t: number } | null {
    for (const k of segIdx) {
      const c = this.segs[k]!.c;
      const ya = c[0][1], yb = c[3][1];
      if ((y - ya) * (y - yb) > 1e-9) continue;
      let lo = 0, hi = 1;
      const up = yb > ya;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if ((cubicAt(c, mid)[1] < y) === up) lo = mid;
        else hi = mid;
      }
      const t = (lo + hi) / 2;
      return { x: cubicAt(c, t)[0], seg: k, t };
    }
    return null;
  }

  /** how open a notch is at height y (negative: its sides have crossed) */
  private gapAt(jn: StripJunction, y: number, c: number, d: number): number {
    const b = this.runAt(jn.before, y), a = this.runAt(jn.after, y);
    if (!b || !a) return Number.NaN;
    const sb = this.segShift(jn.before[0]!), sa = this.segShift(jn.after[0]!);
    return (c * a.x + sa * d - (c * b.x + sb * d)) * jn.dir;
  }

  private segShift(k: number): number {
    return this.baseSlots[this.slotOut[k]!]!.shift;
  }

  private mouthGap(jn: StripJunction, psi: number): number {
    return this.gapAt(jn, jn.yM, Math.cos(psi * D2R), this.hd * Math.sin(psi * D2R));
  }

  /** where a notch's crease is at turn ψ (its y), or the notch y while it is still open there */
  creaseY(jn: StripJunction, psi: number): number {
    const c = Math.cos(psi * D2R), d = this.hd * Math.sin(psi * D2R);
    if (!(this.gapAt(jn, jn.yJ, c, d) < 0)) return jn.yJ;
    const steps = 64;
    let prev = jn.yJ;
    for (let k = 1; k <= steps; k++) {
      const y = jn.yJ + ((jn.yM - jn.yJ) * k) / steps;
      if (this.gapAt(jn, y, c, d) >= 0) {
        let lo = prev, hi = y;
        for (let it = 0; it < 40; it++) {
          const mid = (lo + hi) / 2;
          if (this.gapAt(jn, mid, c, d) >= 0) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prev = y;
    }
    return jn.yM;
  }

  /**
   * Sets the slit each notch shuts into from the poses: tall enough that the in-betweens from the last open pose
   * narrow the notch like the real one (the height whose in-betweens stray least from the true outlines).
   */
  setPoses(poses: number[]): void {
    for (const jn of this.junctions) {
      if (jn.shutPsi === null) continue;
      const shut = jn.shutPsi;
      const a = Math.max(...poses.filter((p) => p < shut - 1e-6), 0);
      const known = jn.slitFor.get(a);
      if (known !== undefined) {
        jn.slitTop = known;
        continue;
      }
      const probes = [0.35, 0.6, 0.8, 0.9].map((u) => a + (shut - a) * u);
      const cost = (s: number): number => {
        jn.slitTop = s;
        this.cache.clear();
        const pa = this.pose(a), pb = this.pose(shut);
        return Math.max(...probes.map((psi) => {
          const p = this.pose(psi);
          return shapeError(lerpPath(pa, pb, projectBlend(pa, pb, p)), p);
        }));
      };
      // golden-section search between the notch and its mouth
      let lo = Math.min(jn.yJ, jn.yM), hi = Math.max(jn.yJ, jn.yM);
      const g = (Math.sqrt(5) - 1) / 2;
      let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = cost(x1), f2 = cost(x2);
      for (let it = 0; it < 11; it++) {
        if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = cost(x1); }
        else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = cost(x2); }
      }
      jn.slitTop = (lo + hi) / 2;
      jn.slitFor.set(a, jn.slitTop);
    }
    this.cache.clear();
  }

  /** the silhouette at turn ψ ∈ [0°, 90°], in stage px around the home point */
  pose(psi: number): LottieBezierPath {
    const key = psi.toFixed(4);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const c = Math.cos(psi * D2R), d = this.hd * Math.sin(psi * D2R);
    const slots: Slot[] = this.baseSlots.map((s) => ({ p: [c * s.p[0] + s.shift * d, s.p[1]], hin: [c * s.hin[0], s.hin[1]], hout: [c * s.hout[0], s.hout[1]], shift: s.shift }));
    const ns = slots.length, n = this.segs.length;
    const range = (from: number, to: number): number[] => {
      const out = [from];
      for (let k = from; k !== to; ) out.push((k = (k + 1) % ns));
      return out;
    };
    const shifted = (k: number): Cubic => {
      const sh = this.segShift(k);
      return this.segs[k]!.c.map(([x, y]) => [c * x + sh * d, y]) as Cubic;
    };
    for (const jn of this.junctions) {
      if (!(this.gapAt(jn, jn.yJ, c, d) < 0)) continue;
      const shut = jn.shutPsi !== null && psi >= jn.shutPsi - 1e-9;
      const yC = shut ? jn.yM : this.creaseY(jn, psi);
      const b = shut ? null : this.runAt(jn.before, yC), a = shut ? null : this.runAt(jn.after, yC);
      if (!b || !a) {
        // shut: both sides fold onto a zero-width slit from the mouth up to its top
        const xb = this.runAt(jn.before, jn.yM)!, xa = this.runAt(jn.after, jn.yM)!;
        const sb = this.segShift(jn.before[0]!), sa = this.segShift(jn.after[0]!);
        const xs = (c * xb.x + sb * d + c * xa.x + sa * d) / 2;
        const from = this.slotOut[jn.before[0]!]!, to = this.slotIn[(jn.after[jn.after.length - 1]! + 1) % n]!;
        const ids = range(from, to);
        ids.forEach((id, k) => {
          const s = slots[id]!;
          const beyond = (s.p[1] - jn.slitTop) * (jn.yM - jn.yJ) < 0;
          s.p = [xs, beyond ? jn.slitTop : s.p[1]];
          if (k > 0) s.hin = [0, 0];
          if (k < ids.length - 1) s.hout = [0, 0];
        });
        continue;
      }
      // open below a crease: clip both sides there and fold what lies past it onto the crease point
      const [lb] = splitCubic(shifted(b.seg), b.t);
      const [, ra] = splitCubic(shifted(a.seg), a.t);
      const q: Pt = [(lb[3][0] + ra[0][0]) / 2, yC];
      slots[this.slotOut[b.seg]!]!.hout = [lb[1][0] - lb[0][0], lb[1][1] - lb[0][1]];
      const ids = range(this.slotIn[(b.seg + 1) % n]!, this.slotOut[a.seg]!);
      ids.forEach((id, k) => {
        const s = slots[id]!;
        s.p = q;
        s.hin = k === 0 ? [lb[2][0] - lb[3][0], lb[2][1] - lb[3][1]] : [0, 0];
        s.hout = k === ids.length - 1 ? [ra[1][0] - ra[0][0], ra[1][1] - ra[0][1]] : [0, 0];
      });
      slots[this.slotIn[(a.seg + 1) % n]!]!.hin = [ra[2][0] - ra[3][0], ra[2][1] - ra[3][1]];
    }
    const [hx, hy] = [this.home[0] + this.xc, this.home[1]];
    const out: LottieBezierPath = { c: true, v: slots.map((s) => [hx + s.p[0], hy + s.p[1]]), i: slots.map((s) => s.hin), o: slots.map((s) => s.hout) };
    this.cache.set(key, out);
    return out;
  }

  /** the side face (the outline at ψ = 0), in stage px */
  face(): LottieBezierPath {
    return translatePath(this.outline, this.home[0], this.home[1]);
  }
}

// ---------------------------------------------------------------------------
// General Extrude: any closed SVG outline (non-symmetric, holes allowed) in local x–y extruded along local z,
// projected under an arbitrary 3×3 rotation matrix M (any axis, any tilt).
// Silhouette = exact Minkowski sum of the projected face A(Ω) with the projected 2D half-depth segment [−d, +d]:
//   F ⊕ [−d, +d] = (F + d) ∪ (F − d) ∪ (∂F ⊕ [−d, +d]),
// computed with exact paper.js booleans after rotating so d is horizontal, splitting cubics at horizontal tangents,
// and sweeping each y-monotone piece into a 4-sided curved ribbon. Each pose is converted to fixed-topology paths
// (outer + each hole) for `match: 'vertices'`; shut holes collapse into zero-width slits at their projected centre.
// ---------------------------------------------------------------------------

function signedAreaPath(p: LottieBezierPath): number {
  const pts = samplePath(p, 8);
  let a = 0;
  for (let k = 0; k < pts.length; k++) {
    const q = pts[(k + 1) % pts.length]!;
    a += pts[k]![0] * q[1] - q[0] * pts[k]![1];
  }
  return a / 2;
}

function lottieOfCubics(cubics: Cubic[]): LottieBezierPath {
  const n = cubics.length;
  const v: Pt[] = [];
  const i: Pt[] = new Array(n);
  const o: Pt[] = [];
  cubics.forEach((c, j) => {
    v.push(c[0]);
    o.push([c[1][0] - c[0][0], c[1][1] - c[0][1]]);
    i[(j + 1) % n] = [c[2][0] - c[3][0], c[2][1] - c[3][1]];
  });
  return { c: true, v, i, o };
}

function cubicsWithLinearHandles(p: LottieBezierPath): Cubic[] {
  const n = p.v.length;
  return p.v.map((a, j) => {
    const b = p.v[(j + 1) % n]!;
    const o = p.o[j]!;
    const i = p.i[(j + 1) % n]!;
    if (Math.hypot(o[0], o[1]) < 1e-9 && Math.hypot(i[0], i[1]) < 1e-9) {
      return [a, lerpPt(a, b, 1 / 3), lerpPt(a, b, 2 / 3), b] as Cubic;
    }
    return [a, [a[0] + o[0], a[1] + o[1]], [b[0] + i[0], b[1] + i[1]], b] as Cubic;
  });
}

function transformLottiePath2D(
  p: LottieBezierPath,
  m00: number, m01: number, m10: number, m11: number,
  tx = 0, ty = 0,
): LottieBezierPath {
  const lin = (x: number, y: number): Pt => [m00 * x + m01 * y, m10 * x + m11 * y];
  return {
    c: p.c,
    v: p.v.map(([x, y]) => [m00 * x + m01 * y + tx, m10 * x + m11 * y + ty]),
    i: p.i.map(([x, y]) => lin(x, y)),
    o: p.o.map(([x, y]) => lin(x, y)),
  };
}

function cubicLen(c: Cubic, steps = 20): number {
  let len = 0;
  let prev = c[0];
  for (let s = 1; s <= steps; s++) {
    const p = cubicAt(c, s / steps);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
}

function splitCubicEvenly(c: Cubic, n: number): Cubic[] {
  if (n <= 1) return [c];
  const steps = 64;
  const cum = [0];
  let prev = c[0];
  for (let s = 1; s <= steps; s++) {
    const p = cubicAt(c, s / steps);
    cum.push(cum[s - 1]! + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const total = cum[steps]!;
  if (total < 1e-9) return Array.from({ length: n }, () => [c[0], c[0], c[3], c[3]] as Cubic);
  const timeAt = (len: number): number => {
    let s = 1;
    while (s < steps && cum[s]! < len) s++;
    const u = (len - cum[s - 1]!) / (cum[s]! - cum[s - 1]! || 1);
    return (s - 1 + u) / steps;
  };
  const out: Cubic[] = [];
  let rest = c;
  let t0 = 0;
  for (let k = 1; k < n; k++) {
    const t = timeAt((total * k) / n);
    const [a, b] = splitCubic(rest, Math.max(0, Math.min(1, (t - t0) / (1 - t0 || 1))));
    out.push(a);
    rest = b;
    t0 = t;
  }
  out.push(rest);
  return out;
}

/**
 * Resamples a closed contour to exactly `count` cubics with the requested winding (`cw`).
 * Uses continuous arc-length parameterization with sharp-corner snapping (>16°), so:
 * - sharp corners stay crisp (zero rounding) without discrete per-segment vertex count jumps,
 * - when `prev` is provided, the starting arc-length offset and corner knot assignments match `prev`
 *   continuously so vertices never jump or slide across corners during a morph.
 */
function resampleTrackedContour(
  p: LottieBezierPath,
  targetPt: Pt,
  count: number,
  cw: boolean,
  prev?: LottieBezierPath,
): LottieBezierPath {
  let cubics = cubicsWithLinearHandles(p).filter((c) => cubicLen(c, 8) > 1e-6);
  if (!cubics.length) {
    const q = p.v[0] ?? targetPt;
    return { c: true, v: Array.from({ length: count }, () => q), i: Array.from({ length: count }, () => [0, 0] as Pt), o: Array.from({ length: count }, () => [0, 0] as Pt) };
  }
  const area = signedAreaPath(lottieOfCubics(cubics));
  if ((cw && area < 0) || (!cw && area > 0)) {
    cubics = cubics.reverse().map((c) => [c[3], c[2], c[1], c[0]] as Cubic);
  }

  // Dense closed polyline preserving exact cubic endpoints (so sharp corners are exact vertices)
  const dense: Pt[] = [];
  for (const c of cubics) {
    const len = cubicLen(c, 12);
    const steps = Math.max(4, Math.min(48, Math.ceil(len / 1.5)));
    for (let s = 0; s < steps; s++) {
      const q = cubicAt(c, s / steps);
      const last = dense[dense.length - 1];
      if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-5) dense.push(q);
    }
  }
  if (dense.length < 3) {
    const q = dense[0] ?? targetPt;
    return { c: true, v: Array.from({ length: count }, () => q), i: Array.from({ length: count }, () => [0, 0] as Pt), o: Array.from({ length: count }, () => [0, 0] as Pt) };
  }
  dense.push(dense[0]!);
  const cum = [0];
  for (let k = 1; k < dense.length; k++) {
    cum.push(cum[k - 1]! + Math.hypot(dense[k]![0] - dense[k - 1]![0], dense[k]![1] - dense[k - 1]![1]));
  }
  const L = cum[cum.length - 1]!;
  if (L < 1e-5) {
    const q = dense[0]!;
    return { c: true, v: Array.from({ length: count }, () => q), i: Array.from({ length: count }, () => [0, 0] as Pt), o: Array.from({ length: count }, () => [0, 0] as Pt) };
  }
  const wrapS = (s: number): number => ((s % L) + L) % L;
  const ptAt = (sRaw: number): Pt => {
    const s = wrapS(sRaw);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const d = cum[hi]! - cum[lo]!;
    return d > 1e-9 ? lerpPt(dense[lo]!, dense[hi]!, (s - cum[lo]!) / d) : dense[lo]!;
  };

  // Detect sharp corners (> 16° turn over a short arc window)
  const win = Math.max(0.6, Math.min(2.0, L / 120));
  const rawCorners: Array<{ s: number; ang: number }> = [];
  for (let k = 0; k < dense.length - 1; k++) {
    const s = cum[k]!;
    const pPrev = ptAt(s - win), pCur = dense[k]!, pNext = ptAt(s + win);
    const l1 = Math.hypot(pCur[0] - pPrev[0], pCur[1] - pPrev[1]) || 1;
    const l2 = Math.hypot(pNext[0] - pCur[0], pNext[1] - pCur[1]) || 1;
    const dotT = ((pCur[0] - pPrev[0]) * (pNext[0] - pCur[0]) + (pCur[1] - pPrev[1]) * (pNext[1] - pCur[1])) / (l1 * l2);
    const ang = Math.acos(Math.max(-1, Math.min(1, dotT))) / D2R;
    if (ang > 16) rawCorners.push({ s, ang });
  }
  rawCorners.sort((a, b) => b.ang - a.ang);
  const minCornerSep = L / (count * 2.2);
  const corners: Array<{ s: number; ang: number }> = [];
  const circDist = (a: number, b: number): number => {
    const d = Math.abs(wrapS(a) - wrapS(b));
    return Math.min(d, L - d);
  };
  for (const c of rawCorners) {
    if (corners.every((o) => circDist(o.s, c.s) > minCornerSep)) corners.push(c);
  }

  // Choose continuous starting arc offset s0
  let s0 = 0;
  const prevValid = prev && prev.v.length === count && prev.v.some((v) => Math.hypot(v[0] - prev.v[0]![0], v[1] - prev.v[0]![1]) > 1e-2);
  if (prevValid) {
    const costOf = (off: number): number => {
      let sum = 0;
      for (let j = 0; j < count; j++) {
        const q = ptAt(off + (L * j) / count);
        const pv = prev.v[j]!;
        sum += (q[0] - pv[0]) ** 2 + (q[1] - pv[1]) ** 2;
      }
      return sum;
    };
    const M = count * 2;
    let bestOff = 0, bestC = Infinity;
    for (let m = 0; m < M; m++) {
      const off = (L * m) / M;
      const c = costOf(off);
      if (c < bestC) { bestC = c; bestOff = off; }
    }
    // Local golden-section polish around bestOff
    let lo = bestOff - L / M, hi = bestOff + L / M;
    for (let it = 0; it < 10; it++) {
      const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
      if (costOf(m1) < costOf(m2)) hi = m2;
      else lo = m1;
    }
    s0 = wrapS((lo + hi) / 2);
  } else {
    let bestD2 = Infinity;
    for (let k = 0; k < dense.length - 1; k++) {
      const q = dense[k]!;
      const d2 = (q[0] - targetPt[0]) ** 2 + (q[1] - targetPt[1]) ** 2;
      if (d2 < bestD2) { bestD2 = d2; s0 = cum[k]!; }
    }
  }

  // Place `count` knots uniformly from s0, then snap sharp corners to their best matching knot index
  const knotU = Array.from({ length: count }, (_, j) => (L * j) / count);
  const isCorner = new Array<boolean>(count).fill(false);
  for (const c of corners) {
    const rel = wrapS(c.s - s0);
    const jUnif = Math.round((rel / L) * count) % count;
    let bestJ = -1, bestScore = Infinity;
    const cPt = ptAt(c.s);
    const radius = prevValid ? 2 : 1;
    for (let dj = -radius; dj <= radius; dj++) {
      const j = ((jUnif + dj) % count + count) % count;
      if (isCorner[j]) continue;
      const arcDiff = circDist(rel, (L * j) / count);
      if (arcDiff > (radius + 0.25) * (L / count)) continue;
      const score = prevValid
        ? Math.hypot(prev.v[j]![0] - cPt[0], prev.v[j]![1] - cPt[1]) + 0.15 * arcDiff
        : arcDiff;
      if (score < bestScore) { bestScore = score; bestJ = j; }
    }
    if (bestJ >= 0) {
      knotU[bestJ] = rel;
      isCorner[bestJ] = true;
    }
  }

  // Sort knots strictly around [0, L) preserving corner flags
  const pairs = knotU.map((u, idx) => ({ u: wrapS(u), corner: isCorner[idx]! })).sort((a, b) => a.u - b.u);
  const minGap = L * 1e-4;
  for (let j = 1; j < count; j++) {
    if (pairs[j]!.u <= pairs[j - 1]!.u + minGap) pairs[j]!.u = pairs[j - 1]!.u + minGap;
  }

  // Extract dense sub-polyline for each interval [u_j, u_{j+1}] and fit one cubic
  const subs: Pt[][] = [];
  for (let j = 0; j < count; j++) {
    const ua = pairs[j]!.u;
    const ub = j < count - 1 ? pairs[j + 1]!.u : pairs[0]!.u + L;
    const span = ub - ua;
    const sub: Pt[] = [ptAt(s0 + ua)];
    // Include dense vertices strictly inside (s0 + ua, s0 + ub)
    const nInner = Math.max(6, Math.min(24, Math.ceil(span / 1.5)));
    for (let s = 1; s < nInner; s++) sub.push(ptAt(s0 + ua + (span * s) / nInner));
    sub.push(ptAt(s0 + ub));
    subs.push(sub);
  }

  const startTan = (sub: Pt[]): Pt => {
    const p0 = sub[0]!;
    let target = sub[1]!;
    let acc = 0;
    for (let k = 1; k < sub.length; k++) {
      acc += Math.hypot(sub[k]![0] - sub[k - 1]![0], sub[k]![1] - sub[k - 1]![1]);
      target = sub[k]!;
      if (acc >= 0.7) break;
    }
    const dx = target[0] - p0[0], dy = target[1] - p0[1], l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const endTan = (sub: Pt[]): Pt => {
    const pN = sub[sub.length - 1]!;
    let target = sub[sub.length - 2]!;
    let acc = 0;
    for (let k = sub.length - 2; k >= 0; k--) {
      acc += Math.hypot(sub[k + 1]![0] - sub[k]![0], sub[k + 1]![1] - sub[k]![1]);
      target = sub[k]!;
      if (acc >= 0.7) break;
    }
    const dx = pN[0] - target[0], dy = pN[1] - target[1], l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };

  const outCubics: Cubic[] = [];
  for (let j = 0; j < count; j++) {
    const sub = subs[j]!;
    let t0 = startTan(sub);
    let t3 = endTan(sub);
    if (!pairs[j]!.corner) {
      const pe = endTan(subs[(j + count - 1) % count]!);
      const sx = pe[0] + t0[0], sy = pe[1] + t0[1], l = Math.hypot(sx, sy);
      if (l > 1e-6) t0 = [sx / l, sy / l];
    }
    if (!pairs[(j + 1) % count]!.corner) {
      const ns = startTan(subs[(j + 1) % count]!);
      const sx = t3[0] + ns[0], sy = t3[1] + ns[1], l = Math.hypot(sx, sy);
      if (l > 1e-6) t3 = [sx / l, sy / l];
    }
    outCubics.push(fitPiece(sub, t0, t3).c);
  }
  const built = lottieOfCubics(outCubics);
  return prevValid ? alignPathToPrev(prev, built) : built;
}

/** Cyclically shifts a closed path's vertex start index without altering its geometry. */
function rotatePathVerts(p: LottieBezierPath, shift: number): LottieBezierPath {
  const n = p.v.length;
  const s = ((shift % n) + n) % n;
  if (s === 0) return p;
  return {
    c: p.c,
    v: p.v.map((_, j) => p.v[(j + s) % n]!),
    i: p.i.map((_, j) => p.i[(j + s) % n]!),
    o: p.o.map((_, j) => p.o[(j + s) % n]!),
  };
}

/** Picks the cyclic vertex shift of `cur` that minimizes total squared vertex travel from `prev` (zero geometry change). */
function alignPathToPrev(prev: LottieBezierPath, cur: LottieBezierPath): LottieBezierPath {
  const n = prev.v.length;
  if (cur.v.length !== n || n <= 1) return cur;
  let bestShift = 0;
  let bestCost = Infinity;
  for (let s = 0; s < n; s++) {
    let cost = 0;
    for (let j = 0; j < n; j++) {
      const a = prev.v[j]!, b = cur.v[(j + s) % n]!;
      cost += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
      if (cost >= bestCost) break;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestShift = s;
    }
  }
  return rotatePathVerts(cur, bestShift);
}

/** Collapses a last-open hole contour onto a zero-width slit of its own height, centred at `center`. */
function holeSlitFromOpen(openHole: LottieBezierPath, center: Pt): LottieBezierPath {
  const n = openHole.v.length;
  const cx0 = openHole.v.reduce((s, p) => s + p[0], 0) / n;
  const cy0 = openHole.v.reduce((s, p) => s + p[1], 0) / n;
  // principal axis (long axis of the barely-open hole) via 2×2 covariance
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of openHole.v) {
    const dx = x - cx0, dy = y - cy0;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ex = Math.cos(ang), ey = Math.sin(ang);
  return {
    c: true,
    v: openHole.v.map(([x, y]) => {
      const proj = (x - cx0) * ex + (y - cy0) * ey;
      return [center[0] + proj * ex, center[1] + proj * ey] as Pt;
    }),
    i: Array.from({ length: n }, () => [0, 0] as Pt),
    o: Array.from({ length: n }, () => [0, 0] as Pt),
  };
}

/** Filled even-odd scanline spans over multiple closed polylines. */
function fillSpansMulti(polys: Pt[][], y0: number, rows: number, cell: number): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const y = y0 + (r + 0.5) * cell;
    const xs: number[] = [];
    for (const poly of polys) {
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k]!, b = poly[(k + 1) % poly.length]!;
        if ((a[1] <= y) === (b[1] <= y)) continue;
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    out.push(xs);
  }
  return out;
}

/** Multi-contour (even-odd filled) visual difference in px; zero-width slits cover nothing so cost nothing. */
function compoundShapeError(a: LottieBezierPath[], b: LottieBezierPath[], cell = 0.75): number {
  const pa = a.map((p) => samplePath(p, 8)), pb = b.map((p) => samplePath(p, 8));
  let y0 = Infinity, y1 = -Infinity;
  for (const poly of [...pa, ...pb]) for (const p of poly) {
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return 0;
  const rows = Math.ceil((y1 - y0) / cell) + 1;
  const sa = fillSpansMulti(pa, y0, rows, cell), sb = fillSpansMulti(pb, y0, rows, cell);
  const diff: Pt[] = [];
  for (let r = 0; r < rows; r++) {
    const edges = [...sa[r]!.map((x) => [x, 0] as const), ...sb[r]!.map((x) => [x, 1] as const)].sort((p, q) => p[0] - q[0]);
    const inside = [false, false];
    const y = y0 + (r + 0.5) * cell;
    for (let k = 0; k < edges.length - 1; k++) {
      inside[edges[k]![1]] = !inside[edges[k]![1]];
      if (inside[0] === inside[1]) continue;
      const [xa, xb] = [edges[k]![0], edges[k + 1]![0]];
      for (let x = xa + Math.min(cell, (xb - xa) / 2) / 2; x < xb; x += cell) diff.push([x, y]);
    }
  }
  const stride = Math.max(1, Math.floor(diff.length / 260));
  const distMulti = (q: Pt, polys: Pt[][]): number => Math.min(...polys.map((poly) => distToPolyline(q, poly)));
  let worst = 0;
  for (let k = 0; k < diff.length; k += stride) {
    const q = diff[k]!;
    worst = Math.max(worst, distMulti(q, pa) + distMulti(q, pb));
  }
  return worst;
}

/** Splits a cubic at its horizontal-tangent roots (y'(t) = 0) into y-monotone sub-cubics. */
function splitYMonotone(c: Cubic): Cubic[] {
  const [y0, y1, y2, y3] = c.map((p) => p[1]) as [number, number, number, number];
  const qa = 3 * (-y0 + 3 * y1 - 3 * y2 + y3), qb = 6 * (y0 - 2 * y1 + y2), qc = 3 * (y1 - y0);
  const roots: number[] = [];
  if (Math.abs(qa) < 1e-9) {
    if (Math.abs(qb) > 1e-9) roots.push(-qc / qb);
  } else {
    const disc = qb * qb - 4 * qa * qc;
    if (disc >= 0) roots.push((-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa));
  }
  const out: Cubic[] = [];
  let rest = c, t0 = 0;
  for (const t of roots.filter((t) => t > 1e-4 && t < 1 - 1e-4).sort((p, q) => p - q)) {
    const [l, r] = splitCubic(rest, (t - t0) / (1 - t0));
    out.push(l);
    rest = r;
    t0 = t;
  }
  out.push(rest);
  return out;
}

function canUseAnalyticStrip(part: TurntableExtrude, view: View): boolean {
  if (!view.upright || part.rotation) return false;
  if (part.center && (Math.abs(part.center[0]) > 1e-6 || Math.abs(part.center[1]) > 1e-6)) return false;
  const shape = geo.fromSvgPath(part.outline);
  const contours = geo.toLottiePaths(shape);
  if (contours.length !== 1) return false;
  const p = contours[0]!;
  const xs = samplePath(p, 8).map((q) => q[0]);
  const xc = (Math.min(...xs) + Math.max(...xs)) / 2;
  const mirror: LottieBezierPath = { c: true, v: p.v.map(([x, y]) => [2 * xc - x, y]), i: p.i.map(([x, y]) => [-x, y]), o: p.o.map(([x, y]) => [-x, y]) };
  return outlineDistance(p, mirror) <= 0.5;
}

interface RawExtrudeProjection {
  outer: LottieBezierPath;
  holes: Array<LottieBezierPath | null>;
}

class ExtrudeModel {
  readonly outer: LottieBezierPath;
  readonly holes: LottieBezierPath[];
  readonly holeCenters: Pt[];
  readonly outerAnchorLocal: Pt;
  readonly holeAnchorsLocal: Pt[];
  readonly halfW: number;
  readonly halfH: number;
  readonly outerVerts = 64;
  readonly holeVerts = 24;
  private cache = new Map<string, RawExtrudeProjection>();

  constructor(readonly part: TurntableExtrude, readonly home: Pt) {
    const shape = geo.fromSvgPath(part.outline);
    const raw = geo.toLottiePaths(shape);
    if (!raw.length) throw new Error(`turntable: extrude "${part.name}" outline has no closed contour`);
    const orient = (p: LottieBezierPath, cw: boolean): LottieBezierPath => {
      const a = signedAreaPath(p);
      if ((cw && a < 0) || (!cw && a > 0)) {
        return lottieOfCubics(cubicsWithLinearHandles(p).reverse().map((c) => [c[3], c[2], c[1], c[0]] as Cubic));
      }
      return p;
    };
    this.outer = orient(raw[0]!, true);
    this.holes = raw.slice(1).map((h) => orient(h, false));
    const centroidOf = (p: LottieBezierPath): Pt => {
      const pts = samplePath(p, 8);
      return [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
    };
    this.holeCenters = this.holes.map(centroidOf);
    const outerPts = samplePath(this.outer, 8);
    this.halfW = Math.max(...outerPts.map((q) => Math.abs(q[0])));
    this.halfH = Math.max(...outerPts.map((q) => Math.abs(q[1])));
    // Physical landmark on each contour (highest point in local outline) tracked continuously across 360°
    this.outerAnchorLocal = outerPts.reduce((best, q) => (q[1] < best[1] ? q : best), outerPts[0]!);
    this.holeAnchorsLocal = this.holes.map((h) => {
      const pts = samplePath(h, 8);
      return pts.reduce((best, q) => (q[1] < best[1] ? q : best), pts[0]!);
    });
  }

  /** Local face SVG paths (shifted to `home`), for front (+z, `mirror=false`) and back (−z, `mirror=true`). */
  faceContours(mirror: boolean): LottieBezierPath[] {
    const sx = mirror ? -1 : 1;
    return [this.outer, ...this.holes].map((p) => transformLottiePath2D(p, sx, 0, 0, 1, this.home[0], this.home[1]));
  }

  /** Exact 2D Minkowski-sum silhouette (outer + open holes) in local stage px around `home`, at rotation matrix `m`. */
  projectRaw(m: M3): RawExtrudeProjection {
    const key = m.flat().map((v) => v.toFixed(5)).join(',');
    const hit = this.cache.get(key);
    if (hit) return hit;

    const [m00, m01, m02] = m[0];
    const [m10, m11, m12] = m[1];
    const fz = m[2][2];
    const hd = this.part.depth / 2;
    const dx = hd * m02, dy = hd * m12;
    const ld = Math.hypot(dx, dy);
    const [hx, hy] = this.home;

    // Case 1: Face-on (depth projection vanishes)
    if (ld < 1e-4) {
      const out: RawExtrudeProjection = {
        outer: transformLottiePath2D(this.outer, m00, m01, m10, m11, hx, hy),
        holes: this.holes.map((h) => transformLottiePath2D(h, m00, m01, m10, m11, hx, hy)),
      };
      this.cache.set(key, out);
      return out;
    }

    // Case 2: Edge-on (face collapses to a 1D line; exact silhouette is a solid rectangle of thickness `depth`)
    if (Math.abs(fz) < 1.5e-3) {
      const ux = dx / ld, uy = dy / ld; // along depth
      const vx = -uy, vy = ux;          // along projected face line
      const pts = samplePath(this.outer, 12).map(([x, y]): Pt => [m00 * x + m01 * y, m10 * x + m11 * y]);
      let sMin = Infinity, sMax = -Infinity, uSum = 0;
      for (const [px, py] of pts) {
        const s = px * vx + py * vy;
        sMin = Math.min(sMin, s);
        sMax = Math.max(sMax, s);
        uSum += px * ux + py * uy;
      }
      const uMid = uSum / pts.length;
      const pt = (u: number, s: number): Pt => [hx + u * ux + s * vx, hy + u * uy + s * vy];
      const corners = [pt(uMid - ld, sMin), pt(uMid + ld, sMin), pt(uMid + ld, sMax), pt(uMid - ld, sMax)];
      const rect: LottieBezierPath = { c: true, v: corners, i: corners.map(() => [0, 0]), o: corners.map(() => [0, 0]) };
      const out: RawExtrudeProjection = { outer: rect, holes: this.holes.map(() => null) };
      this.cache.set(key, out);
      return out;
    }

    // Case 3: General 3D angle — rotate projected coords by −atan2(dy, dx) so depth sweep is horizontal (±ld, 0)
    const thetaD = Math.atan2(dy, dx);
    const ct = Math.cos(thetaD), st = Math.sin(thetaD);
    // B = R(−thetaD) · A
    const b00 = ct * m00 + st * m10, b01 = ct * m01 + st * m11;
    const b10 = -st * m00 + ct * m10, b11 = -st * m01 + ct * m11;
    const rotContours = [this.outer, ...this.holes].map((p) => {
      const tp = transformLottiePath2D(p, b00, b01, b10, b11, 0, 0);
      // Ensure outer is CW and holes are CCW after affine map (which flips sign when det(A) = fz < 0)
      const isOuter = p === this.outer;
      const a = signedAreaPath(tp);
      if ((isOuter && a < 0) || (!isOuter && a > 0)) {
        return lottieOfCubics(cubicsWithLinearHandles(tp).reverse().map((c) => [c[3], c[2], c[1], c[0]] as Cubic));
      }
      return tp;
    });

    const facePlus = geo.fromLottiePaths(rotContours.map((p) => translatePath(p, ld, 0)));
    const faceMinus = geo.fromLottiePaths(rotContours.map((p) => translatePath(p, -ld, 0)));
    let swept = geo.union(facePlus, faceMinus);

    // Union exact 4-sided swept ribbon for every y-monotone boundary piece of outer and holes
    for (const contour of rotContours) {
      for (const c0 of cubicsOfPath(contour)) {
        for (const c of splitYMonotone(c0)) {
          if (Math.abs(c[3][1] - c[0][1]) < 1e-4) continue;
          const left: Cubic = c.map(([x, y]) => [x - ld, y]) as Cubic;
          const rightRev: Cubic = [c[3], c[2], c[1], c[0]].map(([x, y]) => [x + ld, y]) as Cubic;
          const top: Cubic = [left[3], lerpPt(left[3], rightRev[0], 1 / 3), lerpPt(left[3], rightRev[0], 2 / 3), rightRev[0]];
          const bot: Cubic = [rightRev[3], lerpPt(rightRev[3], left[0], 1 / 3), lerpPt(rightRev[3], left[0], 2 / 3), left[0]];
          let ribPath = lottieOfCubics([left, top, rightRev, bot]);
          const ribArea = signedAreaPath(ribPath);
          if (Math.abs(ribArea) < 1e-4) continue;
          if (ribArea < 0) ribPath = lottieOfCubics(cubicsWithLinearHandles(ribPath).reverse().map((q) => [q[3], q[2], q[1], q[0]] as Cubic));
          swept = geo.union(swept, geo.fromLottiePath(ribPath));
        }
      }
    }

    // Rotate swept result back by +thetaD and shift to `home`
    const unrot = geo.toLottiePaths(swept).map((p) => transformLottiePath2D(p, ct, -st, st, ct, hx, hy));
    const resOuter = unrot[0] ?? transformLottiePath2D(this.outer, m00, m01, m10, m11, hx, hy);
    const rem = unrot.slice(1).filter((p) => Math.abs(signedAreaPath(p)) > 0.5);

    // Match each remaining hole contour to the closest projected original hole centre
    const holeOut: Array<LottieBezierPath | null> = this.holes.map(() => null);
    const used = new Set<number>();
    this.holeCenters.forEach(([cx0, cy0], h) => {
      const target: Pt = [hx + m00 * cx0 + m01 * cy0, hy + m10 * cx0 + m11 * cy0];
      let best = { idx: -1, d2: Infinity };
      rem.forEach((cand, idx) => {
        if (used.has(idx)) return;
        const pts = samplePath(cand, 6);
        const mx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
        const my = pts.reduce((s, q) => s + q[1], 0) / pts.length;
        const d2 = (mx - target[0]) ** 2 + (my - target[1]) ** 2;
        if (d2 < best.d2) best = { idx, d2 };
      });
      if (best.idx >= 0) {
        used.add(best.idx);
        holeOut[h] = rem[best.idx]!;
      }
    });

    const out: RawExtrudeProjection = { outer: resOuter, holes: holeOut };
    this.cache.set(key, out);
    return out;
  }

  /** Fixed-topology resampled contours [outer, hole0, hole1, …] at orientation `m` (optionally aligned to `prev`). */
  poseContours(m: M3, openHoleRef: Array<LottieBezierPath | null>, prev?: LottieBezierPath[]): LottieBezierPath[] {
    const raw = this.projectRaw(m);
    const [m00, m01] = [m[0][0], m[0][1]];
    const [m10, m11] = [m[1][0], m[1][1]];
    const [hx, hy] = this.home;
    const outerTarget: Pt = [hx, hy - 1e6];
    const outerFixed = resampleTrackedContour(raw.outer, outerTarget, this.outerVerts, true, prev?.[0]);
    const holesFixed = this.holes.map((_, h) => {
      const open = raw.holes[h];
      const [hcx, hcy] = this.holeCenters[h]!;
      const center: Pt = [hx + m00 * hcx + m01 * hcy, hy + m10 * hcx + m11 * hcy];
      if (open) {
        const [ax, ay] = this.holeAnchorsLocal[h]!;
        const target: Pt = [hx + m00 * ax + m01 * ay, hy + m10 * ax + m11 * ay];
        return resampleTrackedContour(open, target, this.holeVerts, false, prev?.[h + 1]);
      }
      const ref = openHoleRef[h];
      if (ref) return holeSlitFromOpen(ref, center);
      // Fallback zero-width slit at projected hole centre
      return {
        c: true,
        v: Array.from({ length: this.holeVerts }, () => center),
        i: Array.from({ length: this.holeVerts }, () => [0, 0] as Pt),
        o: Array.from({ length: this.holeVerts }, () => [0, 0] as Pt),
      };
    });
    return [outerFixed, ...holesFixed];
  }
}

// ---------------------------------------------------------------------------
// Disc wall: a disc with its rim rounded (radius r) is a sharp-edged core (radius − r, depth − 2r) grown by r in
// every direction, so its silhouette is the hull of the core's two end ovals (|sin ψ| wide, |cos ψ| apart) grown by r:
// a straight top and bottom and, at each end, the oval's offset curve. Each quarter of that is two cubics fitted to
// the exact curve, split where the rim's corner ends, so a nearly flat oval (front view: a rounded rectangle) and a
// round one (side view: a circle) both come out exact; the same ten vertices at every angle.
// ---------------------------------------------------------------------------

/** a cubic from dense[0] (heading t0) to its last point (arriving along t3) fitted to the dense points by least squares, and its worst miss */
function fitPiece(dense: Pt[], t0: Pt, t3: Pt): { c: Cubic; err: number } {
  const p0 = dense[0]!, p3 = dense[dense.length - 1]!;
  const cum = [0];
  for (let k = 1; k < dense.length; k++) cum.push(cum[k - 1]! + Math.hypot(dense[k]![0] - dense[k - 1]![0], dense[k]![1] - dense[k - 1]![1]));
  const len = cum[cum.length - 1]!;
  if (len < 1e-6) return { c: [p0, p0, p3, p3], err: 0 };
  const targets: Array<[number, Pt]> = [];
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (let s = 1; s < 16; s++) {
    const target = (len * s) / 16;
    let k = 1;
    while (k < cum.length - 1 && cum[k]! < target) k++;
    const f = (target - cum[k - 1]!) / (cum[k]! - cum[k - 1]! || 1);
    const q = lerpPt(dense[k - 1]!, dense[k]!, f), t = s / 16, m = 1 - t;
    targets.push([t, q]);
    const base = [0, 1].map((d) => (m * m * m + 3 * m * m * t) * p0[d]! + (3 * m * t * t + t * t * t) * p3[d]!);
    const A = [3 * m * m * t * t0[0], 3 * m * m * t * t0[1]], B = [-3 * m * t * t * t3[0], -3 * m * t * t * t3[1]];
    const r = [q[0] - base[0]!, q[1] - base[1]!];
    a11 += A[0]! * A[0]! + A[1]! * A[1]!;
    a12 += A[0]! * B[0]! + A[1]! * B[1]!;
    a22 += B[0]! * B[0]! + B[1]! * B[1]!;
    b1 += A[0]! * r[0]! + A[1]! * r[1]!;
    b2 += B[0]! * r[0]! + B[1]! * r[1]!;
  }
  const det = a11 * a22 - a12 * a12;
  const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  let al = chord / 3, be = chord / 3;
  if (Math.abs(det) > 1e-9) {
    al = Math.max(0, Math.min(len, (a22 * b1 - a12 * b2) / det));
    be = Math.max(0, Math.min(len, (a11 * b2 - a12 * b1) / det));
  }
  const c: Cubic = [p0, [p0[0] + al * t0[0], p0[1] + al * t0[1]], [p3[0] - be * t3[0], p3[1] - be * t3[1]], p3];
  const poly = Array.from({ length: 33 }, (_, k) => cubicAt(c, k / 32));
  poly.push(...[...poly].reverse());
  return { c, err: Math.max(...targets.map(([, q]) => distToPolyline(q, poly))) };
}

class DiscModel {
  private cache = new Map<string, LottieBezierPath>();
  readonly faceR: number;
  readonly radius: number;
  readonly depth: number;

  constructor(readonly part: TurntableDisc, readonly home: Pt) {
    this.radius = part.radius ?? 0;
    this.depth = part.depth ?? 0;
    this.faceR = this.radius - (part.rim ?? 0);
  }

  pose(psi: number): LottieBezierPath {
    const key = psi.toFixed(4);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const [cx, cy] = this.home;
    const r = Math.min(this.part.rim ?? 0, this.radius);
    const a = (this.radius - r) * Math.sin(psi * D2R), b = this.radius - r;
    const h = Math.max(0, this.depth / 2 - r) * Math.cos(psi * D2R);
    // one end's upper-right quarter, centred on (0, 0): top T → corner end K → side S. Up to K it follows the outward
    // normal angle n (the rim turning the corner), after K the oval's own angle θ (its side running down).
    const byNormal = (n: number): Pt => {
      const [cn, sn] = [Math.cos(n), Math.sin(n)];
      const k = Math.sqrt(a * a * cn * cn + b * b * sn * sn);
      return [(a * a * cn) / k + r * cn, (b * b * sn) / k + r * sn];
    };
    const byAngle = (th: number): Pt => {
      const [nx, ny] = [b * Math.cos(th), a * Math.sin(th)];
      const l = Math.hypot(nx, ny) || 1;
      return [a * Math.cos(th) + (r * nx) / l, b * Math.sin(th) + (r * ny) / l];
    };
    const T: Pt = [0, -b - r], S: Pt = [a + r, 0];
    const heading = (n: number): Pt => [-Math.sin(n), Math.cos(n)];
    // K: the corner end, at outward normal angle nK
    const split = (nK: number): [ReturnType<typeof fitPiece>, ReturnType<typeof fitPiece>] => {
      const thK = a > 1e-9 ? Math.atan((b / a) * Math.tan(nK)) : -Math.PI / 2;
      const K = byNormal(nK);
      // each piece sampled by both angles (the normal covers the rim's turn, θ the oval's side), in order along it
      const from = (n0: number, n1: number, th0: number, th1: number, key: (p: Pt) => number, p0: Pt, p1: Pt): Pt[] => {
        const pts: Pt[] = [];
        for (let k = 1; k < 64; k++) pts.push(byNormal(n0 + ((n1 - n0) * k) / 64), byAngle(th0 + ((th1 - th0) * k) / 64));
        return [p0, ...pts.filter((p) => key(p) > key(p0) && key(p) < key(p1)).sort((p, q) => key(p) - key(q)), p1];
      };
      return [
        fitPiece(from(-Math.PI / 2, nK, -Math.PI / 2, thK, (p) => p[0], T, K), [1, 0], heading(nK)),
        fitPiece(from(nK, 0, thK, 0, (p) => p[1], K, S), heading(nK), [0, 1]),
      ];
    };
    // where the rim stops turning: ~50° × width/height of the normal, so K moves smoothly from pose to pose (≤ 0.35 px)
    const [{ c: q1 }, { c: q2 }] = split(Math.min(-0.005, -0.87 * (a / b)));
    const place = (c: Cubic, sx: number, sy: number, dx: number): Cubic => c.map(([x, y]) => [cx + dx + sx * x, cy + sy * y]) as Cubic;
    const rev = (c: Cubic): Cubic => [c[3], c[2], c[1], c[0]];
    const right = [place(q1, 1, 1, h), place(q2, 1, 1, h), rev(place(q2, 1, -1, h)), rev(place(q1, 1, -1, h))];
    const left = [place(q1, -1, -1, -h), place(q2, -1, -1, -h), rev(place(q2, -1, 1, -h)), rev(place(q1, -1, 1, -h))];
    const line = (p: Pt, q: Pt): Cubic => [p, lerpPt(p, q, 1 / 3), lerpPt(p, q, 2 / 3), q];
    const cubics: Cubic[] = [...right, line(right[3]![3], left[0]![0]), ...left, line(left[3]![3], right[0]![0])];
    // rotate so the path starts at the top-left corner: top line, right half, bottom line, left half
    const order = [9, 0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => cubics[k]!);
    const n = order.length;
    const out: LottieBezierPath = {
      c: true,
      v: order.map((c) => c[0]),
      o: order.map((c) => [c[1][0] - c[0][0], c[1][1] - c[0][1]] as Pt),
      i: order.map((_, j) => {
        const prev = order[(j + n - 1) % n]!;
        return [prev[2][0] - prev[3][0], prev[2][1] - prev[3][1]] as Pt;
      }),
    };
    // straight lines keep zero handles
    for (const j of [0, 5]) {
      out.o[j] = [0, 0];
      out.i[(j + 1) % n] = [0, 0];
    }
    this.cache.set(key, out);
    return out;
  }
}

// ---------------------------------------------------------------------------
// General lathe profile: exact analytical silhouette envelope of any surface of revolution `(x(t), r(t))` about its
// local x axis, plus optional open-vessel interior (`innerProfile`: rim opening + clipped inner floor lens).
// ---------------------------------------------------------------------------

interface ProfileKnot { x: number; r: number; in?: Pt; out?: Pt }

function parseProfile(pts: TurntableProfilePoint[]): { knots: ProfileKnot[]; cubics: Cubic[] } {
  const norm: ProfileKnot[] = pts.map((p) =>
    Array.isArray(p) ? { x: p[0], r: Math.max(0, p[1]) } : { x: p.x, r: Math.max(0, p.r), in: p.in, out: p.out },
  );
  if (norm.length < 2) throw new Error('turntable: lathe `profile` needs at least two points');
  const ordered =
    norm[0]!.x > norm[norm.length - 1]!.x
      ? [...norm].reverse().map((k) => ({ x: k.x, r: k.r, in: k.out, out: k.in }))
      : norm;
  const cubics: Cubic[] = [];
  for (let j = 0; j < ordered.length - 1; j++) {
    const a = ordered[j]!, b = ordered[j + 1]!;
    const p0: Pt = [a.x, a.r], p3: Pt = [b.x, b.r];
    const hasH = (a.out && (a.out[0] !== 0 || a.out[1] !== 0)) || (b.in && (b.in[0] !== 0 || b.in[1] !== 0));
    const p1: Pt = hasH ? [a.x + (a.out?.[0] ?? 0), a.r + (a.out?.[1] ?? 0)] : lerpPt(p0, p3, 1 / 3);
    const p2: Pt = hasH ? [b.x + (b.in?.[0] ?? 0), b.r + (b.in?.[1] ?? 0)] : lerpPt(p0, p3, 2 / 3);
    cubics.push([p0, p1, p2, p3]);
  }
  return { knots: ordered, cubics };
}

function cubicDeriv(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const dx = 3 * u * u * (c[1][0] - c[0][0]) + 6 * u * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0]);
  const dy = 3 * u * u * (c[1][1] - c[0][1]) + 6 * u * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1]);
  return [dx, dy];
}

interface MonotoneCurve {
  x0: number;
  x1: number;
  eval(x: number): number;
  sampleXs(): number[];
}

function polylineCurve(pts: Pt[]): MonotoneCurve {
  const asc = pts[0]![0] <= pts[pts.length - 1]![0] ? pts : [...pts].reverse();
  const x0 = asc[0]![0], x1 = asc[asc.length - 1]![0];
  return {
    x0,
    x1,
    eval(x: number): number {
      if (x < x0 - 1e-7 || x > x1 + 1e-7) return -1;
      if (x <= x0) return asc[0]![1];
      if (x >= x1) return asc[asc.length - 1]![1];
      let lo = 0, hi = asc.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (asc[mid]![0] <= x) lo = mid;
        else hi = mid;
      }
      const a = asc[lo]!, b = asc[hi]!;
      const f = Math.abs(b[0] - a[0]) > 1e-9 ? (x - a[0]) / (b[0] - a[0]) : 0;
      return a[1] + (b[1] - a[1]) * f;
    },
    sampleXs: () => asc.map((p) => p[0]),
  };
}

function ellipseUpperCurve(xc: number, rx: number, ry: number): MonotoneCurve {
  const x0 = xc - rx, x1 = xc + rx;
  return {
    x0,
    x1,
    eval(x: number): number {
      if (x < x0 - 1e-7 || x > x1 + 1e-7) return -1;
      const u = (x - xc) / rx;
      return ry * Math.sqrt(Math.max(0, 1 - u * u));
    },
    sampleXs(): number[] {
      const out: number[] = [];
      for (let k = 0; k <= 40; k++) out.push(xc - rx * Math.cos((Math.PI * k) / 40));
      return out;
    },
  };
}

function unit2(dx: number, dy: number): Pt {
  const l = Math.hypot(dx, dy);
  return l > 1e-9 ? [dx / l, dy / l] : [1, 0];
}

interface InnerVesselSpec {
  openEnd: 1 | -1;
  xRim: number;
  rRim: number;
  xFloor: number;
  rFloor: number;
  shutPsi: number;
}

class LatheProfileModel {
  readonly knots: ProfileKnot[];
  readonly cubics: Cubic[];
  readonly xNeg: number;
  readonly rNeg: number;
  readonly xPos: number;
  readonly rPos: number;
  readonly maxR: number;
  readonly maxExtent: number;
  readonly upperSegs = 18;
  readonly inner: InnerVesselSpec | null = null;
  private cache = new Map<string, LottieBezierPath>();
  private innerBaseCache = new Map<string, LottieBezierPath>();

  constructor(readonly part: TurntableDisc, readonly home: Pt) {
    const parsed = parseProfile(part.profile!);
    this.knots = parsed.knots;
    this.cubics = parsed.cubics;
    this.xNeg = this.knots[0]!.x;
    this.rNeg = this.knots[0]!.r;
    this.xPos = this.knots[this.knots.length - 1]!.x;
    this.rPos = this.knots[this.knots.length - 1]!.r;
    let mr = 0, me = 0;
    for (const c of this.cubics) {
      for (let s = 0; s <= 16; s++) {
        const [x, r] = cubicAt(c, s / 16);
        mr = Math.max(mr, r);
        me = Math.max(me, Math.hypot(x, r));
      }
    }
    this.maxR = mr;
    this.maxExtent = me;
    if (part.innerProfile && part.innerProfile.length >= 2) {
      const ip = parseProfile(part.innerProfile);
      const iNeg = ip.knots[0]!, iPos = ip.knots[ip.knots.length - 1]!;
      const openEnd: 1 | -1 = Math.abs(iPos.x - this.xPos) <= Math.abs(iNeg.x - this.xNeg) ? 1 : -1;
      const rimK = openEnd > 0 ? iPos : iNeg;
      const floorK = openEnd > 0 ? iNeg : iPos;
      const depth = Math.abs(rimK.x - floorK.x);
      const shutPsi = Math.atan2(depth, Math.max(1e-6, rimK.r + floorK.r)) / D2R;
      this.inner = { openEnd, xRim: rimK.x, rRim: rimK.r, xFloor: floorK.x, rFloor: floorK.r, shutPsi };
    }
  }

  /** Exact upper silhouette polyline `U = [(X_min, 0), ..., (X_max, 0)]` (with Y <= 0) at angle `psi ∈ [0°, 90°]`. */
  private upperEnvelope(psi: number): Pt[] {
    const c = Math.cos(psi * D2R), s = Math.sin(psi * D2R);
    if (s < 1e-4) {
      // Side-on: exact profile curve + vertical end lines
      const raw: Pt[] = [];
      if (this.rNeg > 1e-4) raw.push([this.xNeg, 0]);
      for (const seg of this.cubics) {
        for (let k = 0; k <= 40; k++) {
          const [x, r] = cubicAt(seg, k / 40);
          const prev = raw[raw.length - 1];
          if (!prev || Math.hypot(x - prev[0], -r - prev[1]) > 1e-4) raw.push([x, -r]);
        }
      }
      if (this.rPos > 1e-4) raw.push([this.xPos, 0]);
      return raw;
    }

    const curves: MonotoneCurve[] = [];
    const extraXs: number[] = [];

    // 1. Exact smooth contour generator branches: cos φ = −(r'(t)·sin ψ) / (x'(t)·cos ψ)
    for (const seg of this.cubics) {
      const run: Pt[] = [];
      const flush = (): void => {
        if (run.length < 2) { run.length = 0; return; }
        // Split run whenever X reverses monotonicity
        let start = 0;
        let dir = 0;
        for (let j = 1; j < run.length; j++) {
          const dx = run[j]![0] - run[j - 1]![0];
          const d = dx > 1e-7 ? 1 : dx < -1e-7 ? -1 : 0;
          if (d !== 0 && dir !== 0 && d !== dir) {
            if (j - start >= 2) curves.push(polylineCurve(run.slice(start, j)));
            start = j - 1;
            dir = d;
          } else if (d !== 0) {
            dir = d;
          }
        }
        if (run.length - start >= 2) curves.push(polylineCurve(run.slice(start)));
        run.length = 0;
      };
      const N = 64;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const [x, r] = cubicAt(seg, t);
        const [dx, dr] = cubicDeriv(seg, t);
        if (Math.abs(dx * c) > 1e-9) {
          const cosPhi = -(dr * s) / (dx * c);
          if (Math.abs(cosPhi) <= 1 + 1e-6) {
            const cl = Math.max(-1, Math.min(1, cosPhi));
            const X = x * c + r * s * cl;
            const Y = r * Math.sqrt(Math.max(0, 1 - cl * cl));
            run.push([X, Y]);
            continue;
          }
        }
        flush();
      }
      flush();
    }

    // 2. Exact projected ellipses at every profile knot (endpoints, corners, shoulders, lips)
    for (const k of this.knots) {
      if (k.r > 1e-4) {
        curves.push(ellipseUpperCurve(k.x * c, k.r * s, k.r));
      } else {
        extraXs.push(k.x * c);
      }
    }

    // Also include the curve of maximum radius if achieved inside a curved segment (e.g. belly of a vase)
    for (const seg of this.cubics) {
      for (let k = 1; k < 16; k++) {
        const [x, r] = cubicAt(seg, k / 16);
        const [, dr] = cubicDeriv(seg, k / 16);
        if (r > 1e-4 && Math.abs(dr) < 0.08 * Math.hypot(seg[3][0] - seg[0][0], seg[3][1] - seg[0][1])) {
          curves.push(ellipseUpperCurve(x * c, r * s, r));
        }
      }
    }

    let xMin = Infinity, xMax = -Infinity;
    for (const cv of curves) { xMin = Math.min(xMin, cv.x0); xMax = Math.max(xMax, cv.x1); }
    for (const x of extraXs) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }

    const rawXs: number[] = [...extraXs, xMin, xMax];
    for (let k = 1; k < 160; k++) rawXs.push(xMin + ((xMax - xMin) * k) / 160);
    for (const cv of curves) rawXs.push(...cv.sampleXs());
    rawXs.sort((a, b) => a - b);
    const xs: number[] = [];
    for (const x of rawXs) {
      if (!xs.length || x - xs[xs.length - 1]! > 1e-4) xs.push(x);
    }

    const evalBest = (x: number): { y: number; idx: number } => {
      let bestY = 0, bestIdx = -1;
      for (let i = 0; i < curves.length; i++) {
        const y = curves[i]!.eval(x);
        if (y > bestY) { bestY = y; bestIdx = i; }
      }
      return { y: bestY, idx: bestIdx };
    };

    const poly: Pt[] = [];
    let prev = evalBest(xs[0]!);
    poly.push([xs[0]!, -prev.y]);
    for (let k = 1; k < xs.length; k++) {
      const x = xs[k]!;
      const cur = evalBest(x);
      // Bisect exact crossing when winning envelope branch switches
      if (prev.idx >= 0 && cur.idx >= 0 && prev.idx !== cur.idx) {
        let lo = xs[k - 1]!, hi = x;
        const cA = curves[prev.idx]!, cB = curves[cur.idx]!;
        for (let it = 0; it < 12; it++) {
          const mid = (lo + hi) / 2;
          if (cA.eval(mid) >= cB.eval(mid)) lo = mid;
          else hi = mid;
        }
        const xm = (lo + hi) / 2;
        const ym = evalBest(xm).y;
        if (xm - poly[poly.length - 1]![0] > 1e-5) poly.push([xm, -ym]);
      }
      if (Math.hypot(x - poly[poly.length - 1]![0], -cur.y - poly[poly.length - 1]![1]) > 1e-5) {
        poly.push([x, -cur.y]);
      }
      prev = cur;
    }
    // Ensure closed midline endpoints (X_min, 0) and (X_max, 0)
    if (Math.abs(poly[0]![1]) > 1e-4) poly.unshift([xMin, 0]);
    else poly[0] = [xMin, 0];
    if (Math.abs(poly[poly.length - 1]![1]) > 1e-4) poly.push([xMax, 0]);
    else poly[poly.length - 1] = [xMax, 0];
    return poly;
  }

  /** Fixed-topology silhouette (`2 * upperSegs` = 28 vertices, symmetric top & bottom) at `psi ∈ [0°, 90°]`. */
  pose(psi: number): LottieBezierPath {
    const key = psi.toFixed(4);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const U = this.upperEnvelope(psi);
    const cum = [0];
    for (let k = 1; k < U.length; k++) cum.push(cum[k - 1]! + Math.hypot(U[k]![0] - U[k - 1]![0], U[k]![1] - U[k - 1]![1]));
    const L = cum[cum.length - 1]!;
    const sampleAtLen = (s: number): Pt => {
      const cl = Math.max(0, Math.min(L, s));
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid]! <= cl) lo = mid;
        else hi = mid;
      }
      const d = cum[hi]! - cum[lo]!;
      return d > 1e-9 ? lerpPt(U[lo]!, U[hi]!, (cl - cum[lo]!) / d) : U[lo]!;
    };

    // Detect sharp corners along U (turning angle > 16°)
    const M = this.upperSegs;
    const win = Math.max(0.8, Math.min(2.5, L / 60));
    const rawCorners: Array<{ frac: number; angle: number }> = [];
    for (let k = 1; k < U.length - 1; k++) {
      const s = cum[k]!;
      if (s < L * 0.015 || s > L * 0.985) continue;
      const pPrev = sampleAtLen(s - win), pCur = U[k]!, pNext = sampleAtLen(s + win);
      const t1 = unit2(pCur[0] - pPrev[0], pCur[1] - pPrev[1]);
      const t2 = unit2(pNext[0] - pCur[0], pNext[1] - pCur[1]);
      const ang = Math.acos(Math.max(-1, Math.min(1, t1[0] * t2[0] + t1[1] * t2[1]))) / D2R;
      if (ang > 16) rawCorners.push({ frac: s / L, angle: ang });
    }
    // Keep strongest local-max corners separated by at least 0.55 / M so each corner fits its own local knot
    rawCorners.sort((a, b) => b.angle - a.angle);
    const corners: Array<{ frac: number; angle: number }> = [];
    for (const c of rawCorners) {
      if (corners.every((o) => Math.abs(o.frac - c.frac) > 0.55 / M)) corners.push(c);
    }

    // Place M + 1 knots along arc length, snapping nearest unused interior knots (within 0.65 / M) to sharp corners
    const knotsRaw = Array.from({ length: M + 1 }, (_, j) => ({ f: j / M, corner: false }));
    for (const corner of corners) {
      let bestJ = -1, bestD = 0.65 / M;
      for (let j = 1; j < M; j++) {
        if (knotsRaw[j]!.corner) continue;
        const d = Math.abs(j / M - corner.frac);
        if (d < bestD) { bestD = d; bestJ = j; }
      }
      if (bestJ > 0) {
        knotsRaw[bestJ] = { f: corner.frac, corner: true };
      }
    }
    const interior = knotsRaw.slice(1, M).sort((a, b) => a.f - b.f);
    const orderedKnots = [knotsRaw[0]!, ...interior, knotsRaw[M]!];
    for (let j = 1; j < M; j++) {
      if (orderedKnots[j]!.f <= orderedKnots[j - 1]!.f + 1e-4) orderedKnots[j]!.f = orderedKnots[j - 1]!.f + 1e-4;
    }
    for (let j = M - 1; j >= 1; j--) {
      if (orderedKnots[j]!.f >= orderedKnots[j + 1]!.f - 1e-4) orderedKnots[j]!.f = orderedKnots[j + 1]!.f - 1e-4;
    }
    const knots = orderedKnots.map((k) => k.f);
    const isCornerKnot = orderedKnots.map((k) => k.corner);

    // Extract dense sub-polyline for each interval [knots[j], knots[j+1]]
    const subs: Pt[][] = [];
    for (let j = 0; j < M; j++) {
      const s0 = knots[j]! * L, s1 = knots[j + 1]! * L;
      const sub: Pt[] = [sampleAtLen(s0)];
      for (let k = 0; k < U.length; k++) {
        if (cum[k]! > s0 + 1e-6 && cum[k]! < s1 - 1e-6) sub.push(U[k]!);
      }
      sub.push(sampleAtLen(s1));
      subs.push(sub);
    }

    const segTangentStart = (sub: Pt[]): Pt => {
      const p0 = sub[0]!;
      let target = sub[1]!;
      let acc = 0;
      for (let k = 1; k < sub.length; k++) {
        acc += Math.hypot(sub[k]![0] - sub[k - 1]![0], sub[k]![1] - sub[k - 1]![1]);
        target = sub[k]!;
        if (acc >= 0.8) break;
      }
      return unit2(target[0] - p0[0], target[1] - p0[1]);
    };
    const segTangentEnd = (sub: Pt[]): Pt => {
      const pN = sub[sub.length - 1]!;
      let target = sub[sub.length - 2]!;
      let acc = 0;
      for (let k = sub.length - 2; k >= 0; k--) {
        acc += Math.hypot(sub[k + 1]![0] - sub[k]![0], sub[k + 1]![1] - sub[k]![1]);
        target = sub[k]!;
        if (acc >= 0.8) break;
      }
      return unit2(pN[0] - target[0], pN[1] - target[1]);
    };

    const upperCubics: Cubic[] = [];
    for (let j = 0; j < M; j++) {
      const sub = subs[j]!;
      let t0 = segTangentStart(sub);
      let t3 = segTangentEnd(sub);
      if (j === 0 && Math.abs(t0[0]) < 0.15 * Math.abs(t0[1])) t0 = [0, -1];
      if (j === M - 1 && Math.abs(t3[0]) < 0.15 * Math.abs(t3[1])) t3 = [0, 1];
      if (j > 0 && !isCornerKnot[j]) {
        const prevEnd = segTangentEnd(subs[j - 1]!);
        t0 = unit2(prevEnd[0] + t0[0], prevEnd[1] + t0[1]);
      }
      if (j < M - 1 && !isCornerKnot[j + 1]) {
        const nextStart = segTangentStart(subs[j + 1]!);
        t3 = unit2(t3[0] + nextStart[0], t3[1] + nextStart[1]);
      }
      upperCubics.push(fitPiece(sub, t0, t3).c);
    }

    const [hx, hy] = this.home;
    const shift = (c: Cubic): Cubic => c.map(([x, y]) => [hx + x, hy + y]) as Cubic;
    const mirrorBot = (c: Cubic): Cubic => [c[3], c[2], c[1], c[0]].map(([x, y]) => [hx + x, hy - y]) as Cubic;
    const allCubics = [...upperCubics.map(shift), ...upperCubics.slice().reverse().map(mirrorBot)];
    const out = lottieOfCubics(allCubics);
    this.cache.set(key, out);
    return out;
  }

  /**
   * Exact visible inner floor of an open vessel (`E_rim(psi) ∩ E_floor(psi)` in the wall frame around `home`),
   * fixed at 24 vertices, collapsing smoothly to a point at the rim edge once `psi <= inner.shutPsi`.
   */
  innerBasePose(psi: number): LottieBezierPath {
    const key = psi.toFixed(4);
    const hit = this.innerBaseCache.get(key);
    if (hit) return hit;
    const inn = this.inner!;
    const [hx, hy] = this.home;
    const c = Math.cos(psi * D2R), s = Math.sin(psi * D2R);
    const verts = 24;
    if (psi <= inn.shutPsi + 0.05 || s < 1e-4) {
      const xShut = hx + inn.xRim * c - inn.openEnd * inn.rRim * s;
      const pt: Pt = [xShut, hy];
      const out: LottieBezierPath = {
        c: true,
        v: Array.from({ length: verts }, () => pt),
        i: Array.from({ length: verts }, () => [0, 0] as Pt),
        o: Array.from({ length: verts }, () => [0, 0] as Pt),
      };
      this.innerBaseCache.set(key, out);
      return out;
    }
    const eRim = geo.ellipse(hx + inn.xRim * c, hy, Math.max(1e-3, inn.rRim * s), inn.rRim);
    const eFloor = geo.ellipse(hx + inn.xFloor * c, hy, Math.max(1e-3, inn.rFloor * s), inn.rFloor);
    const inter = geo.intersect(eRim, eFloor);
    const paths = geo.toLottiePaths(inter);
    if (!paths.length || Math.abs(signedAreaPath(paths[0]!)) < 1e-2) {
      const xShut = hx + inn.xRim * c - inn.openEnd * inn.rRim * s;
      const pt: Pt = [xShut, hy];
      const out: LottieBezierPath = {
        c: true,
        v: Array.from({ length: verts }, () => pt),
        i: Array.from({ length: verts }, () => [0, 0] as Pt),
        o: Array.from({ length: verts }, () => [0, 0] as Pt),
      };
      this.innerBaseCache.set(key, out);
      return out;
    }
    const p = paths[0]!;
    const pts = samplePath(p, 8);
    const cx = pts.reduce((acc, q) => acc + q[0], 0) / pts.length;
    const out = resampleTrackedContour(p, [cx, hy - 1e6], verts, true);
    this.innerBaseCache.set(key, out);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Sphere: always projects to a circle (scaled by perspective). A fixed world-space directional light rotates into view
// space as the model turns, sweeping an exact 4-cubic half-ellipse terminator (`shade`) and a soft foreshortened radial
// highlight across the sphere.
// ---------------------------------------------------------------------------

const KAPPA = (4 / 3) * (Math.SQRT2 - 1);
const DEFAULT_LIGHT_DIR: [number, number, number] = [-0.55, -0.55, 0.63];

class SphereModel {
  readonly radius: number;
  constructor(readonly part: TurntableSphere, readonly home: Pt) {
    this.radius = part.radius;
  }

  /**
   * Exact 4-vertex shaded region (crescent for lz > 0, half-circle for lz = 0, gibbous for lz < 0) in the sphere's
   * light-aligned frame (+X toward projected light). Linear in `lz`, so vertex morphing with fitted ease is exact.
   */
  shadePose(lz: number): LottieBezierPath {
    const [hx, hy] = this.home;
    const R = this.radius;
    const cl = Math.max(-1, Math.min(1, lz));
    const a = -cl * R;
    const kR = KAPPA * R;
    const ka = KAPPA * a;
    return {
      c: true,
      v: [
        [hx, hy - R],
        [hx + a, hy],
        [hx, hy + R],
        [hx - R, hy],
      ],
      i: [
        [-kR, 0],
        [0, -kR],
        [ka, 0],
        [0, kR],
      ],
      o: [
        [ka, 0],
        [0, kR],
        [-kR, 0],
        [0, -kR],
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// The view: the model turned about its axis, then tilted toward the camera. Each part is first turned by its own
// rotation and placed at its centre; its points then go to the stage as origin + centre (orthographic) + perspective
// scale × the rest, so joined parts stay joined and each part grows about its own centre.
// ---------------------------------------------------------------------------

type V3 = [number, number, number];
type M3 = [V3, V3, V3]; // rows

const I3: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const mmul = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j]! + row[1] * b[1][j]! + row[2] * b[2][j]!)) as M3;
const mapply = (m: M3, v: V3): V3 => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as V3;
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V3): V3 => scale3(a, 1 / (Math.hypot(...a) || 1));

/** rotation by `ang` radians about the unit axis k (right-handed in model space) */
function rotAbout(k: V3, ang: number): M3 {
  const [x, y, z] = unit(k), c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  return [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
}

function partRotation(r?: [number, number, number]): M3 {
  if (!r) return I3;
  return mmul(rotAbout([0, 0, 1], r[2] * D2R), mmul(rotAbout([0, 1, 0], r[1] * D2R), rotAbout([1, 0, 0], r[0] * D2R)));
}

class View {
  readonly axis: V3;
  readonly tilt: M3;
  constructor(readonly spec: TurntableParams, readonly angle: TurnAngle) {
    this.axis = spec.axis ?? [0, -1, 0];
    const a = (spec.tilt ?? 0) * D2R;
    // looking down onto the top: y' = y cos + z sin, z' = −y sin + z cos
    this.tilt = [[1, 0, 0], [0, Math.cos(a), Math.sin(a)], [0, -Math.sin(a), Math.cos(a)]];
  }
  at(t: number): M3 {
    return mmul(this.tilt, rotAbout(this.axis, this.angle.at(t) * D2R));
  }
  /** whether this view is the plain turn about the vertical axis (what strips support) */
  get upright(): boolean {
    const [x, y, z] = unit(this.axis);
    return Math.abs(x) < 1e-9 && Math.abs(z) < 1e-9 && y < 0 && !(this.spec.tilt ?? 0);
  }
}

/** a part placed in the view at frame t: its centre, its local → view rotation, its perspective scale */
interface Placed { c: V3; m: M3; p: number }

function placeAt(spec: TurntableParams, view: View, part: TurntablePart, t: number): Placed {
  const v = view.at(t);
  const center: V3 = isExtrude(part) ? (part.center ?? [0, 0, part.z ?? 0]) : part.center;
  const c = mapply(v, center);
  const m = mmul(v, part.type === 'sphere' ? I3 : partRotation(part.rotation));
  return { c, m, p: spec.focal ? spec.focal / (spec.focal - c[2]) : 1 };
}

/** a placed local point on the stage */
const stageOf = (spec: TurntableParams, pl: Placed, q: V3): Pt => {
  const w = mapply(pl.m, q);
  return [spec.origin[0] + pl.c[0] + pl.p * w[0], spec.origin[1] + pl.c[1] + pl.p * w[1]];
};

/** times in [a, b] where g crosses `level` */
function levelTimes(g: (t: number) => number, level: number, a: number, b: number): number[] {
  const out: number[] = [];
  const n = Math.max(8, Math.ceil((b - a) * 4));
  let ta = a, va = g(a) - level;
  for (let k = 1; k <= n; k++) {
    const tb = a + ((b - a) * k) / n, vb = g(tb) - level;
    if (va === 0) out.push(ta);
    else if (va * vb < 0) {
      let x0 = ta, x1 = tb;
      for (let it = 0; it < 50; it++) {
        const mid = (x0 + x1) / 2;
        if ((g(mid) - level) * va > 0) x0 = mid;
        else x1 = mid;
      }
      out.push((x0 + x1) / 2);
    }
    ta = tb;
    va = vb;
  }
  if (va === 0) out.push(b);
  return uniqueTimes(out);
}

/** times in (a, b) where g turns round (a local maximum or minimum) */
function extremaTimes(g: (t: number) => number, a: number, b: number): number[] {
  const out: number[] = [];
  const n = Math.max(8, Math.ceil((b - a) * 4)), h = 1e-3;
  const d = (t: number): number => g(t + h) - g(t - h);
  let ta = a + h, da = d(ta);
  for (let k = 1; k <= n; k++) {
    const tb = a + ((b - a) * k) / n - (k === n ? h : 0), db = d(tb);
    if (Math.abs(da) > 1e-7 && Math.abs(db) > 1e-7 && da * db < 0) {
      let x0 = ta, x1 = tb;
      for (let it = 0; it < 40; it++) {
        const mid = (x0 + x1) / 2;
        if (d(mid) * da > 0) x0 = mid;
        else x1 = mid;
      }
      out.push((x0 + x1) / 2);
    }
    if (Math.abs(db) > 1e-7) {
      ta = tb;
      da = db;
    }
  }
  return uniqueTimes(out);
}

/** where g > 0 inside each span */
function positiveSpans(g: (t: number) => number, spans: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of spans) {
    const cuts = uniqueTimes([a, b, ...levelTimes(g, 0, a, b)]);
    for (let k = 0; k < cuts.length - 1; k++) {
      const [x, y] = [cuts[k]!, cuts[k + 1]!];
      if (y - x > 1e-3 && g((x + y) / 2) > 0) out.push([x, y]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Flat faces: a planar face (a polyhedron face, a lathe's end, its recess) is always an affine copy of how it looks
// face-on, so it is one layer drawn face-on at its home and moved by Lottie rotation · skew · scale. Its art frame:
// "down" is the part's own y laid into the face (z for a face that is level), "right" is down × outward normal.
// ---------------------------------------------------------------------------

interface FaceFrame { c: V3; n: V3; r: V3; d: V3 }

function faceFrame(c: V3, n: V3): FaceFrame {
  const nn = unit(n);
  let d = sub([0, 1, 0], scale3(nn, nn[1]));
  if (Math.hypot(...d) < 1e-6) d = nn[1] < 0 ? [0, 0, 1] : [0, 0, -1];
  d = unit(d);
  return { c, n: nn, d, r: cross(d, nn) };
}

/** Lottie transform values [x, y, rotation°, skew°, scale x %, scale y %] that put the face-on art where the face is */
function faceTransform(spec: TurntableParams, pl: Placed, f: FaceFrame, offset: Pt = [0, 0]): number[] {
  const s = stageOf(spec, pl, f.c);
  const a = mapply(pl.m, f.r), b = mapply(pl.m, f.d);
  const [m11, m21, m12, m22] = [a[0] * pl.p, a[1] * pl.p, b[0] * pl.p, b[1] * pl.p];
  // M = R(r) · [[sx, −tan(sk)·sy], [0, sy]] (Lottie applies scale, then skew, then rotation)
  // edge-on, the face's right axis has no length: its down axis still says which way it is turned
  const sx = Math.hypot(m11, m21), r = sx > 1e-6 ? Math.atan2(m21, m11) : Math.atan2(-m12, m22);
  const u12 = Math.cos(r) * m12 + Math.sin(r) * m22, sy = -Math.sin(r) * m12 + Math.cos(r) * m22;
  // At exact edge-on (sy -> 0+) with nonzero u12, atan(-u12 / sy) approaches -sign(u12)*90° (not 0°); returning 0° would cause bezier overshoot past 89°
  const sk = Math.abs(sy) > 1e-9 ? Math.atan(-u12 / sy) : Math.abs(u12) > 1e-9 ? -Math.sign(u12) * 89.5 * D2R : 0;
  return [s[0] + offset[0], s[1] + offset[1], r / D2R, sk / D2R, Math.max(1e-4, sx) * 100, sy * 100];
}

/** where a Lottie transform (as above) puts an art point q (relative to the layer's anchor) */
function placeArt(v: number[], q: Pt): Pt {
  const [x, y, rd, skd, sxp, syp] = v as [number, number, number, number, number, number];
  const r = rd * D2R, sx = sxp / 100, sy = syp / 100, k = -Math.tan(skd * D2R) * sy;
  const lx = sx * q[0] + k * q[1], ly = sy * q[1];
  return [x + Math.cos(r) * lx - Math.sin(r) * ly, y + Math.sin(r) * lx + Math.cos(r) * ly];
}

// ---------------------------------------------------------------------------
// Plan: phases (which end shows, which part is in front) and the layers
// ---------------------------------------------------------------------------

type LayerKind = 'edge' | 'edge-lit' | 'front' | 'back' | 'wall' | 'end' | 'hole' | 'base' | 'inner-wall' | 'inner-base' | 'veil' | 'face' | 'body' | 'shade' | 'highlight';

interface PlannedLayer {
  id: string;
  part: number;
  kind: LayerKind;
  end?: 1 | -1; // which end of a lathe (+1: its +x end)
  face?: number; // which face of a polyhedron
  spans: Array<[number, number]>;
}

interface Plan {
  ip: number;
  op: number;
  layers: PlannedLayer[];
  phases: Array<{ name: string; spans: Array<[number, number]> }>;
}

type Lathe = TurntableDisc;
const isLathe = (p: TurntablePart): p is Lathe => p.type === 'disc' || p.type === 'lathe';
const isExtrude = (p: TurntablePart): p is TurntableExtrude => p.type === 'extrude' || p.type === 'strip';
const usesProfile = (p: Lathe): boolean => Array.isArray(p.profile) && p.profile.length >= 2;
const endSpec = (d: Lathe, e: 1 | -1): TurntableDiscEnd | undefined => {
  const byAxis = e > 0 ? d.ends?.pos : d.ends?.neg;
  if (byAxis) return byAxis;
  const outerSign = Math.sign(d.center[0]) || 1;
  return e === outerSign ? d.outer : d.inner;
};
const endName = (d: Lathe, e: 1 | -1): string => {
  const given = endSpec(d, e)?.name;
  if (given) return given;
  if (d.ends) return e > 0 ? 'pos' : 'neg';
  return e === (Math.sign(d.center[0]) || 1) ? 'outer' : 'inner';
};

function layerId(spec: TurntableParams, phase: string | null, item: { part: number; kind: LayerKind; end?: 1 | -1; face?: number }): string {
  const p = spec.parts[item.part]!;
  const base = phase ? `${spec.id}-${phase}-${p.name}` : `${spec.id}-${p.name}`;
  if (isExtrude(p) || p.type === 'sphere') return `${base}-${item.kind}`;
  if (p.type === 'poly') return `${base}-f${item.face}`;
  if (item.kind === 'wall') return `${base}-wall`;
  const name = endName(p, item.end!);
  return item.kind === 'end' ? `${base}-${name}` : `${base}-${name}-${item.kind}`;
}

/** a polyhedron's faces: centre, outward normal and art frame, and each corner in that frame */
function polyFaces(p: TurntablePoly): Array<{ frame: FaceFrame; corners: Pt[] }> {
  const mid = scale3(p.vertices.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]] as V3, [0, 0, 0] as V3), 1 / p.vertices.length);
  return p.faces.map((idx) => {
    const vs = idx.map((i) => p.vertices[i]!);
    const c = scale3(vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]] as V3, [0, 0, 0] as V3), 1 / vs.length);
    let n: V3 = [0, 0, 0];
    for (let k = 0; k < vs.length; k++) n = [n[0] + cross(vs[k]!, vs[(k + 1) % vs.length]!)[0], n[1] + cross(vs[k]!, vs[(k + 1) % vs.length]!)[1], n[2] + cross(vs[k]!, vs[(k + 1) % vs.length]!)[2]];
    if (dot(n, sub(c, mid)) < 0) n = scale3(n, -1);
    const frame = faceFrame(c, n);
    return { frame, corners: vs.map((v) => [dot(sub(v, c), frame.r), dot(sub(v, c), frame.d)] as Pt) };
  });
}

// ---------------------------------------------------------------------------
// Interpenetration detection (model-space 3D OBB / sphere SAT): parts on the same stack that pass through each other
// cannot be pain-ordered cleanly by centre depth; warn during build so authors can separate them or assign stacks.
// ---------------------------------------------------------------------------

type PartBounds =
  | { kind: 'sphere'; center: V3; radius: number }
  | { kind: 'obb'; center: V3; axes: [V3, V3, V3]; half: V3 };

function boundsOfPart(p: TurntablePart): PartBounds {
  if (p.type === 'sphere') return { kind: 'sphere', center: p.center, radius: p.radius };
  const R = partRotation(p.rotation);
  const axes: [V3, V3, V3] = [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]],
  ];
  let min: V3, max: V3;
  const c0: V3 = isExtrude(p) ? (p.center ?? [0, 0, p.z ?? 0]) : p.center;
  if (p.type === 'poly') {
    min = [Infinity, Infinity, Infinity];
    max = [-Infinity, -Infinity, -Infinity];
    for (const v of p.vertices) {
      for (let d = 0; d < 3; d++) {
        if (v[d]! < min[d]!) min[d] = v[d]!;
        if (v[d]! > max[d]!) max[d] = v[d]!;
      }
    }
  } else if (isLathe(p)) {
    if (usesProfile(p)) {
      const lm = new LatheProfileModel(p, [0, 0]);
      min = [lm.xNeg, -lm.maxR, -lm.maxR];
      max = [lm.xPos, lm.maxR, lm.maxR];
    } else {
      const hd = (p.depth ?? 0) / 2, r = p.radius ?? 0;
      min = [-hd, -r, -r];
      max = [hd, r, r];
    }
  } else {
    const outer = geo.toLottiePaths(geo.fromSvgPath(p.outline))[0];
    const pts = outer ? samplePath(outer, 8) : [[0, 0] as Pt];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    min = [x0, y0, -p.depth / 2];
    max = [x1, y1, p.depth / 2];
  }
  const midLocal: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const half: V3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
  const off = mapply(R, midLocal);
  return { kind: 'obb', center: [c0[0] + off[0], c0[1] + off[1], c0[2] + off[2]], axes, half };
}

function penetrationDepth(a: PartBounds, b: PartBounds): number {
  if (a.kind === 'sphere' && b.kind === 'sphere') {
    const d = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]);
    return Math.max(0, a.radius + b.radius - d);
  }
  if (a.kind === 'sphere' || b.kind === 'sphere') {
    const sp = (a.kind === 'sphere' ? a : b) as Extract<PartBounds, { kind: 'sphere' }>;
    const ob = (a.kind === 'obb' ? a : b) as Extract<PartBounds, { kind: 'obb' }>;
    const rel = sub(sp.center, ob.center);
    let inside = true;
    let minMargin = Infinity;
    let dist2 = 0;
    for (let i = 0; i < 3; i++) {
      const proj = dot(rel, ob.axes[i]!);
      const excess = Math.abs(proj) - ob.half[i]!;
      if (excess > 0) {
        inside = false;
        dist2 += excess * excess;
      } else {
        minMargin = Math.min(minMargin, -excess);
      }
    }
    if (inside) return sp.radius + minMargin;
    return Math.max(0, sp.radius - Math.sqrt(dist2));
  }
  // OBB vs OBB: 15-axis SAT
  const rel = sub(b.center, a.center);
  const testAxes: V3[] = [...a.axes, ...b.axes];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const c = cross(a.axes[i]!, b.axes[j]!);
      if (Math.hypot(...c) > 1e-5) testAxes.push(unit(c));
    }
  }
  let minOverlap = Infinity;
  for (const ax of testAxes) {
    const pA = a.half[0] * Math.abs(dot(a.axes[0], ax)) + a.half[1] * Math.abs(dot(a.axes[1], ax)) + a.half[2] * Math.abs(dot(a.axes[2], ax));
    const pB = b.half[0] * Math.abs(dot(b.axes[0], ax)) + b.half[1] * Math.abs(dot(b.axes[1], ax)) + b.half[2] * Math.abs(dot(b.axes[2], ax));
    const overlap = pA + pB - Math.abs(dot(rel, ax));
    if (overlap <= 0) return 0;
    if (overlap < minOverlap) minOverlap = overlap;
  }
  return minOverlap;
}

export function detectInterpenetrations(spec: TurntableParams, minPenPx = 1.5): string[] {
  const bounds = spec.parts.map(boundsOfPart);
  const warnings: string[] = [];
  for (let i = 0; i < spec.parts.length; i++) {
    for (let j = i + 1; j < spec.parts.length; j++) {
      const sa = spec.parts[i]!.stack ?? 0, sb = spec.parts[j]!.stack ?? 0;
      if (sa !== sb) continue;
      const pen = penetrationDepth(bounds[i]!, bounds[j]!);
      if (pen > minPenPx) {
        warnings.push(
          `turntable "${spec.id}": parts "${spec.parts[i]!.name}" and "${spec.parts[j]!.name}" interpenetrate (~${pen.toFixed(1)} px on stack ${sa}); depth sorting cannot order intersecting solids cleanly — separate them or assign explicit stacks.`,
        );
      }
    }
  }
  return warnings;
}

function planTurntable(spec: TurntableParams, angle: TurnAngle): Plan {
  const view = new View(spec, angle);
  const ip = spec.ip ?? angle.t0, op = spec.op ?? angle.t1;
  const parts = spec.parts;
  const latheProfiles = parts.map((p) => (isLathe(p) && usesProfile(p) ? new LatheProfileModel(p, [0, 0]) : null));
  const analyticStrips = parts.map((p) => isExtrude(p) && canUseAnalyticStrip(p, view));
  const depth = (k: number) => (t: number): number => {
    const p = parts[k]!;
    return p.sortAnchor ? mapply(view.at(t), p.sortAnchor)[2] : placeAt(spec, view, p, t).c[2];
  };
  const axisZ = (k: number) => (t: number): number => placeAt(spec, view, parts[k]!, t).m[2][0];
  type Item = { part: number; kind: LayerKind; end?: 1 | -1; face?: number };
  const describePart = (k: number, t: number): Item[] => {
    const p = parts[k]!;
    if (isExtrude(p)) {
      return [{ part: k, kind: 'edge' }, ...(p.edgeLit ? [{ part: k, kind: 'edge-lit' as const }] : []), { part: k, kind: 'front' }, { part: k, kind: 'back' }];
    }
    if (p.type === 'sphere') {
      return [{ part: k, kind: 'body' }, { part: k, kind: 'shade' }, ...(p.highlight !== false ? [{ part: k, kind: 'highlight' as const }] : [])];
    }
    if (p.type === 'poly') return p.faces.map((_, f) => ({ part: k, kind: 'face' as const, face: f }));
    const e: 1 | -1 = axisZ(k)(t) >= 0 ? 1 : -1;
    const es = endSpec(p, e);
    const lp = latheProfiles[k];
    if (lp) {
      const rEnd = e > 0 ? lp.rPos : lp.rNeg;
      if (lp.inner && lp.inner.openEnd === e) {
        const openItems: Item[] = [{ part: k, kind: 'inner-wall', end: e }];
        if (p.innerBase) openItems.push({ part: k, kind: 'inner-base', end: e });
        if (rEnd - lp.inner.rRim > 0.5) openItems.push({ part: k, kind: 'end', end: e });
        return [{ part: k, kind: 'wall' }, ...openItems];
      }
      if (rEnd <= 0.5) return [{ part: k, kind: 'wall' }];
    }
    const ends: Item[] = !es ? [] : es.recess
      ? (['hole', 'base', 'end', 'veil'] as const).map((kind) => ({ part: k, kind, end: e }))
      : [{ part: k, kind: 'end', end: e }];
    return [{ part: k, kind: 'wall' }, ...ends];
  };
  const keyOf = (d: Item): string => `${d.part}:${d.kind}:${d.end ?? ''}:${d.face ?? ''}`;
  // a polyhedron's face (and a general extrude's front/back face) shows only while it faces the camera
  const shown = (d: Item, sp: Array<[number, number]>): Array<[number, number]> => {
    const p = parts[d.part]!;
    if (p.type === 'poly') {
      const f = polyFaces(p)[d.face!]!.frame;
      return positiveSpans((t) => mapply(placeAt(spec, view, p, t).m, f.n)[2], sp);
    }
    if (isExtrude(p) && !analyticStrips[d.part] && (d.kind === 'front' || d.kind === 'back')) {
      const sgn = d.kind === 'front' ? 1 : -1;
      return positiveSpans((t) => sgn * placeAt(spec, view, p, t).m[2][2], sp);
    }
    return sp;
  };

  const names = 'abcdefghijklmnopqrstuvwxyz';
  const phaseName = (k: number): string => (k < names.length ? names[k]! : `p${k}`);
  const layers: PlannedLayer[] = [];
  const allPhases: Array<{ name: string; spans: Array<[number, number]> }> = [];
  const add = (d: Item, phase: string | null, sp: Array<[number, number]>): void => {
    const s = shown(d, sp);
    if (s.length) layers.push({ id: layerId(spec, phase, d), part: d.part, kind: d.kind, end: d.end, face: d.face, spans: s });
  };
  const whole: Array<[number, number]> = [[ip, op]];

  // Plan each stack independently (lower stacks always paint under higher ones, avoiding Cartesian phase blowup)
  const stacks = [...new Set(parts.map((p) => p.stack ?? 0))].sort((a, b) => a - b);
  let nextPhaseIdx = 0;
  for (const st of stacks) {
    const idx = parts.map((_, k) => k).filter((k) => (parts[k]!.stack ?? 0) === st);
    const events: Array<(t: number) => number> = [];
    for (const k of idx) if (isLathe(parts[k]!)) events.push(axisZ(k));
    for (let i = 0; i < idx.length; i++) {
      for (let j = i + 1; j < idx.length; j++) {
        const [a, b] = [idx[i]!, idx[j]!];
        events.push((t) => depth(a)(t) - depth(b)(t));
      }
    }
    const cuts = uniqueTimes([ip, op, ...events.flatMap((g) => levelTimes(g, 0, ip, op))]).filter((t) => t >= ip - 1e-6 && t <= op + 1e-6);
    const describeStack = (t: number): Item[] => {
      const order = [...idx].sort((a, b) => depth(a)(t) - depth(b)(t) || a - b);
      return order.flatMap((k) => describePart(k, t));
    };
    const spans: Array<{ a: number; b: number; key: string; desc: Item[] }> = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const [a, b] = [cuts[k]!, cuts[k + 1]!];
      if (b - a < 1e-6) continue;
      const desc = describeStack((a + b) / 2);
      const key = desc.map(keyOf).join('|');
      const last = spans[spans.length - 1];
      if (last && last.key === key) last.b = b;
      else spans.push({ a, b, key, desc });
    }
    const phaseKeys = [...new Set(spans.map((s) => s.key))];
    const descs = phaseKeys.map((key) => spans.find((s) => s.key === key)!.desc);
    let pre = 0, suf = 0;
    const minLen = Math.min(...descs.map((d) => d.length));
    while (pre < minLen && descs.every((d) => keyOf(d[pre]!) === keyOf(descs[0]![pre]!))) pre++;
    while (suf < minLen - pre && descs.every((d) => keyOf(d[d.length - 1 - suf]!) === keyOf(descs[0]![descs[0]!.length - 1 - suf]!))) suf++;
    const single = phaseKeys.length === 1;
    for (const d of descs[0]!.slice(0, single ? descs[0]!.length : pre)) add(d, null, whole);
    if (!single) {
      const stackPhases = phaseKeys.map((key) => ({
        name: phaseName(nextPhaseIdx++),
        spans: spans.filter((s) => s.key === key).map((s) => [s.a, s.b] as [number, number]),
      }));
      stackPhases.forEach((ph, k) => {
        allPhases.push(ph);
        for (const d of descs[k]!.slice(pre, descs[k]!.length - suf)) add(d, ph.name, ph.spans);
      });
      for (const d of descs[0]!.slice(descs[0]!.length - suf)) add(d, null, whole);
    }
  }
  return { ip, op, layers, phases: allPhases };
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

interface Key { t: number; v: number[]; ease?: Array<[number, number, number, number]>; hold?: boolean }

/**
 * Keys `fns` over each span: knots at `knotsIn(span)` plus the span's ends, each segment a fitted cubic-bezier,
 * split where it strays more than `tols` from the curve (or, with `measure`, where the fitted values together miss
 * by more than 1 in its units). A layer that is hidden between its spans holds still; with `cut`, its value also
 * cuts to `cut` (opacity 0) the moment a span ends.
 */
function fitKeys(
  spans: Array<[number, number]>,
  ip: number,
  op: number,
  knotsIn: (a: number, b: number) => number[],
  fns: Array<(t: number) => number>,
  tols: number[],
  cut?: number,
  measure?: (t: number, fitted: number[]) => number,
): Key[] {
  const keys: Key[] = [];
  const valueAt = (t: number): number[] => fns.map((f) => f(t));
  if (cut !== undefined && spans[0]![0] > ip + 1e-6) keys.push({ t: ip, v: fns.map(() => cut), hold: true });
  spans.forEach(([a, b], si) => {
    const more = si < spans.length - 1 || b < op - 1e-6;
    const cutHere = cut !== undefined && more && valueAt(b).some((v) => Math.abs(v - cut) > 0.5);
    const end = cutHere ? b - CUT : b;
    const knots = uniqueTimes([a, end, ...knotsIn(a, end).filter((t) => t > a && t < end)]);
    const segs: Array<[number, number]> = knots.slice(0, -1).map((t, k) => [t, knots[k + 1]!]);
    const done: Array<{ t0: number; t1: number; ease: Array<[number, number, number, number]> }> = [];
    while (segs.length) {
      const [t0, t1] = segs.shift()!;
      const n = Math.max(6, Math.ceil((t1 - t0) * 2));
      let worst = { err: 0, tau: 0.5 };
      const v0 = valueAt(t0), v1 = valueAt(t1);
      const ease = fns.map((f, k) => {
        const samples: Array<[number, number]> = [];
        for (let i = 1; i < n; i++) samples.push([i / n, f(t0 + ((t1 - t0) * i) / n)]);
        const fit = fitEaseToSamples(samples, v0[k]!, v1[k]!);
        if (!measure && fit.worstErr / tols[k]! > worst.err) worst = { err: fit.worstErr / tols[k]!, tau: fit.worstTau };
        return [fit.ox, fit.oy, fit.ix, fit.iy] as [number, number, number, number];
      });
      if (measure) {
        for (let i = 1; i < n; i++) {
          const tau = i / n;
          const fitted = ease.map((e, k) => v0[k]! + (v1[k]! - v0[k]!) * easeY(e, tau));
          const err = measure(t0 + (t1 - t0) * tau, fitted);
          if (err > worst.err) worst = { err, tau };
        }
      }
      if (worst.err > 1 && t1 - t0 > 2) {
        const tm = t0 + (t1 - t0) * Math.max(0.2, Math.min(0.8, worst.tau));
        segs.unshift([t0, tm], [tm, t1]);
        continue;
      }
      done.push({ t0, t1, ease });
    }
    for (const s of done) keys.push({ t: s.t0, v: valueAt(s.t0), ease: s.ease });
    keys.push({ t: end, v: valueAt(end), hold: more });
    if (cutHere) keys.push({ t: b, v: fns.map(() => cut!), hold: true });
  });
  // drop keys that only repeat a held or flat value
  const same = (p: Key, q: Key): boolean => p.v.every((v, k) => Math.abs(v - q.v[k]!) < 1e-6);
  for (let k = keys.length - 2; k >= 1; k--) {
    const [p, q, r] = [keys[k - 1]!, keys[k]!, keys[k + 1]!];
    if (same(p, q) && same(q, r) && !p.hold) keys.splice(k, 1);
  }
  for (let k = keys.length - 1; k >= 1; k--) {
    const [p, q] = [keys[k - 1]!, keys[k]!];
    const last = k === keys.length - 1;
    if (!same(p, q) || !(q.hold || last)) continue;
    p.hold = !last;
    p.ease = undefined;
    keys.splice(k, 1);
  }
  return keys;
}

/** one dimension (or, with dims, several) of keys as a Lottie property; `extra` appends a constant component */
function toProp(keys: Key[], dims: number[] = [0], extra?: number): LottieProp<number[]> | LottieProp<number> {
  const val = (k: Key): number[] => [...dims.map((d) => r3(k.v[d]!)), ...(extra !== undefined ? [extra] : [])];
  if (keys.every((k) => val(k).every((v, j) => Math.abs(v - val(keys[0]!)[j]!) < 1e-6))) {
    const v = val(keys[0]!);
    return (v.length === 1 ? { a: 0, k: v[0]! } : { a: 0, k: v }) as LottieProp<number[]>;
  }
  const out: LottieKeyframe<number[]>[] = keys.map((k, j) => {
    const t = Math.round(k.t * 100) / 100;
    const next = keys[j + 1];
    if (!next) return { t, s: val(k) };
    if (k.hold || !k.ease) return { t, s: val(k), h: 1 };
    const es = dims.map((d) => k.ease![d]!);
    const pad = (sel: (e: [number, number, number, number]) => number): number[] => [...es.map((e) => r3(sel(e))), ...(extra !== undefined ? [r3(sel(es[0]!))] : [])];
    return {
      t,
      s: val(k),
      e: val(next),
      o: { x: pad((e) => Math.max(0, Math.min(1, e[0]))), y: pad((e) => e[1]) },
      i: { x: pad((e) => Math.max(0, Math.min(1, e[2]))), y: pad((e) => e[3]) },
    };
  });
  return { a: 1, k: out };
}

/** a function made continuous across its wraps (period), sampled from a to b */
function unwrapped(f: (t: number) => number, period: number, a: number, b: number): (t: number) => number {
  const step = 0.25, n = Math.max(1, Math.ceil((b - a) / step));
  const grid: number[] = [];
  for (let k = 0; k <= n; k++) {
    const v = f(a + k * step);
    const prev = grid[k - 1];
    grid.push(prev === undefined ? v : v + period * Math.round((prev - v) / period));
  }
  return (t) => {
    const x = Math.max(0, Math.min(n, (t - a) / step)), k = Math.min(n - 1, Math.floor(x));
    const near = grid[k]! + (grid[k + 1]! - grid[k]!) * (x - k);
    const v = f(t);
    return v + period * Math.round((near - v) / period);
  };
}

const hexRgb = (hex: string): V3 => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as V3;
};

// ---------------------------------------------------------------------------
// The compiled model
// ---------------------------------------------------------------------------

interface CompiledLayer {
  id: string;
  anchor: Pt;
  position: { x: LottieProp<number>; y: LottieProp<number> };
  rotation: LottieProp<number>;
  skew: LottieProp<number>;
  scale: LottieProp<number[]>;
  opacity: LottieProp<number>;
  color?: LottieProp<number[]>;
  morphs?: Array<{ match: 'vertices' | 'auto'; points?: number; stops: ShapeMorphStop[] }>;
}

export interface TurntableSummary {
  layers: number;
  phases: string[];
  poses: Record<string, number[]>;
  keyframes: number;
  warnings: string[];
}

interface CompiledTurntable {
  plan: Plan;
  layers: CompiledLayer[];
  rig: { anchor: Pt; position: unknown; scale: LottieProp<number[]> };
  summary: TurntableSummary;
}

const compiledCache = new Map<string, CompiledTurntable>();

function partHome(spec: TurntableParams, k: number): Pt {
  const p = spec.parts[k]!;
  return isExtrude(p) ? [spec.origin[0], spec.origin[1] + (p.center?.[1] ?? 0)] : [spec.origin[0], spec.origin[1] + p.center[1]];
}

const pick = (v: string | string[], k: number): string => (Array.isArray(v) ? v[k % v.length]! : v);

function compileTurntable(spec: TurntableParams, tokens: MotionTokens, fps: number): CompiledTurntable {
  const cacheKey = JSON.stringify([spec, fps]);
  const hit = compiledCache.get(cacheKey);
  if (hit) return hit;
  const angle = new TurnAngle(spec, tokens);
  const view = new View(spec, angle);
  const plan = planTurntable(spec, angle);
  const L = spec.light ?? 0.6;
  const tol = spec.tol ?? 0.75;
  const lit = (f: number, full = L): number => smoothstep(clamp01(Math.abs(f) / full));
  const phiAt = (t: number): number => angle.at(t) * D2R;
  const [ox, oy] = spec.origin;
  const models = spec.parts.map((p, k) => {
    const home = partHome(spec, k);
    if (isExtrude(p)) return canUseAnalyticStrip(p, view) ? new StripModel(p, home) : new ExtrudeModel(p, home);
    if (isLathe(p)) return usesProfile(p) ? new LatheProfileModel(p, home) : new DiscModel(p, home);
    if (p.type === 'sphere') return new SphereModel(p, home);
    return null;
  });
  const sphereLightAt = (part: TurntableSphere, t: number): V3 =>
    unit(mapply(view.at(t), unit(part.lightDir ?? spec.lightDir ?? DEFAULT_LIGHT_DIR)));
  const placed = (k: number, t: number): Placed => placeAt(spec, view, spec.parts[k]!, t);

  // knot times: quarter turns for transforms; lighting events (a face edge-on, fully lit) for fades
  const stopsIn = (a: number, b: number): number[] => angle.stops.filter((t) => t > a && t < b);
  const quarterKnots = (a: number, b: number): number[] => [...angle.crossings(0, 90, a, b), ...stopsIn(a, b)];
  const litKnots = (facing: (t: number) => number, full = L) => (a: number, b: number): number[] => [
    ...levelTimes(facing, 0, a, b), ...levelTimes(facing, full, a, b), ...levelTimes(facing, -full, a, b), ...stopsIn(a, b),
  ];
  // a face's fade keyed exactly: lit from `full` on, eased `outOf` edge-on and `into` it (the veil does the inverse);
  // where a turn never quite brings it edge-on or fully lit, the key there takes the smoothstep value
  const easedLitKeys = (spans: Array<[number, number]>, f: (t: number) => number, light: Required<TurntableLight>, veil: boolean): Key[] => {
    const keys: Key[] = [];
    const amount = (t: number): number => {
      const u = f(t) <= 0 ? 0 : f(t) >= light.full - 1e-9 ? 1 : lit(f(t), light.full);
      return 100 * (veil ? 1 - u : u);
    };
    if (spans[0]![0] > plan.ip + 1e-6) keys.push({ t: plan.ip, v: [0], hold: true });
    spans.forEach(([a, b], si) => {
      const more = si < spans.length - 1 || b < plan.op - 1e-6;
      const cutHere = more && amount(b) > 0.5;
      const end = cutHere ? b - CUT : b;
      const ts = uniqueTimes([a, end, ...levelTimes(f, light.full, a, end), ...levelTimes(f, 0, a, end),
        ...extremaTimes(f, a, end).filter((t) => f(t) < light.full), ...stopsIn(a, end)]).filter((t) => t >= a && t <= end);
      ts.forEach((t, j) => {
        const next = ts[j + 1];
        if (next === undefined) return;
        const [v0, v1] = [amount(t), amount(next)];
        if (Math.abs(v1 - v0) < 1e-6) keys.push({ t, v: [v0], hold: true });
        else keys.push({ t, v: [v0], ease: [(veil ? v1 < v0 : v1 > v0) ? light.outOf : light.into] });
      });
      keys.push({ t: end, v: [amount(end)], hold: more });
      if (cutHere) keys.push({ t: b, v: [0], hold: true });
    });
    return keys;
  };
  const posTol = 0.5, opTol = 1;

  // how far each 1D morphing part is turned toward the camera, ψ ∈ [0°, 90°] (and signed, to find where it crosses 0°)
  const psiSigned = (k: number) => (t: number): number => {
    if (models[k] instanceof StripModel) {
      const m = ((angle.at(t) % 180) + 180) % 180;
      return m <= 90 ? m : m - 180;
    }
    const a = placed(k, t).m;
    return Math.atan2(a[2][0], Math.hypot(a[0][0], a[1][0])) / D2R;
  };
  const psiOf = (k: number) => (t: number): number => Math.abs(psiSigned(k)(t));

  // morph poses per part, then each morphing layer's keys
  const poseSets: Record<string, number[]> = {};
  const innerBasePoseSets: Record<string, number[]> = {};
  const morphLayers = plan.layers.filter((l) => l.kind === 'edge' || l.kind === 'edge-lit' || l.kind === 'wall');
  const morphTimes = (l: PlannedLayer, poses: number[]): Array<{ t: number; hold: boolean }> => {
    const out: Array<{ t: number; hold: boolean }> = [];
    const g = psiOf(l.part), gs = psiSigned(l.part);
    l.spans.forEach(([a, b], si) => {
      const ts = uniqueTimes([
        a, b, ...levelTimes(gs, 0, a, b), ...extremaTimes(g, a, b), ...stopsIn(a, b),
        ...poses.filter((p) => p > 0 && p < 90).flatMap((p) => levelTimes(g, p, a, b)),
      ]).filter((t) => t >= a && t <= b);
      ts.forEach((t) => out.push({ t, hold: t === b && si < l.spans.length - 1 }));
    });
    return out;
  };
  let maxSpeed = 0;
  for (let t = angle.t0; t < angle.t1; t += 1) maxSpeed = Math.max(maxSpeed, Math.abs(angle.at(Math.min(angle.t1, t + 1)) - angle.at(t)));
  const normPoses = (set: number[]): number[] => [...new Set(set.map((p) => Math.round(p * 1e4) / 1e4))].sort((p, q) => p - q);
  const pickPoses1D = (
    layersOf: PlannedLayer[],
    required: number[],
    fixed: number[] | undefined,
    poseFn: (psi: number) => LottieBezierPath,
    onSet?: (set: number[]) => void,
  ): number[] => {
    let poses = normPoses([...required, ...(fixed ?? [])]);
    const blendErr = (a: number, b: number, psi: number): number => {
      const pa = poseFn(a), pb = poseFn(b), p = poseFn(psi);
      return shapeError(lerpPath(pa, pb, projectBlend(pa, pb, p)), p);
    };
    const segErrors = (set: number[], step: number, off = 0.5): Array<{ psi: number; err: number }> => {
      const out: Array<{ psi: number; err: number }> = [];
      for (let j = 0; j < set.length - 1; j++) {
        const [a, b] = [set[j]!, set[j + 1]!];
        const n = Math.max(2, Math.ceil((b - a) / step));
        for (let s = 1; s < n; s++) {
          const psi = a + ((b - a) * s) / n;
          if (psi - a >= off && b - psi >= off) out.push({ psi, err: blendErr(a, b, psi) });
        }
      }
      return out;
    };
    const dense = (set: number[]): boolean => layersOf.some((l) => {
      const ts = morphTimes(l, set);
      return measureTrackDensity(ts.map(({ t, hold }) => ({ t, s: [0], ...(hold ? { h: 1 as const } : {}) })), fps).dense;
    });
    const gap = Math.max(1.5, 1.5 * maxSpeed);
    const added: number[] = [];
    for (let guard = 0; guard < (fixed ? 0 : 10); guard++) {
      onSet?.(poses);
      const errs = segErrors(poses, 2, gap).sort((p, q) => q.err - p.err);
      if (!errs.length || errs[0]!.err <= tol) break;
      const pickPsi = errs.slice(0, 40).map((e) => Math.round(e.psi * 4) / 4).find((psi) => !dense(normPoses([...poses, psi])));
      if (pickPsi === undefined) break;
      added.push(pickPsi);
      poses = normPoses([...poses, pickPsi]);
    }
    const worstAround = (set: number[], psi: number): number => {
      onSet?.(set);
      const j = set.indexOf(psi);
      return Math.max(0, ...segErrors(set.slice(Math.max(0, j - 1), j + 2), 3).map((e) => e.err));
    };
    for (const p of added) {
      const others = poses.filter((q) => q !== p);
      const lo = Math.max(...others.filter((q) => q < p)), hi = Math.min(...others.filter((q) => q > p));
      let best = { psi: p, err: worstAround(poses, p) };
      for (let psi = lo + gap; psi <= hi - gap; psi += 2.5) {
        const set = normPoses([...others, psi]);
        if (dense(set)) continue;
        const err = worstAround(set, Math.round(psi * 1e4) / 1e4);
        if (err < best.err) best = { psi, err };
      }
      poses = normPoses([...others, best.psi]);
    }
    onSet?.(poses);
    return poses.map(r3);
  };

  // parts of the same shape on the same schedule (a pair of ear cups) share their poses
  const shared = new Map<string, number[]>();
  spec.parts.forEach((part, k) => {
    const model = models[k];
    const layersOf = morphLayers.filter((l) => l.part === k);
    if (!model || !layersOf.length || part.type === 'poly' || part.type === 'sphere' || model instanceof ExtrudeModel || model instanceof SphereModel) return;
    const shape = { ...part, name: undefined, center: undefined, stack: undefined };
    const shareKey = JSON.stringify([shape, layersOf.map((l) => [l.kind, l.spans])]);
    if (isLathe(part) && shared.has(shareKey)) {
      poseSets[part.name] = shared.get(shareKey)!;
    } else {
      const required = [0, 90, ...(model instanceof StripModel ? model.junctions.flatMap((j) => (j.shutPsi !== null ? [j.shutPsi] : [])) : [])];
      poseSets[part.name] = pickPoses1D(
        layersOf,
        required,
        part.poses,
        (psi) => model.pose(psi),
        model instanceof StripModel ? (set) => model.setPoses(set) : undefined,
      );
      shared.set(shareKey, poseSets[part.name]!);
    }
    if (model instanceof LatheProfileModel && model.inner) {
      const innerLayers = plan.layers.filter((l) => l.part === k && l.kind === 'inner-base');
      if (innerLayers.length) {
        const req = [0, 90, ...(model.inner.shutPsi > 0.5 && model.inner.shutPsi < 89.5 ? [model.inner.shutPsi] : [])];
        innerBasePoseSets[part.name] = pickPoses1D(innerLayers, req, undefined, (psi) => model.innerBasePose(psi));
      }
    }
  });

  const morphStops1D = (l: PlannedLayer, poses: number[], poseFn: (psi: number) => LottieBezierPath): ShapeMorphStop[] => {
    const g = psiOf(l.part);
    const ts = morphTimes(l, poses);
    return ts.map(({ t, hold }, j) => {
      const psiA = g(t);
      const path = poseFn(psiA);
      const next = ts[j + 1];
      if (!next || hold) return { t, path, ...(hold ? { hold: true } : {}) };
      const psiB = g(next.t);
      if (Math.abs(psiA - psiB) < 1e-6) return { t, path, ease: [0, 0, 1, 1] as CubicBezierTuple };
      const pb = poseFn(psiB);
      const samples: Array<[number, number]> = [];
      for (let s = 1; s < 10; s++) samples.push([s / 10, projectBlend(path, pb, poseFn(g(t + ((next.t - t) * s) / 10)))]);
      const e = fitEaseToSamples(samples, 0, 1);
      return { t, path, ease: [r3(e.ox), r3(e.oy), r3(e.ix), r3(e.iy)] as CubicBezierTuple };
    });
  };

  // In-plane rotation angle (radians) of an ExtrudeModel's local +y axis on screen, so the morph frame stays upright
  const extrudeInPlaneRad = (m: M3): number => {
    const l = Math.hypot(m[0][1], m[1][1]);
    return l > 1e-4 ? Math.atan2(-m[0][1], m[1][1]) : Math.atan2(m[1][0], m[0][0]);
  };
  const extrudeUnrotM = (m: M3): M3 => {
    const g = extrudeInPlaneRad(m);
    const c = Math.cos(-g), s = Math.sin(-g);
    const rz: M3 = [[c, -s, 0], [s, c, 0], [0, 0, 1]];
    return mmul(rz, m);
  };

  // Multi-contour time-based morph builder for general 3D ExtrudeModel parts (outer + tracked holes)
  const extrudeMorphCache = new Map<string, Array<{ match: 'vertices'; stops: ShapeMorphStop[] }>>();
  const extrudeMorphsFor = (l: PlannedLayer, model: ExtrudeModel): Array<{ match: 'vertices'; stops: ShapeMorphStop[] }> => {
    const cacheId = `${l.part}:${JSON.stringify(l.spans)}`;
    const hitM = extrudeMorphCache.get(cacheId);
    if (hitM) return hitM;
    const part = spec.parts[l.part]!;
    const k = l.part;
    const nContours = 1 + model.holes.length;
    const allStops: ShapeMorphStop[][] = Array.from({ length: nContours }, () => []);
    const allPoseDegs: number[] = [];

    l.spans.forEach(([a, b], si) => {
      const mLocal = (t: number): M3 => extrudeUnrotM(placed(k, t).m);
      // Find hole open/shut event frames and record barely-open contours for slit orientation
      const holeEvents: Array<Array<{ tRoot: number; openContour: LottieBezierPath }>> = model.holes.map(() => []);
      const holeEventTs: number[] = [];
      if (model.holes.length > 0) {
        const steps = Math.max(24, Math.min(240, Math.ceil(b - a)));
        const scan = Array.from({ length: steps + 1 }, (_, i) => a + ((b - a) * i) / steps);
        const rawScan = scan.map((t) => model.projectRaw(mLocal(t)));
        for (let h = 0; h < model.holes.length; h++) {
          for (let i = 0; i < steps; i++) {
            const o0 = rawScan[i]!.holes[h] !== null;
            const o1 = rawScan[i + 1]!.holes[h] !== null;
            if (o0 === o1) continue;
            let lo = scan[i]!, hi = scan[i + 1]!;
            for (let it = 0; it < 12; it++) {
              const mid = (lo + hi) / 2;
              const om = model.projectRaw(mLocal(mid)).holes[h] !== null;
              if (om === o0) lo = mid;
              else hi = mid;
            }
            const tRoot = (lo + hi) / 2;
            const tOpen = o0 ? lo : hi;
            const mOpen = mLocal(tOpen);
            const openRaw = model.projectRaw(mOpen).holes[h];
            if (openRaw) {
              const [ax, ay] = model.holeAnchorsLocal[h]!;
              const target: Pt = [model.home[0] + mOpen[0][0] * ax + mOpen[0][1] * ay, model.home[1] + mOpen[1][0] * ax + mOpen[1][1] * ay];
              holeEvents[h]!.push({ tRoot, openContour: resampleTrackedContour(openRaw, target, model.holeVerts, false) });
            }
            holeEventTs.push(tRoot);
          }
        }
      }
      const refAt = (t: number): Array<LottieBezierPath | null> =>
        model.holes.map((_, h) => {
          const evs = holeEvents[h]!;
          if (!evs.length) return null;
          let best = evs[0]!;
          for (const e of evs) if (Math.abs(e.tRoot - t) < Math.abs(best.tRoot - t)) best = e;
          return best.openContour;
        });

      const baseCache = new Map<number, LottieBezierPath[]>();
      const contoursAt = (t: number, prev?: LottieBezierPath[]): LottieBezierPath[] => {
        if (prev) return model.poseContours(mLocal(t), refAt(t), prev);
        const key = Math.round(t * 1e4);
        let c = baseCache.get(key);
        if (!c) {
          c = model.poseContours(mLocal(t), refAt(t));
          baseCache.set(key, c);
        }
        return c;
      };

      const fz = (t: number): number => placed(k, t).m[2][2];
      // Seed only real geometric events (span ends, stops, edge-on, face-on, hole shut/open); skip near-duplicates
      const rawSeeds = uniqueTimes([
        a, b, ...stopsIn(a, b),
        ...levelTimes(fz, 0, a, b),
        ...extremaTimes((t) => Math.abs(fz(t)), a, b),
        ...holeEventTs,
      ]).filter((t) => t >= a - 1e-6 && t <= b + 1e-6);
      let ts: number[] = [];
      for (const t of rawSeeds) {
        if (!ts.length || t === b || t - ts[ts.length - 1]! >= 1.5) ts.push(t);
      }
      if (ts[ts.length - 1]! < b - 1e-3) ts.push(b);

      const isDense = (cand: number[]): boolean =>
        measureTrackDensity(cand.map((t) => ({ t, s: [0] })), fps).dense;

      // Adaptively insert poses where in-between silhouette strays most past `tol`, respecting local 1s density windows
      for (let guard = 0; guard < 24; guard++) {
        const cands: Array<{ err: number; t: number }> = [];
        let prevPose: LottieBezierPath[] | undefined;
        for (let j = 0; j < ts.length - 1; j++) {
          const t0 = ts[j]!, t1 = ts[j + 1]!;
          const c0 = contoursAt(t0, prevPose);
          const c1 = contoursAt(t1, c0);
          prevPose = c0;
          if (t1 - t0 < 3) continue;
          let segBest = { err: 0, t: -1 };
          for (const tau of [0.25, 0.5, 0.75]) {
            const tm = t0 + (t1 - t0) * tau;
            if (tm - t0 < 1.5 || t1 - tm < 1.5) continue;
            const ct = contoursAt(tm, c0);
            const u = projectBlend(c0[0]!, c1[0]!, ct[0]!);
            const blended = c0.map((p0, ci) => lerpPath(p0, c1[ci]!, u));
            const err = compoundShapeError(blended, ct);
            if (err > segBest.err) segBest = { err, t: tm };
          }
          if (segBest.err > tol && segBest.t >= 0) cands.push(segBest);
        }
        if (!cands.length) break;
        cands.sort((p, q) => q.err - p.err);
        let picked = false;
        for (const cand of cands) {
          const pickT = Math.round(cand.t * 4) / 4;
          if (ts.some((existing) => Math.abs(existing - pickT) < 1.5)) continue;
          const nextTs = uniqueTimes([...ts, pickT]);
          if (nextTs.length > ts.length && !isDense(nextTs)) {
            ts = nextTs;
            picked = true;
            break;
          }
        }
        if (!picked) break;
      }

      // Sequentially align every pose directly against the previous pose (continuous s0 + matched sharp corner knots)
      const alignedPoses: LottieBezierPath[][] = [];
      for (let j = 0; j < ts.length; j++) {
        alignedPoses.push(contoursAt(ts[j]!, j > 0 ? alignedPoses[j - 1] : undefined));
      }

      for (const t of ts) allPoseDegs.push(r3(angle.at(t)));
      ts.forEach((t, j) => {
        const cA = alignedPoses[j]!;
        const nextT = ts[j + 1];
        const hold = nextT === undefined && si < l.spans.length - 1;
        if (nextT === undefined || hold) {
          for (let ci = 0; ci < nContours; ci++) allStops[ci]!.push({ t, path: cA[ci]!, ...(hold ? { hold: true } : {}) });
          return;
        }
        const cB = alignedPoses[j + 1]!;
        const mids = Array.from({ length: 7 }, (_, s) => contoursAt(t + ((nextT - t) * (s + 1)) / 8, cA));
        for (let ci = 0; ci < nContours; ci++) {
          const pA = cA[ci]!, pB = cB[ci]!;
          const moved = pA.v.some((v, vi) => Math.hypot(v[0] - pB.v[vi]![0], v[1] - pB.v[vi]![1]) > 1e-3);
          if (!moved) {
            allStops[ci]!.push({ t, path: pA, ease: [0, 0, 1, 1] as CubicBezierTuple });
          } else {
            const samples: Array<[number, number]> = mids.map((mc, s) => [(s + 1) / 8, projectBlend(pA, pB, mc[ci]!)]);
            const e = fitEaseToSamples(samples, 0, 1);
            allStops[ci]!.push({ t, path: pA, ease: [r3(e.ox), r3(e.oy), r3(e.ix), r3(e.iy)] as CubicBezierTuple });
          }
        }
      });
    });

    if (!poseSets[part.name]) poseSets[part.name] = [...new Set(allPoseDegs)];
    const built = allStops.map((stops) => ({ match: 'vertices' as const, stops }));
    extrudeMorphCache.set(cacheId, built);
    return built;
  };

  // Exact 4-vertex terminator morph builder for SphereModel (linear in lz, so extrema + zero crossings are exact)
  const sphereShadeMorphStops = (l: PlannedLayer, model: SphereModel): ShapeMorphStop[] => {
    const part = spec.parts[l.part] as TurntableSphere;
    const lzAt = (t: number): number => sphereLightAt(part, t)[2];
    const out: ShapeMorphStop[] = [];
    l.spans.forEach(([a, b], si) => {
      const ts = uniqueTimes([a, b, ...stopsIn(a, b), ...extremaTimes(lzAt, a, b), ...levelTimes(lzAt, 0, a, b)]).filter(
        (t) => t >= a - 1e-6 && t <= b + 1e-6,
      );
      ts.forEach((t, j) => {
        const z0 = lzAt(t);
        const path = model.shadePose(z0);
        const nextT = ts[j + 1];
        const hold = nextT === undefined && si < l.spans.length - 1;
        if (nextT === undefined || hold) {
          out.push({ t, path, ...(hold ? { hold: true } : {}) });
          return;
        }
        const z1 = lzAt(nextT);
        if (Math.abs(z1 - z0) < 1e-5) {
          out.push({ t, path, ease: [0, 0, 1, 1] as CubicBezierTuple });
        } else {
          const samples: Array<[number, number]> = [];
          for (let s = 1; s < 10; s++) samples.push([s / 10, (lzAt(t + ((nextT - t) * s) / 10) - z0) / (z1 - z0)]);
          const e = fitEaseToSamples(samples, 0, 1);
          out.push({ t, path, ease: [r3(e.ox), r3(e.oy), r3(e.ix), r3(e.iy)] as CubicBezierTuple });
        }
      });
    });
    return out;
  };

  const layers: CompiledLayer[] = plan.layers.map((l) => {
    const part = spec.parts[l.part]!;
    const model = models[l.part];
    const home = partHome(spec, l.part);
    // the layer's transform at frame t: [x, y, rotation°, skew°, scale x %, scale y %], and art points to check it by
    let transform: (t: number) => number[];
    let probe: Pt[];
    let anchor: Pt = home;
    let facing: ((t: number) => number) | null = null;
    let rotPeriod = 360;
    let rotSingularityTimes: number[] = [];

    if (model instanceof StripModel) {
      const zs = (part as TurntableExtrude).z ?? 0;
      anchor = [ox + model.xc, oy];
      transform = (t) => {
        const phi = phiAt(t), c = Math.cos(phi), s = Math.sin(phi);
        const xS = ox + model.xc * c - zs * s, p = spec.focal ? spec.focal / (spec.focal - (model.xc * s + zs * c)) : 1;
        if (l.kind === 'front' || l.kind === 'back') {
          const x = xS + (l.kind === 'front' ? -1 : 1) * ((part as TurntableExtrude).depth / 2) * s * p;
          return [x, oy, 0, 0, Math.max(0.01, 100 * Math.abs(c)) * p, 100 * p];
        }
        return [xS, oy, 0, 0, 100 * p, 100 * p];
      };
      const w = Math.max(...model.outline.v.map((v) => Math.abs(v[0] - model.xc))), hgt = Math.max(...model.outline.v.map((v) => Math.abs(v[1])));
      probe = [[-w, -hgt], [w, -hgt], [w, hgt], [-w, hgt]];
    } else if (model instanceof ExtrudeModel) {
      const ep = part as TurntableExtrude;
      if (l.kind === 'front' || l.kind === 'back') {
        const sgn = l.kind === 'front' ? 1 : -1;
        const frame = faceFrame([0, 0, sgn * (ep.depth / 2)], [0, 0, sgn]);
        transform = (t) => faceTransform(spec, placed(l.part, t), frame);
        facing = (t) => sgn * placed(l.part, t).m[2][2];
      } else {
        transform = (t) => {
          const pl = placed(l.part, t);
          return [ox + pl.c[0], oy + pl.c[1], extrudeInPlaneRad(pl.m) / D2R, 0, 100 * pl.p, 100 * pl.p];
        };
      }
      const w = model.halfW, hgt = model.halfH;
      probe = [[-w, -hgt], [w, -hgt], [w, hgt], [-w, hgt]];
    } else if (model instanceof SphereModel) {
      const sp = part as TurntableSphere;
      const R = model.radius;
      if (l.kind === 'body') {
        transform = (t) => {
          const pl = placed(l.part, t);
          return [ox + pl.c[0], oy + pl.c[1], 0, 0, 100 * pl.p, 100 * pl.p];
        };
      } else if (l.kind === 'shade') {
        const cand = levelTimes((t) => sphereLightAt(sp, t)[0], 0, plan.ip, plan.op);
        rotSingularityTimes = cand.filter((t) => {
          const lv = sphereLightAt(sp, t);
          return Math.hypot(lv[0], lv[1]) < 1e-3;
        });
        const rawRot = (t: number): number => {
          const lv = sphereLightAt(sp, t);
          return Math.atan2(lv[1], lv[0]) / D2R;
        };
        const rot = rotSingularityTimes.length ? rawRot : unwrapped(rawRot, 360, plan.ip, plan.op);
        transform = (t) => {
          const pl = placed(l.part, t);
          return [ox + pl.c[0], oy + pl.c[1], rot(t), 0, 100 * pl.p, 100 * pl.p];
        };
      } else {
        // Highlight patch at specular half-vector H = unit(L + [0, 0, 1]), foreshortened along radial direction
        const rawRot = (t: number): number => {
          const lv = sphereLightAt(sp, t);
          const H = unit([lv[0], lv[1], lv[2] + 1]);
          return Math.atan2(H[1], H[0]) / D2R;
        };
        const rot = unwrapped(rawRot, 360, plan.ip, plan.op);
        transform = (t) => {
          const pl = placed(l.part, t);
          const lv = sphereLightAt(sp, t);
          const H = unit([lv[0], lv[1], lv[2] + 1]);
          const hxOff = 0.82 * R * pl.p * H[0];
          const hyOff = 0.82 * R * pl.p * H[1];
          return [ox + pl.c[0] + hxOff, oy + pl.c[1] + hyOff, rot(t), 0, 100 * pl.p * Math.max(0.05, H[2]), 100 * pl.p];
        };
      }
      probe = [[-R, -R], [R, -R], [R, R], [-R, R]];
    } else if (part.type === 'poly') {
      const pf = polyFaces(part)[l.face!]!;
      transform = (t) => faceTransform(spec, placed(l.part, t), pf.frame);
      probe = pf.corners;
      facing = (t) => mapply(placed(l.part, t).m, pf.frame.n)[2];
    } else if (l.kind === 'wall' || l.kind === 'inner-base') {
      const isProfile = model instanceof LatheProfileModel;
      rotPeriod = isProfile ? 360 : 180;
      if (isProfile) {
        // Detect exact psi = 90° hits where hypot(a[0][0], a[1][0]) == 0 (rot jumps 180° invisibly on a circle)
        const cand = levelTimes((t) => placed(l.part, t).m[0][0], 0, plan.ip, plan.op);
        rotSingularityTimes = cand.filter((t) => {
          const a = placed(l.part, t).m;
          return Math.hypot(a[0][0], a[1][0]) < 1e-3;
        });
      }
      const rawRot = (t: number): number => {
        const a = placed(l.part, t).m;
        return Math.atan2(a[1][0], a[0][0]) / D2R;
      };
      const rot = rotSingularityTimes.length
        ? rawRot
        : unwrapped(rawRot, rotPeriod, plan.ip, plan.op);
      transform = (t) => {
        const pl = placed(l.part, t);
        return [ox + pl.c[0], oy + pl.c[1], rot(t), 0, 100 * pl.p, 100 * pl.p];
      };
      const e = isProfile ? model.maxExtent : (model as DiscModel).radius + (model as DiscModel).depth / 2;
      probe = [[-e, -e], [e, -e], [e, e], [-e, e]];
      if (l.kind === 'inner-base') facing = (t) => l.end! * placed(l.part, t).m[2][0];
    } else {
      const e = l.end!;
      const isProfile = model instanceof LatheProfileModel;
      const fr = isProfile
        ? (l.kind === 'inner-wall' ? model.inner!.rRim : e > 0 ? model.rPos : model.rNeg)
        : (model as DiscModel).faceR;
      const xEnd = isProfile
        ? (l.kind === 'inner-wall' ? model.inner!.xRim : e > 0 ? model.xPos : model.xNeg)
        : e * ((model as DiscModel).depth / 2);
      const frame = faceFrame(scale3([1, 0, 0], xEnd), [e, 0, 0]);
      const rc = endSpec(part as Lathe, e)?.recess;
      transform = (t) => {
        const pl = placed(l.part, t);
        let off: Pt = [0, 0];
        if (l.kind === 'base' && rc) {
          // the recess base sits rc.depth inside, kept within the ring (what of it lies past the opening is hidden only there)
          const a = mapply(pl.m, [1, 0, 0]);
          const len = rc.depth * Math.hypot(a[0], a[1]), most = (fr - rc.radius) * Math.abs(a[2]);
          const k = len > 1e-9 ? Math.min(rc.depth, (rc.depth * most) / len) : 0;
          off = [-e * k * a[0] * pl.p, -e * k * a[1] * pl.p];
        }
        return faceTransform(spec, pl, frame, off);
      };
      probe = [[-fr, -fr], [fr, -fr], [fr, fr], [-fr, fr]];
      facing = (t) => e * placed(l.part, t).m[2][0];
    }
    const fns = [0, 1, 2, 3, 4, 5].map((d) => (t: number) => transform(t)[d]!);
    if (!rotSingularityTimes.length) {
      fns[2] = unwrapped(fns[2]!, 360, plan.ip, plan.op);
    }
    // position, rotation + skew and scale are keyed apart (each its own knots), each checked in px with the rest exact
    const groupKeys = (dims: number[], spansOverride?: Array<[number, number]>, fnsOverride?: Array<(t: number) => number>): Key[] => {
      const useFns = fnsOverride ?? fns;
      return fitKeys(spansOverride ?? l.spans, plan.ip, plan.op, quarterKnots, dims.map((d) => useFns[d]!), dims.map(() => 1), undefined, (t, fitted) => {
        const exact = useFns.map((fn) => fn(t));
        const mixed = [...exact];
        dims.forEach((d, k) => { mixed[d] = fitted[k]!; });
        return Math.max(...probe.map((q) => {
          const [p, r] = [placeArt(exact, q), placeArt(mixed, q)];
          return Math.hypot(p[0] - r[0], p[1] - r[1]);
        })) / posTol;
      });
    };
    const posK = groupKeys([0, 1]);
    const scaleK = groupKeys([4, 5]);
    let rotK: Key[];
    if (rotSingularityTimes.length) {
      // Split spans at psi = 90° singularities so rotation cuts cleanly by 180° while silhouette is a circle
      rotK = [];
      l.spans.forEach(([a, b], si) => {
        const splits = uniqueTimes([a, b, ...rotSingularityTimes.filter((t) => t > a + 0.1 && t < b - 0.1)]);
        for (let s = 0; s < splits.length - 1; s++) {
          const sa = splits[s]!, sb = splits[s + 1]!;
          const isCut = s < splits.length - 2;
          const endT = isCut ? sb - CUT : sb;
          const eps = Math.min(0.05, (endT - sa) / 4);
          const safeRaw = (t: number): number => fns[2]!(Math.max(sa + eps, Math.min(endT - eps, t)));
          const segRot = unwrapped(safeRaw, 360, sa, endT);
          const segFns = [...fns];
          segFns[2] = segRot;
          const segKeys = groupKeys([2, 3], [[sa, endT]], segFns);
          if ((isCut || si < l.spans.length - 1) && segKeys.length) segKeys[segKeys.length - 1]!.hold = true;
          rotK.push(...segKeys);
        }
      });
    } else {
      rotK = groupKeys([2, 3]);
    }

    // light: a face fades into its side colour as it turns edge-on
    let opKeys: Key[];
    let color: LottieProp<number[]> | undefined;
    const phased = l.spans.length !== 1 || l.spans[0]![0] > plan.ip || l.spans[0]![1] < plan.op;
    const phiFacing = (sgn: number) => (t: number): number => sgn * Math.cos(phiAt(t));
    if (model instanceof StripModel && (l.kind === 'front' || l.kind === 'back')) {
      const ep = part as TurntableExtrude;
      const f = phiFacing(l.kind === 'front' ? 1 : -1), full = ep.light?.full ?? L;
      opKeys = fitKeys(l.spans, plan.ip, plan.op, litKnots(f, full), [(t) => (f(t) > 0 ? 100 * lit(f(t), full) : 0)], [opTol], phased ? 0 : undefined);
    } else if (model instanceof StripModel && l.kind === 'edge-lit') {
      const ep = part as TurntableExtrude;
      const amt = ep.edgeLitOpacity ?? 70, f = phiFacing(1), full = ep.light?.full ?? L;
      opKeys = fitKeys(l.spans, plan.ip, plan.op, litKnots(f, full), [(t) => amt * (1 - lit(f(t), full))], [opTol], phased ? 0 : undefined);
    } else if (model instanceof ExtrudeModel && (l.kind === 'front' || l.kind === 'back') && facing) {
      const ep = part as TurntableExtrude;
      const f = facing, full = ep.light?.full ?? L;
      opKeys = fitKeys(l.spans, plan.ip, plan.op, litKnots(f, full), [(t) => (f(t) > 0 ? 100 * lit(f(t), full) : 0)], [opTol], 0);
    } else if (model instanceof ExtrudeModel && l.kind === 'edge-lit') {
      const ep = part as TurntableExtrude;
      const amt = ep.edgeLitOpacity ?? 70, f = (t: number) => placed(l.part, t).m[2][2], full = ep.light?.full ?? L;
      opKeys = fitKeys(l.spans, plan.ip, plan.op, litKnots(f, full), [(t) => amt * (1 - lit(f(t), full))], [opTol], phased ? 0 : undefined);
    } else if (model instanceof SphereModel && l.kind === 'highlight') {
      const sp = part as TurntableSphere;
      const peak = sp.highlightOpacity ?? 55;
      const lzAt = (t: number): number => sphereLightAt(sp, t)[2];
      opKeys = fitKeys(
        l.spans,
        plan.ip,
        plan.op,
        litKnots(lzAt, 0.35),
        [(t) => (lzAt(t) > 0 ? peak * smoothstep(clamp01(lzAt(t) / 0.35)) : 0)],
        [opTol],
        phased ? 0 : undefined,
      );
    } else if (part.type === 'poly' && facing) {
      const f = facing, shade = hexRgb(pick(part.shade, l.face!)), paint = hexRgb(pick(part.paint, l.face!)), full = part.light?.full ?? L;
      const ck = fitKeys(l.spans, plan.ip, plan.op, litKnots(f, full), [0, 1, 2].map((ch) => (t: number) => shade[ch]! + (paint[ch]! - shade[ch]!) * lit(Math.max(0, f(t)), full)), [0.004, 0.004, 0.004]);
      color = toProp(ck, [0, 1, 2], 1) as LottieProp<number[]>;
      opKeys = fitKeys(l.spans, plan.ip, plan.op, () => [], [() => 100], [opTol], 0);
    } else if (isLathe(part) && facing && ((l.kind === 'end' && !endSpec(part, l.end!)?.recess) || l.kind === 'veil')) {
      const f = facing, full = part.light?.full ?? L, veil = l.kind === 'veil';
      if (part.light?.into && part.light.outOf) {
        opKeys = easedLitKeys(l.spans, f, { full, into: part.light.into, outOf: part.light.outOf }, veil);
      } else {
        opKeys = fitKeys(l.spans, plan.ip, plan.op, litKnots(f, full), [(t) => (veil ? 100 * (1 - lit(f(t), full)) : f(t) > 0 ? 100 * lit(f(t), full) : 0)], [opTol], 0);
      }
    } else {
      opKeys = fitKeys(l.spans, plan.ip, plan.op, () => [], [() => 100], [opTol], phased ? 0 : undefined);
    }

    let morphs: CompiledLayer['morphs'];
    if ((l.kind === 'edge' || l.kind === 'edge-lit') && model instanceof ExtrudeModel) {
      morphs = extrudeMorphsFor(l, model);
    } else if (l.kind === 'shade' && model instanceof SphereModel) {
      morphs = [{ match: 'vertices' as const, stops: sphereShadeMorphStops(l, model) }];
    } else if ((l.kind === 'edge' || l.kind === 'edge-lit' || l.kind === 'wall') && model && !(model instanceof ExtrudeModel) && !(model instanceof SphereModel)) {
      morphs = [{ match: 'vertices' as const, stops: morphStops1D(l, poseSets[part.name]!, (psi) => model.pose(psi)) }];
    } else if (l.kind === 'inner-base' && model instanceof LatheProfileModel) {
      morphs = [{ match: 'vertices' as const, stops: morphStops1D(l, innerBasePoseSets[part.name] ?? [0, 90], (psi) => model.innerBasePose(psi)) }];
    }

    return {
      id: l.id,
      anchor,
      position: { x: toProp(posK, [0]) as LottieProp<number>, y: toProp(posK, [1]) as LottieProp<number> },
      rotation: toProp(rotK, [0]) as LottieProp<number>,
      skew: toProp(rotK, [1]) as LottieProp<number>,
      scale: toProp(scaleK, [0, 1], 100) as LottieProp<number[]>,
      opacity: toProp(opKeys) as LottieProp<number>,
      ...(color ? { color } : {}),
      ...(morphs ? { morphs } : {}),
    };
  });

  const countKf = (p: unknown): number => (p && typeof p === 'object' && (p as { a?: number }).a === 1 ? ((p as { k: unknown[] }).k.length) : 0);
  const keyframes = layers.reduce(
    (n, l) =>
      n + countKf(l.position.x) + countKf(l.position.y) + countKf(l.rotation) + countKf(l.skew) + countKf(l.scale) + countKf(l.opacity) + countKf(l.color) +
      (l.morphs?.reduce((s, m) => s + m.stops.length, 0) ?? 0),
    0,
  );
  const warnings = detectInterpenetrations(spec);
  const rigScale = spec.rig?.scale ?? ({ a: 0, k: [100, 100, 100] } as LottieProp<number[]>);
  const out: CompiledTurntable = {
    plan,
    layers,
    rig: { anchor: spec.origin, position: spec.rig?.position ?? { a: 0, k: [ox, oy, 0] }, scale: rigScale },
    summary: { layers: layers.length, phases: plan.phases.map((p) => p.name), poses: poseSets, keyframes: keyframes + countKf(rigScale), warnings },
  };
  if (compiledCache.size > 16) compiledCache.clear();
  compiledCache.set(cacheKey, out);
  return out;
}

function findFill(items: unknown[]): { c: unknown } | null {
  for (const raw of items) {
    const it = raw as { ty?: string; it?: unknown[]; c?: unknown };
    if (it.ty === 'fl') return it as { c: unknown };
    if (it.ty === 'gr' && it.it) {
      const f = findFill(it.it);
      if (f) return f;
    }
  }
  return null;
}

/** Moves a turntable's layers (drawn by `turntableSvg`) and hangs them from its null rig `<id>.rig`. */
export function applyTurntable(doc: LottieDocument, spec: TurntableParams, tokens: MotionTokens): TurntableSummary {
  const compiled = compileTurntable(spec, tokens, doc.fr || 60);
  for (const w of compiled.summary.warnings) console.warn(`[turntable] ${w}`);
  const rigId = `${spec.id}.rig`;
  const existing = doc.layers.find((l) => l.ln === rigId);
  const rigInd = existing ? existing.ind : Math.max(0, ...doc.layers.map((l) => l.ind)) + 1;
  const rig = {
    ddd: 0, ind: rigInd, ty: 3, nm: rigId, ln: rigId, sr: 1, ao: 0, st: 0, bm: 0,
    ip: compiled.plan.ip, op: compiled.plan.op,
    ks: {
      o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
      p: compiled.rig.position,
      a: { a: 0, k: [compiled.rig.anchor[0], compiled.rig.anchor[1], 0] },
      s: compiled.rig.scale,
    },
  } as unknown as LottieLayer;
  if (existing) Object.assign(existing, rig);
  else doc.layers.push(rig);
  for (const l of compiled.layers) {
    const layer = findLayer(doc, l.id);
    layer.ip = compiled.plan.ip;
    layer.op = compiled.plan.op;
    layer.parent = rigInd;
    layer.ks.a = { a: 0, k: [r3(l.anchor[0]), r3(l.anchor[1]), 0] };
    layer.ks.p = { s: true, x: l.position.x, y: l.position.y };
    layer.ks.r = l.rotation;
    layer.ks.s = l.scale;
    layer.ks.o = l.opacity;
    const sk = l.skew as { a: number; k: unknown };
    if (sk.a === 1 || sk.k !== 0) {
      layer.ks.sk = l.skew;
      layer.ks.sa = { a: 0, k: 0 };
    }
    if (l.color) {
      const fill = findFill((layer as unknown as { shapes?: unknown[] }).shapes ?? []);
      if (fill) fill.c = l.color;
    }
    if (l.morphs) {
      l.morphs.forEach((m, pathIndex) => {
        applyShapeMorph(doc, { kind: 'shapeMorph', layerId: l.id, pathIndex, ...m }, tokens);
      });
    }
  }
  return compiled.summary;
}

/**
 * The turntable's layers as SVG groups, in paint order, each drawn at its home (see `TurntableParams`): put them in
 * the scene's SVG (with the gradients its paints use in <defs>), import it, then apply the spec as a primitive.
 */
export function turntableSvg(spec: TurntableParams, tokens?: MotionTokens): string {
  const angle = new TurnAngle(spec, tokens ?? ({ ease: {} } as unknown as MotionTokens));
  const view = new View(spec, angle);
  const plan = planTurntable(spec, angle);
  const n2 = (v: number): string => String(r3(v));
  return plan.layers.map((l) => {
    const part = spec.parts[l.part]!;
    const [hx, hy] = partHome(spec, l.part);
    let body: string;
    if (isExtrude(part)) {
      const fill = l.kind === 'edge' ? part.edge : l.kind === 'edge-lit' ? part.edgeLit! : part.face;
      if (canUseAnalyticStrip(part, view)) {
        const m = new StripModel(part, [hx, hy]);
        body = `<path d="${svgD(l.kind === 'front' || l.kind === 'back' ? m.face() : m.pose(0))}" fill="${fill}" />`;
      } else {
        const m = new ExtrudeModel(part, [hx, hy]);
        const contours =
          l.kind === 'front' ? m.faceContours(false)
            : l.kind === 'back' ? m.faceContours(true)
              : m.poseContours(I3, m.holes.map(() => null));
        body = `<path d="${contours.map(svgD).join(' ')}" fill="${fill}"${m.holes.length ? ' fill-rule="evenodd"' : ''} />`;
      }
    } else if (part.type === 'sphere') {
      const m = new SphereModel(part, [hx, hy]);
      if (l.kind === 'body') {
        body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(part.radius)}" fill="${part.paint}" />`;
      } else if (l.kind === 'shade') {
        body = `<path d="${svgD(m.shadePose(0))}" fill="${part.shade}" />`;
      } else {
        const hlCol = typeof part.highlight === 'string' ? part.highlight : '#FFFFFF';
        const gradId = `${l.id}-grad`;
        body =
          `<defs><radialGradient id="${gradId}" cx="50%" cy="50%" r="50%">` +
          `<stop offset="0%" stop-color="${hlCol}" stop-opacity="1" />` +
          `<stop offset="55%" stop-color="${hlCol}" stop-opacity="0.38" />` +
          `<stop offset="100%" stop-color="${hlCol}" stop-opacity="0" />` +
          `</radialGradient></defs>` +
          `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(part.radius * 0.36)}" fill="url(#${gradId})" />`;
      }
    } else if (part.type === 'poly') {
      const pts = polyFaces(part)[l.face!]!.corners.map(([u, v]) => `${n2(hx + u)} ${n2(hy + v)}`);
      body = `<path d="M ${pts.join(' L ')} Z" fill="${pick(part.paint, l.face!)}" />`;
    } else if (usesProfile(part)) {
      const m = new LatheProfileModel(part, [hx, hy]);
      const end = l.end ? endSpec(part, l.end) : undefined;
      const fr = l.end && l.end > 0 ? m.rPos : m.rNeg;
      if (l.kind === 'wall') body = `<path d="${svgD(m.pose(0))}" fill="${part.side}" />`;
      else if (l.kind === 'inner-wall') body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(m.inner!.rRim + 0.4)}" fill="${part.innerPaint ?? part.side}" />`;
      else if (l.kind === 'inner-base') body = `<path d="${svgD(m.innerBasePose(90))}" fill="${part.innerBase ?? part.innerPaint ?? part.side}" />`;
      else if (l.kind === 'veil') body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(fr)}" fill="${part.side}" />`;
      else if (l.kind === 'hole') body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(end!.recess!.radius + 0.5)}" fill="${end!.recess!.wall}" />`;
      else if (l.kind === 'base') body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(end!.recess!.radius)}" fill="${end!.recess!.base}" />`;
      else if (m.inner && m.inner.openEnd === l.end) body = `<path d="${geo.toSvgPath(geo.subtract(geo.circle(hx, hy, fr), geo.circle(hx, hy, m.inner.rRim)))}" fill="${end?.paint ?? part.side}" fill-rule="evenodd" />`;
      else if (end?.art) body = end.art;
      else if (end?.recess) body = `<path d="${geo.toSvgPath(geo.subtract(geo.circle(hx, hy, fr), geo.circle(hx, hy, end.recess.radius)))}" fill="${end.paint ?? part.side}" fill-rule="evenodd" />`;
      else body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(fr)}" fill="${end?.paint ?? part.side}" />`;
    } else {
      const m = new DiscModel(part, [hx, hy]);
      const end = l.end ? endSpec(part, l.end) : undefined;
      const fr = m.faceR;
      if (l.kind === 'wall') body = `<path d="${svgD(m.pose(0))}" fill="${part.side}" />`;
      else if (l.kind === 'veil') body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(fr)}" fill="${part.side}" />`;
      else if (l.kind === 'hole') body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(end!.recess!.radius + 0.5)}" fill="${end!.recess!.wall}" />`;
      else if (l.kind === 'base') body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(end!.recess!.radius)}" fill="${end!.recess!.base}" />`;
      else if (end?.art) body = end.art;
      else if (end?.recess) body = `<path d="${geo.toSvgPath(geo.subtract(geo.circle(hx, hy, fr), geo.circle(hx, hy, end.recess.radius)))}" fill="${end.paint ?? part.side}" fill-rule="evenodd" />`;
      else body = `<circle cx="${n2(hx)}" cy="${n2(hy)}" r="${n2(fr)}" fill="${end?.paint ?? part.side}" />`;
    }
    return `\n  <g id="${l.id}">\n    ${body}\n  </g>`;
  }).join('');
}

/**
 * Where each part is at frame t, for checking against real 3D: its centre after the turn and tilt (model px around
 * the origin, y down, z toward the camera) and its local → view rotation (rows).
 */
export function turntablePose(spec: TurntableParams, t: number, tokens?: MotionTokens): Array<{ center: number[]; rotation: number[][] }> {
  const angle = new TurnAngle(spec, tokens ?? ({ ease: {} } as unknown as MotionTokens));
  const view = new View(spec, angle);
  return spec.parts.map((p) => {
    const pl = placeAt(spec, view, p, t);
    return { center: [...pl.c], rotation: pl.m.map((r) => [...r]) };
  });
}

/** a polyhedron's corners and faces for a pyramid with a square base (side `base`, apex `height` above it) */
export function polyPyramid(base: number, height: number): { vertices: Array<[number, number, number]>; faces: number[][] } {
  const h = base / 2, y0 = height / 3; // centred on its centroid height
  return {
    vertices: [[-h, y0, -h], [h, y0, -h], [h, y0, h], [-h, y0, h], [0, y0 - height, 0]],
    faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
  };
}

/** a box w × h × d around its centre */
export function polyBox(w: number, h: number, d: number): { vertices: Array<[number, number, number]>; faces: number[][] } {
  const [x, y, z] = [w / 2, h / 2, d / 2];
  return {
    vertices: [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]],
    faces: [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]],
  };
}


/** Values of a Lottie property at frame t (holds, bezier eases, separated position), e.g. a turntable's rig. */
export function sampleLottieProp(prop: unknown, t: number): number[] {
  const p = prop as { s?: boolean; x?: unknown; y?: unknown; a?: number; k?: unknown };
  if (p.s === true) return [...sampleLottieProp(p.x, t), ...sampleLottieProp(p.y, t)];
  if (p.a !== 1) return Array.isArray(p.k) ? (p.k as number[]) : [p.k as number];
  const ks = p.k as LottieKeyframe<number[]>[];
  if (t <= ks[0]!.t) return ks[0]!.s;
  for (let j = 0; j < ks.length - 1; j++) {
    const a = ks[j]!, b = ks[j + 1]!;
    if (t >= b.t) continue;
    if (a.h === 1) return a.s;
    const tau = (t - a.t) / (b.t - a.t);
    const end = a.e ?? b.s;
    return a.s.map((v, d) => {
      const pick = (arr: number[] | undefined): number => (arr ? (arr[d] ?? arr[0]!) : 0);
      const y = easeY([pick(a.o?.x as number[]), pick(a.o?.y as number[]), pick(a.i?.x as number[]), pick(a.i?.y as number[])], tau);
      return v + (end[d]! - v) * y;
    });
  }
  return ks[ks.length - 1]!.s;
}

/** internals, for tests and debugging */
export const __internals = { StripModel, ExtrudeModel, DiscModel, LatheProfileModel, SphereModel, detectInterpenetrations, outlineDistance, shapeError, compoundShapeError, lerpPath, projectBlend, fitKeys, planTurntable, TurnAngle, faceTransform, placeArt };
