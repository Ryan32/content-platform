import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { ProcessingError } from './jobs'

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
export function contentKey(key: string) {
  if (!/^content\/[A-Za-z0-9/_-]+(?:\.[A-Za-z0-9]+)?$/.test(key)) throw new ProcessingError('invalid_content_key')
  return key
}
export async function readOriginal(client: S3Client, bucket: string, key: string, expectedHash: string) {
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: contentKey(key) }))
  if (!object.Body || (object.ContentLength ?? 0) > MAX_DOCUMENT_BYTES) throw new ProcessingError('input_size_limit')
  const stream = object.Body.transformToWebStream().getReader(); const chunks: Uint8Array[] = []; let bytes = 0
  while (true) { const part = await stream.read(); if (part.done) break; bytes += part.value.length
    if (bytes > MAX_DOCUMENT_BYTES) { await stream.cancel(); throw new ProcessingError('input_size_limit') }; chunks.push(part.value) }
  const result = Buffer.concat(chunks)
  if (createHash('sha256').update(result).digest('hex') !== expectedHash) throw new ProcessingError('source_hash_mismatch')
  return result
}
export async function stageOriginal(client: S3Client, bucket: string, content: number, data: Uint8Array, extension: string) {
  if (!data.length || data.length > MAX_DOCUMENT_BYTES || !/^(pdf|docx|pptx|xlsx|vtt|txt|mp3|mp4|wav|flac|m4a|ogg|webm)$/.test(extension)) throw new ProcessingError('invalid_upload')
  const hash = createHash('sha256').update(data).digest('hex')
  const key = contentKey(`content/${content}/${hash}.${extension}`)
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ChecksumSHA256: Buffer.from(hash, 'hex').toString('base64'),
    ServerSideEncryption: 'AES256', Metadata: { sha256: hash }, IfNoneMatch: '*' })).catch(error => {
    // Existing immutable key is re-read and hashed below; never silently trust an object collision.
    if (error?.$metadata?.httpStatusCode !== 412) throw error
  })
  await readOriginal(client, bucket, key, hash)
  return { key, hash }
}

/** Size and recorded fingerprint of a stored original, without reading it (large media and PDFs). */
export async function storedObject(client: S3Client, bucket: string, key: string) {
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: contentKey(key) }))
  return { size: head.ContentLength ?? 0, sha256: head.Metadata?.sha256 ?? null }
}
/**
 * Verifies an original before paid processing. Small files are re-hashed; large ones (streamed in by the upload
 * finalizer, which hashed every byte and recorded it) must carry the matching recorded fingerprint and fit the limit.
 */
export async function verifyOriginal(client: S3Client, bucket: string, key: string, expectedHash: string, limit: number) {
  const stored = await storedObject(client, bucket, key)
  if (!stored.size || stored.size > limit) throw new ProcessingError('input_size_limit')
  if (stored.size <= MAX_DOCUMENT_BYTES) { await readOriginal(client, bucket, key, expectedHash); return stored }
  if (stored.sha256 !== expectedHash) throw new ProcessingError('source_hash_mismatch')
  return stored
}
