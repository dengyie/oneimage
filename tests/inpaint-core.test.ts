import { describe, expect, it } from 'vitest'
import {
  rgbaToRgbChw,
  maskToBinary,
  rgbChwToRgba,
  compositeMasked,
  type RgbaPlane,
} from '../src/infrastructure/inpaint/inpaint-core'

function plane(pixels: [number, number, number, number][][], width: number): RgbaPlane {
  const data = new Uint8ClampedArray(pixels.length * width * 4)
  pixels.forEach((row, y) => {
    row.forEach((rgba, x) => {
      data.set(rgba, (y * width + x) * 4)
    })
  })
  return { data, width, height: pixels.length }
}

describe('inpaint-core tensor math', () => {
  it('converts RGBA to packed RGB CHW and back, preserving alpha', () => {
    const base = plane([
      [[1, 2, 3, 255], [4, 5, 6, 200]],
      [[7, 8, 9, 128], [10, 11, 12, 0]],
    ], 2)
    const chw = rgbaToRgbChw(base)
    // Plane layout: R plane (row-major), G plane, B plane.
    expect([...chw]).toEqual([1, 4, 7, 10, 2, 5, 8, 11, 3, 6, 9, 12])

    const roundTrip = rgbChwToRgba(chw, base.data, 2, 2)
    expect([...roundTrip]).toEqual([...base.data])
  })

  it('binarizes the mask inverted: drawn white regions become the 0 hole', () => {
    const mask = plane([
      [[0, 0, 0, 255], [127, 0, 0, 255]],
      [[128, 0, 0, 255], [255, 0, 0, 255]],
    ], 2)
    // MI-GAN semantics: 0 = inpaint hole, 255 = keep.
    expect([...maskToBinary(mask)]).toEqual([255, 255, 0, 0])
  })

  it('copies untouched pixels bit-for-bit and blends feathered edges', () => {
    const base = plane([
      [[10, 10, 10, 255], [20, 20, 20, 255]],
      [[30, 30, 30, 255], [40, 40, 40, 255]],
    ], 2)
    const generated = plane([
      [[100, 100, 100, 255], [110, 110, 110, 255]],
      [[120, 120, 120, 255], [130, 130, 130, 255]],
    ], 2)
    // Alpha: 0 (keep), 255 (generate), 128 (half), 0 (keep).
    const alpha = plane([
      [[0, 0, 0, 255], [255, 0, 0, 255]],
      [[128, 0, 0, 255], [0, 0, 0, 255]],
    ], 2)

    const out = compositeMasked(base, generated, alpha)
    expect([...out.slice(0, 4)]).toEqual([10, 10, 10, 255]) // untouched: bit-for-bit
    expect([...out.slice(4, 8)]).toEqual([110, 110, 110, 255]) // full replace
    expect(out[8]).toBe(75) // (30+120)/2
    expect([...out.slice(12, 16)]).toEqual([40, 40, 40, 255]) // untouched
  })
})
