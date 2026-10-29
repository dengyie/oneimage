// MI-GAN model delivery. The 26.8 MB pipeline is self-hosted next to the app
// (nginx /models/ on pxed, vite public/models/ in dev) so browsers never touch
// HuggingFace directly; the HF URL is only a fallback when self-hosting is
// absent. Downloaded once, then cached by the Cache API across sessions —
// under the URL that actually served the bytes, so a fallback never shadows a
// later-updated self-hosted copy.

export const MIGAN_MODEL_PATH = '/models/migan_pipeline_v2.onnx'
export const MIGAN_MODEL_FALLBACK_URL =
  'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx'
const CACHE_NAME = 'oneimage-models-v1'

export interface ModelDownloadProgress {
  phase: 'download'
  loadedBytes: number
  totalBytes: number | null
}

export interface ModelCacheLike {
  match(url: string): Promise<Response | undefined | null>
  put(url: string, response: Response): Promise<void>
}

export interface ModelCacheDeps {
  fetchImpl?: typeof fetch
  caches?: { open(name: string): Promise<ModelCacheLike | null> }
}

async function fetchWithProgress(
  url: string,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const response = await fetchImpl(url, { signal })
  if (!response.ok || !response.body) return response
  const totalHeader = response.headers.get('content-length')
  const total = totalHeader ? Number(totalHeader) : null
  if (!onProgress || total === null || !Number.isFinite(total) || total === 0) return response

  // When the upstream declares its size, read straight into one preallocated
  // buffer instead of collecting chunks and re-wrapping them in a Blob — for
  // the 27 MB model that avoids two extra transient copies.
  const totalBytes = total
  const out = new Uint8Array(totalBytes)
  let offset = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (offset + value.byteLength > totalBytes) {
      // Upstream lied about its size; fall back to the chunked path.
      const rest: Uint8Array[] = [out.subarray(0, offset), value]
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        rest.push(next.value)
        offset += next.value.byteLength
      }
      return new Response(new Blob(rest as BlobPart[]), {
        status: response.status,
        headers: response.headers,
      })
    }
    out.set(value, offset)
    offset += value.byteLength
    onProgress({ phase: 'download', loadedBytes: offset, totalBytes })
  }
  if (offset !== totalBytes) {
    return new Response(out.subarray(0, offset), { status: response.status, headers: response.headers })
  }
  return new Response(out, { status: response.status, headers: response.headers })
}

/**
 * Resolves the MI-GAN model bytes, downloading once and reusing the Cache API
 * afterwards. Falls back to HuggingFace when self-hosting is missing; the
 * cache key is always the URL that actually served the bytes.
 */
export async function ensureMiganModel(
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal,
  deps: ModelCacheDeps = {}
): Promise<ArrayBuffer> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const cache = deps.caches
    ? await deps.caches.open(CACHE_NAME).catch(() => null)
    : typeof caches !== 'undefined'
      ? await caches.open(CACHE_NAME).catch(() => null)
      : null

  const candidates = [MIGAN_MODEL_PATH, MIGAN_MODEL_FALLBACK_URL]
  if (cache) {
    for (const url of candidates) {
      const cached = await cache.match(url).catch(() => null)
      if (cached) return cached.arrayBuffer()
    }
  }

  let servedFrom: string = MIGAN_MODEL_PATH
  let response: Response | null = null
  for (const url of candidates) {
    try {
      const attempt = await fetchWithProgress(url, onProgress, signal, fetchImpl)
      if (!attempt.ok) throw new Error(`HTTP ${attempt.status}`)
      response = attempt
      servedFrom = url
      break
    } catch (firstError) {
      if (url === candidates[candidates.length - 1]) {
        throw new Error(`模型下载失败：所有来源均不可用（${firstError instanceof Error ? firstError.message : String(firstError)}）`)
      }
    }
  }
  if (!response || !response.ok) {
    throw new Error('模型下载失败：所有来源均不可用')
  }

  const buffer = await response.arrayBuffer()
  if (cache) {
    // Response(ArrayBuffer) copies internally; the source buffer stays usable,
    // so no defensive slice is needed here.
    await cache.put(servedFrom, new Response(buffer)).catch(() => undefined)
  }
  return buffer
}
