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

// One connection per page lifetime: IndexedDB connections are cheap to hold
// and expensive to churn (every open registers with the browser and blocks
// future version upgrades while alive).
let connectionPromise: Promise<IDBDatabase> | null = null

export function openHistoryDB(): Promise<IDBDatabase> {
  if (!isIndexedDBSupported()) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment'))
  }
  if (!connectionPromise) {
    connectionPromise = new Promise((resolve, reject) => {
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
    connectionPromise.catch(() => {
      connectionPromise = null
    })
  }
  return connectionPromise
}

export async function listLocalHistory(): Promise<LocalHistoryItem[]> {
  if (!isIndexedDBSupported()) return []

  try {
    const db = await openHistoryDB()
    return await new Promise((resolve, reject) => {
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

// Resolves to the persisted item, or null when the write failed (quota
// exceeded, private mode, corrupted database). Callers must surface null:
// silently pretending the draft was saved breaks the history guarantee.
export async function saveLocalHistory(
  item: Omit<LocalHistoryItem, 'updatedAt'> & { updatedAt?: number }
): Promise<LocalHistoryItem | null> {
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
    return null
  }

  return fullItem
}

async function pruneOldestItems(db: IDBDatabase, maxItems: number): Promise<void> {
  // Resolves on transaction completion (not cursor exhaustion) so a caller
  // refreshing its list right after saving never observes pruned items.
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const countReq = store.count()

    countReq.onsuccess = () => {
      const count = countReq.result
      if (count <= maxItems) return

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
        }
      }
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

export async function getLocalHistory(id: string): Promise<LocalHistoryItem | null> {
  if (!isIndexedDBSupported()) return null

  try {
    const db = await openHistoryDB()
    return await new Promise((resolve, reject) => {
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
    await new Promise<void>((resolve, reject) => {
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
    await new Promise<void>((resolve, reject) => {
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
