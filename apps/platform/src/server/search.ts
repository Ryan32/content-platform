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
