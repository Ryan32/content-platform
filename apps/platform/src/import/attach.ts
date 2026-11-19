import { z } from 'zod'
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
  createAsset(data: { content: number; objectKey: string; sha256: string; mimeType: string; version: string; fileName: string; role: 'download' | 'inline'; bytes: number }): Promise<number>
  /** Sets the item's cover to an already-copied image unless an editor uploaded one. Returns whether it was set. */
  cover(contentId: number, key: string, version: string): Promise<boolean>
}
const COVER_TYPES = new Set(['jpg', 'jpeg', 'png', 'webp'])
const MAX_COVER_BYTES = 5 * 1024 * 1024

/** WordPress stores URL-encoded names (e.g. "Guide%20v2.pdf"); keep a clean, bounded display name. */
export function decodeName(name: string) {
  let decoded = name
  try { decoded = decodeURIComponent(name) } catch { /* keep as stored */ }
  return decoded.replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'file'
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
    const all = p.relationships.filter(e => e.from === item.sourceKey && e.kind === 'asset')
    if (!all.length) continue
    // The WordPress featured image becomes the cover; it is a source to read only if the post also uses it elsewhere.
    const featured = all.find(e => e.field === 'featured_image')
    const edges = all.filter(e => e.field !== 'featured_image' || all.some(o => o.to === e.to && o.field !== 'featured_image'))
    const target = await deps.content(item.sourceKey)
    if (!target) { count('item_not_imported'); continue }
    if (target.sourceHash !== item.sourceHash) { count('item_version_changed_skipped'); continue }
    if (featured) {
      const blob = blobs.get(featured.to)
      assertImport(blob, 'missing_blob')
      const { ext, file } = blobFile(blob)
      if (!COVER_TYPES.has(ext) || blob.bytes > MAX_COVER_BYTES) count('cover_skipped_type_or_size')
      else {
        const key = `content/${target.id}/thumb-${blob.sha256}.${ext === 'jpeg' ? 'jpg' : ext}`
        await deps.copy(file, key, blob.bytes)
        count(await deps.cover(target.id, key, blob.sha256.slice(0, 16)) ? 'cover_set' : 'cover_kept_editor_upload')
      }
    }
    // The file's real name on this page: from the path this post used (the same bytes can carry other names elsewhere).
    const snapshot = p.sourceSnapshots.find(s => s.sourceKey === item.sourceKey)!.snapshot
    const nameOn = (sha: string, fallback: string) => {
      const path = Object.entries(snapshot.verifiedFiles).find(([, f]) => f.sha256 === sha)?.[0] ?? fallback
      return decodeName(path.split('/').pop() ?? fallback)
    }
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
      // Pictures used inside the article are part of the page, not downloads; files attached to the record are downloads.
      const fields = edges.filter(e => e.to === sha).map(e => e.field)
      const role = isImage(ext) && !fields.includes('__wpdm_files') ? 'inline' as const : 'download' as const
      await deps.createAsset({ content: target.id, objectKey: key, sha256: blob.sha256, mimeType, version: item.sourceHash,
        fileName: nameOn(blob.sha256, file), role, bytes: blob.bytes })
      count('asset_created')
    }
  }
  return { packageId: p.packageId, counts }
}

/** Media the WordPress page embedded from AE's Widen library, fetched by scripts/fetch_external_media.py. */
export const externalMedia = z.object({
  schema: z.literal('ae-external-media/1'), packageId: z.string().min(1),
  items: z.array(z.object({ sourceKey: z.string().min(1), sourceHash: z.string().min(1), field: z.string().max(200), reference: z.string().max(2000),
    fileName: z.string().min(1).max(200), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive(),
    ext: z.string().regex(/^[a-z0-9]{1,8}$/) }).strict()).max(5000),
  skipped: z.array(z.unknown()).optional(),
}).strict()

/**
 * Attaches fetched external media to the package's items, with the same rules as attachFiles: only the item version
 * this package imported, immutable content keys, existing assets reused, unsupported or oversized files skipped.
 * Audio and video become playable files (and are transcribed); pictures stay with the page.
 */
export async function attachExternal(input: unknown, sidecar: unknown, deps: AttachDeps) {
  const p = validatePackage(input)
  const media = externalMedia.parse(sidecar)
  assertImport(media.packageId === p.packageId, 'external_media_package_mismatch')
  const counts: Record<string, number> = {}
  const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1 }
  for (const entry of media.items) {
    const item = p.content.find(c => c.sourceKey === entry.sourceKey)
    assertImport(item && item.sourceHash === entry.sourceHash, 'external_media_item_mismatch')
    const target = await deps.content(entry.sourceKey)
    if (!target) { count('item_not_imported'); continue }
    if (target.sourceHash !== item.sourceHash) { count('item_version_changed_skipped'); continue }
    const mimeType = ATTACH_TYPES[entry.ext]
    if (!mimeType) { count(`skipped_unsupported_${entry.ext}`); continue }
    if (entry.bytes > MAX_BYTES[entry.ext]) { count(`skipped_too_large_${entry.ext}`); continue }
    if (isImage(entry.ext) && entry.ext !== 'svg' && entry.bytes < MIN_IMAGE_BYTES) { count('skipped_icon'); continue }
    if (await deps.asset(target.id, entry.sha256, item.sourceHash)) { count('external_asset_existing'); continue }
    const file = `${entry.sha256}.${entry.ext}`, key = `content/${target.id}/${file}`
    count(`external_object_${await deps.copy(file, key, entry.bytes)}`)
    await deps.createAsset({ content: target.id, objectKey: key, sha256: entry.sha256, mimeType, version: item.sourceHash,
      fileName: decodeName(entry.fileName), role: isImage(entry.ext) ? 'inline' : 'download', bytes: entry.bytes })
    count('external_asset_created')
  }
  return { packageId: p.packageId, counts }
}
