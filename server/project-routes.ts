import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { extractSessionToken } from './auth-routes'
import { validateSession } from './auth'
import type { CloudProjectRow } from './db'

export function registerProjectRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // List user's cloud projects
  app.get('/api/v1/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ error: 'unauthorized', message: '请先登录以查看云端草稿' })
    }

    const user = validateSession(db, token)
    if (!user) {
      return reply.status(401).send({ error: 'unauthorized', message: '会话已过期，请重新登录' })
    }

    const stmt = db.prepare(`
      SELECT * FROM cloud_projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100
    `)
    const projects = stmt.all(user.id) as unknown as CloudProjectRow[]
    return reply.status(200).send({ projects })
  })

  // Save / Sync project
  app.post('/api/v1/projects', async (request: FastifyRequest<{
    Body: {
      id?: string
      title?: string
      original_filename?: string
      dimensions_width?: number
      dimensions_height?: number
      thumbnail_data?: string
      state_json?: string
    }
  }>, reply: FastifyReply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ error: 'unauthorized', message: '请先登录以同步云端草稿' })
    }

    const user = validateSession(db, token)
    if (!user) {
      return reply.status(401).send({ error: 'unauthorized', message: '会话已过期，请重新登录' })
    }

    const {
      id: incomingId,
      title,
      original_filename,
      dimensions_width,
      dimensions_height,
      thumbnail_data,
      state_json,
    } = request.body || {}

    if (!title || !original_filename || !thumbnail_data || !state_json) {
      return reply.status(400).send({
        error: 'missing_fields',
        message: '项目标题、原文件名、缩略图与编辑状态不能为空',
      })
    }

    const now = Date.now()
    const projectId = incomingId || `proj_${randomBytes(12).toString('hex')}`
    const width = Number(dimensions_width) || 0
    const height = Number(dimensions_height) || 0

    // Check if project exists and belongs to user
    const checkStmt = db.prepare(`
      SELECT * FROM cloud_projects WHERE id = ? AND user_id = ?
    `)
    const existing = checkStmt.get(projectId, user.id) as unknown as CloudProjectRow | undefined

    if (existing) {
      const updateStmt = db.prepare(`
        UPDATE cloud_projects
        SET title = ?, original_filename = ?, dimensions_width = ?, dimensions_height = ?, thumbnail_data = ?, state_json = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `)
      updateStmt.run(title, original_filename, width, height, thumbnail_data, state_json, now, projectId, user.id)
    } else {
      const insertStmt = db.prepare(`
        INSERT INTO cloud_projects (id, user_id, title, original_filename, dimensions_width, dimensions_height, thumbnail_data, state_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      insertStmt.run(projectId, user.id, title, original_filename, width, height, thumbnail_data, state_json, now, now)
    }

    const fetchStmt = db.prepare('SELECT * FROM cloud_projects WHERE id = ?')
    const project = fetchStmt.get(projectId) as unknown as CloudProjectRow | undefined
    return reply.status(200).send({ project })
  })

  // Delete project
  app.delete('/api/v1/projects/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const token = extractSessionToken(request)
    if (!token) {
      return reply.status(401).send({ error: 'unauthorized', message: '请先登录' })
    }

    const user = validateSession(db, token)
    if (!user) {
      return reply.status(401).send({ error: 'unauthorized', message: '会话已过期，请重新登录' })
    }

    const projectId = request.params.id
    const deleteStmt = db.prepare('DELETE FROM cloud_projects WHERE id = ? AND user_id = ?')
    deleteStmt.run(projectId, user.id)

    return reply.status(200).send({ ok: true })
  })
}
