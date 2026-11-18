import { createLocalReq, type Payload } from 'payload'
import { assertImport } from './package'
import type { ImportStore, Row, Table, Transaction } from './adapter'

/** Trusted local operations task only; never expose this adapter as a reader API. */
export function payloadStore(payload: Payload): ImportStore {
  const find = async (table: Table, field: string, value: string, req: Awaited<ReturnType<typeof createLocalReq>>) => {
    const result = await payload.find({ collection: table, where: { [field]: { equals: value } },
      limit: 2, depth: 0, overrideAccess: true, req })
    assertImport(result.docs.length <= 1, 'duplicate_database_identity')
    return (result.docs[0] as unknown as Row) ?? null
  }
  return {
    async transaction(operation, readOnly) {
      const transactionID = await payload.db.beginTransaction({ isolationLevel: 'serializable', ...(readOnly ? { accessMode: 'read only' } : {}) })
      assertImport(transactionID !== null && transactionID !== undefined, 'transactions_required')
      try {
        const req = await createLocalReq({}, payload)
        req.transactionID = transactionID
        const tx: Transaction = {
          find: (table, field, value) => find(table, field, value, req),
          insert: async (table, data) => {
            assertImport(!readOnly, 'preview_write_forbidden')
            const doc = await payload.create({ collection: table, data: data as never, overrideAccess: true, depth: 0, req })
            return doc as unknown as Row
          },
        }
        const result = await operation(tx)
        await payload.db.commitTransaction(transactionID)
        return result
      } catch (error) {
        await payload.db.rollbackTransaction(transactionID)
        throw error
      }
    },
    async receipt(packageId) {
      return find('import-runs', 'packageId', packageId, await createLocalReq({}, payload))
    },
  }
}
