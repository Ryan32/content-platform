import { describe, expect, it, vi } from 'vitest'
import type { S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { stageVimeoMedia } from '../src/processing/vimeo-media'
import { createHash } from 'node:crypto'
const key = 'a'.repeat(64)
const media = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42synthetic')])
function storage() {
  return { send: vi.fn(async (command: unknown) => { if (command instanceof GetObjectCommand) throw Object.assign(new Error(), { name: 'NoSuchKey' }); return {} }) }
}
describe('authorized Vimeo fallback', () => {
  it('sends the bearer only to the API, follows approved CDN redirects without it, and stages private bytes', async () => {
    const s3 = storage()
    const requests: { url: string; options?: RequestInit }[] = []
    const fetcher = (async (url: string | URL, options?: RequestInit) => {
      requests.push({ url: String(url), options })
      if (String(url).startsWith('https://api.vimeo.com/')) return Response.json({ download: [{ link: 'https://player.vimeo.com/progressive_redirect/signed', size: media.length, type: 'video/mp4' }] })
      if (String(url).includes('player.vimeo.com')) return new Response(null, { status: 302, headers: { location: 'https://vod.akamaized.net/media' } })
      return new Response(media)
    }) as typeof fetch
    expect(await stageVimeoMedia('123', 'synthetic-token', 'private-bucket', key, s3 as unknown as S3Client, fetcher)).toBe(`processing/vimeo/${key}.mp4`)
    expect(requests[0].options?.headers).toHaveProperty('Authorization', 'Bearer synthetic-token')
    for (const request of requests.slice(1)) expect(request.options?.headers).toBeUndefined()
    const write = s3.send.mock.calls.find(([command]) => command instanceof PutObjectCommand)![0] as PutObjectCommand
    expect(write.input.ACL).toBeUndefined(); expect(write.input.ServerSideEncryption).toBe('AES256')
    expect(JSON.stringify(write.input.Metadata)).not.toContain('signed')
  })
  it('refuses a redirect into an internal service without requesting it', async () => {
    const s3 = storage(), requests: string[] = []
    const fetcher = (async (url: string | URL) => { requests.push(String(url)); return String(url).startsWith('https://api.vimeo.com/')
      ? Response.json({ download: [{ link: 'https://download.vimeocdn.com/signed', size: 20, type: 'video/mp4' }] })
      : new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } }) }) as typeof fetch
    await expect(stageVimeoMedia('123', 'synthetic-token', 'private-bucket', key, s3 as unknown as S3Client, fetcher)).rejects.toThrow('unapproved_media_host')
    expect(requests).toHaveLength(2)
    expect(s3.send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(false)
  })
  it('reconciles a conditional-write conflict by verifying the winner\'s staged bytes', async () => {
    let reads = 0
    const s3 = { send: vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) throw { $metadata: { httpStatusCode: 412 } }
      if (++reads === 1) throw { name: 'NoSuchKey' }
      return { ContentLength: media.length, Metadata: { sha256: createHash('sha256').update(media).digest('hex') }, Body: { transformToWebStream: () => new Response(media).body } }
    }) }
    const fetcher = (async (url: string | URL) => String(url).startsWith('https://api.vimeo.com/')
      ? Response.json({ download: [{ link: 'https://download.vimeocdn.com/file', size: media.length, type: 'video/mp4' }] })
      : new Response(media)) as typeof fetch
    expect(await stageVimeoMedia('123', 'synthetic', 'private-bucket', key, s3 as unknown as S3Client, fetcher)).toBe(`processing/vimeo/${key}.mp4`)
    expect(reads).toBe(2)
  })
})
