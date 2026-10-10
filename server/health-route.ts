import type { FastifyInstance } from 'fastify'

export interface HealthState {
  providerConfigured: boolean
}

export function registerHealthRoute(app: FastifyInstance, state: HealthState): void {
  app.get('/healthz', async (_request, reply) => {
    const healthy = state.providerConfigured
    return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', providerConfigured: healthy })
  })
}
