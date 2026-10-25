import { rotatedDimensions, type Adjustments, type AnnotationLayer, type EditorState, type LocalAdjustment, type Rect } from '../domain/editor-state'

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
  drawEditor(context, source, state, factory, dimensions.width, dimensions.height, signal, options.showFullSource ?? false)
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

function drawEditor(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: DecodedSource, state: EditorState, factory: CanvasFactory, outputWidth: number, outputHeight: number, signal: AbortSignal | undefined, showFullSource: boolean): void {
  const baseWidth = showFullSource ? state.sourceWidth : state.crop.width
  const baseHeight = showFullSource ? state.sourceHeight : state.crop.height
  const rotated = rotatedDimensions(baseWidth, baseHeight, state.rotation)
  const scale = outputWidth / rotated.width
  drawSource(context, source, state, outputWidth, outputHeight, scale, state.adjustments, showFullSource)
  applySharpen(context, { x: 0, y: 0, width: outputWidth, height: outputHeight }, state.adjustments.sharpen)
  throwIfAborted(signal)
  if (state.localAdjustments.length > 0) {
    const layer = factory.create(outputWidth, outputHeight)
    const layerContext = layer.getContext('2d')
    if (!layerContext) throw new Error('editor layer unavailable')
    for (const local of state.localAdjustments) {
      layerContext.clearRect(0, 0, outputWidth, outputHeight)
      layerContext.drawImage(context.canvas, 0, 0)
      drawLocalAdjustment(context, layer, state, local, outputWidth, outputHeight, scale, signal, showFullSource)
      applySharpen(context, toOutputRect(local.rect, state, outputWidth, outputHeight, scale, showFullSource), local.adjustments.sharpen)
      if (local.mosaicBlockSize) applyMosaic(context, factory, local, state, outputWidth, outputHeight, scale, showFullSource)
    }
  }
  if (state.annotations && state.annotations.length > 0) {
    drawAnnotations(context, state, factory, outputWidth, outputHeight, scale, showFullSource)
  }
}

function drawLocalAdjustment(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: RenderCanvas, state: EditorState, local: LocalAdjustment, outputWidth: number, outputHeight: number, scale: number, signal: AbortSignal | undefined, showFullSource: boolean): void {
  context.save()
  context.beginPath()
  traceTransformedRect(context, local.rect, state, outputWidth, outputHeight, scale, showFullSource)
  context.clip()
  context.filter = cssFilter(local.adjustments)
  context.drawImage(layer as unknown as CanvasImageSource, 0, 0)
  context.restore()
  throwIfAborted(signal)
}

function applyMosaic(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, factory: CanvasFactory, local: LocalAdjustment, state: EditorState, outputWidth: number, outputHeight: number, scale: number, showFullSource: boolean): void {
  const rect = toOutputRect(local.rect, state, outputWidth, outputHeight, scale, showFullSource)
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const width = Math.min(outputWidth - x, Math.ceil(rect.x + rect.width) - x)
  const height = Math.min(outputHeight - y, Math.ceil(rect.y + rect.height) - y)
  if (width < 1 || height < 1) return
  const requestedBlockSize = Number.isFinite(local.mosaicBlockSize) ? local.mosaicBlockSize! : 12
  const blockSize = Math.max(2, Math.min(128, Math.round(requestedBlockSize * scale)))
  const mosaicWidth = Math.max(1, Math.ceil(width / blockSize))
  const mosaicHeight = Math.max(1, Math.ceil(height / blockSize))
  const mosaic = factory.create(mosaicWidth, mosaicHeight)
  const mosaicContext = mosaic.getContext('2d')
  if (!mosaicContext) throw new Error('mosaic canvas unavailable')
  mosaicContext.imageSmoothingEnabled = true
  mosaicContext.drawImage(context.canvas, x, y, width, height, 0, 0, mosaicWidth, mosaicHeight)
  context.save()
  context.beginPath()
  traceTransformedRect(context, local.rect, state, outputWidth, outputHeight, scale, showFullSource)
  context.clip()
  context.imageSmoothingEnabled = false
  context.drawImage(mosaic as unknown as CanvasImageSource, x, y, width, height)
  context.restore()
}

function traceTransformedRect(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rect: Rect, state: EditorState, outputWidth: number, outputHeight: number, scale: number, showFullSource: boolean): void {
  const points = transformedRectPoints(rect, state, outputWidth, outputHeight, scale, showFullSource)
  for (const index of [0, 1, 3, 2]) {
    const point = points[index]
    if (index === 0) context.moveTo(point.x, point.y)
    else context.lineTo(point.x, point.y)
  }
  context.closePath()
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
  const points = transformedRectPoints(rect, state, outputWidth, outputHeight, scale, showFullSource)
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.max(0, Math.min(...xs))
  const y = Math.max(0, Math.min(...ys))
  return { x, y, width: Math.min(outputWidth - x, Math.max(...xs) - x), height: Math.min(outputHeight - y, Math.max(...ys) - y) }
}

