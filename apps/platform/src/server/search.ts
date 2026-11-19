import { embeddingModel, semanticSearchEnabled, vectorLiteral, type Embed } from '../processing/embeddings'

/**
 * Ranked full-text search. Title words weigh most, then summary, then reading text. The SQL expression must match the
 * GIN index created in migration 20261118_190233_admin_usability so PostgreSQL can use it.
 */
export const SEARCH_DOCUMENT = `(setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(body, '')), 'C'))`

type Queryable = { query: (sql: string, values: unknown[]) => Promise<{ rows: any[] }> }
/** Where a query matched on a page: a reviewed passage, possibly inside one of the page's files. */
export type SearchMatch = { citationId: string; locator: string; assetId?: number }
const toMatch = (r: { citation_id: string; locator: string; asset_id?: unknown }): SearchMatch =>
  ({ citationId: String(r.citation_id), locator: String(r.locator), ...(r.asset_id != null ? { assetId: Number(r.asset_id) } : {}) })
/** Must match the content_passages_fts index in migration 20261119_040000_semantic_index. */
export const PASSAGE_DOCUMENT = `to_tsvector('english', p.text)`

/**
 * Pages whose reviewed passages (including text inside their files) match the words, with the best passage for each.
 * Only current evidence of published pages; authorization is applied afterwards by the caller.
 */
export async function passageMatches(db: Queryable, query: string, limit = 300): Promise<Map<number, SearchMatch>> {
  const { rows } = await db.query(`SELECT id, citation_id, locator, asset_id FROM (
      SELECT DISTINCT ON (c.id) c.id, p.citation_id, p.locator, p.asset_id, ts_rank_cd(${PASSAGE_DOCUMENT}, q) AS rank
      FROM content c JOIN content_passages p ON p._parent_id = c.id AND p.version = c.evidence_version, websearch_to_tsquery('english', $1) q
      WHERE numnode(q) > 0 AND c.state = 'published' AND ${PASSAGE_DOCUMENT} @@ q
      ORDER BY c.id, rank DESC) best ORDER BY rank DESC LIMIT $2`, [query, limit])
  return new Map(rows.map(r => [Number(r.id), toMatch(r)]))
}

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

/** Cosine distance above which a passage is not considered a match (normalized Titan V2 vectors). */
const MAX_DISTANCE = 0.75

/**
 * Published content IDs whose reviewed passages are semantically closest to the query. Only current evidence counts.
 * Authorization is applied afterwards by the caller, exactly as for keyword results.
 */
export async function semanticContentIds(db: Queryable, embed: Embed, query: string, limit = 100): Promise<number[]> {
  return [...(await semanticMatches(db, embed, query, limit)).keys()]
}
/** Closest pages by meaning, best first, each with its closest passage. */
export async function semanticMatches(db: Queryable, embed: Embed, query: string, limit = 100): Promise<Map<number, SearchMatch>> {
  const vector = vectorLiteral(await embed(query, AbortSignal.timeout(4000)))
  const { rows } = await db.query(`SELECT id, citation_id, locator, asset_id FROM (
      SELECT DISTINCT ON (n.content_id) n.content_id AS id, n.citation_id, n.distance, p.locator, p.asset_id FROM (
        SELECT e.content_id, e.citation_id, e.evidence_version, e.embedding <=> $1::vector AS distance FROM passage_embeddings e
        WHERE e.model = $2 ORDER BY e.embedding <=> $1::vector LIMIT 400) n
      JOIN content c ON c.id = n.content_id AND c.state = 'published' AND c.evidence_version = n.evidence_version
      LEFT JOIN content_passages p ON p._parent_id = n.content_id AND p.citation_id = n.citation_id
      WHERE n.distance < $3 ORDER BY n.content_id, n.distance) best
    ORDER BY distance LIMIT $4`, [vector, embeddingModel(), MAX_DISTANCE, limit])
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
  const matches = new Map([...semantic, ...inFiles])   // a literal word match is the clearer pointer
  const lists = [keyword ?? [], [...inFiles.keys()], [...semantic.keys()]].filter(l => l.length)
  if (!lists.length) return { ids: keyword, matches }
  return { ids: lists.length === 1 ? lists[0] : fuse(...lists), matches }
}
