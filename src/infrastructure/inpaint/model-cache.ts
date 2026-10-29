// MI-GAN model delivery. The 26.8 MB pipeline is self-hosted next to the app
// (nginx /models/ on pxed, vite public/models/ in dev) so browsers never touch
// HuggingFace directly; the HF URL is only a fallback when self-hosting is
// absent. Downloaded once, then cached by the Cache API across sessions.

export const MIGAN_MODEL_PATH = '/models/migan_pipeline_v2.onnx'
export const MIGAN_MODEL_FALLBACK_URL =
  'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx'
const CACHE_NAME = 'oneimage-models-v1'

export interface ModelDownloadProgress {
  phase: 'download'
  loadedBytes: number
  totalBytes: number | null
}

async function fetchWithProgress(
  url: string,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
): Promise<Response> {
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) return response
  const totalHeader = response.headers.get('content-length')
  const total = totalHeader ? Number(totalHeader) : null
  if (!onProgress || !Number.isFinite(total) || total === 0) return response

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress({ phase: 'download', loadedBytes: loaded, totalBytes: total })
  }
  return new Response(new Blob(chunks as BlobPart[]), {
    status: response.status,
    headers: response.headers,
  })
}

/**
 * Resolves the MI-GAN model bytes, downloading once and reusing the Cache API
 * afterwards. Falls back to HuggingFace when self-hosted copy is missing.
 */
export async function ensureMiganModel(
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME).catch(() => null) : null

  if (cache) {
    const cached = await cache.match(MIGAN_MODEL_PATH).catch(() => null)
    if (cached) return cached.arrayBuffer()
  }

  let response: Response
  try {
    response = await fetchWithProgress(MIGAN_MODEL_PATH, onProgress, signal)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch (firstError) {
    // Self-hosted miss or network failure: try the public upstream once.
    response = await fetchWithProgress(MIGAN_MODEL_FALLBACK_URL, onProgress, signal)
    if (!response.ok) {
      throw new Error(`模型下载失败：自托管 ${MIGAN_MODEL_PATH} 与备用源均不可用（${firstError instanceof Error ? firstError.message : String(firstError)}）`)
    }
  }
  if (!response.ok) {
    throw new Error(`模型下载失败：HTTP ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  if (cache) {
    await cache.put(MIGAN_MODEL_PATH, new Response(buffer.slice(0))).catch(() => undefined)
  }
  return buffer
}
