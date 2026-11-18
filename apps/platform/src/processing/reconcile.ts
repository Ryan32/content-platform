import type { Pool } from 'pg'
import type { JobStore } from './jobs'
import { PROCESSOR } from './jobs'
import { approvedModels, paidBlock, type AutomationSettings } from './settings'

const DOCUMENT_FORMATS = ['pdf', 'docx', 'pptx', 'xlsx', 'vtt', 'txt'] as const
const MEDIA = /\.(mp3|mp4|wav|flac|m4a|ogg|webm)$/

export interface ReconcileResult { queued: number; waiting: Record<string, number> }

/**
 * Queues the next automatic step for current, unpublished material: extraction for new files, captions for Vimeo IDs,
 * and AI tagging after extraction. Idempotent: existing jobs (including failures) are never re-queued here.
 */
export async function reconcile(db: Pool, store: JobStore, settings: AutomationSettings, batch = 20): Promise<ReconcileResult> {
  const result: ReconcileResult = { queued: 0, waiting: {} }
  const wait = (reason: string) => { result.waiting[reason] = (result.waiting[reason] ?? 0) + 1 }
  if (settings.paused) return result

  const files = await db.query(`SELECT a.id, a.content_id, a.object_key, c.source_hash FROM assets a
    JOIN content c ON c.id=a.content_id AND a.version=c.source_hash
    WHERE c.state IN ('intake','draft') AND NOT EXISTS (SELECT 1 FROM processing_jobs j
      WHERE j.content_id=a.content_id AND j.source_version=c.source_hash AND (j.input->>'assetId')::int=a.id)
    ORDER BY a.id LIMIT $1`, [batch])
  for (const file of files.rows) {
    const extension = String(file.object_key).split('.').pop()?.toLowerCase() ?? ''
    if ((DOCUMENT_FORMATS as readonly string[]).includes(extension)) {
      if (!settings.documentsEnabled) { wait('documents_turned_off'); continue }
      await store.enqueue(file.content_id, file.source_hash, { kind: 'document', assetId: file.id, format: extension })
    } else if (MEDIA.test(`.${extension}`)) {
      const blocked = await paidBlock(db, 'transcription', settings)
      if (blocked) { wait(blocked); continue }
      await store.enqueue(file.content_id, file.source_hash, { kind: 'transcribe', assetId: file.id })
    } else { wait('unsupported_file_type'); continue }
    result.queued++
  }

  if (settings.vimeoEnabled) {
    const videos = await db.query(`SELECT c.id, c.source_hash, c.vimeo_id FROM content c
      WHERE c.vimeo_id ~ '^[1-9][0-9]{0,19}$' AND c.source_hash IS NOT NULL AND c.state IN ('intake','draft')
      AND NOT EXISTS (SELECT 1 FROM processing_jobs j WHERE j.content_id=c.id AND j.source_version=c.source_hash
        AND j.input->>'kind'='vimeo' AND j.input->>'videoId'=c.vimeo_id)
      ORDER BY c.id LIMIT $1`, [batch])
    for (const video of videos.rows) {
      await store.enqueue(video.id, video.source_hash, { kind: 'vimeo', videoId: video.vimeo_id })
      result.queued++
    }
  }

  if (settings.taggingEnabled) {
    const extracted = await db.query(`SELECT j.id, j.content_id, j.source_version, j.input->>'videoId' AS video_id FROM processing_jobs j
      JOIN content c ON c.id=j.content_id AND c.source_hash=j.source_version
      WHERE j.state='succeeded' AND j.stage IN ('extract','transcribe') AND j.processor_version=$1 AND c.state IN ('intake','draft')
      AND NOT EXISTS (SELECT 1 FROM processing_jobs k WHERE k.content_id=j.content_id AND k.stage='classify'
        AND (k.input->>'extractionJobId')::int=j.id)
      ORDER BY j.id LIMIT $2`, [PROCESSOR, batch])
    if (extracted.rows.length) {
      const model = settings.taggingModel
      const terms = await db.query(`SELECT id, label, COALESCE(definition,'') AS definition, dimension FROM taxonomy
        WHERE dimension = ANY($1) ORDER BY id LIMIT 500`, [settings.taggingDimensions])
      for (const job of extracted.rows) {
        if (!approvedModels().includes(model)) { wait('model_not_approved'); continue }
        if (!terms.rows.length) { wait('no_tags_defined'); continue }
        const blocked = await paidBlock(db, 'tagging', settings)
        if (blocked) { wait(blocked); continue }
        await store.enqueue(job.content_id, job.source_version, { kind: 'classify', extractionJobId: Number(job.id), modelId: model,
          ...(job.video_id ? { videoId: job.video_id } : {}),
          taxonomy: terms.rows.map(t => ({ id: Number(t.id), label: t.label, definition: t.definition, dimension: t.dimension })) })
        result.queued++
      }
    }
  }
  return result
}
