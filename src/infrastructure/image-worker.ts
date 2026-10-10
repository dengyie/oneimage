import type { LocalToolOptions } from './browser-image-processor'

self.onmessage = async (event: MessageEvent<{ toolId: string; file: File; options: LocalToolOptions }>) => {
  try {
    const { toolId, file, options } = event.data
    const bitmap = await createImageBitmap(file)
    const geometry = resolveGeometry(toolId, bitmap.width, bitmap.height, options)
    const canvas = new OffscreenCanvas(geometry.outputWidth, geometry.outputHeight)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('offscreen canvas unavailable')
    context.save()
    context.translate(geometry.outputWidth / 2, geometry.outputHeight / 2)
    context.rotate(geometry.rotation * Math.PI / 180)
    context.drawImage(bitmap, geometry.sourceX, geometry.sourceY, geometry.sourceWidth, geometry.sourceHeight, -geometry.drawWidth / 2, -geometry.drawHeight / 2, geometry.drawWidth, geometry.drawHeight)
    context.restore()
    bitmap.close()
    if (toolId === 'watermark') drawWatermark(context, geometry.outputWidth, geometry.outputHeight, options.watermarkText ?? 'OneImage')
    const mime = resolveOutputMime(toolId, file.type, options.outputMime)
    const blob = await canvas.convertToBlob({ type: mime, quality: Math.min(1, Math.max(0.1, options.quality ?? 0.88)) })
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' } as Record<string, string>)[blob.type] ?? 'png'
    self.postMessage({ ok: true, result: { blob, filename: `${stripExtension(file.name)}.${extension}`, warnings: toolId === 'compress' ? ['lossy-output'] : [] } })
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : 'image worker failed' })
  }
}

function resolveOutputMime(toolId: string, inputMime: string, requestedMime?: string): string {
  if (toolId === 'metadata-clean') return 'image/png'
  if (toolId === 'compress') return requestedMime ?? 'image/webp'
  return requestedMime ?? inputMime
}

function resolveGeometry(toolId: string, inputWidth: number, inputHeight: number, options: LocalToolOptions) {
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

function clampDimension(value: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('image dimension must be finite')
  return Math.min(Math.max(1, Math.round(value)), maximum)
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value) || ![0, 90, 180, 270].includes(value)) throw new Error('rotation must be 0, 90, 180, or 270 degrees')
  return value
}

function drawWatermark(context: OffscreenCanvasRenderingContext2D, width: number, height: number, text: string): void {
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

function stripExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '') || 'oneimage'
}
