import { describe, expect, it } from 'vitest'
import { clampCrop, createEditorState, redoHistory, rotatedDimensions, rotateEditorState, undoHistory, type EditorHistory } from '../src/domain/editor-state'

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

  it('undoes and redoes immutable state snapshots', () => {
    const first = createEditorState(100, 100)
    const second = { ...first, rotation: 90 }
    const history: EditorHistory = { past: [first], present: second, future: [] }
    expect(undoHistory(history).present).toBe(first)
    expect(redoHistory(undoHistory(history)).present).toBe(second)
  })

  it('uses a bounding box for arbitrary rotation angles', () => {
    expect(rotatedDimensions(100, 50, 45)).toEqual({ width: 107, height: 107 })
  })
})
