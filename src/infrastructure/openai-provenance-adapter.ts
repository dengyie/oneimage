import { MAX_INPUT_BYTES, SUPPORTED_IMAGE_MIME } from '../domain/image-input'

const SUPPORTED_MIME = new Set<string>(SUPPORTED_IMAGE_MIME)
const OVERSIZE_MESSAGE = `image exceeds the ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB limit`

export interface ProvenanceEvidence {
  source: 'openai'
  signal: 'c2pa' | 'synthid'
  outcome: 'detected' | 'not_detected'
  validationState?: 'trusted' | 'valid' | 'invalid' | 'not_present'
  issuer?: string
  model?: string | null
  generatedAt?: string | null
  checkedAt: string
}

export interface ProvenanceResult {
  source: 'openai'
  checkedAt: string
  evidence: ProvenanceEvidence[]
}

export interface ProvenanceError extends Error {
  code: 'invalid-input' | 'provider-auth' | 'provider-rate-limit' | 'provider-unavailable' | 'provider-timeout' | 'provider-error' | 'request-aborted'
  retryable: boolean
  status: number
}

interface OpenAIProvenanceAdapterOptions {
  apiKey: string
  fetcher?: typeof fetch
  endpoint?: string
  timeoutMs?: number
}

interface OpenAIResult {
  type: 'c2pa' | 'synthid'
  outcome: 'detected' | 'not_detected'
  validation_state?: ProvenanceEvidence['validationState']
  issuer?: string
  model?: string | null
  generated_at?: string | null
}

export class OpenAIProvenanceAdapter {
  private readonly fetcher: typeof fetch
  private readonly endpoint: string
  private readonly timeoutMs: number

  constructor(private readonly options: OpenAIProvenanceAdapterOptions) {
    this.fetcher = options.fetcher ?? fetch
    this.endpoint = options.endpoint ?? 'https://api.openai.com/v1/content_provenance_checks'
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async check(file: Blob, filename: string, requestSignal?: AbortSignal): Promise<ProvenanceResult> {
    if (!this.options.apiKey.trim()) throw createProvenanceError('provider-auth', false, 401, 'OpenAI API key is missing')
    if (!SUPPORTED_MIME.has(file.type)) throw createProvenanceError('invalid-input', false, 400, 'only JPEG, PNG, and WebP input is accepted')
    if (file.size > MAX_INPUT_BYTES) throw createProvenanceError('invalid-input', false, 400, OVERSIZE_MESSAGE)
    if (!filename.trim()) throw createProvenanceError('invalid-input', false, 400, 'filename required')
    if (requestSignal?.aborted) throw createProvenanceError('request-aborted', false, 499, 'provenance request abandoned by client')

    const form = new FormData()
    form.append('file', file, filename)
    const controller = new AbortController()
    let timedOut = false
    let requestAborted = requestSignal?.aborted ?? false
    const onRequestAbort = () => {
      requestAborted = true
      controller.abort(requestSignal?.reason)
    }
    requestSignal?.addEventListener('abort', onRequestAbort, { once: true })
    if (requestSignal?.aborted) onRequestAbort()
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException('provider request timed out', 'AbortError'))
    }, this.timeoutMs)
    let response: Response
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        body: form,
        signal: controller.signal,
      })
    } catch (cause) {
      if (requestAborted && !timedOut) {
        throw createProvenanceError('request-aborted', false, 499, 'provenance request abandoned by client', cause)
      }
      if (timedOut || isAbortError(cause)) {
        throw createProvenanceError('provider-timeout', true, 504, 'OpenAI provenance request timed out', cause)
      }
      throw createProvenanceError('provider-unavailable', true, 503, 'OpenAI provenance service is unavailable', cause)
    } finally {
      clearTimeout(timeout)
      requestSignal?.removeEventListener('abort', onRequestAbort)
    }

    if (!response.ok) throw await normalizeProviderError(response)
    const payload = await response.json() as { results?: unknown }
    if (!Array.isArray(payload.results) || payload.results.some((item) => !isOpenAIResult(item))) {
      throw createProvenanceError('provider-error', true, 502, 'OpenAI returned an invalid provenance response')
    }
    const checkedAt = new Date().toISOString()
    const evidence = (payload.results ?? []).map((item): ProvenanceEvidence => ({
      source: 'openai',
      signal: item.type,
      outcome: item.outcome,
      validationState: item.validation_state,
      issuer: item.issuer,
      model: item.model,
      generatedAt: item.generated_at,
      checkedAt,
    }))
    return { source: 'openai', checkedAt, evidence }
  }
}

function isAbortError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'name' in value && (value as { name?: unknown }).name === 'AbortError'
}

function isOpenAIResult(value: unknown): value is OpenAIResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (item.type !== 'c2pa' && item.type !== 'synthid') return false
  if (item.outcome !== 'detected' && item.outcome !== 'not_detected') return false
  if (item.validation_state !== undefined && !['trusted', 'valid', 'invalid', 'not_present'].includes(String(item.validation_state))) return false
  if (item.model !== undefined && item.model !== null && typeof item.model !== 'string') return false
  if (item.generated_at !== undefined && item.generated_at !== null && typeof item.generated_at !== 'string') return false
  return true
}

async function normalizeProviderError(response: Response): Promise<ProvenanceError> {
  const status = response.status
  const code = status === 400 ? 'invalid-input' : status === 401 || status === 403 || status === 404 ? 'provider-auth' : status === 429 ? 'provider-rate-limit' : status >= 500 ? 'provider-unavailable' : 'provider-error'
  const retryable = code === 'provider-rate-limit' || code === 'provider-unavailable'
  const fallbackMessage = `OpenAI provenance request failed with HTTP ${status}`
  const rawBody = await response.text()
  let message = fallbackMessage
  if (rawBody) {
    try {
      const payload = JSON.parse(rawBody) as { error?: { message?: string } }
      message = payload.error?.message ?? fallbackMessage
    } catch {
      message = fallbackMessage
    }
  }
  return createProvenanceError(code, retryable, status, message)
}

function createProvenanceError(code: ProvenanceError['code'], retryable: boolean, status: number, message: string, cause?: unknown): ProvenanceError {
  const error = new Error(message, cause === undefined ? undefined : { cause }) as ProvenanceError
  error.name = 'ProvenanceError'
  error.code = code
  error.retryable = retryable
  error.status = status
  return error
}
