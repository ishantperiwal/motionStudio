export type CubicBezierTuple = [number, number, number, number];

export interface SpringToken {
  stiffness: number;
  damping: number;
  mass?: number;
}

export interface MotionTokens {
  ease: Record<string, CubicBezierTuple>;
  dur: Record<string, number>;
  durationScaleMs?: Record<string, number>;
  springs?: Record<string, SpringToken>;
  overshootLimit?: number;
}

// ---------------------------------------------------------------------------
// Lottie 1.0 / Bodymovin Schema (strict subset for production iOS/Android/Web)
// ---------------------------------------------------------------------------

export interface LottieTangent {
  x: number | number[];
  y: number | number[];
}

export interface LottieKeyframe<T = number[]> {
  t: number;
  s: T;
  e?: T;
  o?: LottieTangent;
  i?: LottieTangent;
  h?: 0 | 1;
  to?: number[];
  ti?: number[];
}

export interface LottieStaticProp<T> {
  a: 0;
  k: T;
  ix?: number;
}

export interface LottieAnimatedProp<T> {
  a: 1;
  k: LottieKeyframe<T>[];
  ix?: number;
}

export type LottieProp<T> = LottieStaticProp<T> | LottieAnimatedProp<T>;

export interface LottieSeparatedPosition {
  s: true;
  x: LottieProp<number>;
  y: LottieProp<number>;
}

export type LottiePositionProp = LottieProp<number[]> | LottieSeparatedPosition;

export interface LottieTransform {
  a?: LottieProp<number[]>;
  p?: LottiePositionProp;
  s?: LottieProp<number[]>;
  r?: LottieProp<number>;
  o?: LottieProp<number>;
  sk?: LottieProp<number>;
  sa?: LottieProp<number>;
}

export interface LottieBezierPath {
  c: boolean;
  v: [number, number][];
  i: [number, number][];
  o: [number, number][];
}

export interface LottieShapeItemBase {
  ty: string;
  nm?: string;
  mn?: string;
  hd?: boolean;
}

export interface LottieShapePath extends LottieShapeItemBase {
  ty: 'sh';
  ind?: number;
  ks: LottieProp<LottieBezierPath>;
}

export interface LottieShapeRect extends LottieShapeItemBase {
  ty: 'rc';
  d?: 1 | 3;
  p: LottieProp<[number, number]>;
  s: LottieProp<[number, number]>;
  r: LottieProp<number>;
}

export interface LottieShapeEllipse extends LottieShapeItemBase {
  ty: 'el';
  d?: 1 | 3;
  p: LottieProp<[number, number]>;
  s: LottieProp<[number, number]>;
}

export interface LottieShapeFill extends LottieShapeItemBase {
  ty: 'fl';
  c: LottieProp<[number, number, number, number]>;
  o: LottieProp<number>;
  r?: 1 | 2;
}

export interface LottieShapeGradientFill extends LottieShapeItemBase {
  ty: 'gf';
  o: LottieProp<number>;
  r?: 1 | 2;
  t: 1 | 2; // 1 = linear, 2 = radial
  s: LottieProp<[number, number]>;
  e: LottieProp<[number, number]>;
  g: {
    p: number;
    k: LottieProp<number[]>;
  };
}

export interface LottieShapeStroke extends LottieShapeItemBase {
  ty: 'st';
  c: LottieProp<[number, number, number, number]>;
  o: LottieProp<number>;
  w: LottieProp<number>;
  lc?: 1 | 2 | 3;
  lj?: 1 | 2 | 3;
  ml?: number;
  d?: Array<{ n: 'd' | 'g' | 'o'; nm?: string; v: LottieProp<number> }>;
}

export interface LottieShapeTrim extends LottieShapeItemBase {
  ty: 'tm';
  s: LottieProp<number>;
  e: LottieProp<number>;
  o: LottieProp<number>;
  m?: 1 | 2;
}

export interface LottieShapeTransform extends LottieShapeItemBase {
  ty: 'tr';
  p: LottieProp<[number, number]>;
  a: LottieProp<[number, number]>;
  s: LottieProp<[number, number]>;
  r: LottieProp<number>;
  o: LottieProp<number>;
  sk?: LottieProp<number>;
  sa?: LottieProp<number>;
}

