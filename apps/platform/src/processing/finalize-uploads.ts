import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { STAGING_KEY, STAGING_PREFIX, LARGE_LIMITS } from '../server/large-upload'
import { UPLOAD_TYPES } from '../server/processing'

/**
 * Worker step for large uploads. For each staged object: stream and fingerprint every byte (no buffering), copy it to
 * the item's immutable `content/<id>/<sha256>.<ext>` key with the fingerprint recorded, register it as the item's file
 * (same rules as a direct upload), then delete the staging object. Idempotent: a crash at any point is repaired by the
 * next pass. Invalid or unacceptable uploads are deleted and reported by fixed code.
 */
export interface FinalizeDeps {
  list(): Promise<string[]>
  head(key: string): Promise<{ size: number; uploadedBy: string | null; fileName?: string | null }>
  /** Streams the object, returning its SHA-256 and its first bytes. */
  hash(key: string): Promise<{ sha256: string; head: Uint8Array }>
  copy(from: string, to: string, sha256: string, contentType: string): Promise<void>
  remove(key: string): Promise<void>
  register(contentId: number, object: { key: string; hash: string }, extension: string, fileName?: string, bytes?: number): Promise<void>
}
export type FinalizeResult = { key: string; status: 'registered' | 'rejected'; code?: string }

export async function finalizeUploads(deps: FinalizeDeps): Promise<FinalizeResult[]> {
  const results: FinalizeResult[] = []
  for (const key of await deps.list()) {
    const reject = async (code: string) => { await deps.remove(key); results.push({ key, status: 'rejected', code }) }
    const match = STAGING_KEY.exec(key)
    if (!match || !UPLOAD_TYPES[match[3]] || !LARGE_LIMITS[match[3]]) { await reject('invalid_staging_key'); continue }
    const contentId = Number(match[1]), extension = match[3]
    const head = await deps.head(key)
    if (!head.uploadedBy) { await reject('unsigned_upload'); continue }
    if (!head.size || head.size > LARGE_LIMITS[extension]) { await reject('input_size_limit'); continue }
    const { sha256, head: first } = await deps.hash(key)
    if (extension === 'pdf' && !Buffer.from(first.subarray(0, 1024)).includes('%PDF-')) { await reject('invalid_pdf'); continue }
    const target = `content/${contentId}/${sha256}.${extension}`
    await deps.copy(key, target, sha256, UPLOAD_TYPES[extension])
    let fileName: string | undefined
    try { fileName = head.fileName ? decodeURIComponent(head.fileName) : undefined } catch { fileName = undefined }
    try { await deps.register(contentId, { key: target, hash: sha256 }, extension, fileName, head.size) } catch (error) {
      // Item gone or no longer Intake/Draft: the upload cannot be attached. The copied original stays immutable and unused.
      const status = (error as { status?: number }).status
      if (status === 404 || status === 409 || status === 415) { await reject(status === 404 ? 'item_not_found' : 'item_not_editable'); continue }
      throw error
    }
    await deps.remove(key)
    results.push({ key, status: 'registered' })
  }
  return results
}

const notFound = (e: unknown) => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404
const conflict = (e: unknown) => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412

export function s3FinalizeDeps(s3: S3Client, bucket: string, register: FinalizeDeps['register']): FinalizeDeps {
  return {
    list: async () => ((await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: STAGING_PREFIX, MaxKeys: 10 }))).Contents ?? [])
      .map(o => o.Key!).filter(Boolean),
    head: async key => {
      const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return { size: h.ContentLength ?? 0, uploadedBy: h.Metadata?.['uploaded-by'] ?? null, fileName: h.Metadata?.['file-name'] ?? null }
    },
    hash: async key => {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (!object.Body) throw new Error('empty_object')
      const digest = createHash('sha256'), reader = object.Body.transformToWebStream().getReader()
      let first = new Uint8Array()
      for (;;) {
        const part = await reader.read(); if (part.done) break
        if (first.length < 1024) first = new Uint8Array([...first, ...part.value.subarray(0, 1024 - first.length)])
        digest.update(part.value)
      }
      return { sha256: digest.digest('hex'), head: first }
    },
    copy: async (from, to, sha256, contentType) => {
      try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: to })); return } catch (e) { if (!notFound(e)) throw e }
      await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: to, CopySource: `${bucket}/${from}`, MetadataDirective: 'REPLACE',
        Metadata: { sha256 }, ContentType: contentType, ServerSideEncryption: 'AES256', IfNoneMatch: '*' })).catch(e => { if (!conflict(e)) throw e })
    },
    remove: async key => { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })) },
    register,
  }
}
