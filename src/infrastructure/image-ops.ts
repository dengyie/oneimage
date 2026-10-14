// Pure image helpers shared by the main-thread processor and the worker. They
// touch no DOM APIs at module scope, so importing them from a Worker is safe.

export interface ImageGeometryOptions {
  width?: number
  cropWidth?: number
  cropHeight?: number
  rotation?: number
}

export interface ImageGeometry {
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  outputWidth: number
  outputHeight: number
  drawWidth: number
  drawHeight: number
  rotation: number
}

export const MIME_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
})

export function resolveOutputMime(toolId: string, inputMime: string, requestedMime?: string): string {
  if (toolId === 'metadata-clean') return 'image/png'
  if (toolId === 'compress') return requestedMime ?? 'image/webp'
  return requestedMime ?? inputMime
}

export function resolveGeometry(toolId: string, inputWidth: number, inputHeight: number, options: ImageGeometryOptions = {}): ImageGeometry {
  if (toolId === 'crop') {
    const sourceWidth = clampDimension(options.cropWidth ?? inputWidth, inputWidth)
    const sourceHeight = clampDimension(options.cropHeight ?? inputHeight, inputHeight)
    return { sourceX: Math.floor((inputWidth - sourceWidth) / 2), sourceY: Math.floor((inputHeight - sourceHeight) / 2), sourceWidth, sourceHeight, outputWidth: sourceWidth, outputHeight: sourceHeight, drawWidth: sourceWidth, drawHeight: sourceHeight, rotation: 0 }
  }
  if (toolId === 'resize') {
    const outputWidth = clampDimension(options.width ?? inputWidth, 8000)
    const outputHeight = Math.max(1, Math.round(inputHeight * outputWidth / inputWidth))
    return { sourceX: 0, sourceY: 0, sourceWidth: inputWidth, sourceHeight: inputHeight, outputWidth, outputHeight, drawWidth: outputWidth, drawHeight: outputHeight, rotation: 0 }
  }
  const rotation = normalizeRotation(options.rotation ?? 0)
  const outputWidth = rotation % 180 === 0 ? inputWidth : inputHeight
  const outputHeight = rotation % 180 === 0 ? inputHeight : inputWidth
  return { sourceX: 0, sourceY: 0, sourceWidth: inputWidth, sourceHeight: inputHeight, outputWidth, outputHeight, drawWidth: rotation % 180 === 0 ? outputWidth : outputHeight, drawHeight: rotation % 180 === 0 ? outputHeight : outputWidth, rotation }
}

export function drawWatermark(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number, text: string): void {
  context.save()
  context.font = `${Math.max(18, Math.round(width / 28))}px ui-sans-serif`
  context.textAlign = 'right'
  context.textBaseline = 'bottom'
  context.fillStyle = 'rgba(255,255,255,0.88)'
  context.shadowColor = 'rgba(0,0,0,0.45)'
  context.shadowBlur = 6
  context.fillText(text.slice(0, 80), width - 28, height - 24)
  context.restore()
}

export function stripExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '') || 'oneimage'
}

function clampDimension(value: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('image dimension must be finite')
  return Math.min(Math.max(1, Math.round(value)), maximum)
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value) || ![0, 90, 180, 270].includes(value)) throw new Error('rotation must be 0, 90, 180, or 270 degrees')
  return value
}