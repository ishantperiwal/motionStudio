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
  /**
   * 'auto' (default): match any poses with `matchPaths`. 'vertices': the poses are built with the same vertices in
   * the same order (a parametric shape), so vertex j blends with vertex j as it is. Use it when a pose's parts grow
   * from or shrink to nothing (a hole closing), where matching by arc length would slide points around the outline.
   */
  match?: 'auto' | 'vertices';
  /** which `sh` path inside the layer to morph (default 0; > 0 for hole contours in a compound shape) */
  pathIndex?: number;
}

// A small 3D model spinning about the vertical axis, compiled into native layers (`turntable.ts`). Model space:
// x right, y down, z toward the camera, in px, around `origin` on the stage. Paints are SVG fills: a colour or
// `url(#gradient)` from the SVG's <defs>, drawn at the part's home (the stage point origin + (0, part y)).
export type TurntablePaint = string;

export interface TurntableAngleStop {
  t: number;
  /** turn angle in degrees: 0 is the front view; growing angles swing the +x side toward the camera */
  deg: number;
  /** ease to the next stop (token or bezier); default linear */
  ease?: string | CubicBezierTuple;
}

/**
 * How a part's faces are lit: fully lit from facing ratio `full` (default: the turntable's `light`, 0.6) and fading
 * into their side colour toward edge-on. With `into` / `outOf` (lathe ends) the fade is keyed exactly with these
 * eases, into edge-on and out of it, instead of a fitted smoothstep.
 */
export interface TurntableLight {
  full?: number;
  into?: CubicBezierTuple;
  outOf?: CubicBezierTuple;
}

/** One end of a disc: a plain face (`paint`) or your own face-on artwork (`art`: SVG markup drawn at the home point), optionally with a recess. */
export interface TurntableDiscEnd {
  /** layer name for this end (default "outer" / "inner") */
  name?: string;
  paint?: TurntablePaint;
  art?: string;
  /** a round opening in the face: its inner wall and, `depth` deeper, its base slide against the opening as it turns */
  recess?: { radius: number; depth: number; wall: TurntablePaint; base: TurntablePaint };
}

/** One point along a lathe's profile: `[x, r]` or `{ x, r, in?, out? }` with relative cubic handles in (x, r) space. */
export type TurntableProfilePoint =
  | [number, number]
  | { x: number; r: number; in?: [number, number]; out?: [number, number] };

/**
 * A lathe: a surface of revolution spun about its local x axis — either a rounded-rim cylinder shorthand
 * (`radius`, `depth`, `rim`), or an arbitrary `profile` of `[x, r]` points (cone, cup, bottle, vase, beveled button),
 * with optional `innerProfile` for open vessels. `disc` is the same part.
 */
export interface TurntableDisc {
  type: 'disc' | 'lathe';
  name: string;
  /** centre in model px */
  center: [number, number, number];
  /** turns the part (degrees about model x, then y, then z) before the model turns: its axis is then rotation · x */
  rotation?: [number, number, number];
  /** cylinder shorthand: outer radius (omit when using `profile`) */
  radius?: number;
  /** cylinder shorthand: length along its axis (omit when using `profile`) */
  depth?: number;
  /** cylinder shorthand: rounded rim radius: the painted ends are this much smaller than the disc */
  rim?: number;
  /** general lathe outer profile along local x (from −x end to +x end, r >= 0) */
  profile?: TurntableProfilePoint[];
  /** optional inner cavity profile for open vessels (e.g. a cup): runs from inner floor to the open rim */
  innerProfile?: TurntableProfilePoint[];
  /** paint for the visible inner wall of an open vessel (defaults to `side`) */
  innerPaint?: TurntablePaint;
  /** optional paint for the inner floor of an open vessel (defaults to `innerPaint`) */
  innerBase?: TurntablePaint;
  /** the side wall, and the colour an end fades into as it turns edge-on */
  side: TurntablePaint;
  /** the end away from the turning axis (the +x end for a disc on the axis); for a lathe, prefer `ends` */
  outer?: TurntableDiscEnd;
  inner?: TurntableDiscEnd;
  /** its +x and −x ends (local axis), used before `outer` / `inner` */
  ends?: { pos?: TurntableDiscEnd; neg?: TurntableDiscEnd };
  /** paint layer: lower stacks always paint under higher ones; parts in one stack paint far to near (default 0) */
  stack?: number;
  /** optional 3D point in model px used for depth sorting instead of `center` (for attachments mounted off-centre on a tall face under camera tilt) */
  sortAnchor?: [number, number, number];
  light?: TurntableLight;
  /** morph poses (degrees, 0–90) to use instead of letting the kit choose them; 0°, 90° and any angle a notch shuts are always added */
  poses?: number[];
}

/**
 * Any closed SVG outline (non-symmetric and holes allowed) in the part's local x–y plane, extruded by `depth`
 * along its local z, at any centre, rotation, axis and tilt. `strip` is an alias for backwards compatibility.
 */
