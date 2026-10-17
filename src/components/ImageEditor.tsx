import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { exportEditor, renderEditor, schedulePreview } from '../application/editor-renderer'
import { clampCrop, createEditorState, DEFAULT_ADJUSTMENTS, normalizeAspectRatio, pushHistory, redoHistory, rotatedDimensions, undoHistory, type Adjustments, type EditorHistory, type EditorState, type LocalAdjustment, type Rect } from '../domain/editor-state'
import { decodeEditorSource, createBrowserCanvasFactory } from '../infrastructure/editor-canvas'
import { createCropGesture, mapSourceRectToViewport, mapPointerToSource, updateCropGesture, type CropGesture, type CropHandle } from './image-editor-model'

export interface ImageEditorProps {
  file: File
  outputMime: string
  quality: number
  onExport: (blob: Blob, filename: string) => void
}

const factory = createBrowserCanvasFactory()
const PREVIEW_MAX_EDGE = 1600

function aspectValue(value: number | null): string {
  if (value === null) return 'free'
  if (Math.abs(value - 1) < 0.01) return '1:1'
  if (Math.abs(value - 4 / 3) < 0.01) return '4:3'
  if (Math.abs(value - 16 / 9) < 0.01) return '16:9'
  return 'free'
}

export function ImageEditor({ file, outputMime, quality, onExport }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<Awaited<ReturnType<typeof decodeEditorSource>> | null>(null)
  const renderCancelRef = useRef<(() => void) | null>(null)
  const renderAbortRef = useRef<AbortController | null>(null)
  const gestureRef = useRef<CropGesture | null>(null)
  const gestureStartStateRef = useRef<EditorState | null>(null)
  const localGestureStartStateRef = useRef<EditorState | null>(null)
  const localGestureIdRef = useRef<string | null>(null)
  const [history, setHistory] = useState<EditorHistory | null>(null)
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null)
  const [localGestureRef] = useState({ current: null as CropGesture | null })
  const [editorMessage, setEditorMessage] = useState('正在载入原图…')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    sourceRef.current?.close()
    sourceRef.current = null
    setHistory(null)
    setSelectedLocalId(null)
    setEditorMessage('正在载入原图…')
    void decodeEditorSource(file, controller.signal).then((source) => {
      if (controller.signal.aborted) { source.close(); return }
      sourceRef.current = source
      const initial = createEditorState(source.width, source.height)
      setHistory({ past: [], present: initial, future: [] })
      setEditorMessage(`${source.width} × ${source.height} · 本地编辑`)
    }).catch((error) => {
      if (!controller.signal.aborted) setEditorMessage(error instanceof Error ? error.message : '图片载入失败')
    })
    return () => {
      controller.abort()
      renderCancelRef.current?.()
      renderAbortRef.current?.abort()
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [file])

  const state = history?.present ?? null
  const selectedLocal = useMemo(() => state?.localAdjustments.find((item) => item.id === selectedLocalId) ?? null, [selectedLocalId, state])

  useEffect(() => {
    if (!state || !sourceRef.current || !canvasRef.current) return
    renderCancelRef.current?.()
    renderAbortRef.current?.abort()
    const controller = new AbortController()
    renderAbortRef.current = controller
    renderCancelRef.current = schedulePreview(async () => {
      const source = sourceRef.current
      const canvas = canvasRef.current
      if (!source || !canvas) return
      try {
        const rendered = renderEditor(source, state, factory, { maxEdge: PREVIEW_MAX_EDGE, signal: controller.signal, showFullSource: true })
        canvas.width = rendered.width
        canvas.height = rendered.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('editor preview unavailable')
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(rendered.canvas as unknown as CanvasImageSource, 0, 0)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setEditorMessage(error instanceof Error ? error.message : '预览失败')
      }
    })
    return () => { renderCancelRef.current?.(); controller.abort() }
  }, [state])

  function commit(next: EditorState): void {
    if (!history) return
    setHistory(pushHistory(history, next))
  }

  function updateAdjustments(next: Partial<Adjustments>, localId?: string): void {
    if (!state) return
    if (!localId) { commit({ ...state, adjustments: { ...state.adjustments, ...next } }); return }
    commit({ ...state, localAdjustments: state.localAdjustments.map((item) => item.id === localId ? { ...item, adjustments: { ...item.adjustments, ...next } } : item) })
  }

  function addLocalAdjustment(): void {
    if (!state) return
    const width = state.crop.width * 0.35
    const height = state.crop.height * 0.35
    const item: LocalAdjustment = { id: crypto.randomUUID(), rect: { x: state.crop.x + (state.crop.width - width) / 2, y: state.crop.y + (state.crop.height - height) / 2, width, height }, adjustments: { ...DEFAULT_ADJUSTMENTS } }
    commit({ ...state, localAdjustments: [...state.localAdjustments, item] })
    setSelectedLocalId(item.id)
  }

  function setAspectRatio(value: string): void {
    if (!state) return
    const aspectRatio = normalizeAspectRatio(value)
    commit({ ...state, aspectRatio, crop: clampCrop(state.crop, { x: 0, y: 0, width: state.sourceWidth, height: state.sourceHeight }, aspectRatio) })
  }

  function deleteSelectedLocal(): void {
    if (!state || !selectedLocalId) return
    commit({ ...state, localAdjustments: state.localAdjustments.filter((item) => item.id !== selectedLocalId) })
    setSelectedLocalId(null)
  }

  function pointerPosition(event: PointerEvent): { x: number; y: number } {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect || !state) return { x: 0, y: 0 }
    const viewport = rotatedDimensions(state.sourceWidth, state.sourceHeight, state.rotation)
    return mapPointerToSource({ x: (event.clientX - rect.left) * viewport.width / rect.width, y: (event.clientY - rect.top) * viewport.height / rect.height }, { width: state.sourceWidth, height: state.sourceHeight }, state.rotation, state.flipX, state.flipY)
  }

  function startCropGesture(event: PointerEvent, handle: CropHandle): void {
    if (!state) return
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = createCropGesture(handle, pointerPosition(event), state.crop, { x: 0, y: 0, width: state.sourceWidth, height: state.sourceHeight }, state.aspectRatio)
    gestureStartStateRef.current = state
  }

  function moveCropGesture(event: PointerEvent): void {
    if (!gestureRef.current || !state) return
    const crop = updateCropGesture(gestureRef.current, pointerPosition(event))
    setHistory((current) => current ? { ...current, present: { ...current.present, crop } } : current)
  }

  function finishCropGesture(): void {
    if (!gestureRef.current || !gestureStartStateRef.current) return
    setHistory((current) => current ? { ...current, past: [...current.past, gestureStartStateRef.current!], future: [] } : current)
    gestureRef.current = null
    gestureStartStateRef.current = null
  }

  function startLocalGesture(event: PointerEvent, item: LocalAdjustment): void {
    if (!state) return
    event.currentTarget.setPointerCapture(event.pointerId)
    localGestureRef.current = createCropGesture('move', pointerPosition(event), item.rect, { x: 0, y: 0, width: state.sourceWidth, height: state.sourceHeight })
    localGestureStartStateRef.current = state
    localGestureIdRef.current = item.id
    setSelectedLocalId(item.id)
  }

  function moveLocalGesture(event: PointerEvent): void {
    if (!localGestureRef.current || !localGestureIdRef.current) return
    const rect = updateCropGesture(localGestureRef.current, pointerPosition(event))
    setHistory((current) => current ? { ...current, present: { ...current.present, localAdjustments: current.present.localAdjustments.map((item) => item.id === localGestureIdRef.current ? { ...item, rect } : item) } } : current)
  }

  function finishLocalGesture(): void {
    if (!localGestureRef.current || !localGestureStartStateRef.current) return
    setHistory((current) => current ? { ...current, past: [...current.past, localGestureStartStateRef.current!], future: [] } : current)
    localGestureRef.current = null
    localGestureStartStateRef.current = null
    localGestureIdRef.current = null
  }

  async function exportCurrent(): Promise<void> {
    if (!sourceRef.current || !state || busy) return
    setBusy(true)
    try {
      const blob = await exportEditor(sourceRef.current, state, factory, outputMime, quality)
      const extension = blob.type.split('/')[1] === 'jpeg' ? 'jpg' : blob.type.split('/')[1] ?? 'png'
      onExport(blob, `${file.name.replace(/\.[^/.]+$/, '') || 'oneimage'}-edited.${extension}`)
      setEditorMessage('已导出编辑结果，仍在本地。')
    } catch (error) {
      setEditorMessage(error instanceof Error ? error.message : '导出失败')
    } finally { setBusy(false) }
  }

  if (!state) return <div className="editor-loading">{editorMessage}</div>
  const viewport = rotatedDimensions(state.sourceWidth, state.sourceHeight, state.rotation)
  const cropViewport = mapSourceRectToViewport(state.crop, { width: state.sourceWidth, height: state.sourceHeight }, state.rotation, state.flipX, state.flipY)
  const cropStyle = { left: `${cropViewport.x / viewport.width * 100}%`, top: `${cropViewport.y / viewport.height * 100}%`, width: `${cropViewport.width / viewport.width * 100}%`, height: `${cropViewport.height / viewport.height * 100}%` }
  return <div className="image-editor">
    <div className="editor-toolbar">
      <button type="button" onClick={() => commit({ ...state, rotation: (state.rotation + 90) % 360 })} aria-label="旋转 90 度">↻</button>
      <button type="button" onClick={() => commit({ ...state, flipX: !state.flipX })} aria-label="水平镜像">↔</button>
      <button type="button" onClick={() => commit({ ...state, flipY: !state.flipY })} aria-label="垂直镜像">↕</button>
      <label className="aspect-control">比例<select aria-label="裁剪比例" value={aspectValue(state.aspectRatio)} onChange={(event) => setAspectRatio(event.target.value)}><option value="free">自由</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="16:9">16:9</option></select></label>
      <label className="angle-control">角度<input aria-label="旋转角度" type="number" min="-180" max="180" step="1" value={state.rotation > 180 ? state.rotation - 360 : state.rotation} onChange={(event) => commit({ ...state, rotation: Number(event.target.value) || 0 })} /></label>
      <button type="button" onClick={() => history && setHistory(undoHistory(history))} disabled={!history || !history.past.length} aria-label="撤销">↶</button>
      <button type="button" onClick={() => history && setHistory(redoHistory(history))} disabled={!history || !history.future.length} aria-label="重做">↷</button>
      <button type="button" onClick={() => setHistory({ past: [], present: createEditorState(state.sourceWidth, state.sourceHeight), future: [] })} aria-label="重置编辑">重置</button>
      <button type="button" onClick={() => void exportCurrent()} disabled={busy} className="editor-export">{busy ? '导出中…' : '导出结果 ↓'}</button>
    </div>
    <div className="editor-surface" ref={surfaceRef} style={{ aspectRatio: `${rotatedDimensions(state.sourceWidth, state.sourceHeight, state.rotation).width} / ${rotatedDimensions(state.sourceWidth, state.sourceHeight, state.rotation).height}` }} onPointerMove={moveCropGesture} onPointerUp={finishCropGesture} onPointerCancel={finishCropGesture}>
      <canvas ref={canvasRef} aria-label="图片实时预览" />
      <div className="crop-overlay" style={cropStyle}>
        <div className="crop-grid" />
        {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => <button key={handle} type="button" className={`crop-handle ${handle}`} onPointerDown={(event) => startCropGesture(event, handle)} aria-label={`裁剪${handle}角`} />)}
        {(['n', 's', 'e', 'w'] as const).map((handle) => <button key={handle} type="button" className={`crop-handle ${handle}`} onPointerDown={(event) => startCropGesture(event, handle)} aria-label={`裁剪${handle}边`} />)}
        <button type="button" className="crop-move" onPointerDown={(event) => startCropGesture(event, 'move')} aria-label="移动裁剪框" />
      </div>
      {state.localAdjustments.map((item) => { const region = mapSourceRectToViewport(item.rect, { width: state.sourceWidth, height: state.sourceHeight }, state.rotation, state.flipX, state.flipY); return <button key={item.id} type="button" className={`local-region ${item.id === selectedLocalId ? 'selected' : ''}`} style={{ left: `${region.x / viewport.width * 100}%`, top: `${region.y / viewport.height * 100}%`, width: `${region.width / viewport.width * 100}%`, height: `${region.height / viewport.height * 100}%` }} onPointerDown={(event) => startLocalGesture(event, item)} onPointerMove={moveLocalGesture} onPointerUp={finishLocalGesture} onPointerCancel={finishLocalGesture} aria-label="选择局部调整区域" /> })}
    </div>
    <div className="editor-meta"><span>{editorMessage}</span><span>{state.localAdjustments.length} 个局部区域</span></div>
    <div className="editor-controls">
      <AdjustmentControl label="亮度" value={selectedLocal?.adjustments.brightness ?? state.adjustments.brightness} onChange={(value) => updateAdjustments({ brightness: value }, selectedLocalId ?? undefined)} min={-100} max={100} />
      <AdjustmentControl label="对比度" value={selectedLocal?.adjustments.contrast ?? state.adjustments.contrast} onChange={(value) => updateAdjustments({ contrast: value }, selectedLocalId ?? undefined)} min={-100} max={100} />
      <AdjustmentControl label="饱和度" value={selectedLocal?.adjustments.saturation ?? state.adjustments.saturation} onChange={(value) => updateAdjustments({ saturation: value }, selectedLocalId ?? undefined)} min={-100} max={100} />
      <AdjustmentControl label="锐化" value={selectedLocal?.adjustments.sharpen ?? state.adjustments.sharpen} onChange={(value) => updateAdjustments({ sharpen: value }, selectedLocalId ?? undefined)} min={0} max={100} />
      <AdjustmentControl label="模糊" value={selectedLocal?.adjustments.blur ?? state.adjustments.blur} onChange={(value) => updateAdjustments({ blur: value }, selectedLocalId ?? undefined)} min={0} max={20} />
      <div className="local-actions"><button type="button" onClick={addLocalAdjustment}>＋ 局部区域</button><button type="button" onClick={deleteSelectedLocal} disabled={!selectedLocalId}>删除区域</button></div>
    </div>
  </div>
}

function AdjustmentControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="editor-slider">{label}<output>{Math.round(value)}</output><input aria-label={label} type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}
