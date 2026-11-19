import { afterEach, describe, expect, it, vi } from 'vitest'
import { GetDocumentTextDetectionCommand, StartDocumentTextDetectionCommand, type TextractClient } from '@aws-sdk/client-textract'
import { S3Client } from '@aws-sdk/client-s3'
import { ocrPdf } from '../src/processing/ocr'
import { finalizeUploads, type FinalizeDeps } from '../src/processing/finalize-uploads'
import { checkLargeFile, signLargeUpload, STAGING_KEY } from '../src/server/large-upload'
import { UploadError } from '../src/server/processing'

const key = `content/7/${'a'.repeat(64)}.pdf`, jobKey = 'b'.repeat(64)
afterEach(() => vi.unstubAllEnvs())

describe('REQ-INGEST-03: OCR for scanned PDFs (Amazon Textract)', () => {
  it('starts idempotently per job, waits while running, then builds page passages from lines across result pages', async () => {
    let polls = 0
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof StartDocumentTextDetectionCommand) return { JobId: 'j1' }
      const input = (command as GetDocumentTextDetectionCommand).input
      if (++polls === 1) return { JobStatus: 'IN_PROGRESS' }
      if (!input.NextToken) return { JobStatus: 'SUCCEEDED', DocumentMetadata: { Pages: 3 }, NextToken: 't2',
        Blocks: [{ BlockType: 'PAGE', Page: 1 }, { BlockType: 'LINE', Text: 'Annual review', Page: 1 }, { BlockType: 'WORD', Text: 'Annual', Page: 1 }] }
      return { JobStatus: 'SUCCEEDED', DocumentMetadata: { Pages: 3 }, Blocks: [{ BlockType: 'LINE', Text: 'Income rider', Page: 2 }, { BlockType: 'LINE', Text: 'Age 60', Page: 2 }] }
    })
    const client = { send } as unknown as TextractClient
    expect(await ocrPdf({ bucket: 'private-bucket', key, jobKey }, client)).toEqual({ status: 'pending' })
    const done = await ocrPdf({ bucket: 'private-bucket', key, jobKey }, client)
    expect(done.status).toBe('complete')
    if (done.status !== 'complete') return
    expect(done.extraction.passages.map(p => [p.locator, p.text])).toEqual([['Page 1 (OCR)', 'Annual review'], ['Page 2 (OCR)', 'Income rider Age 60']])
    expect(done.extraction.processorVersion).toBe('ae-textract/1')
    expect(done.extraction.warnings.join(' ')).toContain('1 page(s) had no readable text')
    const starts = send.mock.calls.filter(([c]) => c instanceof StartDocumentTextDetectionCommand).map(([c]) => (c as StartDocumentTextDetectionCommand).input)
    expect(new Set(starts.map(s => s.ClientRequestToken))).toEqual(new Set([jobKey]))
    expect(starts[0].DocumentLocation).toEqual({ S3Object: { Bucket: 'private-bucket', Name: key } })
  })
  it('refuses anything but an item PDF in the private bucket, and reports failures by code', async () => {
    const client = { send: vi.fn(async (c: unknown) => c instanceof StartDocumentTextDetectionCommand ? { JobId: 'j' } : { JobStatus: 'FAILED' }) } as unknown as TextractClient
    await expect(ocrPdf({ bucket: 'private-bucket', key: 'processing/x.pdf', jobKey }, client)).rejects.toThrow('invalid_ocr_input')
    await expect(ocrPdf({ bucket: 'private-bucket', key, jobKey }, client)).rejects.toThrow('ocr_job_failed')
  })
})

