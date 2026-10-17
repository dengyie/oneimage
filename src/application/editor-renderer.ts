import { rotatedDimensions, type Adjustments, type EditorState, type LocalAdjustment, type Rect } from '../domain/editor-state'

export interface RenderCanvas {
  width: number
  height: number
  getContext(kind: '2d'): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>
  toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: number): void
}

export interface DecodedSource {
  width: number
  height: number
  draw(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): void
  close(): void
}

export interface CanvasFactory {
  create(width: number, height: number): RenderCanvas
}

export interface RenderedImage {
  canvas: RenderCanvas
  width: number
  height: number
}

export interface RenderOptions {
  maxEdge?: number
  signal?: AbortSignal
  showFullSource?: boolean
}

export function resolveRenderDimensions(sourceWidth: number, sourceHeight: number, maxEdge: number): { width: number; height: number } {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) throw new Error('source dimensions must be positive')
  if (maxEdge <= 0 || Number.isNaN(maxEdge)) throw new Error('max edge must be positive')
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) }
}

export function schedulePreview(task: () => Promise<void>, scheduler: PreviewScheduler = browserScheduler): () => void {
  let cancelled = false
  const frame = scheduler.request(async () => {
    if (!cancelled) await task()
  })
  return () => { cancelled = true; scheduler.cancel(frame) }
}

export function renderEditor(source: DecodedSource, state: EditorState, factory: CanvasFactory, maxEdgeOrOptions: number | RenderOptions = 1600, signal?: AbortSignal): RenderedImage {
  const options: RenderOptions = typeof maxEdgeOrOptions === 'number' ? { maxEdge: maxEdgeOrOptions, signal } : maxEdgeOrOptions
  const maxEdge = options.maxEdge ?? 1600
  signal = options.signal
  throwIfAborted(signal)
  const baseWidth = options.showFullSource ? state.sourceWidth : state.crop.width
  const baseHeight = options.showFullSource ? state.sourceHeight : state.crop.height
  const rotated = rotatedDimensions(baseWidth, baseHeight, state.rotation)
  const rotatedWidth = rotated.width
  const rotatedHeight = rotated.height
  const dimensions = resolveRenderDimensions(rotatedWidth, rotatedHeight, maxEdge)
  const canvas = factory.create(dimensions.width, dimensions.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('editor canvas unavailable')
  drawEditor(context, source, state, dimensions.width, dimensions.height, signal, options.showFullSource ?? false)
  return { canvas, ...dimensions }
}

export async function exportEditor(source: DecodedSource, state: EditorState, factory: CanvasFactory, mime: string, quality: number, signal?: AbortSignal): Promise<Blob> {
  const rendered = renderEditor(source, state, factory, Number.POSITIVE_INFINITY, signal)
  throwIfAborted(signal)
  if (rendered.canvas.convertToBlob) return rendered.canvas.convertToBlob({ type: mime, quality: clampQuality(quality) })
  if (!rendered.canvas.toBlob) throw new Error('editor canvas export unavailable')
  return new Promise((resolve, reject) => rendered.canvas.toBlob?.((blob) => blob ? resolve(blob) : reject(new Error('editor export failed')), mime, clampQuality(quality)))
}

export interface PreviewScheduler {
  request(task: FrameRequestCallback): number
  cancel(frame: number): void
}

const browserScheduler: PreviewScheduler = {
  request: (task) => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(task) : setTimeout(() => { void task(performance.now()) }, 0) as unknown as number,
  cancel: (frame) => typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(frame) : clearTimeout(frame),
}

function drawEditor(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: DecodedSource, state: EditorState, outputWidth: number, outputHeight: number, signal: AbortSignal | undefined, showFullSource: boolean): void {
  const baseWidth = showFullSource ? state.sourceWidth : state.crop.width
  const baseHeight = showFullSource ? state.sourceHeight : state.crop.height
  const rotated = rotatedDimensions(baseWidth, baseHeight, state.rotation)
  const scale = outputWidth / rotated.width
  drawSource(context, source, state, outputWidth, outputHeight, scale, state.adjustments, showFullSource)
  applySharpen(context, { x: 0, y: 0, width: outputWidth, height: outputHeight }, state.adjustments.sharpen)
  throwIfAborted(signal)
  for (const local of state.localAdjustments) {
    drawLocalAdjustment(context, source, state, local, outputWidth, outputHeight, scale, signal, showFullSource)
    applySharpen(context, toOutputRect(local.rect, state, outputWidth, outputHeight, scale, showFullSource), local.adjustments.sharpen)
  }
}

function drawLocalAdjustment(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: DecodedSource, state: EditorState, local: LocalAdjustment, outputWidth: number, outputHeight: number, scale: number, signal: AbortSignal | undefined, showFullSource: boolean): void {
  const rect = toOutputRect(local.rect, state, outputWidth, outputHeight, scale, showFullSource)
  context.save()
  context.beginPath()
  context.rect(rect.x, rect.y, rect.width, rect.height)
  context.clip()
  context.filter = cssFilter(local.adjustments)
  drawSource(context, source, state, outputWidth, outputHeight, scale, local.adjustments, showFullSource)
  context.restore()
  throwIfAborted(signal)
}

function drawSource(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: DecodedSource, state: EditorState, outputWidth: number, outputHeight: number, scale: number, adjustments: Adjustments, showFullSource: boolean): void {
  context.save()
  context.translate(outputWidth / 2, outputHeight / 2)
  context.rotate(state.rotation * Math.PI / 180)
  context.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1)
  context.filter = cssFilter(adjustments)
  const sourceWidth = showFullSource ? state.sourceWidth : state.crop.width
  const sourceHeight = showFullSource ? state.sourceHeight : state.crop.height
  context.translate(showFullSource ? 0 : -state.crop.x * scale, showFullSource ? 0 : -state.crop.y * scale)
  context.translate(-sourceWidth * scale / 2, -sourceHeight * scale / 2)
  source.draw(context, source.width * scale, source.height * scale)
  context.restore()
}

