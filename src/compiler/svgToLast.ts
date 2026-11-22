import { optimize } from 'svgo';
import { round2, round4 } from './tokens.js';
import type {
  LottieBezierPath,
  LottieShapeFill,
  LottieShapeGradientFill,
  LottieShapeGroup,
  LottieShapeItem,
  LottieShapeLayer,
  LottieShapePath,
  LottieShapeStroke,
  LottieShapeTransform,
  NormalizedSvgResult,
  SvgFilterDescriptor,
  SvgFilterKind,
} from './types.js';

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  raw: string;
}

interface InheritedStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokeLinecap: 1 | 2 | 3;
  strokeLinejoin: 1 | 2 | 3;
  strokeDasharray?: number[];
  opacity: number;
  filterId?: string;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type Matrix2D = [number, number, number, number, number, number]; // [a, b, c, d, e, f]

const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0];

function mulMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyPoint(m: Matrix2D, x: number, y: number): [number, number] {
  return [round4(m[0] * x + m[2] * y + m[4]), round4(m[1] * x + m[3] * y + m[5])];
}

function applyVector(m: Matrix2D, dx: number, dy: number): [number, number] {
  return [round4(m[0] * dx + m[2] * dy), round4(m[1] * dx + m[3] * dy)];
}

function parseTransform(attr: string | undefined): Matrix2D {
  if (!attr) return IDENTITY;
  let mat: Matrix2D = [...IDENTITY];
  const re = /(translate|scale|rotate|skewX|skewY|matrix)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attr)) !== null) {
    const fn = match[1];
    const nums = (match[2] ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    let next: Matrix2D = IDENTITY;
    if (fn === 'translate') {
      next = [1, 0, 0, 1, nums[0] ?? 0, nums[1] ?? 0];
    } else if (fn === 'scale') {
      const sx = nums[0] ?? 1;
      const sy = nums[1] ?? sx;
      next = [sx, 0, 0, sy, 0, 0];
    } else if (fn === 'rotate') {
      const deg = nums[0] ?? 0;
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = nums[1] ?? 0;
      const cy = nums[2] ?? 0;
      if (cx !== 0 || cy !== 0) {
        next = mulMatrix(
          mulMatrix([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]),
          [1, 0, 0, 1, -cx, -cy],
        );
      } else {
        next = [cos, sin, -sin, cos, 0, 0];
      }
    } else if (fn === 'skewX') {
      const t = Math.tan(((nums[0] ?? 0) * Math.PI) / 180);
      next = [1, 0, t, 1, 0, 0];
    } else if (fn === 'skewY') {
      const t = Math.tan(((nums[0] ?? 0) * Math.PI) / 180);
      next = [1, t, 0, 1, 0, 0];
    } else if (fn === 'matrix' && nums.length >= 6) {
      next = [
        nums[0] ?? 1,
        nums[1] ?? 0,
        nums[2] ?? 0,
        nums[3] ?? 1,
        nums[4] ?? 0,
        nums[5] ?? 0,
      ];
    }
    mat = mulMatrix(mat, next);
  }
  return mat;
}

// ---------------------------------------------------------------------------
// Minimal deterministic XML parser for normalized SVGs
// ---------------------------------------------------------------------------

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1];
    if (key) attrs[key] = m[2] ?? m[3] ?? '';
  }
  if (attrs.style) {
    for (const pair of attrs.style.split(';')) {
      const [k, v] = pair.split(':').map((s) => s.trim());
      if (k && v && !(k in attrs)) attrs[k] = v;
    }
  }
  return attrs;
}

function parseXml(svg: string): XmlNode {
  const cleaned = svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const stack: Array<{ node: XmlNode; startIdx: number }> = [];
  let root: XmlNode | null = null;
  const tagRe = /<(\/?)([\w:-]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(cleaned)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2] ?? '';
    const attrStr = m[3] ?? '';
    const selfClosing = m[4] === '/';

    if (closing) {
      const top = stack.pop();
      if (top) {
        top.node.raw = cleaned.slice(top.startIdx, m.index + m[0].length);
      }
      continue;
    }

    const node: XmlNode = {
      tag,
      attrs: parseAttrs(attrStr),
      children: [],
      raw: m[0],
    };

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.node.children.push(node);
    } else if (!root) {
      root = node;
    }

    if (!selfClosing) {
      stack.push({ node, startIdx: m.index });
    }
  }

  if (!root) throw new Error('Invalid SVG: no root <svg> element found');
  return root;
}

// ---------------------------------------------------------------------------
// Color parsing -> Lottie [r, g, b, a] in 0..1
// ---------------------------------------------------------------------------

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gold: '#ffd700',
  orange: '#ffa500',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  transparent: 'rgba(0,0,0,0)',
};