export interface LottieShapeGroup extends LottieShapeItemBase {
  ty: 'gr';
  it: LottieShapeItem[];
  np?: number;
  cix?: number;
  bm?: number;
}

export type LottieShapeItem =
  | LottieShapeGroup
  | LottieShapePath
  | LottieShapeRect
  | LottieShapeEllipse
  | LottieShapeFill
  | LottieShapeGradientFill
  | LottieShapeStroke
  | LottieShapeTrim
  | LottieShapeTransform;

export interface LottieLayerBase {
  ddd: 0;
  ind: number;
  ty: number;
  nm: string;
  ln?: string;
  cl?: string;
  sr: number;
  ks: LottieTransform;
  ao: 0 | 1;
  ip: number;
  op: number;
  st: number;
  bm: number;
  parent?: number;
  tt?: 0 | 1 | 2 | 3 | 4;
  td?: 0 | 1;
  hd?: boolean;
}

export interface LottieShapeLayer extends LottieLayerBase {
  ty: 4;
  shapes: LottieShapeItem[];
}

export interface LottieImageLayer extends LottieLayerBase {
  ty: 2;
  refId: string;
}

export interface LottieNullLayer extends LottieLayerBase {
  ty: 3;
}

export interface LottieSolidLayer extends LottieLayerBase {
  ty: 1;
  sc: string;
  sh: number;
  sw: number;
}

export type LottieLayer =
  | LottieShapeLayer
  | LottieImageLayer
  | LottieNullLayer
  | LottieSolidLayer;

export interface LottieImageAsset {
  id: string;
  w: number;
  h: number;
  u: string;
  p: string;
  e: 0 | 1;
}

export type LottieAsset = LottieImageAsset;

export interface LottieDocument {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: LottieAsset[];
  layers: LottieLayer[];
  markers?: Array<{ tm: number; cm: string; dr: number }>;
}

// ---------------------------------------------------------------------------
// SVG Filter & Composition Metadata (Bridge for Live Preview -> Raster Export)
// ---------------------------------------------------------------------------

export type SvgFilterKind = 'gaussianBlur' | 'dropShadow' | 'glow' | 'innerShadow' | 'custom';

