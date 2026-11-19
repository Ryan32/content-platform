import { GetDocumentTextDetectionCommand, StartDocumentTextDetectionCommand, TextractClient, type Block } from '@aws-sdk/client-textract'
import { EvidenceBuilder, type Extraction } from './extract'
import { ProcessingError } from './jobs'

/**
 * OCR for scanned PDFs with Amazon Textract (asynchronous text detection; PDFs up to 500 MB / 3,000 pages, read from
 * the private bucket with the worker's own S3 permission). Stateless polling like Transcribe: the start call is
 * idempotent per job key (ClientRequestToken), so each poll restarts nothing and returns the same Textract job.
 */
export const OCR_PROCESSOR = 'ae-textract/1'
export const MAX_OCR_BYTES = 500 * 1024 * 1024

export async function ocrPdf(input: { bucket: string; key: string; jobKey: string }, client = new TextractClient({})):
  Promise<{ status: 'pending' } | { status: 'complete'; extraction: Extraction }> {
  const { bucket, key, jobKey } = input
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || !/^[a-f0-9]{64}$/.test(jobKey) || !/^content\/\d+\/[a-f0-9]{64}\.pdf$/.test(key)) throw new ProcessingError('invalid_ocr_input')
  const started = await client.send(new StartDocumentTextDetectionCommand({ DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
    ClientRequestToken: jobKey.slice(0, 64), JobTag: 'ae-library-ocr' }))
  if (!started.JobId) throw new ProcessingError('ocr_job_failed', true)
  const lines = new Map<number, string[]>()
  let token: string | undefined, pages = 0
  for (let call = 0; call < 400; call++) {
    const page = await client.send(new GetDocumentTextDetectionCommand({ JobId: started.JobId, MaxResults: 1000, NextToken: token }))
    if (page.JobStatus === 'IN_PROGRESS') return { status: 'pending' }
    if (page.JobStatus === 'FAILED') throw new ProcessingError('ocr_job_failed')
    if (page.JobStatus !== 'SUCCEEDED' && page.JobStatus !== 'PARTIAL_SUCCESS') throw new ProcessingError('ocr_job_failed')
    pages = Math.max(pages, page.DocumentMetadata?.Pages ?? 0)
    for (const block of page.Blocks ?? [] as Block[]) {
      if (block.BlockType !== 'LINE' || !block.Text) continue
      const n = block.Page ?? 1
      lines.set(n, [...(lines.get(n) ?? []), block.Text])
    }
    token = page.NextToken
    if (!token) {
      const output = new EvidenceBuilder(OCR_PROCESSOR)
      for (const n of [...lines.keys()].sort((a, b) => a - b)) output.add(lines.get(n)!.join('\n'), 'Page ' + n + ' (OCR)')
      if (page.JobStatus === 'PARTIAL_SUCCESS') output.result.warnings.push('Some pages could not be read by OCR.')
      if (pages && lines.size < pages) output.result.warnings.push(`${pages - lines.size} page(s) had no readable text, even with OCR.`)
      output.result.warnings.push('Text was read by OCR from page images; check names and numbers against the original.')
      return { status: 'complete', extraction: output.finish() }
    }
  }
  throw new ProcessingError('ocr_result_limit')
}
