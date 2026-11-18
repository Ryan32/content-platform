import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { ProcessingError } from './jobs'
import { MAX_DOCUMENT_BYTES } from './storage'
import { createHash } from 'node:crypto'

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
  const options = (metadata.download ?? []).filter(d => typeof d.link === 'string' && typeof d.size === 'number' && d.size > 0 && d.size <= MAX_DOCUMENT_BYTES && d.type === 'video/mp4')
    .sort((a, b) => Number(a.size) - Number(b.size))
  if (!options[0]) throw new ProcessingError('authorized_media_unavailable_or_too_large')
  let location = new URL(options[0].link as string), media: Response | undefined
  for (let i = 0; i < 4; i++) {
    if (location.protocol !== 'https:' || location.username || location.password || (location.port && location.port !== '443') || !cdnHost(location.hostname)) throw new ProcessingError('unapproved_media_host')
    media = await fetcher(location, { redirect: 'manual', signal: AbortSignal.timeout(60000) })
    if (![301, 302, 303, 307, 308].includes(media.status)) break
    const target = media.headers.get('location'); await media.body?.cancel()
    if (!target) throw new ProcessingError('invalid_media_redirect')
    location = new URL(target, location); media = undefined
  }
  if (!media) throw new ProcessingError('media_redirect_limit')
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
