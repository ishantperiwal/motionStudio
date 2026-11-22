// Exact vector geometry for Lottie shapes. Shapes are constructed the way a design tool does it: straight
// lines, true circular arcs, booleans (paper.js) and corner rounding with real fillets, never sampled from a
// formula. `toLottiePath` emits one closed contour in comp coordinates; `matchPaths` gives several paths the
// same vertex count for morphing by splitting their curves exactly, so the geometry never changes.
import { createRequire } from 'node:module';
import type {} from 'paper'; // the global `paper` type namespace
import type { LottieBezierPath } from './types.js';

// paper-core: the headless build (no canvas, no PaperScript)
const paper = createRequire(import.meta.url)('paper/dist/paper-core.js') as paper.PaperScope;

export type Shape = paper.PathItem;
type Pt = [number, number];
type Cubic = [Pt, Pt, Pt, Pt];

let ready = false;
function ensurePaper(): void {
  if (!ready) {
    paper.setup(new paper.Size(1, 1));
    ready = true;
  }
}

const P = (x: number, y: number): paper.Point => new paper.Point(x, y);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function circle(cx: number, cy: number, r: number): Shape {
  ensurePaper();
  return new paper.Path.Circle({ center: P(cx, cy), radius: r, insert: false });
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rotationDeg = 0): Shape {
  ensurePaper();
  const e = new paper.Path.Ellipse({ center: P(cx, cy), radius: new paper.Size(rx, ry), insert: false });
  if (rotationDeg) e.rotate(rotationDeg, P(cx, cy));
  return e;
}

export function rect(x: number, y: number, w: number, h: number, cornerRadius = 0): Shape {
  ensurePaper();
  return new paper.Path.Rectangle({
    rectangle: new paper.Rectangle(x, y, w, h),
    radius: new paper.Size(cornerRadius, cornerRadius),
    insert: false,
  });
}

/** A path through straight-line vertices (closed). */
export function polyline(points: Pt[], cornerRadius = 0): Shape {
  ensurePaper();
  const path = new paper.Path({ segments: points.map(([x, y]) => P(x, y)), closed: true, insert: false });
  return cornerRadius > 0 ? roundCorners(path, cornerRadius) : path;
}

/** Regular polygon, a vertex pointing up (rotate with `rotationDeg`), optional rounded corners. */
export function polygon(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  opts: { rotationDeg?: number; cornerRadius?: number } = {},
): Shape {
  const rot = ((opts.rotationDeg ?? 0) * Math.PI) / 180 - Math.PI / 2;
  const pts = Array.from({ length: sides }, (_, k): Pt => {
    const a = rot + (2 * Math.PI * k) / sides;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  });
  return polyline(pts, opts.cornerRadius ?? 0);
}

/**
 * Star with `points` tips. Sides are straight, or concave circular arcs when `sideDepth` > 0 (the arc's
 * inward bulge at the side's middle, in px; the ✦ sparkle). Deeper arcs make thinner tips: around 0.3 of the
 * tip-to-tip half-chord the tips close to a cusp. Tips and inner corners round with `cornerRadius`.
 */
export function star(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  opts: { rotationDeg?: number; cornerRadius?: number; sideDepth?: number } = {},
): Shape {
  ensurePaper();
  const rot = ((opts.rotationDeg ?? 0) * Math.PI) / 180 - Math.PI / 2;
  const at = (r: number, a: number): paper.Point => P(cx + r * Math.cos(a), cy + r * Math.sin(a));
  const path = new paper.Path({ insert: false });
  if (opts.sideDepth && opts.sideDepth > 0) {
    // tip to tip with one concave arc per side, through a point pulled toward the centre
    for (let k = 0; k < points; k++) {
      const a0 = rot + (2 * Math.PI * k) / points;
      const a1 = a0 + (2 * Math.PI) / points;
      const p0 = at(outer, a0), p1 = at(outer, a1);
      const mid = p0.add(p1).divide(2);
      const through = mid.add(P(cx, cy).subtract(mid).normalize(opts.sideDepth));
      if (k === 0) path.moveTo(p0);
      path.arcTo(through, p1);
    }
    path.closePath();
    // arcTo's last arc lands on the first point: drop the duplicate vertex
    if (path.segments.length > 1 && path.lastSegment.point.getDistance(path.firstSegment.point) < 1e-6) {
      path.firstSegment.handleIn = path.lastSegment.handleIn;
      path.lastSegment.remove();
    }
  } else {
    for (let k = 0; k < points * 2; k++) {
      path.add(at(k % 2 ? inner : outer, rot + (Math.PI * k) / points));
    }
    path.closed = true;
  }
  return opts.cornerRadius ? roundCorners(path, opts.cornerRadius) : path;
}

