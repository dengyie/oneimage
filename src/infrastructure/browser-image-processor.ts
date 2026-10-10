import type { ToolResult } from '../domain/tool'

export interface LocalToolOptions {
  outputMime?: string
  quality?: number
  width?: number
  cropWidth?: number
  cropHeight?: number
  rotation?: number
  watermarkText?: string
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

export async function runBrowserImageTool(
  toolId: string,
  file: File,
  options: LocalToolOptions = {},
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    return runImageWorker(toolId, file, options, signal)
  }
  return runMainThreadImageTool(toolId, file, options, signal)
}

async function runMainThreadImageTool(
  toolId: string,
  file: File,
  options: LocalToolOptions = {},
  signal?: AbortSignal,
): Promise<ToolResult> {
  const image = await decodeImage(file, signal)
  const geometry = resolveGeometry(toolId, image.naturalWidth, image.naturalHeight, options)
  const canvas = document.createElement('canvas')
  canvas.width = geometry.outputWidth
  canvas.height = geometry.outputHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('browser canvas unavailable')
  drawTransformedImage(context, image, geometry)

  if (toolId === 'watermark') drawWatermark(context, geometry.outputWidth, geometry.outputHeight, options.watermarkText ?? 'OneImage')
  throwIfAborted(signal)

  const mime = resolveOutputMime(toolId, file.type, options.outputMime)
  const blob = await canvasToBlob(canvas, mime, options.quality ?? 0.88)
  const extension = MIME_EXTENSIONS[blob.type] ?? 'png'
  return {
    blob,
    filename: `${stripExtension(file.name)}.${extension}`,
    warnings: toolId === 'compress' ? ['lossy-output'] : [],
  }
}

function runImageWorker(toolId: string, file: File, options: LocalToolOptions, signal?: AbortSignal): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      worker.terminate()
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(new DOMException('operation cancelled', 'AbortError')))
    worker.onmessage = (event: MessageEvent<{ ok: true; result: ToolResult } | { ok: false; message: string }>) => {
      if ('result' in event.data) {
        const result = event.data.result
        finish(() => resolve(result))
        return
      }
      const message = event.data.message
      finish(() => reject(new Error(message)))
    }
    worker.onerror = () => finish(() => reject(new Error('image worker failed')))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) return onAbort()
    worker.postMessage({ toolId, file, options })
  })
}

export function resolveOutputMime(toolId: string, inputMime: string, requestedMime?: string): string {
  if (toolId === 'metadata-clean') return 'image/png'
  if (toolId === 'compress') return requestedMime ?? 'image/webp'
  return requestedMime ?? inputMime
}

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

function clampDimension(value: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('image dimension must be finite')
  return Math.min(Math.max(1, Math.round(value)), maximum)
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value) || ![0, 90, 180, 270].includes(value)) throw new Error('rotation must be 0, 90, 180, or 270 degrees')
  return value
}

function drawTransformedImage(context: CanvasRenderingContext2D, image: HTMLImageElement, geometry: ImageGeometry): void {
  context.save()
  applyRotation(context, geometry.outputWidth, geometry.outputHeight, geometry.rotation)
  context.drawImage(image, geometry.sourceX, geometry.sourceY, geometry.sourceWidth, geometry.sourceHeight, -geometry.drawWidth / 2, -geometry.drawHeight / 2, geometry.drawWidth, geometry.drawHeight)
  context.restore()
}

function applyRotation(context: CanvasRenderingContext2D, width: number, height: number, rotation: number): void {
  context.translate(width / 2, height / 2)
  context.rotate(rotation * Math.PI / 180)
}

function drawWatermark(context: CanvasRenderingContext2D, width: number, height: number, text: string): void {
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

function decodeImage(file: File, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal)
    const url = URL.createObjectURL(file)
    const image = new Image()
    const cleanup = () => {
      URL.revokeObjectURL(url)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new DOMException('operation cancelled', 'AbortError'))
    }
    image.onload = () => { cleanup(); resolve(image) }
    image.onerror = () => { cleanup(); reject(new Error('image decode failed')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error(`image export failed for ${mime}`))
    }, mime, Math.min(1, Math.max(0.1, quality)))
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '') || 'oneimage'
}
