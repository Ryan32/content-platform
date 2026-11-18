import { describe, expect, it } from 'vitest'
import { MAX_THUMBNAIL_BYTES, pickVimeoPicture, sniffImage, thumbnailObject, vimeoThumbnail } from '../src/processing/thumbnails'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])

describe('thumbnail images', () => {
  it('identifies images by content, not by name', () => {
    expect(sniffImage(png)?.ext).toBe('png')
    expect(sniffImage(jpeg)?.ext).toBe('jpg')
    expect(sniffImage(new TextEncoder().encode('<svg onload="x()"></svg>'))).toBeNull()
    expect(sniffImage(new TextEncoder().encode('%PDF-1.7 not an image'))).toBeNull()
  })

  it('stores under an immutable per-item hash key and rejects non-images or oversized files', () => {
    const a = thumbnailObject(7, png)
    expect(a.key).toMatch(/^content\/7\/thumb-[0-9a-f]{64}\.png$/)
    expect(a.version).toHaveLength(16)
    expect(thumbnailObject(7, png)).toEqual(a)
    expect(thumbnailObject(8, png).key).not.toBe(a.key)
    expect(() => thumbnailObject(7, new Uint8Array([1, 2, 3, 4, 5]))).toThrow('invalid_thumbnail')
    const huge = new Uint8Array(MAX_THUMBNAIL_BYTES + 1); huge.set(png)
    expect(() => thumbnailObject(7, huge)).toThrow('invalid_thumbnail')
  })

  it('picks a Vimeo CDN picture of adequate size and ignores other hosts', () => {
    expect(pickVimeoPicture([
      { width: 295, link: 'https://i.vimeocdn.com/video/1-d_295' },
      { width: 960, link: 'https://i.vimeocdn.com/video/1-d_960' },
      { width: 640, link: 'https://evil.example/video/1-d_640' },
      { width: 1280, link: 'https://i.vimeocdn.com/video/1-d_1280' },
    ])).toBe('https://i.vimeocdn.com/video/1-d_960')
    expect(pickVimeoPicture([{ width: 200, link: 'https://i.vimeocdn.com/a' }, { width: 100, link: 'https://i.vimeocdn.com/b' }])).toBe('https://i.vimeocdn.com/a')
    expect(pickVimeoPicture([{ width: 900, link: 'http://i.vimeocdn.com/a' }, { width: 900, link: 'https://user@i.vimeocdn.com/a' }])).toBeNull()
  })

  it('sends the Vimeo token only to the API, never to the image CDN', async () => {
    const calls: { url: string; auth: string | null }[] = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') })
      return url.startsWith('https://api.vimeo.com/')
        ? new Response(JSON.stringify({ pictures: { sizes: [{ width: 640, link: 'https://i.vimeocdn.com/video/9-d_640' }] } }))
        : new Response(jpeg)
    }) as typeof fetch
    expect(await vimeoThumbnail('123', 'token-value', fetcher)).toEqual(jpeg)
    expect(calls).toEqual([
      { url: 'https://api.vimeo.com/videos/123?fields=pictures.sizes,pictures.active', auth: 'Bearer token-value' },
      { url: 'https://i.vimeocdn.com/video/9-d_640', auth: null },
    ])
    await expect(vimeoThumbnail('../me', 'token-value', fetcher)).rejects.toThrow('vimeo_id_required')
  })
})
