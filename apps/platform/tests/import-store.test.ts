import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
vi.mock('payload', () => ({ createLocalReq: vi.fn(async () => ({})) }))
import { payloadStore } from '../src/import/payload-store'

function database(transactionID: string | null = 'tx-1') {
  return { db: { beginTransaction: vi.fn(async () => transactionID), commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}) }, find: vi.fn(async (_args: unknown) => ({ docs: [] })),
    create: vi.fn(async (_args: unknown) => ({ id: 1 })) }
}
describe('Payload transaction wiring', () => {
  it('passes the same serializable transaction to every write/read, then reads receipt outside it', async () => {
    const db = database(), store = payloadStore(db as unknown as Payload)
    await store.transaction(async tx => {
      await tx.find('content', 'sourceKey', 'test')
      await tx.insert('import-runs', { packageId: 'test' })
    }, false)
    expect(db.db.beginTransaction).toHaveBeenCalledWith({ isolationLevel: 'serializable' })
    expect(db.find.mock.calls[0][0]).toMatchObject({ req: { transactionID: 'tx-1' }, overrideAccess: true })
    expect(db.create.mock.calls[0][0]).toMatchObject({ req: { transactionID: 'tx-1' }, overrideAccess: true })
    expect(db.db.commitTransaction).toHaveBeenCalledWith('tx-1')
    await store.receipt('test')
    expect(db.find.mock.calls[1][0]).toMatchObject({ req: {} })
    expect((db.find.mock.calls[1][0] as { req: object }).req).not.toHaveProperty('transactionID')
  })
  it('fails closed when database transactions are unavailable', async () => {
    const db = database(null), operation = vi.fn()
    await expect(payloadStore(db as unknown as Payload).transaction(operation, false)).rejects.toThrow('transactions_required')
    expect(operation).not.toHaveBeenCalled()
    expect(db.create).not.toHaveBeenCalled()
  })
  it('rolls back failed operations', async () => {
    const db = database()
    await expect(payloadStore(db as unknown as Payload).transaction(async () => { throw new Error('failure') }, false)).rejects.toThrow('failure')
    expect(db.db.rollbackTransaction).toHaveBeenCalledWith('tx-1')
    expect(db.db.commitTransaction).not.toHaveBeenCalled()
  })
  it('uses a read-only transaction for previews and forbids writes', async () => {
    const db = database()
    await expect(payloadStore(db as unknown as Payload).transaction(tx => tx.insert('content', {}), true)).rejects.toThrow('preview_write_forbidden')
    expect(db.db.beginTransaction).toHaveBeenCalledWith({ isolationLevel: 'serializable', accessMode: 'read only' })
    expect(db.create).not.toHaveBeenCalled()
  })
})
