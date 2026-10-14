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
  return {
    allow(request: RateLimitRequest): boolean {
      const current = now()
      const key = resolveClientKey(request.headers, request.raw.socket.remoteAddress)
      let entry = counts.get(key)
      if (entry && entry.resetAt <= current) {
        counts.delete(key)
        entry = undefined
      }
      if (!entry || entry.resetAt <= current) {
        if (counts.size >= policy.maxTrackedClients) {
          for (const [trackedKey, trackedEntry] of counts) {
            if (trackedEntry.resetAt <= current) counts.delete(trackedKey)
          }
        }
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
