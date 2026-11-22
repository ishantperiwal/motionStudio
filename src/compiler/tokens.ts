import fs from 'node:fs';
import path from 'node:path';
import type { CubicBezierTuple, MotionTokens, SpringToken } from './types.js';

export const DEFAULT_TOKENS: MotionTokens = {
  ease: {
    move: [0.45, 0, 0.2, 1],
    intro: [0.1, 0.1, 0.2, 1],
    settle: [0.16, 1, 0.3, 1],
    fade: [0.25, 0.1, 0.25, 1],
    snap: [0.2, 0, 0, 1],
    exit: [0.5, 0, 0.85, 0.4],
    overshoot: [0.34, 1.56, 0.64, 1],
    anticipate: [0.36, -0.4, 0.5, 1],
    elastic: [0.68, -0.55, 0.27, 1.55],
    linear: [0, 0, 1, 1],
    whip: [0.7, 0, 0.15, 1],
  },
  dur: {
    instant: 4,
    quick: 8,
    short: 14,
    medium: 24,
    long: 36,
  },
  durationScaleMs: {
    instant: 120,
    quick: 220,
    short: 360,
    medium: 520,
    long: 800,
  },
  springs: {
    snappy: { stiffness: 420, damping: 28, mass: 1 },
    bouncy: { stiffness: 300, damping: 16, mass: 1 },
    gentle: { stiffness: 180, damping: 24, mass: 1 },
    stiff: { stiffness: 580, damping: 38, mass: 1 },
    playful: { stiffness: 260, damping: 13, mass: 1 },
  },
  overshootLimit: 0.18,
};

export function loadMotionTokens(tokensPath?: string, studioRoot?: string): MotionTokens {
  const candidates = [
    tokensPath,
    studioRoot ? path.join(studioRoot, 'tokens', 'motion.json') : undefined,
    path.resolve(process.cwd(), 'tokens', 'motion.json'),
  ].filter((p): p is string => Boolean(p));

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<MotionTokens>;
      return mergeTokens(DEFAULT_TOKENS, raw);
    }
  }
  return structuredClone(DEFAULT_TOKENS);
}

export function mergeTokens(base: MotionTokens, override?: Partial<MotionTokens>): MotionTokens {
  if (!override) return structuredClone(base);
  return {
    ease: { ...base.ease, ...(override.ease ?? {}) },
    dur: { ...base.dur, ...(override.dur ?? {}) },
    durationScaleMs: { ...(base.durationScaleMs ?? {}), ...(override.durationScaleMs ?? {}) },
    springs: { ...(base.springs ?? {}), ...(override.springs ?? {}) },
    overshootLimit: override.overshootLimit ?? base.overshootLimit ?? 0.18,
  };
}

export function resolveEaseToken(
  spec: string | CubicBezierTuple | undefined,
  tokens: MotionTokens,
  fallback: string = 'settle',
): CubicBezierTuple {
  if (Array.isArray(spec) && spec.length === 4) {
    return clampBezierX(spec);
  }
  const key = typeof spec === 'string' ? spec : fallback;
  const found = tokens.ease[key] ?? DEFAULT_TOKENS.ease[key] ?? DEFAULT_TOKENS.ease.settle;
  return clampBezierX(found ?? [0.16, 1, 0.3, 1]);
}

export function clampBezierX(curve: CubicBezierTuple): CubicBezierTuple {
  const clamp01 = (n: number): number => Math.max(0, Math.min(1, round4(n)));
  return [clamp01(curve[0]), round4(curve[1]), clamp01(curve[2]), round4(curve[3])];
}

export function resolveDurationFrames(
  duration: number | string | undefined,
  fps: number,
  tokens: MotionTokens,
  fallbackFrames: number = 24,
): number {
  if (typeof duration === 'number' && Number.isFinite(duration)) {
    return Math.max(1, Math.round(duration));
  }
  if (typeof duration === 'string') {
    const ms = tokens.durationScaleMs?.[duration] ?? DEFAULT_TOKENS.durationScaleMs?.[duration];
    if (typeof ms === 'number') {
      return Math.max(1, Math.round((ms / 1000) * fps));
    }
    const base25 = tokens.dur[duration] ?? DEFAULT_TOKENS.dur[duration];
    if (typeof base25 === 'number') {
      return Math.max(1, Math.round((base25 / 25) * fps));
    }
  }
  return Math.max(1, Math.round(fallbackFrames));
}

export function resolveSpringToken(
  spec: string | SpringToken | undefined,
  tokens: MotionTokens,
  fallback: string = 'snappy',
): Required<SpringToken> {
  if (spec && typeof spec === 'object') {
    return {
      stiffness: Math.max(1, spec.stiffness),
      damping: Math.max(0.5, spec.damping),
      mass: Math.max(0.05, spec.mass ?? 1),
    };
  }
  const key = typeof spec === 'string' ? spec : fallback;
  const preset =
    tokens.springs?.[key] ??
    DEFAULT_TOKENS.springs?.[key] ??
    { stiffness: 420, damping: 28, mass: 1 };
  return {
    stiffness: preset.stiffness,
    damping: preset.damping,
    mass: preset.mass ?? 1,
  };
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
