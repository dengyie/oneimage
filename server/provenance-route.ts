import type { FastifyInstance } from 'fastify'
import { createWriteStream, openAsBlob } from 'node:fs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ProvenanceResult } from '../src/infrastructure/openai-provenance-adapter'
import { matchesImageSignature } from '../src/application/file-policy'

type ProvenanceCheck = (file: Blob, filename: string) => Promise<ProvenanceResult>

export interface ProvenanceRouteSecurity {
  authorize(request: { headers: Record<string, string | string[] | undefined> }): boolean | Promise<boolean>
  allow(request: { ip?: string }): boolean | Promise<boolean>
}

const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function registerProvenanceRoute(app: FastifyInstance, check: ProvenanceCheck, security: ProvenanceRouteSecurity = { authorize: () => true, allow: () => true }): void {
  app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      const routeError = error as { code?: string }
      if (routeError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || routeError.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
        return reply.code(400).send({ error: { code: 'invalid-input', retryable: false, message: 'multipart image input is required' } })
      }
      if (routeError.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: { code: 'payload-too-large', retryable: false, message: 'image exceeds the 25 MB limit' } })
      }
      request.log.error({ err: error }, 'unhandled provenance route error')
      return reply.send(error)
    })

    scope.post('/api/v1/provenance/openai', async (request, reply) => {
      try {
        if (!await security.authorize(request)) return reply.code(401).send({ error: { code: 'unauthorized', retryable: false, message: 'server authentication required' } })
        if (!await security.allow(request)) return reply.code(429).send({ error: { code: 'rate-limit', retryable: true, message: 'too many requests' } })
        const part = await request.file()
        if (!part) return reply.code(400).send({ error: { code: 'invalid-input', retryable: false, message: 'image file is required' } })
        if (!ACCEPTED_MIME.has(part.mimetype)) {
          return reply.code(400).send({ error: { code: 'invalid-input', retryable: false, message: 'JPEG, PNG, or WebP input required' } })
        }
        const directory = await mkdtemp(join(tmpdir(), 'oneimage-provenance-'))
        const uploadPath = join(directory, basename(part.filename) || 'upload.bin')
        try {
          await pipeline(part.file, createWriteStream(uploadPath, { flags: 'wx', mode: 0o600 }))
          if (part.file.truncated) return reply.code(413).send({ error: { code: 'payload-too-large', retryable: false, message: 'image exceeds the 25 MB limit' } })
          const signature = Buffer.allocUnsafe(16)
          const handle = await open(uploadPath, 'r')
          try {
            const { bytesRead } = await handle.read(signature, 0, signature.length, 0)
            if (!matchesImageSignature(signature.subarray(0, bytesRead), part.mimetype)) {
              return reply.code(400).send({ error: { code: 'invalid-input', retryable: false, message: 'file signature does not match its MIME type' } })
            }
          } finally {
            await handle.close()
          }
          const file = await openAsBlob(uploadPath, { type: part.mimetype })
          const result = await check(file, part.filename)
          return reply.code(200).send(result)
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      } catch (cause) {
        const error = cause as { code?: string; retryable?: boolean; status?: number; message?: string }
        const code = error.code === 'FST_REQ_FILE_TOO_LARGE' ? 'payload-too-large' : error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || error.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE' ? 'invalid-input' : error.code ?? 'provider-error'
        const status = code === 'provider-auth' ? 502 : code === 'provider-rate-limit' ? 429 : code === 'provider-unavailable' ? 503 : code === 'provider-timeout' ? 504 : code === 'payload-too-large' ? 413 : code === 'invalid-input' ? 400 : 502
        request.log.error({ err: cause, code }, 'provenance request failed')
        return reply.code(status).send({ error: { code, retryable: error.retryable ?? false, message: code === 'payload-too-large' ? 'image exceeds the 25 MB limit' : error.message ?? 'provenance check failed' } })
      }
    })
  })
}
