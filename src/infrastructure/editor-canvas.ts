import type { CanvasFactory, DecodedSource, RenderCanvas } from '../application/editor-renderer'

export function createBrowserCanvasFactory(): CanvasFactory {
  return {
    create(width, height): RenderCanvas {
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        return canvas
      }
      throw new Error('browser canvas unavailable')
    },
  }
}

export async function decodeEditorSource(file: Blob, signal?: AbortSignal): Promise<DecodedSource> {
  throwIfAborted(signal)
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context, width, height) => { context.drawImage(bitmap, 0, 0, width, height) },
      close: () => bitmap.close(),
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') throw new Error('image decoder unavailable')
  const url = URL.createObjectURL(file)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(new DOMException('editor decode cancelled', 'AbortError')) }
    const cleanup = () => { URL.revokeObjectURL(url); signal?.removeEventListener('abort', onAbort) }
    const element = new Image()
    element.onload = () => { cleanup(); resolve(element) }
    element.onerror = () => { cleanup(); reject(new Error('image decode failed')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    element.src = url
  })
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    draw: (context, width, height) => { context.drawImage(image, 0, 0, width, height) },
    close: () => {},
  }
}

function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('editor decode cancelled', 'AbortError') }
