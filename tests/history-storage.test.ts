import { describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  listLocalHistory,
  saveLocalHistory,
  getLocalHistory,
  deleteLocalHistory,
  clearAllLocalHistory,
  type LocalHistoryItem,
} from '../src/infrastructure/history-storage'
import { createEditorState } from '../src/domain/editor-state'

function makeItem(id: string, updatedAt: number, overrides: Partial<LocalHistoryItem> = {}): LocalHistoryItem {
  return {
    id,
    title: `Item ${id}`,
    fileName: `${id}.png`,
    fileSize: 1000,
    mimeType: 'image/png',
    width: 100,
    height: 100,
    thumbnail: 'data:stub',
    originalBlob: new Blob([`blob-${id}`]),
    editorState: createEditorState(100, 100),
    updatedAt,
    ...overrides,
  }
}

describe('history-storage', () => {
  it('opens the database once and reuses the connection across operations', async () => {
    const openSpy = vi.spyOn(indexedDB, 'open')

    await listLocalHistory()
    await listLocalHistory()
    await listLocalHistory()

    expect(openSpy).toHaveBeenCalledTimes(1)
    openSpy.mockRestore()
  })

  it('persists, lists newest-first, fetches, deletes and clears drafts', async () => {
    await clearAllLocalHistory()

    await saveLocalHistory(makeItem('old', 1000))
    await saveLocalHistory(makeItem('new', 2000))
    await saveLocalHistory(makeItem('mid', 1500))

    const listed = await listLocalHistory()
    expect(listed.map((item) => item.id)).toEqual(['new', 'mid', 'old'])

    const fetched = await getLocalHistory('mid')
    expect(fetched?.fileName).toBe('mid.png')

    await deleteLocalHistory('mid')
    const afterDelete = await listLocalHistory()
    expect(afterDelete.map((item) => item.id)).toEqual(['new', 'old'])

    const savedAgain = await saveLocalHistory(makeItem('new', 3000))
    expect(savedAgain).not.toBeNull()
    const afterUpsert = await listLocalHistory()
    expect(afterUpsert).toHaveLength(2)
    expect(afterUpsert[0].id).toBe('new')
    expect(afterUpsert[0].updatedAt).toBe(3000)

    await clearAllLocalHistory()
    expect(await listLocalHistory()).toEqual([])
  })

  it('evicts the oldest drafts beyond the 30-item LRU cap and keeps the newest', async () => {
    await clearAllLocalHistory()

    for (let i = 0; i < 35; i++) {
      const saved = await saveLocalHistory(makeItem(`item-${i}`, (i + 1) * 1000))
      expect(saved).not.toBeNull()
    }

    const listed = await listLocalHistory()
    expect(listed).toHaveLength(30)
    expect(listed[0].id).toBe('item-34')
    expect(listed.map((item) => item.id)).not.toContain('item-0')
    expect(listed.map((item) => item.id)).not.toContain('item-4')
    expect(listed.map((item) => item.id)).toContain('item-5')

    await clearAllLocalHistory()
  })

  it('carries cloud linkage through saveLocalHistory upserts', async () => {
    await clearAllLocalHistory()

    await saveLocalHistory(makeItem('linked', 1000))
    await saveLocalHistory({
      ...makeItem('linked', 2000),
      isCloudSynced: true,
      cloudId: 'linked',
    })

    const fetched = await getLocalHistory('linked')
    expect(fetched?.isCloudSynced).toBe(true)
    expect(fetched?.cloudId).toBe('linked')

    await clearAllLocalHistory()
  })

  it('writes the original blob exactly once per draft and keeps metadata-only rewrites small', async () => {
    await clearAllLocalHistory()

    for (let i = 0; i < 3; i++) {
      const saved = await saveLocalHistory(makeItem('stable', 1000 + i))
      expect(saved).not.toBeNull()
    }

    // Raw-store inspection: the blob lives once in `blobs`; `projects` no
    // longer carries an inline originalBlob.
    const raw = await new Promise<{ blobCount: number; inlineBlob: boolean }>((resolve, reject) => {
      const request = indexedDB.open('oneimage_history_v1', 2)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['blobs', 'projects'], 'readonly')
        const blobCountReq = tx.objectStore('blobs').count()
        const recordReq = tx.objectStore('projects').get('stable')
        tx.oncomplete = () => {
          const record = recordReq.result as Record<string, unknown> | undefined
          resolve({
            blobCount: blobCountReq.result,
            inlineBlob: Boolean(record && 'originalBlob' in record),
          })
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
    expect(raw.blobCount).toBe(1)
    expect(raw.inlineBlob).toBe(false)

    // Metadata rewrite picked up the latest updatedAt while the blob stayed.
    const fetched = await getLocalHistory('stable')
    expect(fetched?.updatedAt).toBe(1002)
    await expect(fetched?.originalBlob.text()).resolves.toBe('blob-stable')

    await clearAllLocalHistory()
  })

  it('reuses the stored thumbnail after the first save of a draft', async () => {
    await clearAllLocalHistory()

    await saveLocalHistory(makeItem('thumb', 1000))
    const withCustomThumb = await saveLocalHistory({ ...makeItem('thumb', 2000), thumbnail: 'data:image/webp;base64,NEW' })

    // The storage layer keeps the first thumbnail: it renders the unchanging
    // original image, so later saves cannot improve on it.
    const fetched = await getLocalHistory('thumb')
    expect(fetched?.thumbnail).toBe('data:stub')
    expect(withCustomThumb?.updatedAt).toBe(2000)

    await clearAllLocalHistory()
  })
})
