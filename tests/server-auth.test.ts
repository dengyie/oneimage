import { describe, expect, it } from 'vitest'
import { authorizeProvenanceRequest } from '../server/security'

describe('provenance server authorization', () => {
  it('requires the configured token in production', () => {
    const headers = { origin: 'https://oneimage.example', host: 'oneimage.example' }

    expect(authorizeProvenanceRequest(headers, 'server-token', false)).toBe(false)
    expect(authorizeProvenanceRequest({ ...headers, 'x-oneimage-token': 'server-token' }, 'server-token', false)).toBe(true)
  })

  it('allows same-origin development proxy only when no token is configured', () => {
    const headers = { origin: 'http://127.0.0.1:8787', host: '127.0.0.1:8787' }

    expect(authorizeProvenanceRequest(headers, '', true)).toBe(true)
    expect(authorizeProvenanceRequest(headers, '', false)).toBe(false)
  })

  it('rejects origin-only requests in production and when the environment is not explicit', () => {
    const headers = { origin: 'http://127.0.0.1:8787', host: '127.0.0.1:8787' }

    expect(authorizeProvenanceRequest(headers, '', false)).toBe(false)
  })
})
