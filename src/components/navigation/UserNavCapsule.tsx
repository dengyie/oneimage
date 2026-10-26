import React, { useState } from 'react'
import { UiIcon } from '../ui/UiIcon'
import type { SafeUser } from '../../infrastructure/auth-client'

interface UserNavCapsuleProps {
  user: SafeUser | null
  historyCount: number
  onOpenHistory: () => void
  onOpenAuth: () => void
  onOpenProfile: () => void
  onLogout: () => void
}

export const UserNavCapsule: React.FC<UserNavCapsuleProps> = ({
  user,
  historyCount,
  onOpenHistory,
  onOpenAuth,
  onOpenProfile,
  onLogout,
}) => {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="fixed top-3 right-4 sm:right-6 z-40 flex items-center gap-2 select-none">
      {/* History Button */}
      <button
        onClick={onOpenHistory}
        className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/85 backdrop-blur-2xl border border-white/10 hover:border-white/20 text-xs text-zinc-300 hover:text-zinc-100 shadow-xl shadow-black/40 transition-all hover:scale-105 active:scale-95"
        title="查看历史编辑记录"
      >
        <UiIcon name="clock" size={15} strokeWidth={2} className="text-zinc-400 group-hover:text-emerald-400 transition-colors" />
        <span className="font-medium hidden sm:inline">历史</span>
        {historyCount > 0 && (
          <span className="px-1.5 py-0.2 text-[10px] font-mono rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            {historyCount}
          </span>
        )}
      </button>

      {/* User / Auth Button */}
      {user ? (
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-zinc-900/85 backdrop-blur-2xl border border-white/10 hover:border-white/20 text-xs text-zinc-300 hover:text-zinc-100 shadow-xl shadow-black/40 transition-all hover:scale-105 active:scale-95"
          >
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shadow-sm"
              style={{ backgroundColor: user.avatar_color || '#10b981' }}
            >
              {(user.nickname || user.username).slice(0, 1).toUpperCase()}
            </div>
            <span className="max-w-[80px] truncate font-medium text-xs hidden sm:inline">
              {user.nickname || user.username}
            </span>
            <UiIcon name="chevron-down" size={12} className="text-zinc-500" />
          </button>

          {/* User Popover Menu */}
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full mt-2 w-48 py-1 rounded-2xl bg-zinc-900/95 backdrop-blur-2xl border border-white/10 shadow-2xl z-50 text-xs animate-in fade-in zoom-in-95 duration-150">
                <div className="px-3 py-2 border-b border-white/5">
                  <div className="font-medium text-zinc-100 truncate">{user.nickname || user.username}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{user.email}</div>
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenProfile()
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-zinc-300 hover:text-zinc-100 hover:bg-white/5 transition-colors"
                >
                  <UiIcon name="user" size={14} />
                  <span>个人中心</span>
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenHistory()
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-zinc-300 hover:text-zinc-100 hover:bg-white/5 transition-colors"
                >
                  <UiIcon name="cloud" size={14} />
                  <span>云端草稿</span>
                </button>
                <div className="border-t border-white/5 my-1" />
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    onLogout()
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <UiIcon name="logout" size={14} />
                  <span>退出登录</span>
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={onOpenAuth}
          className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/85 backdrop-blur-2xl border border-white/10 hover:border-white/20 text-xs text-zinc-300 hover:text-zinc-100 shadow-xl shadow-black/40 transition-all hover:scale-105 active:scale-95"
        >
          <UiIcon name="user" size={14} className="text-zinc-400 group-hover:text-emerald-400 transition-colors" />
          <span className="font-medium">登录 / 注册</span>
        </button>
      )}
    </div>
  )
}
