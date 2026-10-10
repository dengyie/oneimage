import { describe, expect, it } from 'vitest'
import { advanceLocalJob, createLocalJob } from '../src/domain/local-job'

describe('local job state machine', () => {
  it('accepts only forward transitions and records completion metadata', () => {
    const queued = createLocalJob('convert', { id: () => 'job-1', now: () => new Date('2026-01-01T00:00:00.000Z') })
    const running = advanceLocalJob(queued, { type: 'start' })
    const succeeded = advanceLocalJob(running, {
      type: 'succeed',
      result: { blob: new Blob(['ok'], { type: 'image/png' }), filename: 'converted.png', warnings: [] },
    })

    expect(succeeded.status).toBe('succeeded')
    expect(succeeded.result?.filename).toBe('converted.png')
    expect(() => advanceLocalJob(succeeded, { type: 'start' })).toThrow('invalid job transition')
  })

  it('allows cancellation before completion but not after completion', () => {
    const running = advanceLocalJob(createLocalJob('resize', { id: () => 'job-2', now: () => new Date('2026-01-01T00:00:00.000Z') }), { type: 'start' })
    const cancelled = advanceLocalJob(running, { type: 'cancel' })

    expect(cancelled.status).toBe('cancelled')
    expect(() => advanceLocalJob(cancelled, { type: 'cancel' })).toThrow('invalid job transition')
  })
})