function toOutputRect(rect: Rect, state: EditorState, outputWidth: number, outputHeight: number, scale: number, showFullSource: boolean): Rect {
  const points = [
    transformPoint(rect.x, rect.y, state, outputWidth, outputHeight, scale, showFullSource),
    transformPoint(rect.x + rect.width, rect.y, state, outputWidth, outputHeight, scale, showFullSource),
    transformPoint(rect.x, rect.y + rect.height, state, outputWidth, outputHeight, scale, showFullSource),
    transformPoint(rect.x + rect.width, rect.y + rect.height, state, outputWidth, outputHeight, scale, showFullSource),
  ]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.max(0, Math.min(...xs))
  const y = Math.max(0, Math.min(...ys))
  return { x, y, width: Math.min(outputWidth - x, Math.max(...xs) - x), height: Math.min(outputHeight - y, Math.max(...ys) - y) }
}

function transformPoint(x: number, y: number, state: EditorState, outputWidth: number, outputHeight: number, scale: number, showFullSource: boolean): { x: number; y: number } {
  const baseWidth = showFullSource ? state.sourceWidth : state.crop.width
  const baseHeight = showFullSource ? state.sourceHeight : state.crop.height
  let px = (x - (showFullSource ? 0 : state.crop.x) - baseWidth / 2) * scale
  let py = (y - (showFullSource ? 0 : state.crop.y) - baseHeight / 2) * scale
  if (state.flipX) px = -px
  if (state.flipY) py = -py
  const radians = state.rotation * Math.PI / 180
  const rotatedX = px * Math.cos(radians) - py * Math.sin(radians)
  const rotatedY = px * Math.sin(radians) + py * Math.cos(radians)
  return { x: outputWidth / 2 + rotatedX, y: outputHeight / 2 + rotatedY }
}

function applySharpen(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rect: Rect, amount: number): void {
  if (amount <= 0 || !context.getImageData || !context.putImageData || rect.width < 2 || rect.height < 2) return
  const x = Math.floor(rect.x)
  const y = Math.floor(rect.y)
  const width = Math.min(context.canvas.width - x, Math.ceil(rect.width))
  const height = Math.min(context.canvas.height - y, Math.ceil(rect.height))
  if (x < 0 || y < 0 || width < 2 || height < 2) return
  const image = context.getImageData(x, y, width, height)
  const source = new Uint8ClampedArray(image.data)
  const strength = Math.min(1, amount / 100)
  for (let row = 1; row < height - 1; row += 1) for (let column = 1; column < width - 1; column += 1) {
    const index = (row * width + column) * 4
    for (let channel = 0; channel < 3; channel += 1) {
      const value = source[index + channel] * (1 + 4 * strength)
        - strength * (source[index - 4 + channel] + source[index + 4 + channel] + source[index - width * 4 + channel] + source[index + width * 4 + channel])
      image.data[index + channel] = Math.max(0, Math.min(255, value))
    }
  }
  context.putImageData(image, x, y)
}

function cssFilter(adjustments: Adjustments): string {
  return `brightness(${Math.max(0, 1 + adjustments.brightness / 100)}) contrast(${Math.max(0, 1 + adjustments.contrast / 100)}) saturate(${Math.max(0, 1 + adjustments.saturation / 100)}) blur(${Math.max(0, adjustments.blur)}px)`
}

function clampQuality(value: number): number { return Math.min(1, Math.max(0.1, Number.isFinite(value) ? value : 0.88)) }

function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('editor render cancelled', 'AbortError') }
