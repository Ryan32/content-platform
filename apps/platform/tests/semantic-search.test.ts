import { afterEach, describe, expect, it, vi } from 'vitest'
import { fuse, hybridContentIds } from '../src/server/search'
import { syncEmbeddings, vectorLiteral } from '../src/processing/embeddings'

const vec = Array.from({ length: 1024 }, (_, i) => (i % 7) / 10)
afterEach(() => vi.unstubAllEnvs())
function db(keyword: number[], semantic: number[]) {
  const queries: string[] = []
  return { queries, query: vi.fn(async (sql: string) => {
    queries.push(sql)
    if (sql.includes('passage_embeddings')) return { rows: semantic.map(id => ({ id })) }
    if (sql.includes('numnode(q) > 0')) return { rows: keyword.map(id => ({ id })) }
    return { rows: [{ id: 1 }] }
  }) }
}

describe('REQ-SEARCH-02: hybrid keyword + semantic ranking', () => {
  it('fuses both lists so items found by both rank first', () => {
    expect(fuse([1, 2, 3], [3, 4])[0]).toBe(3)
    expect(fuse([1, 2], [])).toEqual([1, 2])
  })
  it('adds meaning-based matches only when switched on, and only for published current evidence', async () => {
    const d = db([1], [5, 1])
    const embed = vi.fn(async () => vec)
    expect(await hybridContentIds(d, 'income for retirees', embed)).toEqual([1])   // off by default
    vi.stubEnv('SEMANTIC_SEARCH', 'true')
    expect(await hybridContentIds(d, 'income for retirees', embed)).toEqual([1, 5])
    const sql = d.queries.find(q => q.includes('passage_embeddings'))!
    expect(sql).toContain("c.state = 'published'"); expect(sql).toContain('c.evidence_version = n.evidence_version')
  })
  it('falls back to keyword results when embedding fails or is slow', async () => {
    vi.stubEnv('SEMANTIC_SEARCH', 'true')
    const failing = vi.fn(async () => { throw new Error('throttled') })
    expect(await hybridContentIds(db([2], [9]), 'annuity riders', failing)).toEqual([2])
  })
  it('finds items by meaning even when no keyword matches', async () => {
    vi.stubEnv('SEMANTIC_SEARCH', 'true')
    expect(await hybridContentIds(db([], [7]), 'how do I help a widow plan income', async () => vec)).toEqual([7])
  })
})

describe('REQ-SEARCH-03: semantic index maintenance', () => {
  it('embeds missing current passages, prunes superseded ones, and never indexes intake/archived items', async () => {
    const calls: { sql: string; params?: unknown[] }[] = []
    const fake = { query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      if (sql.startsWith('DELETE')) return { rows: [], rowCount: 2 }
      if (sql.includes('FROM content c JOIN content_passages')) return { rows: [{ content_id: 4, title: 'Guide', citation_id: 'abc-s1-e1', version: 'v9', locator: 'PDF 1 · Page 1', text: 'Income' }] }
      return { rows: [], rowCount: 1 }
    }) }
    const embed = vi.fn(async () => vec)
    expect(await syncEmbeddings(fake, embed)).toEqual({ embedded: 1, pruned: 2 })
    expect(embed).toHaveBeenCalledWith('Guide\nPDF 1 · Page 1\nIncome')
    expect(calls[0].sql).toContain("c.state NOT IN ('draft','published')")
    expect(calls[1].sql).toContain("c.state IN ('draft','published')")
    const insert = calls.find(c => c.sql.includes('INSERT INTO passage_embeddings'))!
    expect(insert.sql).toContain('evidence_version=$3')
  })
  it('refuses malformed vectors', () => {
    expect(() => vectorLiteral([1, 2])).toThrow('invalid_embedding')
    expect(() => vectorLiteral(vec.map((v, i) => i === 3 ? NaN : v))).toThrow('invalid_embedding')
  })
})
