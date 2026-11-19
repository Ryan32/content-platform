import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migratedDatabase, type TestDb } from './support/migrated-db'
import { reconcile } from '../src/processing/reconcile'
import { DEFAULT_SETTINGS } from '../src/processing/settings'
import { JobStore } from '../src/processing/jobs'
import { analyzeItem, currentRecord } from '../src/processing/analyze-runtime'
import { embedChunks, syncChunks } from '../src/processing/chunks'
import { hybridSearch } from '../src/server/search'
import { emit, shipOutbox } from '../src/processing/analytics'
import { s3EvidenceSink } from '../src/processing/evidence'

/**
 * REQ-UPGRADE-02: our hand-written SQL, run against the real schema produced by every migration (PostgreSQL + pgvector,
 * in-process). Complements the schema contract: these execute the actual queries of the scheduler, job queue, analysis,
 * search index, search and analytics, so a Payload upgrade that changes table shapes fails here.
 */
let db: TestDb
const vec = (seed: number) => { const v = Array.from({ length: 1024 }, (_, i) => Math.sin((i + 1) * seed)); const n = Math.hypot(...v); return v.map(x => x / n) }
const noAnalysis = { title: null, summary: { value: 'x', reason: '', evidenceIds: [] }, kind: null, section: null, topics: null, pages: null, audience: null, program: null,
  licensing: null, lines: null, carriers: null, tags: [], newTags: [], takeaways: [], conflicts: [], warnings: [], fileSummaries: [] }

beforeAll(async () => {
  db = await migratedDatabase()
  process.env.ALLOW_PAID_PROCESSING = 'true'; process.env.BEDROCK_MODEL_IDS = DEFAULT_SETTINGS.taggingModel
  // 1: migrated article, no files. 2: package page with two PDFs. 3: page with two Vimeo videos.
  await db.pg.exec(`
    INSERT INTO content (id, title, description, body, format, state, source_hash, source_key, evidence_version, vimeo_id) VALUES
      (1, 'Article', '', 'WordPress article text', 'article', 'intake', 'v1', 'wordpress:dbr:post:1', 'unprocessed', NULL),
      (2, 'Tax Planning', 'Team summary', '', 'pdf', 'intake', 'v2', 'wordpress:dbr:post:2', 'unprocessed', NULL),
      (3, 'Webinar series', '', '', 'video', 'intake', 'v3', 'wordpress:dbr:post:3', 'unprocessed', '111');
    INSERT INTO content_more_videos (_order, _parent_id, id, vimeo_id, title) VALUES (1, 3, 'mv1', '222', 'Session 2');
    INSERT INTO assets (id, content_id, object_key, sha256, mime_type, version, file_name) VALUES
      (21, 2, 'content/2/aa.pdf', 'aa', 'application/pdf', 'v2', 'Whitepaper.pdf'), (22, 2, 'content/2/bb.pdf', 'bb', 'application/pdf', 'v2', 'Marketing-Kit_DL.pdf');
    INSERT INTO carriers (id, name, slug) VALUES (8, 'Allianz', 'allianz');
    INSERT INTO taxonomy (id, label, dimension, key) VALUES (5, 'Annuities', 'topic', 'topic:annuities');
    INSERT INTO content_rels ("order", parent_id, path, taxonomy_id) VALUES (1, 2, 'acceptedTags', 5);
    INSERT INTO content_topics ("order", parent_id, value) VALUES (1, 2, 'products:commission-schedules');`)
}, 120000)
afterAll(async () => { await db?.close() })