// ---------------------------------------------------------------------------
// Booleans & transforms
// ---------------------------------------------------------------------------

export function union(...shapes: Shape[]): Shape {
  return shapes.reduce((a, b) => a.unite(b, { insert: false }));
}

export function subtract(base: Shape, ...cutters: Shape[]): Shape {
  return cutters.reduce((a, b) => a.subtract(b, { insert: false }), base);
}

export function intersect(a: Shape, b: Shape): Shape {
  return a.intersect(b, { insert: false });
}

export function exclude(a: Shape, b: Shape): Shape {
  return a.exclude(b, { insert: false });
}

export function transform(
  shape: Shape,
  t: { translate?: Pt; rotateDeg?: number; scale?: number | Pt; origin?: Pt },
): Shape {
  const s = shape.clone({ insert: false });
  const o = t.origin ? P(t.origin[0], t.origin[1]) : s.bounds.center;
  if (t.scale !== undefined) {
    const [sx, sy] = Array.isArray(t.scale) ? t.scale : [t.scale, t.scale];
    s.scale(sx, sy, o);
  }
  if (t.rotateDeg) s.rotate(t.rotateDeg, o);
  if (t.translate) s.translate(P(t.translate[0], t.translate[1]));
  return s;
}

export function area(shape: Shape): number {
  return Math.abs((shape as paper.Path | paper.CompoundPath).area);
}

/** Uniformly scales a shape about `origin` (default: its centre) to the given area. */
export function scaleToArea(shape: Shape, targetArea: number, origin?: Pt): Shape {
  return transform(shape, { scale: Math.sqrt(targetArea / area(shape)), origin });
}

// ---------------------------------------------------------------------------
// Corner rounding (fillets)
// ---------------------------------------------------------------------------

const cubicOf = (c: paper.Curve): Cubic => [
  [c.point1.x, c.point1.y],
  [c.point1.x + c.handle1.x, c.point1.y + c.handle1.y],
  [c.point2.x + c.handle2.x, c.point2.y + c.handle2.y],
  [c.point2.x, c.point2.y],
];

function pathFromCubics(cubics: Cubic[]): paper.Path {
  const n = cubics.length;
  const path = new paper.Path({ insert: false });
  cubics.forEach((c, j) => {
    const prev = cubics[(j - 1 + n) % n]!;
    path.add(
      new paper.Segment(
        P(c[0][0], c[0][1]),
        P(prev[2][0] - c[0][0], prev[2][1] - c[0][1]),
        P(c[1][0] - c[0][0], c[1][1] - c[0][1]),
      ),
    );
  });
  path.closed = true;
  return path;
}

/**
 * Rounds every corner (convex and concave: polygon tips, the notches where boolean shapes meet) with a
 * circular fillet of `radius` px, cut back along the two curves that meet there. Smooth joins are untouched.
 * The cut grows as a corner sharpens (r·tan(turn/2)): a 30° tip cuts back ~4r, so keep radii small there.
 */
export function roundCorners(shape: Shape, radius: number, minAngleDeg = 2): Shape {
  ensurePaper();
  if (shape instanceof paper.CompoundPath) {
    const out = new paper.CompoundPath({ insert: false });
    for (const child of shape.children) out.addChild(roundCorners(child as paper.Path, radius, minAngleDeg));
    return out;
  }
  const path = shape as paper.Path;
  const curves = path.curves;
  const n = curves.length;
  if (!path.closed || n < 2) return path.clone({ insert: false });
  const cut = new Array<number>(n).fill(0);
  const turn = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    const cin = curves[(j - 1 + n) % n]!;
    const cout = curves[j]!;
    const tin = cin.getTangentAtTime(1);
    const tout = cout.getTangentAtTime(0);
    const theta = Math.acos(Math.max(-1, Math.min(1, tin.dot(tout))));
    // smooth joins need nothing; a cusp (the curves double back) has no fillet, any radius would eat the shape
    if (theta < (minAngleDeg * Math.PI) / 180 || theta > (175 * Math.PI) / 180) continue;
    turn[j] = theta;
    cut[j] = Math.min(radius * Math.tan(theta / 2), 0.45 * cin.length, 0.45 * cout.length);
  }
  const cubics: Cubic[] = [];
  for (let j = 0; j < n; j++) {
    const c = curves[j]!;
    const len = c.length;
    const t0 = cut[j]! > 0 ? c.getTimeAt(cut[j]!) : 0;
    const endCut = cut[(j + 1) % n]!;
    const t1 = endCut > 0 ? c.getTimeAt(len - endCut) : 1;
    cubics.push(cubicOf(c.getPart(t0, t1)));
    if (endCut > 0) {
      // fillet from this curve's cut end to the next curve's cut start, tangent to both: a circular arc of
      // the radius that fits the cut, as a cubic (handle = 4/3·tan(θ/4)·r)
      const next = curves[(j + 1) % n]!;
      const theta = turn[(j + 1) % n]!;
      const p1 = c.getPointAtTime(t1);
      const d1 = c.getTangentAtTime(t1);
      const nt = next.getTimeAt(endCut);
      const p2 = next.getPointAtTime(nt);
      const d2 = next.getTangentAtTime(nt);
      const r = endCut / Math.tan(theta / 2);
      const h = (4 / 3) * Math.tan(theta / 4) * r;
      cubics.push([
        [p1.x, p1.y],
        [p1.x + d1.x * h, p1.y + d1.y * h],
        [p2.x - d2.x * h, p2.y - d2.y * h],
        [p2.x, p2.y],
      ]);
    }
  }
  return pathFromCubics(cubics);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function singleContour(shape: Shape): paper.Path {
  if (shape instanceof paper.CompoundPath) {
    const kids = shape.children.filter((c) => Math.abs((c as paper.Path).area) > 1e-6);
    if (kids.length !== 1) {
      throw new Error(`Shape has ${kids.length} contours; a morphable Lottie path needs exactly one (no holes or islands)`);
    }
    return kids[0] as paper.Path;
  }
  return shape as paper.Path;
}

