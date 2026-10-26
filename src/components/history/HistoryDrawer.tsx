import React, { useState, useMemo } from 'react'
import { UiIcon } from '../ui/UiIcon'
import type { LocalHistoryItem } from '../../infrastructure/history-storage'
import type { CloudProject, SafeUser } from '../../infrastructure/auth-client'

export interface UnifiedHistoryItem {
  id: string
  source: 'local' | 'cloud'
  title: string
  fileName: string
  fileSize: number
  dimensions: { width: number; height: number }
  thumbnail: string
  updatedAt: number
  originalBlob?: Blob
  localItem?: LocalHistoryItem
  cloudItem?: CloudProject
}

interface HistoryDrawerProps {
  isOpen: boolean
  user: SafeUser | null
  localItems: LocalHistoryItem[]
  cloudItems: CloudProject[]
  storageBytes: number
  onClose: () => void
  onRestoreItem: (item: UnifiedHistoryItem) => void
  onExportItem: (item: UnifiedHistoryItem) => void
  onSyncToCloud: (item: LocalHistoryItem) => void
  onDeleteItem: (item: UnifiedHistoryItem) => void
  onClearAllLocal: () => void
  onOpenAuth: () => void
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatTimeAgo(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000)
  if (diffSec < 60) return '刚刚'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  user,
  localItems,
  cloudItems,
  storageBytes,
  onClose,
  onRestoreItem,
  onExportItem,
  onSyncToCloud,
  onDeleteItem,
  onClearAllLocal,
  onOpenAuth,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'local' | 'cloud'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Merge into unified list
  const unifiedList = useMemo<UnifiedHistoryItem[]>(() => {
    const list: UnifiedHistoryItem[] = []

    for (const item of localItems) {
      list.push({
        id: item.id,
        source: 'local',
        title: item.title || item.fileName,
        fileName: item.fileName,
        fileSize: item.fileSize,
        dimensions: { width: item.width, height: item.height },
        thumbnail: item.thumbnail,
        updatedAt: item.updatedAt,
        originalBlob: item.originalBlob,
        localItem: item,
      })
    }

    for (const project of cloudItems) {
      // avoid duplicates if already loaded locally and mapped
      list.push({
        id: project.id,
        source: 'cloud',
        title: project.title,
        fileName: project.original_filename,
        fileSize: 0,
        dimensions: { width: project.dimensions_width, height: project.dimensions_height },
        thumbnail: project.thumbnail_data,
        updatedAt: project.updated_at || Date.now(),
        cloudItem: project,
      })
    }

    // Sort newest first
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    return list
  }, [localItems, cloudItems])

