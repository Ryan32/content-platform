import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { ProcessingError } from './jobs'

export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024
export const THUMBNAIL_WIDTH = 640
type ImageType = { ext: 'jpg' | 'png' | 'webp'; mime: string }

/** Identifies JPEG, PNG and WebP by their bytes; never trusts a file name or declared type. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  if (bytes.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return { ext: 'png', mime: 'image/png' }
  if (bytes.length > 12 && Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' }
  return null
}

/** Immutable storage key for a thumbnail image; the hash doubles as the cache-busting version. */
export function thumbnailObject(contentId: number, bytes: Uint8Array) {
  const type = sniffImage(bytes)
  if (!type || !bytes.length || bytes.length > MAX_THUMBNAIL_BYTES) throw new ProcessingError('invalid_thumbnail')
  const hash = createHash('sha256').update(bytes).digest('hex')
  return { key: `content/${contentId}/thumb-${hash}.${type.ext}`, version: hash.slice(0, 16), mime: type.mime }
}

type VimeoSize = { width?: number; link?: string | null }
/** Smallest Vimeo thumbnail at least THUMBNAIL_WIDTH wide (else the largest), from Vimeo's image CDN only. */
export function pickVimeoPicture(sizes: VimeoSize[]): string | null {
  const usable = sizes.filter(s => typeof s.width === 'number' && typeof s.link === 'string').filter(s => {
    try { const url = new URL(s.link!); return url.protocol === 'https:' && url.hostname === 'i.vimeocdn.com' && !url.username && !url.port } catch { return false }
  }).sort((a, b) => a.width! - b.width!)
  return (usable.find(s => s.width! >= THUMBNAIL_WIDTH) ?? usable.at(-1))?.link ?? null
}

async function limitedBytes(response: Response, limit: number) {
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); throw new ProcessingError('thumbnail_too_large') }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  for (;;) {
    const part = await reader.read(); if (part.done) break
    size += part.value.length
    if (size > limit) { await reader.cancel(); throw new ProcessingError('thumbnail_too_large') }
    chunks.push(part.value)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

/** Downloads a Vimeo video's thumbnail. The bearer token goes only to api.vimeo.com; the image CDN gets no credentials. */
export async function vimeoThumbnail(videoId: string, token: string, fetcher: typeof fetch = fetch): Promise<Uint8Array | null> {
  if (!/^[1-9]\d{0,19}$/.test(videoId)) throw new ProcessingError('vimeo_id_required')
  const meta = await fetcher(`https://api.vimeo.com/videos/${videoId}?fields=pictures.sizes,pictures.active`, {
    redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (meta.status === 404 || meta.status === 403) { await meta.body?.cancel(); return null }
  if (!meta.ok) { await meta.body?.cancel(); throw new ProcessingError(`vimeo_http_${meta.status}`, meta.status >= 500 || meta.status === 429) }
  const body = JSON.parse(Buffer.from(await limitedBytes(meta, 512 * 1024)).toString('utf8')) as { pictures?: { sizes?: VimeoSize[] } }
  const link = pickVimeoPicture(body.pictures?.sizes ?? [])
  if (!link) return null
  const image = await fetcher(link, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
  if (!image.ok) { await image.body?.cancel(); return null }
  const bytes = await limitedBytes(image, MAX_THUMBNAIL_BYTES)
  return sniffImage(bytes) ? bytes : null
}

export interface ThumbnailDeps {
  readOriginal(key: string, sha256: string): Promise<Uint8Array>
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>
  vimeo?(videoId: string): Promise<Uint8Array | null>
  pdf(bytes: Uint8Array): Promise<Uint8Array>
}

/**
 * Creates thumbnails for items without an uploaded cover: the Vimeo thumbnail, else page 1 of the current PDF.
 * `thumbnail_for` records what was attempted so each source is tried once; a new Vimeo ID or PDF retries.
 * Videos wait (without blocking PDFs) until Vimeo access is configured.
 */
export async function syncThumbnails(db: Pool, deps: ThumbnailDeps, batch = 5) {
  const { rows } = await db.query(`SELECT c.id, c.vimeo_id, c.thumbnail_for, pdf.object_key, pdf.sha256 FROM content c
    LEFT JOIN LATERAL (SELECT a.object_key, a.sha256 FROM assets a WHERE a.content_id = c.id AND a.version = c.source_hash
      AND a.mime_type = 'application/pdf' ORDER BY a.id DESC LIMIT 1) pdf ON true
    WHERE COALESCE(c.thumbnail_source::text, '') <> 'upload' AND c.state <> 'archived'
      AND (($2 AND c.vimeo_id ~ '^[1-9][0-9]{0,19}$' AND c.thumbnail_for IS DISTINCT FROM 'vimeo:' || c.vimeo_id)
        OR (COALESCE(c.vimeo_id, '') = '' AND pdf.sha256 IS NOT NULL AND c.thumbnail_for IS DISTINCT FROM 'pdf:' || pdf.sha256))
    ORDER BY c.id LIMIT $1`, [batch, Boolean(deps.vimeo)])
  const results: { id: number; outcome: string }[] = []
  for (const row of rows) {
    const target = row.vimeo_id ? `vimeo:${row.vimeo_id}` : `pdf:${row.sha256}`
    let outcome = 'created'
    try {
      const bytes = row.vimeo_id ? await deps.vimeo!(row.vimeo_id) : await deps.pdf(await deps.readOriginal(row.object_key, row.sha256))
      if (!bytes) throw new ProcessingError('thumbnail_unavailable')
      const object = thumbnailObject(Number(row.id), bytes)
      await deps.put(object.key, bytes, object.mime)
      // Only replace a generated thumbnail; never overwrite a cover an editor uploaded meanwhile.
      await db.query(`UPDATE content SET thumbnail_key = $2, thumbnail_version = $3, thumbnail_source = $4, thumbnail_for = $5
        WHERE id = $1 AND COALESCE(thumbnail_source::text, '') <> 'upload'`, [row.id, object.key, object.version, row.vimeo_id ? 'vimeo' : 'pdf', target])
    } catch (error) {
      outcome = error instanceof ProcessingError ? error.code : 'thumbnail_failed'
      if (!(error instanceof ProcessingError && error.retryable)) await db.query(`UPDATE content SET thumbnail_source = 'unavailable', thumbnail_key = NULL,
        thumbnail_version = NULL, thumbnail_for = $2 WHERE id = $1 AND COALESCE(thumbnail_source::text, '') <> 'upload'`, [row.id, target])
    }
    results.push({ id: Number(row.id), outcome })
  }
  return results
}
