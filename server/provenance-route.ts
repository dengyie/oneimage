import type { FastifyInstance } from 'fastify'
import { createWriteStream, openAsBlob } from 'node:fs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ProvenanceResult } from '../src/infrastructure/openai-provenance-adapter'
import { matchesImageSignature } from '../src/application/file-policy'
import { MAX_INPUT_BYTES, SUPPORTED_IMAGE_MIME } from '../src/domain/image-input'

type ProvenanceCheck = (file: Blob, filename: string, signal?: AbortSignal) => Promise<ProvenanceResult>

export interface ProvenanceRouteSecurity {
  authorize(request: { headers: Record<string, string | string[] | undefined> }): boolean | Promise<boolean>
  allow(request: { ip?: string; headers: Record<string, string | string[] | undefined>; raw: { socket: { remoteAddress?: string } } }): boolean | Promise<boolean>
}

const ACCEPTED_MIME = new Set<string>(SUPPORTED_IMAGE_MIME)
const OVERSIZE_MESSAGE = `image exceeds the ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB limit`

export function registerProvenanceRoute(app: FastifyInstance, check: ProvenanceCheck, security: ProvenanceRouteSecurity = { authorize: () => true, allow: () => true }): void {
  app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      const routeError = error as { code?: string }
      if (routeError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || routeError.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
        return reply.code(400).send({ error: { code: 'invalid-input', retryable: false, message: 'multipart image input is required' } })
      }
      if (routeError.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: { code: 'payload-too-large', retryable: false, message: OVERSIZE_MESSAGE } })
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
          await drainMultipartFile(part.file)
          return reply.code(400).send({ error: { code: 'invalid-input', retryable: false, message: 'JPEG, PNG, or WebP input required' } })
        }
        const directory = await mkdtemp(join(tmpdir(), 'oneimage-provenance-'))
        const uploadPath = join(directory, basename(part.filename) || 'upload.bin')
        try {
          await pipeline(part.file, createWriteStream(uploadPath, { flags: 'wx', mode: 0o600 }))
          if (part.file.truncated) return reply.code(413).send({ error: { code: 'payload-too-large', retryable: false, message: OVERSIZE_MESSAGE } })
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
          const requestAbort = new AbortController()
          const onRequestAborted = () => requestAbort.abort(new DOMException('request aborted', 'AbortError'))
          request.raw.once('aborted', onRequestAborted)
          try {
            const result = await check(file, part.filename, requestAbort.signal)
            return reply.code(200).send(result)
          } finally {
            request.raw.off('aborted', onRequestAborted)
          }
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      } catch (cause) {
        const error = cause as { code?: string; retryable?: boolean; status?: number; message?: string }
        if (error.code === 'request-aborted' || request.raw.aborted || request.raw.destroyed) {
          request.log.info({ code: error.code ?? 'request-aborted' }, 'provenance request abandoned by client')
          return reply
        }
        const code = error.code === 'FST_REQ_FILE_TOO_LARGE' ? 'payload-too-large' : error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || error.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE' ? 'invalid-input' : error.code ?? 'provider-error'
        const status = code === 'provider-auth' ? 502 : code === 'provider-rate-limit' ? 429 : code === 'provider-unavailable' ? 503 : code === 'provider-timeout' ? 504 : code === 'payload-too-large' ? 413 : code === 'invalid-input' ? 400 : code === 'request-aborted' ? 499 : 502
        request.log.error({ err: cause, code }, 'provenance request failed')
        return reply.code(status).send({ error: { code, retryable: error.retryable ?? false, message: code === 'payload-too-large' ? OVERSIZE_MESSAGE : error.message ?? 'provenance check failed' } })
      }
    })
  })
}

async function drainMultipartFile(file: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of file) {
    // Consume rejected uploads so busboy can finish the request cleanly.
  }
}
