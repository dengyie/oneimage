import React from 'react'
import { ASPECT_RATIO_PRESETS } from '../../../domain/editor-state'
import { UiIcon } from '../../ui/UiIcon'

interface CropSubToolbarProps {
  currentRatio: string
  onRatioSelect: (ratio: string) => void
  onRotate90: () => void
  onFlipH: () => void
  onFlipV: () => void
  onResetCrop: () => void
}

export const CropSubToolbar: React.FC<CropSubToolbarProps> = ({
  currentRatio,
  onRatioSelect,
  onRotate90,
  onFlipH,
  onFlipV,
  onResetCrop,
}) => {
  return (
    <div className="flex max-w-full items-center overflow-x-auto whitespace-nowrap [&>*]:shrink-0 gap-1.5 px-3 py-1.5 rounded-2xl bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl text-xs text-zinc-300">
      {/* Ratio pills */}
      <div className="flex items-center gap-1">
        {ASPECT_RATIO_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onRatioSelect(p.id)}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-mono transition-all ${
              currentRatio === p.id
                ? 'bg-emerald-500 text-zinc-950 font-medium shadow-md shadow-emerald-500/20'
                : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-zinc-800 mx-1" />

      {/* Rotate & Flip */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onRotate90}
          title="向右旋转 90°"
          className="p-1.5 rounded-xl hover:bg-zinc-800 text-zinc-300 hover:text-emerald-400 transition-colors"
        >
          <UiIcon name="rotate-cw" size={16} />
        </button>
        <button
          onClick={onFlipH}
          title="水平镜像翻转"
          className="p-1.5 rounded-xl hover:bg-zinc-800 text-zinc-300 hover:text-emerald-400 transition-colors"
        >
          <UiIcon name="flip-horizontal" size={16} />
        </button>
        <button
          onClick={onFlipV}
          title="垂直镜像翻转"
          className="p-1.5 rounded-xl hover:bg-zinc-800 text-zinc-300 hover:text-emerald-400 transition-colors"
        >
          <UiIcon name="flip-vertical" size={16} />
        </button>
      </div>

      <div className="w-px h-4 bg-zinc-800 mx-1" />

      {/* Reset */}
      <button
        onClick={onResetCrop}
        title="重置裁剪为全图"
        className="px-2.5 py-1 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-[11px] transition-colors"
      >
        还原全图
      </button>
    </div>
  )
}
