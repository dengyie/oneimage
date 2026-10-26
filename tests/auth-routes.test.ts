import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import Fastify from 'fastify'
import { initDatabase } from '../server/db'
import { registerAuthRoutes } from '../server/auth-routes'
import { createRateLimiter } from '../server/rate-limit'

describe('Auth routes', () => {
  function createTestApp(options?: Parameters<typeof registerAuthRoutes>[2]) {
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    registerAuthRoutes(app, appDb.db, options)
    return { app, appDb }
  }

  it('allows user registration and returns user profile, session cookie and hashed token storage', async () => {
    const { app, appDb } = createTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: 'alice',
        email: 'alice@example.com',
        password: 'password123',
        nickname: 'Alice Walker',
      },
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
    const { app, appDb } = createTestApp()

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: 'bob123',
        email: 'bob@example.com',
        password: 'password123',
      },
    })

    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: 'bob123',
        email: 'bob_other@example.com',
        password: 'password123',
      },
    })

    expect(dupRes.statusCode).toBe(409)
    const data = JSON.parse(dupRes.body)
    expect(data.error).toBe('user_exists')

    appDb.close()
  })

  it('validates registration input with 400 before touching the database', async () => {
    const { app, appDb } = createTestApp()

    const cases = [
      { payload: { username: 'ab', email: 'ab@example.com', password: 'password123' }, error: 'invalid_username' },
      { payload: { username: 'abc', email: 'not-an-email', password: 'password123' }, error: 'invalid_email' },
      { payload: { username: 'abc', email: 'abc@example.com', password: '12345' }, error: 'invalid_password' },
      { payload: { email: 'abc@example.com', password: 'password123' }, error: 'missing_fields' },
    ]

    for (const { payload, error } of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
      expect(JSON.parse(res.body).error).toBe(error)
    }

    appDb.close()
  })

  it('authenticates with valid credentials and rejects invalid password', async () => {
    const { app, appDb } = createTestApp()

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: 'charlie',
        email: 'charlie@example.com',
        password: 'correct-password',
      },
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
    const { app, appDb } = createTestApp({
      rateLimiter: createRateLimiter({ windowMs: 60_000, maxRequestsPerWindow: 10, maxTrackedClients: 100 }),
    })
    const attackerHeaders = { 'cf-connecting-ip': '203.0.113.7' }

    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: attackerHeaders,
      payload: { username: 'ratelimit', email: 'rl@example.com', password: 'password123' },
    })
    expect(regRes.statusCode).toBe(201)

    // register + 9 logins fill the 10-request window
    for (let i = 0; i < 9; i++) {
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
    const { app, appDb } = createTestApp()

    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'expiree', email: 'expire@example.com', password: 'password123' },
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
    const { app, appDb } = createTestApp()

    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'styler', email: 'style@example.com', password: 'password123' },
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
    const { app, appDb } = createTestApp()

    // Guest call
    const guestRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    })
    expect(guestRes.statusCode).toBe(200)
    expect(JSON.parse(guestRes.body)).toEqual({ authenticated: false, user: null })

    // Register & get token
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username: 'david',
        email: 'david@example.com',
        password: 'password123',
      },
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
})
