import React from 'react'
import type { TextBgStyle } from '../../../domain/editor-state'

interface TextSubToolbarProps {
  currentStyle: TextBgStyle
  currentColor: string
  currentSize: number
  onStyleSelect: (style: TextBgStyle) => void
  onColorSelect: (color: string) => void
  onSizeSelect: (size: number) => void
}

const COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#3b82f6', // Blue
  '#a855f7', // Purple
  '#ffffff', // White
  '#000000', // Black
]

const STYLES: Array<{ style: TextBgStyle; label: string }> = [
  { style: 'none', label: '无背景' },
  { style: 'translucent', label: '微透气泡' },
  { style: 'solid', label: '实心胶囊' },
]

const SIZES = [
  { label: '小', value: 18 },
  { label: '中', value: 28 },
  { label: '大', value: 42 },
]

export const TextSubToolbar: React.FC<TextSubToolbarProps> = ({
  currentStyle,
  currentColor,
  currentSize,
  onStyleSelect,
  onColorSelect,
  onSizeSelect,
}) => {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl text-xs text-zinc-300">
      {/* Background pill styles */}
      <div className="flex items-center gap-1">
        {STYLES.map((s) => (
          <button
            key={s.style}
            onClick={() => onStyleSelect(s.style)}
            className={`px-2.5 py-1 rounded-xl text-[11px] transition-all ${
              currentStyle === s.style
                ? 'bg-emerald-500 text-zinc-950 font-medium shadow-md shadow-emerald-500/20'
                : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-zinc-800 mx-0.5" />

      {/* Colors */}
      <div className="flex items-center gap-1.5 px-1">
        {COLORS.map((c) => {
          const isSelected = currentColor.toLowerCase() === c.toLowerCase()
          return (
            <button
              key={c}
              onClick={() => onColorSelect(c)}
              className={`w-4 h-4 rounded-full transition-all relative ${
                isSelected ? 'scale-125 ring-2 ring-emerald-400 ring-offset-1 ring-offset-zinc-900' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
            />
          )
        })}
      </div>

      <div className="w-px h-4 bg-zinc-800 mx-0.5" />

      {/* Font sizes */}
      <div className="flex items-center gap-1">
        {SIZES.map((s) => (
          <button
            key={s.value}
            onClick={() => onSizeSelect(s.value)}
            className={`px-2 py-1 rounded-xl text-[11px] transition-all ${
              currentSize === s.value
                ? 'bg-zinc-800 text-emerald-400 border border-zinc-700'
                : 'hover:bg-zinc-800/60 text-zinc-400'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <span className="text-[11px] text-zinc-500 hidden sm:inline pl-1">
        点击画面添加文字
      </span>
    </div>
  )
}
