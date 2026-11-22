import { relottie } from '@lottiefiles/relottie';
import type {
  ArrayNode,
  ArrayNodeValue,
  Attribute,
  Collection,
  Element,
  KeyValue,
  ObjectNode,
  ObjectNodeValue,
  Primitive,
  PrimitiveValue,
  Root,
} from '@lottiefiles/last';
import type {
  HealthIssue,
  LayerAstPatch,
  LottieDocument,
  LottieKeyframe,
  LottieLayer,
  LottiePositionProp,
  LottieProp,
  LottieHealthReport,
} from './types.js';

const processor = relottie();

export function parseLottieToLast(input: string | LottieDocument): Root {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  return processor.parse(raw);
}

export function stringifyLastToLottie(ast: Root): string {
  return processor.stringify(ast);
}

export function roundTripThroughRelottie(doc: LottieDocument): { ast: Root; json: string; doc: LottieDocument } {
  const ast = parseLottieToLast(doc);
  const json = stringifyLastToLottie(ast);
  const parsed = JSON.parse(json) as LottieDocument;
  return { ast, json, doc: parsed };
}

function keyName(k: KeyValue): string {
  return typeof k === 'string' ? k : k.value;
}

function findMember(obj: { children: ObjectNodeValue[] }, key: string): ObjectNodeValue | undefined {
  return obj.children.find((child) => keyName(child.key) === key);
}

function getPrimitive(obj: { children: ObjectNodeValue[] }, key: string): PrimitiveValue | undefined {
  const m = findMember(obj, key);
  if (m && m.type === 'attribute' && m.children[0]) {
    return m.children[0].value;
  }
  return undefined;
}

function jsValueToLastMember(key: string, value: unknown): ObjectNodeValue {
  const keyNode = { type: 'key' as const, value: key };
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const prim: Primitive = {
      type: 'primitive',
      value: value as PrimitiveValue,
      valueType: value === null ? 'null' : (typeof value as 'string' | 'number' | 'boolean'),
    };
    const attr: Attribute = {
      type: 'attribute',
      title: 'custom',
      key: keyNode,
      children: [prim],
    };
    return attr;
  }
  if (Array.isArray(value)) {
    const arrNode: ArrayNode = {
      type: 'array',
      title: 'custom',
      children: value.map((item) => jsValueToLastArrayItem(item)),
    };
    const col: Collection = {
      type: 'collection',
      title: 'custom',
      key: keyNode,
      children: [arrNode],
    };
    return col;
  }
  const objNode: ObjectNode = {
    type: 'object',
    title: 'custom',
    children: Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => jsValueToLastMember(k, v)),
  };
  const elem: Element = {
    type: 'element',
    title: 'custom',
    key: keyNode,
    children: [objNode],
  };
  return elem;
}

function jsValueToLastArrayItem(value: unknown): ArrayNodeValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return {
      type: 'primitive',
      value: value as PrimitiveValue,
      valueType: value === null ? 'null' : (typeof value as 'string' | 'number' | 'boolean'),
    };
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      title: 'custom',
      children: value.map((item) => jsValueToLastArrayItem(item)),
    };
  }
  return {
    type: 'object',
    title: 'custom',
    children: Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => jsValueToLastMember(k, v)),
  };
}

function upsertMember(obj: ObjectNode, key: string, value: unknown): void {
  const next = jsValueToLastMember(key, value);
  const idx = obj.children.findIndex((child) => keyName(child.key) === key);
  if (idx >= 0) {
    obj.children[idx] = next;
  } else {
    obj.children.push(next);
  }
}

/**
 * Surgically patches a single layer inside a Lottie document using the
 * `@lottiefiles/relottie` LAST AST without regenerating unaffected layers.
 */
