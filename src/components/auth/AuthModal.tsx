import React, { useState } from 'react'
import { UiIcon } from '../ui/UiIcon'
import { loginUser, registerUser, type SafeUser } from '../../infrastructure/auth-client'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (user: SafeUser) => void
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!account || !password) {
      setError('请输入账号和密码')
      return
    }
    setLoading(true)
    setError(null)
    const res = await loginUser(account, password)
    setLoading(false)
    if (res.ok && res.user) {
      onSuccess(res.user)
      onClose()
    } else {
      setError(res.message || '登录失败，请核对信息')
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !email || !password) {
      setError('请完整填写用户名、邮箱与密码')
      return
    }
    setLoading(true)
    setError(null)
    const res = await registerUser(username, email, password, nickname || undefined)
    setLoading(false)
    if (res.ok && res.user) {
      onSuccess(res.user)
      onClose()
    } else {
      setError(res.message || '注册失败，请核对信息')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-sm rounded-3xl bg-zinc-900/95 backdrop-blur-2xl border border-white/10 shadow-2xl p-6 text-zinc-200 z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
        >
          <UiIcon name="x" size={16} />
        </button>

        {/* Header Banner */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <UiIcon name="user" size={24} />
          </div>
          <h2 className="text-base font-semibold text-zinc-100">OneImage 个人账号</h2>
          <p className="text-[11px] text-zinc-400 mt-1">
            未登录也可使用全部功能 · 登录后支持多端云同步
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex rounded-xl bg-zinc-950/60 p-1 mb-5 border border-white/5 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setTab('login')
              setError(null)
            }}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              tab === 'login'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            账号登录
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register')
              setError(null)
            }}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              tab === 'register'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            新用户注册
          </button>
        </div>

        {/* Error notification */}
        {error && (
          <div className="mb-4 px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

        {/* Login Form */}
        {tab === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-3.5 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">用户名或邮箱</label>
              <input
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="例如 alice 或 alice@example.com"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950/80 border border-white/10 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/60 transition-colors"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">登录密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950/80 border border-white/10 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20"
            >
              {loading && <UiIcon name="loader" size={14} className="animate-spin" />}
              <span>{loading ? '正在登录...' : '立即登录'}</span>
            </button>
          </form>
        ) : (
          /* Register Form */
          <form onSubmit={handleRegister} className="space-y-3 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">用户名 (必填)</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="3-24位字母、数字或下划线"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950/80 border border-white/10 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/60 transition-colors"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">电子邮箱 (必填)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="yourname@domain.com"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950/80 border border-white/10 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">昵称 (选填)</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="展示昵称，如「设计小林」"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950/80 border border-white/10 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">设置密码 (至少6位)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位安全密码"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950/80 border border-white/10 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/60 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20"
            >
              {loading && <UiIcon name="loader" size={14} className="animate-spin" />}
              <span>{loading ? '正在注册...' : '完成注册并登录'}</span>
            </button>
          </form>
        )}

        <div className="mt-5 pt-4 border-t border-white/5 text-center text-[10px] text-zinc-500">
          数据安全保护 · 密码经高强度 scrypt 加盐加密存储
        </div>
      </div>
    </div>
  )
}
