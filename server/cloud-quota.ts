// Cloud drafts are user-keyed unbounded writes into a SQLite file that lives
// on an NFS mount with a history of Disk quota exceeded. Without a per-user
// ceiling one account can fill the shared volume one 16 MiB body at a time.
export const MAX_PROJECTS_PER_USER = 50
export const MAX_TOTAL_PROJECT_BYTES_PER_USER = 64 * 1024 * 1024

import type { DatabaseSync } from 'node:sqlite'

// SQLite LENGTH() on TEXT counts characters, not bytes, so stored sizes are
// measured on BLOB casts; inbound payloads are measured with Buffer.byteLength
// so both sides of the comparison are UTF-8 bytes.
export function projectBytes(input: {
  title: string
  original_filename: string
  thumbnail_data: string
  state_json: string
}): number {
  return (
    Buffer.byteLength(input.title) +
    Buffer.byteLength(input.original_filename) +
    Buffer.byteLength(input.thumbnail_data) +
    Buffer.byteLength(input.state_json)
  )
}

const STORED_BYTES_SQL = `COALESCE(SUM(
  LENGTH(CAST(thumbnail_data AS BLOB)) +
  LENGTH(CAST(state_json AS BLOB)) +
  LENGTH(CAST(title AS BLOB)) +
  LENGTH(CAST(original_filename AS BLOB))
), 0)`

export interface UserStorageStats {
  projects: number
  bytes: number
}

export function getUserStorageStats(db: DatabaseSync, userId: string): UserStorageStats {
  const row = db
    .prepare(`SELECT COUNT(*) AS projects, ${STORED_BYTES_SQL} AS bytes FROM cloud_projects WHERE user_id = ?`)
    .get(userId) as { projects: number; bytes: number }
  return { projects: Number(row.projects), bytes: Number(row.bytes) }
}