export function patchLayerInLast(
  doc: LottieDocument,
  patch: LayerAstPatch,
): { doc: LottieDocument; ast: Root; patchedLayerName: string } {
  const ast = parseLottieToLast(doc);
  const layersCol = findMember(ast, 'layers');
  if (!layersCol || layersCol.type !== 'collection' || !layersCol.children[0]) {
    throw new Error('Lottie AST has no layers collection');
  }

  const layerNodes = layersCol.children[0].children.filter(
    (node): node is ObjectNode => node.type === 'object',
  );

  const target = layerNodes.find((layer) => {
    const ln = getPrimitive(layer, 'ln');
    const nm = getPrimitive(layer, 'nm');
    const ind = getPrimitive(layer, 'ind');
    return (
      ln === patch.layerId ||
      nm === patch.layerId ||
      String(ind) === patch.layerId
    );
  });

  if (!target) {
    throw new Error(`Layer "${patch.layerId}" not found in Lottie LAST AST`);
  }

  let ksEl = findMember(target, 'ks');
  if (!ksEl || ksEl.type !== 'element' || !ksEl.children[0]) {
    const freshKs: ObjectNode = { type: 'object', title: 'custom', children: [] };
    ksEl = {
      type: 'element',
      title: 'custom',
      key: { type: 'key', value: 'ks' },
      children: [freshKs],
    };
    target.children.push(ksEl);
  }
  const ksObj = ksEl.children[0];
  if (!ksObj) {
    throw new Error(`Layer "${patch.layerId}" has empty ks transform node`);
  }

  if (patch.anchor !== undefined) {
    upsertMember(ksObj, 'a', { a: 0, k: [patch.anchor[0], patch.anchor[1], 0] });
  }
  if (patch.position !== undefined) {
    upsertMember(ksObj, 'p', patch.position);
  }
  if (patch.scale !== undefined) {
    upsertMember(ksObj, 's', patch.scale);
  }
  if (patch.rotation !== undefined) {
    upsertMember(ksObj, 'r', patch.rotation);
  }
  if (patch.opacity !== undefined) {
    upsertMember(ksObj, 'o', patch.opacity);
  }
  if (patch.ip !== undefined) upsertMember(target, 'ip', patch.ip);
  if (patch.op !== undefined) upsertMember(target, 'op', patch.op);
  if (patch.tt !== undefined) upsertMember(target, 'tt', patch.tt);
  if (patch.td !== undefined) upsertMember(target, 'td', patch.td);
  if (patch.parent !== undefined) upsertMember(target, 'parent', patch.parent);
  if (patch.hd !== undefined) upsertMember(target, 'hd', patch.hd);
  if (patch.name !== undefined) upsertMember(target, 'nm', patch.name);

  const json = stringifyLastToLottie(ast);
  const patchedDoc = JSON.parse(json) as LottieDocument;
  const patchedLayerName = String(getPrimitive(target, 'nm') ?? patch.layerId);
  return { doc: patchedDoc, ast, patchedLayerName };
}

function collectPropTracks(prop: LottieProp<unknown> | LottiePositionProp | undefined): LottieKeyframe<unknown>[][] {
  if (!prop) return [];
  if ('s' in prop && prop.s === true) {
    return [...collectPropTracks(prop.x), ...collectPropTracks(prop.y)];
  }
  if ('a' in prop && prop.a === 1 && Array.isArray(prop.k)) {
    return [prop.k as LottieKeyframe<unknown>[]];
  }
  return [];
}

function collectLayerTracks(layer: LottieLayer): LottieKeyframe<unknown>[][] {
  const tracks: LottieKeyframe<unknown>[][] = [
    ...collectPropTracks(layer.ks.a),
    ...collectPropTracks(layer.ks.p),
    ...collectPropTracks(layer.ks.s),
    ...collectPropTracks(layer.ks.r),
    ...collectPropTracks(layer.ks.o),
    ...collectPropTracks(layer.ks.sk),
    ...collectPropTracks(layer.ks.sa),
  ];

  if (layer.ty === 4) {
    const walkShapes = (items: unknown[]): void => {
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        if (item.ty === 'gr' && Array.isArray(item.it)) {
          walkShapes(item.it);
        } else if (item.ty === 'tm') {
          tracks.push(
            ...collectPropTracks(item.s as LottieProp<number> | undefined),
            ...collectPropTracks(item.e as LottieProp<number> | undefined),
            ...collectPropTracks(item.o as LottieProp<number> | undefined),
          );
        } else if (item.ty === 'tr') {
          tracks.push(
            ...collectPropTracks(item.p as LottieProp<number[]> | undefined),
            ...collectPropTracks(item.s as LottieProp<number[]> | undefined),
            ...collectPropTracks(item.r as LottieProp<number> | undefined),
            ...collectPropTracks(item.o as LottieProp<number> | undefined),
          );
        }
      }
    };
    walkShapes(layer.shapes);
  }
  return tracks;
}

const MAX_KEYFRAMES_PER_SEC = 8;
const MAX_NON_HOLD_PER_1S_WINDOW = 10;

export function measureTrackDensity(kfs: LottieKeyframe<unknown>[], fps: number): {
  count: number;
  kfPerSec: number;
  maxInWindow: number;
  dense: boolean;
} {
  const count = kfs.length;
  if (count <= 1) return { count, kfPerSec: 0, maxInWindow: count, dense: false };
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  const spanS = Math.max(1 / fps, (sorted[sorted.length - 1]!.t - sorted[0]!.t) / fps);
  const kfPerSec = (count - 1) / spanS;

  // Peak non-hold keyframes inside any 1-second sliding window (ignores intentional hold snaps)
  const nonHoldTimes = sorted.filter((kf) => kf.h !== 1).map((kf) => kf.t);
  let maxInWindow = 0;
  let left = 0;
  for (let right = 0; right < nonHoldTimes.length; right++) {
    while (nonHoldTimes[right]! - nonHoldTimes[left]! > fps) left++;
    const win = right - left + 1;
    if (win > maxInWindow) maxInWindow = win;
  }

  // Tracks with <= 10 keyframes always pass; longer tracks are checked by density so clean multi-act layers pass.
  const dense = count > 10 && (kfPerSec > MAX_KEYFRAMES_PER_SEC || maxInWindow > MAX_NON_HOLD_PER_1S_WINDOW);
  return { count, kfPerSec, maxInWindow, dense };
}