export interface SvgFilterDescriptor {
  id: string;
  layerId: string;
  kinds: SvgFilterKind[];
  filterXml: string;
  bleedPx: number;
  sourceSvgFragment: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface NormalizedSvgResult {
  viewBox: { x: number; y: number; width: number; height: number };
  layers: LottieShapeLayer[];
  filters: SvgFilterDescriptor[];
  defsXml: string;
  optimizedSvg: string;
}

// ---------------------------------------------------------------------------
// Parametric Motion Primitive Specifications
// ---------------------------------------------------------------------------

export interface SpringMoveParams {
  kind: 'springMove';
  layerId: string;
  from?: [number, number];
  to: [number, number];
  delta?: [number, number];
  startFrame?: number;
  spring?: string | SpringToken;
  overshootLimit?: number;
}

export interface TrimStrokeParams {
  kind: 'trimStroke';
  layerId: string;
  startFrame?: number;
  duration?: number | string;
  ease?: string | CubicBezierTuple;
  fromStart?: number;
  toStart?: number;
  fromEnd?: number;
  toEnd?: number;
  offset?: [number, number];
  mode?: 1 | 2;
}

export interface StaggeredEntranceParams {
  kind: 'staggeredEntrance';
  layerIds: string[];
  startFrame?: number;
  staggerFrames?: number;
  duration?: number | string;
  ease?: string | CubicBezierTuple;
  spring?: string | SpringToken;
  offset?: [number, number];
  fromScale?: number;
  fromOpacity?: number;
}

export interface Faux3DFlipParams {
  kind: 'faux3DFlip';
  frontLayerId: string;
  backLayerId: string;
  edgeLayerId?: string;
  rimLayerId?: string;
  shadowLayerId?: string;
  glowLayerId?: string;
  axis?: 'y' | 'x';
  turns?: number;
  startFrame?: number;
  duration?: number | string;
  ease?: string | CubicBezierTuple;
  thicknessPx?: number;
  edgeThicknessScale?: number;
  liftPx?: number;
  tiltDeg?: number;
  perspectiveSkew?: number;
}

export interface SquashAndStretchParams {
  kind: 'squashAndStretch';
  layerId: string;
  startFrame?: number;
  duration?: number | string;
  intensity?: number;
  axis?: 'y' | 'x';
  ease?: string | CubicBezierTuple;
}

export interface KeyframeTrackParams {
  kind: 'keyframeTrack';
  layerId: string;
  property: 'position' | 'positionX' | 'positionY' | 'scale' | 'rotation' | 'opacity';
  keyframes: LottieKeyframe<number[] | number>[];
}

// A pose of a morphing shape: one closed path, any vertex count (shapeMorph matches them exactly, as
// lottie-ios / lottie-android only morph between matching paths); `colors` are the layer's gradient stops
// [pos, r, g, b, ...] (0–1).
export interface ShapeMorphStop {
  t: number;
  path: LottieBezierPath;
  colors?: number[];
  ease?: string | CubicBezierTuple;
  hold?: boolean;
}

export interface ShapeMorphParams {
  kind: 'shapeMorph';
  layerId: string;
  stops: ShapeMorphStop[];
  /** vertices per pose after matching (default 96: enough that points spread evenly over every pose) */
  points?: number;
}

export type MotionPrimitiveSpec =
  | SpringMoveParams
  | TrimStrokeParams
  | StaggeredEntranceParams
  | Faux3DFlipParams
  | SquashAndStretchParams
  | KeyframeTrackParams
  | ShapeMorphParams;

// ---------------------------------------------------------------------------
// Curve Distillation
// ---------------------------------------------------------------------------

export interface RawPointerSample {
  t: number; // ms or seconds (monotonic)
  x: number;
  y?: number;
}

export interface DistilledSegment {
  t0: number;
  t1: number;
  v0: number;
  v1: number;
  bezier: CubicBezierTuple;
}

export interface DistilledCurveResult {
  dimension: '1d' | '2d';
  keyframeCount: number;
  durationMs: number;
  durationFrames: number;
  keyframes: LottieKeyframe<number[]>[];
  xKeyframes?: LottieKeyframe<number>[];
  yKeyframes?: LottieKeyframe<number>[];
  segments: DistilledSegment[];
  rmsError: number;
  maxError: number;
  primaryBezier: CubicBezierTuple;
}

// ---------------------------------------------------------------------------
// Surgical LAST AST Patching
// ---------------------------------------------------------------------------

export interface LayerAstPatch {
  layerId: string;
  anchor?: [number, number];
  position?: LottiePositionProp;
  scale?: LottieProp<number[]>;
  rotation?: LottieProp<number>;
  opacity?: LottieProp<number>;
  ip?: number;
  op?: number;
  tt?: 0 | 1 | 2 | 3 | 4;
  td?: 0 | 1;
  parent?: number;
  hd?: boolean;
  name?: string;
}

// ---------------------------------------------------------------------------
// Composition Spec on Disk (scenes/<id>/comp.json)
// ---------------------------------------------------------------------------

export interface ImportedAssetRecord {
  id: string;
  sourceFile: string;
  prefix?: string;
  layerIds: string[];
  filters: SvgFilterDescriptor[];
  defsXml: string;
  offset?: [number, number];
  scale?: number;
}

export interface CompositionSpec {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  background?: string;
  tokensPath?: string;
  tokens: MotionTokens;
  assets: ImportedAssetRecord[];
  primitives: MotionPrimitiveSpec[];
  patches: LayerAstPatch[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Health & Export Reports
// ---------------------------------------------------------------------------

export interface HealthIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  layerId?: string;
  message: string;
}

export interface LottieHealthReport {
  layerCount: number;
  totalKeyframes: number;
  maxKeyframesPerTrack: number;
  antiBakePass: boolean;
  filterLayers: string[];
  jsonBytes: number;
  mobileReady: boolean;
  issues: HealthIssue[];
}

export interface RasterBakeOptions {
  scale?: 1 | 2 | 3;
  format?: 'png' | 'webp';
  quality?: number;
  cacheDir?: string;
}

export interface ExportResult {
  sceneId: string;
  jsonPath: string;
  dotLottiePath: string;
  jsonBytes: number;
  dotLottieBytes: number;
  bakedLayers: Array<{ layerId: string; assetId: string; width: number; height: number; bytes: number; format: 'png' | 'webp' }>;
  health: LottieHealthReport;
}