function parseColor(
  raw: string | undefined,
  extraOpacity = 1,
): { rgba: [number, number, number, number]; opacityPct: number } | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return null;

  const resolved = NAMED_COLORS[v] ?? v;

  if (resolved.startsWith('#')) {
    const hex = resolved.slice(1);
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 1;
    if (hex.length === 3 || hex.length === 4) {
      r = parseInt((hex[0] ?? '0') + (hex[0] ?? '0'), 16);
      g = parseInt((hex[1] ?? '0') + (hex[1] ?? '0'), 16);
      b = parseInt((hex[2] ?? '0') + (hex[2] ?? '0'), 16);
      if (hex.length === 4) a = parseInt((hex[3] ?? 'f') + (hex[3] ?? 'f'), 16) / 255;
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
    } else {
      return null;
    }
    const finalA = Math.max(0, Math.min(1, a * extraOpacity));
    return {
      rgba: [round4(r / 255), round4(g / 255), round4(b / 255), 1],
      opacityPct: round2(finalA * 100),
    };
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(resolved);
  if (rgbMatch && rgbMatch[1]) {
    const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const r = (parts[0] ?? 0) / 255;
    const g = (parts[1] ?? 0) / 255;
    const b = (parts[2] ?? 0) / 255;
    const a = (parts[3] ?? 1) * extraOpacity;
    return {
      rgba: [round4(r), round4(g), round4(b), 1],
      opacityPct: round2(Math.max(0, Math.min(1, a)) * 100),
    };
  }

  // Fallback for url(#gradient) -> warm neutral gold/accent so geometry still renders cleanly
  if (resolved.startsWith('url(')) {
    return { rgba: [0.95, 0.78, 0.25, 1], opacityPct: round2(extraOpacity * 100) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// SVG Path `d` -> Lottie Bezier Subpaths
// ---------------------------------------------------------------------------

function arcToCubicCurves(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): Array<[number, number, number, number, number, number]> {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];

  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
  const den = rx2 * y1p2 + ry2 * x1p2 || 1e-9;
  const sign = largeArc === sweep ? -1 : 1;
  const coef = sign * Math.sqrt(num / den);

  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const vecAngle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
    const clamped = Math.max(-1, Math.min(1, dot / len));
    const ang = Math.acos(clamped);
    return ux * vy - uy * vx < 0 ? -ang : ang;
  };

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vecAngle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (sweep === 0 && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep === 1 && dTheta < 0) dTheta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segments;
  const alpha = (4 / 3) * Math.tan(delta / 4);

  const mapPt = (px: number, py: number): [number, number] => [
    cosPhi * rx * px - sinPhi * ry * py + cx,
    sinPhi * rx * px + cosPhi * ry * py + cy,
  ];

  const curves: Array<[number, number, number, number, number, number]> = [];
  for (let i = 0; i < segments; i++) {
    const t1 = theta1 + i * delta;
    const t2 = t1 + delta;
    const cos1 = Math.cos(t1);
    const sin1 = Math.sin(t1);
    const cos2 = Math.cos(t2);
    const sin2 = Math.sin(t2);

    const [cp1x, cp1y] = mapPt(cos1 - alpha * sin1, sin1 + alpha * cos1);
    const [cp2x, cp2y] = mapPt(cos2 + alpha * sin2, sin2 - alpha * cos2);
    const [ex, ey] = mapPt(cos2, sin2);
    curves.push([cp1x, cp1y, cp2x, cp2y, ex, ey]);
  }
  return curves;
}

function parsePathData(d: string, mat: Matrix2D): LottieBezierPath[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return [];

  const paths: LottieBezierPath[] = [];
  let cur: LottieBezierPath | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCmd = '';
  let lastCpx = 0;
  let lastCpy = 0;

  let i = 0;
  const nextNum = (): number => Number(tokens[i++] ?? 0);
  const isCmd = (tok: string | undefined): boolean => Boolean(tok && /^[a-zA-Z]$/.test(tok));

  const startSubpath = (x: number, y: number): void => {
    cur = { c: false, v: [[x, y]], i: [[0, 0]], o: [[0, 0]] };
    paths.push(cur);
    cx = x;
    cy = y;
    sx = x;
    sy = y;
  };

  const lineTo = (x: number, y: number): void => {
    if (!cur) startSubpath(cx, cy);
    if (!cur) return;
    cur.v.push([x, y]);
    cur.i.push([0, 0]);
    cur.o.push([0, 0]);
    cx = x;
    cy = y;
  };

  const cubicTo = (
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ): void => {
    if (!cur) startSubpath(cx, cy);
    if (!cur) return;
    const prevIdx = cur.v.length - 1;
    const prevV = cur.v[prevIdx];
    if (prevV) {
      cur.o[prevIdx] = [c1x - prevV[0], c1y - prevV[1]];
    }
    cur.v.push([x, y]);
    cur.i.push([c2x - x, c2y - y]);
    cur.o.push([0, 0]);
    lastCpx = c2x;
    lastCpy = c2y;
    cx = x;
    cy = y;
  };

  while (i < tokens.length) {
    let cmd = tokens[i];
    if (isCmd(cmd)) {
      i++;
    } else {
      cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;
    }
    if (!cmd) break;

    switch (cmd) {
      case 'M':
      case 'm': {
        const rel = cmd === 'm';
        const x = nextNum() + (rel ? cx : 0);
        const y = nextNum() + (rel ? cy : 0);
        startSubpath(x, y);
        while (i < tokens.length && !isCmd(tokens[i])) {
          const lx = nextNum() + (rel ? cx : 0);
          const ly = nextNum() + (rel ? cy : 0);
          lineTo(lx, ly);
        }
        break;
      }
      case 'L':
      case 'l': {
        const rel = cmd === 'l';
        while (i < tokens.length && !isCmd(tokens[i])) {
          lineTo(nextNum() + (rel ? cx : 0), nextNum() + (rel ? cy : 0));
        }
        break;
      }
      case 'H':
      case 'h': {
        const rel = cmd === 'h';
        while (i < tokens.length && !isCmd(tokens[i])) {
          lineTo(nextNum() + (rel ? cx : 0), cy);
        }
        break;
      }
      case 'V':
      case 'v': {
        const rel = cmd === 'v';
        while (i < tokens.length && !isCmd(tokens[i])) {
          lineTo(cx, nextNum() + (rel ? cy : 0));
        }
        break;
      }
      case 'C':
      case 'c': {
        const rel = cmd === 'c';
        while (i < tokens.length && !isCmd(tokens[i])) {
          const bx = rel ? cx : 0;
          const by = rel ? cy : 0;
          const c1x = nextNum() + bx;
          const c1y = nextNum() + by;
          const c2x = nextNum() + bx;
          const c2y = nextNum() + by;
          const x = nextNum() + bx;
          const y = nextNum() + by;
          cubicTo(c1x, c1y, c2x, c2y, x, y);
        }
        break;
      }
      case 'S':
      case 's': {
        const rel = cmd === 's';
        while (i < tokens.length && !isCmd(tokens[i])) {
          const bx = rel ? cx : 0;
          const by = rel ? cy : 0;
          const c1x = /[CcSs]/.test(lastCmd) ? 2 * cx - lastCpx : cx;
          const c1y = /[CcSs]/.test(lastCmd) ? 2 * cy - lastCpy : cy;
          const c2x = nextNum() + bx;
          const c2y = nextNum() + by;
          const x = nextNum() + bx;
          const y = nextNum() + by;
          cubicTo(c1x, c1y, c2x, c2y, x, y);
          lastCmd = cmd;
        }
        break;
      }
      case 'Q':
      case 'q': {
        const rel = cmd === 'q';
        while (i < tokens.length && !isCmd(tokens[i])) {
          const bx = rel ? cx : 0;
          const by = rel ? cy : 0;
          const qx = nextNum() + bx;
          const qy = nextNum() + by;
          const x = nextNum() + bx;
          const y = nextNum() + by;
          const c1x = cx + (2 / 3) * (qx - cx);
          const c1y = cy + (2 / 3) * (qy - cy);
          const c2x = x + (2 / 3) * (qx - x);
          const c2y = y + (2 / 3) * (qy - y);
          cubicTo(c1x, c1y, c2x, c2y, x, y);
          lastCpx = qx;
          lastCpy = qy;
          lastCmd = cmd;
        }
        break;
      }
      case 'T':
      case 't': {
        const rel = cmd === 't';
        while (i < tokens.length && !isCmd(tokens[i])) {
          const bx = rel ? cx : 0;
          const by = rel ? cy : 0;
          const qx = /[QqTt]/.test(lastCmd) ? 2 * cx - lastCpx : cx;
          const qy = /[QqTt]/.test(lastCmd) ? 2 * cy - lastCpy : cy;
          const x = nextNum() + bx;
          const y = nextNum() + by;
          const c1x = cx + (2 / 3) * (qx - cx);
          const c1y = cy + (2 / 3) * (qy - cy);
          const c2x = x + (2 / 3) * (qx - x);
          const c2y = y + (2 / 3) * (qy - y);
          cubicTo(c1x, c1y, c2x, c2y, x, y);
          lastCpx = qx;
          lastCpy = qy;
          lastCmd = cmd;
        }
        break;
      }
      case 'A':
      case 'a': {
        const rel = cmd === 'a';
        while (i < tokens.length && !isCmd(tokens[i])) {
          const rx = nextNum();
          const ry = nextNum();
          const rot = nextNum();
          const largeArc = nextNum();
          const sweep = nextNum();
          const x = nextNum() + (rel ? cx : 0);
          const y = nextNum() + (rel ? cy : 0);
          for (const seg of arcToCubicCurves(cx, cy, rx, ry, rot, largeArc, sweep, x, y)) {
            cubicTo(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5]);
          }
        }
        break;
      }
      case 'Z':
      case 'z': {
        const active = paths[paths.length - 1];
        if (active) {
          active.c = true;
          // Collapse duplicate closing vertex if identical to start vertex
          if (active.v.length > 1) {
            const first = active.v[0];
            const last = active.v[active.v.length - 1];
            if (first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-3) {
              const lastIn = active.i.pop();
              active.v.pop();
              active.o.pop();
              if (lastIn) active.i[0] = lastIn;
            }
          }
        }
        cx = sx;
        cy = sy;
        break;
      }
      default:
        break;
    }
    lastCmd = cmd;
  }

  return paths
    .filter((p) => p.v.length >= 2)
    .map((p) => ({
      c: p.c,
      v: p.v.map(([vx, vy]) => applyPoint(mat, vx, vy)),
      i: p.i.map(([ix, iy]) => applyVector(mat, ix, iy)),
      o: p.o.map(([ox, oy]) => applyVector(mat, ox, oy)),
    }));
}

