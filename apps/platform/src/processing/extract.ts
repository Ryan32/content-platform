import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { crc32, inflateRawSync } from 'node:zlib'
import { ProcessingError } from './jobs'

export type DocumentFormat = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'vtt' | 'txt'
export interface Extraction {
  passages: { id: string; text: string; locator: string }[]
  warnings: string[]
  processorVersion: string
}

const decoder = new TextDecoder('utf-8', { fatal: true })
const MiB = 1024 * 1024

export class EvidenceBuilder {
  readonly result: Extraction
  private characters = 0
  constructor(version: string) {
    this.result = { processorVersion: version, warnings: [], passages: [] }
  }
  add(raw: string, locator: string) {
    const text = raw.replace(/\s+/g, ' ').trim()
    if (!text) return
    this.characters += text.length
    if (this.characters > 2 * MiB) throw new ProcessingError('extracted_text_limit')
    for (let start = 0; start < text.length; start += 16000) {
      if (this.result.passages.length >= 2000) throw new ProcessingError('passage_limit')
      this.result.passages.push({ id: 'e' + (this.result.passages.length + 1), locator, text: text.slice(start, start + 16000) })
    }
  }
  finish() {
    if (!this.result.passages.length) throw new ProcessingError('no_extractable_text')
    return this.result
  }
}

// Read only bounded, named OOXML parts. Cap actual inflate output independently of ZIP metadata.
function readParts(input: Uint8Array, selected: RegExp) {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const invalid = () => new ProcessingError('invalid_office_archive')
  let end = data.length - 22
  while (end >= Math.max(0, data.length - 65557) &&
    (data.readUInt32LE(end) !== 0x06054b50 || end + 22 + data.readUInt16LE(end + 20) !== data.length)) end--
  if (end < Math.max(0, data.length - 65557) || data.readUInt32LE(end + 4) !== 0) throw invalid()
  const count = data.readUInt16LE(end + 10)
  let offset = data.readUInt32LE(end + 16)
  if (count > 5000 || data.readUInt16LE(end + 8) !== count || offset + data.readUInt32LE(end + 12) !== end) throw invalid()
  const parts = new Map<string, Uint8Array>()
  let total = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) throw invalid()
    const nameSize = data.readUInt16LE(offset + 28)
    const name = data.toString('utf8', offset + 46, offset + 46 + nameSize)
    const compressed = data.readUInt32LE(offset + 20), expanded = data.readUInt32LE(offset + 24)
    const local = data.readUInt32LE(offset + 42), method = data.readUInt16LE(offset + 10)
    const encrypted = data.readUInt16LE(offset + 8) & 1, checksum = data.readUInt32LE(offset + 16)
    offset += 46 + nameSize + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32)
    if (offset > end) throw invalid()
    if (!selected.test(name)) continue
    total += expanded
    if (expanded > 4 * MiB || total > 16 * MiB || expanded > Math.max(compressed * 250, 64 * 1024)) throw new ProcessingError('office_expansion_limit')
    if (parts.has(name) || encrypted || (method !== 0 && method !== 8) || local + 30 > end || data.readUInt32LE(local) !== 0x04034b50) throw invalid()
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    if (start + compressed > end || (method === 0 && expanded !== compressed)) throw invalid()
    const payload = data.subarray(start, start + compressed)
    const bytes = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: Math.max(1, expanded) })
    if (bytes.length !== expanded || crc32(bytes) !== checksum) throw invalid()
    parts.set(name, bytes)
  }
  if (offset !== end) throw invalid()
  return parts
}

type XmlNode = { [name: string]: unknown }
function nodes(parent: XmlNode[], tag: string): XmlNode[] {
  const found: XmlNode[] = []
  function walk(items: XmlNode[]) {
    for (const item of items) {
      if (Object.hasOwn(item, tag)) found.push(item)
      else for (const value of Object.values(item)) if (Array.isArray(value)) walk(value)
    }
  }
  walk(parent)
  return found
}
function children(node: XmlNode, tag: string) { return node[tag] as XmlNode[] }
function attribute(node: XmlNode, name: string) {
  return (node[':@'] as Record<string, string> | undefined)?.['@_' + name]
}
function textOf(parent: XmlNode[], tag: string) {
  return nodes(parent, tag).flatMap(item => children(item, tag).map(child => String(child['#text'] ?? ''))).join('')
}
function xml(bytes: Uint8Array): XmlNode[] {
  const raw = decoder.decode(bytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(raw) || (raw.match(/</g)?.length ?? 0) > 100000 ||
      XMLValidator.validate(raw) !== true) throw new ProcessingError('invalid_office_xml')
  return new XMLParser({ preserveOrder: true, transformTagName: tag => tag.split(':').at(-1)!, ignoreAttributes: false,
    parseTagValue: false, trimValues: false, processEntities: true, maxNestedTags: 64 }).parse(raw)
}

const selectedParts = {
  docx: /^word\/document\.xml$/,
  pptx: /^ppt\/(?:presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide[1-9]\d{0,5}\.xml)$/,
  xlsx: /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet[1-9]\d{0,5}\.xml)$/,
}