/** One closed contour as a Lottie bezier path (vertices with relative in/out handles). */
export function toLottiePath(shape: Shape): LottieBezierPath {
  const path = singleContour(shape);
  return {
    c: path.closed,
    v: path.segments.map((s) => [s.point.x, s.point.y]),
    i: path.segments.map((s) => [s.handleIn.x, s.handleIn.y]),
    o: path.segments.map((s) => [s.handleOut.x, s.handleOut.y]),
  };
}

/** All non-empty closed contours of a shape (outer + any holes) as Lottie bezier paths, largest area first. */
export function toLottiePaths(shape: Shape): LottieBezierPath[] {
  const raw: paper.Path[] =
    shape instanceof paper.CompoundPath
      ? (shape.children.filter((c) => Math.abs((c as paper.Path).area) > 1e-4) as paper.Path[])
      : Math.abs((shape as paper.Path).area) > 1e-4
        ? [shape as paper.Path]
        : [];
  raw.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  return raw.map((path) => ({
    c: path.closed,
    v: path.segments.map((s) => [s.point.x, s.point.y]),
    i: path.segments.map((s) => [s.handleIn.x, s.handleIn.y]),
    o: path.segments.map((s) => [s.handleOut.x, s.handleOut.y]),
  }));
}

/** A Lottie bezier path back into a shape (to measure it or combine it with booleans). */
export function fromLottiePath(p: LottieBezierPath): Shape {
  ensurePaper();
  return new paper.Path({
    segments: p.v.map((v, j) => new paper.Segment(P(v[0], v[1]), P(p.i[j]![0], p.i[j]![1]), P(p.o[j]![0], p.o[j]![1]))),
    closed: p.c,
    insert: false,
  });
}

/** Multiple Lottie bezier contours (e.g. outer + holes) into a single CompoundPath shape. */
export function fromLottiePaths(paths: LottieBezierPath[]): Shape {
  ensurePaper();
  if (paths.length === 1) return fromLottiePath(paths[0]!);
  const cp = new paper.CompoundPath({ insert: false });
  for (const p of paths) cp.addChild(fromLottiePath(p));
  return cp;
}

/** SVG path data (`M … A … Z`) as a shape; arcs become exact cubic segments of at most 90°. */
export function fromSvgPath(d: string): Shape {
  ensurePaper();
  return new paper.CompoundPath({ pathData: d, insert: false }).reduce({}) as Shape;
}

export function toSvgPath(shape: Shape): string {
  return shape.pathData;
}

// ---------------------------------------------------------------------------
// Morph matching (exact)
// ---------------------------------------------------------------------------

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const [p0, p1, p2, p3] = c;
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), d = lerp(p2, p3, t);
  const e = lerp(a, b, t), f = lerp(b, d, t), g = lerp(e, f, t);
  return [[p0, a, e, g], [g, f, d, p3]];
}

function pointAt(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1].map((k) => c.reduce((s, p, j) => s + p[k]! * w[j]!, 0)) as Pt;
}

