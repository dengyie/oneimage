export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export type AnnotationType = 'brush' | 'highlighter' | 'arrow' | 'rect' | 'ellipse' | 'mosaic' | 'text' | 'watermark' | 'erase-ai'
export type TextBgStyle = 'none' | 'translucent' | 'solid'
export type WatermarkStyle = 'tile' | 'corner'

export interface AnnotationLayer {
  id: string
  type: AnnotationType
  points?: Point[]               // for brush, highlighter, arrow
  rect?: Rect                    // for rect, ellipse, mosaic, text bounding
  color: string                  // hex or rgba
  strokeWidth: number            // 2, 4, 8, etc.
  opacity?: number               // e.g. 0.4 for highlighter, 0.2 for watermark
  text?: string                  // for text and watermark annotations
  fontSize?: number
  textBgStyle?: TextBgStyle
  mosaicType?: 'pixel' | 'blur'  // for mosaic tool
  mosaicBlockSize?: number       // 8, 16, 24
  watermarkStyle?: WatermarkStyle // 'tile' | 'corner'
}

export interface Adjustments {
  brightness: number
  contrast: number
  saturation: number
  sharpen: number
  blur: number
}

export interface LocalAdjustment {
  id: string
  rect: Rect
  adjustments: Adjustments
  mosaicBlockSize?: number
}

export interface EditorState {
  sourceWidth: number
  sourceHeight: number
  crop: Rect
  aspectRatio: number | null
  rotation: number
  flipX: boolean
  flipY: boolean
  adjustments: Adjustments
  localAdjustments: LocalAdjustment[]
  annotations?: readonly AnnotationLayer[]
}

export interface HistoryTree<T> {
  past: readonly T[]
  present: T
  future: readonly T[]
}

export const DEFAULT_ADJUSTMENTS: Adjustments = Object.freeze({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpen: 0,
  blur: 0,
})

export function createEditorState(sourceWidth: number, sourceHeight: number): EditorState {
  assertDimension(sourceWidth, 'source width')
  assertDimension(sourceHeight, 'source height')
  return {
    sourceWidth,
    sourceHeight,
    crop: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
    aspectRatio: null,
    rotation: 0,
    flipX: false,
    flipY: false,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    localAdjustments: [],
    annotations: [],
  }
}

export function clampCrop(rect: Rect, bounds: Rect, aspectRatio: number | null = null): Rect {
  assertDimension(bounds.width, 'bounds width')
  assertDimension(bounds.height, 'bounds height')
  let width = clampFinite(rect.width, 1, bounds.width)
  let height = clampFinite(rect.height, 1, bounds.height)
  if (aspectRatio !== null) {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) throw new Error('aspect ratio must be positive')
    if (width / height > aspectRatio) width = height * aspectRatio
    else height = width / aspectRatio
    if (width > bounds.width) { width = bounds.width; height = width / aspectRatio }
    if (height > bounds.height) { height = bounds.height; width = height * aspectRatio }
  }
  width = clampFinite(width, 1, bounds.width)
  height = clampFinite(height, 1, bounds.height)
  const x = clampFinite(rect.x, 0, bounds.width - width)
  const y = clampFinite(rect.y, 0, bounds.height - height)
  return { x, y, width, height }
}

export function rotateEditorState(state: EditorState, quarterTurns: number): EditorState {
  if (!Number.isInteger(quarterTurns)) throw new Error('quarter turns must be an integer')
  const turns = ((quarterTurns % 4) + 4) % 4
  if (turns === 0) return state
  return {
    ...state,
    rotation: (state.rotation + turns * 90) % 360,
  }
}

export function normalizeAspectRatio(value: string): number | null {
  if (value === 'free') return null
  const [width, height] = value.split(':').map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('aspect ratio must be positive')
  return width / height
}

/**
 * The crop toolbar's ratio pills. The id doubles as the value
 * `normalizeAspectRatio` parses, and `aspectRatioId` maps a stored ratio back
 * to its pill, so the selected pill is derived from the editor state instead of
 * being mirrored in component state that undo cannot restore.
 */
export const ASPECT_RATIO_PRESETS = [
  { id: 'free', label: '自由', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
] as const satisfies ReadonlyArray<{ id: string; label: string; ratio: number | null }>

export function aspectRatioId(ratio: number | null): string {
  if (ratio === null) return 'free'
  const match = ASPECT_RATIO_PRESETS.find(
    (preset) => preset.ratio !== null && Math.abs(preset.ratio - ratio) < 1e-9
  )
  return match?.id ?? 'free'
}

export function rotatedDimensions(width: number, height: number, rotation: number): { width: number; height: number } {
  assertDimension(width, 'width')
  assertDimension(height, 'height')
  if (!Number.isFinite(rotation)) throw new Error('rotation must be finite')
  const radians = ((rotation % 360) + 360) % 360 * Math.PI / 180
  return {
    width: roundDimension(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))),
    height: roundDimension(Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))),
  }
}

function roundDimension(value: number): number { return Math.max(1, Math.ceil(value - 1e-9)) }

function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function adjustmentsEqual(a: Adjustments, b: Adjustments): boolean {
  return (
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.saturation === b.saturation &&
    a.sharpen === b.sharpen &&
    a.blur === b.blur
  )
}

/**
 * Cheap structural comparison used to skip no-op history entries. Annotation
 * layers are immutable, so the arrays only need an element-wise identity check.
 */
export function editorStatesEqual(a: EditorState, b: EditorState): boolean {
  if (a === b) return true
  if (a.sourceWidth !== b.sourceWidth || a.sourceHeight !== b.sourceHeight) return false
  if (a.rotation !== b.rotation || a.flipX !== b.flipX || a.flipY !== b.flipY) return false
  if (a.aspectRatio !== b.aspectRatio || !rectsEqual(a.crop, b.crop)) return false
  if (!adjustmentsEqual(a.adjustments, b.adjustments)) return false
  if (a.localAdjustments.length !== b.localAdjustments.length) return false
  for (let i = 0; i < a.localAdjustments.length; i++) {
    const left = a.localAdjustments[i]
    const right = b.localAdjustments[i]
    if (left === right) continue
    if (!rectsEqual(left.rect, right.rect)) return false
    if (!adjustmentsEqual(left.adjustments, right.adjustments)) return false
    if (left.mosaicBlockSize !== right.mosaicBlockSize) return false
  }
  const annotationsA = a.annotations ?? []
  const annotationsB = b.annotations ?? []
  if (annotationsA.length !== annotationsB.length) return false
  for (let i = 0; i < annotationsA.length; i++) {
    // A layer that changed is always a new object; identity is enough here.
    if (annotationsA[i] !== annotationsB[i]) return false
  }
  return true
}

// Pointer events fire far faster than a stroke's rendered width can express;
// points closer than minDistancePx (in source image space) are visually
// redundant and would only bloat persisted editor state and cloud payloads.
export function isStrokePointRedundant(last: Point | undefined, next: Point, minDistancePx = 1): boolean {
  if (!last) return false
  const dx = next.x - last.x
  const dy = next.y - last.y
  return dx * dx + dy * dy < minDistancePx * minDistancePx
}

function assertDimension(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`)
}

function clampFinite(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('rectangle values must be finite')
  return Math.min(Math.max(value, minimum), maximum)
}
