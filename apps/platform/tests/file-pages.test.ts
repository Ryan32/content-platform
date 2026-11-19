import { describe, expect, it, vi } from 'vitest'
import { digest, sha256, type IntakePackage } from '../src/import/package'
import { attachFiles, decodeName, type AttachDeps } from '../src/import/attach'
import { ANALYSIS_VERSION, validateAnalysis, type AnalysisEnvelope } from '../src/processing/analysis'
import { analysisPatch, fileDescriptionUpdates, fileSuggestions, readAnalysisForm, reviewLabels } from '../src/processing/analysis-review'
import { createLibrary, matchHref, type LibraryRepository } from '../src/domain/library'
import { hybridSearch } from '../src/server/search'
import { reconcile } from '../src/processing/reconcile'
import { DEFAULT_SETTINGS } from '../src/processing/settings'
import type { JobStore } from '../src/processing/jobs'
import type { Pool } from 'pg'

/** One WordPress package with a whitepaper, two marketing-kit PDFs and an article picture. */
function packagePage(): IntakePackage {
  const files = [['wp-content/uploads/download-manager-files/Tax-Planning%20Whitepaper.pdf', 'w', '__wpdm_files'],
    ['wp-content/uploads/download-manager-files/Marketing-Kit_DL.pdf', 'd', '__wpdm_files'],
    ['wp-content/uploads/download-manager-files/Marketing-Kit_IO.pdf', 'i', '__wpdm_files'],
    ['wp-content/uploads/2026/08/chart.png', 'c', 'post_content']] as const
  const blobs = files.map(([path, seed]) => { const h = sha256(`bytes ${seed}`); return { id: `sha256:${h}`, sha256: h, bytes: 20000, localPaths: [path], delivery: 'not_uploaded' as const } })
  const sourceKey = 'wordpress:dbr:post:84074'
  const snapshot = { sourceKey, raw: { post: { ID: '84074' }, metadata: [] }, manifest: { assets: [] }, attachments: [],
    verifiedFiles: Object.fromEntries(files.map(([path], i) => [path, { sha256: blobs[i].sha256, bytes: 20000 }])) }
  const sourceHash = digest(snapshot)
  const p: IntakePackage = { schema: 'ae-wordpress-intake/1', packageId: '', provenance: {}, blobs, providerAssets: [], sourceTaxonomy: [], skipped: [],
    sourceSnapshots: [{ sourceKey, sourceHash, snapshot }], relationships: [],
    content: [{ sourceKey, sourceHash, selectionReason: 't', descriptionSource: null, formats: ['pdf'], issues: [], policy: { resolution: 'restricted_intake_pending_policy_mapping', grants: [] },
      initialContent: { sourceKey, sourceHash, title: 'Tax Planning', description: '', body: '', format: 'pdf', state: 'intake', accessProfile: null, acceptedTags: [], evidenceVersion: 'unprocessed', passages: [] } }] }
  files.forEach(([, , field], i) => { const edge = { from: sourceKey, to: blobs[i].id, kind: 'asset' as const, field, status: 'verified_local' }; p.relationships.push({ ...edge, id: digest(edge) }) })
  const { packageId: _, ...rest } = p; p.packageId = digest(rest)
  return p
}

describe('REQ-IMPORT-09: one page per WordPress package, every file named', () => {
  it('keeps each file on the one page with its real (decoded) name, size and role', async () => {
    const p = packagePage(), created: Parameters<AttachDeps['createAsset']>[0][] = []
    const deps: AttachDeps = { content: async () => ({ id: 7, sourceHash: p.content[0].sourceHash }), copy: async () => 'copied', asset: async () => null,
      createAsset: async d => { created.push(d); return created.length }, cover: async () => true }
    await attachFiles(p, deps)
    expect(new Set(created.map(c => c.content))).toEqual(new Set([7]))
    expect(created.map(c => [c.fileName, c.role]).sort()).toEqual([['Marketing-Kit_DL.pdf', 'download'], ['Marketing-Kit_IO.pdf', 'download'],
      ['Tax-Planning Whitepaper.pdf', 'download'], ['chart.png', 'inline']])
    expect(created.every(c => c.bytes === 20000)).toBe(true)
    expect(decodeName('Bad%E0name.pdf')).toBe('Bad%E0name.pdf')
  })
})

