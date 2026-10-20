import { useEffect, useMemo, useRef, useState } from 'react'
import { validateImageFile } from './application/file-policy'
import { runLocalTool } from './application/local-tool-runner'
import { createToolRegistry } from './domain/tool-registry'
import { MAX_INPUT_BYTES, SUPPORTED_IMAGE_MIME } from './domain/image-input'
import { checkProvenance, createProvenanceInput, getPublicCapabilities, isProvenanceMimeSupported } from './infrastructure/provenance-client'
import type { ProvenanceResult } from './infrastructure/openai-provenance-adapter'
import type { LocalJob } from './domain/local-job'
import type { ToolDefinition } from './domain/tool'
import { ImageEditor } from './components/ImageEditor'
import './styles.css'

const registry = createToolRegistry()

const FORMAT_LABELS: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' }
const INPUT_ACCEPT = SUPPORTED_IMAGE_MIME.join(',')
const INPUT_FORMAT_LABELS = SUPPORTED_IMAGE_MIME.map((mime) => FORMAT_LABELS[mime] ?? mime).join(' · ')
const MAX_INPUT_MB = Math.round(MAX_INPUT_BYTES / 1024 / 1024)

export function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileRevision, setFileRevision] = useState(0)
  const [selectedToolId, setSelectedToolId] = useState('convert')
  const [outputMime, setOutputMime] = useState('image/webp')
  const [quality, setQuality] = useState(88)
  const [resizeWidth, setResizeWidth] = useState('1600')
  const [cropWidth, setCropWidth] = useState('1200')
  const [cropHeight, setCropHeight] = useState('900')
  const [rotation, setRotation] = useState('90')
  const [watermarkText, setWatermarkText] = useState('OneImage')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultName, setResultName] = useState<string | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [job, setJob] = useState<LocalJob | null>(null)
  const [provenance, setProvenance] = useState<ProvenanceResult | null>(null)
  const [provenanceBusy, setProvenanceBusy] = useState(false)
  const [provenanceMessage, setProvenanceMessage] = useState<string | null>(null)
  const [provenanceEnabled, setProvenanceEnabled] = useState(false)
  const [message, setMessage] = useState('选择一张图片，所有 P0 工具默认在本地运行。')
  const controllerRef = useRef<AbortController | null>(null)
  const resultUrlRef = useRef<string | null>(null)

  useEffect(() => () => {
    controllerRef.current?.abort()
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
  }, [])

  useEffect(() => {
    let active = true
    void getPublicCapabilities().then((capabilities) => {
      if (active) setProvenanceEnabled(capabilities.provenance.enabled)
    }).catch(() => {
      if (active) setProvenanceEnabled(false)
    })
    return () => { active = false }
  }, [])

  const selectedTool = useMemo(() => registry.get(selectedToolId) ?? registry.list()[0], [selectedToolId])

  function selectFile(nextFile: File | undefined): void {
    if (!nextFile) return
    controllerRef.current?.abort()
    const validation = validateImageFile(nextFile)
    if (!validation.ok) {
      setMessage(validation.message)
      return
    }
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    setFile(nextFile)
    setFileRevision((revision) => revision + 1)
    if (inputRef.current) inputRef.current.value = ''
    resultUrlRef.current = null
    setResultUrl(null)
    setResultName(null)
    setResultBlob(null)
    setProvenance(null)
    setProvenanceMessage(null)
    setMessage(`${nextFile.name} 已载入，尚未上传服务器。`)
  }

  async function runTool(currentImage: Blob): Promise<void> {
    if (!file) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setMessage(`${selectedTool.title}处理中…`)
    try {
      const input = new File([currentImage], file.name, { type: currentImage.type || file.type, lastModified: file.lastModified })
      const options = {
        outputMime,
        quality: quality / 100,
        ...(selectedTool.id === 'resize' ? { width: Number(resizeWidth) } : {}),
        ...(selectedTool.id === 'crop' ? { cropWidth: Number(cropWidth), cropHeight: Number(cropHeight) } : {}),
        ...(selectedTool.id === 'rotate' ? { rotation: Number(rotation) } : {}),
        ...(selectedTool.id === 'watermark' ? { watermarkText } : {}),
      }
      const result = await runLocalTool(selectedTool.id, input, {
        ...options,
      }, controller.signal, setJob)
      if (controller.signal.aborted) return
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      const nextResultUrl = URL.createObjectURL(result.blob)
      resultUrlRef.current = nextResultUrl
      setResultUrl(nextResultUrl)
      setResultName(result.filename)
      setResultBlob(result.blob)
      setProvenance(null)
      setProvenanceMessage(null)
      setMessage(`已完成：${result.filename}，仍在本地。`)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setMessage('任务已取消。')
        return
      }
      setMessage(error instanceof Error ? error.message : '处理失败，请重试。')
    }
  }

  function cancelTool(): void {
    controllerRef.current?.abort()
  }

  function handleEditorExport(blob: Blob, filename: string): void {
    controllerRef.current?.abort()
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    const nextResultUrl = URL.createObjectURL(blob)
    resultUrlRef.current = nextResultUrl
    setResultUrl(nextResultUrl)
    setResultName(filename)
    setResultBlob(blob)
    setProvenance(null)
    setProvenanceMessage(null)
    setMessage(`已完成：${filename}，仍在本地。`)
  }

  async function inspectProvenance(): Promise<void> {
    if (!file || provenanceBusy) return
    setProvenanceBusy(true)
    setProvenanceMessage(null)
    try {
      const input = resultBlob
        ? createProvenanceInput(resultBlob, resultName ?? 'oneimage-result.png')
        : file
      setProvenance(await checkProvenance(input))
    } catch (error) {
      setProvenance(null)
      setProvenanceMessage(error instanceof Error ? error.message : '来源检查失败，请稍后重试。')
    } finally {
      setProvenanceBusy(false)
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◎</span><span>ONEIMAGE</span></div>
        <div className="topbar-note"><span className="live-dot" />LOCAL-FIRST WORKSPACE</div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">IMAGE / WORKBENCH 01</p>
          <h1>把图片处理<br /><em>留在你手里。</em></h1>
          <p className="lede">一个浏览器优先的图片工作台。常规处理不上传，只有你明确选择的 AI 能力才会离开设备。</p>
        </div>
        <div className="hero-orbit" aria-hidden="true"><span>LOCAL</span><span>PRIVATE</span><span>OPEN</span></div>
      </section>

      <section className="workspace">
        <aside className="toolrail">
          <div className="section-label">TOOLS / P0</div>
          {registry.list().map((tool) => <ToolButton key={tool.id} tool={tool} active={tool.id === selectedTool.id} onClick={() => setSelectedToolId(tool.id)} />)}
          <div className="toolrail-footer"><span className="mini-lock">⌁</span> NO UPLOAD<br />BY DEFAULT</div>
        </aside>

        <section className="canvas-panel">
          <div className="panel-heading"><div><span className="section-label">{selectedTool.category.toUpperCase()} / {selectedTool.id.toUpperCase()}</span><h2>{selectedTool.title}</h2></div><span className="plane-chip">BROWSER</span></div>
          {!file && <div className="dropzone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files[0]) }}>
            <div className="drop-icon">＋</div><strong>拖入图片，或点击选择</strong><span>{INPUT_FORMAT_LABELS} / 最大 {MAX_INPUT_MB} MB</span>
            <input ref={inputRef} type="file" accept={INPUT_ACCEPT} hidden onChange={(event) => selectFile(event.target.files?.[0])} />
          </div>}
          {file && <><ImageEditor key={fileRevision} file={file} outputMime={outputMime} quality={quality / 100} onExport={handleEditorExport} onRunTool={runTool} /><button type="button" className="replace-image" onClick={() => inputRef.current?.click()}>更换原图</button><input ref={inputRef} type="file" accept={INPUT_ACCEPT} hidden onChange={(event) => { const selected = event.target.files?.[0]; event.currentTarget.value = ''; selectFile(selected) }} /></>}
          {resultUrl && <a className="result-link" href={resultUrl} download={resultName ?? 'oneimage-result.png'}><span>↓</span> 下载处理结果 · {resultName}</a>}
          {file && provenanceEnabled && isProvenanceMimeSupported(resultBlob?.type ?? file.type) && <button className="provenance-action" onClick={inspectProvenance} disabled={provenanceBusy}>{provenanceBusy ? '检查中…' : resultBlob ? '检查当前编辑结果的来源信号' : '检查原图的来源信号'} <span>⌁</span></button>}
          {provenance && <ProvenanceCard result={provenance} />}
          {provenanceMessage && <p className="provenance-error">{provenanceMessage}</p>}
        </section>

        <aside className="settings-panel">
          <div className="section-label">CONTROL / 01</div>
          <p className="tool-description">{selectedTool.description}</p>
          {selectedTool.id === 'convert' && <label>输出格式<select value={outputMime} onChange={(event) => setOutputMime(event.target.value)}><option value="image/webp">WebP</option><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/avif">AVIF</option></select></label>}
          {selectedTool.id === 'compress' && <label>质量 <output>{quality}%</output><input type="range" min="10" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>}
          {selectedTool.id === 'resize' && <label>目标宽度（px）<input type="number" min="1" max="8000" value={resizeWidth} onChange={(event) => setResizeWidth(event.target.value)} /></label>}
          {selectedTool.id === 'crop' && <div className="field-row"><label>裁剪宽度<input type="number" min="1" max="8000" value={cropWidth} onChange={(event) => setCropWidth(event.target.value)} /></label><label>裁剪高度<input type="number" min="1" max="8000" value={cropHeight} onChange={(event) => setCropHeight(event.target.value)} /></label></div>}
          {selectedTool.id === 'rotate' && <label>旋转角度<select value={rotation} onChange={(event) => setRotation(event.target.value)}><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>}
          {selectedTool.id === 'watermark' && <label>水印文字<input value={watermarkText} maxLength={80} onChange={(event) => setWatermarkText(event.target.value)} /></label>}
          <div className="privacy-note"><span>⌁</span><div><strong>本地处理</strong><br />编辑预览和导出都不会上传原图。</div></div>
          {job?.status === 'running' && <button className="cancel-action" onClick={cancelTool}>取消任务</button>}
          <p className="status-line"><span className={`status-dot ${job?.status === 'failed' ? 'error' : ''}`} />{message}</p>
        </aside>
      </section>

      <footer className="footer"><span>ONEIMAGE / 0.1.0</span><span>OPEN SOURCE IMAGE WORKBENCH</span><span>LOCAL-FIRST · NO GPU · API WHEN NEEDED</span></footer>
    </main>
  )
}

function ToolButton({ tool, active, onClick }: { tool: ToolDefinition; active: boolean; onClick: () => void }) {
  return <button className={`tool-button ${active ? 'active' : ''}`} onClick={onClick}><span className="tool-index">{String(['convert', 'compress', 'resize', 'crop', 'rotate', 'watermark', 'metadata-clean'].indexOf(tool.id) + 1).padStart(2, '0')}</span><span>{tool.title}</span><span className="tool-arrow">↗</span></button>
}

function ProvenanceCard({ result }: { result: ProvenanceResult }) {
  return <div className="provenance-card"><div className="provenance-card-heading"><span className="section-label">PROVENANCE / OPENAI</span><span className="provenance-time">{new Date(result.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div><p className="provenance-card-note">此处检测的是 C2PA / SynthID 内容溯源信号，不是可见水印是否存在。</p>{result.evidence.length === 0 ? <p>未返回可用的 OpenAI 来源信号。这个结果不等于“不是 AI 生成”。</p> : result.evidence.map((item) => <div className="evidence-row" key={item.signal}><span className={`evidence-badge ${item.outcome === 'detected' ? 'detected' : ''}`}>{item.outcome === 'detected' ? 'DETECTED' : 'NOT DETECTED'}</span><div><strong>{item.signal === 'c2pa' ? 'C2PA Content Credentials' : 'SynthID'}</strong><small>{item.signal === 'c2pa' ? `${item.issuer ?? '未知 issuer'} · ${item.validationState ?? '未验证'}` : 'OpenAI 支持的嵌入式信号'}</small></div></div>)}</div>
}
