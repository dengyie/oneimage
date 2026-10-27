import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDatabase } from '../server/db'

const dirs: string[] = []

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oneimage-db-'))
  dirs.push(dir)
  return join(dir, 'oneimage.db')
}

afterEach(() => {
  delete process.env.ONEIMAGE_DB_JOURNAL
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function journalMode(dbPath: string): string {
  const appDb = initDatabase(dbPath)
  const row = appDb.db.prepare('PRAGMA journal_mode;').get() as Record<string, unknown>
  appDb.close()
  return String(Object.values(row)[0]).toLowerCase()
}

describe('database journal mode', () => {
  // The production database sits on an NFS mount, where WAL's shared-memory
  // index is unsupported. The default must therefore stay a rollback journal.
  it('defaults to a rollback journal and leaves no -shm file behind', () => {
    const dbPath = tempDbPath()
    expect(journalMode(dbPath)).toBe('truncate')
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
  })

  it('allows an explicit WAL opt-in for local disks', () => {
    process.env.ONEIMAGE_DB_JOURNAL = 'WAL'
    expect(journalMode(tempDbPath())).toBe('wal')
  })

  it('falls back to the safe default for an unknown value', () => {
    process.env.ONEIMAGE_DB_JOURNAL = "TRUNCATE; DROP TABLE users; --"
    expect(journalMode(tempDbPath())).toBe('truncate')
  })

  it('still initialises an in-memory database', () => {
    const appDb = initDatabase(':memory:')
    const row = appDb.db.prepare('SELECT count(*) AS n FROM users;').get() as { n: number }
    expect(row.n).toBe(0)
    appDb.close()
  })
})