function transformedRectPoints(rect: Rect, state: EditorState, outputWidth: number, outputHeight: number, scale: number, showFullSource: boolean): Array<{ x: number; y: number }> {
  return [
    transformPoint(rect.x, rect.y, state, outputWidth, outputHeight, scale, showFullSource),
    transformPoint(rect.x + rect.width, rect.y, state, outputWidth, outputHeight, scale, showFullSource),
    transformPoint(rect.x, rect.y + rect.height, state, outputWidth, outputHeight, scale, showFullSource),
    transformPoint(rect.x + rect.width, rect.y + rect.height, state, outputWidth, outputHeight, scale, showFullSource),
  ]
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

function drawAnnotations(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  state: EditorState,
  factory: CanvasFactory,
  outputWidth: number,
  outputHeight: number,
  scale: number,
  showFullSource: boolean,
): void {
  if (!state.annotations) return
  for (const layer of state.annotations) {
    context.save?.()
    try {
      if (layer.type === 'brush' || layer.type === 'highlighter') {
        if (!layer.points || layer.points.length === 0) continue
        const strokeWidth = Math.max(1, (layer.strokeWidth || 4) * scale)
        if (layer.type === 'highlighter') {
          context.globalAlpha = layer.opacity ?? 0.4
          context.lineWidth = Math.max(8, strokeWidth * 2.5)
          context.lineCap = 'square'
        } else {
          context.globalAlpha = layer.opacity ?? 1.0
          context.lineWidth = strokeWidth
          context.lineCap = 'round'
          context.lineJoin = 'round'
        }
        context.strokeStyle = layer.color || '#ef4444'
        context.fillStyle = layer.color || '#ef4444'

        const pts = layer.points.map((p) =>
          transformPoint(p.x, p.y, state, outputWidth, outputHeight, scale, showFullSource)
        )

        if (pts.length === 1) {
          context.beginPath?.()
          context.arc?.(pts[0].x, pts[0].y, context.lineWidth / 2, 0, Math.PI * 2)
          context.fill?.()
        } else {
          context.beginPath?.()
          context.moveTo?.(pts[0].x, pts[0].y)
          for (let i = 1; i < pts.length - 1; i++) {
            const midX = (pts[i].x + pts[i + 1].x) / 2
            const midY = (pts[i].y + pts[i + 1].y) / 2
            context.quadraticCurveTo?.(pts[i].x, pts[i].y, midX, midY)
          }
          context.lineTo?.(pts[pts.length - 1].x, pts[pts.length - 1].y)
          context.stroke?.()
        }
      } else if (layer.type === 'arrow') {
        if (!layer.points || layer.points.length < 2) continue
        const p0 = transformPoint(layer.points[0].x, layer.points[0].y, state, outputWidth, outputHeight, scale, showFullSource)
        const p1 = transformPoint(layer.points[layer.points.length - 1].x, layer.points[layer.points.length - 1].y, state, outputWidth, outputHeight, scale, showFullSource)
        const strokeWidth = Math.max(2, (layer.strokeWidth || 4) * scale)
        const headLen = Math.max(14, strokeWidth * 3.5)
        const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x)

        const tipX = p1.x
        const tipY = p1.y
        const barbAngle = Math.PI / 6
        const leftX = tipX - headLen * Math.cos(angle - barbAngle)
        const leftY = tipY - headLen * Math.sin(angle - barbAngle)
        const rightX = tipX - headLen * Math.cos(angle + barbAngle)
        const rightY = tipY - headLen * Math.sin(angle + barbAngle)
        const indentX = tipX - headLen * 0.7 * Math.cos(angle)
        const indentY = tipY - headLen * 0.7 * Math.sin(angle)

        context.strokeStyle = layer.color || '#ef4444'
        context.lineWidth = strokeWidth
        context.lineCap = 'round'
        context.beginPath?.()
        context.moveTo?.(p0.x, p0.y)
        context.lineTo?.(indentX, indentY)
        context.stroke?.()

        context.fillStyle = layer.color || '#ef4444'
        context.beginPath?.()
        context.moveTo?.(tipX, tipY)
        context.lineTo?.(leftX, leftY)
        context.lineTo?.(indentX, indentY)
        context.lineTo?.(rightX, rightY)
        context.closePath?.()
        context.fill?.()
      } else if (layer.type === 'rect') {
        if (!layer.rect) continue
        context.strokeStyle = layer.color || '#ef4444'
        context.lineWidth = Math.max(1, (layer.strokeWidth || 4) * scale)
        context.beginPath?.()
        traceTransformedRect(context, layer.rect, state, outputWidth, outputHeight, scale, showFullSource)
        context.stroke?.()
      } else if (layer.type === 'ellipse') {
        if (!layer.rect) continue
        context.strokeStyle = layer.color || '#ef4444'
        context.lineWidth = Math.max(1, (layer.strokeWidth || 4) * scale)
        const center = transformPoint(layer.rect.x + layer.rect.width / 2, layer.rect.y + layer.rect.height / 2, state, outputWidth, outputHeight, scale, showFullSource)
        const rx = Math.max(1, (layer.rect.width / 2) * scale)
        const ry = Math.max(1, (layer.rect.height / 2) * scale)
        context.beginPath?.()
        context.ellipse?.(center.x, center.y, rx, ry, (state.rotation * Math.PI) / 180, 0, Math.PI * 2)
        context.stroke?.()
      } else if (layer.type === 'mosaic') {
        if (!layer.rect) continue
        const dummyLocal: LocalAdjustment = {
          id: layer.id,
          rect: layer.rect,
          adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpen: 0, blur: layer.mosaicType === 'blur' ? 12 : 0 },
          mosaicBlockSize: layer.mosaicType === 'blur' ? undefined : (layer.mosaicBlockSize || 16),
        }
        if (dummyLocal.mosaicBlockSize) {
          applyMosaic(context, factory, dummyLocal, state, outputWidth, outputHeight, scale, showFullSource)
        } else {
          const blurLayer = factory.create(outputWidth, outputHeight)
          const blurCtx = blurLayer.getContext('2d')
          if (blurCtx) {
            blurCtx.drawImage?.(context.canvas as never, 0, 0)
            context.save?.()
            context.beginPath?.()
            traceTransformedRect(context, layer.rect, state, outputWidth, outputHeight, scale, showFullSource)
            context.clip?.()
            context.filter = 'blur(12px)'
            context.drawImage?.(blurLayer as never, 0, 0)
            context.restore?.()
          }
        }
      } else if (layer.type === 'text') {
        if (!layer.text) continue
        const text = layer.text
        const fontSize = Math.max(12, Math.round((layer.fontSize || 24) * scale))
        const pos = layer.rect
          ? transformPoint(layer.rect.x, layer.rect.y + layer.rect.height, state, outputWidth, outputHeight, scale, showFullSource)
          : { x: outputWidth / 2, y: outputHeight / 2 }

        context.save?.()
        context.translate?.(pos.x, pos.y)
        if (state.rotation !== 0) {
          context.rotate?.((state.rotation * Math.PI) / 180)
        }

        context.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
        const textMetrics = context.measureText ? context.measureText(text) : { width: fontSize * text.length * 0.6 }
        const textW = textMetrics.width
        const textH = fontSize * 1.2
        const padding = Math.max(4, Math.round(fontSize * 0.25))

        if (layer.textBgStyle === 'solid') {
          context.fillStyle = layer.color || '#ef4444'
          const bgX = -padding
          const bgY = -textH + padding
          const bgW = textW + padding * 2
          const bgH = textH + padding
          const radius = Math.min(6, padding)
          drawRoundedRect(context, bgX, bgY, bgW, bgH, radius)
          context.fill?.()
          context.fillStyle = isLightColor(layer.color || '#ef4444') ? '#000000' : '#ffffff'
        } else if (layer.textBgStyle === 'translucent') {
          context.fillStyle = 'rgba(18, 18, 20, 0.75)'
          const bgX = -padding
          const bgY = -textH + padding
          const bgW = textW + padding * 2
          const bgH = textH + padding
          const radius = Math.min(6, padding)
          drawRoundedRect(context, bgX, bgY, bgW, bgH, radius)
          context.fill?.()
          context.fillStyle = layer.color || '#ffffff'
        } else {
          context.shadowColor = 'rgba(0,0,0,0.8)'
          context.shadowBlur = Math.max(2, 4 * scale)
          context.fillStyle = layer.color || '#ef4444'
        }

        context.textBaseline = 'bottom'
        context.fillText?.(text, 0, 0)
        context.restore?.()
      }
    } finally {
      context.restore?.()
    }
  }
}

function drawRoundedRect(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  context.beginPath?.()
  context.moveTo?.(x + r, y)
  context.lineTo?.(x + w - r, y)
  context.quadraticCurveTo?.(x + w, y, x + w, y + r)
  context.lineTo?.(x + w, y + h - r)
  context.quadraticCurveTo?.(x + w, y + h, x + w - r, y + h)
  context.lineTo?.(x + r, y + h)
  context.quadraticCurveTo?.(x, y + h, x, y + h - r)
  context.lineTo?.(x, y + r)
  context.quadraticCurveTo?.(x, y, x + r, y)
  context.closePath?.()
}

function isLightColor(hexOrColor: string): boolean {
  if (hexOrColor.startsWith('#') && hexOrColor.length >= 7) {
    const r = parseInt(hexOrColor.slice(1, 3), 16)
    const g = parseInt(hexOrColor.slice(3, 5), 16)
    const b = parseInt(hexOrColor.slice(5, 7), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 160
  }
  return false
}
