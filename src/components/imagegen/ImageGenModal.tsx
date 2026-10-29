import React, { useEffect, useState } from 'react'
import { UiIcon } from '../ui/UiIcon'
import {
  fetchImagegenCapabilities,
  generateImage,
  base64ToFile,
  type ImagegenCapabilities,
} from '../../infrastructure/imagegen-client'

interface ImageGenModalProps {
  isOpen: boolean
  onClose: () => void
  /** Called once per generated image; the App feeds the File into loadFile. */
  onGenerated: (file: File, model: string) => void
}

export const ImageGenModal: React.FC<ImageGenModalProps> = ({ isOpen, onClose, onGenerated }) => {
  const [caps, setCaps] = useState<ImagegenCapabilities | null>(null)
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [size, setSize] = useState('')
  const [count, setCount] = useState(1)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revised, setRevised] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setRevised(null)
    let cancelled = false
    void fetchImagegenCapabilities().then((result) => {
      if (cancelled) return
      setCaps(result && result.enabled ? result : null)
      setCapsLoaded(true)
      if (result && result.enabled && result.providers.length > 0) {
        const first = result.providers[0]
        setProviderId((current) => (result.providers.some((p) => p.id === current) ? current : first.id))
        setModel((current) => (result.providers.some((p) => p.models.includes(current)) ? current : first.defaultModel))
        setSize('')
      }
    })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  if (!isOpen) return null

  const provider = caps?.providers.find((p) => p.id === providerId)

  const switchProvider = (id: string) => {
    const next = caps?.providers.find((p) => p.id === id)
    setProviderId(id)
    if (next) {
      setModel(next.defaultModel)
      setSize('')
    }
  }

  const handleGenerate = async () => {
    if (!provider) return
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt) {
      setError('请先输入提示词')
      return
    }
    setLoading(true)
    setError(null)
    setRevised(null)
    const result = await generateImage({
      provider: provider.id,
      model,
      prompt: cleanPrompt,
      size: size || undefined,
      n: count,
    })
    setLoading(false)
    if (!result.ok || !result.data) {
      setError(result.message ?? '生成失败，请稍后重试')
      return
    }
    if (result.data.revisedPrompt) setRevised(result.data.revisedPrompt)
    const files = result.data.images.map((image, index) => base64ToFile(image, index))
    if (files.length === 0) {
      setError('上游没有返回图片')
      return
    }
    // Multi-image generations open the first one and queue the rest through
    // the same callback; the App loads them sequentially.
    onGenerated(files[0], result.data.model)
    for (let i = 1; i < files.length; i++) {
      window.setTimeout(() => onGenerated(files[i], result.data!.model), i * 400)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/95 shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-100 font-medium">
            <UiIcon name="sparkles" className="w-4 h-4 text-emerald-400" />
            <span>AI 生图</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors" aria-label="关闭">
            <UiIcon name="x" className="w-4 h-4" />
          </button>
        </div>

        {capsLoaded && !caps && (
          <div className="text-sm text-zinc-400 bg-zinc-800/60 rounded-xl p-4">
            生图服务尚未配置。站点管理员需要在服务端配置 <code className="text-zinc-300">ONEIMAGE_IMAGE_PROVIDERS_FILE</code> 后才能使用。
          </div>
        )}

        {caps && provider && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs text-zinc-400">生成服务</span>
                <select
                  value={providerId}
                  onChange={(e) => switchProvider(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/60"
                >
                  {caps.providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-zinc-400">模型</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/60"
                >
                  {provider.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>

            {provider.sizes.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">尺寸</span>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/60"
                  >
                    <option value="">模型默认</option>
                    {provider.sizes.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-zinc-400">张数</span>
                  <select
                    value={String(count)}
                    onChange={(e) => setCount(Number(e.target.value))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/60"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-400">提示词</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="描述你想要的画面…"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:border-emerald-500/60"
              />
            </label>

            {revised && (
              <div className="text-xs text-zinc-400 bg-zinc-800/60 rounded-lg p-2.5">
                模型改写后的提示词：{revised}
              </div>
            )}

            {error && (
              <div className="text-xs text-rose-300 bg-rose-950/60 border border-rose-500/30 rounded-lg p-2.5">{error}</div>
            )}

            <button
              onClick={() => void handleGenerate()}
              disabled={loading || !prompt.trim()}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
            >
              {loading ? (
                <>
                  <UiIcon name="loader" className="w-4 h-4 animate-spin" />
                  生成中，可能需要 30-90 秒…
                </>
              ) : (
                <>
                  <UiIcon name="sparkles" className="w-4 h-4" />
                  生成图片
                </>
              )}
            </button>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              生成直接进入编辑器工作台，可继续裁剪、调色、加水印并同步历史。API 密钥保存在服务端，浏览器不会接触。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
