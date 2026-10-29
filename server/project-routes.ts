import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { extractSessionToken } from './auth-routes'
import { validateSession } from './auth'
import type { CloudProjectRow } from './db'
import type { RateLimiter } from './rate-limit'
import {
  MAX_PROJECTS_PER_USER,
  MAX_TOTAL_PROJECT_BYTES_PER_USER,
  getUserStorageStats,
  projectBytes,
} from './cloud-quota'

export interface ProjectRoutesOptions {
  // Cloud drafts are unbounded writes keyed only by a session token, so a
  // compromised or scripted account can hammer the database without a limiter.
  rateLimiter?: RateLimiter
  // Per-user ceilings; overridable in tests, production uses the defaults.
  quota?: { maxProjects: number; maxTotalBytes: number }
}

// The list must stay metadata-only: state_json carries the full serialized
// editor state (stroke point arrays included) and can reach 16 MiB per draft,
// so SELECT * here once made a 100-row list respond with up to ~1.6 GB. The
// client renders thumbnails and titles from the list and restores drafts from
// its local copy; the full row stays available per id.
const PROJECT_LIST_COLUMNS =
  'id, user_id, title, original_filename, dimensions_width, dimensions_height, thumbnail_data, created_at, updated_at'

export function registerProjectRoutes(app: FastifyInstance, db: DatabaseSync, options: ProjectRoutesOptions = {}): void {
  const rateLimiter = options.rateLimiter
  const quota = options.quota ?? {
    maxProjects: MAX_PROJECTS_PER_USER,
    maxTotalBytes: MAX_TOTAL_PROJECT_BYTES_PER_USER,
  }

  const denyWhenOverLimit = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (rateLimiter && !rateLimiter.allow(request)) {
      void reply.header('Retry-After', '60').status(429).send({
        error: 'rate_limited',
        message: '请求过于频繁，请稍后再试',
      })
      return true
    }
    return false
  }

  const requireUser = (request: FastifyRequest, reply: FastifyReply): { id: string } | null => {
    const token = extractSessionToken(request)
    if (!token) {
      void reply.status(401).send({ error: 'unauthorized', message: '请先登录' })
      return null
    }
    const user = validateSession(db, token)
    if (!user) {
      void reply.status(401).send({ error: 'unauthorized', message: '会话已过期，请重新登录' })
      return null
    }
    return user
  }

  // List user's cloud projects (metadata + thumbnail, never state_json)
  app.get('/api/v1/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    if (denyWhenOverLimit(request, reply)) return
    const user = requireUser(request, reply)
    if (!user) return

    const stmt = db.prepare(`
      SELECT ${PROJECT_LIST_COLUMNS} FROM cloud_projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100
    `)
    const projects = stmt.all(user.id) as unknown as Omit<CloudProjectRow, 'state_json'>[]
    return reply.status(200).send({ projects })
  })

  // Full project incl. state_json, for a client that needs the serialized
  // editor state of a draft whose original blob is not in local IndexedDB.
  app.get('/api/v1/projects/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    if (denyWhenOverLimit(request, reply)) return
    const user = requireUser(request, reply)
    if (!user) return

    const stmt = db.prepare('SELECT * FROM cloud_projects WHERE id = ? AND user_id = ?')
    const project = stmt.get(request.params.id, user.id) as unknown as CloudProjectRow | undefined
    if (!project) {
      return reply.status(404).send({ error: 'project_not_found', message: '项目不存在' })
    }
    return reply.status(200).send({ project })
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
    if (denyWhenOverLimit(request, reply)) return
    const user = requireUser(request, reply)
    if (!user) return

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

    // Per-user quota: a new draft consumes one slot and its full size; an
    // update only pays the delta over the stored row.
    const incomingBytes = projectBytes({
      title: String(title),
      original_filename: String(original_filename),
      thumbnail_data: String(thumbnail_data),
      state_json: String(state_json),
    })
    const stats = getUserStorageStats(db, user.id)
    if (existing) {
      const projectedBytes = stats.bytes - projectBytes(existing) + incomingBytes
      if (projectedBytes > quota.maxTotalBytes) {
        return reply.status(413).send({
          error: 'quota_exceeded',
          reason: 'storage_limit',
          message: '云端草稿总容量已达上限，请清理不再需要的草稿后再同步',
        })
      }
    } else {
      if (stats.projects >= quota.maxProjects) {
        return reply.status(413).send({
          error: 'quota_exceeded',
          reason: 'project_limit',
          message: '云端草稿数量已达上限，请清理不再需要的草稿后再同步',
        })
      }
      if (stats.bytes + incomingBytes > quota.maxTotalBytes) {
        return reply.status(413).send({
          error: 'quota_exceeded',
          reason: 'storage_limit',
          message: '云端草稿总容量已达上限，请清理不再需要的草稿后再同步',
        })
      }
    }

    if (existing) {
      const updateStmt = db.prepare(`
        UPDATE cloud_projects
        SET title = ?, original_filename = ?, dimensions_width = ?, dimensions_height = ?, thumbnail_data = ?, state_json = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `)
      updateStmt.run(title, original_filename, width, height, thumbnail_data, state_json, now, projectId, user.id)
    } else {
      // A client-supplied id may already exist under a different user; the
      // UNIQUE constraint must surface as a contract error, not a raw 500.
      try {
        const insertStmt = db.prepare(`
          INSERT INTO cloud_projects (id, user_id, title, original_filename, dimensions_width, dimensions_height, thumbnail_data, state_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        insertStmt.run(projectId, user.id, title, original_filename, width, height, thumbnail_data, state_json, now, now)
      } catch (err: any) {
        if (typeof err?.message === 'string' && err.message.includes('UNIQUE constraint failed')) {
          return reply.status(409).send({
            error: 'project_conflict',
            message: '该项目 id 已被占用，请刷新后重试',
          })
        }
        throw err
      }
    }

    const fetchStmt = db.prepare('SELECT * FROM cloud_projects WHERE id = ?')
    const project = fetchStmt.get(projectId) as unknown as CloudProjectRow | undefined
    return reply.status(200).send({ project })
  })

  // Delete project
  app.delete('/api/v1/projects/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    if (denyWhenOverLimit(request, reply)) return
    const user = requireUser(request, reply)
    if (!user) return

    const projectId = request.params.id
    const deleteStmt = db.prepare('DELETE FROM cloud_projects WHERE id = ? AND user_id = ?')
    deleteStmt.run(projectId, user.id)

    return reply.status(200).send({ ok: true })
  })
}
