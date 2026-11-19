import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENUMS, SCHEMA } from '../src/db/payload-schema'
import { migratedDatabase, type TestDb } from './support/migrated-db'

/**
 * REQ-UPGRADE-01: the schema contract. Every table, column and enum value our hand-written SQL depends on must exist in
 * the schema produced by running all migrations, and raw SQL may only name registered tables. A Payload upgrade that
 * changes its generated naming fails here, by name, instead of silently breaking the worker, search or analytics.
 */

/** Table-like identifiers after SQL keywords inside query strings that are not in the schema registry. */
const SQL_STRINGS = /`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*`|'(?:SELECT|INSERT|UPDATE|DELETE)\b[^'\n]*'/g
const TABLE_REF = /\b(?:FROM|JOIN|INTO|UPDATE)\s+"?([a-z_][a-z0-9_]*)"?/g
/** CTE names, subquery aliases and functions that follow FROM/JOIN but are not tables. */
const NOT_TABLES = new Set(['websearch_to_tsquery', 'candidate', 'sourced', 'items', 'best', 'unnest', 'n', 'v', 'lateral', 'generate_series'])
export function unregisteredTables(source: string) {
  const found: string[] = []
  for (const str of source.match(SQL_STRINGS) ?? []) for (const m of str.matchAll(TABLE_REF)) {
    if (!(m[1] in SCHEMA) && !NOT_TABLES.has(m[1])) found.push(m[1])
  }
  return found
}
function sourceFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) { if (name !== 'migrations') sourceFiles(full, out) }
    else if (/\.(ts|tsx)$/.test(name) && name !== 'payload-types.ts') out.push(full)
  }
  return out
}

let db: TestDb
beforeAll(async () => { db = await migratedDatabase() }, 120000)
afterAll(async () => { await db?.close() })

describe('REQ-UPGRADE-01: schema contract with the migrated database', () => {
  it('has every registered table and column', async () => {
    const { rows } = await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`)
    const actual = new Map<string, Set<string>>()
    for (const r of rows) actual.set(r.table_name, (actual.get(r.table_name) ?? new Set()).add(r.column_name))
    const missing = Object.entries(SCHEMA).flatMap(([table, spec]) =>
      !actual.has(table) ? [`table ${table}`] : spec.columns.filter(c => !actual.get(table)!.has(c)).map(c => `${table}.${c}`))
    expect(missing).toEqual([])
  })

  it('has every registered enum value', async () => {
    const { rows } = await db.query(`SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid`)
    const missing = Object.entries(ENUMS).flatMap(([type, labels]) => labels.filter(l => !rows.some(r => r.typname === type && r.enumlabel === l)).map(l => `${type}.${l}`))
    expect(missing).toEqual([])
  })

  it('has pgvector, the vector column and the search indexes', async () => {
    const { rows } = await db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'search_chunks'`)
    expect(rows.map(r => r.indexname)).toEqual(expect.arrayContaining(['search_chunks_tsv', 'search_chunks_hnsw', 'search_chunks_unique']))
    const { rows: [col] } = await db.query(`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'search_chunks'::regclass AND attname = 'embedding'`)
    expect(col.type).toBe('vector(1024)')
  })

  it('only names registered tables in raw SQL anywhere in src', () => {
    const root = path.resolve(__dirname, '../src')
    const unknown = sourceFiles(root).flatMap(file => unregisteredTables(readFileSync(file, 'utf8')).map(name => `${name} (${path.relative(root, file)})`))
    expect([...new Set(unknown)]).toEqual([])
  })

  it('keeps every style rule on Payload admin markup inside the fenced overrides block', () => {
    const css = readFileSync(path.resolve(__dirname, '../src/app/(payload)/custom.css'), 'utf8')
    const after = css.split('PAYLOAD CHROME OVERRIDES: END')[1] ?? ''
    expect(css).toContain('PAYLOAD CHROME OVERRIDES: BEGIN')
    expect(after.match(/\.(?:btn--style-[a-z]+|card|app-header[a-z_-]*|nav|nav__[a-z-]+|collection-[a-z-]+|field-type[a-z-]*|template-[a-z-]+)\b/g) ?? []).toEqual([])
  })

  it('the scanner catches unregistered tables and ignores registered ones, CTE names and table constants', () => {
    expect(unregisteredTables("db.query('SELECT id FROM mystery_table WHERE x=1')")).toEqual(['mystery_table'])
    expect(unregisteredTables('db.query(`UPDATE content SET a=1 FROM ${T.content_rels} r JOIN other_thing o ON true`)')).toEqual(['other_thing'])
    expect(unregisteredTables('db.query(`WITH best AS (SELECT 1) SELECT * FROM best JOIN assets a ON true`)')).toEqual([])
  })
})
