import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { initDatabase } from '../server/db'
import { registerAuthRoutes } from '../server/auth-routes'
import { registerProjectRoutes } from '../server/project-routes'
import { createFakeMailer, registerViaEmailCode, sessionTokenFrom, type FakeMailer } from './helpers'

describe('Project routes', () => {
  function createTestApp(): { app: ReturnType<typeof Fastify>; appDb: { db: DatabaseSync; close: () => void }; mailer: FakeMailer } {
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    const mailer = createFakeMailer()
    registerAuthRoutes(app, appDb.db, { mailer })
    registerProjectRoutes(app, appDb.db)
    return { app, appDb, mailer }
  }

  it('rejects unauthenticated access with 401', async () => {
    const { app, appDb, mailer } = createTestApp()

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
    })
    expect(listRes.statusCode).toBe(401)

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { title: 'Test' },
    })
    expect(createRes.statusCode).toBe(401)

    appDb.close()
  })

  it('rejects invalid payloads with 400 and cross-user project ids with 409', async () => {
    const { app, appDb, mailer } = createTestApp()

    const regA = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'owner_a', email: 'oa@example.com', password: 'password123',
    })
    const tokenA = sessionTokenFrom(regA)

    const regB = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'owner_b', email: 'ob@example.com', password: 'password123',
    })
    const tokenB = sessionTokenFrom(regB)

    // Missing required fields
    const missingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { title: 'Only a title' },
    })
    expect(missingRes.statusCode).toBe(400)
    expect(JSON.parse(missingRes.body).error).toBe('missing_fields')

    // User A saves a project with a server-accepted id
    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        id: 'proj_owned_by_a',
        title: 'A 的项目',
        original_filename: 'a.jpg',
        dimensions_width: 10,
        dimensions_height: 10,
        thumbnail_data: 'data:stub',
        state_json: '{}',
      },
    })
    expect(saveRes.statusCode).toBe(200)

    // User B tries to claim the same id: contract error, not a raw 500.
    const conflictRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        id: 'proj_owned_by_a',
        title: 'B 的抢注',
        original_filename: 'b.jpg',
        dimensions_width: 10,
        dimensions_height: 10,
        thumbnail_data: 'data:stub',
        state_json: '{}',
      },
    })
    expect(conflictRes.statusCode).toBe(409)
    expect(JSON.parse(conflictRes.body).error).toBe('project_conflict')

    // A's project must be untouched.
    const listA = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${tokenA}` },
    })
    const projectsA = JSON.parse(listA.body).projects
    expect(projectsA).toHaveLength(1)
    expect(projectsA[0].title).toBe('A 的项目')

    appDb.close()
  })

  it('allows user to save, list, update, and delete cloud projects with tenant isolation', async () => {
    const { app, appDb, mailer } = createTestApp()

    // Register User A
    const regA = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'user_a', email: 'a@example.com', password: 'password123',
    })
    const tokenA = sessionTokenFrom(regA)

    // Register User B
    const regB = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'user_b', email: 'b@example.com', password: 'password123',
    })
    const tokenB = sessionTokenFrom(regB)

    // User A saves project
    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        title: 'Project 1',
        original_filename: 'photo.jpg',
        dimensions_width: 1920,
        dimensions_height: 1080,
        thumbnail_data: 'data:image/webp;base64,stub',
        state_json: JSON.stringify({ crop: { x: 0, y: 0, width: 1920, height: 1080 } }),
      },
    })
    expect(saveRes.statusCode).toBe(200)
    const { project } = JSON.parse(saveRes.body)
    expect(project.title).toBe('Project 1')
    expect(project.id).toBeDefined()

    // User A lists projects -> 1
    const listA = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${tokenA}` },
    })
    expect(listA.statusCode).toBe(200)
    expect(JSON.parse(listA.body).projects.length).toBe(1)

    // User B lists projects -> 0 (Tenant Isolation)
    const listB = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${tokenB}` },
    })
    expect(listB.statusCode).toBe(200)
    expect(JSON.parse(listB.body).projects.length).toBe(0)

    // User A updates project
    const updateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        id: project.id,
        title: 'Project 1 (Renamed)',
        original_filename: 'photo.jpg',
        dimensions_width: 1920,
        dimensions_height: 1080,
        thumbnail_data: 'data:image/webp;base64,stub',
        state_json: JSON.stringify({ crop: { x: 10, y: 10, width: 500, height: 500 } }),
      },
    })
    expect(updateRes.statusCode).toBe(200)
    expect(JSON.parse(updateRes.body).project.title).toBe('Project 1 (Renamed)')

    // User A deletes project
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    })
    expect(delRes.statusCode).toBe(200)

    // User A lists projects -> 0
    const listAAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${tokenA}` },
    })
    expect(JSON.parse(listAAfter.body).projects.length).toBe(0)

    appDb.close()
  })

  it('keeps the list metadata-only and serves the full row per id', async () => {
    const { app, appDb, mailer } = createTestApp()

    const reg = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'lister', email: 'lister@example.com', password: 'password123',
    })
    const token = sessionTokenFrom(reg)

    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: '大草稿',
        original_filename: 'big.png',
        dimensions_width: 4000,
        dimensions_height: 3000,
        thumbnail_data: 'data:image/webp;base64,thumb',
        state_json: JSON.stringify({ strokes: 'x'.repeat(4096) }),
      },
    })
    expect(saveRes.statusCode).toBe(200)
    const saved = JSON.parse(saveRes.body).project
    expect(saved.state_json).toBeDefined()

    // The list must not carry the potentially multi-MiB state_json.
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(listRes.statusCode).toBe(200)
    const listed = JSON.parse(listRes.body).projects
    expect(listed).toHaveLength(1)
    expect(listed[0].title).toBe('大草稿')
    expect(listed[0].thumbnail_data).toBe('data:image/webp;base64,thumb')
    expect(listed[0].state_json).toBeUndefined()

    // The full row (with state_json) is available per id.
    const fullRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${saved.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(fullRes.statusCode).toBe(200)
    const full = JSON.parse(fullRes.body).project
    expect(full.state_json).toBe(JSON.stringify({ strokes: 'x'.repeat(4096) }))

    // Tenant isolation and miss handling on the single-fetch endpoint.
    const regB = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'other', email: 'other@example.com', password: 'password123',
    })
    const tokenB = sessionTokenFrom(regB)
    const foreignRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${saved.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    })
    expect(foreignRes.statusCode).toBe(404)
    expect(JSON.parse(foreignRes.body).error).toBe('project_not_found')

    const missingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/proj_does_not_exist',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(missingRes.statusCode).toBe(404)

    appDb.close()
  })

  it('enforces per-user project count and total byte quotas', async () => {
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    const mailer = createFakeMailer()
    registerAuthRoutes(app, appDb.db, { mailer })
    registerProjectRoutes(app, appDb.db, { quota: { maxProjects: 3, maxTotalBytes: 512 } })

    const reg = await registerViaEmailCode(app, appDb.db, mailer, {
      username: 'quota', email: 'quota@example.com', password: 'password123',
    })
    const token = sessionTokenFrom(reg)

    const payload = (tag: string, filler = '') => ({
      title: `p-${tag}`,
      original_filename: 'f.jpg',
      dimensions_width: 1,
      dimensions_height: 1,
      thumbnail_data: 'data:stub',
      state_json: JSON.stringify({ filler }),
    })

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${token}` },
        payload: payload(String(i)),
      })
      expect(res.statusCode, `project ${i}`).toBe(200)
    }

    // Fourth project crosses the count cap.
    const countCapped = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}` },
      payload: payload('extra'),
    })
    expect(countCapped.statusCode).toBe(413)
    expect(JSON.parse(countCapped.body).error).toBe('quota_exceeded')
    expect(JSON.parse(countCapped.body).reason).toBe('project_limit')

    // Updating an existing project within its own size stays allowed even
    // while the count cap is full.
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}` },
    })
    const firstId = JSON.parse(listRes.body).projects[0].id
    const updateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload('0'), id: firstId },
    })
    expect(updateRes.statusCode).toBe(200)

    // An update that would grow the stored bytes past the total cap is
    // rejected with the storage reason.
    const growRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload('0', 'y'.repeat(600)), id: firstId },
    })
    expect(growRes.statusCode).toBe(413)
    expect(JSON.parse(growRes.body).reason).toBe('storage_limit')

    // Deleting frees the slot again.
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${firstId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(delRes.statusCode).toBe(200)
    const recreateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}` },
      payload: payload('new'),
    })
    expect(recreateRes.statusCode).toBe(200)

    appDb.close()
  })
})
