import { describe, expect, it } from 'vitest'
import {
  rgbaToRgbChw,
  maskToBinary,
  compositeFromChw,
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
  it('converts RGBA to packed RGB CHW (plane layout, row-major)', () => {
    const base = plane([
      [[1, 2, 3, 255], [4, 5, 6, 200]],
      [[7, 8, 9, 128], [10, 11, 12, 0]],
    ], 2)
    const chw = rgbaToRgbChw(base)
    // Plane layout: R plane (row-major), G plane, B plane.
    expect([...chw]).toEqual([1, 4, 7, 10, 2, 5, 8, 11, 3, 6, 9, 12])
  })

  it('binarizes the mask inverted: drawn white regions become the 0 hole', () => {
    const mask = plane([
      [[0, 0, 0, 255], [127, 0, 0, 255]],
      [[128, 0, 0, 255], [255, 0, 0, 255]],
    ], 2)
    // MI-GAN semantics: 0 = inpaint hole, 255 = keep.
    expect([...maskToBinary(mask)]).toEqual([255, 255, 0, 0])
  })

  it('fused composite: alpha 0 keeps base bit-for-bit including alpha', () => {
    const base = plane([
      [[10, 20, 30, 255], [40, 50, 60, 128]],
    ], 2)
    const chw = new Uint8Array([99, 99, 99, 99, 99, 99, 99, 99])
    const alpha = plane([
      [[0, 0, 0, 255], [0, 0, 0, 255]],
    ], 2)
    const out = compositeFromChw(chw, base, alpha)
    expect([...out]).toEqual([...base.data])
  })

  it('fused composite: alpha 255 takes generated RGB and preserves base alpha', () => {
    const base = plane([
      [[10, 20, 30, 200], [40, 50, 60, 255]],
    ], 2)
    // CHW: R=[5,6], G=[7,8], B=[9,10]
    const chw = new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12])
    const alpha = plane([
      [[255, 0, 0, 255], [255, 0, 0, 255]],
    ], 2)
    const out = compositeFromChw(chw, base, alpha)
    expect([...out.slice(0, 4)]).toEqual([5, 7, 9, 200])
    expect([...out.slice(4, 8)]).toEqual([6, 8, 10, 255])
  })

  it('fused composite: feathered alpha blends RGB, clamps model overflow, keeps base alpha', () => {
    const base = plane([
      [[30, 30, 30, 180], [40, 40, 40, 255]],
    ], 2)
    // Model output out of byte range must clamp: R0=300 -> 255.
    // Layout: R=[255, 6], G=[0, 300->255], B=[100, 9].
    const chw = new Uint8Array([255, 6, 0, 255, 100, 9])
    const alpha = plane([
      [[128, 0, 0, 255], [255, 0, 0, 255]],
    ], 2)
    const out = compositeFromChw(chw, base, alpha)
    expect(out[0]).toBe(143) // 30*(1-128/255) + 255*(128/255) rounded
    expect(out[1]).toBe(15)
    expect(out[2]).toBe(65)
    expect(out[3]).toBe(180)
    expect(out[4]).toBe(6)
    expect(out[5]).toBe(255)
    expect(out[6]).toBe(9)
    expect(out[7]).toBe(255)
  })
})
