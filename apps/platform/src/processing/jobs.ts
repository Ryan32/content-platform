import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { DOCUMENT_FORMATS, IMAGE_FORMATS } from './formats'

export const PROCESSOR = 'ae-processing/1'
export const inputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('document'), assetId: z.number().int().positive(), format: z.enum(DOCUMENT_FORMATS) }).strict(),
  // Pictures: SVG text is free; raster images are read by AI vision (a paid step).
  z.object({ kind: z.literal('image'), assetId: z.number().int().positive(), format: z.enum(IMAGE_FORMATS) }).strict(),
  z.object({ kind: z.literal('vimeo'), videoId: z.string().regex(/^\d+$/).optional() }).strict(),
  z.object({ kind: z.literal('transcribe'), assetId: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('classify'), extractionJobId: z.number().int().positive(), modelId: z.string().min(1).max(250),
    videoId: z.string().regex(/^\d+$/).optional(),
    taxonomy: z.array(z.object({ id: z.number().int().positive(), label: z.string().max(200), definition: z.string().max(1000), dimension: z.string().max(50) }).strict()).min(1).max(500),
  }).strict(),
  // One combined analysis of every source of an item. sourceJobIds pins the exact extraction results it reads.
  z.object({ kind: z.literal('analyze'), modelId: z.string().min(1).max(250), sourceJobIds: z.array(z.number().int().positive()).max(60), sourceDigest: z.string().max(4000),
    videoId: z.string().regex(/^\d+$/).optional(),
    taxonomy: z.array(z.object({ id: z.number().int().positive(), label: z.string().max(200), definition: z.string().max(1000), dimension: z.string().max(50) }).strict()).max(500),
    carriers: z.array(z.object({ id: z.number().int().positive(), name: z.string().max(200) }).strict()).max(500),
  }).strict(),
])
export type JobInput = z.infer<typeof inputSchema>
export interface Job { id: number; content_id: number; source_version: string; idempotency_key: string;
  attempts: number; input: JobInput; lease_token: string; deadline_at: string }
export class ProcessingError extends Error {
  constructor(public code: string, public retryable = false) { super(code) }
}
export function jobKey(content: number, source: string, input: JobInput) {
  return createHash('sha256').update(JSON.stringify({ content, source, processor: PROCESSOR, input })).digest('hex')
}
export class JobStore {
  constructor(public pool: Pool) {}
  async enqueue(contentId: number, sourceVersion: string, value: unknown) {
    const input = inputSchema.parse(value)
    const key = jobKey(contentId, sourceVersion, input)
    const stage = input.kind === 'classify' || input.kind === 'analyze' ? 'classify' : input.kind === 'transcribe' ? 'transcribe' : 'extract'
    // Explicit casts: PostgreSQL cannot infer one type for a parameter used in both the select list and WHERE.
    const { rows } = await this.pool.query(`INSERT INTO processing_jobs
      (idempotency_key,content_id,source_version,stage,state,attempts,input,processor_version,next_run_at,deadline_at)
      SELECT $1::varchar,id,$3::varchar,$4::enum_processing_jobs_stage,'queued',0,$5::jsonb,$6::varchar,now(),now()+interval '24 hours'
      FROM content WHERE id=$2::integer AND source_hash=$3::varchar
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id`,
    [key, contentId, sourceVersion, stage, JSON.stringify(input), PROCESSOR])
    if (!rows[0]) throw new ProcessingError('source_version_mismatch')
    return Number(rows[0].id)
  }
  async claim(): Promise<Job | null> {
    // Expired jobs and exhausted retries remain visible; crashes cannot strand running rows forever.
    await this.pool.query(`UPDATE processing_jobs SET state='failed',error_code='retry_or_deadline_exhausted',lease_token=NULL,lease_until=NULL
      WHERE processor_version=$1 AND state IN ('queued','running') AND (deadline_at < now() OR (attempts>=5 AND (lease_until IS NULL OR lease_until<now())))`, [PROCESSOR])
    const { rows } = await this.pool.query(`WITH candidate AS (
      SELECT id FROM processing_jobs WHERE processor_version=$1 AND attempts<5 AND deadline_at>now()
      AND ((state='queued' AND next_run_at<=now()) OR (state='running' AND lease_until<now()))
      ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE processing_jobs j SET state='running',attempts=j.attempts+1,lease_token=$2,
      lease_until=now()+interval '5 minutes',updated_at=now() FROM candidate WHERE j.id=candidate.id RETURNING j.*`, [PROCESSOR, randomUUID()])
    return rows[0] ?? null
  }
  async heartbeat(job: Job) {
    const r = await this.pool.query(`UPDATE processing_jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING id`, [job.id, job.lease_token])
    if (!r.rowCount) throw new ProcessingError('lease_lost')
  }
  async finish(job: Job, result: unknown, proposal?: { model: string; data: unknown }) {
    const db = await this.pool.connect()
    try {
      await db.query('BEGIN')
      const r = await db.query(`UPDATE processing_jobs SET state='succeeded',result=$3,lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=now()
        WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() RETURNING id`, [job.id, job.lease_token, JSON.stringify(result)])
      if (!r.rowCount) throw new ProcessingError('lease_lost')
      // Current source must still match at completion. Derived data never patches content.
      const current = await db.query(`SELECT id FROM content WHERE id=$1 AND source_hash=$2 AND ($3::text IS NULL OR vimeo_id=$3
        OR EXISTS (SELECT 1 FROM content_more_videos m WHERE m._parent_id=content.id AND m.vimeo_id=$3)) FOR SHARE`,
        [job.content_id, job.source_version, 'videoId' in job.input ? job.input.videoId ?? null : null])
      if (!current.rowCount) throw new ProcessingError('source_version_mismatch')
      if (proposal) await db.query(`INSERT INTO suggestions (job_key,content_id,source_version,model,proposal,decision)
        VALUES ($1,$2,$3,$4,$5,'pending') ON CONFLICT (job_key) DO NOTHING`,
      [job.idempotency_key, job.content_id, job.source_version, proposal.model, JSON.stringify(proposal.data)])
      await db.query('COMMIT')
    } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
  }
  async defer(job: Job) {
    // Provider polling is not a failed attempt. Deadline still caps total waiting.
    await this.pool.query(`UPDATE processing_jobs SET state='queued',attempts=GREATEST(0,attempts-1),next_run_at=now()+interval '60 seconds',
      lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now()`, [job.id, job.lease_token])
  }
  async fail(job: Job, error: unknown) {
    const known = error instanceof ProcessingError
    const retry = known && error.retryable && job.attempts < 5
    await this.pool.query(`UPDATE processing_jobs SET state=$3::enum_processing_jobs_state,error_code=$4,next_run_at=now()+($5::integer * interval '1 second'),
      lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now()`,
    [job.id, job.lease_token, retry ? 'queued' : 'failed', known ? error.code : 'processing_failed', Math.min(900, 30 * 2 ** job.attempts)])
  }
  async retry(id: number) {
    const r = await this.pool.query(`UPDATE processing_jobs SET state='queued',attempts=0,error_code=NULL,next_run_at=now(),deadline_at=now()+interval '24 hours'
      WHERE id=$1 AND state='failed' AND processor_version=$2 RETURNING id`, [id, PROCESSOR])
    if (!r.rowCount) throw new ProcessingError('job_not_retryable')
  }
}
