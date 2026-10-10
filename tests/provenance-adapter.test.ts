import { describe, expect, it, vi } from 'vitest'
import { OpenAIProvenanceAdapter } from '../src/infrastructure/openai-provenance-adapter'

describe('OpenAI provenance adapter', () => {
  it('maps independent C2PA and SynthID results without collapsing confidence', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      object: 'content_provenance_check',
      created_at: 1778000000,
      results: [
        { type: 'c2pa', outcome: 'detected', validation_state: 'trusted', issuer: 'OpenAI OpCo, LLC', model: 'gpt-image', generated_at: '2026-07-27T18:34:12Z' },
        { type: 'synthid', outcome: 'not_detected', model: null, generated_at: null },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const adapter = new OpenAIProvenanceAdapter({ apiKey: 'test-key', fetcher })

    const result = await adapter.check(new Blob(['image'], { type: 'image/png' }), 'sample.png')

    expect(result).toEqual(expect.objectContaining({ source: 'openai', checkedAt: expect.any(String) }))
    expect(result.evidence).toEqual([
      expect.objectContaining({ signal: 'c2pa', outcome: 'detected', validationState: 'trusted', issuer: 'OpenAI OpCo, LLC' }),
      expect.objectContaining({ signal: 'synthid', outcome: 'not_detected' }),
    ])
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/content_provenance_checks',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer test-key' } }),
    )
  })

  it('maps provider access failures to typed errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 }))
    const adapter = new OpenAIProvenanceAdapter({ apiKey: 'test-key', fetcher })

    await expect(adapter.check(new Blob(['image'], { type: 'image/png' }), 'sample.png')).rejects.toMatchObject({
      code: 'provider-auth',
      retryable: false,
    })
  })

  it('rejects unsupported local input before making a provider request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const adapter = new OpenAIProvenanceAdapter({ apiKey: 'test-key', fetcher })

    await expect(adapter.check(new Blob(['text'], { type: 'text/plain' }), 'notes.txt')).rejects.toMatchObject({ code: 'invalid-input', status: 400 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects malformed provider evidence instead of passing it to the UI', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [{ type: 'unknown', outcome: 'detected' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const adapter = new OpenAIProvenanceAdapter({ apiKey: 'test-key', fetcher })

    await expect(adapter.check(new Blob(['image'], { type: 'image/png' }), 'sample.png')).rejects.toMatchObject({ code: 'provider-error', retryable: true })
  })
})
