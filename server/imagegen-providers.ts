import type { ImagegenProviderConfig } from './imagegen-config'

// Provider adapters for text-to-image. Two upstream dialects cover the
// requested model families:
// - "openai-images": POST {baseUrl}/images/generations — OpenAI gpt-image-*,
//   xAI grok-2-image*, and OpenAI-compatible aggregators (new-api etc., which
//   also front Gemini/DALL-E style models).
// - "gemini": POST {baseUrl}/v1beta/models/{model}:generateContent — direct
//   Google Generative Language API image-out models (gemini-2.5-flash-image).

export interface GeneratedImage {
  mimeType: string
  base64: string
}

export interface ImagegenResult {
  images: GeneratedImage[]
  revisedPrompt?: string
}

export class ImagegenUpstreamError extends Error {
  readonly status: number
  readonly upstreamStatus: number

  constructor(message: string, upstreamStatus: number, status: number) {
    super(message)
    this.name = 'ImagegenUpstreamError'
    this.upstreamStatus = upstreamStatus
    this.status = status
  }
}

const MAX_IMAGE_BYTES = 32 * 1024 * 1024

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

async function readUpstreamError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === 'string') return truncate(parsed.error, 300)
    const message = parsed.error?.message ?? parsed.message
    if (typeof message === 'string' && message.length > 0) return truncate(message, 300)
  } catch {
    // fall through to raw text
  }
  return truncate(text, 300) || `HTTP ${response.status}`
}

function clientStatusFor(upstreamStatus: number): number {
  // The key/quota problem belongs to the operator, not the visitor: keep the
  // contract at 502 with a safe message, except for request-shape issues the
  // client can actually fix.
  if (upstreamStatus === 400 || upstreamStatus === 404 || upstreamStatus === 422) return 502
  if (upstreamStatus === 429) return 429
  return 502
}

async function fetchImageBytes(url: string, apiKey: string | null, signal: AbortSignal, fetchImpl: typeof fetch): Promise<GeneratedImage> {
  const response = await fetchImpl(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal,
  })
  if (!response.ok) {
    throw new ImagegenUpstreamError(`下载生成结果失败：HTTP ${response.status}`, response.status, 502)
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new ImagegenUpstreamError('生成结果超过 32MB 上限', 0, 502)
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0] ?? 'image/png'
  return {
    mimeType: mimeType.startsWith('image/') ? mimeType : 'image/png',
    base64: Buffer.from(buffer).toString('base64'),
  }
}

interface OpenAIImagesResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[]
  error?: { message?: string }
}

async function generateOpenAIImages(
  provider: ImagegenProviderConfig,
  params: { model: string; prompt: string; n: number; size?: string },
  signal: AbortSignal,
  fetchImpl: typeof fetch
): Promise<ImagegenResult> {
  const body: Record<string, unknown> = { model: params.model, prompt: params.prompt, n: params.n }
  if (params.size) body.size = params.size
  const response = await fetchImpl(`${provider.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    throw new ImagegenUpstreamError(await readUpstreamError(response), response.status, clientStatusFor(response.status))
  }
  const payload = (await response.json().catch(() => null)) as OpenAIImagesResponse | null
  const data = payload?.data
  if (!Array.isArray(data) || data.length === 0) {
    throw new ImagegenUpstreamError('上游返回中没有图片数据', 0, 502)
  }
  const images: GeneratedImage[] = []
  for (const item of data) {
    if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
      images.push({ mimeType: 'image/png', base64: item.b64_json })
    } else if (typeof item.url === 'string' && item.url.length > 0) {
      images.push(await fetchImageBytes(item.url, provider.apiKey, signal, fetchImpl))
    }
  }
  if (images.length === 0) {
    throw new ImagegenUpstreamError('上游返回的条目既无 b64_json 也无 url', 0, 502)
  }
  const revisedPrompt = data.find((item) => typeof item.revised_prompt === 'string')?.revised_prompt
  return { images, revisedPrompt: revisedPrompt || undefined }
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[]
    }
  }[]
  error?: { message?: string }
}

async function generateGemini(
  provider: ImagegenProviderConfig,
  params: { model: string; prompt: string; n: number; size?: string },
  signal: AbortSignal,
  fetchImpl: typeof fetch
): Promise<ImagegenResult> {
  const images: GeneratedImage[] = []
  let revisedText: string | undefined
  // generateContent has no per-request image count; n>1 fans out into
  // sequential calls so the daily cap stays the single spend control.
  for (let i = 0; i < params.n; i++) {
    const response = await fetchImpl(`${provider.baseUrl}/v1beta/models/${encodeURIComponent(params.model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
        ...(provider.generationConfig ?? {}),
      }),
      signal,
    })
    if (!response.ok) {
      throw new ImagegenUpstreamError(await readUpstreamError(response), response.status, clientStatusFor(response.status))
    }
    const payload = (await response.json().catch(() => null)) as GeminiResponse | null
    const parts = payload?.candidates?.[0]?.content?.parts ?? []
    let found = false
    for (const part of parts) {
      if (part.inlineData?.data) {
        images.push({
          mimeType: part.inlineData.mimeType ?? 'image/png',
          base64: part.inlineData.data,
        })
        found = true
      } else if (typeof part.text === 'string' && part.text.length > 0 && !revisedText) {
        revisedText = part.text
      }
    }
    if (!found) {
      throw new ImagegenUpstreamError('上游返回中没有图片数据（可能被安全策略拦截或模型不支持生图）', 0, 502)
    }
  }
  return { images, revisedPrompt: revisedText }
}

export function generateImages(
  provider: ImagegenProviderConfig,
  params: { model: string; prompt: string; n: number; size?: string },
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<ImagegenResult> {
  if (!provider.models.includes(params.model)) {
    return Promise.reject(new ImagegenUpstreamError(`模型 ${params.model} 不在该服务的可用列表中`, 0, 400))
  }
  if (provider.type === 'gemini') {
    return generateGemini(provider, params, signal, fetchImpl)
  }
  return generateOpenAIImages(provider, params, signal, fetchImpl)
}
