import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { registerProvenanceRoute, type ProvenanceRouteSecurity } from '../server/provenance-route'

describe('provenance HTTP route', () => {
  it('accepts an image multipart upload and returns normalized evidence', async () => {
    const app = Fastify()
    await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } })
    const check = vi.fn().mockResolvedValue({ source: 'openai', checkedAt: '2026-10-09T00:00:00.000Z', evidence: [{ source: 'openai', signal: 'synthid', outcome: 'detected', checkedAt: '2026-10-09T00:00:00.000Z' }] })
    registerProvenanceRoute(app, check, { authorize: () => true, allow: () => true })

    const boundary = '----oneimage-test'
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)])
    const response = await app.inject({ method: 'POST', url: '/api/v1/provenance/openai', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ source: 'openai', evidence: [{ signal: 'synthid', outcome: 'detected' }] })
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png', size: 8 }), 'sample.png')
    await app.close()
  })

  it('returns a typed input error when the uploaded file is not an image', async () => {
    const app = Fastify()
    await app.register(multipart)
    const check = vi.fn()
    registerProvenanceRoute(app, check, { authorize: () => true, allow: () => true })
    const boundary = '----oneimage-test'
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`)

    const response = await app.inject({ method: 'POST', url: '/api/v1/provenance/openai', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'invalid-input', retryable: false } })
    expect(check).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects a file whose bytes do not match the declared image MIME', async () => {
    const app = Fastify()
    await app.register(multipart)
    const check = vi.fn()
    registerProvenanceRoute(app, check, { authorize: () => true, allow: () => true })
    const boundary = '----oneimage-test'
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fake.png"\r\nContent-Type: image/png\r\n\r\nnot-a-png\r\n--${boundary}--\r\n`)

    const response = await app.inject({ method: 'POST', url: '/api/v1/provenance/openai', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'invalid-input', retryable: false } })
    expect(check).not.toHaveBeenCalled()
    await app.close()
  })

  it('maps multipart file limits to a payload-too-large response', async () => {
    const app = Fastify()
    await app.register(multipart, { limits: { fileSize: 4 } })
    registerProvenanceRoute(app, vi.fn())
    const boundary = '----oneimage-test'
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.png"\r\nContent-Type: image/png\r\n\r\n123456789\r\n--${boundary}--\r\n`)

    const response = await app.inject({ method: 'POST', url: '/api/v1/provenance/openai', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })

    expect(response.statusCode).toBe(413)
    expect(response.json()).toMatchObject({ error: { code: 'payload-too-large', retryable: false } })
    await app.close()
  })

  it('requires the configured server token before consuming a multipart body', async () => {
    const app = Fastify()
    await app.register(multipart)
    const security: ProvenanceRouteSecurity = {
      authorize: (request) => request.headers['x-oneimage-token'] === 'server-token',
      allow: () => true,
    }
    registerProvenanceRoute(app, vi.fn(), security)

    const response = await app.inject({ method: 'POST', url: '/api/v1/provenance/openai' })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'unauthorized', retryable: false } })
    await app.close()
  })

  it('returns rate-limit after the security port denies a request', async () => {
    const app = Fastify()
    await app.register(multipart)
    registerProvenanceRoute(app, vi.fn(), { authorize: () => true, allow: () => false })

    const response = await app.inject({ method: 'POST', url: '/api/v1/provenance/openai' })

    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({ error: { code: 'rate-limit', retryable: true } })
    await app.close()
  })

  it('allows an explicitly same-origin request when no server token is configured', async () => {
    const app = Fastify()
    await app.register(multipart)
    const check = vi.fn().mockResolvedValue({ source: 'openai', checkedAt: '2026-10-09T00:00:00.000Z', evidence: [] })
    registerProvenanceRoute(app, check, {
      authorize: (request) => request.headers.origin === `http://${request.headers.host}`,
      allow: () => true,
    })
    const boundary = '----oneimage-test'
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)])

    const response = await app.inject({ method: 'POST', url: '/api/v1/provenance/openai', headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })

    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('maps a missing multipart content type to invalid-input', async () => {
    const app = Fastify()
    await app.register(multipart)
    registerProvenanceRoute(app, vi.fn(), { authorize: () => true, allow: () => true })

    const response = await app.inject({ method: 'POST', url: '/api/v1/provenance/openai', payload: 'not multipart' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'invalid-input', retryable: false } })
    await app.close()
  })

  it('maps a non-multipart content type to invalid-input', async () => {
    const app = Fastify()
    await app.register(multipart)
    registerProvenanceRoute(app, vi.fn(), { authorize: () => true, allow: () => true })

    const response = await app.inject({ method: 'POST', url: '/api/v1/provenance/openai', headers: { 'content-type': 'text/plain' }, payload: 'not multipart' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'invalid-input', retryable: false } })
    await app.close()
  })

  it('keeps provenance error mapping scoped away from sibling routes', async () => {
    const app = Fastify()
    await app.register(multipart)
    registerProvenanceRoute(app, vi.fn(), { authorize: () => true, allow: () => true })
    app.get('/api/v1/other', async () => { throw new Error('unrelated failure') })

    const response = await app.inject({ method: 'GET', url: '/api/v1/other' })

    expect(response.statusCode).toBe(500)
    expect(response.json()).not.toHaveProperty('error.code', 'provider-error')
    await app.close()
  })
})
