import { createLocalReq, type Payload, type PayloadRequest } from 'payload'

/**
 * The one adapter for Payload internals we depend on: its PostgreSQL pool (for our hand-written SQL), its transactions
 * and local requests. Everything else uses Payload's public Local API. When upgrading Payload, this file and
 * src/db/payload-schema.ts are where internal changes land (see docs/UPGRADING-PAYLOAD.md).
 */
export type Sql = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }
export class TransactionUnavailable extends Error { constructor() { super('transactions_required') } }
export class CommitNotConfirmed extends Error { constructor() { super('commit_not_confirmed') } }

/** Payload's node-postgres pool, or undefined when the adapter does not expose one (e.g. tests). */
export function optionalSqlPool(payload: Payload): Sql | undefined {
  return (payload.db as unknown as { pool?: Sql } | undefined)?.pool
}
/** Payload's node-postgres pool; throws if unavailable. */
export function sqlPool(payload: Payload): Sql {
  const pool = optionalSqlPool(payload)
  if (!pool) throw new Error('database_pool_unavailable')
  return pool
}

/** A Local API request acting as `user` (or as the system when omitted), optionally bound to a transaction. */
export async function localRequest(payload: Payload, user?: unknown, transactionID?: string | number): Promise<PayloadRequest> {
  const req = await createLocalReq(user ? { user: user as never } : {}, payload)
  if (transactionID !== undefined) req.transactionID = transactionID
  return req
}

/**
 * Runs `work` in one Payload transaction and commits it. `confirm`, when given, must prove the commit is durable by a
 * fresh read after it: Payload 3.94's Postgres adapter can suppress commit errors, so callers that must not report a
 * phantom success (review decisions, imports) confirm a marker they wrote. Rolls back on any error before the commit.
 */
export async function inTransaction<T>(payload: Payload, work: (req: PayloadRequest) => Promise<T>,
  options: { user?: unknown; isolation?: 'serializable'; readOnly?: boolean; confirm?: () => Promise<boolean> } = {}): Promise<T> {
  const id = await payload.db.beginTransaction({ ...(options.isolation ? { isolationLevel: options.isolation } : {}), ...(options.readOnly ? { accessMode: 'read only' } : {}) } as never)
  if (id === null || id === undefined) throw new TransactionUnavailable()
  let result: T
  try {
    result = await work(await localRequest(payload, options.user, id))
    await payload.db.commitTransaction(id)
  } catch (error) {
    await payload.db.rollbackTransaction(id)
    throw error
  }
  if (options.confirm && !(await options.confirm())) throw new CommitNotConfirmed()
  return result
}