function ellipseToPath(cx: number, cy: number, rx: number, ry: number, mat: Matrix2D): LottieBezierPath {
  const k = 0.5522847498;
  const kx = rx * k;
  const ky = ry * k;
  const rawV: [number, number][] = [
    [cx, cy - ry],
    [cx + rx, cy],
    [cx, cy + ry],
    [cx - rx, cy],
  ];
  const rawI: [number, number][] = [
    [-kx, 0],
    [0, -ky],
    [kx, 0],
    [0, ky],
  ];
  const rawO: [number, number][] = [
    [kx, 0],
    [0, ky],
    [-kx, 0],
    [0, -ky],
  ];
  return {
    c: true,
    v: rawV.map(([x, y]) => applyPoint(mat, x, y)),
    i: rawI.map(([x, y]) => applyVector(mat, x, y)),
    o: rawO.map(([x, y]) => applyVector(mat, x, y)),
  };
}

function rectToPath(
  x: number,
  y: number,
  w: number,
  h: number,
  rxIn: number,
  ryIn: number,
  mat: Matrix2D,
): LottieBezierPath {
  const rx = Math.min(w / 2, Math.max(0, rxIn));
  const ry = Math.min(h / 2, Math.max(0, ryIn));
  if (rx <= 0.01 && ry <= 0.01) {
    const pts: [number, number][] = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    return {
      c: true,
      v: pts.map(([px, py]) => applyPoint(mat, px, py)),
      i: pts.map(() => [0, 0]),
      o: pts.map(() => [0, 0]),
    };
  }
  const d = [
    `M ${x + rx} ${y}`,
    `H ${x + w - rx}`,
    `A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry}`,
    `V ${y + h - ry}`,
    `A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}`,
    `H ${x + rx}`,
    `A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`,
    `V ${y + ry}`,
    `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
    'Z',
  ].join(' ');
  const parsed = parsePathData(d, mat)[0];
  return parsed ?? { c: true, v: [], i: [], o: [] };
}

function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function expandBBoxByPath(box: BBox, path: LottieBezierPath): void {
  for (let idx = 0; idx < path.v.length; idx++) {
    const pt = path.v[idx];
    if (!pt) continue;
    box.minX = Math.min(box.minX, pt[0]);
    box.minY = Math.min(box.minY, pt[1]);
    box.maxX = Math.max(box.maxX, pt[0]);
    box.maxY = Math.max(box.maxY, pt[1]);
    const iv = path.i[idx];
    const ov = path.o[idx];
    if (iv) {
      box.minX = Math.min(box.minX, pt[0] + iv[0] * 0.5);
      box.minY = Math.min(box.minY, pt[1] + iv[1] * 0.5);
      box.maxX = Math.max(box.maxX, pt[0] + iv[0] * 0.5);
      box.maxY = Math.max(box.maxY, pt[1] + iv[1] * 0.5);
    }
    if (ov) {
      box.minX = Math.min(box.minX, pt[0] + ov[0] * 0.5);
      box.minY = Math.min(box.minY, pt[1] + ov[1] * 0.5);
      box.maxX = Math.max(box.maxX, pt[0] + ov[0] * 0.5);
      box.maxY = Math.max(box.maxY, pt[1] + ov[1] * 0.5);
    }
  }
}

function mergeStyle(parent: InheritedStyle, attrs: Record<string, string>): InheritedStyle {
  const capMap: Record<string, 1 | 2 | 3> = { butt: 1, round: 2, square: 3 };
  const joinMap: Record<string, 1 | 2 | 3> = { miter: 1, round: 2, bevel: 3 };
  const filterMatch = attrs.filter ? /url\(#([^)]+)\)/.exec(attrs.filter) : null;
  const dash = attrs['stroke-dasharray']
    ? attrs['stroke-dasharray']
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0)
    : parent.strokeDasharray;

  return {
    fill: attrs.fill ?? parent.fill,
    fillOpacity: attrs['fill-opacity'] !== undefined ? Number(attrs['fill-opacity']) : parent.fillOpacity,
    stroke: attrs.stroke ?? parent.stroke,
    strokeWidth: attrs['stroke-width'] !== undefined ? Number(attrs['stroke-width']) : parent.strokeWidth,
    strokeOpacity: attrs['stroke-opacity'] !== undefined ? Number(attrs['stroke-opacity']) : parent.strokeOpacity,
    strokeLinecap: (attrs['stroke-linecap'] ? capMap[attrs['stroke-linecap']] : undefined) ?? parent.strokeLinecap,
    strokeLinejoin: (attrs['stroke-linejoin'] ? joinMap[attrs['stroke-linejoin']] : undefined) ?? parent.strokeLinejoin,
    strokeDasharray: dash,
    opacity: parent.opacity * (attrs.opacity !== undefined ? Number(attrs.opacity) : 1),
    filterId: filterMatch?.[1] ?? parent.filterId,
  };
}

function makeDefaultShapeTransform(): LottieShapeTransform {
  return {
    ty: 'tr',
    nm: 'Transform',
    p: { a: 0, k: [0, 0] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
  };
}

function analyzeFilterNode(filterNode: XmlNode): { kinds: SvgFilterKind[]; bleedPx: number } {
  const kinds = new Set<SvgFilterKind>();
  let bleedPx = 12;

  const walk = (n: XmlNode): void => {
    if (n.tag === 'feGaussianBlur') {
      kinds.add('gaussianBlur');
      const sd = Number((n.attrs.stdDeviation ?? '4').split(/[\s,]+/)[0] ?? 4);
      bleedPx = Math.max(bleedPx, Math.ceil(sd * 3.5));
    } else if (n.tag === 'feDropShadow') {
      kinds.add('dropShadow');
      const sd = Number((n.attrs.stdDeviation ?? '4').split(/[\s,]+/)[0] ?? 4);
      const dx = Math.abs(Number(n.attrs.dx ?? 0));
      const dy = Math.abs(Number(n.attrs.dy ?? 0));
      bleedPx = Math.max(bleedPx, Math.ceil(sd * 3.5 + Math.max(dx, dy)));
    } else if (n.tag === 'feComposite' && n.attrs.operator === 'arithmetic') {
      kinds.add('innerShadow');
    } else if (n.tag === 'feMerge' || n.tag === 'feColorMatrix') {
      if (kinds.has('gaussianBlur')) kinds.add('glow');
    }
    for (const c of n.children) walk(c);
  };
  walk(filterNode);

  if (kinds.size === 0) kinds.add('custom');
  return { kinds: [...kinds], bleedPx };
}

function sanitizeLayerId(raw: string, fallback: string, used: Set<string>): string {
  const base = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n++}`;
  }
  used.add(candidate);
  return candidate;
}

