import type { ToolDefinition, ToolRegistry } from './tool'

const ACCEPTED_IMAGE_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const MAX_INPUT_BYTES = 25 * 1024 * 1024

const definitions: readonly ToolDefinition[] = Object.freeze([
  {
    id: 'convert',
    category: 'convert',
    title: '格式转换',
    description: '在 JPEG、PNG、WebP 与 AVIF 之间转换。',
    executionPlane: 'browser',
    requiresUpload: false,
    acceptedMime: ACCEPTED_IMAGE_MIME,
    maxInputBytes: MAX_INPUT_BYTES,
    confidenceModel: 'deterministic',
    warningCodes: [],
  },
  {
    id: 'compress',
    category: 'convert',
    title: '压缩图片',
    description: '调整输出质量，减少文件体积。',
    executionPlane: 'browser',
    requiresUpload: false,
    acceptedMime: ACCEPTED_IMAGE_MIME,
    maxInputBytes: MAX_INPUT_BYTES,
    confidenceModel: 'visual-quality',
    warningCodes: ['lossy-output'],
  },
  {
    id: 'resize',
    category: 'convert',
    title: '调整尺寸',
    description: '按目标宽度或高度导出图片。',
    executionPlane: 'browser',
    requiresUpload: false,
    acceptedMime: ACCEPTED_IMAGE_MIME,
    maxInputBytes: MAX_INPUT_BYTES,
    maxPixels: 40_000_000,
    confidenceModel: 'visual-quality',
    warningCodes: [],
  },
  {
    id: 'crop',
    category: 'convert',
    title: '裁剪图片',
    description: '从图片中央裁出指定尺寸。',
    executionPlane: 'browser',
    requiresUpload: false,
    acceptedMime: ACCEPTED_IMAGE_MIME,
    maxInputBytes: MAX_INPUT_BYTES,
    maxPixels: 40_000_000,
    confidenceModel: 'deterministic',
    warningCodes: [],
  },
  {
    id: 'rotate',
    category: 'convert',
    title: '旋转图片',
    description: '按 90° 增量在本地旋转图片。',
    executionPlane: 'browser',
    requiresUpload: false,
    acceptedMime: ACCEPTED_IMAGE_MIME,
    maxInputBytes: MAX_INPUT_BYTES,
    maxPixels: 40_000_000,
    confidenceModel: 'deterministic',
    warningCodes: [],
  },
  {
    id: 'watermark',
    category: 'privacy',
    title: '添加可见水印',
    description: '在本地叠加文字水印，原图不会上传。',
    executionPlane: 'browser',
    requiresUpload: false,
    acceptedMime: ACCEPTED_IMAGE_MIME,
    maxInputBytes: MAX_INPUT_BYTES,
    confidenceModel: 'deterministic',
    warningCodes: [],
  },
  {
    id: 'metadata-clean',
    category: 'privacy',
    title: '清除元数据',
    description: '导出不携带原始 EXIF/XMP 的新图片。',
    executionPlane: 'browser',
    requiresUpload: false,
    acceptedMime: ACCEPTED_IMAGE_MIME,
    maxInputBytes: MAX_INPUT_BYTES,
    confidenceModel: 'deterministic',
    warningCodes: [],
  },
])

export function createToolRegistry(): ToolRegistry {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))
  return {
    get: (id) => byId.get(id),
    list: () => definitions,
  }
}
