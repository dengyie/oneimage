import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import Fastify from 'fastify'
import { initDatabase } from '../server/db'
import { registerAuthRoutes } from '../server/auth-routes'
import { createRateLimiter } from '../server/rate-limit'
import { createFakeMailer, registerViaEmailCode, type FakeMailer } from './helpers'

describe('Auth routes', () => {
  function createTestApp(options?: Parameters<typeof registerAuthRoutes>[2]): { app: ReturnType<typeof Fastify>; appDb: { db: DatabaseSync; close: () => void }; mailer: FakeMailer } {
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    const mailer = createFakeMailer()
    registerAuthRoutes(app, appDb.db, { mailer, ...options })
    return { app, appDb, mailer }
  }

  it('allows user registration and returns user profile, session cookie and hashed token storage', async () => {
    const { app, appDb, mailer } = createTestApp()

    const res = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
      nickname: 'Alice Walker',
    })

    expect(res.statusCode).toBe(201)
    const data = JSON.parse(res.body)
    expect(data.user.username).toBe('alice')
    expect(data.user.email).toBe('alice@example.com')
    expect(data.user.nickname).toBe('Alice Walker')
    expect(data.sessionToken).toBeDefined()

    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toContain('oneimage_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')

    // Only the SHA-256 digest of the token may exist at rest.
    const stored = appDb.db.prepare('SELECT token FROM sessions LIMIT 1').get() as { token: string }
    expect(stored.token).toBe(createHash('sha256').update(data.sessionToken).digest('hex'))
    expect(stored.token).not.toBe(data.sessionToken)

    appDb.close()
  })

  it('rejects duplicate username or email with 409', async () => {
    const { app, appDb, mailer } = createTestApp()

    await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'bob123',
      email: 'bob@example.com',
      password: 'password123',
    })

    const dupRes = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'bob123',
      email: 'bob_other@example.com',
      password: 'password123',
    })

    expect(dupRes.statusCode).toBe(409)
    const data = JSON.parse(dupRes.body)
    expect(data.error).toBe('user_exists')

    appDb.close()
  })

  it('validates registration input with 400 before touching the database', async () => {
    const { app, appDb, mailer } = createTestApp()

    const cases = [
      { payload: { username: 'ab', email: 'ab@example.com', password: 'password123' }, error: 'invalid_username' },
      { payload: { username: 'abc', email: 'not-an-email', password: 'password123' }, error: 'invalid_email' },
      { payload: { username: 'abc', email: 'abc@example.com', password: '12345' }, error: 'invalid_password' },
      { payload: { email: 'abc@example.com', password: 'password123' }, error: 'missing_fields' },
      { payload: { username: 'abc', email: 'abc@example.com', password: 'password123' }, error: 'email_code_required' },
    ]

    for (const { payload, error } of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
      expect(JSON.parse(res.body).error).toBe(error)
    }

    appDb.close()
  })

  it('authenticates with valid credentials and rejects invalid password', async () => {
    const { app, appDb, mailer } = createTestApp()

    await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'charlie',
      email: 'charlie@example.com',
      password: 'correct-password',
    })

    // Fail login
    const failRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        account: 'charlie',
        password: 'wrong-password',
      },
    })
    expect(failRes.statusCode).toBe(401)

    // Unknown account must not be faster than a wrong password (timing equality)
    const unknownStart = process.hrtime.bigint()
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { account: 'who-does-not-exist', password: 'whatever' },
    })
    const unknownElapsedMs = Number(process.hrtime.bigint() - unknownStart) / 1e6
    expect(unknownElapsedMs).toBeGreaterThan(10)

    // Success login by username
    const okRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        account: 'charlie',
        password: 'correct-password',
      },
    })
    expect(okRes.statusCode).toBe(200)
    const okData = JSON.parse(okRes.body)
    expect(okData.user.username).toBe('charlie')
    expect(okData.sessionToken).toBeDefined()

    // Success login by email
    const emailRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        account: 'charlie@example.com',
        password: 'correct-password',
      },
    })
    expect(emailRes.statusCode).toBe(200)

    appDb.close()
  })

  it('throttles scrypt-backed endpoints per client after the per-window cap', async () => {
    const { app, appDb, mailer } = createTestApp({
      rateLimiter: createRateLimiter({ windowMs: 60_000, maxRequestsPerWindow: 10, maxTrackedClients: 100 }),
    })
    const attackerHeaders = { 'cf-connecting-ip': '203.0.113.7' }

    const regRes = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'ratelimit', email: 'rl@example.com', password: 'password123',
    })
    expect(regRes.statusCode).toBe(201)

    // 10 attacker logins fill the 10-request window (the registration used a
    // different client key: the helper posts without forwarded headers).
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: attackerHeaders,
        payload: { account: 'ratelimit', password: 'wrong-guess' },
      })
      expect(res.statusCode).toBe(401)
    }

    const throttled = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: attackerHeaders,
      payload: { account: 'ratelimit', password: 'wrong-guess' },
    })
    expect(throttled.statusCode).toBe(429)
    expect(JSON.parse(throttled.body).error).toBe('rate_limited')
    expect(throttled.headers['retry-after']).toBe('60')

    // A different forwarded client is unaffected.
    const otherClient = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'cf-connecting-ip': '198.51.100.9' },
      payload: { account: 'ratelimit', password: 'wrong-guess' },
    })
    expect(otherClient.statusCode).toBe(401)

    appDb.close()
  })

  it('rejects expired sessions and purges them on the next login', async () => {
    const { app, appDb, mailer } = createTestApp()

    const regRes = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'expiree', email: 'expire@example.com', password: 'password123',
    })
    const { sessionToken } = JSON.parse(regRes.body)

    // Plant an expired session for a second token.
    const expiredHash = createHash('sha256').update('expired-token').digest('hex')
    appDb.db
      .prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(expiredHash, JSON.parse(regRes.body).user.id, Date.now() - 1000, Date.now() - 2000)

    const expiredRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer expired-token' },
    })
    expect(JSON.parse(expiredRes.body)).toEqual({ authenticated: false, user: null })

    // Login purges expired rows.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { account: 'expiree', password: 'password123' },
    })
    expect(loginRes.statusCode).toBe(200)
    const remaining = appDb.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at < ?').get(Date.now()) as { n: number }
    expect(remaining.n).toBe(0)

    // The live token keeps working.
    const liveRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${sessionToken}` },
    })
    expect(JSON.parse(liveRes.body).authenticated).toBe(true)

    appDb.close()
  })

  it('updates profile and ignores invalid avatar colors', async () => {
    const { app, appDb, mailer } = createTestApp()

    const regRes = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'styler', email: 'style@example.com', password: 'password123',
    })
    const token = JSON.parse(regRes.body).sessionToken

    const noToken = await app.inject({ method: 'PATCH', url: '/api/v1/auth/profile', payload: { nickname: 'x' } })
    expect(noToken.statusCode).toBe(401)

    const okRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { nickname: '设计小林', avatar_color: '#8b5cf6' },
    })
    expect(okRes.statusCode).toBe(200)
    const updated = JSON.parse(okRes.body).user
    expect(updated.nickname).toBe('设计小林')
    expect(updated.avatar_color).toBe('#8b5cf6')

    // Garbage colors must not corrupt the stored value.
    const badColorRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatar_color: 'javascript:alert(1)' },
    })
    expect(badColorRes.statusCode).toBe(200)
    expect(JSON.parse(badColorRes.body).user.avatar_color).toBe('#8b5cf6')

    appDb.close()
  })

  it('reports guest status for unauthenticated /me and user info when token provided', async () => {
    const { app, appDb, mailer } = createTestApp()

    // Guest call
    const guestRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    })
    expect(guestRes.statusCode).toBe(200)
    expect(JSON.parse(guestRes.body)).toEqual({ authenticated: false, user: null })

    // Register & get token
    const regRes = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'david',
      email: 'david@example.com',
      password: 'password123',
    })
    const { sessionToken } = JSON.parse(regRes.body)

    // Authenticated call via Bearer header
    const authRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    })
    expect(authRes.statusCode).toBe(200)
    const authData = JSON.parse(authRes.body)
    expect(authData.authenticated).toBe(true)
    expect(authData.user.username).toBe('david')

    // Logout
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    })
    expect(logoutRes.statusCode).toBe(200)

    // Subsequent call should be unauthenticated
    const afterLogoutRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    })
    expect(JSON.parse(afterLogoutRes.body)).toEqual({ authenticated: false, user: null })

    appDb.close()
  })

  it('sends verification codes through the mailer and enforces per-email gates', async () => {
    const { app, appDb, mailer } = createTestApp()

    const missing = await app.inject({ method: 'POST', url: '/api/v1/auth/email-code', payload: {} })
    expect(missing.statusCode).toBe(400)
    expect(JSON.parse(missing.body).error).toBe('invalid_email')

    const sendRes = await app.inject({ method: 'POST', url: '/api/v1/auth/email-code', payload: { email: 'coder@example.com' } })
    expect(sendRes.statusCode).toBe(200)
    expect(JSON.parse(sendRes.body).resendAfterSeconds).toBe(60)
    expect(mailer.outbox).toHaveLength(1)
    expect(mailer.outbox[0].to).toBe('coder@example.com')
    expect(mailer.outbox[0].code).toMatch(/^\d{6}$/)

    // Resend cooldown (60s per email).
    const throttled = await app.inject({ method: 'POST', url: '/api/v1/auth/email-code', payload: { email: 'coder@example.com' } })
    expect(throttled.statusCode).toBe(429)
    expect(JSON.parse(throttled.body).reason).toBe('cooldown')
    expect(throttled.headers['retry-after']).toBeDefined()

    appDb.close()
  })

  it('returns 503 for email codes when mail delivery is not configured', async () => {
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    registerAuthRoutes(app, appDb.db)

    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/email-code', payload: { email: 'x@example.com' } })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).error).toBe('mail_unconfigured')

    // Registration still answers with the code gate (not 503).
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'nocfg', email: 'x@example.com', password: 'password123' },
    })
    expect(regRes.statusCode).toBe(400)
    expect(JSON.parse(regRes.body).error).toBe('email_code_required')

    appDb.close()
  })

  it('locks a verification code after five wrong attempts and honours expiry', async () => {
    const { app, appDb, mailer } = createTestApp()

    await app.inject({ method: 'POST', url: '/api/v1/auth/email-code', payload: { email: 'locker@example.com' } })

    for (let i = 0; i < 5; i++) {
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { username: 'locker', email: 'locker@example.com', password: 'password123', email_code: '000000' },
      })
      expect(wrong.statusCode).toBe(400)
      const body = JSON.parse(wrong.body)
      if (i < 4) expect(body.error).toBe('invalid_email_code')
      else expect(body.error).toBe('email_code_locked')
    }

    // Even the correct code no longer works after the lockout.
    const realCode = mailer.outbox.at(-1)!.code
    const evenCorrect = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'locker', email: 'locker@example.com', password: 'password123', email_code: realCode },
    })
    expect(evenCorrect.statusCode).toBe(400)
    expect(JSON.parse(evenCorrect.body).error).toBe('email_code_required')

    // Expired code path.
    await app.inject({ method: 'POST', url: '/api/v1/auth/email-code', payload: { email: 'stale@example.com' } })
    appDb.db.prepare('UPDATE email_verifications SET expires_at = ? WHERE email = ?').run(Date.now() - 1, 'stale@example.com')
    const staleCode = mailer.outbox.filter((e) => e.to === 'stale@example.com').at(-1)!.code
    const expired = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'stale', email: 'stale@example.com', password: 'password123', email_code: staleCode },
    })
    expect(expired.statusCode).toBe(400)
    expect(JSON.parse(expired.body).error).toBe('email_code_expired')

    appDb.close()
  })

  it('caps verification emails per address at five per hour window', async () => {
    const { app, appDb, mailer } = createTestApp()

    const email = 'hammered@example.com'
    for (let i = 0; i < 5; i++) {
      // Rewind the cooldown so each send passes the 60s gate; the hourly
      // counter keeps climbing within its own window.
      appDb.db.prepare('UPDATE email_verifications SET last_sent_at = ? WHERE email = ?').run(Date.now() - 61_000, email)
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/email-code', payload: { email } })
      expect(res.statusCode).toBe(200)
    }
    expect(mailer.outbox.filter((e) => e.to === email)).toHaveLength(5)

    // Past the resend cooldown but still inside the same hourly window.
    appDb.db.prepare('UPDATE email_verifications SET last_sent_at = ? WHERE email = ?').run(Date.now() - 61_000, email)
    const capped = await app.inject({ method: 'POST', url: '/api/v1/auth/email-code', payload: { email } })
    expect(capped.statusCode).toBe(429)
    expect(JSON.parse(capped.body).reason).toBe('hourly_limit')

    appDb.close()
  })

  it('rejects registration with a wrong code and completes with the mailed one', async () => {
    const { app, appDb, mailer } = createTestApp()

    await app.inject({ method: 'POST', url: '/api/v1/auth/email-code', payload: { email: 'final@example.com' } })
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'final', email: 'final@example.com', password: 'password123', email_code: '999999' },
    })
    expect(wrong.statusCode).toBe(400)
    expect(JSON.parse(wrong.body).error).toBe('invalid_email_code')

    // The real code was invalidated by the failed attempt? No: attempts=1 of 5,
    // the code remains valid until 5 failures or success.
    const realCode = mailer.outbox.at(-1)!.code
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'final', email: 'final@example.com', password: 'password123', email_code: realCode },
    })
    expect(ok.statusCode).toBe(201)

    // Codes are single-use: replaying it must fail.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'final2', email: 'final@example.com', password: 'password123', email_code: realCode },
    })
    expect(replay.statusCode).toBe(400)
    expect(JSON.parse(replay.body).error).toBe('email_code_required')

    appDb.close()
  })
})
