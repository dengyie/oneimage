import type { LocalToolOptions } from './browser-image-processor'
import { MIME_EXTENSIONS, drawWatermark, resolveGeometry, resolveOutputMime, stripExtension } from './image-ops'

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
    const extension = MIME_EXTENSIONS[blob.type] ?? 'png'
    // Warnings are the registry's concern, not the worker's; the caller attaches
    // them so this bundle does not have to pull in the whole tool registry.
    self.postMessage({ ok: true, blob, filename: `${stripExtension(file.name)}.${extension}` })
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : 'image worker failed' })
  }
}

