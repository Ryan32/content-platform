import { describe, expect, it } from 'vitest'
import { digest, sha256, type IntakePackage } from '../src/import/package'
import { attachFiles, blobFile, type AttachDeps } from '../src/import/attach'

function fixture(): IntakePackage {
  const pdf = sha256('pdf bytes'), jpg = sha256('jpg bytes')
  const p: IntakePackage = { schema: 'ae-wordpress-intake/1', packageId: '', provenance: { sourceSystem: 'wordpress' }, content: [], sourceSnapshots: [],
    blobs: [{ id: `sha256:${pdf}`, sha256: pdf, bytes: 9, localPaths: ['wp-content/uploads/Guide.PDF'], delivery: 'not_uploaded' },
      { id: `sha256:${jpg}`, sha256: jpg, bytes: 9, localPaths: ['wp-content/uploads/photo.jpg'], delivery: 'not_uploaded' }],
    providerAssets: [], sourceTaxonomy: [], relationships: [], skipped: [] }
  for (const id of [1, 2]) {
    const sourceKey = `wordpress:dbr:post:${id}`
    const snapshot = { sourceKey, raw: { post: { ID: String(id) }, metadata: [] }, manifest: { assets: [] }, attachments: [],
      verifiedFiles: { 'wp-content/uploads/Guide.PDF': { sha256: pdf, bytes: 9 }, 'wp-content/uploads/photo.jpg': { sha256: jpg, bytes: 9 } } }
    const sourceHash = digest(snapshot)
    p.sourceSnapshots.push({ sourceKey, sourceHash, snapshot })
    p.content.push({ sourceKey, sourceHash, selectionReason: 'test', descriptionSource: null, formats: ['pdf'], issues: [],
      policy: { resolution: 'restricted_intake_pending_policy_mapping', grants: [] },
      initialContent: { sourceKey, sourceHash, title: 'T', description: '', body: 'B', format: 'pdf', state: 'intake', accessProfile: null, acceptedTags: [], evidenceVersion: 'unprocessed', passages: [] } })
    for (const blob of p.blobs) { const edge = { from: sourceKey, to: blob.id, kind: 'asset' as const, field: 'body', status: 'verified_local' }; p.relationships.push({ ...edge, id: digest(edge) }) }
  }
  const { packageId: _, ...rest } = p; p.packageId = digest(rest)
  return p
}

function memory(versions: Record<string, string | null>) {
  const covers: { id: number; key: string; version: string }[] = [], editorCovers = new Set<number>()
  const objects = new Set<string>(), assets: { content: number; sha256: string; version: string; objectKey: string; mimeType: string }[] = []
  const ids: Record<string, number> = { 'wordpress:dbr:post:1': 11, 'wordpress:dbr:post:2': 12 }
  const deps: AttachDeps = {
    content: async key => key in versions ? { id: ids[key], sourceHash: versions[key] } : null,
    copy: async (_file, key) => { if (objects.has(key)) return 'existing'; objects.add(key); return 'copied' },
    asset: async (c, s, v) => assets.findIndex(a => a.content === c && a.sha256 === s && a.version === v) + 1 || null,
    createAsset: async data => { assets.push(data); return assets.length },
    cover: async (id, key, version) => { if (editorCovers.has(id)) return false; covers.push({ id, key, version }); return true },
  }
  return { deps, objects, assets, covers, editorCovers }
}

describe('import file attach', () => {
  it('attaches processable files per item, skips images, and reruns without duplicates', async () => {
    const p = fixture()
    const m = memory({ [p.content[0].sourceKey]: p.content[0].sourceHash, [p.content[1].sourceKey]: p.content[1].sourceHash })
    const first = await attachFiles(p, m.deps)
    expect(first.counts).toMatchObject({ asset_created: 2, object_copied: 2, skipped_icon: 2 })  // 9-byte "photo" is an icon
    // Same bytes on two articles stay two separate item files.
    expect(m.assets.map(a => a.objectKey)).toEqual([`content/11/${p.blobs[0].sha256}.pdf`, `content/12/${p.blobs[0].sha256}.pdf`])
    expect(m.assets.every(a => a.mimeType === 'application/pdf')).toBe(true)
    const again = await attachFiles(p, m.deps)
    expect(again.counts).toMatchObject({ asset_existing: 2 })
    expect(m.assets).toHaveLength(2)
  })
  it('never attaches to an item whose source version changed or that was not imported', async () => {
    const p = fixture()
    const m = memory({ [p.content[0].sourceKey]: 'different-version' })
    const result = await attachFiles(p, m.deps)
    expect(result.counts).toEqual({ item_version_changed_skipped: 1, item_not_imported: 1 })
    expect(m.assets).toHaveLength(0)
  })
  it('makes the WordPress featured image the cover (not a source to read), and never replaces an editor cover', async () => {
    const p = fixture()
    const photo = { id: `sha256:${'d'.repeat(64)}`, sha256: 'd'.repeat(64), bytes: 76540, localPaths: ['wp-content/uploads/2026/08/Featured.JPG'], delivery: 'not_uploaded' as const }
    p.blobs.push(photo)
    for (const item of p.content) { const edge = { from: item.sourceKey, to: photo.id, kind: 'asset' as const, field: 'featured_image', status: 'verified_local' }; p.relationships.push({ ...edge, id: digest(edge) }) }
    const { packageId: _, ...rest } = p; p.packageId = digest(rest)
    const m = memory({ [p.content[0].sourceKey]: p.content[0].sourceHash, [p.content[1].sourceKey]: p.content[1].sourceHash })
    m.editorCovers.add(12)
    const result = await attachFiles(p, m.deps)
    expect(m.covers).toEqual([{ id: 11, key: `content/11/thumb-${'d'.repeat(64)}.jpg`, version: 'd'.repeat(16) }])
    expect(result.counts).toMatchObject({ cover_set: 1, cover_kept_editor_upload: 1 })
    expect(m.assets.some(a => a.sha256 === 'd'.repeat(64))).toBe(false)
  })

  it('names files by hash with a safe lowercase extension', () => {
    expect(blobFile({ sha256: 'a'.repeat(64), localPaths: ['x/Report.PDF'] })).toEqual({ ext: 'pdf', file: `${'a'.repeat(64)}.pdf` })
    expect(blobFile({ sha256: 'b'.repeat(64), localPaths: ['x/noext'] }).ext).toBe('bin')
  })
})