function cubicLength(c: Cubic, steps = 24): number {
  let len = 0;
  let prev = c[0];
  for (let s = 1; s <= steps; s++) {
    const p = pointAt(c, s / steps);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
}

function cubicsOf(path: LottieBezierPath): Cubic[] {
  const n = path.v.length;
  return path.v.map((a, j) => {
    const b = path.v[(j + 1) % n]!;
    const o = path.o[j]!;
    const i = path.i[(j + 1) % n]!;
    // a straight segment stores zero handles; give it handles a third of the way along (the same line), so
    // a morph blends a real direction there instead of creasing the in-between frames
    if (Math.hypot(o[0], o[1]) < 1e-9 && Math.hypot(i[0], i[1]) < 1e-9) return [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b] as Cubic;
    return [a, [a[0] + o[0], a[1] + o[1]], [b[0] + i[0], b[1] + i[1]], b] as Cubic;
  });
}

function lottieOf(cubics: Cubic[]): LottieBezierPath {
  const n = cubics.length;
  const v: Pt[] = [], i: Pt[] = new Array(n), o: Pt[] = [];
  cubics.forEach((c, j) => {
    v.push(c[0]);
    o.push([c[1][0] - c[0][0], c[1][1] - c[0][1]]);
    i[(j + 1) % n] = [c[2][0] - c[3][0], c[2][1] - c[3][1]];
  });
  return { c: true, v, i, o };
}

function samples(cubics: Cubic[], per = 16): Pt[] {
  return cubics.flatMap((c) => Array.from({ length: per }, (_, s) => pointAt(c, s / per)));
}

/**
 * Gives closed paths the same vertex count, winding and starting point so they morph cleanly: each path
 * starts where its outline crosses straight up from its centre, runs clockwise, and gains vertices by
 * splitting its longest curve in half (de Casteljau, so the shape is unchanged) until all have `count`
 * (default: the most any path has).
 */
export function matchPaths(paths: LottieBezierPath[], count?: number): LottieBezierPath[] {
  const prepared = paths.map((path) => {
    if (!path.c) throw new Error('matchPaths: only closed paths can be matched');
    let cubics = cubicsOf(path);
    const pts = samples(cubics);
    const signed = pts.reduce((s, p, j) => {
      const q = pts[(j + 1) % pts.length]!;
      return s + (p[0] * q[1] - q[0] * p[1]);
    }, 0);
    if (signed < 0) cubics = cubics.reverse().map((c) => [c[3], c[2], c[1], c[0]] as Cubic);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    // where the outline crosses the upward ray from the centre
    let best = { k: 0, t: 0, d: Infinity };
    cubics.forEach((c, k) => {
      for (let s = 0; s <= 64; s++) {
        const p = pointAt(c, s / 64);
        if (p[1] >= cy) continue;
        const d = Math.abs(p[0] - cx);
        if (d < best.d) best = { k, t: s / 64, d };
      }
    });
    if (best.t > 1e-3 && best.t < 1 - 1e-3) {
      const [a, b] = splitCubic(cubics[best.k]!, best.t);
      cubics.splice(best.k, 1, a, b);
      best = { k: best.k + 1, t: 0, d: 0 };
    } else if (best.t >= 1 - 1e-3) {
      best = { k: (best.k + 1) % cubics.length, t: 0, d: 0 };
    }
    return [...cubics.slice(best.k), ...cubics.slice(0, best.k)];
  });
  const target = Math.max(count ?? 0, ...prepared.map((c) => c.length));
  return prepared.map((cubics) => {
    // pieces per curve in proportion to its length (at least 1), so vertex j sits about j/target of the way
    // round every pose and the in-between frames blend like with like
    const lens = cubics.map((c) => cubicLength(c));
    const total = lens.reduce((a, b) => a + b, 0);
    const share = lens.map((l) => (l / total) * target);
    const pieces = share.map((s) => Math.max(1, Math.floor(s)));
    let left = target - pieces.reduce((a, b) => a + b, 0);
    const byRemainder = share.map((s, k) => [s - Math.floor(s), k] as const).sort((a, b) => b[0] - a[0]);
    for (let r = 0; left > 0; r = (r + 1) % byRemainder.length, left--) pieces[byRemainder[r]![1]]! += 1;
    while (left < 0) {
      const k = pieces.indexOf(Math.max(...pieces));
      pieces[k]! -= 1;
      left++;
    }
    return lottieOf(cubics.flatMap((c, k) => splitEvenly(c, pieces[k]!)));
  });
}

/** Splits a cubic into n pieces of equal arc length (each split exact). */
function splitEvenly(c: Cubic, n: number): Cubic[] {
  if (n <= 1) return [c];
  const steps = 96;
  const cum = [0];
  let prev = c[0];
  for (let s = 1; s <= steps; s++) {
    const p = pointAt(c, s / steps);
    cum.push(cum[s - 1]! + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
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
    const t = timeAt((cum[steps]! * k) / n);
    const [a, b] = splitCubic(rest, (t - t0) / (1 - t0));
    out.push(a);
    rest = b;
    t0 = t;
  }
  out.push(rest);
  return out;
}
