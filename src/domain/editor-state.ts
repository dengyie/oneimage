export interface Rect {
  x: number
  y: number
  width: number
  height: number
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
}

export interface EditorHistory {
  past: readonly EditorState[]
  present: EditorState
  future: readonly EditorState[]
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

export function pushHistory(history: EditorHistory, next: EditorState): EditorHistory {
  return { past: [...history.past, history.present], present: next, future: [] }
}

export function undoHistory(history: EditorHistory): EditorHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] }
}

export function redoHistory(history: EditorHistory): EditorHistory {
  const next = history.future[0]
  if (!next) return history
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) }
}

function assertDimension(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`)
}

function clampFinite(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('rectangle values must be finite')
  return Math.min(Math.max(value, minimum), maximum)
}
