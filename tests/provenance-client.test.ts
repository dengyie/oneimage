import { describe, expect, it, vi } from 'vitest'
import { checkProvenance, getPublicCapabilities, isProvenanceMimeSupported } from '../src/infrastructure/provenance-client'

describe('browser provenance client', () => {
  it('posts the selected image to the same-origin route and preserves evidence', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      source: 'openai',
      checkedAt: '2026-10-09T00:00:00.000Z',
      evidence: [{ source: 'openai', signal: 'c2pa', outcome: 'detected', validationState: 'trusted', checkedAt: '2026-10-09T00:00:00.000Z' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await checkProvenance(new File(['image'], 'sample.png', { type: 'image/png' }), fetcher)

    expect(result.evidence[0]).toMatchObject({ signal: 'c2pa', outcome: 'detected' })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/provenance/openai', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }))
  })

  it('returns a typed unavailable error for unauthorized or unavailable server routes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'unauthorized', retryable: false, message: 'server authentication required' } }), { status: 401 }))

    await expect(checkProvenance(new File(['image'], 'sample.png', { type: 'image/png' }), fetcher)).rejects.toMatchObject({ code: 'unauthorized', retryable: false })
  })

  it('preserves non-retryable provider-auth errors from the server contract', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'provider-auth', retryable: false, message: 'provider rejected credentials' } }), { status: 502 }))

    await expect(checkProvenance(new File(['image'], 'sample.png', { type: 'image/png' }), fetcher)).rejects.toMatchObject({ code: 'provider-auth', retryable: false, status: 502 })
  })

  it('loads public provider capabilities and validates provenance input formats', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ provenance: { enabled: true, provider: 'openai', maxInputBytes: 25 * 1024 * 1024 } }), { status: 200 }))

    await expect(getPublicCapabilities(fetcher)).resolves.toEqual({ provenance: { enabled: true, provider: 'openai', maxInputBytes: 25 * 1024 * 1024 } })
    expect(isProvenanceMimeSupported('image/png')).toBe(true)
    expect(isProvenanceMimeSupported('image/avif')).toBe(false)
  })

  it('rejects a format outside the shared provenance policy before network access', async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(checkProvenance(new File(['image'], 'sample.avif', { type: 'image/avif' }), fetcher)).rejects.toMatchObject({ code: 'invalid-input', status: 400 })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
