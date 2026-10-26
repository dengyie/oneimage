import { describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { createEditorState } from '../src/domain/editor-state'

// Seeds a version-1 shaped database (inline originalBlob inside `projects`),
// the layout users had before the v2 blob-store split, then re-imports the
// storage module so its upgrade path runs against real legacy data.
async function seedV1Database(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('oneimage_history_v1', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.createObjectStore('projects', { keyPath: 'id' })
      store.createIndex('by_updatedAt', 'updatedAt', { unique: false })
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('projects', 'readwrite')
      tx.objectStore('projects').put({
        id: 'legacy',
        title: 'Legacy Draft',
        fileName: 'legacy.png',
        fileSize: 11,
        mimeType: 'image/png',
        width: 100,
        height: 100,
        thumbnail: 'data:legacy-thumb',
        originalBlob: new Blob(['legacy-bytes']),
        editorState: createEditorState(100, 100),
        updatedAt: 123,
      })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

describe('history-storage v1 -> v2 migration', () => {
  it('moves inline blobs into the blob store without data loss', async () => {
    await seedV1Database()
    vi.resetModules()
    const storage = await import('../src/infrastructure/history-storage')

    const items = await storage.listLocalHistory()
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('legacy')
    expect(items[0].thumbnail).toBe('data:legacy-thumb')
    await expect(items[0].originalBlob.text()).resolves.toBe('legacy-bytes')

    const fetched = await storage.getLocalHistory('legacy')
    expect(fetched?.fileName).toBe('legacy.png')

    // Raw check: the blob now lives in `blobs`; the metadata record no longer
    // carries an inline copy.
    const raw = await new Promise<{ inlineBlob: boolean; blobCount: number }>((resolve, reject) => {
      const request = indexedDB.open('oneimage_history_v1', 2)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['projects', 'blobs'], 'readonly')
        const recordReq = tx.objectStore('projects').get('legacy')
        const blobCountReq = tx.objectStore('blobs').count()
        tx.oncomplete = () => {
          const record = recordReq.result as Record<string, unknown> | undefined
          resolve({
            inlineBlob: Boolean(record && 'originalBlob' in record),
            blobCount: blobCountReq.result,
          })
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
    expect(raw.inlineBlob).toBe(false)
    expect(raw.blobCount).toBe(1)

    // Subsequent saves keep the migrated blob instead of rewriting it.
    const state = createEditorState(100, 100)
    const saved = await storage.saveLocalHistory({
      id: 'legacy',
      title: 'Legacy Draft',
      fileName: 'legacy.png',
      fileSize: 11,
      mimeType: 'image/png',
      width: 100,
      height: 100,
      thumbnail: 'data:legacy-thumb',
      originalBlob: new Blob(['would-overwrite-if-naive']),
      editorState: state,
      updatedAt: 456,
    })
    expect(saved).not.toBeNull()
    const after = await storage.getLocalHistory('legacy')
    await expect(after?.originalBlob.text()).resolves.toBe('legacy-bytes')

    await storage.clearAllLocalHistory()
  })
})
