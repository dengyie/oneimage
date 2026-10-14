export type ProxyHeaders = Record<string, string | string[] | undefined>

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false
  return address === '::1' || address.startsWith('127.') || address === '::ffff:127.0.0.1'
}

// The server binds loopback and sits behind a trusted front proxy (Nginx, then
// the Cloudflare Tunnel), so a forwarded client address is only meaningful when
// the immediate peer is itself loopback. That is the same trust model the
// bundled provenance gateway documents: forwarded headers are spoofable, and
// binding to loopback is what makes them safe to read. Cloudflare overwrites
// cf-connecting-ip at the edge, so it wins over the client-appendable
// X-Forwarded-For chain.
export function resolveClientKey(headers: ProxyHeaders, remoteAddress: string | undefined): string {
  if (isLoopback(remoteAddress)) {
    const cloudflareAddress = firstHeaderValue(headers['cf-connecting-ip'])
    if (cloudflareAddress) return cloudflareAddress
    const forwarded = firstHeaderValue(headers['x-forwarded-for'])
    if (forwarded) {
      const firstHop = forwarded.split(',')[0]?.trim()
      if (firstHop) return firstHop
    }
  }
  return remoteAddress ?? 'unknown'
}
