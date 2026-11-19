import type { Payload, PayloadRequest } from 'payload'
import { inTransaction, localRequest, TransactionUnavailable } from '../db/payload-db'
import { assertImport } from './package'
import type { ImportStore, Row, Table, Transaction } from './adapter'

/** Trusted local operations task only; never expose this adapter as a reader API. */
export function payloadStore(payload: Payload): ImportStore {
  const find = async (table: Table, field: string, value: string, req: PayloadRequest) => {
    const result = await payload.find({ collection: table, where: { [field]: { equals: value } },
      limit: 2, depth: 0, overrideAccess: true, req })
    assertImport(result.docs.length <= 1, 'duplicate_database_identity')
    return (result.docs[0] as unknown as Row) ?? null
  }
  return {
    async transaction(operation, readOnly) {
      // Durability is confirmed by the caller with a fresh receipt read (see adapter.ts and inTransaction).
      try {
        return await inTransaction(payload, req => {
          const tx: Transaction = {
            find: (table, field, value) => find(table, field, value, req),
            insert: async (table, data) => {
              assertImport(!readOnly, 'preview_write_forbidden')
              const doc = await payload.create({ collection: table, data: data as never, overrideAccess: true, depth: 0, req })
              return doc as unknown as Row
            },
          }
          return operation(tx)
        }, { isolation: 'serializable', readOnly })
      } catch (error) {
        if (error instanceof TransactionUnavailable) assertImport(false, 'transactions_required')
        throw error
      }
    },
    async receipt(packageId) {
      return find('import-runs', 'packageId', packageId, await localRequest(payload))
    },
  }
}