export interface NormalizeSvgOptions {
  compWidth: number;
  compHeight: number;
  durationFrames: number;
  prefix?: string;
  startIndex?: number;
  offset?: [number, number];
  scale?: number;
}

/**
 * Normalizes an SVG via SVGO and converts its layers into structured Lottie shape layers
 * (`gr`, `sh`, `fl`, `st`, `tr`) with preserved IDs, explicit centered anchor points,
 * and extracted SVG filter metadata for the Filter-to-Raster export bridge.
 */
export function normalizeSvgToLottieLayers(
  rawSvg: string,
  opts: NormalizeSvgOptions,
): NormalizedSvgResult {
  const optimized = optimize(rawSvg, {
    multipass: true,
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            cleanupIds: false,
            collapseGroups: false,
            removeHiddenElems: false,
            removeUselessDefs: false,
            mergePaths: false,
            convertShapeToPath: false,
          },
        },
      },
    ],
  }).data;

  const root = parseXml(optimized);
  const vbRaw = (root.attrs.viewBox ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const vbWidth = vbRaw[2] || Number(root.attrs.width) || opts.compWidth;
  const vbHeight = vbRaw[3] || Number(root.attrs.height) || opts.compHeight;
  const viewBox = {
    x: vbRaw[0] || 0,
    y: vbRaw[1] || 0,
    width: vbWidth,
    height: vbHeight,
  };

  // Collect <defs>, <filter>, and <linearGradient>/<radialGradient> nodes
  const filterNodes = new Map<string, XmlNode>();
  const gradientNodes = new Map<string, XmlNode>();
  const defsFragments: string[] = [];
  const collectDefs = (node: XmlNode): void => {
    if (node.tag === 'defs') {
      defsFragments.push(node.raw);
    }
    if (node.tag === 'filter' && node.attrs.id) {
      filterNodes.set(node.attrs.id, node);
    }
    if ((node.tag === 'linearGradient' || node.tag === 'radialGradient') && node.attrs.id) {
      gradientNodes.set(node.attrs.id, node);
    }
    for (const c of node.children) collectDefs(c);
  };
  collectDefs(root);
  const defsXml = defsFragments.join('\n');

  function buildGradientFill(
    gradId: string,
    shapeBox: BBox,
    mat: Matrix2D,
    extraOpacity: number,
    fillRule: 1 | 2,
  ): LottieShapeGradientFill | null {
    const gNode = gradientNodes.get(gradId);
    if (!gNode) return null;
    const stops = gNode.children
      .filter((c) => c.tag === 'stop')
      .map((s) => {
        const rawOff = s.attrs.offset ?? '0';
        const off = rawOff.endsWith('%') ? Number(rawOff.slice(0, -1)) / 100 : Number(rawOff);
        const col = parseColor(s.attrs['stop-color'] ?? '#ffffff', Number(s.attrs['stop-opacity'] ?? 1));
        return {
          offset: Math.max(0, Math.min(1, Number.isFinite(off) ? off : 0)),
          rgba: col?.rgba ?? ([1, 1, 1, 1] as [number, number, number, number]),
          alpha: (col?.opacityPct ?? 100) / 100,
        };
      })
      .sort((a, b) => a.offset - b.offset);

    if (stops.length < 2) return null;

    const isRadial = gNode.tag === 'radialGradient';
    const userSpace = gNode.attrs.gradientUnits === 'userSpaceOnUse';
    const bx = Number.isFinite(shapeBox.minX) ? shapeBox.minX : 0;
    const by = Number.isFinite(shapeBox.minY) ? shapeBox.minY : 0;
    const bw = Number.isFinite(shapeBox.maxX) ? Math.max(1, shapeBox.maxX - bx) : opts.compWidth;
    const bh = Number.isFinite(shapeBox.maxY) ? Math.max(1, shapeBox.maxY - by) : opts.compHeight;

    const parseCoord = (raw: string | undefined, fallbackPct: number, origin: number, size: number): number => {
      if (!raw) return origin + fallbackPct * size;
      if (raw.endsWith('%')) return origin + (Number(raw.slice(0, -1)) / 100) * size;
      const n = Number(raw);
      return userSpace ? n : origin + n * size;
    };

    let sPt: [number, number];
    let ePt: [number, number];
    if (isRadial) {
      const cx = parseCoord(gNode.attrs.cx, 0.5, bx, bw);
      const cy = parseCoord(gNode.attrs.cy, 0.5, by, bh);
      const rad = parseCoord(gNode.attrs.r, 0.5, 0, Math.max(bw, bh));
      sPt = userSpace ? applyPoint(mat, cx, cy) : [round2(cx), round2(cy)];
      ePt = userSpace ? applyPoint(mat, cx + rad, cy) : [round2(cx + rad), round2(cy)];
    } else {
      const x1 = parseCoord(gNode.attrs.x1, 0, bx, bw);
      const y1 = parseCoord(gNode.attrs.y1, 0, by, bh);
      const x2 = parseCoord(gNode.attrs.x2, 1, bx, bw);
      const y2 = parseCoord(gNode.attrs.y2, 0, by, bh);
      sPt = userSpace ? applyPoint(mat, x1, y1) : [round2(x1), round2(y1)];
      ePt = userSpace ? applyPoint(mat, x2, y2) : [round2(x2), round2(y2)];
    }

    const colorData: number[] = [];
    const hasAlpha = stops.some((st) => st.alpha < 0.999);
    for (const st of stops) {
      colorData.push(round4(st.offset), st.rgba[0], st.rgba[1], st.rgba[2]);
    }
    if (hasAlpha) {
      for (const st of stops) {
        colorData.push(round4(st.offset), round4(st.alpha));
      }
    }

    return {
      ty: 'gf',
      nm: `Gradient ${gradId}`,
      o: { a: 0, k: round2(Math.max(0, Math.min(1, extraOpacity)) * 100) },
      r: fillRule,
      t: isRadial ? 2 : 1,
      s: { a: 0, k: sPt },
      e: { a: 0, k: ePt },
      g: { p: stops.length, k: { a: 0, k: colorData } },
    };
  }

  const userScale = opts.scale ?? 1;
  const [offX, offY] = opts.offset ?? [0, 0];
  const rootMatrix: Matrix2D = [
    userScale,
    0,
    0,
    userScale,
    offX - viewBox.x * userScale,
    offY - viewBox.y * userScale,
  ];

  const baseStyle: InheritedStyle = {
    fill: '#000000',
    fillOpacity: 1,
    stroke: 'none',
    strokeWidth: 1,
    strokeOpacity: 1,
    strokeLinecap: 2,
    strokeLinejoin: 2,
    opacity: 1,
  };

  const usedIds = new Set<string>();
  const layers: LottieShapeLayer[] = [];
  const filters: SvgFilterDescriptor[] = [];
  let indCounter = opts.startIndex ?? 1;

  function buildGeometryGroup(
    node: XmlNode,
    parentMat: Matrix2D,
    parentStyle: InheritedStyle,
    bbox: BBox,
    filterIdsFound: Set<string>,
  ): LottieShapeGroup | null {
    if (node.tag === 'defs' || node.tag === 'title' || node.tag === 'desc' || node.tag === 'metadata') {
      return null;
    }

    const mat = mulMatrix(parentMat, parseTransform(node.attrs.transform));
    const style = mergeStyle(parentStyle, node.attrs);
    if (style.filterId) filterIdsFound.add(style.filterId);

    if (node.tag === 'g') {
      const childItems: LottieShapeItem[] = [];
      for (const child of node.children) {
        const grp = buildGeometryGroup(child, mat, style, bbox, filterIdsFound);
        if (grp) childItems.push(grp);
      }
      if (childItems.length === 0) return null;
      // Lottie paints `it[]` from bottom to top (index 0 is front-most), opposite of SVG paint order
      childItems.reverse();
      childItems.push(makeDefaultShapeTransform());
      return {
        ty: 'gr',
        nm: node.attrs.id ?? node.attrs['data-name'] ?? 'Group',
        it: childItems,
      };
    }

    let paths: LottieBezierPath[] = [];
    if (node.tag === 'path' && node.attrs.d) {
      paths = parsePathData(node.attrs.d, mat);
    } else if (node.tag === 'rect') {
      const x = Number(node.attrs.x ?? 0);
      const y = Number(node.attrs.y ?? 0);
      const w = Number(node.attrs.width ?? 0);
      const h = Number(node.attrs.height ?? 0);
      const rx = Number(node.attrs.rx ?? node.attrs.ry ?? 0);
      const ry = Number(node.attrs.ry ?? node.attrs.rx ?? 0);
      if (w > 0 && h > 0) paths = [rectToPath(x, y, w, h, rx, ry, mat)];
    } else if (node.tag === 'circle') {
      const cx = Number(node.attrs.cx ?? 0);
      const cy = Number(node.attrs.cy ?? 0);
      const r = Number(node.attrs.r ?? 0);
      if (r > 0) paths = [ellipseToPath(cx, cy, r, r, mat)];
    } else if (node.tag === 'ellipse') {
      const cx = Number(node.attrs.cx ?? 0);
      const cy = Number(node.attrs.cy ?? 0);
      const rx = Number(node.attrs.rx ?? 0);
      const ry = Number(node.attrs.ry ?? 0);
      if (rx > 0 && ry > 0) paths = [ellipseToPath(cx, cy, rx, ry, mat)];
    } else if (node.tag === 'line') {
      const x1 = Number(node.attrs.x1 ?? 0);
      const y1 = Number(node.attrs.y1 ?? 0);
      const x2 = Number(node.attrs.x2 ?? 0);
      const y2 = Number(node.attrs.y2 ?? 0);
      paths = [
        {
          c: false,
          v: [applyPoint(mat, x1, y1), applyPoint(mat, x2, y2)],
          i: [[0, 0], [0, 0]],
          o: [[0, 0], [0, 0]],
        },
      ];
    } else if (node.tag === 'polygon' || node.tag === 'polyline') {
      const nums = (node.attrs.points ?? '')
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      const v: [number, number][] = [];
      for (let k = 0; k + 1 < nums.length; k += 2) {
        v.push(applyPoint(mat, nums[k] ?? 0, nums[k + 1] ?? 0));
      }
      if (v.length >= 2) {
        paths = [
          {
            c: node.tag === 'polygon',
            v,
            i: v.map(() => [0, 0]),
            o: v.map(() => [0, 0]),
          },
        ];
      }
    }

    if (paths.length === 0) return null;

    const leafBox = emptyBBox();
    const items: LottieShapeItem[] = [];
    for (let idx = 0; idx < paths.length; idx++) {
      const p = paths[idx];
      if (!p) continue;
      expandBBoxByPath(bbox, p);
      expandBBoxByPath(leafBox, p);
      const sh: LottieShapePath = {
        ty: 'sh',
        nm: `Path ${idx + 1}`,
        ks: { a: 0, k: p },
      };
      items.push(sh);
    }

    const strokeColor = parseColor(style.stroke, style.strokeOpacity * style.opacity);
    if (strokeColor && style.strokeWidth > 0) {
      const scaleFactor = Math.hypot(mat[0], mat[1]) || 1;
      const st: LottieShapeStroke = {
        ty: 'st',
        nm: 'Stroke',
        c: { a: 0, k: strokeColor.rgba },
        o: { a: 0, k: strokeColor.opacityPct },
        w: { a: 0, k: round2(style.strokeWidth * scaleFactor) },
        lc: style.strokeLinecap,
        lj: style.strokeLinejoin,
        ml: 4,
      };
      if (style.strokeDasharray && style.strokeDasharray.length > 0) {
        st.d = style.strokeDasharray.map((dVal, dIdx) => ({
          n: dIdx % 2 === 0 ? 'd' : 'g',
          nm: dIdx % 2 === 0 ? 'dash' : 'gap',
          v: { a: 0, k: round2(dVal * scaleFactor) },
        }));
      }
      items.push(st);
    }

    const fillRule: 1 | 2 = node.attrs['fill-rule'] === 'evenodd' ? 2 : 1;
    const gradMatch = style.fill ? /^url\(#([^)]+)\)$/.exec(style.fill.trim()) : null;
    const gradFill = gradMatch?.[1]
      ? buildGradientFill(gradMatch[1], leafBox, mat, style.fillOpacity * style.opacity, fillRule)
      : null;

    if (gradFill) {
      items.push(gradFill);
    } else {
      const fillColor = parseColor(style.fill, style.fillOpacity * style.opacity);
      if (fillColor) {
        const fl: LottieShapeFill = {
          ty: 'fl',
          nm: 'Fill',
          c: { a: 0, k: fillColor.rgba },
          o: { a: 0, k: fillColor.opacityPct },
          r: fillRule,
        };
        items.push(fl);
      }
    }

    items.push(makeDefaultShapeTransform());

    return {
      ty: 'gr',
      nm: node.attrs.id ?? node.attrs['data-name'] ?? node.tag,
      it: items,
    };
  }

  // Convert each top-level renderable SVG child into its own named Lottie Shape Layer
  // Lottie draws layers top-down (index 0 is front-most), while SVG paints bottom-up (last child is front-most).
  const topNodes = root.children.filter(
    (c) => c.tag !== 'defs' && c.tag !== 'title' && c.tag !== 'desc' && c.tag !== 'metadata',
  );

  // Build in SVG paint order first, then reverse so Lottie z-order matches SVG visually!
  const builtInSvgOrder: LottieShapeLayer[] = [];

  for (let idx = 0; idx < topNodes.length; idx++) {
    const node = topNodes[idx];
    if (!node) continue;
    const bbox = emptyBBox();
    const filterIdsFound = new Set<string>();
    const group = buildGeometryGroup(node, rootMatrix, baseStyle, bbox, filterIdsFound);
    if (!group) continue;

    const rawName = node.attrs.id ?? node.attrs['data-name'] ?? `${node.tag}-${idx + 1}`;
    const prefixed = opts.prefix ? `${opts.prefix}.${rawName}` : rawName;
    const layerId = sanitizeLayerId(prefixed, `layer-${idx + 1}`, usedIds);

    const hasBounds = Number.isFinite(bbox.minX) && Number.isFinite(bbox.maxX);
    const cx = hasBounds ? round2((bbox.minX + bbox.maxX) / 2) : round2(opts.compWidth / 2);
    const cy = hasBounds ? round2((bbox.minY + bbox.maxY) / 2) : round2(opts.compHeight / 2);
    const bw = hasBounds ? Math.max(1, round2(bbox.maxX - bbox.minX)) : opts.compWidth;
    const bh = hasBounds ? Math.max(1, round2(bbox.maxY - bbox.minY)) : opts.compHeight;

    const layer: LottieShapeLayer = {
      ddd: 0,
      ind: indCounter++,
      ty: 4,
      nm: rawName,
      ln: layerId,
      cl: `ms-layer ms-layer-${layerId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [cx, cy, 0] },
        a: { a: 0, k: [cx, cy, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0,
      shapes: [group],
      ip: 0,
      op: opts.durationFrames,
      st: 0,
      bm: 0,
    };

    builtInSvgOrder.push(layer);

    if (filterIdsFound.size > 0) {
      const kinds = new Set<SvgFilterKind>();
      let bleedPx = 12;
      const usedFiltersXml: string[] = [];
      for (const fid of filterIdsFound) {
        const fNode = filterNodes.get(fid);
        if (fNode) {
          const info = analyzeFilterNode(fNode);
          info.kinds.forEach((k) => kinds.add(k));
          bleedPx = Math.max(bleedPx, info.bleedPx);
          usedFiltersXml.push(fNode.raw);
        }
      }
      filters.push({
        id: [...filterIdsFound].join('+'),
        layerId,
        kinds: kinds.size > 0 ? [...kinds] : ['custom'],
        filterXml: usedFiltersXml.join('\n'),
        bleedPx: Math.ceil(bleedPx * userScale),
        sourceSvgFragment: `<g transform="translate(${offX - viewBox.x * userScale} ${offY - viewBox.y * userScale}) scale(${userScale})">${node.raw}</g>`,
        bounds: {
          x: hasBounds ? round2(bbox.minX) : 0,
          y: hasBounds ? round2(bbox.minY) : 0,
          width: bw,
          height: bh,
        },
      });
    }
  }

  // Reverse so top-most SVG element is Lottie layer 0
  layers.push(...builtInSvgOrder.reverse());

  return {
    viewBox,
    layers,
    filters,
    defsXml,
    optimizedSvg: optimized,
  };
}
