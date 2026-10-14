import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../server/rate-limit'

function request(remoteAddress: string, forwarded?: string) {
  return {
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
    raw: { socket: { remoteAddress } },
  }
}

describe('per-client rate limiter', () => {
  it('allows up to the window maximum then denies', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequestsPerWindow: 3, maxTrackedClients: 10 })
    const peer = request('127.0.0.1', '203.0.113.9')
    expect([limiter.allow(peer), limiter.allow(peer), limiter.allow(peer)]).toEqual([true, true, true])
    expect(limiter.allow(peer)).toBe(false)
  })

  it('meters each forwarded client separately', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequestsPerWindow: 1, maxTrackedClients: 10 })
    expect(limiter.allow(request('127.0.0.1', '203.0.113.9'))).toBe(true)
    expect(limiter.allow(request('127.0.0.1', '203.0.113.10'))).toBe(true)
    expect(limiter.allow(request('127.0.0.1', '203.0.113.9'))).toBe(false)
  })

  it('resets counts in a new window', () => {
    let clock = 0
    const limiter = createRateLimiter({ windowMs: 1_000, maxRequestsPerWindow: 1, maxTrackedClients: 10 }, () => clock)
    const peer = request('127.0.0.1', '203.0.113.9')
    expect(limiter.allow(peer)).toBe(true)
    expect(limiter.allow(peer)).toBe(false)
    clock = 1_000
    expect(limiter.allow(peer)).toBe(true)
  })

  it('does not reset an active client bucket at a wall-clock boundary', () => {
    let clock = 900
    const limiter = createRateLimiter({ windowMs: 1_000, maxRequestsPerWindow: 2, maxTrackedClients: 10 }, () => clock)
    const peer = request('127.0.0.1', '203.0.113.9')

    expect(limiter.allow(peer)).toBe(true)
    clock = 1_100
    expect(limiter.allow(peer)).toBe(true)
    expect(limiter.allow(peer)).toBe(false)
  })

  it('denies a new client once the tracked-client cap is reached', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequestsPerWindow: 5, maxTrackedClients: 2 })
    expect(limiter.allow(request('127.0.0.1', '203.0.113.1'))).toBe(true)
    expect(limiter.allow(request('127.0.0.1', '203.0.113.2'))).toBe(true)
    expect(limiter.allow(request('127.0.0.1', '203.0.113.3'))).toBe(false)
    // an already-tracked client keeps its own budget
    expect(limiter.allow(request('127.0.0.1', '203.0.113.1'))).toBe(true)
  })
})
