// Pure tensor/mask math for the MI-GAN smart eraser, kept free of canvas and
// ORT imports so it runs (and tests) in Node.

export interface RgbaPlane {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * RGBA (HWC) → packed RGB (CHW), the MI-GAN pipeline input layout.
 * Alpha is dropped: inpainting runs on the RGB image and the compositor
 * restores the original alpha relationship.
 */
export function rgbaToRgbChw(plane: RgbaPlane): Uint8Array {
  const { data, width, height } = plane
  const size = width * height
  const out = new Uint8Array(size * 3)
  for (let i = 0, p = 0; i < size; i++, p++) {
    out[p] = data[i * 4]
    out[size + p] = data[i * 4 + 1]
    out[size * 2 + p] = data[i * 4 + 2]
  }
  return out
}

/**
 * White-on-black mask canvas → uint8 model mask. The MI-GAN pipeline treats
 * 0 as the inpaint hole and 255 as keep (verified against the real model:
 * pixels under mask=255 survive, everything else is synthesized), so the
 * drawn white regions map to 0 and the background to 255.
 */
export function maskToBinary(plane: RgbaPlane): Uint8Array {
  const size = plane.width * plane.height
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    out[i] = plane.data[i * 4] >= 128 ? 0 : 255
  }
  return out
}

/**
 * uint8 CHW model output → RGBA rows, with the original alpha copied back.
 */
export function rgbChwToRgba(chw: Uint8Array, alpha: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const size = width * height
  const out = new Uint8ClampedArray(size * 4)
  for (let i = 0, p = 0; i < size; i++, p++) {
    out[i * 4] = clampByte(chw[p])
    out[i * 4 + 1] = clampByte(chw[size + p])
    out[i * 4 + 2] = clampByte(chw[size * 2 + p])
    out[i * 4 + 3] = alpha[i * 4 + 3]
  }
  return out
}

/**
 * Blends the generated pixels into the base using a feathered alpha mask
 * (255 = fully generated, 0 = untouched). Pixels where alpha is exactly 0 are
 * copied bit-for-bit from the base — the hard "nothing outside the mask
 * changes" guarantee of the smart eraser.
 */
export function compositeMasked(base: RgbaPlane, generated: RgbaPlane, alpha: RgbaPlane): Uint8ClampedArray {
  const size = base.width * base.height
  const out = new Uint8ClampedArray(size * 4)
  for (let i = 0; i < size; i++) {
    const a = alpha.data[i * 4] / 255
    const o = i * 4
    if (a === 0) {
      out[o] = base.data[o]
      out[o + 1] = base.data[o + 1]
      out[o + 2] = base.data[o + 2]
      out[o + 3] = base.data[o + 3]
      continue
    }
    if (a === 1) {
      out[o] = generated.data[o]
      out[o + 1] = generated.data[o + 1]
      out[o + 2] = generated.data[o + 2]
      out[o + 3] = generated.data[o + 3]
      continue
    }
    out[o] = Math.round(base.data[o] * (1 - a) + generated.data[o] * a)
    out[o + 1] = Math.round(base.data[o + 1] * (1 - a) + generated.data[o + 1] * a)
    out[o + 2] = Math.round(base.data[o + 2] * (1 - a) + generated.data[o + 2] * a)
    out[o + 3] = Math.round(base.data[o + 3] * (1 - a) + generated.data[o + 3] * a)
  }
  return out
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}
