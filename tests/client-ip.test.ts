import { describe, expect, it } from 'vitest'
import { resolveClientKey } from '../server/client-ip'

describe('client key resolution', () => {
  it('prefers cf-connecting-ip from a loopback peer', () => {
    expect(resolveClientKey({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }, '127.0.0.1')).toBe('203.0.113.9')
  })

  it('falls back to the first X-Forwarded-For hop', () => {
    expect(resolveClientKey({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }, '127.0.0.1')).toBe('198.51.100.7')
  })

  it('ignores forwarded headers when the peer is not loopback', () => {
    expect(resolveClientKey({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }, '203.0.113.50')).toBe('203.0.113.50')
  })

  it('uses the socket address when no forwarded header is present', () => {
    expect(resolveClientKey({}, '127.0.0.1')).toBe('127.0.0.1')
    expect(resolveClientKey({}, undefined)).toBe('unknown')
  })

  it('handles IPv6 loopback and empty forwarded values', () => {
    expect(resolveClientKey({ 'x-forwarded-for': '   ' }, '::1')).toBe('::1')
    expect(resolveClientKey({ 'x-forwarded-for': '198.51.100.7' }, '::ffff:127.0.0.1')).toBe('198.51.100.7')
  })
})