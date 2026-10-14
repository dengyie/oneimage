import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { OpenAIProvenanceAdapter } from '../src/infrastructure/openai-provenance-adapter'
import { MAX_INPUT_BYTES } from '../src/domain/image-input'
import { registerProvenanceRoute } from './provenance-route'
import { registerCapabilitiesRoute } from './capabilities-route'
import { authorizeProvenanceRequest } from './security'
import { registerHealthRoute } from './health-route'
import { configureOutboundProxy } from './proxy'
import { createRateLimiter } from './rate-limit'

async function main(): Promise<void> {
  const app = Fastify({ logger: true })
  const maxInputBytes = MAX_INPUT_BYTES
  await app.register(multipart, { limits: { fileSize: maxInputBytes, files: 1, parts: 1 } })
  const serverToken = process.env.ONEIMAGE_SERVER_TOKEN ?? ''
  configureOutboundProxy(process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy)
  const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequestsPerWindow: 30, maxTrackedClients: 10_000 })
  const allowDevelopmentOrigin = process.env.NODE_ENV === 'development'
  registerHealthRoute(app, { providerConfigured: Boolean(process.env.OPENAI_API_KEY) })
  registerCapabilitiesRoute(app, { provenance: { enabled: Boolean(process.env.OPENAI_API_KEY), provider: process.env.OPENAI_API_KEY ? 'openai' : null, maxInputBytes } })
  registerProvenanceRoute(
    app,
    (file, filename) => new OpenAIProvenanceAdapter({ apiKey: process.env.OPENAI_API_KEY ?? '' }).check(file, filename),
    {
      authorize: (request) => authorizeProvenanceRequest(request.headers, serverToken, allowDevelopmentOrigin),
      allow: (request) => rateLimiter.allow(request),
    },
  )

  const port = Number(process.env.PORT ?? 8787)
  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutting down OneImage server')
    try {
      await app.close()
    } catch (error) {
      app.log.error({ err: error }, 'OneImage server shutdown failed')
      process.exitCode = 1
    }
  }
  process.once('SIGTERM', () => { void shutdown('SIGTERM') })
  process.once('SIGINT', () => { void shutdown('SIGINT') })
  await app.listen({ port, host: '127.0.0.1' })
}

main().catch((error: unknown) => {
  process.stderr.write(`OneImage server failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
