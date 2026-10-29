import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { initDatabase } from '../server/db'
import { registerSameOriginGuard } from '../server/origin'
import { registerAuthRoutes } from '../server/auth-routes'
import { createFakeMailer } from './helpers'

describe('same-origin guard on mutating /api routes', () => {
  function createTestApp() {
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    registerSameOriginGuard(app)
    registerAuthRoutes(app, appDb.db, { mailer: createFakeMailer() })
    return { app, appDb }
  }

  it('blocks cross-site Origin on unsafe methods and passes same-origin or headerless clients', async () => {
    const { app, appDb } = createTestApp()

    const payload = { account: 'nobody', password: 'whatever' }

    // Headerless clients (curl, server-to-server) keep working.
    const noOrigin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload })
    expect(noOrigin.statusCode).toBe(401)

    // Same-origin POST (browsers attach Origin to unsafe fetches too).
    const sameOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://image.example', host: 'image.example' },
      payload,
    })
    expect(sameOrigin.statusCode).toBe(401)

    // Cross-site Origin is rejected before any handler runs.
    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example', host: 'image.example' },
      payload,
    })
    expect(crossOrigin.statusCode).toBe(403)
    expect(JSON.parse(crossOrigin.body).error).toBe('cross_origin_blocked')

    // A different port is a different origin.
    const crossPort = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://image.example:8443', host: 'image.example' },
      payload,
    })
    expect(crossPort.statusCode).toBe(403)

    // A malformed Origin is not a way through.
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'not-a-url', host: 'image.example' },
      payload,
    })
    expect(malformed.statusCode).toBe(403)

    // GET requests are reads; the guard must not apply.
    const readOnly = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { origin: 'https://evil.example', host: 'image.example' },
    })
    expect(readOnly.statusCode).toBe(200)
    expect(JSON.parse(readOnly.body).authenticated).toBe(false)

    appDb.close()
  })
})
