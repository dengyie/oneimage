import { describe, expect, it } from 'vitest'
import { createToolRegistry } from '../src/domain/tool-registry'

describe('tool registry', () => {
  it('resolves the P0 local tools in constant-time lookup order', () => {
    const registry = createToolRegistry()

    expect(registry.get('convert')).toMatchObject({
      id: 'convert',
      executionPlane: 'browser',
      requiresUpload: false,
    })
    expect(registry.get('metadata-clean')).toMatchObject({
      id: 'metadata-clean',
      executionPlane: 'browser',
      confidenceModel: 'deterministic',
    })
    expect(registry.get('missing-tool')).toBeUndefined()
  })

  it('exposes tools in stable category order for navigation', () => {
    const registry = createToolRegistry()

    expect(registry.list().map((tool) => tool.id)).toEqual(['convert', 'compress', 'resize', 'crop', 'rotate', 'watermark', 'metadata-clean'])
  })
})
