import { assertImport, digest, validatePackage, type IntakePackage } from './package'

export type Table = 'content' | 'import-artifacts' | 'source-snapshots' | 'source-relations' | 'import-reviews' | 'import-runs'
export type Row = Record<string, unknown> & { id: number }
/** There is intentionally no update/delete method: importer cannot patch editorial state. */
export interface Transaction {
  find(table: Table, field: string, value: string): Promise<Row | null>
  insert(table: Table, data: Record<string, unknown>): Promise<Row>
}
export interface ImportStore {
  transaction<T>(operation: (tx: Transaction) => Promise<T>, readOnly: boolean): Promise<T>
  receipt(packageId: string): Promise<Row | null>
}
export interface ImportResult {
  packageId: string; alreadyCompleted: boolean; mode: 'preview' | 'apply';
  counts: Record<string, number>; mappings: { sourceKey: string; contentId: number | null; action: string }[]
}
const snapshotKey = (key: string, hash: string) => digest({ sourceKey: key, sourceHash: hash })

export async function importPackage(input: unknown, store: ImportStore, mode: 'preview' | 'apply'): Promise<ImportResult> {
  // Validate again even for in-process callers. No DB operation precedes validation.
  const p = validatePackage(input)
  assertImport(p.content.length <= 25 && p.relationships.length <= 5000, 'apply_batch_limit')
  const result = await store.transaction(async tx => {
    const done = await tx.find('import-runs', 'packageId', p.packageId)
    if (done) {
      assertImport(done.state === 'completed', 'invalid_completion_receipt')
      return { ...(done.result as ImportResult), alreadyCompleted: true, mode }
    }
    const report: ImportResult = { packageId: p.packageId, alreadyCompleted: false, mode, counts: {}, mappings: [] }
    const count = (key: string) => { report.counts[key] = (report.counts[key] ?? 0) + 1 }
    const snapshotIndex = new Map(p.sourceSnapshots.map(s => [s.sourceKey, s]))
    for (const item of p.content) {
      let target = await tx.find('content', 'sourceKey', item.sourceKey)
      const key = snapshotKey(item.sourceKey, item.sourceHash)
      const previous = await tx.find('source-snapshots', 'key', key)
      assertImport(!previous || (target && Number(previous.content) === target.id), 'snapshot_target_mismatch')
      const action = previous ? 'unchanged' : target ? 'stage_source_version_for_review' : 'create_restricted_intake'
      count(action)
      if (mode === 'apply' && !previous) {
        const existed = Boolean(target)
        if (!target) {
          // Explicit allowlist; never spread transport JSON into a privileged write.
          const s = item.initialContent
          target = await tx.insert('content', { sourceKey: item.sourceKey, sourceHash: item.sourceHash,
            title: s.title, description: s.description, body: s.body, format: s.format,
            ...(s.vimeoId ? { vimeoId: s.vimeoId } : {}), state: 'intake', accessProfile: null,
            ...(s.originalPublishedAt ? { originalPublishedAt: s.originalPublishedAt } : {}),
            ...(s.originalUpdatedAt ? { originalUpdatedAt: s.originalUpdatedAt } : {}),
            acceptedTags: [], evidenceVersion: 'unprocessed', passages: [],
          })
        }
        const snapshot = await tx.insert('source-snapshots', { key, content: target.id,
          sourceKey: item.sourceKey, sourceHash: item.sourceHash, packageId: p.packageId,
          disposition: existed ? 'staged-for-review' : 'initial-intake',
          snapshot: snapshotIndex.get(item.sourceKey)!.snapshot, proposedContent: item.initialContent, issues: item.issues,
        })
        count('snapshotsCreated')
        for (const edge of p.relationships.filter(e => e.from === item.sourceKey)) {
          const artifact = artifactFor(p, edge)
          let artifactRow: Row | null = null
          if (artifact) {
            const artifactKey = digest(artifact)
            artifactRow = await tx.find('import-artifacts', 'key', artifactKey)
            if (!artifactRow) {
              artifactRow = await tx.insert('import-artifacts', { key: artifactKey, ...artifact })
              count('artifactsCreated')
            }
          }
          await tx.insert('source-relations', { key: digest({ snapshotKey: key, edgeId: edge.id }),
            content: target.id, snapshot: snapshot.id, ...(artifactRow ? { artifact: artifactRow.id } : {}),
            targetSourceKey: edge.to, kind: edge.kind, status: edge.status, edge,
          })
          count('relationshipsCreated')
        }
      }
      report.mappings.push({ sourceKey: item.sourceKey, contentId: target?.id ?? null, action })
    }
    for (const skipped of p.skipped.filter(s => s.reason === 'source_not_eligible')) {
      const target = await tx.find('content', 'sourceKey', skipped.sourceKey)
      if (!target) continue
      count('review_existing_source_ineligible')
      if (mode === 'apply') await tx.insert('import-reviews', { key: digest({ packageId: p.packageId, sourceKey: skipped.sourceKey }),
        content: target.id, packageId: p.packageId, reason: 'source-ineligible', sourceEvidence: skipped })
    }
    if (mode === 'apply') await tx.insert('import-runs', { key: p.packageId, packageId: p.packageId,
      state: 'completed', provenance: p.provenance, result: report })
    return report
  }, mode === 'preview')
  if (mode === 'apply') {
    // Payload 3.94's commit implementation can suppress driver errors. A fresh
    // authoritative read proves the transaction's completion marker is durable.
    const persisted = await store.receipt(p.packageId)
    assertImport(persisted?.state === 'completed' && persisted.packageId === p.packageId, 'commit_not_confirmed')
    // A concurrent attempt may have committed after ours lost serialization.
    // Return only durable mappings, never this attempt's provisional row IDs.
    const durable = persisted.result as ImportResult
    assertImport(durable?.packageId === p.packageId && Array.isArray(durable.mappings), 'invalid_completion_receipt')
    return { ...durable, mode, alreadyCompleted: result.alreadyCompleted }
  }
  return result
}

function artifactFor(p: IntakePackage, edge: IntakePackage['relationships'][number]) {
  let kind: string, data: Record<string, unknown> | undefined
  if (edge.kind === 'asset') {
    kind = 'blob'
    const blob = p.blobs.find(b => b.id === edge.to)!
    // Locations belong to source snapshots; one byte blob can appear at many paths.
    data = { id: blob.id, sha256: blob.sha256, bytes: blob.bytes, delivery: 'not_uploaded' }
  } else if (edge.kind === 'vimeo') { kind = 'vimeo'; data = p.providerAssets.find(v => v.id === edge.to) }
  else if (edge.kind === 'taxonomy') { kind = 'taxonomy'; data = p.sourceTaxonomy.find(t => t.id === edge.to) }
  else if (edge.kind === 'attachment' && edge.status === 'captured') {
    kind = 'attachment'
    data = p.sourceSnapshots.find(s => s.sourceKey === edge.from)!.snapshot.attachments.find(a => `wordpress:dbr:attachment:${a.source_id}` === edge.to)
  } else if (edge.kind === 'asset-reference') {
    kind = 'reference'
    const assets = p.sourceSnapshots.find(s => s.sourceKey === edge.from)!.snapshot.manifest.assets as Record<string, unknown>[]
    data = assets.find(a => `reference:${digest(a)}` === edge.to)
  } else return null
  assertImport(data, 'artifact_metadata_missing')
  return { identity: edge.to, kind, data }
}
