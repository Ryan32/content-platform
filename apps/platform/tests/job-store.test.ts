import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { JobStore, type Job } from '../src/processing/jobs'
const job: Job = { id: 1, content_id: 7, source_version: 'v1', idempotency_key: 'key', attempts: 1,
  input: { kind: 'vimeo' }, lease_token: 'lease', deadline_at: '2099-01-01' }
describe('durable completion boundary (mocked PostgreSQL)', () => {
  it('rolls back and does not insert a proposal when the worker lost its lease', async () => {
    const db = { query: vi.fn(async (sql: string) => ({ rows: [], rowCount: sql.startsWith('UPDATE') ? 0 : 1 })), release: vi.fn() }
    const store = new JobStore({ connect: async () => db } as unknown as Pool)
    await expect(store.finish(job, {}, { model: 'test', data: {} })).rejects.toThrow('lease_lost')
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO suggestions'))).toBe(false)
    expect(db.query).toHaveBeenCalledWith('ROLLBACK')
  })
  it('rolls back completed output if the source changed during processing', async () => {
    const db = { query: vi.fn(async (sql: string) => ({ rows: [], rowCount: sql.startsWith('SELECT id FROM content') ? 0 : 1 })), release: vi.fn() }
    const store = new JobStore({ connect: async () => db } as unknown as Pool)
    await expect(store.finish(job, {}, { model: 'test', data: {} })).rejects.toThrow('source_version_mismatch')
    expect(db.query).toHaveBeenCalledWith('ROLLBACK')
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO suggestions'))).toBe(false)
  })
  it('commits the immutable proposal with job completion as one transaction', async () => {
    const db = { query: vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 1 })), release: vi.fn() }
    await new JobStore({ connect: async () => db } as unknown as Pool).finish(job, { ready: true }, { model: 'test', data: { summary: 'synthetic' } })
    const calls = db.query.mock.calls.map(([sql]) => sql)
    expect(calls[0]).toBe('BEGIN'); expect(calls.at(-1)).toBe('COMMIT')
    expect(calls.some(sql => sql.includes('INSERT INTO suggestions'))).toBe(true)
    expect(calls.some(sql => sql.startsWith('UPDATE content'))).toBe(false)
  })
})
