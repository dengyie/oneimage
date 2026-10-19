import { describe, expect, it, vi } from 'vitest'
import { renderEditor, resolveRenderDimensions, schedulePreview, type CanvasFactory, type DecodedSource, type RenderCanvas } from '../src/application/editor-renderer'
import { createEditorState } from '../src/domain/editor-state'

describe('editor renderer', () => {
  it('keeps preview bounded while export keeps source dimensions', () => {
    expect(resolveRenderDimensions(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(resolveRenderDimensions(4000, 3000, Number.POSITIVE_INFINITY)).toEqual({ width: 4000, height: 3000 })
  })

  it('cancels a pending animation frame when replaced', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const cancel = schedulePreview(async () => { calls.push('render') })
    cancel()
    vi.runAllTimers()
    expect(calls).toEqual([])
    vi.useRealTimers()
  })

  it('applies a local adjustment on top of the already globally adjusted image', () => {
    let sourceDraws = 0
    let imageDraws = 0
    const filters: string[] = []
    const createCanvas = (width: number, height: number): RenderCanvas => {
      const canvas = { width, height }
      const context = {
        canvas,
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        rect: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        clip: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        drawImage: () => { imageDraws += 1 },
        set filter(value: string) { filters.push(value) },
      }
      return { width, height, getContext: () => context as never }
    }
    const factory: CanvasFactory = { create: createCanvas }
    const source: DecodedSource = {
      width: 100,
      height: 100,
      draw: () => { sourceDraws += 1 },
      close: () => {},
    }
    const state = createEditorState(100, 100)
    state.adjustments.brightness = 20
    state.localAdjustments = [{ id: 'local', rect: { x: 10, y: 10, width: 40, height: 40 }, adjustments: { ...state.adjustments, brightness: 0 } }]

    renderEditor(source, state, factory, { maxEdge: 100, showFullSource: true })

    expect(sourceDraws).toBe(1)
    expect(imageDraws).toBe(2)
    expect(filters).toEqual([
      'brightness(1.2) contrast(1) saturate(1) blur(0px)',
      'brightness(1) contrast(1) saturate(1) blur(0px)',
    ])
  })

  it('creates a block-sized mosaic layer only for the selected local region', () => {
    const created: Array<{ width: number; height: number }> = []
    const paths: Array<Array<{ x: number; y: number }>> = []
    let currentPath: Array<{ x: number; y: number }> = []
    let smoothingStates: boolean[] = []
    const factory: CanvasFactory = {
      create(width, height) {
        created.push({ width, height })
        const canvas = { width, height }
        const context = {
          canvas,
          clearRect: () => {},
          save: () => {},
          restore: () => {},
          beginPath: () => { currentPath = []; paths.push(currentPath) },
          rect: () => {},
          moveTo: (x: number, y: number) => { currentPath.push({ x, y }) },
          lineTo: (x: number, y: number) => { currentPath.push({ x, y }) },
          closePath: () => {},
          clip: () => {},
          translate: () => {},
          rotate: () => {},
          scale: () => {},
          drawImage: () => {},
          set filter(_value: string) {},
          set imageSmoothingEnabled(value: boolean) { smoothingStates.push(value) },
        }
        return { width, height, getContext: () => context as never }
      },
    }
    const source: DecodedSource = { width: 100, height: 100, draw: () => {}, close: () => {} }
    const state = createEditorState(100, 100)
    state.localAdjustments = [{
      id: 'mosaic',
      rect: { x: 20, y: 30, width: 40, height: 30 },
      adjustments: { ...state.adjustments },
      mosaicBlockSize: 10,
    } as typeof state.localAdjustments[number]]

    renderEditor(source, state, factory, { maxEdge: 100, showFullSource: true })

    expect(created).toEqual([{ width: 100, height: 100 }, { width: 100, height: 100 }, { width: 4, height: 3 }])
    expect(smoothingStates).toContain(false)
    expect(paths[0]).toEqual([{ x: 20, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 60 }, { x: 20, y: 60 }])
    expect(paths[1]).toEqual(paths[0])
  })
})
