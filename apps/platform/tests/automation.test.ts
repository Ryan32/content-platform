import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import type { JobStore } from '../src/processing/jobs'
import { reconcile } from '../src/processing/reconcile'
import { DEFAULT_SETTINGS, paidBlock, readSettings } from '../src/processing/settings'
import { explain } from '../src/processing/messages'

type Rows = { files?: object[]; videos?: object[]; extracted?: object[]; terms?: object[]; paid?: number }
function fakeDb(rows: Rows) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM assets a')) return { rows: rows.files ?? [] }
    if (sql.includes('FROM content c')) return { rows: rows.videos ?? [] }
    if (sql.includes('FROM processing_jobs j')) return { rows: rows.extracted ?? [] }
    if (sql.includes('FROM taxonomy')) return { rows: rows.terms ?? [] }
    if (sql.includes('count(*)')) return { rows: [{ n: rows.paid ?? 0 }] }
    return { rows: [] }
  })
  return { db: { query } as unknown as Pool, query }
}
const fakeStore = () => { const enqueue = vi.fn(async () => 1); return { store: { enqueue } as unknown as JobStore, enqueue } }
const terms = [{ id: 3, label: 'Tax planning', definition: 'Tax strategy', dimension: 'topic' }]

afterEach(() => vi.unstubAllEnvs())

describe('REQ-AUTO-01: automation settings gate background work', () => {
  it('does nothing while paused', async () => {
    const { db, query } = fakeDb({ files: [{ id: 1, content_id: 2, object_key: 'content/2/a.pdf', source_hash: 'v' }] })
    const { store, enqueue } = fakeStore()
    expect(await reconcile(db, store, { ...DEFAULT_SETTINGS, paused: true })).toEqual({ queued: 0, waiting: {} })
    expect(query).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled()
  })

  it('queues free extraction for new files and Vimeo IDs, and respects each switch', async () => {
    const rows = { files: [{ id: 1, content_id: 2, object_key: 'content/2/abc.pdf', source_hash: 'v1' }], videos: [{ id: 5, source_hash: 'v5', vimeo_id: '123' }] }
    const on = fakeStore()
    expect((await reconcile(fakeDb(rows).db, on.store, { ...DEFAULT_SETTINGS, taggingEnabled: false })).queued).toBe(2)
    expect(on.enqueue).toHaveBeenCalledWith(2, 'v1', { kind: 'document', assetId: 1, format: 'pdf' })
    expect(on.enqueue).toHaveBeenCalledWith(5, 'v5', { kind: 'vimeo', videoId: '123' })
    const off = fakeStore()
    const result = await reconcile(fakeDb(rows).db, off.store, { ...DEFAULT_SETTINGS, documentsEnabled: false, vimeoEnabled: false, taggingEnabled: false })
    expect(off.enqueue).not.toHaveBeenCalled(); expect(result.waiting).toEqual({ documents_turned_off: 1 })
  })

  it('holds paid transcription unless the environment allows it and the switch is on', async () => {
    const rows = { files: [{ id: 9, content_id: 4, object_key: 'content/4/abc.mp4', source_hash: 'v4' }] }
    const blocked = fakeStore()
    expect((await reconcile(fakeDb(rows).db, blocked.store, DEFAULT_SETTINGS)).waiting).toEqual({ paid_processing_disabled: 1 })
    vi.stubEnv('ALLOW_PAID_PROCESSING', 'true')
    expect((await reconcile(fakeDb(rows).db, fakeStore().store, { ...DEFAULT_SETTINGS, transcriptionEnabled: false })).waiting).toEqual({ transcription_turned_off: 1 })
    const allowed = fakeStore()
    await reconcile(fakeDb(rows).db, allowed.store, DEFAULT_SETTINGS)
    expect(allowed.enqueue).toHaveBeenCalledWith(4, 'v4', { kind: 'transcribe', assetId: 9 })
  })

  it('queues AI tagging only with an approved model, existing tags, and room under the daily limit', async () => {
    vi.stubEnv('ALLOW_PAID_PROCESSING', 'true')
    const extracted = [{ id: 11, content_id: 2, source_version: 'v1', video_id: null }]
    expect((await reconcile(fakeDb({ extracted, terms }).db, fakeStore().store, DEFAULT_SETTINGS)).waiting).toEqual({ model_not_approved: 1 })
    vi.stubEnv('BEDROCK_MODEL_IDS', `${DEFAULT_SETTINGS.taggingModel},other`)
    expect((await reconcile(fakeDb({ extracted, terms: [] }).db, fakeStore().store, DEFAULT_SETTINGS)).waiting).toEqual({ no_tags_defined: 1 })
    expect((await reconcile(fakeDb({ extracted, terms, paid: 200 }).db, fakeStore().store, DEFAULT_SETTINGS)).waiting).toEqual({ daily_paid_limit_reached: 1 })
    const ok = fakeStore()
    await reconcile(fakeDb({ extracted, terms }).db, ok.store, DEFAULT_SETTINGS)
    expect(ok.enqueue).toHaveBeenCalledWith(2, 'v1', { kind: 'classify', extractionJobId: 11, modelId: DEFAULT_SETTINGS.taggingModel, taxonomy: terms })
  })

  it('lets an already-counted job run at the limit but blocks queueing beyond it', async () => {
    vi.stubEnv('ALLOW_PAID_PROCESSING', 'true')
    const { db } = fakeDb({ paid: 200 })
    expect(await paidBlock(db, 'tagging', DEFAULT_SETTINGS)).toBe('daily_paid_limit_reached')
    expect(await paidBlock(db, 'tagging', DEFAULT_SETTINGS, true)).toBeNull()
    expect(await paidBlock(db, 'tagging', { ...DEFAULT_SETTINGS, taggingEnabled: false }, true)).toBe('tagging_turned_off')
  })

  it('reads saved settings, including PostgreSQL numeric limits, and falls back to defaults', async () => {
    const saved = { query: vi.fn(async (sql: string) => sql.includes('tagging_dimensions')
      ? { rows: [{ value: 'topic' }] }
      : { rows: [{ id: 1, paused: true, documents_enabled: false, vimeo_enabled: true, thumbnails_enabled: false, transcription_enabled: false, tagging_enabled: true, tagging_model: 'm', daily_paid_job_limit: '25' }] }) }
    expect(await readSettings(saved as unknown as Pool)).toEqual({ paused: true, documentsEnabled: false, vimeoEnabled: true, thumbnailsEnabled: false, transcriptionEnabled: false,
      taggingEnabled: true, taggingModel: 'm', taggingDimensions: ['topic'], dailyPaidJobLimit: 25 })
    expect(await readSettings({ query: async () => ({ rows: [] }) } as unknown as Pool)).toEqual(DEFAULT_SETTINGS)
  })

  it('explains failure codes in plain language', () => {
    expect(explain('pdf_requires_ocr')).toMatch(/scanned/)
    expect(explain('vimeo_http_500')).toMatch(/Vimeo returned an error \(500\)/)
    expect(explain('something_new')).toBe('Unexpected condition (something_new).')
  })
})
