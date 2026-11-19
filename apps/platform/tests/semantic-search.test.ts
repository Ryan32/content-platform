import { afterEach, describe, expect, it, vi } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { fuse, hybridContentIds } from '../src/server/search'
import { vectorLiteral } from '../src/processing/embeddings'
import { buildChunks, embedChunks, sourceOf, SOURCE_WEIGHTS, windows } from '../src/processing/chunks'
import { emit, firehoseStreams, shipOutbox, toRecord } from '../src/processing/analytics'
import { evidenceKey, s3EvidenceSink } from '../src/processing/evidence'
import { PutObjectCommand } from '@aws-sdk/client-s3'

const vec = Array.from({ length: 1024 }, (_, i) => (i % 7) / 10)
afterEach(() => vi.unstubAllEnvs())
function db(keyword: number[], semantic: number[]) {
  return { query: vi.fn(async (sql: string) => {
    if (sql.includes('embedding <=>')) return { rows: semantic.map(id => ({ id, citation_id: `c${id}`, locator: 'File.pdf · Page 1', asset_id: 3 })) }
    if (sql.includes('k.tsv @@ q')) return { rows: [] }
    if (sql.includes('numnode(q) > 0')) return { rows: keyword.map(id => ({ id })) }
    return { rows: [{ id: 1 }] }
  }) }
}

describe('REQ-SEARCH-02: hybrid keyword + semantic ranking', () => {
  it('fuses lists so items found by several rank first', () => {
    expect(fuse([1, 2, 3], [3, 4])[0]).toBe(3)
    expect(fuse([1, 2], [])).toEqual([1, 2])
  })
  it('adds meaning-based matches only when switched on, and only for published current chunks', async () => {
    const d = db([1], [5, 1]), embed = vi.fn(async () => vec)
    expect(await hybridContentIds(d, 'income for retirees', embed)).toEqual([1])
    vi.stubEnv('SEMANTIC_SEARCH', 'true')
    expect(await hybridContentIds(d, 'income for retirees', embed)).toEqual([1, 5])
    const sql = d.query.mock.calls.map(([q]) => q as string).find(q => q.includes('embedding <=>'))!
    expect(sql).toContain("c.state = 'published'"); expect(sql).toContain('st.build_version = n.build_version'); expect(sql).toContain('n.weight')
  })
  it('falls back to keyword results when embedding fails', async () => {
    vi.stubEnv('SEMANTIC_SEARCH', 'true')
    expect(await hybridContentIds(db([2], [9]), 'annuity riders', async () => { throw new Error('throttled') })).toEqual([2])
  })
  it('refuses malformed vectors', () => {
    expect(() => vectorLiteral([1, 2])).toThrow('invalid_embedding')
  })
})

