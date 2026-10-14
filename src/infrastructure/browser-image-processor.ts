import type { ToolResult } from '../domain/tool'
import { MIME_EXTENSIONS, drawWatermark, resolveGeometry, resolveOutputMime, stripExtension } from './image-ops'
import type { ImageGeometry } from './image-ops'

export interface LocalToolOptions {
  outputMime?: string
  quality?: number
  width?: number
  cropWidth?: number
  cropHeight?: number
  rotation?: number
  watermarkText?: string
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

