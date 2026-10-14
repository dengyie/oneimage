import { MAX_INPUT_BYTES, SUPPORTED_IMAGE_MIME } from '../domain/image-input'

export type FilePolicyErrorCode = 'invalid-input' | 'unsupported-format' | 'payload-too-large'

export type FilePolicyResult =
  | { ok: true }
  | { ok: false; code: FilePolicyErrorCode; message: string }

const ACCEPTED_MIME: ReadonlySet<string> = new Set(SUPPORTED_IMAGE_MIME)

export function validateImageFile(file: File, maxBytes = MAX_INPUT_BYTES): FilePolicyResult {
  if (file.size === 0) return { ok: false, code: 'invalid-input', message: '文件为空' }
  if (!ACCEPTED_MIME.has(file.type)) return { ok: false, code: 'unsupported-format', message: '仅支持 JPEG、PNG 和 WebP 图片' }
  if (file.size > maxBytes) return { ok: false, code: 'payload-too-large', message: '图片超过当前大小限制' }
  return { ok: true }
}

export function matchesImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (mime === 'image/webp') return hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')
  return false
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value)
}

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  return bytes.length >= offset + value.length && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0))
}
