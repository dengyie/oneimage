import { describe, expect, it } from 'vitest'
import { computeCursorAnchoredPan, createCropGesture, mapSourceRectToViewport, mapPointerToSource, updateCropGesture } from '../src/components/image-editor-model'

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

  it('keeps the element point under the cursor fixed across a wheel zoom', () => {
    // Transform model: translate(pan) scale(s) with origin at the element
    // center, which flex-centers at the container center (1920x1080 here).
    const W = 1920, H = 1080
    const cx = W / 2, cy = H / 2
    const pan = { x: -130, y: 46 }
    const prevScale = 1.4
    const nextScale = 1.4 * 1.15
    const mouse = { x: 300, y: 800 }

    const next = computeCursorAnchoredPan(mouse.x, mouse.y, cx, cy, pan, prevScale, nextScale)

    // Element point under the cursor before the zoom...
    const qx = (mouse.x - cx - pan.x) / prevScale
    const qy = (mouse.y - cy - pan.y) / prevScale
    // ...must render at the same screen point after the zoom.
    expect(cx + next.x + qx * nextScale).toBeCloseTo(mouse.x, 6)
    expect(cy + next.y + qy * nextScale).toBeCloseTo(mouse.y, 6)
  })

  it('does not drift across consecutive wheel ticks at a fixed cursor', () => {
    const W = 1440, H = 900
    const cx = W / 2, cy = H / 2
    const mouse = { x: 220, y: 690 }
    let pan = { x: 0, y: 0 }
    let scale = 0.6

    // The tracked element point under the cursor at the start...
    const qx = (mouse.x - cx - pan.x) / scale
    const qy = (mouse.y - cy - pan.y) / scale

    for (let i = 0; i < 20; i++) {
      const nextScale = Math.min(32, scale * 1.15)
      pan = computeCursorAnchoredPan(mouse.x, mouse.y, cx, cy, pan, scale, nextScale)
      scale = nextScale
      // ...must remain exactly under the cursor after every tick.
      expect(cx + pan.x + qx * scale).toBeCloseTo(mouse.x, 6)
      expect(cy + pan.y + qy * scale).toBeCloseTo(mouse.y, 6)
    }
  })

  it('drifts on the corner-anchored model it replaces (regression documentation)', () => {
    // The previous formula assumed transform-origin at the container's
    // top-left; with the real center-origin transform the anchored point
    // moves by about center*(ratio-1) per tick. Guard the fix by showing the
    // new pan differs from that broken model at an off-center cursor.
    const W = 1920, H = 1080
    const cx = W / 2, cy = H / 2
    const pan = { x: 0, y: 0 }
    const prevScale = 1, nextScale = 1.15
    const mouse = { x: 300, y: 800 }

    const fixed = computeCursorAnchoredPan(mouse.x, mouse.y, cx, cy, pan, prevScale, nextScale)
    const brokenX = mouse.x - (mouse.x - pan.x) * (nextScale / prevScale)
    const brokenY = mouse.y - (mouse.y - pan.y) * (nextScale / prevScale)

    expect(fixed.x).not.toBeCloseTo(brokenX, 0)
    expect(fixed.y).not.toBeCloseTo(brokenY, 0)
    // The broken model's per-tick drift equals center*(ratio-1).
    expect(fixed.x - brokenX).toBeCloseTo(cx * (nextScale / prevScale - 1), 6)
    expect(fixed.y - brokenY).toBeCloseTo(cy * (nextScale / prevScale - 1), 6)
  })

  it('returns the pan untouched for degenerate scales', () => {
    const pan = { x: 12, y: -8 }
    expect(computeCursorAnchoredPan(100, 100, 960, 540, pan, 0, 2)).toEqual(pan)
    expect(computeCursorAnchoredPan(100, 100, 960, 540, pan, 1, Number.NaN)).toEqual(pan)
  })
})