export interface TurntableExtrude {
  type: 'extrude' | 'strip';
  name: string;
  /** SVG path data in local x–y px: one outer closed contour, optionally followed by hole contours */
  outline: string;
  /** centre in model px (default [0, 0, z ?? 0]) */
  center?: [number, number, number];
  /** turns the part (degrees about model x, then y, then z) before the model turns */
  rotation?: [number, number, number];
  /** legacy alias for center: [0, 0, z] when `center` is omitted */
  z?: number;
  depth: number;
  /** the two flat faces (+z front, −z back, lit) */
  face: TurntablePaint;
  /** the thickness: the whole silhouette, under the faces */
  edge: TurntablePaint;
  /** the thickness lit as the faces turn away (side-on, its outer surface faces the camera) */
  edgeLit?: TurntablePaint;
  /** strongest edgeLit opacity (default 70) */
  edgeLitOpacity?: number;
  stack?: number;
  /** optional 3D point in model px used for depth sorting instead of `center` */
  sortAnchor?: [number, number, number];
  light?: TurntableLight;
  /** morph poses (degrees, 0–90) to use instead of letting the kit choose them (for upright symmetric strips) */
  poses?: number[];
}

export type TurntableStrip = TurntableExtrude;

/**
 * A convex polyhedron (pyramid, box, prism, gem): vertices and faces (vertex indices around each face, either way
 * round). Each face is one flat layer moved by an exact affine transform, hidden while it faces away and lit by
 * how much it faces the camera (its colour runs from `shade` edge-on to `paint` facing). Colours are #hex.
 */
export interface TurntablePoly {
  type: 'poly';
  name: string;
  center: [number, number, number];
  rotation?: [number, number, number];
  /** vertices in the part's own px, around its centre */
  vertices: Array<[number, number, number]>;
  faces: number[][];
  /** lit colour, one for all faces or one per face */
  paint: string | string[];
  /** colour edge-on, one for all faces or one per face */
  shade: string | string[];
  stack?: number;
  /** optional 3D point in model px used for depth sorting instead of `center` */
  sortAnchor?: [number, number, number];
  light?: TurntableLight;
}

/**
 * A sphere: always projects to a circle (scaled by perspective), with a world-space directional light that moves
 * a half-ellipse terminator (`shade`) and soft radial-gradient `highlight` across the surface as the model turns.
 * Surface art wrapped around a sphere is not supported in native Lottie.
 */
export interface TurntableSphere {
  type: 'sphere';
  name: string;
  center: [number, number, number];
  radius: number;
  /** lit hemisphere colour */
  paint: TurntablePaint;
  /** shaded hemisphere colour (the moving terminator crescent/gibbous layer) */
  shade: TurntablePaint;
  /** soft radial-gradient specular highlight colour (default '#FFFFFF'; set `false` to disable) */
  highlight?: string | false;
  /** peak highlight opacity 0–100 (default 55) */
  highlightOpacity?: number;
  /** optional per-sphere world-space light direction (overrides `spec.lightDir`) */
  lightDir?: [number, number, number];
  stack?: number;
  /** optional 3D point in model px used for depth sorting instead of `center` */
  sortAnchor?: [number, number, number];
}

export type TurntablePart = TurntableDisc | TurntableStrip | TurntablePoly | TurntableSphere;

export interface TurntableParams {
  kind: 'turntable';
  /** layer id prefix: layers are `<id>-…`, their shared null rig `<id>.rig` */
  id: string;
  /** stage point the turning axis passes through (model 0, 0, 0) */
  origin: [number, number];
  angle: TurntableAngleStop[];
  parts: TurntablePart[];
  /** the axis the model turns about, in model space (y down; default [0, -1, 0], up: the +x side swings toward the camera) */
  axis?: [number, number, number];
  /** camera tilt in degrees after the turn: positive looks down onto the top (default 0) */
  tilt?: number;
  /** perspective focal length in px: nearer parts draw larger, about their own centre. Omit for orthographic. */
  focal?: number;
  /** the null rig every layer hangs from (anchored at `origin`): an entrance, a bob */
  rig?: { position?: LottiePositionProp; scale?: LottieProp<number[]> };
  /** facing ratio at which a face is fully lit (default 0.6) */
  light?: number;
  /** world-space directional light vector for spheres (model space, y down, z toward camera; default [-0.55, -0.55, 0.63]) */
  lightDir?: [number, number, number];
  /** px a morph's in-between frames may stray from the true outline before it gets another pose (default 0.75) */
  tol?: number;
  ip?: number;
  op?: number;
}

export type MotionPrimitiveSpec =
  | SpringMoveParams
  | TrimStrokeParams
  | StaggeredEntranceParams
  | Faux3DFlipParams
  | SquashAndStretchParams
  | KeyframeTrackParams
  | ShapeMorphParams
  | TurntableParams;

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
  maxKeyframeDensityPerSec: number;
  antiBakePass: boolean;
  filterLayers: string[];
  jsonBytes: number;
  mobileReady: boolean;
  issues: HealthIssue[];
}

export interface RasterBakeOptions {
  /** Raster bake scale relative to stage coordinates (0.125..3; e.g. targetViewportPx / max(w, h)). Default: 2. */
  scale?: number;
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
