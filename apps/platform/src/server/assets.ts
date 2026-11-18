import { getPayload, createLocalReq } from 'payload'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import config from '../payload.config'
import { profileIds, publishedWhere } from '../collections/access'
import { principalFromUser } from '../domain/access'

export async function assetResponse(request: Request, assetId: string, download: boolean) {
  const denied = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
  if (!/^\d+$/.test(assetId) || !process.env.CONTENT_BUCKET) return denied()
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || !principalFromUser(user)?.active) return denied()
  const req = await createLocalReq({ user }, payload)
  // This endpoint serves originals, including inline PDF; view-only readers use
  // extracted text until an independently stored preview derivative is available.
  const ids = await profileIds(req, 'download')
  if (!ids.length) return denied()
  // Trusted metadata lookup; do not disclose asset existence before content authorization.
  const asset = (await payload.find({ collection: 'assets', req, overrideAccess: true, depth: 0, limit: 1, where: { id: { equals: Number(assetId) } } })).docs[0]
  if (!asset) return denied()
  const contentId = typeof asset.content === 'number' ? asset.content : asset.content.id
  const doc = (await payload.find({ collection: 'content', req, overrideAccess: true, depth: 0, limit: 1,
    where: { and: [publishedWhere(ids), { id: { equals: contentId } }] } })).docs[0]
  if (!doc || doc.sourceHash !== asset.version || !/^content\/[A-Za-z0-9/_-]+(?:\.[A-Za-z0-9]+)?$/.test(asset.objectKey)) return denied()
  if (!download && asset.mimeType !== 'application/pdf') return denied()
  const range = request.headers.get('range')
  if (range && !/^bytes=\d+-\d*$/.test(range)) return new Response('Invalid range', { status: 416 })
  try {
    const object = await new S3Client({}).send(new GetObjectCommand({ Bucket: process.env.CONTENT_BUCKET, Key: asset.objectKey, ...(range ? { Range: range } : {}) }))
    if (!object.Body) return denied()
    const headers = new Headers({ 'Content-Type': download ? 'application/octet-stream' : 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="resource-${asset.id}${asset.mimeType === 'application/pdf' ? '.pdf' : ''}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes',
      'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'" })
    if (object.ContentLength !== undefined) headers.set('Content-Length', String(object.ContentLength))
    if (object.ContentRange) headers.set('Content-Range', object.ContentRange)
    return new Response(object.Body.transformToWebStream() as ReadableStream, { status: object.ContentRange ? 206 : 200, headers })
  } catch { return new Response('File temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } }) }
}
