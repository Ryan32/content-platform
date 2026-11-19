import { embeddingModel, semanticSearchEnabled, vectorLiteral, type Embed } from '../processing/embeddings'

/**
 * Ranked full-text search. Title words weigh most, then summary, then reading text. The SQL expression must match the
 * GIN index created in migration 20261118_190233_admin_usability so PostgreSQL can use it.
 */
export const SEARCH_DOCUMENT = `(setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(body, '')), 'C'))`

type Queryable = { query: (sql: string, values: unknown[]) => Promise<{ rows: any[] }> }
/** Where a query matched on a page: a reviewed passage, possibly inside one of the page's files. */
export type SearchMatch = { citationId: string; locator: string; assetId?: number }
const toMatch = (r: { citation_id: string | null; locator: string; asset_id?: unknown }): SearchMatch =>
  ({ citationId: r.citation_id ? String(r.citation_id) : '', locator: String(r.locator), ...(r.asset_id != null ? { assetId: Number(r.asset_id) } : {}) })
/** Published content IDs matching the query, best first. Authorization is applied afterwards by the caller. Null if the query has no searchable words. */
export async function rankedContentIds(db: Queryable, query: string, limit = 500): Promise<number[] | null> {
  const { rows } = await db.query(`SELECT c.id FROM content c, websearch_to_tsquery('english', $1) q
    WHERE numnode(q) > 0 AND c.state = 'published' AND ${SEARCH_DOCUMENT} @@ q
    ORDER BY ts_rank_cd(${SEARCH_DOCUMENT}, q, 32) DESC, c.listed_at DESC NULLS LAST LIMIT $2`, [query, limit])
  if (rows.length) return rows.map(r => Number(r.id))
  // Stop-word-only queries (e.g. "the") produce an empty tsquery; let the caller fall back to substring matching.
  const { rows: check } = await db.query(`SELECT numnode(websearch_to_tsquery('english', $1)) AS id`, [query])
  return Number(check[0]?.id) > 0 ? [] : null
}

/** Chunks that are current for a published item (the reader index). Authorization is still applied by the caller. */
const CURRENT_PUBLISHED = `JOIN search_chunk_state st ON st.content_id = k.content_id AND st.build_version = k.build_version
  JOIN content c ON c.id = k.content_id AND c.state = 'published'`

/**
 * Keyword matches anywhere on a page (curated fields, article, every file, transcripts, OCR, pictures), scored by
 * relevance x source weight; the best chunk per page says where it matched.
 */
export async function passageMatches(db: Queryable, query: string, limit = 300): Promise<Map<number, SearchMatch>> {
  const { rows } = await db.query(`SELECT id, citation_id, locator, asset_id FROM (
      SELECT DISTINCT ON (k.content_id) k.content_id AS id, k.citation_id, k.locator, k.asset_id, ts_rank_cd(k.tsv, q) * k.weight AS score
      FROM search_chunks k ${CURRENT_PUBLISHED}, websearch_to_tsquery('english', $1) q
      WHERE numnode(q) > 0 AND k.tsv @@ q
      ORDER BY k.content_id, score DESC) best ORDER BY score DESC LIMIT $2`, [query, limit])
  return new Map(rows.map(r => [Number(r.id), toMatch(r)]))
}

/** Cosine distance above which a passage is not considered a match (normalized Titan V2 vectors). */
const MAX_DISTANCE = 0.75

/**
 * Published content IDs whose reviewed passages are semantically closest to the query. Only current evidence counts.
 * Authorization is applied afterwards by the caller, exactly as for keyword results.
 */
export async function semanticContentIds(db: Queryable, embed: Embed, query: string, limit = 100): Promise<number[]> {
  return [...(await semanticMatches(db, embed, query, limit)).keys()]
}
/** Closest pages by meaning: nearest chunks, scored by similarity x source weight, best chunk per page. */
export async function semanticMatches(db: Queryable, embed: Embed, query: string, limit = 100): Promise<Map<number, SearchMatch>> {
  const vector = vectorLiteral(await embed(query, AbortSignal.timeout(4000)))
  const { rows } = await db.query(`SELECT id, citation_id, locator, asset_id FROM (
      SELECT DISTINCT ON (n.content_id) n.content_id AS id, n.citation_id, n.locator, n.asset_id, (1 - n.distance) * n.weight AS score FROM (
        SELECT k.content_id, k.build_version, k.citation_id, k.locator, k.asset_id, k.weight, k.embedding <=> $1::vector AS distance
        FROM search_chunks k WHERE k.model = $2 AND k.embedding IS NOT NULL ORDER BY k.embedding <=> $1::vector LIMIT 400) n
      JOIN search_chunk_state st ON st.content_id = n.content_id AND st.build_version = n.build_version
      JOIN content c ON c.id = n.content_id AND c.state = 'published'
      WHERE n.distance < $3 ORDER BY n.content_id, score DESC) best
    ORDER BY score DESC LIMIT $4`, [vector, embeddingModel(), MAX_DISTANCE, limit])
  return new Map(rows.map(r => [Number(r.id), toMatch({ ...r, locator: r.locator ?? '' })]))
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
  return (await hybridSearch(db, query, embed)).ids
}

/**
 * Full ranking for the reader and MCP: page-level keywords, keywords inside reviewed passages (file text), and meaning.
 * Each result may carry where it matched so the link opens the page at that passage and file. Files never have their
 * own page. Semantic failures degrade silently to keyword-only.
 */
export async function hybridSearch(db: Queryable, query: string, embed?: Embed): Promise<{ ids: number[] | null; matches: Map<number, SearchMatch> }> {
  const keyword = await rankedContentIds(db, query)
  const inFiles = keyword === null ? new Map<number, SearchMatch>() : await passageMatches(db, query).catch(() => new Map<number, SearchMatch>())
  let semantic = new Map<number, SearchMatch>()
  if (embed && semanticSearchEnabled() && query.trim().length >= 3) semantic = await semanticMatches(db, embed, query).catch(() => new Map())
  // A literal word match is the clearer pointer; curated-field matches (title, tags) need no pointer.
  const matches = new Map([...semantic, ...inFiles].filter(([, m]) => m.citationId || m.assetId))
  const lists = [keyword ?? [], [...inFiles.keys()], [...semantic.keys()]].filter(l => l.length)
  if (!lists.length) return { ids: keyword, matches }
  return { ids: lists.length === 1 ? lists[0] : fuse(...lists), matches }
}
