import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { canonical, digest, loadPackage, sha256, validatePackage, type IntakePackage } from '../src/import/package'
import { importPackage, type ImportStore, type Row, type Table } from '../src/import/adapter'
import { ImportArtifacts, SourceSnapshots, SourceRelations, ImportReviews, ImportRuns } from '../src/collections/imports'

function fixture(title = 'Source title'): IntakePackage {
  const fileHash = sha256('synthetic bytes')
  const p: IntakePackage = { schema: 'ae-wordpress-intake/1', packageId: '', provenance: { sourceSystem: 'wordpress' },
    content: [], sourceSnapshots: [], blobs: [{ id: `sha256:${fileHash}`, sha256: fileHash, bytes: 15,
      localPaths: ['wp-content/uploads/test.pdf'], delivery: 'not_uploaded' }], providerAssets: [], sourceTaxonomy: [], relationships: [], skipped: [] }
  for (const id of [1, 2]) {
    const sourceKey = `wordpress:dbr:post:${id}`
    const snapshot = { sourceKey, raw: { post: { ID: String(id), post_title: title }, metadata: [] },
      manifest: { assets: [] }, attachments: [], verifiedFiles: { 'wp-content/uploads/test.pdf': { sha256: fileHash, bytes: 15 } } }
    const sourceHash = digest(snapshot)
    p.sourceSnapshots.push({ sourceKey, sourceHash, snapshot })
    p.content.push({ sourceKey, sourceHash, selectionReason: 'test', descriptionSource: null, formats: ['pdf'], issues: [],
      policy: { resolution: 'restricted_intake_pending_policy_mapping', grants: [] },
      initialContent: { sourceKey, sourceHash, title, description: '', body: 'Synthetic only', format: 'pdf', state: 'intake',
        accessProfile: null, acceptedTags: [], evidenceVersion: 'unprocessed', passages: [] } })
    const edge = { from: sourceKey, to: p.blobs[0].id, kind: 'asset' as const, field: 'body', status: 'verified_local' }
    p.relationships.push({ ...edge, id: digest(edge) })
  }
  return rehash(p)
}
function rehash(p: IntakePackage) { const { packageId: _, ...rest } = p; p.packageId = digest(rest); return p }
class MemoryStore implements ImportStore {
  rows: Partial<Record<Table, Row[]>> = {}
  failAt = Infinity
  discardCommit = false
  calls = 0
  async transaction<T>(operation: Parameters<ImportStore['transaction']>[0], readOnly: boolean): Promise<T> {
    this.calls++
    const draft = structuredClone(this.rows)
    let inserts = 0
    const result = await operation({
      find: async (table, field, value) => draft[table]?.find(row => row[field] === value) ?? null,
      insert: async (table, data) => {
        if (readOnly) throw new Error('write in preview')
        if (++inserts === this.failAt) throw new Error('injected failure')
        const rows = draft[table] ??= []
        const row = { ...structuredClone(data), id: rows.length + 1 }
        rows.push(row)
        return row
      },
    })
    if (!readOnly && !this.discardCommit) this.rows = draft
    return result as T
  }
  async receipt(id: string) { return this.rows['import-runs']?.find(row => row.packageId === id) ?? null }
}
describe('restricted transactional import', () => {
  it('keeps distinct intake records and shared artifacts; reruns are idempotent', async () => {
    const store = new MemoryStore(), p = fixture()
    await importPackage(p, store, 'apply')
    expect(store.rows.content).toHaveLength(2)
    for (const row of store.rows.content!) expect(row).toMatchObject({ state: 'intake', accessProfile: null, acceptedTags: [], passages: [] })
    expect(store.rows['import-artifacts']).toHaveLength(1)
    expect(store.rows['source-relations']?.map(r => r.content)).toEqual([1, 2])
    const before = structuredClone(store.rows)
    expect((await importPackage(p, store, 'apply')).alreadyCompleted).toBe(true)
    expect(store.rows).toEqual(before)
  })
  it('stages source changes without overwriting human decisions', async () => {
    const store = new MemoryStore()
    await importPackage(fixture(), store, 'apply')
    Object.assign(store.rows.content![0], { title: 'Reviewed', state: 'published', acceptedTags: [8], accessProfile: 9 })
    const before = structuredClone(store.rows.content)
    const result = await importPackage(fixture('Updated source'), store, 'apply')
    expect(result.counts.stage_source_version_for_review).toBe(2)
    expect(store.rows.content).toEqual(before)
    expect(store.rows['source-snapshots']).toHaveLength(4)
    expect(store.rows['source-snapshots']![2].disposition).toBe('staged-for-review')
  })
  it('rolls back partial writes and retries the whole package', async () => {
    const store = new MemoryStore()
    store.failAt = 5
    await expect(importPackage(fixture(), store, 'apply')).rejects.toThrow('injected failure')
    expect(store.rows).toEqual({})
    store.failAt = Infinity
    await importPackage(fixture(), store, 'apply')
    expect(store.rows.content).toHaveLength(2)
    expect(store.rows['import-runs']).toHaveLength(1)
  })
  it('does not claim success when the commit receipt is missing', async () => {
    const store = new MemoryStore(); store.discardCommit = true
    await expect(importPackage(fixture(), store, 'apply')).rejects.toThrow('commit_not_confirmed')
  })
  it('returns persisted mappings rather than uncommitted IDs from a concurrent attempt', async () => {
    const store = new MemoryStore()
    const receipt = store.receipt.bind(store)
    store.receipt = async id => {
      const row = await receipt(id)
      if (row) { const result = row.result as { mappings: { contentId: number }[] }; result.mappings[0].contentId = 999 }
      return row
    }
    expect((await importPackage(fixture(), store, 'apply')).mappings[0].contentId).toBe(999)
  })
  it('previews without writes and does not restage a known snapshot in another package', async () => {
    const store = new MemoryStore(), p = fixture()
    expect((await importPackage(p, store, 'preview')).counts.create_restricted_intake).toBe(2)
    expect(store.rows).toEqual({})
    await importPackage(p, store, 'apply')
    p.provenance = { anotherSelection: true }; rehash(p)
    expect((await importPackage(p, store, 'apply')).counts.unchanged).toBe(2)
    expect(store.rows['source-snapshots']).toHaveLength(2)
  })
  it('flags an ineligible existing source without archiving or deleting it', async () => {
    const store = new MemoryStore(), p = fixture()
    store.rows.content = [{ id: 20, sourceKey: 'wordpress:dbr:post:99', state: 'published' }]
    p.skipped.push({ sourceKey: 'wordpress:dbr:post:99', reason: 'source_not_eligible', negativeControl: true }); rehash(p)
    await importPackage(p, store, 'apply')
    expect(store.rows.content![0].state).toBe('published')
    expect(store.rows['import-reviews']).toHaveLength(1)
  })
  it('rejects permissive proposals before touching a database', async () => {
    const store = new MemoryStore(), p = fixture()
    Object.assign(p.content[0].initialContent, { state: 'published' }); rehash(p)
    await expect(importPackage(p, store, 'apply')).rejects.toThrow('invalid_package_schema')
    expect(store.calls).toBe(0)
  })
  it('rejects tampered snapshots and missing relationship targets', () => {
    const p = fixture(); p.sourceSnapshots[0].snapshot.raw.post.post_title = 'Tampered'; rehash(p)
    expect(() => validatePackage(p)).toThrow('snapshot_hash_mismatch')
    const q = fixture(); const edge = { ...q.relationships[0], to: 'missing' }; const { id: _, ...rest } = edge
    edge.id = digest(rest); q.relationships[0] = edge; rehash(q)
    expect(() => validatePackage(q)).toThrow('dangling_relationship')
  })
  it('keeps source audit collections immutable through application APIs', async () => {
    for (const collection of [ImportArtifacts, SourceSnapshots, SourceRelations, ImportReviews, ImportRuns]) {
      for (const op of ['create', 'update', 'delete', 'read'] as const) {
        expect(await collection.access![op]!({ req: { user: null } } as never)).toBe(false)
      }
    }
  })
})
describe('package transport', () => {
  it('canonicalizes numeric and Unicode keys in Python order', () => {
    expect(canonical({ '2': 2, '10': 10, '\u{10000}': 3, '\ue000': 4 })).toBe('{"10":10,"2":2,"\ue000":4,"\u{10000}":3}')
  })
  it('requires all checksummed files and rejects modified package bytes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ae-import-test-'))
    try {
      const files: Record<string, string> = {}
      for (const [name, value] of Object.entries({ 'package.json': fixture(), 'summary.json': {}, 'dry-run.json': {} })) {
        const bytes = JSON.stringify(value); files[name] = sha256(bytes); await writeFile(path.join(dir, name), bytes)
      }
      const marker = { schema: 'ae-wordpress-intake/1', files }
      await writeFile(path.join(dir, 'complete.json'), JSON.stringify(marker))
      expect((await loadPackage(dir)).content).toHaveLength(2)
      await writeFile(path.join(dir, 'package.json'), '{}')
      await expect(loadPackage(dir)).rejects.toThrow('artifact_checksum_mismatch')
      delete files['summary.json']; await writeFile(path.join(dir, 'complete.json'), JSON.stringify(marker))
      await expect(loadPackage(dir)).rejects.toThrow('incomplete_package')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
