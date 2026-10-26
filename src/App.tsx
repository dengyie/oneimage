import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { validateImageFile } from './application/file-policy'
import { exportEditor, type DecodedSource } from './application/editor-renderer'
import { createBrowserCanvasFactory, decodeEditorSource } from './infrastructure/editor-canvas'
import {
  type EditorHistory,
  type EditorState,
  type Adjustments,
  type TextBgStyle,
  createEditorState,
  pushHistory,
  undoHistory,
  redoHistory,
  normalizeAspectRatio,
  rotateEditorState,
} from './domain/editor-state'
import {
  checkProvenance,
  createProvenanceInput,
} from './infrastructure/provenance-client'
import type { ProvenanceResult } from './infrastructure/openai-provenance-adapter'
import { CanvasViewport } from './components/editor/CanvasViewport'
import { TopActionBar } from './components/editor/TopActionBar'
import { BottomDock, type ActiveTool } from './components/editor/BottomDock'
import { EmptyDropzone } from './components/editor/EmptyDropzone'
import { UserNavCapsule } from './components/navigation/UserNavCapsule'
import { AuthModal } from './components/auth/AuthModal'
import { ProfileModal } from './components/auth/ProfileModal'
import { HistoryDrawer, type UnifiedHistoryItem } from './components/history/HistoryDrawer'
import {
  fetchCurrentUser,
  logoutUser,
  fetchCloudProjects,
  saveCloudProject,
  deleteCloudProject,
  type SafeUser,
  type CloudProject,
} from './infrastructure/auth-client'
import {
  listLocalHistory,
  saveLocalHistory,
  deleteLocalHistory,
  clearAllLocalHistory,
  type LocalHistoryItem,
} from './infrastructure/history-storage'
import type { MarkupMode } from './components/editor/SubToolbars/MarkupSubToolbar'
import type { MosaicType } from './components/editor/SubToolbars/MosaicSubToolbar'
import type { WatermarkLayout, WatermarkEraseType } from './components/editor/SubToolbars/WatermarkSubToolbar'
import './styles.css'

