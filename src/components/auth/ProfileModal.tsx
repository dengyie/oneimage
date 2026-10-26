import React, { useEffect, useState } from 'react'
import { UiIcon } from '../ui/UiIcon'
import { updateUserProfile, type SafeUser } from '../../infrastructure/auth-client'
import { AVATAR_COLORS, DEFAULT_AVATAR_COLOR } from '../../domain/avatar'

interface ProfileModalProps {
  isOpen: boolean
  user: SafeUser | null
  localHistoryCount: number
  cloudProjectsCount: number
  onClose: () => void
  onUserUpdated: (user: SafeUser) => void
  onLogout: () => void
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  user,
  localHistoryCount,
  cloudProjectsCount,
  onClose,
  onUserUpdated,
  onLogout,
}) => {
  const [nickname, setNickname] = useState('')
  const [avatarColor, setAvatarColor] = useState<string>(DEFAULT_AVATAR_COLOR)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // The modal stays mounted across open/close, so the form must re-sync with
  // the current profile every time it is opened — a useState initializer runs
  // only once and would silently reset the saved avatar color on save.
  useEffect(() => {
    if (isOpen && user) {
      setNickname(user.nickname || '')
      setAvatarColor(user.avatar_color || DEFAULT_AVATAR_COLOR)
      setMessage(null)
    }
  }, [isOpen, user])

  if (!isOpen || !user) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    const updated = await updateUserProfile({
      nickname: nickname.trim() || undefined,
      avatar_color: avatarColor,
    })
    setSaving(false)
    if (updated) {
      onUserUpdated(updated)
      setMessage('个人资料已保存')
      setTimeout(() => setMessage(null), 2000)
    } else {
      setMessage('保存失败，请稍后重试')
    }
  }

  const joinDate = new Date(user.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-sm rounded-3xl bg-zinc-900/95 backdrop-blur-2xl border border-white/10 shadow-2xl p-6 text-zinc-200 z-10 animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
        >
          <UiIcon name="x" size={16} />
        </button>

        <h2 className="text-base font-semibold text-zinc-100 mb-5">个人中心</h2>

        {/* Profile Header */}
        <div className="flex items-center gap-4 mb-6 p-4 rounded-2xl bg-zinc-950/60 border border-white/5">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white shadow-lg shrink-0 transition-colors"
            style={{ backgroundColor: avatarColor }}
          >
            {(nickname || user.username).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-100 truncate">{user.nickname || user.username}</div>
            <div className="text-xs text-zinc-400 truncate">@{user.username}</div>
            <div className="text-[10px] text-zinc-500 truncate mt-0.5">{user.email}</div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-2.5 mb-6 text-center text-xs">
          <div className="p-3 rounded-2xl bg-zinc-950/40 border border-white/5">
            <div className="text-base font-bold text-emerald-400">{cloudProjectsCount}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">云端项目草稿</div>
          </div>
          <div className="p-3 rounded-2xl bg-zinc-950/40 border border-white/5">
            <div className="text-base font-bold text-blue-400">{localHistoryCount}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">本地历史编辑</div>
          </div>
        </div>

        {/* Edit Form */}
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div>
            <label className="block text-zinc-400 mb-1.5">修改昵称</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="请输入新的展示昵称"
              className="w-full px-3 py-2 rounded-xl bg-zinc-950/80 border border-white/10 text-zinc-100 focus:outline-none focus:border-emerald-500/60 transition-colors"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-2">个性头像色彩</label>
            <div className="flex items-center gap-2 flex-wrap">
              {AVATAR_COLORS.map((color) => (
                <button
                  type="button"
                  key={color}
                  onClick={() => setAvatarColor(color)}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    avatarColor === color ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {message && (
            <div className="text-emerald-400 text-xs text-center py-1 font-medium animate-in fade-in">
              {message}
            </div>
          )}

          <div className="pt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 font-semibold transition-all disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存更改'}
            </button>
            <button
              type="button"
              onClick={() => {
                onLogout()
                onClose()
              }}
              className="px-3 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 font-medium transition-colors"
            >
              退出
            </button>
          </div>
        </form>

        <div className="mt-5 pt-3 border-t border-white/5 text-center text-[10px] text-zinc-500">
          注册于 {joinDate}
        </div>
      </div>
    </div>
  )
}
