import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { UserRow, SessionRow } from './db'

export interface SafeUser {
  id: string
  username: string
  email: string
  nickname: string
  avatar_color: string
  created_at: number
  updated_at: number
}

const DEFAULT_AVATARS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#6366f1', // indigo
  '#14b8a6', // teal
]

function getRandomAvatarColor(): string {
  const idx = Math.floor(Math.random() * DEFAULT_AVATARS.length)
  return DEFAULT_AVATARS[idx]
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  try {
    const computed = scryptSync(password, salt, 64).toString('hex')
    const computedBuf = Buffer.from(computed, 'hex')
    const expectedBuf = Buffer.from(expectedHash, 'hex')
    if (computedBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(computedBuf, expectedBuf)
  } catch {
    return false
  }
}

export function toSafeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    nickname: row.nickname,
    avatar_color: row.avatar_color,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function createUser(
  db: DatabaseSync,
  params: { username: string; email: string; password: string; nickname?: string }
): SafeUser {
  const username = params.username.trim().toLowerCase()
  const email = params.email.trim().toLowerCase()
  const nickname = (params.nickname?.trim() || username).slice(0, 32)
  const salt = randomBytes(16).toString('hex')
  const passwordHash = hashPassword(params.password, salt)
  const id = `usr_${randomBytes(12).toString('hex')}`
  const now = Date.now()
  const avatarColor = getRandomAvatarColor()

  const stmt = db.prepare(`
    INSERT INTO users (id, username, email, password_hash, salt, nickname, avatar_color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(id, username, email, passwordHash, salt, nickname, avatarColor, now, now)

  return {
    id,
    username,
    email,
    nickname,
    avatar_color: avatarColor,
    created_at: now,
    updated_at: now,
  }
}

export function authenticateUser(
  db: DatabaseSync,
  account: string,
  password: string
): SafeUser | null {
  const cleanAccount = account.trim().toLowerCase()
  const stmt = db.prepare(`
    SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1
  `)
  const row = stmt.get(cleanAccount, cleanAccount) as unknown as UserRow | undefined
  if (!row) return null

  if (!verifyPassword(password, String(row.salt), String(row.password_hash))) {
    return null
  }

  return toSafeUser(row)
}

export function createSession(
  db: DatabaseSync,
  userId: string,
  ttlDays = 30
): SessionRow {
  const token = `sess_${randomBytes(32).toString('hex')}`
  const now = Date.now()
  const expiresAt = now + ttlDays * 24 * 60 * 60 * 1000

  const stmt = db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(token, userId, expiresAt, now)

  return {
    token,
    user_id: userId,
    expires_at: expiresAt,
    created_at: now,
  }
}

export function validateSession(
  db: DatabaseSync,
  token: string
): SafeUser | null {
  const now = Date.now()
  const stmt = db.prepare(`
    SELECT u.* FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > ?
    LIMIT 1
  `)
  const row = stmt.get(token, now) as unknown as UserRow | undefined
  if (!row) return null

  return toSafeUser(row)
}

export function deleteSession(db: DatabaseSync, token: string): void {
  const stmt = db.prepare('DELETE FROM sessions WHERE token = ?')
  stmt.run(token)
}

export function updateUserProfile(
  db: DatabaseSync,
  userId: string,
  updates: { nickname?: string; avatar_color?: string }
): SafeUser | null {
  const now = Date.now()
  const currentStmt = db.prepare('SELECT * FROM users WHERE id = ?')
  const current = currentStmt.get(userId) as unknown as UserRow | undefined
  if (!current) return null

  const currentNickname = String(current.nickname || current.username)
  const currentAvatarColor = String(current.avatar_color || '#10b981')
  const nextNickname = (updates.nickname !== undefined ? updates.nickname.trim() : currentNickname).slice(0, 32)
  const nextAvatarColor = updates.avatar_color || currentAvatarColor

  const updateStmt = db.prepare(`
    UPDATE users SET nickname = ?, avatar_color = ?, updated_at = ? WHERE id = ?
  `)
  updateStmt.run(nextNickname, nextAvatarColor, now, userId)

  return {
    ...toSafeUser(current),
    nickname: nextNickname,
    avatar_color: nextAvatarColor,
    updated_at: now,
  }
}
