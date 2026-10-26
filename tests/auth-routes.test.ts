import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { initDatabase } from '../server/db'
import { registerAuthRoutes } from '../server/auth-routes'

describe('Auth routes', () => {
  function createTestApp() {
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    registerAuthRoutes(app, appDb.db)
    return { app, appDb }
  }

  it('allows user registration and returns user profile and session cookie', async () => {
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
    expect(res.headers['set-cookie']).toContain('oneimage_session=')

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
