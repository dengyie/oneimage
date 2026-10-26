import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { initDatabase } from '../server/db'
import { registerAuthRoutes } from '../server/auth-routes'
import { registerProjectRoutes } from '../server/project-routes'

describe('Project routes', () => {
  function createTestApp() {
    const app = Fastify()
    const appDb = initDatabase(':memory:')
    registerAuthRoutes(app, appDb.db)
    registerProjectRoutes(app, appDb.db)
    return { app, appDb }
  }

  it('rejects unauthenticated access with 401', async () => {
    const { app, appDb } = createTestApp()

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
    const { app, appDb } = createTestApp()

    const regA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'owner_a', email: 'oa@example.com', password: 'password123' },
    })
    const tokenA = JSON.parse(regA.body).sessionToken

    const regB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'owner_b', email: 'ob@example.com', password: 'password123' },
    })
    const tokenB = JSON.parse(regB.body).sessionToken

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
    const { app, appDb } = createTestApp()

    // Register User A
    const regA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'user_a', email: 'a@example.com', password: 'password123' },
    })
    const tokenA = JSON.parse(regA.body).sessionToken

    // Register User B
    const regB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'user_b', email: 'b@example.com', password: 'password123' },
    })
    const tokenB = JSON.parse(regB.body).sessionToken

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
})
