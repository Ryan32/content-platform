import { T } from '../db/payload-schema'

type Db = { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }> } // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Vimeo embed hashes for unlisted videos: the player refuses an unlisted video unless its address carries ?h=<hash>.
 * Reads each video's player address from the Vimeo API once (bearer only to api.vimeo.com) and keeps the hash by video
 * ID. Read-only towards Vimeo: privacy and embed settings are never changed.
 */
export function embedHash(playerUrl: unknown): string | null {
  if (typeof playerUrl !== 'string') return null
  try {
    const url = new URL(playerUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'player.vimeo.com') return null
    const hash = url.searchParams.get('h')
    return hash && /^[0-9a-f]{6,40}$/.test(hash) ? hash : null
  } catch { return null }
}

/** Looks up videos not yet checked (or due a recheck). Stops early when Vimeo rate-limits; the next cycle continues. */
export async function syncVimeoEmbeds(db: Db, token: string, fetcher: typeof fetch = fetch, batch = 20) {
  const { rows } = await db.query(`SELECT v.id FROM (
      SELECT vimeo_id AS id FROM content WHERE vimeo_id ~ '^[1-9][0-9]{0,19}$'
      UNION SELECT vimeo_id FROM ${T.content_more_videos} WHERE vimeo_id ~ '^[1-9][0-9]{0,19}$') v
    LEFT JOIN vimeo_embeds e ON e.video_id = v.id
    WHERE e.video_id IS NULL OR (e.status = 'retry' AND e.checked_at < now() - interval '1 hour')
      OR (e.status = 'unavailable' AND e.checked_at < now() - interval '7 days')
    ORDER BY e.checked_at NULLS FIRST LIMIT $1`, [batch])
  const counts: Record<string, number> = {}
  for (const { id } of rows as { id: string }[]) {
    let status: string, hash: string | null = null
    try {
      const response = await fetcher(`https://api.vimeo.com/videos/${id}?fields=player_embed_url`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.vimeo.*+json;version=3.4' }, redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (response.status === 429) { counts.rate_limited = 1; break }
      if (response.ok) {
        hash = embedHash(((await response.json()) as { player_embed_url?: unknown }).player_embed_url)
        status = hash ? 'unlisted' : 'public'
      } else status = [403, 404].includes(response.status) ? 'unavailable' : 'retry'
    } catch { status = 'retry' }
    await db.query(`INSERT INTO vimeo_embeds (video_id, hash, status, checked_at) VALUES ($1, $2, $3, now())
      ON CONFLICT (video_id) DO UPDATE SET hash = EXCLUDED.hash, status = EXCLUDED.status, checked_at = now()`, [id, hash, status])
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

/** Hashes for the given video IDs, for building player addresses on an authorized page. */
export async function embedHashes(db: Db, ids: string[]): Promise<Map<string, string>> {
  const valid = ids.filter(id => /^[1-9]\d{0,19}$/.test(id))
  if (!valid.length) return new Map()
  const { rows } = await db.query('SELECT video_id, hash FROM vimeo_embeds WHERE video_id = ANY($1::varchar[]) AND hash IS NOT NULL', [valid])
  return new Map(rows.map(r => [String(r.video_id), String(r.hash)]))
}
