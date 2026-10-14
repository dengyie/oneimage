import { describe, expect, it } from 'vitest'
import { matchesImageSignature, validateImageFile } from '../src/application/file-policy'
import { SUPPORTED_IMAGE_MIME } from '../src/domain/image-input'

describe('image file policy', () => {
  it('accepts supported images under the byte limit', () => {
    const file = new File([new Uint8Array(12)], 'photo.png', { type: 'image/png' })

    expect(validateImageFile(file)).toEqual({ ok: true })
  })

  it('rejects unsupported, empty, and oversized files with stable codes', () => {
    expect(validateImageFile(new File([], 'empty.png', { type: 'image/png' }))).toEqual({ ok: false, code: 'invalid-input', message: '文件为空' })
    expect(validateImageFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toEqual({ ok: false, code: 'unsupported-format', message: '仅支持 JPEG、PNG 和 WebP 图片' })
    expect(validateImageFile(new File(['x'], 'photo.avif', { type: 'image/avif' }))).toEqual({ ok: false, code: 'unsupported-format', message: '仅支持 JPEG、PNG 和 WebP 图片' })
    const oversized = new File([new Uint8Array(10)], 'large.png', { type: 'image/png' })
    expect(validateImageFile(oversized, 5)).toEqual({ ok: false, code: 'payload-too-large', message: '图片超过当前大小限制' })
  })

  it('accepts every format the shared input policy advertises', () => {
    for (const mime of SUPPORTED_IMAGE_MIME) {
      expect(validateImageFile(new File([new Uint8Array(12)], 'in.bin', { type: mime }))).toEqual({ ok: true })
    }
  })

  it('checks magic bytes instead of trusting a MIME label', () => {
    expect(matchesImageSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')).toBe(true)
    expect(matchesImageSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), 'image/jpeg')).toBe(false)
  })
})
