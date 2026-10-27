import React, { useEffect, useRef, useState } from 'react'
import type { Adjustments } from '../../../domain/editor-state'
import { UiIcon } from '../../ui/UiIcon'

interface AdjustSubToolbarProps {
  adjustments: Adjustments
  onChange: (adjustments: Adjustments) => void
  /** Ends a live adjustment sweep so it becomes one undoable step. */
  onCommit: () => void
  onReset: () => void
}

const PRESETS: Array<{ label: string; values: Adjustments }> = [
  {
    label: '原图',
    values: { brightness: 0, contrast: 0, saturation: 0, sharpen: 0, blur: 0 },
  },
  {
    label: '鲜明',
    values: { brightness: 8, contrast: 15, saturation: 25, sharpen: 20, blur: 0 },
  },
  {
    label: '黑白',
    values: { brightness: 0, contrast: 25, saturation: -100, sharpen: 15, blur: 0 },
  },
  {
    label: '暖阳',
    values: { brightness: 6, contrast: 10, saturation: 18, sharpen: 0, blur: 0 },
  },
  {
    label: '冷调',
    values: { brightness: -4, contrast: 12, saturation: -15, sharpen: 10, blur: 0 },
  },
]

export const AdjustSubToolbar: React.FC<AdjustSubToolbarProps> = ({
  adjustments,
  onChange,
  onCommit,
  onReset,
}) => {
  const [activeTab, setActiveTab] = useState<'presets' | 'sliders'>('presets')
  const commitTimerRef = useRef<number | null>(null)

  const clearCommitTimer = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
  }

  // Sliders change continuously; the sweep ends when the pointer is released,
  // the key is lifted or the value settles, and that is one undoable step.
  const scheduleCommit = () => {
    clearCommitTimer()
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null
      onCommit()
    }, 400)
  }

  const commitNow = () => {
    clearCommitTimer()
    onCommit()
  }

  useEffect(() => clearCommitTimer, [])

  const updateField = (field: keyof Adjustments, value: number) => {
    onChange({ ...adjustments, [field]: value })
    scheduleCommit()
  }

  return (
    <div
      className="flex flex-col gap-2 p-2.5 rounded-2xl bg-zinc-900/95 backdrop-blur-2xl border border-white/10 shadow-2xl text-xs text-zinc-300 max-w-sm w-full"
      onPointerUp={commitNow}
      onKeyUp={commitNow}
      onBlur={commitNow}
    >
      {/* Tab toggle: Presets vs Sliders */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('presets')}
            className={`px-2.5 py-1 rounded-xl text-[11px] transition-all ${
              activeTab === 'presets'
                ? 'bg-zinc-800 text-emerald-400 font-medium'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            滤镜预设
          </button>
          <button
            onClick={() => setActiveTab('sliders')}
            className={`px-2.5 py-1 rounded-xl text-[11px] transition-all ${
              activeTab === 'sliders'
                ? 'bg-zinc-800 text-emerald-400 font-medium'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            画面微调
          </button>
        </div>

        <button
          onClick={onReset}
          className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-rose-400 transition-colors"
          title="重置为默认值"
        >
          <UiIcon name="refresh" size={12} />
          <span>重置</span>
        </button>
      </div>

      {activeTab === 'presets' ? (
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          {PRESETS.map((p) => {
            const isMatch =
              adjustments.brightness === p.values.brightness &&
              adjustments.contrast === p.values.contrast &&
              adjustments.saturation === p.values.saturation &&
              adjustments.sharpen === p.values.sharpen
            return (
              <button
                key={p.label}
                onClick={() => {
                  onChange(p.values)
                  commitNow()
                }}
                className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] text-center transition-all ${
                  isMatch
                    ? 'bg-emerald-500 text-zinc-950 font-medium shadow-md shadow-emerald-500/20'
                    : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2 py-1">
          {[
            { label: '亮度', field: 'brightness' as const, min: -100, max: 100 },
            { label: '对比度', field: 'contrast' as const, min: -100, max: 100 },
            { label: '饱和度', field: 'saturation' as const, min: -100, max: 100 },
            { label: '锐化', field: 'sharpen' as const, min: 0, max: 100 },
            { label: '模糊', field: 'blur' as const, min: 0, max: 20 },
          ].map(({ label, field, min, max }) => (
            <div key={field} className="flex items-center gap-3">
              <span className="w-12 text-[11px] text-zinc-400">{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                value={adjustments[field]}
                onChange={(e) => updateField(field, Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-8 text-[11px] text-right font-mono text-zinc-400">
                {adjustments[field]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