function office(input: Uint8Array, format: keyof typeof selectedParts, output: EvidenceBuilder) {
  const parts = readParts(input, selectedParts[format])
  if (format === 'docx') {
    const document = parts.get('word/document.xml')
    if (!document) throw new ProcessingError('missing_document_part')
    nodes(xml(document), 'p').forEach((p, i) => output.add(textOf(children(p, 'p'), 't'), 'Paragraph ' + (i + 1)))
    return
  }
  const slides = format === 'pptx'
  const root = slides ? 'ppt' : 'xl'
  const manifest = slides ? 'presentation.xml' : 'workbook.xml'
  const main = parts.get(root + '/' + manifest), rels = parts.get(root + '/_rels/' + manifest + '.rels')
  if (!main || !rels) throw new ProcessingError('missing_office_manifest')
  const targets = new Map(nodes(xml(rels), 'Relationship')
    .filter(r => !attribute(r, 'TargetMode') || attribute(r, 'TargetMode') === 'Internal')
    .map(r => [attribute(r, 'Id'), attribute(r, 'Target')]))
  const sharedBytes = parts.get('xl/sharedStrings.xml')
  const strings = sharedBytes ? nodes(xml(sharedBytes), 'si').map(si => textOf(children(si, 'si'), 't')) : []
  const items = nodes(xml(main), slides ? 'sldId' : 'sheet')
  if (items.length > 500) throw new ProcessingError('office_part_limit')
  const seen = new Set<string>()
  for (const [i, item] of items.entries()) {
    // The parser preserves the namespace-qualified relationship ID separately from slide's numeric id.
    const relId = attribute(item, 'r:id') ?? attribute(item, 'id')
    const target = targets.get(relId)
    const key = target?.startsWith('/') ? target.slice(1) : root + '/' + target
    const bytes = parts.get(key)
    if (!bytes || seen.has(key) || !(slides ? /^ppt\/slides\/slide\d+\.xml$/ : /^xl\/worksheets\/sheet\d+\.xml$/).test(key)) throw new ProcessingError('invalid_office_relationship')
    seen.add(key)
    const part = xml(bytes)
    if (slides) {
      output.add(nodes(part, 'p').map(p => textOf(children(p, 'p'), 't')).join(' '), 'Slide ' + (i + 1))
    } else {
      const sheet = (attribute(item, 'name') ?? String(i + 1)).slice(0, 60)
      for (const c of nodes(part, 'c')) {
        const ref = attribute(c, 'r'), type = attribute(c, 't'), cell = children(c, 'c')
        if (!ref || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(ref)) throw new ProcessingError('invalid_cell_reference')
        let value = type === 'inlineStr' ? textOf(cell, 't') : textOf(cell, 'v')
        if (type === 's') {
          if (!/^\d+$/.test(value) || strings[Number(value)] === undefined) throw new ProcessingError('invalid_shared_string')
          value = strings[Number(value)]
        }
        output.add(value, 'Sheet ' + sheet + '!' + ref)
      }
    }
  }
}

function captions(raw: string, output: EvidenceBuilder) {
  const blocks = raw.replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n+/)
  if (!/^WEBVTT(?:[ \t\n]|$)/.test(blocks.shift() ?? '')) throw new ProcessingError('invalid_captions')
  const stamp = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/
  function milliseconds(value: string) {
    const m = stamp.exec(value)
    return m ? ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]) : NaN
  }
  for (const block of blocks) {
    if (/^(?:NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block)) continue
    const lines = block.split('\n')
    if (!lines[0].includes('-->')) lines.shift()
    const match = /^(\S+)\s+-->\s+(\S+)(?:\s.*)?$/.exec(lines.shift() ?? '')
    if (!match || !(milliseconds(match[2]) > milliseconds(match[1]))) throw new ProcessingError('invalid_caption_timing')
    const text = lines.join(' ').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    output.add(text, match[1] + ' – ' + match[2])
  }
}

/** Filled for PDFs: how many pages have no native text layer (OCR candidates). */
export interface PdfStats { pages: number; emptyPages: number }
async function pdf(bytes: Uint8Array, output: EvidenceBuilder, stats?: PdfStats) {
  if (!Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-')) throw new ProcessingError('invalid_pdf')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: Uint8Array.from(bytes), stopAtErrors: true, useWorkerFetch: false,
    useSystemFonts: false, disableFontFace: true, useWasm: false, maxImageSize: 0, verbosity: 0 })
  try {
    const doc = await task.promise
    if (doc.numPages > 500) throw new ProcessingError('pdf_page_limit')
    let empty = 0
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const reader = page.streamTextContent().getReader()
      const text: string[] = []
      let length = 0
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        for (const item of chunk.value.items) if ('str' in item) {
          length += item.str.length + 1
          if (length > 2 * MiB) { await reader.cancel(); throw new ProcessingError('extracted_text_limit') }
          text.push(item.str)
        }
      }
      const pageText = text.join(' ')
      if (!pageText.trim()) empty++
      output.add(pageText, 'Page ' + i)
      page.cleanup()
    }
    if (stats) { stats.pages = doc.numPages; stats.emptyPages = empty }
    if (empty === doc.numPages) throw new ProcessingError('pdf_requires_ocr')
    if (empty) output.result.warnings.push(empty + ' page(s) lack native text and may require OCR.')
  } finally { await task.destroy() }
}

export async function extractDocument(bytes: Uint8Array, format: DocumentFormat, stats?: PdfStats): Promise<Extraction> {
  if (!bytes.length || bytes.length > 50 * MiB) throw new ProcessingError('input_size_limit')
  const output = new EvidenceBuilder('ae-' + format + '/1')
  try {
    if (format === 'pdf') await pdf(bytes, output, stats)
    else if (format === 'vtt' || format === 'txt') {
      if (bytes.length > 4 * MiB) throw new ProcessingError('input_size_limit')
      const raw = decoder.decode(bytes)
      if (raw.includes('\0')) throw new ProcessingError('invalid_text')
      if (format === 'vtt') captions(raw, output)
      else raw.split(/\r?\n\s*\r?\n/).forEach((p, i) => output.add(p, 'Paragraph ' + (i + 1)))
    } else office(bytes, format, output)
    return output.finish()
  } catch (error) {
    if (error instanceof ProcessingError) throw error
    throw new ProcessingError('invalid_document')
  }
}
