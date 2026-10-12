import { describe, expect, it, vi } from 'vitest'
import { configureOutboundProxy } from '../server/proxy'

const { ProxyAgent, setGlobalDispatcher } = vi.hoisted(() => ({
  ProxyAgent: vi.fn(function ProxyAgent(url: string) { return { url } }),
  setGlobalDispatcher: vi.fn(),
}))

vi.mock('undici', () => ({ ProxyAgent, setGlobalDispatcher }))

describe('server outbound proxy', () => {
  it('routes provider fetch through the configured HTTPS proxy', () => {
    expect(configureOutboundProxy('http://127.0.0.1:7897')).toBe(true)
    expect(ProxyAgent).toHaveBeenCalledWith('http://127.0.0.1:7897')
    expect(setGlobalDispatcher).toHaveBeenCalledWith({ url: 'http://127.0.0.1:7897' })
  })

  it('does not install a dispatcher when no proxy is configured', () => {
    ProxyAgent.mockClear()
    setGlobalDispatcher.mockClear()
    expect(configureOutboundProxy(undefined)).toBe(false)
    expect(ProxyAgent).not.toHaveBeenCalled()
    expect(setGlobalDispatcher).not.toHaveBeenCalled()
  })
})
