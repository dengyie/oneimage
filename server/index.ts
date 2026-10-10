import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { OpenAIProvenanceAdapter } from '../src/infrastructure/openai-provenance-adapter'
import { registerProvenanceRoute } from './provenance-route'
import { registerCapabilitiesRoute } from './capabilities-route'
import { authorizeProvenanceRequest } from './security'
import { registerHealthRoute } from './health-route'

async function main(): Promise<void> {
  const app = Fastify({ logger: true })
  const maxInputBytes = 25 * 1024 * 1024
  await app.register(multipart, { limits: { fileSize: maxInputBytes, files: 1, parts: 1 } })
  const serverToken = process.env.ONEIMAGE_SERVER_TOKEN ?? ''
  const requestCounts = new Map<string, { count: number; resetAt: number }>()
  const windowMs = 60_000
  const maxRequestsPerWindow = 30
  const maxTrackedClients = 10_000
  let rateLimitWindow = Math.floor(Date.now() / windowMs)
  const allowDevelopmentOrigin = process.env.NODE_ENV === 'development'
  registerHealthRoute(app, { providerConfigured: Boolean(process.env.OPENAI_API_KEY) })
  registerCapabilitiesRoute(app, { provenance: { enabled: Boolean(process.env.OPENAI_API_KEY), provider: process.env.OPENAI_API_KEY ? 'openai' : null, maxInputBytes } })
  registerProvenanceRoute(
    app,
    (file, filename) => new OpenAIProvenanceAdapter({ apiKey: process.env.OPENAI_API_KEY ?? '' }).check(file, filename),
    {
      authorize: (request) => authorizeProvenanceRequest(request.headers, serverToken, allowDevelopmentOrigin),
      allow: (request) => {
        const now = Date.now()
        const currentWindow = Math.floor(now / windowMs)
        if (rateLimitWindow !== currentWindow) {
          requestCounts.clear()
          rateLimitWindow = currentWindow
        }
        const key = request.ip ?? 'unknown'
        const current = requestCounts.get(key)
        if (!current || current.resetAt <= now) {
          if (requestCounts.size >= maxTrackedClients) return false
          requestCounts.set(key, { count: 1, resetAt: now + windowMs })
          return true
        }
        if (current.count >= maxRequestsPerWindow) return false
        current.count += 1
        return true
      },
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
