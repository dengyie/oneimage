import { describe, expect, it } from 'vitest'
import { clampCrop, createEditorState, editorStatesEqual, isStrokePointRedundant, rotatedDimensions, rotateEditorState, type AnnotationLayer } from '../src/domain/editor-state'

describe('editor state', () => {
  it('creates a full-image crop with neutral adjustments', () => {
    const state = createEditorState(1200, 800)
    expect(state.crop).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(state.adjustments).toEqual({ brightness: 0, contrast: 0, saturation: 0, sharpen: 0, blur: 0 })
  })

  it('clamps a dragged crop to image bounds and fixed aspect ratio', () => {
    expect(clampCrop({ x: -20, y: 40, width: 1000, height: 1000 }, { x: 0, y: 0, width: 800, height: 600 }, 1)).toEqual({ x: 0, y: 0, width: 600, height: 600 })
  })

  it('rotates the transform while keeping crop coordinates in source space', () => {
    const state = createEditorState(1200, 800)
    const rotated = rotateEditorState(state, 1)
    expect(rotated.rotation).toBe(90)
    expect(rotated.sourceWidth).toBe(1200)
    expect(rotated.sourceHeight).toBe(800)
    expect(rotated.crop).toEqual(state.crop)
  })

  it('compares snapshots structurally so no-op commits can be skipped', () => {
    const base = createEditorState(100, 100)
    expect(editorStatesEqual(base, { ...base })).toBe(true)
    expect(editorStatesEqual(base, { ...base, rotation: 90 })).toBe(false)
    expect(editorStatesEqual(base, { ...base, crop: { ...base.crop, width: 50 } })).toBe(false)
    expect(editorStatesEqual(base, { ...base, adjustments: { ...base.adjustments, blur: 2 } })).toBe(false)

    const mosaic = { id: 'l1', rect: { x: 0, y: 0, width: 10, height: 10 }, adjustments: { ...base.adjustments }, mosaicBlockSize: 16 }
    const withLocal = { ...base, localAdjustments: [mosaic] }
    expect(editorStatesEqual(withLocal, { ...base, localAdjustments: [{ ...mosaic }] })).toBe(true)
    expect(editorStatesEqual(withLocal, { ...base, localAdjustments: [{ ...mosaic, mosaicBlockSize: 24 }] })).toBe(false)

    // Annotation layers are immutable: a changed layer is a new object.
    const layer: AnnotationLayer = { id: 'a1', type: 'rect', color: '#fff', strokeWidth: 2, rect: { x: 0, y: 0, width: 5, height: 5 } }
    const withLayer = { ...base, annotations: [layer] }
    expect(editorStatesEqual(withLayer, { ...base, annotations: [layer] })).toBe(true)
    expect(editorStatesEqual(withLayer, { ...base, annotations: [{ ...layer }] })).toBe(false)
  })

  it('uses a bounding box for arbitrary rotation angles', () => {
    expect(rotatedDimensions(100, 50, 45)).toEqual({ width: 107, height: 107 })
  })

  it('decimates sub-pixel stroke samples but keeps visually distinct points', () => {
    // First point of a stroke is always significant.
    expect(isStrokePointRedundant(undefined, { x: 10, y: 10 })).toBe(false)
    // Identical and sub-pixel source moves are redundant.
    expect(isStrokePointRedundant({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true)
    expect(isStrokePointRedundant({ x: 10, y: 10 }, { x: 10.5, y: 10.4 })).toBe(true)
    // A full source pixel of travel is kept, including on the diagonal.
    expect(isStrokePointRedundant({ x: 10, y: 10 }, { x: 11, y: 10 })).toBe(false)
    expect(isStrokePointRedundant({ x: 10, y: 10 }, { x: 10.8, y: 10.8 })).toBe(false)
    // Explicit threshold honoured: (4,3) is exactly 5px away, so only a
    // strictly larger threshold drops it.
    expect(isStrokePointRedundant({ x: 0, y: 0 }, { x: 4, y: 3 }, 5)).toBe(false)
    expect(isStrokePointRedundant({ x: 0, y: 0 }, { x: 4, y: 3 }, 5.0001)).toBe(true)
  })
})