describe('REQ-ASSET-03: uploads over 50 MB go straight to private S3 staging', () => {
  it('accepts large audio/video up to 2 GB and PDFs up to 500 MB, nothing else', () => {
    expect(checkLargeFile('webinar.MP4', 900 * 1024 ** 2)).toBe('mp4')
    expect(checkLargeFile('scan.pdf', 400 * 1024 ** 2)).toBe('pdf')
    expect(() => checkLargeFile('deck.pptx', 80 * 1024 ** 2)).toThrow(UploadError)
    expect(() => checkLargeFile('webinar.mp4', 3 * 1024 ** 3)).toThrow('2 GB')
    expect(() => checkLargeFile('scan.pdf', 600 * 1024 ** 2)).toThrow('500 MB')
    expect(() => checkLargeFile('small.mp4', 10 * 1024 ** 2)).toThrow()
  })
  it('signs one exact-size PUT into uploads/<item>/ with encryption and uploader enforced, only for Intake/Draft items', async () => {
    vi.stubEnv('CONTENT_BUCKET', 'private-bucket')
    const client = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'synthetic' } })
    const payload = { findByID: vi.fn(async () => ({ id: 7, state: 'draft' })) }
    const signed = await signLargeUpload(payload as never, 42, 7, 'Webinar.mp4', 200 * 1024 ** 2, client)
    const url = new URL(signed.url)
    expect(url.hostname).toContain('private-bucket')
    expect(STAGING_KEY.test(decodeURIComponent(url.pathname.slice(1)))).toBe(true)
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')!
    for (const h of ['content-length', 'content-type', 'x-amz-server-side-encryption', 'x-amz-meta-uploaded-by']) expect(signedHeaders).toContain(h)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(signed.headers).toEqual({ 'Content-Type': 'video/mp4', 'x-amz-server-side-encryption': 'AES256', 'x-amz-meta-uploaded-by': '42' })
    payload.findByID.mockResolvedValueOnce({ id: 7, state: 'published' })
    await expect(signLargeUpload(payload as never, 42, 7, 'Webinar.mp4', 200 * 1024 ** 2, client)).rejects.toThrow('Intake or Draft')
  })
})

describe('REQ-ASSET-03: worker finalizes staged uploads', () => {
  const sha = 'c'.repeat(64), staged = 'uploads/7/0f8fad5b-d9cb-469f-a165-70867728950e.mp4'
  function deps(over: Partial<FinalizeDeps> = {}) {
    const log: string[] = []
    const d: FinalizeDeps = {
      list: async () => [staged], head: async () => ({ size: 300 * 1024 ** 2, uploadedBy: '42' }),
      hash: async () => ({ sha256: sha, head: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) }),
      copy: async (from, to) => { log.push(`copy ${from} -> ${to}`) }, remove: async k => { log.push(`remove ${k}`) },
      register: async (id, object, ext) => { log.push(`register ${id} ${object.key} ${ext}`) }, ...over }
    return { d, log }
  }
  it('fingerprints, copies to the immutable item key, registers, then removes staging', async () => {
    const { d, log } = deps()
    expect(await finalizeUploads(d)).toEqual([{ key: staged, status: 'registered' }])
    expect(log).toEqual([`copy ${staged} -> content/7/${sha}.mp4`, `register 7 content/7/${sha}.mp4 mp4`, `remove ${staged}`])
  })
  it('rejects unsigned, oversized, fake-PDF and unattachable uploads; keeps failures retryable otherwise', async () => {
    expect((await finalizeUploads(deps({ head: async () => ({ size: 10, uploadedBy: null }) }).d))[0].code).toBe('unsigned_upload')
    expect((await finalizeUploads(deps({ head: async () => ({ size: 3 * 1024 ** 3, uploadedBy: '1' }) }).d))[0].code).toBe('input_size_limit')
    const pdf = deps({ list: async () => ['uploads/7/0f8fad5b-d9cb-469f-a165-70867728950e.pdf'], hash: async () => ({ sha256: sha, head: new TextEncoder().encode('MZ not a pdf') }) })
    expect((await finalizeUploads(pdf.d))[0].code).toBe('invalid_pdf')
    expect((await finalizeUploads(deps({ list: async () => ['uploads/../etc/passwd'] }).d))[0].code).toBe('invalid_staging_key')
    const locked = deps({ register: async () => { throw new UploadError(409, 'published') } })
    expect((await finalizeUploads(locked.d))[0].code).toBe('item_not_editable')
    const flaky = deps({ register: async () => { throw new Error('db down') } })
    await expect(finalizeUploads(flaky.d)).rejects.toThrow('db down')
    expect(flaky.log.some(l => l.startsWith('remove'))).toBe(false)
  })
})
