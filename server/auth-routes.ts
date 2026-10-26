import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import {
  authenticateUser,
  createSession,
  createUser,
  deleteSession,
  updateUserProfile,
  validateSession,
  type SafeUser,
} from './auth'

export function extractSessionToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }
  const cookieHeader = request.headers.cookie
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/oneimage_session=([^;]+)/)
    if (match) return match[1].trim()
  }
  return null
}

export function registerAuthRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Register
  app.post('/api/v1/auth/register', async (request: FastifyRequest<{
    Body: { username?: string; email?: string; password?: string; nickname?: string }
  }>, reply: FastifyReply) => {
    const { username, email, password, nickname } = request.body || {}

    if (!username || !email || !password) {
      return reply.status(400).send({
        error: 'missing_fields',
        message: '用户名、邮箱和密码为必填项',
      })
    }

    const cleanUsername = username.trim().toLowerCase()
    const cleanEmail = email.trim().toLowerCase()

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(cleanUsername)) {
      return reply.status(400).send({
        error: 'invalid_username',
        message: '用户名须为 3-24 位字母、数字或下划线',
      })
    }

    if (!cleanEmail.includes('@') || cleanEmail.length > 128) {
      return reply.status(400).send({
        error: 'invalid_email',
        message: '请输入有效的邮箱地址',
      })
    }

    if (password.length < 6 || password.length > 128) {
      return reply.status(400).send({
        error: 'invalid_password',
        message: '密码长度需在 6-128 位之间',
      })
    }

    try {
      const user = createUser(db, {
        username: cleanUsername,
        email: cleanEmail,
        password,
        nickname,
      })
      const session = createSession(db, user.id)

      reply.header(
        'Set-Cookie',
        `oneimage_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
      )
      return reply.status(201).send({
        user,
        sessionToken: session.token,
      })
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint failed')) {
        return reply.status(409).send({
          error: 'user_exists',
          message: '用户名或邮箱已被注册',
        })
      }
      request.log.error({ err }, 'Failed to register user')
      return reply.status(500).send({ error: 'server_error', message: '注册失败，请重试' })
    }
  })

  // Login
  app.post('/api/v1/auth/login', async (request: FastifyRequest<{
    Body: { account?: string; password?: string }
  }>, reply: FastifyReply) => {
    const { account, password } = request.body || {}

    if (!account || !password) {
      return reply.status(400).send({
        error: 'missing_fields',
        message: '账号与密码不能为空',
      })
    }

    const user = authenticateUser(db, account, password)
    if (!user) {
      return reply.status(401).send({
        error: 'invalid_credentials',
        message: '用户名/邮箱或密码错误',
      })
    }

    const session = createSession(db, user.id)
    reply.header(
      'Set-Cookie',
      `oneimage_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
    )
    return reply.status(200).send({
      user,
      sessionToken: session.token,
    })
  })

  // Logout
  app.post('/api/v1/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractSessionToken(request)
    if (token) {
      deleteSession(db, token)
    }
    reply.header(
      'Set-Cookie',
      'oneimage_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
    )
    return reply.status(200).send({ ok: true })
  })

  // Current session info (Guest friendly)
  app.get('/api/v1/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(200).send({ authenticated: false, user: null })
    }

    const user = validateSession(db, token)
    if (!user) {
      return reply.status(200).send({ authenticated: false, user: null })
    }

    return reply.status(200).send({ authenticated: true, user })
  })

  // Update profile
  app.patch('/api/v1/auth/profile', async (request: FastifyRequest<{
    Body: { nickname?: string; avatar_color?: string }
  }>, reply: FastifyReply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ error: 'unauthorized', message: '请先登录' })
    }

    const user = validateSession(db, token)
    if (!user) {
      return reply.status(401).send({ error: 'unauthorized', message: '登录状态已过期，请重新登录' })
    }

    const updated = updateUserProfile(db, user.id, request.body || {})
    return reply.status(200).send({ user: updated })
  })
}
