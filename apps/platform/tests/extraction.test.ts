import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractDocument } from '../src/processing/extract'

const zip = (entries: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])))
function syntheticPdf() {
  const stream = 'BT /F1 12 Tf 20 50 Td (Synthetic page evidence) Tj ET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>']
  let pdf = '%PDF-1.4\n'
  const offsets = ['0000000000 65535 f ']
  for (const [i, object] of objects.entries()) {
    offsets.push(String(pdf.length).padStart(10, '0') + ' 00000 n ')
    pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'
  }
  const start = pdf.length
  pdf += 'xref\n0 7\n' + offsets.join('\n') + '\ntrailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n'
  return Buffer.from(pdf)
}
describe('document and caption evidence', () => {
  it('reads native PDF text with physical page location and reports blank pages', async () => {
    const result = await extractDocument(syntheticPdf(), 'pdf')
    expect(result.passages).toEqual([{ id: 'e1', locator: 'Page 1', text: 'Synthetic page evidence' }])
    expect(result.warnings[0]).toMatch(/1 page/)
  })
  it('preserves Word paragraph order, rich runs and escaped text', async () => {
    const bytes = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>A &amp; </w:t></w:r><w:r><w:t>B</w:t></w:r></w:p><w:p><w:r><w:t>002</w:t></w:r></w:p></w:body></w:document>' })
    const result = await extractDocument(bytes, 'docx')
    expect(result.passages.map(p => [p.locator, p.text])).toEqual([['Paragraph 1', 'A & B'], ['Paragraph 2', '002']])
  })
  it('follows presentation order even when slide part numbers differ', async () => {
    const result = await extractDocument(zip({
      'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="42" r:id="rB"/><p:sldId id="25" r:id="rA"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rA" Target="slides/slide1.xml"/><Relationship Id="rB" Target="slides/slide7.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:t>Second</a:t></a:p></p:sld>',
      'ppt/slides/slide7.xml': '<p:sld><a:p><a:t>First</a:t></a:p></p:sld>',
    }), 'pptx')
    expect(result.passages.map(p => [p.locator, p.text])).toEqual([['Slide 1', 'First'], ['Slide 2', 'Second']])
  })
  it('resolves workbook sheet names, shared strings and cached formula values', async () => {
    const result = await extractDocument(zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Totals" sheetId="4" r:id="r1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Training</t></si></sst>',
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><f>2+3</f><v>5</v></c></row></sheetData></worksheet>',
    }), 'xlsx')
    expect(result.passages.map(p => [p.locator, p.text])).toEqual([['Sheet Totals!A1', 'Training'], ['Sheet Totals!B1', '5']])
  })
  it('preserves valid VTT cue timing and rejects backward timestamps', async () => {
    const cue = (end: string) => Buffer.from('WEBVTT\n\nNOTE internal\n\ncue-id\n00:01.000 --> ' + end + ' align:start\n<v Presenter>Hello &amp; welcome</v>\n')
    expect((await extractDocument(cue('00:03.500'), 'vtt')).passages[0]).toEqual({ id: 'e1', text: 'Hello & welcome', locator: '00:01.000 – 00:03.500' })
    await expect(extractDocument(cue('00:00.250'), 'vtt')).rejects.toThrow('invalid_caption_timing')
  })
  it('rejects XML declarations with external entities, excessive ZIP expansion, and corrupt input', async () => {
    await expect(extractDocument(zip({ 'word/document.xml': '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///unused">]><document/>' }), 'docx')).rejects.toThrow('invalid_office_xml')
    await expect(extractDocument(zip({ 'word/document.xml': 'a'.repeat(160000) }), 'docx')).rejects.toThrow('office_expansion_limit')
    await expect(extractDocument(Buffer.from('abc'), 'docx')).rejects.toThrow()
    await expect(extractDocument(Buffer.from('%!unknown'), 'pdf')).rejects.toThrow('invalid_pdf')
  })
  it('splits long plain text into stable bounded evidence', async () => {
    const result = await extractDocument(Buffer.from('a'.repeat(21000) + '\n\nParagraph two'), 'txt')
    expect(result.passages.map(p => [p.id, p.locator, p.text.length])).toEqual([['e1', 'Paragraph 1', 16000], ['e2', 'Paragraph 1', 5000], ['e3', 'Paragraph 2', 13]])
  })
})