function generateThumbnailFromSource(source: DecodedSource, maxEdge = 320): string {
  if (typeof document === 'undefined') return ''
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height))
  const thumbW = Math.max(16, Math.round(source.width * scale))
  const thumbH = Math.max(16, Math.round(source.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = thumbW
  canvas.height = thumbH
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'medium'
  source.draw(ctx, thumbW, thumbH)
  return canvas.toDataURL('image/webp', 0.8)
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const factory = useMemo(() => createBrowserCanvasFactory(), [])

  // Loaded File & Source Bitmap
  const [file, setFile] = useState<File | null>(null)
  const [decodedSource, setDecodedSource] = useState<DecodedSource | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Editor Domain History
  const [history, setHistory] = useState<EditorHistory | null>(null)
  const currentDraftIdRef = useRef<string | null>(null)

  // Active User & Auth State
  const [currentUser, setCurrentUser] = useState<SafeUser | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)

  // History & Storage State
  const [localHistoryItems, setLocalHistoryItems] = useState<LocalHistoryItem[]>([])
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([])

  // Cleanup decoded bitmap on unmount
  useEffect(() => {
    return () => {
      decodedSource?.close()
    }
  }, [decodedSource])

  // Active Tooling & SubToolbar State
  const [activeTool, setActiveTool] = useState<ActiveTool>('none')

  // Tool settings
  const [cropRatio, setCropRatio] = useState('free')
  const [markupMode, setMarkupMode] = useState<MarkupMode>('brush')
  const [markupColor, setMarkupColor] = useState('#ef4444')
  const [markupWidth, setMarkupWidth] = useState(6)
  const [mosaicType, setMosaicType] = useState<MosaicType>('pixel')
  const [mosaicBlockSize, setMosaicBlockSize] = useState(16)
  const [textStyle, setTextStyle] = useState<TextBgStyle>('translucent')
  const [textColor, setTextColor] = useState('#ffffff')
  const [textSize, setTextSize] = useState(28)

  // Compress & Export settings
  const [outputMime, setOutputMime] = useState('image/webp')
  const [quality, setQuality] = useState(85)
  const [stripMetadata, setStripMetadata] = useState(true)
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Provenance state
  const [isCheckingProvenance, setIsCheckingProvenance] = useState(false)
  const [provenanceResult, setProvenanceResult] = useState<{ detected: boolean; note?: string } | null>(null)
  const [provenanceResultDetail, setProvenanceResultDetail] = useState<ProvenanceResult | null>(null)
  const [provenanceError, setProvenanceError] = useState<string | null>(null)

  // Viewport Camera (Pan & Zoom)
  const [zoomScale, setZoomScale] = useState(1.0)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isComparingOriginal, setIsComparingOriginal] = useState(false)

  // Toast feedback
  const [toast, setToast] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const showToast = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ text, type })
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 3000)
  }, [])

  // Check current user session on load
  useEffect(() => {
    let active = true
    void fetchCurrentUser()
      .then((user) => {
        if (active && user) {
          setCurrentUser(user)
        }
      })
      .catch((err: unknown) => {
        console.warn('Session check skipped:', err)
      })
    return () => {
      active = false
    }
  }, [])

  // Refresh local & cloud history
  const refreshHistory = useCallback(async () => {
    try {
      const locals = await listLocalHistory()
      setLocalHistoryItems(locals)
    } catch (err: unknown) {
      console.warn('Load local history failed:', err)
    }

    if (currentUser) {
      try {
        const projects = await fetchCloudProjects()
        setCloudProjects(projects)
      } catch (err: unknown) {
        console.warn('Load cloud projects failed:', err)
      }
    } else {
      setCloudProjects([])
    }
  }, [currentUser])

  // Trigger refresh when user login state changes
  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  // History state updates
  const currentState = history?.present || null

  // Auto-persist the current draft (debounced) whenever the editor state
  // changes. One effect owns persistence so commit/undo/redo/revert all flow
  // through it without side effects inside state updaters.
  const persistWarnedRef = useRef(false)
  const pendingPersistRef = useRef<{ file: File; state: EditorState; source: DecodedSource } | null>(null)

  const persistDraftNow = useCallback(
    async (targetFile: File, state: EditorState, source: DecodedSource) => {
      const draftId = currentDraftIdRef.current
      if (!draftId) return
      try {
        // The storage layer owns the per-draft invariants: it preserves cloud
        // linkage across upserts, reuses the stored thumbnail (the original
        // image never changes for a draft id) and writes the original blob
        // exactly once. This call only supplies fresh editor state.
        const saved = await saveLocalHistory({
          id: draftId,
          title: targetFile.name.replace(/\.[^/.]+$/, ''),
          fileName: targetFile.name,
          fileSize: targetFile.size,
          mimeType: targetFile.type || 'image/jpeg',
          width: source.width,
          height: source.height,
          thumbnail: generateThumbnailFromSource(source, 320),
          originalBlob: targetFile,
          editorState: state,
          updatedAt: Date.now(),
        })

        if (saved === null) {
          if (!persistWarnedRef.current) {
            persistWarnedRef.current = true
            showToast('本地草稿保存失败（浏览器存储空间不足），请及时导出保留成果', 'error')
          }
          return
        }

        const locals = await listLocalHistory()
        setLocalHistoryItems(locals)
      } catch (err) {
        console.warn('Auto-save to IndexedDB skipped:', err)
        if (!persistWarnedRef.current) {
          persistWarnedRef.current = true
          showToast('本地草稿保存失败，请及时导出保留成果', 'error')
        }
      }
    },
    [showToast]
  )

  useEffect(() => {
    const state = history?.present
    if (!file || !decodedSource || !state) return
    pendingPersistRef.current = { file, state, source: decodedSource }
    const timer = window.setTimeout(() => {
      const pending = pendingPersistRef.current
      if (!pending) return
      pendingPersistRef.current = null
      void persistDraftNow(pending.file, pending.state, pending.source)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [file, decodedSource, history?.present, persistDraftNow])

  // Flush a pending debounced save before the page goes away, so a quick edit
  // followed by a tab close still lands in IndexedDB.
  const flushPendingPersist = useCallback(() => {
    const pending = pendingPersistRef.current
    if (!pending) return
    pendingPersistRef.current = null
    void persistDraftNow(pending.file, pending.state, pending.source)
  }, [persistDraftNow])

  useEffect(() => {
    const flush = () => {
      const pending = pendingPersistRef.current
      if (!pending) return
      pendingPersistRef.current = null
      void persistDraftNow(pending.file, pending.state, pending.source)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [persistDraftNow])

  // Load and decode an image file
  const loadFile = useCallback(
    async (nextFile: File) => {
      const validation = validateImageFile(nextFile)
      if (!validation.ok) {
        setErrorMessage(validation.message)
        showToast(validation.message, 'error')
        return
      }

      setErrorMessage(null)
      setIsProcessing(true)

      try {
        const decoded = await decodeEditorSource(nextFile)
        decodedSource?.close()
        setFile(nextFile)
        setDecodedSource(decoded)

        const initial = createEditorState(decoded.width, decoded.height)
        setHistory({ past: [], present: initial, future: [] })
        setActiveTool('none')
        setProvenanceResult(null)
        setProvenanceResultDetail(null)
        setProvenanceError(null)

        // Assign new draft ID
        const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        currentDraftIdRef.current = draftId

        // Fit image nicely into screen viewport
        const margin = 120
        const availW = window.innerWidth - margin
        const availH = window.innerHeight - margin
        const fitScale = Math.min(1.0, Math.min(availW / decoded.width, availH / decoded.height))
        setZoomScale(Math.max(0.1, Number(fitScale.toFixed(2))))
        setPanOffset({ x: 0, y: 0 })

        // Auto-save of the initial draft is owned by the persistence effect.

        showToast(`已载入 ${nextFile.name}，完全在本地处理`, 'success')
      } catch (err) {
        console.error('Failed to decode image:', err)
        setErrorMessage('图片解析失败，可能格式损坏或不支持')
        showToast('图片解析失败', 'error')
      } finally {
        setIsProcessing(false)
      }
    },
    [decodedSource, showToast]
  )

  // History state updates
  const handleStateChange = useCallback((nextState: EditorState) => {
    setHistory((prev) => (prev ? { ...prev, present: nextState } : null))
  }, [])

  const handleCommitHistory = useCallback((nextState: EditorState) => {
    setHistory((prev) => (prev ? pushHistory(prev, nextState) : null))
  }, [])

  const handleUndo = useCallback(() => {
    setHistory((prev) => (prev ? undoHistory(prev) : null))
  }, [])

  const handleRedo = useCallback(() => {
    setHistory((prev) => (prev ? redoHistory(prev) : null))
  }, [])

  const handleRevert = useCallback(() => {
    if (!decodedSource || !file) return
    const initial = createEditorState(decodedSource.width, decodedSource.height)
    setHistory((prev) => (prev ? pushHistory(prev, initial) : null))
    showToast('已还原为原始状态', 'info')
  }, [decodedSource, file, showToast])

  // Crop controls
  const handleRatioSelect = useCallback(
    (ratioStr: string) => {
      if (!currentState) return
      setCropRatio(ratioStr)
      const ratio = normalizeAspectRatio(ratioStr)
      const next = { ...currentState, aspectRatio: ratio }
      handleStateChange(next)
      handleCommitHistory(next)
    },
    [currentState, handleStateChange, handleCommitHistory]
  )

  const handleRotate90 = useCallback(() => {
    if (!currentState) return
    const next = rotateEditorState(currentState, 1)
    handleStateChange(next)
    handleCommitHistory(next)
  }, [currentState, handleStateChange, handleCommitHistory])

  const handleFlipH = useCallback(() => {
    if (!currentState) return
    const next = { ...currentState, flipX: !currentState.flipX }
    handleStateChange(next)
    handleCommitHistory(next)
  }, [currentState, handleStateChange, handleCommitHistory])

  const handleFlipV = useCallback(() => {
    if (!currentState) return
    const next = { ...currentState, flipY: !currentState.flipY }
    handleStateChange(next)
    handleCommitHistory(next)
  }, [currentState, handleStateChange, handleCommitHistory])

  const handleResetCrop = useCallback(() => {
    if (!currentState || !decodedSource) return
    const next = {
      ...currentState,
      crop: { x: 0, y: 0, width: decodedSource.width, height: decodedSource.height },
      aspectRatio: null,
    }
    setCropRatio('free')
    handleStateChange(next)
    handleCommitHistory(next)
  }, [currentState, decodedSource, handleStateChange, handleCommitHistory])

  // Adjustments change
  const handleAdjustmentsChange = useCallback(
    (adj: Adjustments) => {
      if (!currentState) return
      const next = { ...currentState, adjustments: adj }
      handleStateChange(next)
    },
    [currentState, handleStateChange]
  )

  const handleAdjustmentsReset = useCallback(() => {
    if (!currentState) return
    const next = {
      ...currentState,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpen: 0, blur: 0 },
    }
    handleStateChange(next)
    handleCommitHistory(next)
    showToast('调色已重置', 'info')
  }, [currentState, handleStateChange, handleCommitHistory, showToast])

  // Export to Blob
  const exportImage = useCallback(
    async (mime: string, q: number): Promise<{ blob: Blob; filename: string }> => {
      if (!decodedSource || !currentState || !file) {
        throw new Error('未加载图片')
      }
      const blob = await exportEditor(decodedSource, currentState, factory, mime, q / 100)
      const baseName = file.name.replace(/\.[^/.]+$/, '')
      const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'avif'
      const filename = `${baseName}_edited.${ext}`
      return { blob, filename }
    },
    [decodedSource, currentState, file, factory]
  )

  // Download Trigger
  const handleQuickExport = useCallback(async () => {
    if (!file || !decodedSource || !currentState) return
    setIsProcessing(true)
    try {
      const { blob, filename } = await exportImage(outputMime, quality)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      showToast(`已导出并下载：${filename}`, 'success')
    } catch (err) {
      console.error('Export failed:', err)
      showToast('导出失败，请重试', 'error')
    } finally {
      setIsProcessing(false)
    }
  }, [file, decodedSource, currentState, exportImage, outputMime, quality, showToast])

  const handleExportFormat = useCallback(
    async (mime: string) => {
      setOutputMime(mime)
      setIsProcessing(true)
      try {
        const { blob, filename } = await exportImage(mime, quality)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        showToast(`已保存为 ${mime.split('/')[1].toUpperCase()}：${filename}`, 'success')
      } catch (err) {
        console.error('Export failed:', err)
        showToast('保存失败', 'error')
      } finally {
        setIsProcessing(false)
      }
    },
    [exportImage, quality, showToast]
  )

  // Copy to Clipboard (as PNG)
  const handleCopyToClipboard = useCallback(async () => {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      showToast('当前浏览器不支持直接写入剪贴板图片', 'error')
      return
    }
    setIsProcessing(true)
    try {
      const { blob } = await exportImage('image/png', 100)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      showToast('已复制图片到系统剪贴板！可以直接在微信/QQ等按 ⌘V 粘贴', 'success')
    } catch (err) {
      console.error('Copy to clipboard failed:', err)
      showToast('复制到剪贴板失败', 'error')
    } finally {
      setIsProcessing(false)
    }
  }, [exportImage, showToast])

  // Live estimated size (debounced)
  useEffect(() => {
    if (!decodedSource || !currentState || !file) {
      setEstimatedBytes(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const { blob } = await exportImage(outputMime, quality)
        setEstimatedBytes(blob.size)
      } catch {
        // ignore background estimation error
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [decodedSource, currentState, file, outputMime, quality, exportImage])

  // Provenance AI Signal Check
  const handleCheckProvenance = useCallback(async () => {
    if (!file || !decodedSource || !currentState) return
    setIsCheckingProvenance(true)
    try {
      const { blob } = await exportImage('image/jpeg', 92)
      const input = createProvenanceInput(blob, file.name)
      const result = await checkProvenance(input)
      const detected = result.evidence.some((e) => e.outcome === 'detected')
      const note =
        result.evidence.length > 0
          ? result.evidence
              .map(
                (e) =>
                  `${e.signal.toUpperCase()}: ${e.outcome === 'detected' ? '已检出' : '未检出'}${
                    e.issuer ? ` (${e.issuer})` : ''
                  }`
              )
              .join(' · ')
          : detected
          ? '已识别到数字水印或元数据来源标记'
          : '未检出嵌入式 AI 来源信号'
      setProvenanceResult({ detected, note })
      setProvenanceResultDetail(result)
      showToast(detected ? '检出 AI 来源信号' : '未检出 AI 信号', detected ? 'info' : 'success')
    } catch (err) {
      console.error('Provenance check failed:', err)
      showToast('来源检测失败，服务可能未开启', 'error')
    } finally {
      setIsCheckingProvenance(false)
    }
  }, [file, decodedSource, currentState, exportImage, showToast])

  // Watermark Actions
  const handleAddWatermark = useCallback(
    (options: { text: string; layout: WatermarkLayout; opacity: number; color: string }) => {
      if (!currentState) return
      const layerId = `watermark_${Date.now()}`
      const newLayer = {
        id: layerId,
        type: 'watermark' as const,
        text: options.text,
        watermarkStyle: options.layout,
        opacity: options.opacity,
        color: options.color,
        strokeWidth: 0,
      }
      const next = {
        ...currentState,
        annotations: [...(currentState.annotations || []), newLayer],
      }
      handleStateChange(next)
      handleCommitHistory(next)
      showToast(options.layout === 'tile' ? '已添加平铺全图防盗水印' : '已添加右下角署名水印', 'success')
    },
    [currentState, handleStateChange, handleCommitHistory, showToast]
  )

  const handleAddEraseRegion = useCallback(
    (eraseType: WatermarkEraseType) => {
      if (!currentState) return
      const cropW = currentState.crop.width
      const cropH = currentState.crop.height
      const boxW = Math.min(Math.round(cropW * 0.4), 320)
      const boxH = Math.min(Math.round(cropH * 0.2), 120)
      const boxX = currentState.crop.x + Math.round((cropW - boxW) / 2)
      const boxY = currentState.crop.y + Math.round((cropH - boxH) / 2)

      const layerId = `erase_${Date.now()}`
      let newLayer
      if (eraseType === 'blackout') {
        newLayer = {
          id: layerId,
          type: 'rect' as const,
          rect: { x: boxX, y: boxY, width: boxW, height: boxH },
          color: '#000000',
          strokeWidth: 0,
          opacity: 1,
        }
      } else {
        newLayer = {
          id: layerId,
          type: 'mosaic' as const,
          rect: { x: boxX, y: boxY, width: boxW, height: boxH },
          color: '#000000',
          strokeWidth: 0,
          mosaicType: (eraseType === 'blur' ? 'blur' : 'pixel') as 'blur' | 'pixel',
          mosaicBlockSize: eraseType === 'blur' ? 24 : 16,
        }
      }
      const next = {
        ...currentState,
        annotations: [...(currentState.annotations || []), newLayer],
      }
      handleStateChange(next)
      handleCommitHistory(next)
      showToast('已在画面中央生成水印消除遮罩选区（支持自由移动或缩放）', 'success')
    },
    [currentState, handleStateChange, handleCommitHistory, showToast]
  )

  const handleCheckProvenanceTarget = useCallback(
    async (target: 'current' | 'original') => {
      if (!file) return
      setIsCheckingProvenance(true)
      setProvenanceError(null)
      try {
        let blob: Blob
        let filename = file.name
        if (target === 'original') {
          blob = file
        } else {
          if (!decodedSource || !currentState) return
          const exported = await exportImage('image/jpeg', 92)
          blob = exported.blob
          filename = exported.filename
        }
        const input = createProvenanceInput(blob, filename)
        const result = await checkProvenance(input)
        setProvenanceResultDetail(result)
        const detected = result.evidence.some((e) => e.outcome === 'detected')
        const note =
          result.evidence.length > 0
            ? result.evidence
                .map(
                  (e) =>
                    `${e.signal.toUpperCase()}: ${e.outcome === 'detected' ? '已检出' : '未检出'}${
                      e.issuer ? ` (${e.issuer})` : ''
                    }`
                )
                .join(' · ')
            : detected
            ? '已识别到数字水印或元数据来源标记'
            : '未检出嵌入式 AI 来源信号'
        setProvenanceResult({ detected, note })
        showToast(
          detected ? '检出 AI / C2PA 隐形水印信号' : '未检出嵌入式 AI / C2PA 信号',
          detected ? 'info' : 'success'
        )
      } catch (err: unknown) {
        console.error('Provenance check failed:', err)
        const msg = err instanceof Error ? err.message : '来源检测服务响应异常'
        setProvenanceError(msg)
        showToast(`检测失败: ${msg}`, 'error')
      } finally {
        setIsCheckingProvenance(false)
      }
    },
    [file, decodedSource, currentState, exportImage, showToast]
  )

  // Restore project from history item
  const handleRestoreUnifiedItem = useCallback(
    async (item: UnifiedHistoryItem) => {
      if (item.localItem) {
        const local = item.localItem
        setIsProcessing(true)
        try {
          const restoredFile = new File([local.originalBlob], local.fileName, { type: local.mimeType })
          const decoded = await decodeEditorSource(restoredFile)
          decodedSource?.close()
          setFile(restoredFile)
          setDecodedSource(decoded)
          setHistory({ past: [], present: local.editorState, future: [] })
          currentDraftIdRef.current = local.id
          setActiveTool('none')

          // Fit viewport
          const margin = 120
          const availW = window.innerWidth - margin
          const availH = window.innerHeight - margin
          const fitScale = Math.min(1.0, Math.min(availW / decoded.width, availH / decoded.height))
          setZoomScale(Math.max(0.1, Number(fitScale.toFixed(2))))
          setPanOffset({ x: 0, y: 0 })

          setShowHistoryDrawer(false)
          showToast(`已恢复草稿：${local.title}`, 'success')
        } catch (err) {
          console.error('Failed to restore history draft:', err)
          showToast('恢复草稿失败，原图可能损坏', 'error')
        } finally {
          setIsProcessing(false)
        }
        return
      }

      // If cloudItem without localItem, check if any local item has same cloudId or title
      if (item.cloudItem) {
        const match = localHistoryItems.find(
          (l) => l.cloudId === item.cloudItem?.id || l.fileName === item.cloudItem?.original_filename
        )
        if (match) {
          await handleRestoreUnifiedItem({
            id: match.id,
            source: 'local',
            title: match.title,
            fileName: match.fileName,
            fileSize: match.fileSize,
            dimensions: { width: match.width, height: match.height },
            thumbnail: match.thumbnail,
            updatedAt: match.updatedAt,
            originalBlob: match.originalBlob,
            localItem: match,
          })
          return
        }
        showToast('该云端草稿的原图未缓存在当前浏览器中，请先在原设备使用或重新拖入原图', 'info')
      }
    },
    [decodedSource, localHistoryItems, showToast]
  )

  // Fast direct download from history drawer
  const handleExportUnifiedItem = useCallback(
    async (item: UnifiedHistoryItem) => {
      if (!item.localItem) {
        showToast('该草稿无本地图像源，请在原设备下载', 'info')
        return
      }
      setIsProcessing(true)
      try {
        const decoded = await decodeEditorSource(item.localItem.originalBlob)
        const blob = await exportEditor(decoded, item.localItem.editorState, factory, 'image/webp', 0.85)
        decoded.close()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${item.title}_exported.webp`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        showToast(`已快速导出：${item.title}`, 'success')
      } catch (err) {
        console.error('Fast export failed:', err)
        showToast('快速导出失败', 'error')
      } finally {
        setIsProcessing(false)
      }
    },
    [factory, showToast]
  )

  // Sync local item to user's cloud projects
  const handleSyncToCloud = useCallback(
    async (localItem: LocalHistoryItem) => {
      if (!currentUser) {
        setShowAuthModal(true)
        showToast('请先登录账号以同步草稿至云端', 'info')
        return
      }

      try {
        const savedProject = await saveCloudProject({
          id: localItem.cloudId || localItem.id,
          title: localItem.title,
          original_filename: localItem.fileName,
          dimensions_width: localItem.width,
          dimensions_height: localItem.height,
          thumbnail_data: localItem.thumbnail,
          state_json: JSON.stringify(localItem.editorState),
        })

        if (savedProject) {
          const updated = await saveLocalHistory({
            ...localItem,
            isCloudSynced: true,
            cloudId: savedProject.id,
          })
          if (updated === null) {
            console.warn('Cloud sync succeeded but local linkage update failed')
          }
          await refreshHistory()
          showToast(`已同步「${localItem.title}」至云端项目`, 'success')
        } else {
          showToast('同步至云端失败', 'error')
        }
      } catch (err) {
        console.error('Sync to cloud failed:', err)
        showToast('网络错误，同步失败', 'error')
      }
    },
    [currentUser, refreshHistory, showToast]
  )

  // Delete item from local or cloud
  const handleDeleteUnifiedItem = useCallback(
    async (item: UnifiedHistoryItem) => {
      try {
        if (item.localItem) {
          await deleteLocalHistory(item.localItem.id)
        }
        if (item.cloudItem) {
          await deleteCloudProject(item.cloudItem.id)
        }
        await refreshHistory()
        showToast(`已删除草稿「${item.title}」`, 'info')
      } catch (err) {
        console.error('Delete item failed:', err)
        showToast('删除失败', 'error')
      }
    },
    [refreshHistory, showToast]
  )

  // Clear all local drafts
  const handleClearAllLocal = useCallback(async () => {
    try {
      await clearAllLocalHistory()
      await refreshHistory()
      showToast('已清空全部本地历史草稿', 'success')
    } catch (err) {
      console.error('Clear history failed:', err)
      showToast('清空失败', 'error')
    }
  }, [refreshHistory, showToast])

  // Logout handler
  const handleLogout = useCallback(async () => {
    try {
      await logoutUser()
      setCurrentUser(null)
      setCloudProjects([])
      showToast('已退出登录，当前继续使用访客模式', 'info')
    } catch (err) {
      console.warn('Logout failed:', err)
    }
  }, [showToast])

  // Total local cache size bytes
  const totalStorageBytes = useMemo(() => {
    return localHistoryItems.reduce((acc, cur) => acc + (cur.fileSize || 0) + (cur.thumbnail?.length || 0), 0)
  }, [localHistoryItems])

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault()
        handleUndo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && ((e.shiftKey && e.code === 'KeyZ') || e.code === 'KeyY')) {
        e.preventDefault()
        handleRedo()
        return
      }

      // Copy to clipboard
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyC') {
        if (file) {
          e.preventDefault()
          handleCopyToClipboard()
        }
        return
      }

      // Quick save
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault()
        handleQuickExport()
        return
      }

      // Single key tool shortcuts
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.code === 'KeyC') setActiveTool((prev) => (prev === 'crop' ? 'none' : 'crop'))
        else if (e.code === 'KeyB') setActiveTool((prev) => (prev === 'markup' ? 'none' : 'markup'))
        else if (e.code === 'KeyM') setActiveTool((prev) => (prev === 'mosaic' ? 'none' : 'mosaic'))
        else if (e.code === 'KeyT') setActiveTool((prev) => (prev === 'text' ? 'none' : 'text'))
        else if (e.code === 'KeyF') setActiveTool((prev) => (prev === 'adjust' ? 'none' : 'adjust'))
        else if (e.code === 'KeyW') setActiveTool((prev) => (prev === 'watermark' ? 'none' : 'watermark'))
        else if (e.code === 'KeyO') setActiveTool((prev) => (prev === 'compress' ? 'none' : 'compress'))
        else if (e.code === 'KeyH') {
        flushPendingPersist()
        setShowHistoryDrawer((v) => !v)
      }
        else if (e.code === 'Backslash') setIsComparingOriginal(true)
        else if (e.code === 'Escape') setActiveTool('none')
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Backslash') {
        setIsComparingOriginal(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
    }, [file, handleUndo, handleRedo, handleCopyToClipboard, handleQuickExport, flushPendingPersist])

  // Global Paste listener (Cmd+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        const pasted = e.clipboardData.files[0]
        if (pasted.type.startsWith('image/')) {
          e.preventDefault()
          void loadFile(pasted)
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [loadFile])

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-zinc-950 select-none">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            void loadFile(e.target.files[0])
          }
        }}
      />

      {/* Floating Top-Right User & History Navigation Capsule */}
      <UserNavCapsule
        user={currentUser}
        belowTopBar={Boolean(file && decodedSource)}
        historyCount={
          localHistoryItems.length +
          cloudProjects.filter(
            (c) => !localHistoryItems.some((l) => l.id === c.id || l.cloudId === c.id)
          ).length
        }
        onOpenHistory={() => {
          flushPendingPersist()
          setShowHistoryDrawer(true)
        }}
        onOpenAuth={() => setShowAuthModal(true)}
        onOpenProfile={() => setShowProfileModal(true)}
        onLogout={handleLogout}
      />

      {file && decodedSource && currentState ? (
        <>
          {/* Top Glass Action Bar */}
          <TopActionBar
            fileName={file.name}
            fileSize={file.size}
            dimensions={{ width: decodedSource.width, height: decodedSource.height }}
            zoomPercent={Math.round(zoomScale * 100)}
            canUndo={history ? history.past.length > 0 : false}
            canRedo={history ? history.future.length > 0 : false}
            isComparingOriginal={isComparingOriginal}
            isProcessing={isProcessing}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onRevert={handleRevert}
            onZoomIn={() => setZoomScale((s) => Math.min(32, s * 1.25))}
            onZoomOut={() => setZoomScale((s) => Math.max(0.05, s * 0.8))}
            onZoomReset={() => {
              if (Math.abs(zoomScale - 1.0) < 0.1) {
                const margin = 120
                const fit = Math.min(
                  1.0,
                  Math.min((window.innerWidth - margin) / decodedSource.width, (window.innerHeight - margin) / decodedSource.height)
                )
                setZoomScale(fit)
              } else {
                setZoomScale(1.0)
              }
              setPanOffset({ x: 0, y: 0 })
            }}
            onCompareStart={() => setIsComparingOriginal(true)}
            onCompareEnd={() => setIsComparingOriginal(false)}
            onReplaceImage={() => fileInputRef.current?.click()}
            onQuickExport={handleQuickExport}
            onExportFormat={handleExportFormat}
            onCopyToClipboard={handleCopyToClipboard}
          />

          {/* Master Spatial Canvas Viewport */}
          <main className="w-full h-full">
            <CanvasViewport
              source={decodedSource}
              state={currentState}
              activeTool={activeTool}
              markupMode={markupMode}
              markupColor={markupColor}
              markupWidth={markupWidth}
              mosaicType={mosaicType}
              mosaicBlockSize={mosaicBlockSize}
              textStyle={textStyle}
              textColor={textColor}
              textSize={textSize}
              isComparingOriginal={isComparingOriginal}
              zoomScale={zoomScale}
              panOffset={panOffset}
              onZoomChange={setZoomScale}
              onPanChange={setPanOffset}
              onStateChange={handleStateChange}
              onCommitHistory={handleCommitHistory}
            />
          </main>

          {/* Bottom WeChat / QQ Capsule Dock */}
          <BottomDock
            activeTool={activeTool}
            onToolSelect={setActiveTool}
            cropRatio={cropRatio}
            onRatioSelect={handleRatioSelect}
            onRotate90={handleRotate90}
            onFlipH={handleFlipH}
            onFlipV={handleFlipV}
            onResetCrop={handleResetCrop}
            markupMode={markupMode}
            markupColor={markupColor}
            markupWidth={markupWidth}
            onMarkupModeSelect={setMarkupMode}
            onMarkupColorSelect={setMarkupColor}
            onMarkupWidthSelect={setMarkupWidth}
            mosaicType={mosaicType}
            mosaicBlockSize={mosaicBlockSize}
            onMosaicTypeSelect={setMosaicType}
            onMosaicBlockSizeSelect={setMosaicBlockSize}
            textStyle={textStyle}
            textColor={textColor}
            textSize={textSize}
            onTextStyleSelect={setTextStyle}
            onTextColorSelect={setTextColor}
            onTextSizeSelect={setTextSize}
            adjustments={currentState.adjustments}
            onAdjustmentsChange={handleAdjustmentsChange}
            onAdjustmentsReset={handleAdjustmentsReset}
            onAddWatermark={handleAddWatermark}
            onAddEraseRegion={handleAddEraseRegion}
            onCheckProvenanceTarget={handleCheckProvenanceTarget}
            provenanceResultDetail={provenanceResultDetail}
            provenanceError={provenanceError}
            outputMime={outputMime}
            quality={quality}
            estimatedBytes={estimatedBytes}
            originalBytes={file.size}
            stripMetadata={stripMetadata}
            isCheckingProvenance={isCheckingProvenance}
            provenanceResult={provenanceResult}
            onMimeSelect={setOutputMime}
            onQualityChange={setQuality}
            onToggleStripMetadata={() => setStripMetadata((v) => !v)}
            onCheckProvenance={handleCheckProvenance}
          />
        </>
      ) : (
        /* Empty State Dropzone with Recent Items shelf */
        <EmptyDropzone
          onFileSelect={loadFile}
          error={errorMessage}
          recentItems={localHistoryItems.map((item) => ({
            id: item.id,
            title: item.title,
            thumbnail: item.thumbnail,
            dimensions: { width: item.width, height: item.height },
            updatedAt: item.updatedAt,
          }))}
          onSelectRecent={(id) => {
            const item = localHistoryItems.find((x) => x.id === id)
            if (item) {
              void handleRestoreUnifiedItem({
                id: item.id,
                source: 'local',
                title: item.title,
                fileName: item.fileName,
                fileSize: item.fileSize,
                dimensions: { width: item.width, height: item.height },
                thumbnail: item.thumbnail,
                updatedAt: item.updatedAt,
                originalBlob: item.originalBlob,
                localItem: item,
              })
            }
          }}
          onViewAllHistory={() => setShowHistoryDrawer(true)}
        />
      )}

      {/* Slide-over History Drawer */}
      <HistoryDrawer
        isOpen={showHistoryDrawer}
        user={currentUser}
        localItems={localHistoryItems}
        cloudItems={cloudProjects}
        storageBytes={totalStorageBytes}
        onClose={() => setShowHistoryDrawer(false)}
        onRestoreItem={(item) => void handleRestoreUnifiedItem(item)}
        onExportItem={(item) => void handleExportUnifiedItem(item)}
        onSyncToCloud={(item) => void handleSyncToCloud(item)}
        onDeleteItem={(item) => void handleDeleteUnifiedItem(item)}
        onClearAllLocal={() => void handleClearAllLocal()}
        onOpenAuth={() => {
          flushPendingPersist()
          setShowHistoryDrawer(false)
          setShowAuthModal(true)
        }}
      />

      {/* Auth Modal (Login / Register) */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={(user) => {
          // refreshHistory is owned by the effect watching currentUser; calling
          // it here would run a stale closure and duplicate the refresh.
          setCurrentUser(user)
          showToast(`欢迎回来，${user.nickname || user.username}！`, 'success')
        }}
      />

      {/* Profile Modal */}
      <ProfileModal
        isOpen={showProfileModal}
        user={currentUser}
        localHistoryCount={localHistoryItems.length}
        cloudProjectsCount={cloudProjects.length}
        onClose={() => setShowProfileModal(false)}
        onUserUpdated={(updated) => {
          setCurrentUser(updated)
          showToast('个人资料已保存', 'success')
        }}
        onLogout={() => {
          void handleLogout()
          setShowProfileModal(false)
        }}
      />

      {/* Floating Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-2xl text-xs shadow-2xl transition-all animate-in fade-in slide-in-from-bottom-2 duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
              : toast.type === 'error'
              ? 'bg-rose-950/80 text-rose-300 border border-rose-500/30'
              : 'bg-zinc-900/80 text-zinc-300 border border-zinc-700/50'
          }`}
        >
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}