describe('REQ-SEARCH-05: everything indexed, weighted by source', () => {
  const item = {
    title: 'Income riders guide', description: 'How guaranteed income riders work.', takeaways: ['Income for life'], tags: ['Annuities'],
    files: [{ assetId: 3, name: 'Guide.pdf', description: 'The client guide.', mimeType: 'application/pdf' }, { assetId: 4, name: 'Webinar.mp4', mimeType: 'video/mp4' }],
    passages: [
      { citationId: 'v-s1-e1', text: 'Article intro', locator: 'Article text · Article text' },
      { citationId: 'v-s2-e1', text: 'Typed page', locator: 'Guide.pdf · Page 1', assetId: 3 },
      { citationId: 'v-s2-e2', text: 'Scanned page', locator: 'Guide.pdf · Page 2 (OCR)', assetId: 3 },
      { citationId: 'v-s3-e1', text: 'Welcome everyone', locator: 'Webinar.mp4 · 0s – 30s', assetId: 4 },
      { citationId: 'v-s3-e2', text: 'Today we cover riders', locator: 'Webinar.mp4 · 30s – 60s', assetId: 4 },
      { citationId: 'v-s4-e1', text: 'A chart of payouts', locator: 'Slide 2 (picture) · description' },
    ],
    evidenceVersion: 'v',
  }
  it('keeps every source and weights curated fields above documents above transcripts, OCR and pictures', () => {
    const { chunks, version } = buildChunks(item)
    const bySource = Object.fromEntries(chunks.map(c => [c.source, c.weight]))
    expect(Object.keys(bySource).sort()).toEqual(['article', 'document', 'file', 'ocr', 'summary', 'tag', 'takeaway', 'title', 'transcript', 'vision'])
    expect(bySource.title).toBeGreaterThan(bySource.summary); expect(bySource.document).toBeGreaterThan(bySource.transcript)
    expect(bySource.transcript).toBeGreaterThan(bySource.ocr); expect(bySource.ocr).toBeGreaterThan(bySource.vision)
    // Short transcript segments from one file merge into one window that still points at the file and first passage.
    const transcript = chunks.filter(c => c.source === 'transcript')
    expect(transcript).toHaveLength(1)
    expect(transcript[0]).toMatchObject({ assetId: 4, citationId: 'v-s3-e1', text: 'Welcome everyone Today we cover riders', locator: 'Webinar.mp4 · 0s – 30s → 30s – 60s' })
    expect(chunks.find(c => c.source === 'file' && c.assetId === 3)?.text).toBe('Guide.pdf. The client guide.')
    expect(buildChunks(item).version).toBe(version)
    expect(buildChunks({ ...item, title: 'Changed' }).version).not.toBe(version)
  })
  it('classifies sources and splits long text without losing any of it', () => {
    expect(sourceOf('Deck.pptx · Slide 4')).toBe('slides'); expect(sourceOf('00:01:02.000 – 00:01:05.000')).toBe('captions')
    expect(sourceOf('Rates.xlsx · Sheet Rates!A1')).toBe('sheet'); expect(sourceOf('Vimeo: Session 2 · 0s – 5s')).toBe('transcript')
    const text = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} about retirement income.`).join(' ')
    const parts = windows(text)
    expect(parts.length).toBeGreaterThan(3)
    expect(parts.every(p => p.length <= 3600)).toBe(true)
    for (let i = 0; i < 400; i += 37) expect(parts.some(p => p.includes(`Sentence number ${i} `))).toBe(true)
    expect(SOURCE_WEIGHTS.title).toBe(3)
  })
  it('embeds pending chunks and records each (with its vector) for the analytics chunks table', async () => {
    const calls: [string, unknown[] | undefined][] = []
    const fake = { query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push([sql, params])
      if (sql.includes('WHERE k.embedding IS NULL')) return { rows: [{ id: 9, content_id: 4, build_version: 'b', seq: 0, source: 'title', weight: 3, asset_id: null, citation_id: null, locator: 'Title', text: 'Guide', title: 'Guide' }] }
      return { rows: [] }
    }) }
    expect(await embedChunks(fake, async () => vec)).toEqual({ embedded: 1 })
    const insert = calls.find(([sql]) => sql.startsWith('INSERT INTO analytics_outbox'))!
    expect(insert[1]![0]).toBe('chunks')
    expect(JSON.parse(String(insert[1]![5])).embedding).toHaveLength(1024)
  })
})

describe('REQ-DATA-01: analytics outbox to Iceberg via Firehose', () => {
  it('ships pending rows per stream, marks only accepted rows, and keeps rejected ones for the next pass', async () => {
    vi.stubEnv('ANALYTICS_FIREHOSE_PREFIX', 'aecp-dev-library')
    expect(firehoseStreams().model_calls).toBe('aecp-dev-library-model-calls')
    const updates: unknown[][] = []
    const fake = { query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT') && params?.[0] === 'events') return { rows: [1, 2, 3].map(id => ({ id, occurred_at: '2026-11-18T00:00:00Z', stream: 'events', event: 'job.succeeded', content_id: 7, job_id: id, actor: null, data: { kind: 'document' } })) }
      if (sql.startsWith('UPDATE')) updates.push(params!)
      return { rows: [], rowCount: 0 }
    }) }
    const put = vi.fn(async (_stream: string, records: string[]) => records.map((_, i) => i !== 1))
    expect(await shipOutbox(fake, { put })).toEqual({ events: 2 })
    expect(put.mock.calls[0][0]).toBe('aecp-dev-library-events')
    expect(JSON.parse(put.mock.calls[0][1][0])).toMatchObject({ outbox_id: 1, event: 'job.succeeded', content_id: 7, kind: 'document' })
    expect(updates[0][0]).toEqual([1, 3])
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("interval '7 days'"))).toBe(true)
  })
  it('writes outbox rows in one statement and flattens them into one Iceberg record', async () => {
    const q = vi.fn(async () => ({ rows: [] }))
    await emit({ query: q }, [{ stream: 'events', event: 'a', data: { x: 1 } }, { stream: 'items', event: 'b', contentId: 2, data: {} }])
    expect(q).toHaveBeenCalledTimes(1)
    expect(toRecord({ id: '5', occurred_at: '2026-11-18T00:00:00Z', stream: 'items', event: 'b', content_id: 2, job_id: null, actor: 'user:3', data: { title: 'T' } }))
      .toContain('"title":"T"')
    const chunk = JSON.parse(toRecord({ id: '6', occurred_at: '2026-11-18T00:00:00Z', stream: 'chunks', event: 'c', content_id: 2, job_id: null, actor: null, data: { text: 'x', embedding: [0.5, -1] } }))
    expect(chunk.embedding).toBe('[0.5,-1]')
    expect(JSON.parse(chunk.payload).embedding).toBeUndefined()
  })
})

describe('REQ-DATA-02: lossless evidence', () => {
  it('stores raw outputs gzipped under a content-addressed key and lists them', async () => {
    const sent: PutObjectCommand[] = [], rows: unknown[][] = []
    const s3 = { send: vi.fn(async (c: PutObjectCommand) => { sent.push(c); return {} }) }
    const sink = s3EvidenceSink({ query: async (_sql: string, values?: unknown[]) => { rows.push(values!); return { rows: [] } } }, 'private-bucket', s3 as never)
    const saved = await sink.save({ kind: 'textract', processor: 'ae-textract/1', contentId: 7, jobId: 3, body: { Blocks: [{ Text: 'x', Confidence: 99.1 }] } })
    expect(saved!.key).toBe(evidenceKey({ kind: 'textract', processor: 'ae-textract/1', contentId: 7 }, saved!.sha256))
    expect(saved!.key).toMatch(/^evidence\/7\/textract\/ae-textract_1\/[a-f0-9]{64}\.json\.gz$/)
    const body = JSON.parse(gunzipSync(sent[0].input.Body as Buffer).toString('utf8'))
    expect(body.Blocks[0].Confidence).toBe(99.1)
    expect(sent[0].input.IfNoneMatch).toBe('*')
    expect(rows[0].slice(0, 5)).toEqual([7, 3, null, 'textract', 'ae-textract/1'])
  })
})

describe('REQ-DATA-01: shipping never blocks the worker', () => {
  it('leaves rows pending when Firehose is unavailable', async () => {
    const fake = { query: vi.fn(async (sql: string, params?: unknown[]) => sql.startsWith('SELECT') && params?.[0] === 'events'
      ? { rows: [{ id: 1, occurred_at: '2026-11-18T00:00:00Z', stream: 'events', event: 'e', content_id: null, job_id: null, actor: null, data: {} }] } : { rows: [] }) }
    expect(await shipOutbox(fake, { put: async () => { throw new Error('ResourceNotFoundException') } }, { events: 'missing' })).toEqual({ events: 0 })
    expect(fake.query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE'))).toBe(false)
  })
})
