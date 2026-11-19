import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { PgDialect } from 'drizzle-orm/pg-core'
import { migrations } from '../../src/migrations'
// @ts-expect-error pg's internal utils ship without type declarations
import { prepareValue } from 'pg/lib/utils'

/**
 * A real PostgreSQL (PGlite, in-process, with pgvector) with every application migration applied in order, exactly as
 * `payload migrate` applies them (each migration's `up` receives a db whose execute renders Drizzle SQL). Used by the
 * schema contract and SQL integration tests, so raw queries are checked against the schema Payload actually generates.
 */
export type TestDb = { pg: PGlite; query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
  connect: () => Promise<{ query: TestDb['query']; release(): void }>; close(): Promise<void> }

export async function migratedDatabase(): Promise<TestDb> {
  const pg = await PGlite.create({ extensions: { vector } })
  const dialect = new PgDialect()
  const execute = async (statement: unknown) => {
    const { sql, params } = dialect.sqlToQuery(statement as never)
    if (params.length) await pg.query(sql, params as never[]); else await pg.exec(sql)
  }
  // The pgvector extension is created by the bootstrap task (database owner) before migrations run.
  await pg.exec('CREATE EXTENSION IF NOT EXISTS vector')
  for (const migration of migrations) await migration.up({ db: { execute }, payload: {}, req: {} } as never)
  // The ledger table is created by the first migration; record every migration as `payload migrate` would.
  for (const migration of migrations) await pg.query('INSERT INTO payload_migrations (name, batch) VALUES ($1, 1)', [migration.name])
  // node-postgres semantics: rowCount is the rows returned for SELECTs, affected rows otherwise.
  // Parameters are prepared exactly as node-postgres does in production (arrays -> array literals, objects -> JSON).
  const query: TestDb['query'] = async (sql, values) => {
    const r = await pg.query(sql, (values ?? []).map(v => prepareValue(v)) as never[])
    return { rows: r.rows as any[], rowCount: r.affectedRows || r.rows.length }
  }
  return { pg, query, connect: async () => ({ query, release: () => undefined }), close: () => pg.close() }
}
