import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  listLocalHistory,
  saveLocalHistory,
  getLocalHistory,
  deleteLocalHistory,
  clearAllLocalHistory,
  getStorageUsageEstimate,
  generateThumbnailDataUrl,
  type LocalHistoryItem,
} from '../src/infrastructure/history-storage'
import { createEditorState } from '../src/domain/editor-state'

describe('history-storage', () => {
  it('gracefully handles missing indexedDB environment without throwing', async () => {
    // In node environment without browser indexedDB
    const list = await listLocalHistory()
    expect(list).toEqual([])

    const state = createEditorState(800, 600)
    const saved = await saveLocalHistory({
      id: 'item-1',
      title: 'Test',
      fileName: 'test.jpg',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
      thumbnail: 'data:image/webp;base64,stub',
      originalBlob: new Blob(['stub']),
      editorState: state,
    })
    expect(saved.id).toBe('item-1')
    expect(saved.updatedAt).toBeGreaterThan(0)

    const fetched = await getLocalHistory('item-1')
    expect(fetched).toBeNull()

    const usage = await getStorageUsageEstimate()
    expect(usage).toEqual({ count: 0, totalBytes: 0 })
  })

  it('calculates storage usage properly given items list', async () => {
    const memoryStore = new Map<string, LocalHistoryItem>()

    const mockDB = {
      transaction: () => ({
        objectStore: () => ({
          index: () => ({
            openCursor: () => {
              const items = Array.from(memoryStore.values()).sort((a, b) => b.updatedAt - a.updatedAt)
              let idx = 0
              const req: any = {
                onsuccess: null,
                onerror: null,
              }
              setTimeout(() => {
                const advance = () => {
                  if (idx < items.length) {
                    const cursor = {
                      value: items[idx++],
                      continue: advance,
                    }
                    req.onsuccess?.({ target: { result: cursor } })
                  } else {
                    req.onsuccess?.({ target: { result: null } })
                  }
                }
                advance()
              }, 0)
              return req
            },
          }),
        }),
      }),
    }

    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: any = {}
        setTimeout(() => {
          req.result = mockDB
          req.onsuccess?.()
        }, 0)
        return req
      },
    })

    const state = createEditorState(100, 100)
    memoryStore.set('item-1', {
      id: 'item-1',
      title: 'Item 1',
      fileName: 'a.png',
      fileSize: 2000,
      mimeType: 'image/png',
      width: 100,
      height: 100,
      thumbnail: 'data:stub',
      originalBlob: new Blob(['hello']),
      editorState: state,
      updatedAt: 1000,
    })

    const items = await listLocalHistory()
    expect(items.length).toBe(1)
    expect(items[0].fileName).toBe('a.png')

    const usage = await getStorageUsageEstimate()
    expect(usage.count).toBe(1)
    expect(usage.totalBytes).toBeGreaterThanOrEqual(2000)

    vi.unstubAllGlobals()
  })

  it('generateThumbnailDataUrl returns empty string in node environment without window/document', () => {
    const canvas: any = { width: 1000, height: 800 }
    expect(generateThumbnailDataUrl(canvas)).toBe('')
  })
})
