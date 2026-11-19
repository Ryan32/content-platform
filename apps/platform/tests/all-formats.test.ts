import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { emptyStats, extractDocument, EvidenceBuilder, svgText } from '../src/processing/extract'
import { appendPictures, normalizeImage, pictureExtraction, type PictureReading } from '../src/processing/vision'
import { MAX_BYTES, ITEM_FORMAT, MIME_TYPES, ACCEPT_ATTRIBUTE } from '../src/processing/formats'

const zip = (entries: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])))
async function png(width = 400, height = 300) {
  const { createCanvas } = await import('@napi-rs/canvas')
  const canvas = createCanvas(width, height); const c = canvas.getContext('2d')
  c.fillStyle = '#123456'; c.fillRect(0, 0, width, height)
  return new Uint8Array(await canvas.encode('png'))
}
function ole(text: string) {
  const header = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  const body = Buffer.from(text, 'utf16le')
  const bytes = new Uint8Array(2048); bytes.set(header); bytes.set(body, 600)
  return bytes
}
const reading = (over: Partial<PictureReading> = {}): PictureReading => ({ kind: 'social-post', description: 'An advisor at a seminar table.', visibleText: 'Retire with confidence', ...over })

describe('REQ-INGEST-04: every file type in the WordPress backup', () => {
  it('knows every type, its item format and its limit; Office and zip are capped at 200 MB', () => {
    for (const ext of ['pdf', 'docx', 'pptx', 'xlsx', 'xlsm', 'doc', 'xls', 'ppt', 'zip', 'jpg', 'jpeg', 'png', 'svg', 'webp', 'mp4']) {
      expect(MIME_TYPES[ext]).toBeTruthy(); expect(ITEM_FORMAT[ext]).toBeTruthy(); expect(MAX_BYTES[ext]).toBeGreaterThan(0)
      expect(ACCEPT_ATTRIBUTE).toContain('.' + ext)
    }
    expect(MAX_BYTES.pptx).toBe(200 * 1024 * 1024)
  })

  it('reads macro-enabled workbooks like ordinary ones', async () => {
    const result = await extractDocument(zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Rates" r:id="r1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Cap rate</t></is></c></row></sheetData></worksheet>',
    }), 'xlsm')
    expect(result.passages[0]).toMatchObject({ locator: 'Sheet Rates!A1', text: 'Cap rate' })
  })

  it('recovers text from old binary Word/Excel files and says it is approximate', async () => {
    const result = await extractDocument(ole('Advisory Agreement Amendment\rClient signature required'), 'doc')
    expect(result.passages.map(p => p.text)).toEqual(expect.arrayContaining(['Advisory Agreement Amendment', 'Client signature required']))
    expect(result.warnings[0]).toMatch(/approximately/)
    await expect(extractDocument(new Uint8Array(1024), 'xls')).rejects.toThrow('invalid_document')
  })

  it('reads every supported file inside a zip packet, labels each, notes unreadable ones, and hands pictures to vision', async () => {
    const stats = emptyStats()
    const packet = zip({
      'Packet/Instructions.docx': zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Sign page 3</w:t></w:r></w:p></w:body></w:document>' }),
      'Packet/notes.txt': 'Return within 30 days',
      'Packet/post-1.png': await png(),
      'Packet/broken.pdf': 'not a pdf',
      '__MACOSX/Packet/._notes.txt': 'junk',
      'Packet/inner.zip': zip({ 'x.txt': 'nested' }),
    })
    const result = await extractDocument(packet, 'zip', stats)
    expect(result.passages.map(p => p.locator)).toEqual(['Instructions.docx · Paragraph 1', 'notes.txt · Paragraph 1'])
    expect(result.warnings.join(' ')).toContain('broken.pdf inside the zip could not be read')
    expect(stats.images.map(i => i.label)).toEqual(['post-1.png (picture)'])
    expect(result.passages.some(p => p.text.includes('nested'))).toBe(false)
  })

  it('finds picture-only slides so their images can be read by AI vision', async () => {
    const stats = emptyStats()
    const image = await png()
    const result = await extractDocument(zip({
      'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="r1"/><p:sldId id="2" r:id="r2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:t>Annuity income options for clients approaching retirement</a:t></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:t>Chart</a:t></a:p></p:sld>',
      'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Id="i1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
      'ppt/media/image1.png': image,
    }), 'pptx', stats)
    expect(result.passages[0].locator).toBe('Slide 1')
    expect(stats.images.map(i => [i.label, i.format])).toEqual([['Slide 2 (picture)', 'png']])
    expect(Buffer.from(stats.images[0].bytes).equals(Buffer.from(image))).toBe(true)
  })

  it('returns an empty extraction (not an error) for a picture-only deck so vision can fill it', async () => {
    const stats = emptyStats()
    const result = await extractDocument(zip({
      'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="r1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld></p:sld>',
      'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Id="i1" Type="x/image" Target="../media/scan.jpeg"/></Relationships>',
      'ppt/media/scan.jpeg': await png(),
    }), 'pptx', stats)
    expect(result.passages).toEqual([]); expect(stats.images).toHaveLength(1)
    await expect(extractDocument(zip({ 'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="r1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>', 'ppt/slides/slide1.xml': '<p:sld></p:sld>' }), 'pptx')).rejects.toThrow('no_extractable_text')
  })

  it('reads SVG text but never script content', () => {
    const out = new EvidenceBuilder('t')
    svgText(strToU8('<svg><title>Fee schedule</title><script>alert(1)</script><text x="1">0.85% advisory fee</text></svg>'), out)
    expect(out.result.passages[0].text).toBe('Fee schedule 0.85% advisory fee')
  })
})

describe('REQ-AI-03: AI vision for pictures', () => {
  it('normalizes any raster image to a bounded JPEG and refuses tiny or broken ones', async () => {
    const jpeg = await normalizeImage(await png(4000, 1000))
    expect(Buffer.from(jpeg.subarray(0, 3))).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    const { loadImage } = await import('@napi-rs/canvas')
    expect((await loadImage(Buffer.from(jpeg))).width).toBe(1568)
    await expect(normalizeImage(await png(20, 20))).rejects.toThrow('image_too_small')
    await expect(normalizeImage(strToU8('not an image'))).rejects.toThrow('invalid_image')
  })
  it('turns a picture into description and transcribed-text passages; skips decorative logos', async () => {
    const result = await pictureExtraction(await png(), 'model', vi.fn(async () => reading()))
    expect(result.passages.map(p => [p.locator, p.text])).toEqual([['Picture · description', 'An advisor at a seminar table.'], ['Picture · text in picture', 'Retire with confidence']])
    await expect(pictureExtraction(await png(), 'model', async () => reading({ kind: 'logo-or-icon', visibleText: '' }))).rejects.toThrow('decorative_image')
  })
  it('appends pictures to a document extraction with continuing passage IDs and counts unreadable ones', async () => {
    const base = { processorVersion: 'ae-pptx/1', warnings: [], passages: [{ id: 'e1', text: 'Slide text', locator: 'Slide 1' }] }
    const read = vi.fn(async () => reading()).mockRejectedValueOnce(new Error('bad'))
    const result = await appendPictures(base, [{ label: 'Slide 2 (picture)', bytes: await png() }, { label: 'Slide 3 (picture)', bytes: await png() }], 'model', read)
    expect(result.passages.map(p => p.id)).toEqual(['e1', 'e2', 'e3'])
    expect(result.passages[1].locator).toBe('Slide 3 (picture) · description')
    expect(result.warnings.join(' ')).toContain('1 picture(s) could not be read')
  })
})
