import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

/**
 * Lossless evidence: every raw provider output (Textract, Transcribe, Vimeo captions, model requests/responses) and
 * every full extraction is kept as returned, gzipped, in the private bucket under evidence/ (no expiry), and listed in
 * evidence_artifacts. Keys are content-addressed, so retries never duplicate. This is what later reprocessing and the
 * Snowflake/ML export read; nothing here is shown to readers or used for access decisions.
 */
export type EvidenceKind = 'extraction' | 'textract' | 'transcribe' | 'vimeo-captions' | 'model-call'
export interface EvidenceRecord {
  kind: EvidenceKind; processor: string; contentId: number; jobId?: number; assetId?: number; model?: string
  body: unknown; meta?: Record<string, unknown>
}
export interface EvidenceSink { save(record: EvidenceRecord): Promise<{ key: string; sha256: string; bytes: number } | null> }

type Db = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> }

export function evidenceKey(record: Pick<EvidenceRecord, 'kind' | 'processor' | 'contentId'>, sha256: string) {
  const processor = record.processor.replace(/[^a-z0-9.-]/gi, '_').slice(0, 60)
  return `evidence/${record.contentId}/${record.kind}/${processor}/${sha256}.json.gz`
}

export function s3EvidenceSink(db: Db, bucket: string, s3 = new S3Client({})): EvidenceSink {
  return {
    async save(record) {
      const json = Buffer.from(typeof record.body === 'string' ? record.body : JSON.stringify(record.body))
      const sha256 = createHash('sha256').update(json).digest('hex')
      const key = evidenceKey(record, sha256)
      const body = gzipSync(json)
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/json', ContentEncoding: 'gzip',
        ServerSideEncryption: 'AES256', Metadata: { sha256 }, IfNoneMatch: '*' })).catch(error => {
        if (error?.$metadata?.httpStatusCode !== 412) throw error   // same bytes already stored
      })
      await db.query(`INSERT INTO evidence_artifacts (content_id, job_id, asset_id, kind, processor, model, s3_key, sha256, bytes, meta)
        VALUES ($1::integer, $2::integer, $3::integer, $4::varchar, $5::varchar, $6::varchar, $7::varchar, $8::varchar, $9::bigint, $10::jsonb)
        ON CONFLICT (s3_key) DO NOTHING`,
      [record.contentId, record.jobId ?? null, record.assetId ?? null, record.kind, record.processor, record.model ?? null, key, sha256, json.length,
        JSON.stringify(record.meta ?? {})])
      return { key, sha256, bytes: json.length }
    },
  }
}
/** For tests and environments without storage: evidence is skipped, never fatal. */
export const noEvidence: EvidenceSink = { save: async () => null }

/** One model call, as recorded for evidence and analytics (prompt, response, usage, latency). */
export interface ModelCall {
  purpose: 'analysis' | 'classification' | 'vision'; promptVersion: string; modelId: string
  request: unknown; response: unknown; stopReason?: string
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; latencyMs: number
}
export type ModelRecorder = (call: ModelCall) => void
