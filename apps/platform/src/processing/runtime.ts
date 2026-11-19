import type { Pool } from 'pg'
import { S3Client } from '@aws-sdk/client-s3'
import { extractDocument } from './extract'
import { getVimeoCaptions, classify, transcribeMedia } from './providers'
import { readOriginal, contentKey, storedObject, verifyOriginal, MAX_DOCUMENT_BYTES } from './storage'
import { MAX_OCR_BYTES, ocrPdf } from './ocr'
import { MAX_MEDIA_BYTES } from './vimeo-media'
import { emptyStats, EvidenceBuilder, svgText, type Extraction } from './extract'
import { MAX_BYTES } from './formats'
import { ProcessingError, type Job } from './jobs'
import { extractionSchema } from './review'
import type { Processors } from './engine'
import { stageVimeoMedia } from './vimeo-media'
import { approvedModels, paidBlock, readSettings, type PaidStep } from './settings'

async function paid(db: Pool, step: PaidStep) {
  const blocked = await paidBlock(db, step, undefined, true)
  if (blocked) throw new ProcessingError(blocked)
}
const PAID_OFF = ['paid_processing_disabled', 'transcription_turned_off', 'tagging_turned_off', 'daily_paid_limit_reached', 'model_not_approved']
/** The AI model for pictures: the approved tagging model chosen in Automation settings. */
async function visionModel(db: Pool) {
  await paid(db, 'tagging')
  const model = (await readSettings(db)).taggingModel
  if (!approvedModels().includes(model)) throw new ProcessingError('model_not_approved')
  return model
}
function bucket() {
  if (!process.env.CONTENT_BUCKET) throw new ProcessingError('content_bucket_required')
  return process.env.CONTENT_BUCKET
}
export function runtimeProcessors(db: Pool): Processors {
  const current = async (job: Job) => {
    const { rows } = await db.query('SELECT source_hash,vimeo_id FROM content WHERE id=$1 AND source_hash=$2', [job.content_id, job.source_version])
    if (!rows[0]) throw new ProcessingError('source_version_mismatch')
    if ('videoId' in job.input && job.input.videoId && rows[0].vimeo_id !== job.input.videoId) {
      // Additional videos on the same item are valid sources too.
      const more = await db.query('SELECT 1 FROM content_more_videos WHERE _parent_id=$1 AND vimeo_id=$2', [job.content_id, job.input.videoId])
      if (!more.rowCount) throw new ProcessingError('vimeo_source_changed')
    }
    return rows[0]
  }
  const asset = async (job: Job, id: number) => {
    const { rows } = await db.query('SELECT object_key,sha256,mime_type FROM assets WHERE id=$1 AND content_id=$2 AND version=$3', [id, job.content_id, job.source_version])
    if (!rows[0]) throw new ProcessingError('asset_version_mismatch')
    contentKey(rows[0].object_key)
    return rows[0]
  }
  const wrap = async <T>(action: () => Promise<T>): Promise<T> => {
    try { return await action() } catch (error) {
      if (error instanceof ProcessingError) throw error
      const value = error as { name?: string; code?: string; retryable?: boolean; $metadata?: { httpStatusCode?: number } }
      // Log only fixed codes. Raw provider messages may contain signed URLs/text.
      if (value.$metadata?.httpStatusCode === 429 || (value.$metadata?.httpStatusCode ?? 0) >= 500 || ['ThrottlingException', 'TimeoutError', 'AbortError'].includes(value.name ?? '')) throw new ProcessingError('provider_temporarily_unavailable', true)
      if (value.retryable === true) throw new ProcessingError('provider_retryable_failure', true)
      throw new ProcessingError('provider_or_extraction_failed')
    }
  }
  return {
    extract: job => wrap(async () => {
      const content = await current(job)
      const input = job.input
      if (input.kind === 'classify' || input.kind === 'analyze') throw new ProcessingError('wrong_job_stage')
      if (input.kind === 'vimeo') {
        if (!input.videoId) throw new ProcessingError('vimeo_snapshot_required')
        // current() has confirmed this video belongs to the item (main player or "More videos").
        const videoId = input.videoId
        if (!/^\d+$/.test(videoId)) throw new ProcessingError('vimeo_id_required')
        if (!process.env.VIMEO_ACCESS_TOKEN) throw new ProcessingError('vimeo_configuration_required')
        const result = await getVimeoCaptions(videoId, process.env.VIMEO_ACCESS_TOKEN)
        if (result) return result
        await paid(db, 'transcription')
        const inputKey = await stageVimeoMedia(videoId, process.env.VIMEO_ACCESS_TOKEN, bucket(), job.idempotency_key)
        const speech = await transcribeMedia({ bucket: bucket(), inputKey, outputPrefix: 'processing/transcribe/', jobKey: job.idempotency_key, mediaFormat: 'mp4' })
        return speech.status === 'pending' ? null : speech.extraction
      }
      const file = await asset(job, input.assetId)
      const s3 = new S3Client({})
      if (input.kind === 'document' && input.format === 'pdf') {
        const ocr = async () => {
          await paid(db, 'transcription')
          const result = await ocrPdf({ bucket: bucket(), key: file.object_key, jobKey: job.idempotency_key })
          return result.status === 'pending' ? null : result.extraction
        }
        // Large PDFs skip the in-memory text layer and go straight to OCR (which also reads typed text).
        const { size } = await storedObject(s3, bucket(), file.object_key)
        if (size > MAX_DOCUMENT_BYTES) { await verifyOriginal(s3, bucket(), file.object_key, file.sha256, MAX_OCR_BYTES); return ocr() }
        const stats = emptyStats()
        let native
        try { native = await extractDocument(await readOriginal(s3, bucket(), file.object_key, file.sha256), 'pdf', stats) } catch (error) {
          if (error instanceof ProcessingError && error.code === 'pdf_requires_ocr') return ocr()
          throw error
        }
        if (!stats.emptyPages) return native
        // Some pages are scans: OCR the whole document when allowed; otherwise keep the typed text with its warning.
        try { return await ocr() } catch (error) {
          if (error instanceof ProcessingError && ['paid_processing_disabled', 'transcription_turned_off', 'daily_paid_limit_reached'].includes(error.code)) return native
          throw error
        }
      }
      if (input.kind === 'image') {
        const bytes = await readOriginal(s3, bucket(), file.object_key, file.sha256, MAX_BYTES[input.format])
        if (input.format === 'svg') { const out = new EvidenceBuilder('ae-svg/1'); svgText(bytes, out, 'Picture'); return out.finish() }
        const { pictureExtraction } = await import('./vision')
        return pictureExtraction(bytes, await visionModel(db))
      }
      if (input.kind === 'document') {
        const stats = emptyStats()
        const extraction = await extractDocument(await readOriginal(s3, bucket(), file.object_key, file.sha256, MAX_BYTES[input.format]), input.format, stats)
        if (!stats.images.length) return extraction
        // Picture-only slides and pictures in zip packets: AI vision when allowed; otherwise keep the text with a note.
        let model: string
        try { model = await visionModel(db) } catch (error) {
          if (!(error instanceof ProcessingError) || !PAID_OFF.includes(error.code)) throw error
          if (!extraction.passages.length) throw error
          return { ...extraction, warnings: [...extraction.warnings, `${stats.images.length} picture(s) were not read because AI processing is off or at its daily limit.`] } satisfies Extraction
        }
        const { appendPictures } = await import('./vision')
        return appendPictures(extraction, stats.images, model)
      }
      await paid(db, 'transcription')
      // Stage originals under immutable hashed keys. Reverify before paid processing (up to Transcribe's 2 GB).
      await verifyOriginal(s3, bucket(), file.object_key, file.sha256, MAX_MEDIA_BYTES)
      const result = await transcribeMedia({ bucket: bucket(), inputKey: file.object_key, outputPrefix: 'processing/transcribe/', jobKey: job.idempotency_key })
      return result.status === 'pending' ? null : result.extraction
    }),
    analyze: job => wrap(async () => {
      await current(job); await paid(db, 'tagging')
      if (job.input.kind !== 'analyze' || !approvedModels().includes(job.input.modelId)) throw new ProcessingError('model_not_approved')
      const { analyzeItem } = await import('./analyze-runtime')
      return analyzeItem(db, job)
    }),
    classify: job => wrap(async () => {
      await current(job); await paid(db, 'tagging')
      const input = job.input
      if (input.kind !== 'classify' || !approvedModels().includes(input.modelId)) throw new ProcessingError('model_not_approved')
      const { rows } = await db.query(`SELECT result,input FROM processing_jobs WHERE id=$1 AND content_id=$2 AND source_version=$3 AND state='succeeded' AND stage IN ('extract','transcribe')`,
      [input.extractionJobId, job.content_id, job.source_version])
      const extraction = extractionSchema.parse(rows[0]?.result)
      if (rows[0].input?.videoId !== input.videoId) throw new ProcessingError('vimeo_source_changed')
      const proposal = await classify(extraction, input.taxonomy, input.modelId)
      return { extraction, proposal }
    }),
  }
}
