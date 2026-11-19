import { describe, expect, it } from 'vitest'
import { isInlineType, locatorPage, locatorSeconds, viewerFor } from '../src/domain/viewers'
import { parseInline, parseMarkdown, safeHref } from '../src/domain/markdown'
import { matchMarks, occurrences } from '../src/components/viewers/pdf-find'

describe('REQ-VIEW-01: inline viewers', () => {
  it('serves only script-free types inline', () => {
    expect(viewerFor('application/pdf')).toBe('pdf'); expect(viewerFor('IMAGE/PNG')).toBe('image')
    expect(viewerFor('audio/mpeg')).toBe('audio'); expect(viewerFor('video/mp4')).toBe('video')
    for (const t of ['image/svg+xml', 'text/html', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) expect(isInlineType(t)).toBe(false)
  })
  it('opens citations at their page or time', () => {
    expect(locatorPage('Page 12')).toBe(12); expect(locatorPage('Paragraph 4')).toBeNull()
    expect(locatorSeconds('00:01:05.000 – 00:01:09.000')).toBe(65)
    expect(locatorSeconds('750.2s – 755.0s')).toBe(750)
    expect(locatorSeconds('Slide 3')).toBeNull()
  })
  it('finds every occurrence in a PDF and places its highlight on the page at any zoom', () => {
    const items = [{ str: 'some of the Changes that', transform: [10, 0, 0, 10, 100, 700], width: 120 }, { str: 'changes, changes' }, { str: 'nothing' }]
    expect(occurrences(items, ' CHANGES ', 4)).toEqual([{ page: 4, item: 0, start: 12 }, { page: 4, item: 1, start: 0 }, { page: 4, item: 1, start: 9 }])
    const expected = [{ item: 0, start: 12, left: 160 / 600, top: 89.5 / 800, width: 35 / 600, height: 13 / 800 }]
    // Items without position data (rare in pdf.js output) are found but not boxed.
    for (const zoom of [1, 2]) {
      const marks = matchMarks(items, 'changes', { transform: [zoom, 0, 0, -zoom, 0, 800 * zoom], width: 600 * zoom, height: 800 * zoom, scale: zoom })
      expect(marks).toHaveLength(1)
      for (const key of ['left', 'top', 'width', 'height'] as const) expect(marks[0][key]).toBeCloseTo(expected[0][key], 6)
    }
  })
})

describe('REQ-HOWTO-01: how-to articles render a safe Markdown subset', () => {
  it('builds headings with unique anchors, lists and screenshots', () => {
    const blocks = parseMarkdown('# Set up\nIntro **bold**\n\n## Steps\n1. One\n2. Two\n\n## Steps\n- a\n\n![Screen](/files/12)\n![x](https://evil.example/a.png)')
    expect(blocks.filter(b => b.type === 'heading').map(b => (b as { id: string }).id)).toEqual(['set-up', 'steps', 'steps-2'])
    expect(blocks.find(b => b.type === 'list')).toMatchObject({ ordered: true, items: [[{ t: 'text', v: 'One' }], [{ t: 'text', v: 'Two' }]] })
    expect(blocks.filter(b => b.type === 'image')).toEqual([{ type: 'image', alt: 'Screen', src: '/files/12' }])
  })
  it('drops unsafe links', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull(); expect(safeHref('//evil.example')).toBeNull()
    expect(safeHref('/sections/products')).toBe('/sections/products')
    expect(parseInline('[click](javascript:alert(1))').some(p => p.t === 'link')).toBe(false)
    expect(parseInline('[ok](https://advisorsexcel.com)')).toEqual([{ t: 'link', v: 'ok', href: 'https://advisorsexcel.com' }])
  })
})
