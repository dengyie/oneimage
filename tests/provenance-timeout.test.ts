import { describe, expect, it, vi } from 'vitest'
import { OpenAIProvenanceAdapter } from '../src/infrastructure/openai-provenance-adapter'

describe('OpenAI provenance timeout', () => {
  it('maps an aborted provider request to a retryable timeout error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true })
    }))
    const adapter = new OpenAIProvenanceAdapter({ apiKey: 'test-key', fetcher, timeoutMs: 5 })

    await expect(adapter.check(new Blob(['image'], { type: 'image/png' }), 'sample.png')).rejects.toMatchObject({ code: 'provider-timeout', retryable: true })
  })
})
