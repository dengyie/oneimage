import type { FastifyInstance } from 'fastify'

export interface PublicCapabilities {
  provenance: {
    enabled: boolean
    provider: string | null
    maxInputBytes: number
  }
}

export function registerCapabilitiesRoute(app: FastifyInstance, capabilities: PublicCapabilities): void {
  app.get('/api/v1/capabilities', async (_request, reply) => reply.code(200).send(capabilities))
}
