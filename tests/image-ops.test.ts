import { describe, expect, it } from 'vitest'
import { MIME_EXTENSIONS, drawWatermark, resolveGeometry, resolveOutputMime, stripExtension } from '../src/infrastructure/image-ops'

describe('shared image ops', () => {
  it('maps every supported output mime to a file extension', () => {
    expect(MIME_EXTENSIONS).toEqual({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' })
  })

  it('derives the output filename from the source name', () => {
    expect(stripExtension('holiday.photo.png')).toBe('holiday.photo')
    expect(stripExtension('.gitignore')).toBe('oneimage')
    expect(stripExtension('no-extension')).toBe('no-extension')
  })

  it('clamps resize and crop geometry to sane bounds', () => {
    expect(resolveGeometry('resize', 4000, 3000, { width: 2000 })).toEqual(expect.objectContaining({ outputWidth: 2000, outputHeight: 1500, rotation: 0 }))
    // width above the 8000 cap is clamped; height follows the aspect ratio
    expect(resolveGeometry('resize', 4000, 3000, { width: 99999 }).outputWidth).toBe(8000)
    // crop larger than the source is clamped to the source dimensions
    expect(resolveGeometry('crop', 800, 600, { cropWidth: 5000, cropHeight: 5000 })).toEqual(expect.objectContaining({ sourceWidth: 800, sourceHeight: 600, outputWidth: 800, outputHeight: 600 }))
  })

  it('rejects non-finite dimensions and invalid rotations', () => {
    expect(() => resolveGeometry('resize', 100, 100, { width: Number.NaN })).toThrow(/finite/)
    expect(() => resolveGeometry('rotate', 100, 100, { rotation: 45 })).toThrow(/rotation/)
  })

  it('writes the watermark with the shared typography and truncates long text', () => {
    const drawn: string[] = []
    const context = {
      save() {}, restore() {},
      font: '', textAlign: '', textBaseline: '', fillStyle: '', shadowColor: '', shadowBlur: 0,
      fillText(text: string) { drawn.push(text) },
    }
    drawWatermark(context as unknown as CanvasRenderingContext2D, 1000, 500, 'x'.repeat(200))
    expect(drawn).toHaveLength(1)
    expect(drawn[0]).toHaveLength(80)
    expect(context.font).toBe('36px ui-sans-serif')
    expect(context.textAlign).toBe('right')
  })

  it('normalizes rotate output for 180 and 270 degrees', () => {
    expect(resolveGeometry('rotate', 4000, 3000, { rotation: 180 })).toEqual(expect.objectContaining({ outputWidth: 4000, outputHeight: 3000, rotation: 180 }))
    expect(resolveGeometry('rotate', 4000, 3000, { rotation: 270 })).toEqual(expect.objectContaining({ outputWidth: 3000, outputHeight: 4000, drawWidth: 4000, drawHeight: 3000, rotation: 270 }))
  })

  it('keeps the input mime for plain conversions', () => {
    expect(resolveOutputMime('convert', 'image/avif')).toBe('image/avif')
  })

  it('forces PNG for metadata cleaning and defaults compression output to WebP', () => {
    expect(resolveOutputMime('metadata-clean', 'image/jpeg', 'image/webp')).toBe('image/png')
    expect(resolveOutputMime('compress', 'image/png')).toBe('image/webp')
  })
})