// Client for the server-side imagegen surface. The browser only ever sees
// provider names and model lists — baseUrls and API keys stay in the server
// config, per the project's "browser never holds provider secrets" boundary.

export interface ImagegenProviderInfo {
  id: string
  name: string
  models: string[]
  defaultModel: string
  sizes: string[]
}

export interface ImagegenCapabilities {
  enabled: boolean
  providers: ImagegenProviderInfo[]
}

export interface GeneratedImagePayload {
  mimeType: string
  base64: string
}

export interface ImagegenResponse {
  provider: string
  model: string
  images: GeneratedImagePayload[]
  revisedPrompt?: string
}

export async function fetchImagegenCapabilities(): Promise<ImagegenCapabilities | null> {
  try {
    const res = await fetch('/api/v1/imagegen/capabilities', { credentials: 'include' })
    if (!res.ok) return null
    return (await res.json()) as ImagegenCapabilities
  } catch {
    return null
  }
}

export async function generateImage(params: {
  provider: string
  model: string
  prompt: string
  size?: string
  n?: number
}): Promise<{ ok: boolean; data?: ImagegenResponse; message?: string }> {
  try {
    const res = await fetch('/api/v1/imagegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, message: data?.message || `生成失败（HTTP ${res.status}）` }
    }
    return { ok: true, data: data as ImagegenResponse }
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error && err.name === 'TimeoutError' ? '生成超时，请稍后重试' : '网络连接失败' }
  }
}

export function base64ToFile(image: GeneratedImagePayload, index: number): File {
  const bytes = Uint8Array.from(atob(image.base64), (ch) => ch.charCodeAt(0))
  const ext = image.mimeType.split('/')[1] ?? 'png'
  return new File([bytes], `ai-generated-${Date.now()}-${index + 1}.${ext}`, { type: image.mimeType })
}