function envelope(): AnalysisEnvelope {
  return { analysisVersion: ANALYSIS_VERSION, taxonomy: [], taxonomyIds: [], taxonomyVersion: 'x', carriers: [],
    sources: [{ id: 's1', assetId: 21, label: 'Whitepaper.pdf', passages: 1, status: 'used' }, { id: 's2', assetId: 22, label: 'Marketing-Kit_DL.pdf', passages: 1, status: 'used' }],
    passages: [{ id: 's1-e1', text: 'Tax strategies', locator: 'Whitepaper.pdf · Page 1', assetId: 21 }, { id: 's2-e1', text: 'Direct mail piece', locator: 'Marketing-Kit_DL.pdf · Page 1', assetId: 22 }],
    current: { title: 'Tax Planning', description: 'Team summary', body: '', kind: 'resource', section: null, topics: [], pages: [], audience: 'advisor', program: null,
      licensing: [], lines: [], carriers: [], tags: [], takeaways: [], migrated: true, sourceCategories: [] },
    analysis: { title: null, summary: { value: 'S', reason: '', evidenceIds: [] }, kind: null, section: null, topics: null, pages: null, audience: null, program: null,
      licensing: null, lines: null, carriers: null, tags: [], newTags: [], takeaways: [], conflicts: [], warnings: [],
      fileSummaries: [{ sourceId: 's1', summary: 'The client-facing whitepaper.', evidenceIds: ['s1-e1'] }, { sourceId: 's2', summary: 'A direct-mail version for advisors.', evidenceIds: ['s2-e1'] }] } }
}
const form = (extra: Record<string, string> = {}) => readAnalysisForm(new URLSearchParams({ decision: 'accepted', expectedUpdatedAt: 't', title: '', summary: '', ...extra })).data!

describe('REQ-AI-04: a description for each file on the page', () => {
  it('backfills empty file descriptions, keeps existing ones unless chosen, and uses the reviewer wording', () => {
    const e = envelope()
    expect(fileSuggestions(e).map(f => f.assetId)).toEqual([21, 22])
    expect(fileDescriptionUpdates(e, form(), new Map([[21, ''], [22, 'Team wrote this']]))).toEqual([{ assetId: 21, description: 'The client-facing whitepaper.' }])
    expect(fileDescriptionUpdates(e, form({ fileUse_22: 'suggested', fileText_22: 'Edited by reviewer' }), new Map([[21, 'x'], [22, 'Team wrote this']])))
      .toEqual([{ assetId: 22, description: 'Edited by reviewer' }])
    // A file not on this item (or another version) is never touched.
    expect(fileDescriptionUpdates(e, form(), new Map([[22, '']]))).toEqual([{ assetId: 22, description: 'A direct-mail version for advisors.' }])
    expect(fileDescriptionUpdates(e, { ...form(), decision: 'rejected' }, new Map([[21, '']]))).toEqual([])
  })
  it('rejects descriptions for files that are not on this page; citations remember their file', () => {
    expect(() => validateAnalysis({ ...envelope().analysis, fileSummaries: [{ sourceId: 's9', summary: 'x', evidenceIds: [] }] }, new Set(['s1-e1']), [], [], new Set(['s1'])))
      .toThrow('invalid_proposal_reference')
    const patch = analysisPatch(envelope(), { sourceHash: 'v', updatedAt: 't', state: 'intake', body: '' }, 'v', form(), [])!
    expect((patch.passages as { assetId?: number; locator: string }[]).map(p => [p.locator, p.assetId])).toEqual([['Whitepaper.pdf · Page 1', 21], ['Marketing-Kit_DL.pdf · Page 1', 22]])
  })
})

