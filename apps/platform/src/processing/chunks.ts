import { createHash } from 'node:crypto'
import { T } from '../db/payload-schema'
import { embeddingModel, vectorLiteral, type Embed } from './embeddings'
import { emit, type OutboxRow } from './analytics'

/**
 * The search index keeps everything on an item and weights it by where it came from (owner decision, 2026-11-18):
 * curated fields rank highest, then document text, then transcripts, OCR and picture readings. Nothing is dropped;
 * a word that only appears in minute 47 of a webinar is still found, it just ranks below the same word in a title.
 */
export const SOURCE_WEIGHTS = {
  title: 3.0, summary: 2.5, takeaway: 2.0, tag: 2.0, file: 2.0,
  article: 1.2, document: 1.0, slides: 1.0, sheet: 0.9, captions: 0.9, transcript: 0.8, ocr: 0.7, vision: 0.6,
} as const
export type ChunkSource = keyof typeof SOURCE_WEIGHTS
export const CHUNK_CHARS = 3500, CHUNK_OVERLAP = 400

export interface ChunkInput {
  title: string; description: string; takeaways: string[]; tags: string[]
  files: { assetId: number; name: string; description?: string | null; mimeType: string }[]
  passages: { citationId: string; text: string; locator: string; assetId?: number | null }[]
  evidenceVersion: string
}
export interface Chunk { seq: number; source: ChunkSource; weight: number; assetId: number | null; citationId: string | null; locator: string; text: string }

/** Where a passage came from, from its locator and file type (set by the extractors and the analysis). */
export function sourceOf(locator: string, mimeType?: string): ChunkSource {
  if (/\(OCR\)/.test(locator)) return 'ocr'
  if (/\(picture\)|· description$|· text in picture$|^Picture\b/i.test(locator)) return 'vision'
  if (/^Article text\b/.test(locator)) return 'article'
  if (/\d{2}:\d{2}(:\d{2})?\.\d{3} – /.test(locator)) return 'captions'
  if (/\d+(\.\d+)?s – \d/.test(locator) || /^Vimeo\b/.test(locator)) return 'transcript'
  if (/· Slide \d|^Slide \d/.test(locator)) return 'slides'
  if (/· Sheet |^Sheet /.test(locator)) return 'sheet'
  if (mimeType?.startsWith('audio/') || mimeType?.startsWith('video/')) return 'transcript'
  return 'document'
}

/** Splits long text at sentence or word boundaries into overlapping windows. */
export function windows(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= size) return clean ? [clean] : []
  const out: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size)
    if (end < clean.length) {
      const cut = Math.max(clean.lastIndexOf('. ', end), clean.lastIndexOf('? ', end), clean.lastIndexOf('! ', end))
      end = cut > start + size * 0.6 ? cut + 1 : Math.max(clean.lastIndexOf(' ', end), start + Math.floor(size * 0.6))
    }
    out.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return out.filter(Boolean)
}

