import { describe, expect, it } from 'vitest'
import {
  ensureMiganModel,
  MIGAN_MODEL_FALLBACK_URL,
  MIGAN_MODEL_PATH,
  type ModelCacheLike,
} from '../src/infrastructure/inpaint/model-cache'

class MemoryCache implements ModelCacheLike {
  map = new Map<string, Response>()
  async match(url: string): Promise<Response | undefined | null> {
    return this.map.get(url) ?? null
  }
  async put(url: string, response: Response): Promise<void> {
    this.map.set(url, response)
  }
}

function makeDeps(responses: Record<string, Response>) {
  const cache = new MemoryCache()
  const calls: string[] = []
  const deps = {
    fetchImpl: (async (url: string | URL) => {
      calls.push(String(url))
      return responses[String(url)] ?? new Response('not found', { status: 404 })
    }) as typeof fetch,
    caches: { open: async () => cache },
  }
  return { deps, cache, calls }
}

describe('migan model cache', () => {
  it('falls back to HF when self-hosting is missing and caches under the URL that served the bytes', async () => {
    const bytes = new Uint8Array(16)
    const { deps, cache, calls } = makeDeps({
      [MIGAN_MODEL_FALLBACK_URL]: new Response(bytes, { headers: { 'content-length': '16' } }),
    })
    const buffer = await ensureMiganModel(undefined, undefined, deps)
    expect(buffer.byteLength).toBe(16)
    expect(calls[0]).toBe(MIGAN_MODEL_PATH)
    expect(calls[1]).toBe(MIGAN_MODEL_FALLBACK_URL)
    // The cache key must be the serving URL, not the self-hosted path: a
    // fallback copy must never shadow a later-updated self-hosted file.
    expect(cache.map.has(MIGAN_MODEL_FALLBACK_URL)).toBe(true)
    expect(cache.map.has(MIGAN_MODEL_PATH)).toBe(false)
  })

  it('serves the cached self-hosted copy without touching the network', async () => {
    const cache = new MemoryCache()
    cache.map.set(MIGAN_MODEL_PATH, new Response(new Uint8Array(8)))
    let fetchCount = 0
    const deps = {
      fetchImpl: (async () => {
        fetchCount += 1
        return new Response('nope', { status: 500 })
      }) as typeof fetch,
      caches: { open: async () => cache },
    }
    const buffer = await ensureMiganModel(undefined, undefined, deps)
    expect(buffer.byteLength).toBe(8)
    expect(fetchCount).toBe(0)
  })

  it('reports streaming download progress', async () => {
    const { deps } = makeDeps({
      [MIGAN_MODEL_PATH]: new Response(new Uint8Array(10), { headers: { 'content-length': '10' } }),
    })
    const seen: { loaded: number; total: number | null }[] = []
    await ensureMiganModel((progress) => seen.push({ loaded: progress.loadedBytes, total: progress.totalBytes }), undefined, deps)
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect(seen.at(-1)).toEqual({ loaded: 10, total: 10 })
  })

  it('throws a combined error when every source fails', async () => {
    const { deps } = makeDeps({})
    await expect(ensureMiganModel(undefined, undefined, deps)).rejects.toThrow('所有来源均不可用')
  })
})
