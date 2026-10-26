import React from 'react'
import { UiIcon } from '../../ui/UiIcon'

export type MosaicType = 'pixel' | 'blur'

interface MosaicSubToolbarProps {
  currentType: MosaicType
  currentBlockSize: number
  onTypeSelect: (type: MosaicType) => void
  onBlockSizeSelect: (size: number) => void
}

const SIZES = [
  { label: '细密', value: 8 },
  { label: '标准', value: 16 },
  { label: '强力', value: 28 },
]

export const MosaicSubToolbar: React.FC<MosaicSubToolbarProps> = ({
  currentType,
  currentBlockSize,
  onTypeSelect,
  onBlockSizeSelect,
}) => {
  return (
    <div className="flex max-w-full items-center overflow-x-auto whitespace-nowrap [&>*]:shrink-0 gap-2 px-3 py-1.5 rounded-2xl bg-zinc-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl text-xs text-zinc-300">
      {/* Type pill: Pixel vs Blur */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onTypeSelect('pixel')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] transition-all ${
            currentType === 'pixel'
              ? 'bg-emerald-500 text-zinc-950 font-medium shadow-md shadow-emerald-500/20'
              : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <UiIcon name="mosaic" size={13} />
          <span>像素马赛克</span>
        </button>
        <button
          onClick={() => onTypeSelect('blur')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] transition-all ${
            currentType === 'blur'
              ? 'bg-emerald-500 text-zinc-950 font-medium shadow-md shadow-emerald-500/20'
              : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <UiIcon name="eye" size={13} />
          <span>毛玻璃模糊</span>
        </button>
      </div>

      <div className="w-px h-4 bg-zinc-800 mx-0.5" />

      {/* Block size choices */}
      <div className="flex items-center gap-1">
        {SIZES.map((s) => (
          <button
            key={s.value}
            onClick={() => onBlockSizeSelect(s.value)}
            className={`px-2 py-1 rounded-xl text-[11px] transition-all ${
              currentBlockSize === s.value
                ? 'bg-zinc-800 text-emerald-400 border border-zinc-700'
                : 'hover:bg-zinc-800/60 text-zinc-400'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <span className="text-[11px] text-zinc-500 hidden sm:inline pl-1">
        在图上拖拽生成遮挡框
      </span>
    </div>
  )
}