export function buildChunks(input: ChunkInput): { version: string; chunks: Chunk[] } {
  const chunks: Chunk[] = []
  const add = (source: ChunkSource, text: string, locator: string, assetId: number | null = null, citationId: string | null = null) => {
    for (const piece of windows(text)) chunks.push({ seq: chunks.length, source, weight: SOURCE_WEIGHTS[source], assetId, citationId, locator: locator.slice(0, 200), text: piece })
  }
  add('title', input.title, 'Title')
  if (input.description.trim()) add('summary', input.description, 'Summary')
  if (input.takeaways.length) add('takeaway', input.takeaways.join(' • '), 'Key takeaways')
  if (input.tags.length) add('tag', input.tags.join(', '), 'Tags')
  for (const f of input.files) add('file', [f.name, f.description].filter(Boolean).join('. '), f.name, f.assetId)
  // Consecutive short passages from the same source (e.g. 30-second transcript segments) are merged into fuller windows.
  const mime = new Map(input.files.map(f => [f.assetId, f.mimeType]))
  let group: ChunkInput['passages'] = []
  const flush = () => {
    if (!group.length) return
    const first = group[0], last = group[group.length - 1]
    const source = sourceOf(first.locator, first.assetId ? mime.get(first.assetId) : undefined)
    const locator = group.length > 1 && first.locator !== last.locator ? `${first.locator} → ${last.locator.split(' · ').pop()}` : first.locator
    add(source, group.map(p => p.text).join(' '), locator, first.assetId ?? null, first.citationId)
    group = []
  }
  for (const p of input.passages) {
    const head = group[0]
    const sameSource = head && head.assetId === p.assetId && sourceOf(head.locator) === sourceOf(p.locator) && head.locator.split(' · ')[0] === p.locator.split(' · ')[0]
    if (!sameSource || group.reduce((n, g) => n + g.text.length, 0) + p.text.length > CHUNK_CHARS) flush()
    group.push(p)
  }
  flush()
  const version = createHash('sha256').update(JSON.stringify({ v: 1, e: input.evidenceVersion, c: chunks.map(c => [c.source, c.assetId, c.citationId, c.text]) })).digest('hex').slice(0, 32)
  return { version, chunks }
}

type Db = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>; connect?: () => Promise<{ query: Db['query']; release(): void }> }

async function loadItem(db: Db, id: number): Promise<ChunkInput & { state: string } | null> {
  const { rows: [c] } = await db.query(`SELECT id, title, COALESCE(description,'') AS description, evidence_version, state, source_hash FROM content WHERE id=$1`, [id])
  if (!c) return null
  const [takeaways, tags, files, passages] = await Promise.all([
    db.query(`SELECT text FROM ${T.content_takeaways} WHERE _parent_id=$1 ORDER BY _order`, [id]),
    db.query(`SELECT t.label FROM ${T.content_rels} r JOIN taxonomy t ON t.id=r.taxonomy_id WHERE r.parent_id=$1 AND r.path='acceptedTags' ORDER BY r."order"`, [id]),
    db.query(`SELECT id, file_name, description, mime_type FROM assets WHERE content_id=$1 AND version=$2 AND COALESCE(role,'download')='download' ORDER BY id`, [id, c.source_hash]),
    db.query(`SELECT citation_id, text, locator, asset_id FROM ${T.content_passages} WHERE _parent_id=$1 AND version=$2 ORDER BY _order`, [id, c.evidence_version]),
  ])
  return { title: c.title, description: c.description, state: c.state, evidenceVersion: c.evidence_version,
    takeaways: takeaways.rows.map(r => String(r.text)), tags: tags.rows.map(r => String(r.label)),
    files: files.rows.map(r => ({ assetId: Number(r.id), name: r.file_name ?? 'File', description: r.description, mimeType: r.mime_type })),
    passages: passages.rows.map(r => ({ citationId: r.citation_id, text: r.text, locator: r.locator, assetId: r.asset_id == null ? null : Number(r.asset_id) })) }
}

/**
 * Worker step: rebuild chunks for Draft/Published items whose title, summary, takeaways, tags, file descriptions or
 * evidence changed, and drop chunks of items that left Draft/Published. Bounded per pass; idempotent.
 */
