import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetObjectCommand, PutObjectCommand, S3Client, UploadPartCommand } from '@aws-sdk/client-s3'
import { ProcessingError } from './jobs'
import { MAX_DOCUMENT_BYTES } from './storage'
import { createHash } from 'node:crypto'

/** Amazon Transcribe accepts media up to 2 GB; larger renditions stream to S3 instead of being buffered. */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
const PART_BYTES = 16 * 1024 * 1024
const isMp4 = (head: Uint8Array) => head.length >= 12 && Buffer.from(head.subarray(4, 8)).toString('ascii') === 'ftyp'

/** Streams a large download into a private multipart object; per-part SHA-256 checksums; aborts on any failure. */
async function streamToS3(response: Response, s3: S3Client, bucket: string, key: string, limit: number) {
  if (!response.ok || !response.body) throw new ProcessingError('vimeo_download_failed', response.status === 429 || response.status >= 500)
  if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body.cancel(); throw new ProcessingError('media_size_limit') }
  const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: 'video/mp4', ServerSideEncryption: 'AES256', ChecksumAlgorithm: 'SHA256' }))
  if (!UploadId) throw new ProcessingError('vimeo_download_failed', true)
  const reader = response.body.getReader(), parts: { PartNumber: number; ETag?: string; ChecksumSHA256?: string }[] = []
  let pending: Uint8Array[] = [], pendingSize = 0, total = 0
  const flush = async () => {
    const body = Buffer.concat(pending, pendingSize); pending = []; pendingSize = 0
    if (!parts.length && !isMp4(body)) throw new ProcessingError('invalid_mp4')
    const PartNumber = parts.length + 1
    const sent = await s3.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId, PartNumber, Body: body, ChecksumAlgorithm: 'SHA256' }))
    parts.push({ PartNumber, ETag: sent.ETag, ChecksumSHA256: sent.ChecksumSHA256 })
  }
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break
      total += part.value.length
      if (total > limit) { await reader.cancel(); throw new ProcessingError('media_size_limit') }
      pending.push(part.value); pendingSize += part.value.length
      if (pendingSize >= PART_BYTES) await flush()
    }
    if (pendingSize || !parts.length) await flush()
    await s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId, MultipartUpload: { Parts: parts }, IfNoneMatch: '*' }))
  } catch (error) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId })).catch(() => undefined)
    // Another worker finished the same immutable key first: verify and reuse it.
    if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412) return verifyLargeStaged(s3, bucket, key)
    throw error
  }
}
async function verifyLargeStaged(s3: S3Client, bucket: string, key: string) {
  const head = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-11' }))
  const bytes = head.Body ? await head.Body.transformToByteArray() : new Uint8Array()
  if (!isMp4(bytes)) throw new ProcessingError('staged_media_hash_mismatch')
}