  // Filtered by tab and search
  const filteredList = useMemo(() => {
    return unifiedList.filter((item) => {
      if (activeTab === 'local' && item.source !== 'local') return false
      if (activeTab === 'cloud' && item.source !== 'cloud') return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return (
          item.title.toLowerCase().includes(q) ||
          item.fileName.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [unifiedList, activeTab, searchQuery])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Drawer */}
      <aside className="relative w-full max-w-lg h-full bg-zinc-900/95 backdrop-blur-2xl border-l border-white/10 shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200 text-zinc-200">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <UiIcon name="clock" size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">历史编辑与草稿</h2>
              <p className="text-[10px] text-zinc-400">免登录自动存储于本地 · 支持恢复继续编辑</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
          >
            <UiIcon name="x" size={16} />
          </button>
        </div>

        {/* Tab & Search Controls */}
        <div className="p-4 border-b border-white/5 space-y-3 shrink-0">
          {/* Tabs */}
          <div className="flex rounded-xl bg-zinc-950/60 p-1 border border-white/5 text-xs">
            <button
              onClick={() => setActiveTab('all')}
              className={`flex-1 py-1 rounded-lg transition-all ${
                activeTab === 'all' ? 'bg-zinc-800 text-zinc-100 font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              全部 ({unifiedList.length})
            </button>
            <button
              onClick={() => setActiveTab('local')}
              className={`flex-1 py-1 rounded-lg transition-all ${
                activeTab === 'local' ? 'bg-zinc-800 text-zinc-100 font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              本地草稿 ({localItems.length})
            </button>
            <button
              onClick={() => setActiveTab('cloud')}
              className={`flex-1 py-1 rounded-lg transition-all ${
                activeTab === 'cloud' ? 'bg-zinc-800 text-zinc-100 font-medium shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              云端同步 ({cloudItems.length})
            </button>
          </div>

          {/* Search box */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索项目名称或文件名..."
              className="w-full px-3 py-1.5 pl-8 rounded-xl bg-zinc-950/80 border border-white/10 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500/60 transition-colors"
            />
            <div className="absolute left-2.5 top-2 text-zinc-500">
              <UiIcon name="sliders" size={14} />
            </div>
          </div>
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredList.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-zinc-500">
              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-3 text-zinc-400">
                <UiIcon name="image" size={24} />
              </div>
              <p className="text-xs font-medium text-zinc-400">暂无相关历史记录</p>
              <p className="text-[11px] text-zinc-500 mt-1 max-w-xs">
                在画板中编辑、添加水印或导出图片后，将自动在此处生成历史草稿。
              </p>
              {!user && (
                <button
                  onClick={onOpenAuth}
                  className="mt-4 px-3 py-1.5 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs transition-colors"
                >
                  登录开启云端多端同步
                </button>
              )}
            </div>
          ) : (
            filteredList.map((item) => (
              <div
                key={`${item.source}_${item.id}`}
                className="group relative flex gap-3.5 p-3 rounded-2xl bg-zinc-950/50 hover:bg-zinc-950/80 border border-white/5 hover:border-white/15 transition-all shadow-sm"
              >
                {/* Thumbnail */}
                <div
                  onClick={() => {
                    onRestoreItem(item)
                    onClose()
                  }}
                  className="relative w-20 h-20 rounded-xl overflow-hidden bg-zinc-900 border border-white/10 shrink-0 cursor-pointer group-hover:scale-102 transition-transform"
                >
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600">
                      <UiIcon name="image" size={24} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-xs font-medium">
                    编辑
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-xs text-zinc-100 truncate">{item.title}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono shrink-0 ${
                          item.source === 'cloud'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        {item.source === 'cloud' ? '云端' : '本地'}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400 truncate mt-0.5">{item.fileName}</div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-1">
                      {item.dimensions.width > 0 && (
                        <span>{item.dimensions.width} × {item.dimensions.height}</span>
                      )}
                      <span>·</span>
                      <span>{formatTimeAgo(item.updatedAt)}</span>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => {
                        onRestoreItem(item)
                        onClose()
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium transition-colors"
                    >
                      继续编辑
                    </button>
                    {item.source === 'local' && (
                      <button
                        onClick={() => {
                          if (!user) {
                            onOpenAuth()
                          } else if (item.localItem) {
                            onSyncToCloud(item.localItem)
                          }
                        }}
                        className="p-1 rounded-lg text-zinc-400 hover:text-blue-400 hover:bg-white/5 transition-colors"
                        title={user ? '同步至云端' : '登录后同步至云端'}
                      >
                        <UiIcon name="cloud" size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => onExportItem(item)}
                      className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors"
                      title="直接导出原图"
                    >
                      <UiIcon name="download" size={14} />
                    </button>
                    <button
                      onClick={() => onDeleteItem(item)}
                      className="p-1 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-auto"
                      title="删除记录"
                    >
                      <UiIcon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex items-center justify-between text-xs text-zinc-400 shrink-0 bg-zinc-950/60">
          <div>
            <span>本地已存 {localItems.length} 项</span>
            {storageBytes > 0 && <span className="text-zinc-500 ml-1.5">({formatBytes(storageBytes)})</span>}
          </div>
          {localItems.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('确认清空所有本地历史编辑记录？此操作不会影响已导出的文件。')) {
                  onClearAllLocal()
                }
              }}
              className="text-xs text-zinc-500 hover:text-rose-400 transition-colors"
            >
              清空本地记录
            </button>
          )}
        </div>
      </aside>
    </div>
  )
}
