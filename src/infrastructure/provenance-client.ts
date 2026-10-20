import type { ProvenanceResult } from './openai-provenance-adapter'
import { SUPPORTED_IMAGE_MIME } from '../domain/image-input'

export interface ProvenanceClientError extends Error {
  code: 'invalid-input' | 'unauthorized' | 'rate-limit' | 'provider-auth' | 'provider-timeout' | 'server-unavailable' | 'provider-error' | 'request-aborted'
  retryable: boolean
  status: number
}

export interface PublicCapabilities {
  provenance: { enabled: boolean; provider: string | null; maxInputBytes: number }
}

export async function checkProvenance(file: File, fetcher: typeof fetch = fetch): Promise<ProvenanceResult> {
  if (!isProvenanceMimeSupported(file.type)) throw createClientError('invalid-input', false, 400, 'JPEG, PNG, or WebP input required')
  const form = new FormData()
  form.append('file', file, file.name)
  const response = await fetcher('/api/v1/provenance/openai', { method: 'POST', body: form })
  if (!response.ok) throw await normalizeClientError(response)
  return await response.json() as ProvenanceResult
}

export function createProvenanceInput(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type || 'application/octet-stream' })
}

export function isProvenanceMimeSupported(mime: string): boolean {
  return (SUPPORTED_IMAGE_MIME as readonly string[]).includes(mime)
}

export async function getPublicCapabilities(fetcher: typeof fetch = fetch): Promise<PublicCapabilities> {
  const response = await fetcher('/api/v1/capabilities')
  if (!response.ok) throw await normalizeClientError(response)
  return await response.json() as PublicCapabilities
}

async function normalizeClientError(response: Response): Promise<ProvenanceClientError> {
  const fallback = `provenance request failed with HTTP ${response.status}`
  const rawBody = await response.text()
  let message = fallback
  let providerCode: string | undefined
  if (rawBody) {
    try {
      const payload = JSON.parse(rawBody) as { error?: { code?: string; message?: string } }
      providerCode = payload.error?.code
      message = payload.error?.message ?? fallback
    } catch { message = fallback }
  }
  const code = providerCode === 'provider-auth' ? 'provider-auth' : providerCode === 'provider-timeout' ? 'provider-timeout' : response.status === 400 ? 'invalid-input' : response.status === 401 ? 'unauthorized' : response.status === 429 ? 'rate-limit' : response.status >= 500 ? 'server-unavailable' : 'provider-error'
  const retryable = code === 'rate-limit' || code === 'provider-timeout' || code === 'server-unavailable'
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
