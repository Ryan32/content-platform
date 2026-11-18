import type { Pool } from 'pg'
import { S3Client } from '@aws-sdk/client-s3'
import { extractDocument } from './extract'
import { getVimeoCaptions, classify, transcribeMedia } from './providers'
import { readOriginal, contentKey } from './storage'
import { ProcessingError, type Job } from './jobs'
import { extractionSchema } from './review'
import type { Processors } from './engine'
import { stageVimeoMedia } from './vimeo-media'

function paid() {
  if (process.env.ALLOW_PAID_PROCESSING !== 'true') throw new ProcessingError('paid_processing_disabled')
}
function bucket() {
  if (!process.env.CONTENT_BUCKET) throw new ProcessingError('content_bucket_required')
  return process.env.CONTENT_BUCKET
}
export function runtimeProcessors(db: Pool): Processors {
  const current = async (job: Job) => {
    const { rows } = await db.query('SELECT source_hash,vimeo_id FROM content WHERE id=$1 AND source_hash=$2', [job.content_id, job.source_version])
    if (!rows[0]) throw new ProcessingError('source_version_mismatch')
    if ('videoId' in job.input && job.input.videoId && rows[0].vimeo_id !== job.input.videoId) throw new ProcessingError('vimeo_source_changed')
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
      if (input.kind === 'classify') throw new ProcessingError('wrong_job_stage')
      if (input.kind === 'vimeo') {
        if (!input.videoId) throw new ProcessingError('vimeo_snapshot_required')
        if (!content.vimeo_id || !/^\d+$/.test(content.vimeo_id)) throw new ProcessingError('vimeo_id_required')
        if (!process.env.VIMEO_ACCESS_TOKEN) throw new ProcessingError('vimeo_configuration_required')
        const result = await getVimeoCaptions(content.vimeo_id, process.env.VIMEO_ACCESS_TOKEN)
        if (result) return result
        paid()
        const inputKey = await stageVimeoMedia(content.vimeo_id, process.env.VIMEO_ACCESS_TOKEN, bucket(), job.idempotency_key)
        const speech = await transcribeMedia({ bucket: bucket(), inputKey, outputPrefix: 'processing/transcribe/', jobKey: job.idempotency_key, mediaFormat: 'mp4' })
        return speech.status === 'pending' ? null : speech.extraction
      }
      const file = await asset(job, input.assetId)
      if (input.kind === 'document') return extractDocument(await readOriginal(new S3Client({}), bucket(), file.object_key, file.sha256), input.format)
      paid()
      // Stage originals under immutable hashed keys. Reverify bytes before paid processing.
      await readOriginal(new S3Client({}), bucket(), file.object_key, file.sha256)
      const result = await transcribeMedia({ bucket: bucket(), inputKey: file.object_key, outputPrefix: 'processing/transcribe/', jobKey: job.idempotency_key })
      return result.status === 'pending' ? null : result.extraction
    }),
    classify: job => wrap(async () => {
      await current(job); paid()
      const input = job.input
      if (input.kind !== 'classify' || !process.env.BEDROCK_MODEL_ID || input.modelId !== process.env.BEDROCK_MODEL_ID) throw new ProcessingError('model_not_approved')
      const { rows } = await db.query(`SELECT result,input FROM processing_jobs WHERE id=$1 AND content_id=$2 AND source_version=$3 AND state='succeeded' AND stage IN ('extract','transcribe')`,
      [input.extractionJobId, job.content_id, job.source_version])
      const extraction = extractionSchema.parse(rows[0]?.result)
      if (rows[0].input?.videoId !== input.videoId) throw new ProcessingError('vimeo_source_changed')
      const proposal = await classify(extraction, input.taxonomy, input.modelId)
      return { extraction, proposal }
    }),
  }
}
