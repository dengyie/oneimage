export type FilePolicyErrorCode = 'invalid-input' | 'unsupported-format' | 'payload-too-large'

export type FilePolicyResult =
  | { ok: true }
  | { ok: false; code: FilePolicyErrorCode; message: string }

const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

export function validateImageFile(file: File, maxBytes = DEFAULT_MAX_BYTES): FilePolicyResult {
  if (file.size === 0) return { ok: false, code: 'invalid-input', message: '文件为空' }
  if (!ACCEPTED_MIME.has(file.type)) return { ok: false, code: 'unsupported-format', message: '仅支持 JPEG、PNG、WebP 和 AVIF 图片' }
  if (file.size > maxBytes) return { ok: false, code: 'payload-too-large', message: '图片超过当前大小限制' }
  return { ok: true }
}

export function matchesImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (mime === 'image/webp') return hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')
  if (mime === 'image/avif') return hasAscii(bytes, 4, 'ftyp') && (hasAscii(bytes, 8, 'avif') || hasAscii(bytes, 8, 'avis'))
  return false
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value)
}

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  return bytes.length >= offset + value.length && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0))
}