describe('REQ-SEARCH-04: search hits inside files open the page at that file', () => {
  it('links to the landing page, opened at the passage and the file section', () => {
    expect(matchHref({ id: '7', match: { citationId: 'abc-s2-e1', locator: 'Marketing-Kit_DL.pdf · Page 1', assetId: 22 } })).toBe('/resources/7?citation=abc-s2-e1&file=22#file-22')
    expect(matchHref({ id: '7' })).toBe('/resources/7')
  })
  it('finds pages by words inside their files and tells MCP clients where', async () => {
    const db = { query: vi.fn(async (sql: string) => {
      if (sql.includes('k.tsv @@ q')) return { rows: [{ id: 7, citation_id: 'abc-s2-e1', locator: 'Marketing-Kit_DL.pdf · Page 1', asset_id: 22 }] }
      if (sql.includes('numnode(q) > 0')) return { rows: [] }
      return { rows: [{ id: 1 }] }
    }) }
    const found = await hybridSearch(db, 'direct mail')
    expect(found.ids).toEqual([7]); expect(found.matches.get(7)?.assetId).toBe(22)
    const repo: LibraryRepository = { get: async () => null, search: async () => ({ hasNextPage: false, items: [{ id: '7', title: 'Tax Planning', description: '', format: 'pdf', version: 'v',
      body: '', updatedAt: '', evidence: [], match: { citationId: 'abc-s2-e1', locator: 'Marketing-Kit_DL.pdf · Page 1', assetId: 22 } }] }) }
    const result = await createLibrary(repo, 'https://library.example').search('direct mail')
    expect(result.items[0]).toMatchObject({ url: 'https://library.example/resources/7', matchedIn: 'Marketing-Kit_DL.pdf · Page 1',
      matchUrl: 'https://library.example/resources/7?citation=abc-s2-e1&file=22#file-22' })
  })
})

describe('REQ-INGEST-05: every video on a page is processed', () => {
  it('queues a job for each video of the item, main and additional', async () => {
    const enqueue = vi.fn(async () => 1)
    const db = { query: vi.fn(async (sql: string) => sql.includes('CROSS JOIN LATERAL') ? { rows: [{ id: 5, source_hash: 'v5', vimeo_id: '111' }, { id: 5, source_hash: 'v5', vimeo_id: '222' }] } : { rows: [] }) }
    await reconcile(db as unknown as Pool, { enqueue } as unknown as JobStore, { ...DEFAULT_SETTINGS, taggingEnabled: false })
    expect(enqueue).toHaveBeenCalledWith(5, 'v5', { kind: 'vimeo', videoId: '111' })
    expect(enqueue).toHaveBeenCalledWith(5, 'v5', { kind: 'vimeo', videoId: '222' })
  })
})

describe('REQ-DATA-03: review decisions recorded as ML labels', () => {
  it('records, per field, what the AI proposed, what was there, what was pre-selected, chosen and kept, and edits', () => {
    const e = envelope()
    e.analysis.title = { value: 'AI title', reason: '', evidenceIds: [] }
    const input = form({ use_title: 'suggested', title: 'Reviewer title' })
    const patch = analysisPatch(e, { sourceHash: 'v', updatedAt: 't', state: 'intake', body: '' }, 'v', input, [])!
    const labels = reviewLabels(e, input, patch, [{ assetId: 21, description: 'The client-facing whitepaper.' }], [])
    const title = labels.fields.find(f => f.field === 'title')!
    expect(title).toMatchObject({ ai: 'AI title', before: 'Tax Planning', preselected: 'current', chosen: 'suggested', after: 'Reviewer title', edited: true })
    const summary = labels.fields.find(f => f.field === 'summary')!
    expect(summary).toMatchObject({ ai: 'S', before: 'Team summary', chosen: 'current', after: 'Team summary', edited: false })
    expect(labels.files).toEqual([{ asset_id: 21, ai: 'The client-facing whitepaper.', final: 'The client-facing whitepaper.' }, { asset_id: 22, ai: 'A direct-mail version for advisors.', final: null }])
    expect(labels.decision).toBe('accepted')
  })
})
