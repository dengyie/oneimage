import { describe, expect, it } from 'vitest'
import { createCropGesture, mapSourceRectToViewport, mapPointerToSource, updateCropGesture } from '../src/components/image-editor-model'

describe('image editor interaction model', () => {
  it('converts a pointer drag into a bounded crop move', () => {
    const gesture = createCropGesture('move', { x: 100, y: 100 }, { x: 0, y: 0, width: 400, height: 300 }, { x: 0, y: 0, width: 800, height: 600 })
    expect(updateCropGesture(gesture, { x: 700, y: 500 })).toEqual({ x: 400, y: 300, width: 400, height: 300 })
  })

  it('shrinks a full-image selection before moving it within the source', () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 }
    const reduced = { x: 72, y: 54, width: 656, height: 492 }
    const gesture = createCropGesture('move', { x: 200, y: 200 }, reduced, bounds)

    expect(updateCropGesture(gesture, { x: 260, y: 230 })).toEqual({ x: 132, y: 84, width: 656, height: 492 })
  })

  it('resizes from the east edge without crossing the image boundary', () => {
    const gesture = createCropGesture('e', { x: 100, y: 100 }, { x: 0, y: 0, width: 400, height: 300 }, { x: 0, y: 0, width: 800, height: 600 })
    expect(updateCropGesture(gesture, { x: 300, y: 100 })).toEqual({ x: 0, y: 0, width: 600, height: 300 })
  })

  it('keeps the selected aspect ratio while resizing', () => {
    const gesture = createCropGesture('e', { x: 100, y: 100 }, { x: 0, y: 0, width: 300, height: 300 }, { x: 0, y: 0, width: 800, height: 600 }, 1)
    expect(updateCropGesture(gesture, { x: 250, y: 100 })).toEqual({ x: 0, y: 0, width: 450, height: 450 })
  })

  it('maps a rotated viewport pointer back into source coordinates', () => {
    expect(mapPointerToSource({ x: 150, y: 50 }, { width: 200, height: 300 }, 90, false, false)).toEqual({ x: 50, y: 150 })
  })

  it('moves a local adjustment region without leaving the source bounds', () => {
    const gesture = createCropGesture('move', { x: 100, y: 100 }, { x: 100, y: 100, width: 200, height: 120 }, { x: 0, y: 0, width: 400, height: 300 })
    expect(updateCropGesture(gesture, { x: 500, y: 500 })).toEqual({ x: 200, y: 180, width: 200, height: 120 })
  })

  it('projects a source rectangle into the rotated viewport bounds', () => {
    const result = mapSourceRectToViewport({ x: 0, y: 0, width: 100, height: 50 }, { width: 100, height: 50 }, 90, false, false)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
    expect(result.width).toBeCloseTo(50)
    expect(result.height).toBeCloseTo(100)
  })
})
