import { Pool } from 'pg'
import { readFileSync } from 'node:fs'

let pool: Pool | undefined
/** Small shared pool for queue operations in the web app. Same verified TLS settings as Payload. */
export function queuePool() {
  if (!process.env.DATABASE_URI) throw new Error('Content storage is not configured')
  pool ??= new Pool({ connectionString: process.env.DATABASE_URI, max: 2, connectionTimeoutMillis: 10000, statement_timeout: 30000,
    ssl: { rejectUnauthorized: true, ...(process.env.DATABASE_CA_FILE ? { ca: readFileSync(process.env.DATABASE_CA_FILE, 'utf8') } : {}) } })
  return pool
}
