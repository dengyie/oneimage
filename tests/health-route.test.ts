import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerHealthRoute } from '../server/health-route'

describe('health route', () => {
  it('returns healthy without exposing provider secrets when configured', async () => {
    const app = Fastify()
    registerHealthRoute(app, { providerConfigured: true })
    const response = await app.inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', providerConfigured: true })
    await app.close()
  })

  it('returns degraded when no provider is configured', async () => {
    const app = Fastify()
    registerHealthRoute(app, { providerConfigured: false })
    const response = await app.inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'degraded', providerConfigured: false })
    await app.close()
  })
})