export async function syncChunks(db: Db, batch = 10) {
  const dropped = await db.query(`DELETE FROM search_chunk_state s USING content c WHERE s.content_id=c.id AND c.state NOT IN ('draft','published')`)
  await db.query(`DELETE FROM search_chunks k USING content c WHERE k.content_id=c.id AND c.state NOT IN ('draft','published')`)
  const { rows } = await db.query(`SELECT c.id FROM content c LEFT JOIN search_chunk_state s ON s.content_id=c.id
    WHERE c.state IN ('draft','published') AND (s.content_id IS NULL OR s.built_at < c.updated_at
      OR EXISTS (SELECT 1 FROM assets a WHERE a.content_id=c.id AND a.updated_at > s.built_at))
    ORDER BY c.state='published' DESC, c.id LIMIT $1`, [batch])
  let rebuilt = 0
  for (const { id } of rows) {
    const item = await loadItem(db, Number(id))
    if (!item) continue
    const { version, chunks } = buildChunks(item)
    const current = await db.query('SELECT build_version FROM search_chunk_state WHERE content_id=$1', [id])
    if (current.rows[0]?.build_version === version) { await db.query('UPDATE search_chunk_state SET built_at=now() WHERE content_id=$1', [id]); continue }
    const tx = db.connect ? await db.connect() : null, q = tx ?? db
    try {
      await q.query('BEGIN')
      await q.query('DELETE FROM search_chunks WHERE content_id=$1', [id])
      for (let i = 0; i < chunks.length; i += 200) {
        const part = chunks.slice(i, i + 200), values: unknown[] = []
        const tuples = part.map((c, j) => {
          values.push(id, version, c.seq, c.source, c.weight, c.assetId, c.citationId, c.locator, c.text)
          const o = j * 9
          return `($${o + 1}::integer,$${o + 2}::varchar,$${o + 3}::integer,$${o + 4}::varchar,$${o + 5}::real,$${o + 6}::integer,$${o + 7}::varchar,$${o + 8}::varchar,$${o + 9}::text)`
        })
        await q.query(`INSERT INTO search_chunks (content_id, build_version, seq, source, weight, asset_id, citation_id, locator, text) VALUES ${tuples.join(',')}`, values)
      }
      await q.query(`INSERT INTO search_chunk_state (content_id, build_version, chunks, built_at) VALUES ($1,$2,$3,now())
        ON CONFLICT (content_id) DO UPDATE SET build_version=EXCLUDED.build_version, chunks=EXCLUDED.chunks, built_at=now()`, [id, version, chunks.length])
      await emit(q, { stream: 'items', event: 'item.indexed', contentId: Number(id), data: { state: item.state, title: item.title, summary: item.description,
        takeaways: item.takeaways, tags: item.tags, evidence_version: item.evidenceVersion, build_version: version, chunk_count: chunks.length,
        files: item.files.map(f => ({ asset_id: f.assetId, name: f.name, description: f.description ?? null, mime_type: f.mimeType })) } })
      await q.query('COMMIT')
      rebuilt++
    } catch (error) { await q.query('ROLLBACK'); throw error } finally { tx?.release() }
  }
  return { rebuilt, dropped: dropped.rowCount ?? 0 }
}

/** Worker step: embed chunks that have no embedding yet (published first) and record each in the analytics chunks table. */
export async function embedChunks(db: Db, embed: Embed, batch = 48) {
  const model = embeddingModel()
  const { rows } = await db.query(`SELECT k.id, k.content_id, k.build_version, k.seq, k.source, k.weight, k.asset_id, k.citation_id, k.locator, k.text, c.title
    FROM search_chunks k JOIN content c ON c.id=k.content_id JOIN search_chunk_state s ON s.content_id=k.content_id AND s.build_version=k.build_version
    WHERE k.embedding IS NULL ORDER BY c.state='published' DESC, k.id LIMIT $1`, [batch])
  const out: OutboxRow[] = []
  for (let i = 0; i < rows.length; i += 4) {
    await Promise.all(rows.slice(i, i + 4).map(async row => {
      const vector = await embed(`${row.title}\n${row.locator}\n${row.text}`)
      await db.query('UPDATE search_chunks SET embedding=$2::vector, model=$3 WHERE id=$1', [row.id, vectorLiteral(vector), model])
      out.push({ stream: 'chunks', event: 'chunk.embedded', contentId: Number(row.content_id), data: { chunk_id: Number(row.id), build_version: row.build_version,
        seq: row.seq, source: row.source, weight: row.weight, asset_id: row.asset_id, citation_id: row.citation_id, locator: row.locator, text: row.text,
        embedding_model: model, embedding: vector } })
    }))
  }
  await emit(db, out)
  return { embedded: rows.length }
}