const cdnHost = (host: string) => host === 'player.vimeo.com' || ['vimeocdn.com', 'akamaized.net'].some(base => host.endsWith(`.${base}`))
async function bounded(response: Response, limit: number) {
  if (!response.ok || !response.body) throw new ProcessingError('vimeo_download_failed', response.status === 429 || response.status >= 500)
  if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body.cancel(); throw new ProcessingError('media_size_limit') }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length
    if (size > limit) { await reader.cancel(); throw new ProcessingError('media_size_limit') }; chunks.push(part.value) }
  return Buffer.concat(chunks)
}
/** Resolves signed links only in memory. No bearer follows any CDN request/redirect. */
export async function stageVimeoMedia(videoId: string, token: string, bucket: string, jobKey: string, s3 = new S3Client({}), fetcher = fetch) {
  if (!/^\d+$/.test(videoId) || !/^[a-f0-9]{64}$/.test(jobKey)) throw new ProcessingError('invalid_vimeo_identity')
  const key = `processing/vimeo/${jobKey}.mp4`
  try {
    const existing = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    // Large renditions were staged by multipart upload; completed objects only exist once whole. Check the MP4 header.
    if (existing.Body && (existing.ContentLength ?? Infinity) > MAX_DOCUMENT_BYTES && (existing.ContentLength ?? Infinity) <= MAX_MEDIA_BYTES) {
      await existing.Body.transformToWebStream().cancel(); await verifyLargeStaged(s3, bucket, key); return key
    }
    if (!existing.Body || (existing.ContentLength ?? Infinity) > MAX_DOCUMENT_BYTES) throw new ProcessingError('media_size_limit')
    const data = await bounded(new Response(existing.Body.transformToWebStream() as ReadableStream), MAX_DOCUMENT_BYTES)
    if (createHash('sha256').update(data).digest('hex') !== existing.Metadata?.sha256 || data.subarray(4, 8).toString('ascii') !== 'ftyp') throw new ProcessingError('staged_media_hash_mismatch')
    return key
  } catch (error) {
    const value = error as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (value.name !== 'NoSuchKey' && value.$metadata?.httpStatusCode !== 404) throw error
  }
  const response = await fetcher(`https://api.vimeo.com/videos/${videoId}?fields=download`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.vimeo.*+json;version=3.4' }, redirect: 'error', signal: AbortSignal.timeout(20000) })
  const metadata = JSON.parse((await bounded(response, 1024 * 1024)).toString('utf8')) as { download?: { link?: unknown; size?: unknown; type?: unknown }[] }
  const options = (metadata.download ?? []).filter(d => typeof d.link === 'string' && typeof d.size === 'number' && d.size > 0 && d.size <= MAX_MEDIA_BYTES && d.type === 'video/mp4')
    .sort((a, b) => Number(a.size) - Number(b.size))
  if (!options[0]) throw new ProcessingError('authorized_media_unavailable_or_too_large')
  let location = new URL(options[0].link as string), media: Response | undefined
  for (let i = 0; i < 4; i++) {
    if (location.protocol !== 'https:' || location.username || location.password || (location.port && location.port !== '443') || !cdnHost(location.hostname)) throw new ProcessingError('unapproved_media_host')
    // Large renditions need time to stream; the job lease heartbeat keeps the job alive meanwhile.
    media = await fetcher(location, { redirect: 'manual', signal: AbortSignal.timeout(Number(options[0].size) > MAX_DOCUMENT_BYTES ? 45 * 60000 : 60000) })
    if (![301, 302, 303, 307, 308].includes(media.status)) break
    const target = media.headers.get('location'); await media.body?.cancel()
    if (!target) throw new ProcessingError('invalid_media_redirect')
    location = new URL(target, location); media = undefined
  }
  if (!media) throw new ProcessingError('media_redirect_limit')
  if (Number(options[0].size) > MAX_DOCUMENT_BYTES) { await streamToS3(media, s3, bucket, key, MAX_MEDIA_BYTES); return key }
  const data = await bounded(media, MAX_DOCUMENT_BYTES)
  if (data.length < 12 || data.subarray(4, 8).toString('ascii') !== 'ftyp') throw new ProcessingError('invalid_mp4')
  const sha256 = createHash('sha256').update(data).digest('hex')
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: 'video/mp4', Metadata: { sha256 },
    ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'), ServerSideEncryption: 'AES256', IfNoneMatch: '*' })).catch(async error => {
    if (error?.$metadata?.httpStatusCode !== 412) throw error
    const stored = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!stored.Body || (stored.ContentLength ?? Infinity) > MAX_DOCUMENT_BYTES) throw new ProcessingError('media_size_limit')
    const bytes = await bounded(new Response(stored.Body.transformToWebStream() as ReadableStream), MAX_DOCUMENT_BYTES)
    if (createHash('sha256').update(bytes).digest('hex') !== stored.Metadata?.sha256 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') throw new ProcessingError('staged_media_hash_mismatch')
  })
  return key
}