describe('REQ-UPGRADE-02: scheduler, job queue and analysis against the migrated schema', () => {
  it('queues every file and every video, then one analysis per item once all its sources finish', async () => {
    const store = new JobStore(db as never)
    await reconcile(db as never, store, DEFAULT_SETTINGS)
    const first = (await db.query('SELECT content_id, input FROM processing_jobs ORDER BY id')).rows
    expect(first.filter(j => j.input.kind === 'document').map(j => j.input.assetId).sort()).toEqual([21, 22])
    expect(first.filter(j => j.input.kind === 'vimeo').map(j => j.input.videoId).sort()).toEqual(['111', '222'])
    // The article-only item (no Vimeo ID: NULL must not block it) is ready at once; the others wait for their sources.
    expect(first.filter(j => j.input.kind === 'analyze').map(j => j.content_id)).toEqual([1])
    // Finish every source; the additional video passes the ownership check at completion.
    for (const job of (await db.query(`SELECT * FROM processing_jobs WHERE input->>'kind' <> 'analyze'`)).rows) {
      await db.query(`UPDATE processing_jobs SET state='running', lease_token='t', lease_until=now()+interval '5 minutes' WHERE id=$1`, [job.id])
      await store.finish({ ...job, lease_token: 't' }, { processorVersion: 'p', warnings: [], passages: [{ id: 'e1', text: job.input.kind === 'vimeo' ? `Video ${job.input.videoId}` : `Direct mail ${job.input.assetId}`, locator: 'Page 1' }] })
    }
    await reconcile(db as never, store, DEFAULT_SETTINGS)
    const analyses = (await db.query(`SELECT content_id, input FROM processing_jobs WHERE input->>'kind'='analyze' ORDER BY content_id`)).rows
    expect(analyses.map(a => a.content_id)).toEqual([1, 2, 3])
    expect(analyses[1].input.carriers).toEqual([{ id: 8, name: 'Allianz' }])
    await reconcile(db as never, store, DEFAULT_SETTINGS)
    expect((await db.query(`SELECT count(*)::int n FROM processing_jobs WHERE input->>'kind'='analyze'`)).rows[0].n).toBe(3)   // idempotent
    expect((await db.query(`SELECT count(*)::int n FROM analytics_outbox WHERE event='job.succeeded'`)).rows[0].n).toBe(4)
  })

  it('loads the current record and labels sources by real file names and video titles', async () => {
    expect(await currentRecord(db as never, 2)).toMatchObject({ topics: ['products:commission-schedules'], tags: [5], migrated: true, description: 'Team summary' })
    const [pkg, videos] = (await db.query(`SELECT content_id, input FROM processing_jobs WHERE input->>'kind'='analyze' AND content_id IN (2,3) ORDER BY content_id`)).rows
    let seen: any
    await analyzeItem(db as never, { id: 90, content_id: 2, source_version: 'v2', input: pkg.input } as never, (async (input: any) => { seen = input; return { analysis: noAnalysis, truncated: false } }) as never)
    expect(seen.passages.map((p: any) => [p.locator, p.assetId])).toEqual([['Whitepaper.pdf · Page 1', 21], ['Marketing-Kit_DL.pdf · Page 1', 22]])
    const video = await analyzeItem(db as never, { id: 91, content_id: 3, source_version: 'v3', input: videos.input } as never, (async () => ({ analysis: noAnalysis, truncated: false })) as never)
    expect(video.sources.map(s => s.label).sort()).toEqual(['Vimeo video', 'Vimeo: Session 2'])
  })
})

describe('REQ-UPGRADE-02: search index, search and analytics against the migrated schema', () => {
  it('builds weighted chunks, embeds them, finds words and meaning inside the right file, and hides unpublished items', async () => {
    await db.pg.exec(`UPDATE content SET state='published', evidence_version='ev2', updated_at=now() WHERE id=2;
      INSERT INTO content_passages (_order, _parent_id, id, citation_id, version, text, locator, asset_id) VALUES
        (1, 2, 'p1', 'ev2-s1-e1', 'ev2', 'Tax strategies for retirees', 'Whitepaper.pdf · Page 1', 21),
        (2, 2, 'p2', 'ev2-s2-e1', 'ev2', 'Direct mail postcard template', 'Marketing-Kit_DL.pdf · Page 1', 22);`)
    const built = await syncChunks(db as never, 20)
    expect(built.rebuilt).toBeGreaterThanOrEqual(1)
    const sources = (await db.query('SELECT source FROM search_chunks WHERE content_id=2 ORDER BY seq')).rows.map(r => r.source)
    expect(sources).toEqual(['title', 'summary', 'tag', 'file', 'file', 'document', 'document'])
    expect((await embedChunks(db as never, async t => vec(t.includes('postcard') ? 1 : 2), 100)).embedded).toBeGreaterThan(5)
    const words = await hybridSearch(db as never, 'postcard')
    expect(words.ids).toEqual([2]); expect(words.matches.get(2)).toEqual({ citationId: 'ev2-s2-e1', locator: 'Marketing-Kit_DL.pdf · Page 1', assetId: 22 })
    process.env.SEMANTIC_SEARCH = 'true'
    const meaning = await hybridSearch(db as never, 'mailer for clients', async () => vec(1))
    expect(meaning.matches.get(2)?.assetId).toBe(22)
    delete process.env.SEMANTIC_SEARCH
    expect((await hybridSearch(db as never, 'WordPress article')).ids ?? []).not.toContain(1)   // intake: never for readers
    await db.pg.exec(`UPDATE content SET state='archived' WHERE id=2`); await syncChunks(db as never)
    expect((await db.query('SELECT count(*)::int n FROM search_chunks WHERE content_id=2')).rows[0].n).toBe(0)
  })

  it('records evidence once per content and ships the outbox', async () => {
    const sink = s3EvidenceSink(db as never, 'bucket', { send: async () => ({}) } as never)
    await sink.save({ kind: 'transcribe', processor: 'ae-transcribe/1', contentId: 3, jobId: 4, body: { results: {} } })
    await sink.save({ kind: 'transcribe', processor: 'ae-transcribe/1', contentId: 3, jobId: 4, body: { results: {} } })
    expect((await db.query('SELECT count(*)::int n FROM evidence_artifacts')).rows[0].n).toBe(1)
    await emit(db as never, { stream: 'events', event: 'review.decision', contentId: 2, actor: 'user:3', data: { fields: [] } })
    const shipped = await shipOutbox(db as never, { put: async (_s: string, r: string[]) => r.map(() => true) }, { events: 'x-events', items: 'x-items', chunks: 'x-chunks' })
    expect(shipped.events).toBeGreaterThanOrEqual(5); expect(shipped.items).toBeGreaterThanOrEqual(1)
    expect((await db.query(`SELECT count(*)::int n FROM analytics_outbox WHERE shipped_at IS NULL AND stream IN ('events','items','chunks')`)).rows[0].n).toBe(0)
  })
})