export function extractLayerKeyframesAtFrame(
  layer: LottieLayer,
  frame: number,
): Record<string, unknown> {
  const summarize = (prop: LottieProp<unknown> | LottiePositionProp | undefined): unknown => {
    if (!prop) return undefined;
    if ('s' in prop && prop.s === true) {
      return { separated: true, x: summarize(prop.x), y: summarize(prop.y) };
    }
    if ('a' in prop && prop.a === 0) {
      return { animated: false, value: prop.k };
    }
    if ('a' in prop && prop.a === 1 && Array.isArray(prop.k)) {
      const kfs = prop.k as LottieKeyframe<unknown>[];
      const activeIdx = kfs.findIndex((kf, idx) => {
        const next = kfs[idx + 1];
        return next ? frame >= kf.t && frame <= next.t : frame >= kf.t;
      });
      return {
        animated: true,
        count: kfs.length,
        activeSegment: activeIdx >= 0 ? kfs.slice(activeIdx, activeIdx + 2) : kfs.slice(-1),
        keyframes: kfs,
      };
    }
    return undefined;
  };

  return {
    ind: layer.ind,
    id: layer.ln ?? layer.nm,
    name: layer.nm,
    type: layer.ty,
    ip: layer.ip,
    op: layer.op,
    tt: layer.tt ?? 0,
    td: layer.td ?? 0,
    parent: layer.parent,
    anchor: summarize(layer.ks.a),
    position: summarize(layer.ks.p),
    scale: summarize(layer.ks.s),
    rotation: summarize(layer.ks.r),
    opacity: summarize(layer.ks.o),
  };
}

/**
 * Inspects a Lottie document via relottie LAST AST for:
 * - Anti-Bake compliance (flags baked tracks with > 10 keyframes AND density > 8 kf/s or > 10 non-hold kf in any 1s window)
 * - Cross-platform iOS/Android parity (expressions, unsupported blend modes, SVG filters pending raster bake)
 */
export function inspectLottieHealth(
  doc: LottieDocument,
  filterLayerIds: string[] = [],
): LottieHealthReport {
  const { ast, json } = roundTripThroughRelottie(doc);
  const issues: HealthIssue[] = [];
  const fps = Math.max(1, doc.fr || 60);

  if (ast.hasExpressions) {
    issues.push({
      severity: 'error',
      code: 'EXPRESSIONS_UNSUPPORTED',
      message: 'Lottie contains JS expressions which are unsupported on lottie-ios and lottie-android.',
    });
  }

  let totalKeyframes = 0;
  let maxKeyframesPerTrack = 0;
  let maxKeyframeDensityPerSec = 0;
  let hasAntiBakeViolation = false;

  for (const layer of doc.layers) {
    const id = layer.ln ?? layer.nm;
    const tracks = collectLayerTracks(layer);
    for (const track of tracks) {
      const m = measureTrackDensity(track, fps);
      totalKeyframes += m.count;
      if (m.count > maxKeyframesPerTrack) maxKeyframesPerTrack = m.count;
      if (m.count > 10 && m.kfPerSec > maxKeyframeDensityPerSec) {
        maxKeyframeDensityPerSec = m.kfPerSec;
      }
      if (m.dense) {
        hasAntiBakeViolation = true;
        issues.push({
          severity: 'warning',
          code: 'ANTI_BAKE_VIOLATION',
          layerId: id,
          message: `Layer "${id}" has a baked keyframe track (${m.count} kf · ${m.kfPerSec.toFixed(1)} kf/s · peak ${m.maxInWindow}/s). Use fewer parametric keyframes with cubic-bezier tangents.`,
        });
      }
    }

    if (layer.bm && layer.bm !== 0) {
      issues.push({
        severity: 'warning',
        code: 'BLEND_MODE_PARITY',
        layerId: id,
        message: `Layer "${id}" uses blend mode ${layer.bm}; verify parity on lottie-ios CoreAnimation.`,
      });
    }
  }

  for (const fl of filterLayerIds) {
    issues.push({
      severity: 'info',
      code: 'SVG_FILTER_PENDING_BAKE',
      layerId: fl,
      message: `Layer "${fl}" uses SVG filter primitives in live preview and will be auto-rasterized into .lottie on export.`,
    });
  }

  const antiBakePass = !hasAntiBakeViolation;
  const mobileReady = !issues.some((i) => i.severity === 'error');

  return {
    layerCount: doc.layers.length,
    totalKeyframes,
    maxKeyframesPerTrack,
    maxKeyframeDensityPerSec: Math.round(maxKeyframeDensityPerSec * 100) / 100,
    antiBakePass,
    filterLayers: [...filterLayerIds],
    jsonBytes: Buffer.byteLength(json, 'utf8'),
    mobileReady,
    issues,
  };
}
