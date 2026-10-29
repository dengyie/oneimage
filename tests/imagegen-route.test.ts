import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { initDatabase } from '../server/db'
import { registerImagegenRoutes } from '../server/imagegen-route'
import { createRateLimiter } from '../server/rate-limit'
import type { ImagegenProviderConfig } from '../server/imagegen-config'

function provider(overrides: Partial<ImagegenProviderConfig> = {}): ImagegenProviderConfig {
  return {
    id: 'test',
    name: 'Test Provider',
    type: 'openai-images',
    baseUrl: 'https://upstream.example/v1',
    apiKey: 'sk-test',
    models: ['img-model-1'],
    defaultModel: 'img-model-1',
    ...overrides,
  }
}

function createApp(
  providers: ImagegenProviderConfig[],
  options: { dailyCap?: number; rateLimiter?: ReturnType<typeof createRateLimiter>; fetchImpl?: typeof fetch } = {}
) {
  const app = Fastify()
  const appDb = initDatabase(':memory:')
  registerImagegenRoutes(app, appDb.db, {
    providers,
    rateLimiter: options.rateLimiter,
    dailyCap: options.dailyCap ?? 3,
    fetchImpl: options.fetchImpl,
  })
  return { app, appDb }
}

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('imagegen routes', () => {
  it('reports unconfigured as 503 and never leaks keys in capabilities', async () => {
    const { app, appDb } = createApp([])
    const genRes = await app.inject({ method: 'POST', url: '/api/v1/imagegen', payload: { provider: 'x', model: 'y', prompt: 'p' } })
    expect(genRes.statusCode).toBe(503)
    expect(JSON.parse(genRes.body).error).toBe('imagegen_unconfigured')

    const { app: app2, appDb: appDb2 } = createApp([provider()])
    const caps = await app2.inject({ method: 'GET', url: '/api/v1/imagegen/capabilities' })
    expect(caps.statusCode).toBe(200)
    const body = JSON.parse(caps.body)
    expect(body.enabled).toBe(true)
    expect(body.providers[0]).toEqual({ id: 'test', name: 'Test Provider', models: ['img-model-1'], defaultModel: 'img-model-1', sizes: [] })
    expect(caps.body).not.toContain('sk-test')
    expect(caps.body).not.toContain('upstream.example')
    appDb.close()
    appDb2.close()
  })

  it('validates the request contract before spending money', async () => {
    const { app, appDb } = createApp([provider({ sizes: ['1024x1024'] })])
    const cases: { payload: Record<string, unknown>; error: string }[] = [
      { payload: { model: 'img-model-1', prompt: 'p' }, error: 'missing_fields' },
      { payload: { provider: 'test', model: 'img-model-1', prompt: '   ' }, error: 'invalid_prompt' },
      { payload: { provider: 'test', model: 'img-model-1', prompt: 'x'.repeat(4001) }, error: 'invalid_prompt' },
      { payload: { provider: 'nope', model: 'img-model-1', prompt: 'p' }, error: 'invalid_provider' },
      { payload: { provider: 'test', model: 'other-model', prompt: 'p' }, error: 'invalid_model' },
      { payload: { provider: 'test', model: 'img-model-1', prompt: 'p', n: 5 }, error: 'invalid_n' },
      { payload: { provider: 'test', model: 'img-model-1', prompt: 'p', size: '9999x9999' }, error: 'invalid_size' },
    ]
    for (const { payload, error } of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/imagegen', payload })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
      expect(JSON.parse(res.body).error).toBe(error)
    }
    appDb.close()
  })

  it('generates via an OpenAI-compatible upstream with b64_json', async () => {
    const pngBase64 = Buffer.from(PNG_BYTES).toString('base64')
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: pngBase64, revised_prompt: 'better prompt' }],
    }), { status: 200 }))
    const { app, appDb } = createApp([provider({ sizes: ['1024x1024'] })], { fetchImpl: fetchImpl as unknown as typeof fetch })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imagegen',
      payload: { provider: 'test', model: 'img-model-1', prompt: 'a cat in space', n: 1, size: '1024x1024' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.provider).toBe('test')
    expect(body.model).toBe('img-model-1')
    expect(body.images).toHaveLength(1)
    expect(body.images[0].mimeType).toBe('image/png')
    expect(body.images[0].base64).toBe(pngBase64)
    expect(body.revisedPrompt).toBe('better prompt')

    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe('https://upstream.example/v1/images/generations')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-test' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      model: 'img-model-1',
      prompt: 'a cat in space',
      n: 1,
      size: '1024x1024',
    })
    appDb.close()
  })

  it('downloads url-style upstream results and strips size when unlisted', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).endsWith('/images/generations')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/out.png' }] }), { status: 200 })
      }
      return new Response(PNG_BYTES as unknown as BodyInit, { status: 200, headers: { 'content-type': 'image/png' } })
    })
    const { app, appDb } = createApp([provider()], { fetchImpl: fetchImpl as unknown as typeof fetch })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imagegen',
      payload: { provider: 'test', model: 'img-model-1', prompt: 'a cat' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.images).toHaveLength(1)
    expect(body.images[0].mimeType).toBe('image/png')
    // size was not in provider.sizes, so the upstream body must not carry it.
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string).size).toBeUndefined()
    appDb.close()
  })

  it('maps upstream auth/quota failures to safe client errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), { status: 401 }))
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    registerImagegenRoutes(app, appDb.db, { providers: [provider()], dailyCap: 3, fetchImpl: fetchImpl as unknown as typeof fetch })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imagegen',
      payload: { provider: 'test', model: 'img-model-1', prompt: 'a cat' },
    })
    expect(res.statusCode).toBe(502)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('upstream_error')
    expect(body.upstreamStatus).toBe(401)
    expect(body.message).toBe('Incorrect API key')
    appDb.close()
  })

  it('counts every attempt against the durable daily cap', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }))
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    registerImagegenRoutes(app, appDb.db, { providers: [provider()], dailyCap: 2, fetchImpl: fetchImpl as unknown as typeof fetch })
    const headers = { 'cf-connecting-ip': '203.0.113.5' }
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/imagegen', headers, payload: { provider: 'test', model: 'img-model-1', prompt: 'p' } })
      expect(res.statusCode).toBe(502)
    }
    const capped = await app.inject({ method: 'POST', url: '/api/v1/imagegen', headers, payload: { provider: 'test', model: 'img-model-1', prompt: 'p' } })
    expect(capped.statusCode).toBe(429)
    expect(JSON.parse(capped.body).error).toBe('daily_cap_exceeded')

    // Another client is unaffected.
    const other = await app.inject({ method: 'POST', url: '/api/v1/imagegen', headers: { 'cf-connecting-ip': '198.51.100.9' }, payload: { provider: 'test', model: 'img-model-1', prompt: 'p' } })
    expect(other.statusCode).toBe(502)

    // The cap is durable in SQLite.
    const rows = appDb.db.prepare('SELECT count FROM imagegen_usage').all() as unknown as { count: number }[]
    expect(rows.reduce((acc, r) => acc + r.count, 0)).toBe(3)
    appDb.close()
  })

  it('rejects rate-limited clients before the upstream call', async () => {
    const fetchImpl = vi.fn()
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    registerImagegenRoutes(app, appDb.db, {
      providers: [provider()],
      dailyCap: 100,
      rateLimiter: createRateLimiter({ windowMs: 60_000, maxRequestsPerWindow: 2, maxTrackedClients: 100 }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const headers = { 'cf-connecting-ip': '203.0.113.77' }
    for (let i = 0; i < 2; i++) {
      await app.inject({ method: 'POST', url: '/api/v1/imagegen', headers, payload: { provider: 'test', model: 'img-model-1', prompt: 'p' } })
    }
    const throttled = await app.inject({ method: 'POST', url: '/api/v1/imagegen', headers, payload: { provider: 'test', model: 'img-model-1', prompt: 'p' } })
    expect(throttled.statusCode).toBe(429)
    expect(JSON.parse(throttled.body).error).toBe('rate_limited')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    appDb.close()
  })

  it('gemini adapter parses inlineData and fans out n sequentially', async () => {
    const pngBase64 = Buffer.from(PNG_BYTES).toString('base64')
    let calls = 0
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls += 1
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: pngBase64 } }] } }],
      }), { status: 200 })
    })
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    registerImagegenRoutes(app, appDb.db, {
      providers: [provider({
        id: 'google',
        type: 'gemini',
        baseUrl: 'https://generativelanguage.example',
        models: ['gemini-2.5-flash-image'],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      })],
      dailyCap: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imagegen',
      payload: { provider: 'google', model: 'gemini-2.5-flash-image', prompt: 'a cat', n: 2 },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.images).toHaveLength(2)
    expect(body.images[0].mimeType).toBe('image/png')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe('https://generativelanguage.example/v1beta/models/gemini-2.5-flash-image:generateContent')
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'sk-test' })
    // generationConfig contents merge verbatim into the body (Google API shape),
    // not nested under a key.
    expect(JSON.parse((init as RequestInit).body as string).responseModalities).toEqual(['TEXT', 'IMAGE'])
    appDb.close()
  })
})
