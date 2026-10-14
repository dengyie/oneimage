import { resolveClientKey, type ProxyHeaders } from './client-ip'

export interface RateLimitPolicy {
  windowMs: number
  maxRequestsPerWindow: number
  maxTrackedClients: number
}

export interface RateLimitRequest {
  headers: ProxyHeaders
  ip?: string
  raw: { socket: { remoteAddress?: string } }
}

export interface RateLimiter {
  allow(request: RateLimitRequest): boolean
}

// Fixed-window limiter keyed on the resolved client address. The tracked-client
// cap bounds memory: once it is reached a previously unseen client is denied
// rather than evicting an existing entry, so a flood of distinct addresses
// cannot displace the clients already counting against the limit.
export function createRateLimiter(policy: RateLimitPolicy, now: () => number = Date.now): RateLimiter {
  const counts = new Map<string, { count: number; resetAt: number }>()
  let window = -1
  return {
    allow(request: RateLimitRequest): boolean {
      const current = now()
      const currentWindow = Math.floor(current / policy.windowMs)
      if (window !== currentWindow) {
        counts.clear()
        window = currentWindow
      }
      const key = resolveClientKey(request.headers, request.raw.socket.remoteAddress)
      const entry = counts.get(key)
      if (!entry || entry.resetAt <= current) {
        if (counts.size >= policy.maxTrackedClients) return false
        counts.set(key, { count: 1, resetAt: current + policy.windowMs })
        return true
      }
      if (entry.count >= policy.maxRequestsPerWindow) return false
      entry.count += 1
      return true
    },
  }
}
