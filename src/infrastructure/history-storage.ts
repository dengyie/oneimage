import type { EditorState } from '../domain/editor-state'

export interface LocalHistoryItem {
  id: string
  title: string
  fileName: string
  fileSize: number
  mimeType: string
  width: number
  height: number
  thumbnail: string // 320px WebP / JPEG data URL
  originalBlob: Blob // Raw file blob
  editorState: EditorState
  updatedAt: number
  isCloudSynced?: boolean
  cloudId?: string
}

const DB_NAME = 'oneimage_history_v1'
const STORE_NAME = 'projects'
const DB_VERSION = 1
const MAX_LOCAL_ITEMS = 30

function isIndexedDBSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

export function openHistoryDB(): Promise<IDBDatabase> {
  if (!isIndexedDBSupported()) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('by_updatedAt', 'updatedAt', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function listLocalHistory(): Promise<LocalHistoryItem[]> {
  if (!isIndexedDBSupported()) return []

  try {
    const db = await openHistoryDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const index = store.index('by_updatedAt')
      const request = index.openCursor(null, 'prev') // newest first
      const results: LocalHistoryItem[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          results.push(cursor.value)
          cursor.continue()
        } else {
          resolve(results)
        }
      }

      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    console.error('Failed to list local history:', err)
    return []
  }
}

export async function saveLocalHistory(
  item: Omit<LocalHistoryItem, 'updatedAt'> & { updatedAt?: number }
): Promise<LocalHistoryItem> {
  const fullItem: LocalHistoryItem = {
    ...item,
    updatedAt: item.updatedAt || Date.now(),
  }

  if (!isIndexedDBSupported()) return fullItem

  try {
    const db = await openHistoryDB()

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.put(fullItem)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })

    // Prune oldest items if count exceeds limit
    await pruneOldestItems(db, MAX_LOCAL_ITEMS)
  } catch (err) {
    console.error('Failed to save to local history:', err)
  }

  return fullItem
}

async function pruneOldestItems(db: IDBDatabase, maxItems: number): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const countReq = store.count()

    countReq.onsuccess = () => {
      const count = countReq.result
      if (count <= maxItems) {
        resolve()
        return
      }

      const excess = count - maxItems
      const index = store.index('by_updatedAt')
      const cursorReq = index.openCursor(null, 'next') // oldest first
      let deleted = 0

      cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor && deleted < excess) {
          cursor.delete()
          deleted++
          cursor.continue()
        } else {
          resolve()
        }
      }

      cursorReq.onerror = () => resolve()
    }

    countReq.onerror = () => resolve()
  })
}

export async function getLocalHistory(id: string): Promise<LocalHistoryItem | null> {
  if (!isIndexedDBSupported()) return null

  try {
    const db = await openHistoryDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return null
  }
}

export async function deleteLocalHistory(id: string): Promise<void> {
  if (!isIndexedDBSupported()) return

  try {
    const db = await openHistoryDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    console.error('Failed to delete local history:', err)
  }
}

export async function clearAllLocalHistory(): Promise<void> {
  if (!isIndexedDBSupported()) return

  try {
    const db = await openHistoryDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    console.error('Failed to clear local history:', err)
  }
}

export async function getStorageUsageEstimate(): Promise<{ count: number; totalBytes: number }> {
  const items = await listLocalHistory()
  let totalBytes = 0
  for (const item of items) {
    totalBytes += item.fileSize || item.originalBlob?.size || 0
    totalBytes += item.thumbnail?.length || 0
  }
  return {
    count: items.length,
    totalBytes,
  }
}

/**
 * Creates a fast thumbnail data URL from an HTMLCanvasElement or ImageBitmap
 */
export function generateThumbnailDataUrl(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  maxEdge = 320
): string {
  if (typeof document === 'undefined') return ''

  const srcW = canvas.width
  const srcH = canvas.height
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
  const thumbW = Math.max(16, Math.round(srcW * scale))
  const thumbH = Math.max(16, Math.round(srcH * scale))

  const thumbCanvas = document.createElement('canvas')
  thumbCanvas.width = thumbW
  thumbCanvas.height = thumbH
  const ctx = thumbCanvas.getContext('2d')
  if (!ctx) return ''

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(canvas as CanvasImageSource, 0, 0, thumbW, thumbH)

  return thumbCanvas.toDataURL('image/webp', 0.8)
}

// Aliases for unified terminology
export const listHistory = listLocalHistory
export const saveHistoryItem = saveLocalHistory
export const getHistoryItem = getLocalHistory
export const deleteHistoryItem = deleteLocalHistory
export const clearAllHistory = clearAllLocalHistory
