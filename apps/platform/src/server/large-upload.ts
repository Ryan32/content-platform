import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'
import { MAX_DOCUMENT_BYTES } from '../processing/storage'
import { MAX_BYTES } from '../processing/formats'
import { UPLOAD_TYPES, UploadError, cleanFileName, formatFor, titleFromFileName, type ContentDoc } from './processing'

/**
 * Files over 50 MB go from the browser straight to a private S3 staging key with a short-lived signed PUT (exact size,
 * type, encryption and uploader are signed, so none can be changed). The worker then fingerprints the bytes, moves them
 * to the item's immutable `content/<id>/<sha256>.<ext>` key and registers the file; processing follows as usual.
 * Audio/video up to 2 GB (Amazon Transcribe), PDFs up to 500 MB (Amazon Textract), Office files and zips up to 200 MB.
 */
export const LARGE_LIMITS: Record<string, number> = Object.fromEntries(Object.entries(MAX_BYTES).filter(([, limit]) => limit > MAX_DOCUMENT_BYTES))
export const STAGING_PREFIX = 'uploads/'
export const stagingKey = (contentId: number, extension: string) => `${STAGING_PREFIX}${contentId}/${randomUUID()}.${extension}`
export const STAGING_KEY = /^uploads\/(\d+)\/([0-9a-f-]{36})\.([a-z0-9]{2,5})$/

export function checkLargeFile(name: string, size: number) {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  const limit = LARGE_LIMITS[extension]
  if (!limit) throw new UploadError(413, 'This type of file must be 50 MB or smaller.')
  if (!Number.isSafeInteger(size) || size <= MAX_DOCUMENT_BYTES || size > limit)
    throw new UploadError(413, `This type of file can be up to ${limit >= 1024 ** 3 ? `${limit / 1024 ** 3} GB` : `${limit / 1024 ** 2} MB`}.`)
  return extension
}

/** Signs one staging PUT for an existing Intake/Draft item. */
export async function signLargeUpload(payload: Payload, userId: number | string, contentId: number, name: string, size: number, client = new S3Client({})) {
  const bucket = process.env.CONTENT_BUCKET
  if (!bucket) throw new UploadError(503, 'File storage is not configured.')
  const extension = checkLargeFile(name, size)
  const content = await payload.findByID({ collection: 'content', id: contentId, depth: 0, overrideAccess: true, disableErrors: true }) as ContentDoc | null
  if (!content) throw new UploadError(404, 'Library item not found.')
  if (!['intake', 'draft'].includes(content.state)) throw new UploadError(409, 'Files can only be added while the item is in Intake or Draft.')
  // The original name travels as signed, URL-encoded metadata (S3 metadata must be ASCII).
  const fileName = encodeURIComponent(cleanFileName(name) ?? `upload.${extension}`)
  const headers = { 'Content-Type': UPLOAD_TYPES[extension], 'x-amz-server-side-encryption': 'AES256', 'x-amz-meta-uploaded-by': String(userId), 'x-amz-meta-file-name': fileName }
  const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: stagingKey(contentId, extension), ContentLength: size,
    ContentType: headers['Content-Type'], ServerSideEncryption: 'AES256', Metadata: { 'uploaded-by': String(userId), 'file-name': fileName } }),
  { expiresIn: 3600, signableHeaders: new Set(['content-type', 'content-length']),
    // Sent as headers by the browser (not hoisted into the query string) so S3 enforces them on the PUT.
    unhoistableHeaders: new Set(['x-amz-server-side-encryption', 'x-amz-meta-uploaded-by', 'x-amz-meta-file-name']) })
  return { url, headers, contentId }
}

/** Creates the Intake item first (Add content / Bulk add), then signs its upload. */
export async function createItemForLargeUpload(payload: Payload, user: { id: number | string }, name: string, size: number, title?: string) {
  checkLargeFile(name, size)
  const format = formatFor(name)
  const item = await payload.create({ collection: 'content', overrideAccess: false, user: { ...user, collection: 'users' } as never, depth: 0, draft: false,
    data: { title: (title?.trim() || titleFromFileName(name)).slice(0, 200), format: format as never, evidenceVersion: 'unprocessed' } } as never) as { id: number }
  return signLargeUpload(payload, user.id, item.id, name, size)
}

/** Large uploads received but not yet moved into place by the worker (shown on the item's Processing panel). */
export async function pendingLargeUploads(contentId: number, client = new S3Client({})) {
  if (!process.env.CONTENT_BUCKET) return 0
  try {
    const list = await client.send(new ListObjectsV2Command({ Bucket: process.env.CONTENT_BUCKET, Prefix: `${STAGING_PREFIX}${contentId}/`, MaxKeys: 20 }))
    return list.KeyCount ?? 0
  } catch { return 0 }
}
