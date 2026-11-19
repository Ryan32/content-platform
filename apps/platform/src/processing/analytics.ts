import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose'

/**
 * Analytics for AI/ML: append-only rows for the Iceberg tables in Amazon S3 Tables, read in place by Snowflake.
 * Rows are first written to the analytics_outbox table (in the same database, often the same transaction as the change
 * they describe), then shipped by the worker to one Amazon Data Firehose stream per Iceberg table. A row is marked
 * shipped only after Firehose accepted it, so a Firehose outage delays analytics but never loses it.
 *
 * Streams / Iceberg tables (namespace `library`):
 *   events       job lifecycle, review decisions (field by field), publication and other domain events
 *   model_calls  every model call: purpose, model, prompt version, tokens, latency, evidence key (full text in evidence/)
 *   evidence     manifest of every raw provider output and full extraction kept under evidence/
 *   chunks       every searchable chunk with source, weight, text and embedding
 *   items        a snapshot of an item each time it is analyzed, reviewed or indexed
 */
export const STREAMS = ['events', 'model_calls', 'evidence', 'chunks', 'items'] as const
export type Stream = typeof STREAMS[number]
type Db = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

export interface OutboxRow { stream: Stream; event: string; contentId?: number | null; jobId?: number | null; actor?: string | null; data: Record<string, unknown> }

/** Writes analytics rows. Pass a transaction client to record them atomically with the change they describe. */
export async function emit(db: Db, rows: OutboxRow | OutboxRow[]) {
  const list = Array.isArray(rows) ? rows : [rows]
  if (!list.length) return
  const values: unknown[] = []
  const tuples = list.map((r, i) => {
    values.push(r.stream, r.event, r.contentId ?? null, r.jobId ?? null, r.actor ?? null, JSON.stringify(r.data))
    const o = i * 6
    return `($${o + 1}::varchar, $${o + 2}::varchar, $${o + 3}::integer, $${o + 4}::integer, $${o + 5}::varchar, $${o + 6}::jsonb)`
  })
  await db.query(`INSERT INTO analytics_outbox (stream, event, content_id, job_id, actor, data) VALUES ${tuples.join(', ')}`, values)
}

/** Staff identity for analytics: internal user ID only (no names or emails). */
export const actorOf = (user: { id?: unknown } | null | undefined) => user?.id != null ? `user:${user.id}` : null

/** Stream name -> Firehose delivery stream (configured per environment). */
export function firehoseStreams(env = process.env): Partial<Record<Stream, string>> {
  const prefix = env.ANALYTICS_FIREHOSE_PREFIX?.trim()
  return prefix ? Object.fromEntries(STREAMS.map(s => [s, `${prefix}-${s.replace('_', '-')}`])) : {}
}

export interface Shipper { put(stream: string, records: string[]): Promise<boolean[]> }
export function firehoseShipper(client = new FirehoseClient({})): Shipper {
  return {
    async put(stream, records) {
      const result = await client.send(new PutRecordBatchCommand({ DeliveryStreamName: stream, Records: records.map(r => ({ Data: Buffer.from(r + '\n') })) }))
      return (result.RequestResponses ?? records.map(() => ({ ErrorCode: undefined }))).map(r => !r.ErrorCode)
    },
  }
}

/**
 * One flat JSON record per row. Firehose maps top-level fields to Iceberg columns by name and drops unknown ones, so
 * every record also carries the complete row as `payload` (JSON text): nothing is lost to a column mapping. Nested
 * values become JSON text columns; the chunk `embedding` stays a list of floats.
 */
export function toRecord(row: { id: string | number; occurred_at: string | Date; stream: string; event: string; content_id: number | null; job_id: number | null; actor: string | null; data: unknown }) {
  const data = (row.data ?? {}) as Record<string, unknown>
  const flat = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, k === 'embedding' || v === null || typeof v !== 'object' ? v : JSON.stringify(v)]))
  const { embedding: _, ...rest } = data
  return JSON.stringify({ ...flat, outbox_id: Number(row.id), occurred_at: new Date(row.occurred_at).toISOString(), event: row.event,
    content_id: row.content_id, job_id: row.job_id, actor: row.actor, environment: process.env.ANALYTICS_ENVIRONMENT ?? 'dev', payload: JSON.stringify(rest) })
}

/**
 * Ships pending rows (oldest first, bounded) and prunes rows shipped more than 7 days ago. Firehose accepts at most
 * 500 records / 4 MiB per batch and 1,000 KiB per record; oversized rows are trimmed to their metadata and flagged.
 */
export async function shipOutbox(db: Db, shipper: Shipper, streams = firehoseStreams(), batch = 400) {
  const shipped: Record<string, number> = {}
  for (const stream of STREAMS) {
    const target = streams[stream]
    if (!target) continue
    const { rows } = await db.query(`SELECT id, occurred_at, stream, event, content_id, job_id, actor, data FROM analytics_outbox
      WHERE stream=$1 AND shipped_at IS NULL ORDER BY id LIMIT $2`, [stream, batch])
    if (!rows.length) continue
    const accepted: number[] = []
    let chunk: { id: number; record: string }[] = [], size = 0
    const flush = async () => {
      if (!chunk.length) return
      // A missing stream or outage leaves rows pending for the next pass; it never stops the worker.
      const ok = await shipper.put(target, chunk.map(c => c.record)).catch(() => chunk.map(() => false))
      chunk.forEach((c, i) => { if (ok[i]) accepted.push(c.id) })
      chunk = []; size = 0
    }
    for (const row of rows) {
      let record = toRecord(row)
      if (Buffer.byteLength(record) > 1000 * 1024) record = toRecord({ ...row, data: { oversized: true, bytes: Buffer.byteLength(record) } })
      if (size + Buffer.byteLength(record) > 3.5 * 1024 * 1024 || chunk.length >= 500) await flush()
      chunk.push({ id: Number(row.id), record }); size += Buffer.byteLength(record)
    }
    await flush()
    if (accepted.length) await db.query('UPDATE analytics_outbox SET shipped_at=now() WHERE id = ANY($1::bigint[])', [accepted])
    shipped[stream] = accepted.length
  }
  await db.query(`DELETE FROM analytics_outbox WHERE shipped_at < now() - interval '7 days'`)
  return shipped
}
