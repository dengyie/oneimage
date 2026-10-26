import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000
export const EMAIL_CODE_MAX_ATTEMPTS = 5
export const EMAIL_CODE_RESEND_COOLDOWN_MS = 60 * 1000
export const EMAIL_CODE_HOURLY_LIMIT = 5
export const EMAIL_CODE_HOURLY_WINDOW_MS = 60 * 60 * 1000

export interface EmailCodeRow {
  email: string
  code_hash: string
  attempts: number
  expires_at: number
  last_sent_at: number
  sent_count: number
  window_start: number
}

// Codes are stored hashed and bound to the requesting email, mirroring the
// session-token-at-rest policy: a leaked database file must not yield usable
// verification codes.
function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex')
}

export function generateEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function getCodeRow(db: DatabaseSync, email: string): EmailCodeRow | undefined {
  return db.prepare('SELECT * FROM email_verifications WHERE email = ?').get(email) as unknown as EmailCodeRow | undefined
}

export type SendGate =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'hourly_limit'; retryAfterSeconds: number }

// Per-email abuse gate, durable across restarts (the per-IP limiter is
// in-memory): a resend cooldown plus a rolling hourly cap so one address
// cannot be mail-bombed through the endpoint.
export function checkEmailCodeSendGate(db: DatabaseSync, email: string, now = Date.now()): SendGate {
  const row = getCodeRow(db, email)
  if (!row) return { ok: true }

  const cooldownRemaining = EMAIL_CODE_RESEND_COOLDOWN_MS - (now - row.last_sent_at)
  if (cooldownRemaining > 0) {
    return { ok: false, reason: 'cooldown', retryAfterSeconds: Math.ceil(cooldownRemaining / 1000) }
  }

  const windowActive = now - row.window_start < EMAIL_CODE_HOURLY_WINDOW_MS
  if (windowActive && row.sent_count >= EMAIL_CODE_HOURLY_LIMIT) {
    const retryAfterSeconds = Math.ceil((row.window_start + EMAIL_CODE_HOURLY_WINDOW_MS - now) / 1000)
    return { ok: false, reason: 'hourly_limit', retryAfterSeconds }
  }
  return { ok: true }
}

export function storeEmailCode(db: DatabaseSync, email: string, code: string, now = Date.now()): void {
  const row = getCodeRow(db, email)
  const windowActive = row !== undefined && now - row.window_start < EMAIL_CODE_HOURLY_WINDOW_MS
  db.prepare(`
    INSERT INTO email_verifications (email, code_hash, attempts, expires_at, last_sent_at, sent_count, window_start)
    VALUES (?, ?, 0, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      code_hash = excluded.code_hash,
      attempts = 0,
      expires_at = excluded.expires_at,
      last_sent_at = excluded.last_sent_at,
      sent_count = excluded.sent_count,
      window_start = excluded.window_start
  `).run(
    email,
    hashCode(email, code),
    now + EMAIL_CODE_TTL_MS,
    now,
    windowActive ? row!.sent_count + 1 : 1,
    windowActive ? row!.window_start : now,
  )
}

export type EmailCodeVerifyResult = 'ok' | 'missing' | 'expired' | 'locked' | 'mismatch'

export function verifyEmailCode(db: DatabaseSync, email: string, code: string, now = Date.now()): EmailCodeVerifyResult {
  const row = getCodeRow(db, email)
  if (!row) return 'missing'
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM email_verifications WHERE email = ?').run(email)
    return 'expired'
  }
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM email_verifications WHERE email = ?').run(email)
    return 'locked'
  }

  const provided = Buffer.from(hashCode(email, code), 'hex')
  const expected = Buffer.from(row.code_hash, 'hex')
  const matched = provided.length === expected.length && timingSafeEqual(provided, expected)
  if (matched) {
    db.prepare('DELETE FROM email_verifications WHERE email = ?').run(email)
    return 'ok'
  }

  const nextAttempts = row.attempts + 1
  if (nextAttempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    // The code is spent: delete it and tell the caller the address is locked
    // out, so the next attempt reads as "request a new code" rather than
    // silently continuing a doomed guess loop.
    db.prepare('DELETE FROM email_verifications WHERE email = ?').run(email)
    return 'locked'
  }
  db.prepare('UPDATE email_verifications SET attempts = ? WHERE email = ?').run(nextAttempts, email)
  return 'mismatch'
}
