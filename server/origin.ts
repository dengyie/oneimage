import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

// Browser clients attach an Origin header to every unsafe method (POST/PATCH/
// DELETE), including same-origin fetches, so a present Origin that does not
// match the serving host is a cross-site request. Headerless clients (curl,
// server-to-server scripts) carry no Origin and keep working. This is
// belt-and-braces on top of the SameSite=Lax session cookie.
export function originMatchesHost(origin: string | string[] | undefined, host: string | string[] | undefined): boolean {
  if (typeof origin !== 'string' || origin.length === 0) return true
  if (typeof host !== 'string' || host.length === 0) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function registerSameOriginGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const method = request.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
    if (!request.url.startsWith('/api/')) return
    if (!originMatchesHost(request.headers.origin, request.headers.host)) {
      void reply.status(403).send({
        error: 'cross_origin_blocked',
        message: '跨站请求被拒绝',
      })
    }
  })
}

