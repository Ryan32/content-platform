import type { Pool } from 'pg'
import type { JobStore } from './jobs'
import { PROCESSOR } from './jobs'
import { approvedModels, paidBlock, type AutomationSettings } from './settings'

const DOCUMENT_FORMATS = ['pdf', 'docx', 'pptx', 'xlsx', 'vtt', 'txt'] as const
const MEDIA = /\.(mp3|mp4|wav|flac|m4a|ogg|webm)$/
const ANALYZABLE = [...DOCUMENT_FORMATS, 'mp3', 'mp4', 'wav', 'flac', 'm4a', 'ogg', 'webm']

export interface ReconcileResult { queued: number; waiting: Record<string, number> }

/**
 * Queues the next automatic step for current, unpublished material: extraction for new files, captions for Vimeo IDs,
 * and one combined AI analysis per item once all its sources have finished. Idempotent: existing jobs (including failures) are never re-queued here.
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
    // One combined analysis per item once every source of its current version has finished (succeeded or failed):
    // all its files, its Vimeo video and its article text. A changed set of results (e.g. a retried file) re-analyzes.
    const ready = await db.query(`WITH items AS (
        SELECT c.id, c.source_hash, c.vimeo_id FROM content c
        WHERE c.state IN ('intake','draft') AND c.source_hash IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM processing_jobs j WHERE j.content_id=c.id AND j.source_version=c.source_hash
          AND j.stage IN ('extract','transcribe') AND j.state IN ('queued','running'))
        AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.content_id=c.id AND a.version=c.source_hash
          AND lower(substring(a.object_key from '\\.([A-Za-z0-9]+)$')) = ANY($2::text[])
          AND NOT EXISTS (SELECT 1 FROM processing_jobs j WHERE j.content_id=c.id AND j.source_version=c.source_hash AND (j.input->>'assetId')::int=a.id))
        AND NOT ($3::boolean AND COALESCE(c.vimeo_id, '') ~ '^[1-9][0-9]{0,19}$' AND NOT EXISTS (SELECT 1 FROM processing_jobs j WHERE j.content_id=c.id
          AND j.source_version=c.source_hash AND j.input->>'kind'='vimeo' AND j.input->>'videoId'=c.vimeo_id))
        AND NOT EXISTS (SELECT 1 FROM suggestions s WHERE s.content_id=c.id AND s.source_version=c.source_hash AND s.decision='accepted')
        AND ((COALESCE(btrim(c.body),'')<>'' AND c.evidence_version='unprocessed') OR EXISTS (SELECT 1 FROM processing_jobs j
          WHERE j.content_id=c.id AND j.source_version=c.source_hash AND j.stage IN ('extract','transcribe') AND j.state='succeeded'))
      ), sourced AS (
        SELECT i.id, i.source_hash, i.vimeo_id,
          COALESCE(array_agg(j.id ORDER BY j.id) FILTER (WHERE j.id IS NOT NULL), '{}') AS job_ids,
          COALESCE(string_agg(j.id || ':' || j.state, ',' ORDER BY j.id), '') AS digest
        FROM items i LEFT JOIN processing_jobs j ON j.content_id=i.id AND j.source_version=i.source_hash
          AND j.stage IN ('extract','transcribe') AND j.processor_version=$4 AND j.state IN ('succeeded','failed')
        GROUP BY i.id, i.source_hash, i.vimeo_id
      )
      SELECT * FROM sourced s WHERE NOT EXISTS (SELECT 1 FROM processing_jobs k WHERE k.content_id=s.id AND k.source_version=s.source_hash
        AND k.input->>'kind'='analyze' AND k.input->>'sourceDigest'=s.digest)
      ORDER BY s.id LIMIT $1`, [batch, [...ANALYZABLE], settings.vimeoEnabled, PROCESSOR])
    if (ready.rows.length) {
      const model = settings.taggingModel
      const [terms, carriers] = await Promise.all([
        db.query(`SELECT id, label, COALESCE(definition,'') AS definition, dimension FROM taxonomy WHERE dimension = ANY($1) ORDER BY id LIMIT 500`, [settings.taggingDimensions]),
        db.query('SELECT id, name FROM carriers ORDER BY name LIMIT 500'),
      ])
      for (const item of ready.rows) {
        if (!approvedModels().includes(model)) { wait('model_not_approved'); continue }
        const blocked = await paidBlock(db, 'tagging', settings)
        if (blocked) { wait(blocked); continue }
        await store.enqueue(item.id, item.source_hash, { kind: 'analyze', modelId: model, sourceJobIds: item.job_ids.map(Number), sourceDigest: item.digest,
          ...(item.vimeo_id && /^[1-9][0-9]{0,19}$/.test(item.vimeo_id) ? { videoId: item.vimeo_id } : {}),
          taxonomy: terms.rows.map(t => ({ id: Number(t.id), label: t.label, definition: t.definition, dimension: t.dimension })),
          carriers: carriers.rows.map(c => ({ id: Number(c.id), name: String(c.name) })) })
        result.queued++
      }
    }
  }
  return result
}
