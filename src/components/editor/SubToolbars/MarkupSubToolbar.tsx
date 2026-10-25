import React from 'react'
import { UiIcon, type UiIconName } from '../../ui/UiIcon'

export type MarkupMode = 'brush' | 'highlighter' | 'arrow' | 'rect' | 'ellipse'

interface MarkupSubToolbarProps {
  currentMode: MarkupMode
  currentColor: string
  currentWidth: number
  onModeSelect: (mode: MarkupMode) => void
  onColorSelect: (color: string) => void
  onWidthSelect: (width: number) => void
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

const WIDTHS = [
  { label: '细', value: 3, dotSize: 4 },
  { label: '中', value: 6, dotSize: 7 },
  { label: '粗', value: 12, dotSize: 11 },
]

const MODES: Array<{ mode: MarkupMode; label: string; icon: UiIconName }> = [
  { mode: 'brush', label: '画笔', icon: 'brush' },
  { mode: 'highlighter', label: '荧光笔', icon: 'highlighter' },
  { mode: 'arrow', label: '箭头', icon: 'arrow' },
  { mode: 'rect', label: '矩形', icon: 'square' },
  { mode: 'ellipse', label: '圆形', icon: 'circle' },
]

export const MarkupSubToolbar: React.FC<MarkupSubToolbarProps> = ({
  currentMode,
  currentColor,
  currentWidth,
  onModeSelect,
  onColorSelect,
  onWidthSelect,
}) => {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl text-xs text-zinc-300">
      {/* Submode toggles */}
      <div className="flex items-center gap-0.5">
        {MODES.map((m) => (
          <button
            key={m.mode}
            onClick={() => onModeSelect(m.mode)}
            title={m.label}
            className={`p-1.5 rounded-xl transition-all ${
              currentMode === m.mode
                ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/20'
                : 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <UiIcon name={m.icon} size={15} />
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-zinc-800 mx-0.5" />

      {/* Color swatches */}
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

      {/* Stroke weights */}
      <div className="flex items-center gap-1">
        {WIDTHS.map((w) => (
          <button
            key={w.value}
            onClick={() => onWidthSelect(w.value)}
            title={`${w.label}线条 (${w.value}px)`}
            className={`w-6 h-6 rounded-xl flex items-center justify-center transition-all ${
              currentWidth === w.value
                ? 'bg-zinc-800 text-emerald-400 border border-zinc-700'
                : 'hover:bg-zinc-800/60 text-zinc-400'
            }`}
          >
            <span
              className="rounded-full bg-current transition-all"
              style={{ width: w.dotSize, height: w.dotSize }}
            />
          </button>
        ))}
      </div>
    </div>
  )
}
