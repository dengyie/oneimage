import type { ProvenanceResult } from './openai-provenance-adapter'

export interface ProvenanceClientError extends Error {
  code: 'invalid-input' | 'unauthorized' | 'rate-limit' | 'server-unavailable' | 'provider-error'
  retryable: boolean
  status: number
}

export async function checkProvenance(file: File, fetcher: typeof fetch = fetch): Promise<ProvenanceResult> {
  if (!file.type.startsWith('image/')) throw createClientError('invalid-input', false, 400, 'image input required')
  const form = new FormData()
  form.append('file', file, file.name)
  const response = await fetcher('/api/v1/provenance/openai', { method: 'POST', body: form })
  if (!response.ok) throw await normalizeClientError(response)
  return await response.json() as ProvenanceResult
}

async function normalizeClientError(response: Response): Promise<ProvenanceClientError> {
  const code = response.status === 400 ? 'invalid-input' : response.status === 401 ? 'unauthorized' : response.status === 429 ? 'rate-limit' : response.status >= 500 ? 'server-unavailable' : 'provider-error'
  const retryable = code === 'rate-limit' || code === 'server-unavailable'
  const fallback = `provenance request failed with HTTP ${response.status}`
  const rawBody = await response.text()
  let message = fallback
  if (rawBody) {
    try { message = (JSON.parse(rawBody) as { error?: { message?: string } }).error?.message ?? fallback } catch { message = fallback }
  }
  return createClientError(code, retryable, response.status, message)
}

function createClientError(code: ProvenanceClientError['code'], retryable: boolean, status: number, message: string): ProvenanceClientError {
  const error = new Error(message) as ProvenanceClientError
  error.name = 'ProvenanceClientError'
  error.code = code
  error.retryable = retryable
  error.status = status
  return error
}
