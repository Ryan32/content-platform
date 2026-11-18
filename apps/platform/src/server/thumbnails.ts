import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getPayload, type Payload } from 'payload'
import config from '../payload.config'
import { editorContext } from './editor'
import { readerLibrary } from './library'
import { MAX_THUMBNAIL_BYTES, thumbnailObject } from '../processing/thumbnails'
import { ProcessingError } from '../processing/jobs'

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

/**
 * GET /thumbnails/:id — streams an item's thumbnail after the same checks as viewing the item:
 * editors see any item; readers only items they may view. Never exposes storage keys or signed URLs.
 */
export async function serveThumbnail(request: Request, id: string) {
  if (!/^\d+$/.test(id) || !process.env.CONTENT_BUCKET) return notFound()
  const staff = await editorContext(request.headers).catch(() => null)
  let payload = staff?.payload
  if (!staff) {
    const { repository } = await readerLibrary(request.headers).catch(() => ({ repository: null }))
    if (!repository || !await repository.get(id, 'view')) return notFound()
    payload = await getPayload({ config })
  }
  if (!payload) return notFound()
  const doc = await payload.findByID({ collection: 'content', id: Number(id), overrideAccess: true, depth: 0, disableErrors: true }) as { thumbnailKey?: string | null } | null
  if (!doc?.thumbnailKey || !/^content\/\d+\/thumb-[a-f0-9]{64}\.(jpg|png|webp)$/.test(doc.thumbnailKey)) return notFound()
  try {
    const object = await new S3Client({}).send(new GetObjectCommand({ Bucket: process.env.CONTENT_BUCKET, Key: doc.thumbnailKey }))
    if (!object.Body || (object.ContentLength ?? 0) > MAX_THUMBNAIL_BYTES) return notFound()
    const ext = doc.thumbnailKey.split('.').pop()
    return new Response(object.Body.transformToWebStream(), { headers: {
      'Content-Type': ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
      // Versioned URLs (?v=) change whenever the image changes; private so shared caches never hold it.
      'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } })
  } catch { return notFound() }
}

/** Stores an editor-uploaded cover image (JPEG/PNG/WebP up to 5 MB) and makes it the item's thumbnail. */
export async function setCoverImage(payload: Payload, contentId: number, file: File, client = new S3Client({})) {
  if (!process.env.CONTENT_BUCKET) throw new ProcessingError('content_bucket_required')
  if (!file.size || file.size > MAX_THUMBNAIL_BYTES) throw new ProcessingError('invalid_thumbnail')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const object = thumbnailObject(contentId, bytes)
  const exists = await payload.findByID({ collection: 'content', id: contentId, overrideAccess: true, depth: 0, disableErrors: true })
  if (!exists) throw new ProcessingError('not_found')
  await client.send(new PutObjectCommand({ Bucket: process.env.CONTENT_BUCKET, Key: object.key, Body: bytes, ContentType: object.mime, ServerSideEncryption: 'AES256' }))
  await setThumbnailFields(payload, contentId, { thumbnail_key: object.key, thumbnail_version: object.version, thumbnail_source: 'upload', thumbnail_for: 'upload' })
  return { version: object.version }
}

/** Removes an uploaded cover; the worker then recreates an automatic thumbnail if one is available. */
export async function clearCoverImage(payload: Payload, contentId: number) {
  await setThumbnailFields(payload, contentId, { thumbnail_key: null, thumbnail_version: null, thumbnail_source: null, thumbnail_for: null })
}

// Thumbnail columns are system-managed (no admin edits, no version entry, no evidence invalidation), so write them directly.
async function setThumbnailFields(payload: Payload, contentId: number, values: Record<string, string | null>) {
  const pool = (payload.db as unknown as { pool: { query: (sql: string, params: unknown[]) => Promise<unknown> } }).pool
  await pool.query(`UPDATE content SET thumbnail_key = $2, thumbnail_version = $3, thumbnail_source = $4, thumbnail_for = $5 WHERE id = $1`,
    [contentId, values.thumbnail_key, values.thumbnail_version, values.thumbnail_source, values.thumbnail_for])
}
