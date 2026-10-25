import React, { useRef, useState } from 'react'
import { UiIcon } from '../ui/UiIcon'

interface EmptyDropzoneProps {
  onFileSelect: (file: File) => void
  onPasteText?: () => void
  error?: string | null
}

export const EmptyDropzone: React.FC<EmptyDropzoneProps> = ({ onFileSelect, error }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelect(e.dataTransfer.files[0])
    }
  }

  return (
    <div
      className={`relative w-full h-full flex flex-col items-center justify-center p-6 transition-all duration-300 ${
        isDragOver ? 'bg-zinc-900/60' : 'bg-transparent'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0])
          }
        }}
      />

      {/* Heroic Drop Card */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className={`group relative max-w-md w-full flex flex-col items-center justify-center p-10 rounded-3xl cursor-pointer transition-all duration-300 border ${
          isDragOver
            ? 'border-emerald-500 bg-emerald-950/20 shadow-2xl shadow-emerald-500/20 scale-[1.02]'
            : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900/70 shadow-2xl backdrop-blur-xl'
        }`}
      >
        <div className="w-16 h-16 rounded-2xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center mb-6 text-zinc-300 group-hover:text-emerald-400 group-hover:scale-110 transition-all duration-300 shadow-inner">
          <UiIcon name="image" size={32} strokeWidth={1.5} />
        </div>

        <h2 className="text-xl font-medium text-zinc-100 mb-2 tracking-tight">
          拖入图片，或点击选择
        </h2>

        <p className="text-sm text-zinc-400 text-center mb-6 max-w-xs leading-relaxed">
          纯浏览器本地处理 · 原图不离开设备
          <br />
          支持快捷键 <kbd className="px-1.5 py-0.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300 font-mono">⌘V</kbd> 直接粘贴
        </p>

        <div className="flex items-center gap-2">
          {['JPEG', 'PNG', 'WebP', 'AVIF'].map((fmt) => (
            <span
              key={fmt}
              className="text-[11px] font-mono tracking-wider px-2.5 py-1 rounded-full bg-zinc-800/70 text-zinc-400 border border-zinc-700/50"
            >
              {fmt}
            </span>
          ))}
          <span className="text-[11px] font-mono text-zinc-500 pl-1">≤ 25MB</span>
        </div>

        {error && (
          <div className="mt-4 px-3 py-1.5 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-xl">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
