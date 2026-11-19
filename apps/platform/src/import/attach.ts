import { assertImport, validatePackage } from './package'
import { MAX_BYTES, MIME_TYPES, isImage } from '../processing/formats'

/**
 * Attaches an imported package's verified file bytes to their library items so the normal processing pipeline
 * (extraction / transcription -> AI analysis -> Review) picks them up exactly like a manual upload.
 *
 * Bytes are pre-uploaded by the operator to `imports/files/<sha256>.<ext>`; this copies each into the item's immutable
 * `content/<id>/<sha256>.<ext>` key and records an asset row for the item's current source version. Idempotent: an
 * existing object or asset row is reused. Items whose current source version differs from the package (a staged
 * change awaiting review) are skipped, never overwritten. Only processable types are attached.
 */
export const ATTACH_TYPES: Record<string, string> = MIME_TYPES
/** Raster images under this size are icons, bullets and spacers: not worth AI vision. */
export const MIN_IMAGE_BYTES = 8 * 1024

export interface AttachDeps {
  content(sourceKey: string): Promise<{ id: number; sourceHash: string | null } | null>
  /** Copies imports/files/<file> to the destination key unless it already exists; verifies size. */
  copy(file: string, key: string, bytes: number): Promise<'copied' | 'existing'>
  asset(contentId: number, sha256: string, version: string): Promise<number | null>
  createAsset(data: { content: number; objectKey: string; sha256: string; mimeType: string; version: string }): Promise<number>
}

export function blobFile(blob: { sha256: string; localPaths: string[] }) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(blob.localPaths[0] ?? '')
  const ext = match ? match[1].toLowerCase() : 'bin'
  return { ext, file: `${blob.sha256}.${ext}` }
}

export async function attachFiles(input: unknown, deps: AttachDeps) {
  const p = validatePackage(input)
  const counts: Record<string, number> = {}
  const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1 }
  const blobs = new Map(p.blobs.map(b => [b.id, b]))
  for (const item of p.content) {
    const edges = p.relationships.filter(e => e.from === item.sourceKey && e.kind === 'asset')
    if (!edges.length) continue
    const target = await deps.content(item.sourceKey)
    if (!target) { count('item_not_imported'); continue }
    if (target.sourceHash !== item.sourceHash) { count('item_version_changed_skipped'); continue }
    for (const sha of new Set(edges.map(e => e.to))) {
      const blob = blobs.get(sha)
      assertImport(blob, 'missing_blob')
      const { ext, file } = blobFile(blob)
      const mimeType = ATTACH_TYPES[ext]
      if (!mimeType) { count(`skipped_unsupported_${ext}`); continue }
      if (blob.bytes > MAX_BYTES[ext]) { count(`skipped_too_large_${ext}`); continue }
      if (isImage(ext) && ext !== 'svg' && blob.bytes < MIN_IMAGE_BYTES) { count('skipped_icon'); continue }
      if (await deps.asset(target.id, blob.sha256, item.sourceHash)) { count('asset_existing'); continue }
      const key = `content/${target.id}/${file}`
      count(`object_${await deps.copy(file, key, blob.bytes)}`)
      await deps.createAsset({ content: target.id, objectKey: key, sha256: blob.sha256, mimeType, version: item.sourceHash })
      count('asset_created')
    }
  }
  return { packageId: p.packageId, counts }
}
