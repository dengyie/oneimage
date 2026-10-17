import { describe, expect, it, vi } from 'vitest'
import { resolveRenderDimensions, schedulePreview } from '../src/application/editor-renderer'

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
})
