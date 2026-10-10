import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerCapabilitiesRoute } from '../server/capabilities-route'

describe('capabilities route', () => {
  it('returns public capabilities without exposing provider credentials', async () => {
    const app = Fastify()
    registerCapabilitiesRoute(app, { provenance: { enabled: true, provider: 'openai', maxInputBytes: 25 * 1024 * 1024 } })

    const response = await app.inject({ method: 'GET', url: '/api/v1/capabilities' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ provenance: { enabled: true, provider: 'openai', maxInputBytes: 25 * 1024 * 1024 } })
    expect(response.body).not.toContain('API_KEY')
    await app.close()
  })
})
