import { describe, expect, it } from 'vitest'
import { resolveOutputMime, resolveGeometry } from '../src/infrastructure/browser-image-processor'

describe('browser image output policy', () => {
  it('keeps conversion output explicit and strips metadata to PNG', () => {
    expect(resolveOutputMime('convert', 'image/png', 'image/webp')).toBe('image/webp')
    expect(resolveOutputMime('metadata-clean', 'image/jpeg', 'image/webp')).toBe('image/png')
    expect(resolveOutputMime('compress', 'image/png')).toBe('image/webp')
  })

  it('computes bounded geometry for crop and quarter-turn rotation', () => {
    expect(resolveGeometry('crop', 4000, 3000, { cropWidth: 1000, cropHeight: 800 })).toEqual({ sourceX: 1500, sourceY: 1100, sourceWidth: 1000, sourceHeight: 800, outputWidth: 1000, outputHeight: 800, drawWidth: 1000, drawHeight: 800, rotation: 0 })
    expect(resolveGeometry('rotate', 4000, 3000, { rotation: 90 })).toEqual(expect.objectContaining({ outputWidth: 3000, outputHeight: 4000, drawWidth: 4000, drawHeight: 3000, rotation: 90 }))
  })
})
