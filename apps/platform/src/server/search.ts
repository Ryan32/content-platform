import { embeddingModel, semanticSearchEnabled, vectorLiteral, type Embed } from '../processing/embeddings'

/**
 * Ranked full-text search. Title words weigh most, then summary, then reading text. The SQL expression must match the
 * GIN index created in migration 20261118_190233_admin_usability so PostgreSQL can use it.
 */
export const SEARCH_DOCUMENT = `(setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(body, '')), 'C'))`

type Queryable = { query: (sql: string, values: unknown[]) => Promise<{ rows: { id: number }[] }> }

/** Published content IDs matching the query, best first. Authorization is applied afterwards by the caller. Null if the query has no searchable words. */
export async function rankedContentIds(db: Queryable, query: string, limit = 500): Promise<number[] | null> {
  const { rows } = await db.query(`SELECT c.id FROM content c, websearch_to_tsquery('english', $1) q
    WHERE numnode(q) > 0 AND c.state = 'published' AND ${SEARCH_DOCUMENT} @@ q
    ORDER BY ts_rank_cd(${SEARCH_DOCUMENT}, q, 32) DESC, c.updated_at DESC LIMIT $2`, [query, limit])
  if (rows.length) return rows.map(r => Number(r.id))
  // Stop-word-only queries (e.g. "the") produce an empty tsquery; let the caller fall back to substring matching.
  const { rows: check } = await db.query(`SELECT numnode(websearch_to_tsquery('english', $1)) AS id`, [query])
  return Number(check[0]?.id) > 0 ? [] : null
}

/** Cosine distance above which a passage is not considered a match (normalized Titan V2 vectors). */
const MAX_DISTANCE = 0.75

/**
 * Published content IDs whose reviewed passages are semantically closest to the query. Only current evidence counts.
 * Authorization is applied afterwards by the caller, exactly as for keyword results.
 */
export async function semanticContentIds(db: Queryable, embed: Embed, query: string, limit = 100): Promise<number[]> {
  const vector = vectorLiteral(await embed(query, AbortSignal.timeout(4000)))
  const { rows } = await db.query(`SELECT n.content_id AS id FROM (
      SELECT e.content_id, e.evidence_version, e.embedding <=> $1::vector AS distance FROM passage_embeddings e
      WHERE e.model = $2 ORDER BY e.embedding <=> $1::vector LIMIT 400) n
    JOIN content c ON c.id = n.content_id AND c.state = 'published' AND c.evidence_version = n.evidence_version
    WHERE n.distance < $3 GROUP BY n.content_id ORDER BY min(n.distance) LIMIT $4`, [vector, embeddingModel(), MAX_DISTANCE, limit])
  return rows.map(r => Number(r.id))
}

/** Reciprocal rank fusion: items found by both keyword and meaning rise to the top. */
export function fuse(...lists: number[][]) {
  const score = new Map<number, number>()
  for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + rank)))
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

/**
 * Hybrid ranking: keyword plus semantic when enabled. A failing or slow embedding call degrades to keyword-only; it
 * never fails the search. Returns null exactly when keyword search would (no searchable words and no semantic match).
 */
export async function hybridContentIds(db: Queryable, query: string, embed?: Embed): Promise<number[] | null> {
  const keyword = await rankedContentIds(db, query)
  if (!embed || !semanticSearchEnabled() || query.trim().length < 3) return keyword
  let semantic: number[] = []
  try { semantic = await semanticContentIds(db, embed, query) } catch { return keyword }
  if (!semantic.length) return keyword
  return fuse(keyword ?? [], semantic)
}
