import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { modelPassages, normalizeAnalysis, validateAnalysis, type Analysis } from '../src/processing/analysis'
import { ProcessingError } from '../src/processing/jobs'
import { analyzeItem } from '../src/processing/analyze-runtime'
import type { Job } from '../src/processing/jobs'

const base: Analysis = { title: null, summary: { value: 'A guide to annuity income.', reason: 'From the PDF', evidenceIds: ['s1-e1'] },
  kind: null, section: { value: 'products', reason: 'Product guide', evidenceIds: ['s1-e1'] }, topics: null, pages: null, audience: null, program: null,
  licensing: null, lines: { values: ['annuity'], reason: 'Annuity', evidenceIds: [] }, carriers: { ids: [8], reason: 'Named', evidenceIds: ['s2-e1'] },
  tags: [{ termId: 3, evidenceIds: ['s1-e1'], confidence: 0.8 }], newTags: [{ label: 'Income riders', dimension: 'topic', definition: 'Riders that guarantee income.', evidenceIds: ['s2-e1'] }],
  takeaways: [{ text: 'Income starts at 60.', evidenceIds: ['s2-e1'] }], fileSummaries: [], conflicts: [], warnings: [] }

describe('REQ-AI-01: combined item analysis', () => {
  it('accepts only known evidence, tag terms, carriers and option values', () => {
    const ids = new Set(['s1-e1', 's2-e1'])
    expect(validateAnalysis(base, ids, [3], [8]).newTags).toHaveLength(1)
    expect(() => validateAnalysis({ ...base, tags: [{ termId: 99, evidenceIds: ['s1-e1'], confidence: 1 }] }, ids, [3], [8])).toThrow('invalid_proposal_reference')
    expect(() => validateAnalysis({ ...base, carriers: { ids: [9], reason: '', evidenceIds: [] } }, ids, [3], [8])).toThrow('invalid_proposal_reference')
    expect(() => validateAnalysis({ ...base, takeaways: [{ text: 'x', evidenceIds: ['s9-e1'] }] }, ids, [3], [8])).toThrow('invalid_proposal_reference')
    expect(() => validateAnalysis({ ...base, section: { value: 'not-a-section', reason: '', evidenceIds: [] } }, ids, [3], [8])).toThrow('invalid_proposal')
  })

  it('tidies malformed model answers without inventing anything, and retries near-empty ones', () => {
    const ids = new Set(['s1-e1', 's2-e1'])
    const messy = { ...base, title: { value: '  ', reason: '', evidenceIds: [] }, pages: undefined, program: undefined, invented_key: 1,
      licensing: { values: ['not-real'], reason: 'x' }, carriers: { ids: [8, 9], reason: '', evidenceIds: [] },
      tags: JSON.stringify([{ termId: 3, evidenceIds: ['s1-e1', 's9-e1'], confidence: 0.4 }, { termId: 99, evidenceIds: ['s1-e1'], confidence: 1 }]),
      warnings: Array.from({ length: 25 }, (_, i) => `w${i}`) }
    const tidy = validateAnalysis(normalizeAnalysis(messy, ids, [3], [8]), ids, [3], [8])
    expect(tidy.title).toBeNull()
    expect(tidy.pages).toBeNull()
    expect(tidy.licensing).toEqual({ values: [], reason: 'x', evidenceIds: [] })
    expect(tidy.carriers?.ids).toEqual([8])
    expect(tidy.tags).toEqual([{ termId: 3, evidenceIds: ['s1-e1'], confidence: 0.4 }])
    expect(tidy.warnings).toHaveLength(20)
    expect(tidy.warnings.at(-1)).toContain('could not be matched')
    expect(normalizeAnalysis(base, ids, [3], [8]).warnings).toEqual(base.warnings)
    const empty = { title: null, summary: base.summary }
    try { normalizeAnalysis(empty, ids, [3], [8]); expect.unreachable() } catch (e) { expect((e as ProcessingError).retryable).toBe(true) }
  })

  it('budgets the serialized passage, so thousands of tiny cells cannot overflow the request', () => {
    const cells = Array.from({ length: 5000 }, (_, i) => ({ id: `s1-e${i}`, locator: `Sheet "Performance" cell R${i}C2`, text: '1.2' }))
    const picked = modelPassages(cells, 20000)
    expect(JSON.stringify(picked.passages).length).toBeLessThanOrEqual(20000 + picked.passages.length)
    expect(picked.truncated).toBe(true)
  })

  it('samples every source within the model budget so one long file cannot crowd out the rest', () => {
    const long = Array.from({ length: 50 }, (_, i) => ({ id: `s1-e${i}`, locator: 'PDF', text: 'x'.repeat(4000) }))
    const short = [{ id: 's2-e1', locator: 'Article text', text: 'Short article' }]
    const picked = modelPassages([...long, ...short], 20000)
    expect(picked.passages.map(p => p.id)).toContain('s2-e1')
    expect(picked.truncated).toBe(true)
  })

  it('combines article text, file and Vimeo results, records failed sources, and never reads other items', async () => {
    const queries: string[] = []
    const db = { query: vi.fn(async (sql: string, params: unknown[]) => {
      queries.push(sql)
      if (sql.includes('FROM content WHERE')) return { rows: [{ title: 'Old title', description: '', body: 'WordPress article text', kind: 'resource', section: null,
        audience: 'advisor', program: null, evidence_version: 'unprocessed', source_key: 'wordpress:dbr:post:1' }] }
      if (sql.includes('FROM processing_jobs')) { expect(params).toEqual([[11, 12, 13], 5, 'v1']); return { rows: [
        { id: 11, stage: 'extract', state: 'succeeded', input: { kind: 'document', format: 'pdf' }, result: { processorVersion: 'p', warnings: [], passages: [{ id: 'e1', text: 'PDF text', locator: 'Page 1' }] } },
        { id: 12, stage: 'extract', state: 'succeeded', input: { kind: 'vimeo', videoId: '77' }, result: { processorVersion: 'p', warnings: [], passages: [{ id: 'e1', text: 'Caption text', locator: '0s – 5s' }] } },
        { id: 13, stage: 'extract', state: 'failed', input: { kind: 'document', format: 'docx' }, result: null }] } }
      if (sql.includes('import_artifacts')) return { rows: [{ name: 'Annuities' }] }
      if (sql.includes('content_rels')) return { rows: [{ path: 'acceptedTags', taxonomy_id: 3, carriers_id: null }] }
      return { rows: [] }
    }) } as unknown as Pool
    const job = { id: 20, content_id: 5, source_version: 'v1', input: { kind: 'analyze', modelId: 'm', sourceJobIds: [11, 12, 13], sourceDigest: 'd', videoId: '77',
      taxonomy: [{ id: 3, label: 'Tax', definition: '', dimension: 'topic' }], carriers: [{ id: 8, name: 'Allianz' }] } } as unknown as Job
    const run = vi.fn(async (input: { passages: { id: string }[]; current: { sourceCategories: string[]; tags: number[]; migrated: boolean } }) => {
      expect(input.passages.map(p => p.id)).toEqual(['s1-e1', 's2-e1', 's3-e1'])
      expect(input.current).toMatchObject({ sourceCategories: ['Annuities'], tags: [3], migrated: true })
      return { analysis: { ...base, carriers: null, tags: [], newTags: [], takeaways: [], lines: null }, truncated: false }
    })
    const envelope = await analyzeItem(db, job, run as never)
    expect(envelope.sources).toEqual([{ id: 's1', label: 'Article text', passages: 1, status: 'used' }, { id: 's2', label: 'PDF 1', passages: 1, status: 'used' },
      { id: 's3', label: 'Vimeo video', passages: 1, status: 'used' }, { label: 'Word document 2', passages: 0, status: 'failed' }])
    expect(envelope.passages[2].locator).toBe('Vimeo video · 0s – 5s')
    expect(queries.filter(q => q.includes('processing_jobs')).every(q => q.includes('content_id=$2'))).toBe(true)
  })
})
