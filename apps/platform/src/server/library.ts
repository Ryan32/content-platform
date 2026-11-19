import { createLocalReq, getPayload, type Where } from 'payload'
import config from '../payload.config'
import { profileIds, publishedWhere } from '../collections/access'
import type { BrowseFilters, Carrier, Kit, LibraryRepository, Material, ReaderExtras } from '../domain/library'
import { principalFromUser } from '../domain/access'
import { hasSessionCookie, readSession } from '../auth/browser'
import { verifyBearer } from '../auth/verify'
import { hybridContentIds, rankedContentIds } from './search'
import { bedrockEmbedder, semanticSearchEnabled, type Embed } from '../processing/embeddings'

// One Bedrock client per server process; created only when semantic search is switched on.
let embedder: Embed | undefined
const queryEmbedder = () => semanticSearchEnabled() ? (embedder ??= bedrockEmbedder()) : undefined
import { isInlineType } from '../domain/viewers'

export type ReaderLibrary = LibraryRepository & ReaderExtras
export type LibraryAccess = { repository: ReaderLibrary | null; signedIn: boolean }
export type ReaderProfile = { name: string; email: string; isStaff: boolean; isAdmin: boolean }

function navigationHeaders(headers: Headers) {
  const readHeaders = new Headers(headers)
  // A reader-page GET opened from an external citation is a legitimate navigation,
  // not a cookie-authenticated API mutation. Keep the stricter API strategy intact.
  if (!headers.has('origin') && headers.get('sec-fetch-mode') === 'navigate' && headers.get('sec-fetch-dest') === 'document') readHeaders.delete('sec-fetch-site')
  return readHeaders
}

/** Display details for the signed-in reader's sidebar. Null when signed out. */
export async function readerProfile(headers: Headers): Promise<ReaderProfile | null> {
  if (!await readSession(headers.get('cookie'))) return null
  const unprovisioned = { name: 'Signed in', email: 'No library access yet', isStaff: false, isAdmin: false }
  if (!process.env.DATABASE_URI) return unprovisioned
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: navigationHeaders(headers) })
    const principal = principalFromUser(user)
    if (!user || !principal?.active) return unprovisioned
    const record = user as { name?: string | null; email?: string | null }
    return { name: record.name || record.email || 'Signed in', email: record.email ?? '', isStaff: principal.roles.some(r => r === 'editor' || r === 'admin'), isAdmin: principal.roles.includes('admin') }
  } catch { return unprovisioned }
}

/** Resolves the reader's library for a page render: signed-in state plus their authorized repository, if provisioned. */
export async function readerLibrary(headers: Headers): Promise<LibraryAccess> {
  const signedIn = Boolean(await readSession(headers.get('cookie')))
  return { signedIn, repository: signedIn ? await authenticatedLibrary(navigationHeaders(headers)) : null }
}

export async function authenticatedLibrary(headers: Headers, mode: 'browser' | 'mcp' = 'browser'): Promise<ReaderLibrary | null> {
  if (!headers.get('authorization')?.startsWith('Bearer ') && !hasSessionCookie(headers)) return null
  if (!process.env.DATABASE_URI || !process.env.PAYLOAD_SECRET) throw new Error('Content storage is not configured')
  const payload = await getPayload({ config })
  let user: any
  if (mode === 'mcp') {
    const identity = await verifyBearer(headers.get('authorization'))
    if (!identity?.scopes.some(s => s === 'content:read' || s === 'content:search')) return null
    const users = await payload.find({ collection: 'users', overrideAccess: true, depth: 0, limit: 1,
      where: { and: [{ issuer: { equals: identity.issuer } }, { subject: { equals: identity.subject } }, { active: { equals: true } }] } })
    user = users.docs[0] ? { ...users.docs[0], collection: 'users' as const } : null
  } else { user = (await payload.auth({ headers })).user }
  if (!user || !principalFromUser(user)?.active) return null
  const req = await createLocalReq({ user }, payload)
  const map = (doc: any): Material => ({ id: String(doc.id), title: doc.title,
    description: doc.description ?? '', format: doc.format, version: doc.evidenceVersion,
    body: doc.body ?? '', updatedAt: doc.updatedAt, ...(doc.thumbnailVersion ? { thumbnailVersion: doc.thumbnailVersion } : {}),
    kind: doc.kind ?? 'resource', ...(doc.section ? { section: doc.section } : {}), topics: doc.topics ?? [],
    audience: doc.audience ?? 'advisor', licensing: doc.licensing ?? [], lines: doc.lines ?? [], ...(doc.program ? { program: doc.program } : {}),
    carriers: (doc.carriers ?? []).map((c: any) => typeof c === 'object' ? c.id : c),
    takeaways: (doc.takeaways ?? []).map((t: any) => t.text).filter(Boolean),
    evidence: (doc.passages ?? []).filter((p: any) => p.version === doc.evidenceVersion)
      .map((p: any) => ({ id: p.citationId, version: p.version, text: p.text, locator: p.locator })),
  })
  const browse = (filters?: BrowseFilters): Where[] => [
    ...(filters?.section ? [{ section: { equals: filters.section } }] : []),
    ...(filters?.topic ? [{ topics: { in: [filters.topic] } }] : []),
    ...(filters?.page ? [{ pages: { in: [filters.page] } }] : []),
    ...(filters?.kind ? [{ kind: { equals: filters.kind } }] : []),
    ...(filters?.kinds?.length ? [{ kind: { in: filters.kinds } }] : []),
    ...(filters?.excludeKinds?.length ? [{ kind: { not_in: filters.excludeKinds } }] : []),
    ...(filters?.audience ? [{ audience: { equals: filters.audience } }] : []),
    ...(filters?.licensing?.length ? [{ licensing: { in: filters.licensing } }] : []),
    ...(filters?.lines?.length ? [{ lines: { in: filters.lines } }] : []),
    ...(filters?.program ? [{ program: { equals: filters.program } }] : []),
    ...(filters?.carrier ? [{ carriers: { in: [filters.carrier] } }] : []),
    ...(filters?.formats?.length ? [{ format: { in: filters.formats } }] : []),
    ...(filters?.updatedSince ? [{ updatedAt: { greater_than_equal: filters.updatedSince } }] : []),
    ...(filters?.ids ? [{ id: { in: filters.ids } }] : []),
  ]
  const pool = (payload.db as { pool?: { query: (sql: string, values: unknown[]) => Promise<{ rows: any[] }> } } | undefined)?.pool
  const userId = Number((user as { id: number | string }).id)
  /** View counts for ranking "Most used" and the Most useful sort. Counts only; never who viewed what. */
  async function viewCounts(ids: number[] | null, days: number): Promise<Map<number, number>> {
    if (!pool || (ids && !ids.length)) return new Map()
    const { rows } = await pool.query(`SELECT content_id AS id, count(*)::int AS n FROM content_views
      WHERE day > CURRENT_DATE - $1::int ${ids ? 'AND content_id = ANY($2::int[])' : ''} GROUP BY content_id ORDER BY n DESC LIMIT 500`, ids ? [days, ids] : [days])
    return new Map(rows.map(r => [Number(r.id), Number(r.n)]))
  }
  async function authorized(where: Where[], action: 'view' | 'retrieve' = 'view') {
    const ids = await profileIds(req, action)
    if (!ids.length) return []
    return (await payload.find({ collection: 'content', req, user, overrideAccess: false, depth: 0, pagination: false, sort: '-updatedAt',
      where: { and: [publishedWhere(ids), ...where] } })).docs
  }
  return {
    async search(query, format, page, action, filters) {
      const ids = await profileIds(req, action)
      if (!ids.length) return { items: [], hasNextPage: false }
      const pool = (payload.db as { pool?: Parameters<typeof rankedContentIds>[0] } | undefined)?.pool
      const ranked = query && pool ? await hybridContentIds(pool, query, queryEmbedder()) : null
      if (ranked) {
        // Relevance order (keyword + meaning); the authorization filter below is unchanged, so ranking never widens access.
        if (!ranked.length) return { items: [], hasNextPage: false }
        const allowed = await payload.find({ collection: 'content', req, user, overrideAccess: false, depth: 0, pagination: false,
          where: { and: [publishedWhere(ids), { id: { in: ranked } }, ...(format ? [{ format: { equals: format } }] : []), ...browse(filters)] } })
        const order = new Map(ranked.map((id, index) => [id, index]))
        const sorted = allowed.docs.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
        return { items: sorted.slice((page - 1) * 20, page * 20).map(map), hasNextPage: sorted.length > page * 20, total: sorted.length }
      }
      const size = filters?.pageSize ?? 20
      if (filters?.sort === 'popular') {
        const docs = await authorized([...(query ? [{ or: [{ title: { contains: query } }, { description: { contains: query } }] }] : []),
          ...(format ? [{ format: { equals: format } }] : []), ...browse(filters)], action)
        const counts = await viewCounts(docs.map(d => d.id), 90)
        const sorted = docs.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
        return { items: sorted.slice((page - 1) * size, page * size).map(map), hasNextPage: sorted.length > page * size, total: sorted.length }
      }
      const result = await payload.find({ collection: 'content', req, user, overrideAccess: false, depth: 0,
        limit: size, page, sort: '-updatedAt', where: { and: [publishedWhere(ids),
          ...(query ? [{ or: [{ title: { contains: query } }, { description: { contains: query } }, { body: { contains: query } }] }] : []),
          ...(format ? [{ format: { equals: format } }] : []), ...browse(filters),
        ] } })
      return { items: result.docs.map(map), hasNextPage: result.hasNextPage, total: result.totalDocs }
    },
    async get(id, action) {
      const ids = await profileIds(req, action)
      if (!ids.length || !/^\d+$/.test(id)) return null
      const result = await payload.find({ collection: 'content', req, user, overrideAccess: false, depth: 0, limit: 1,
        where: { and: [publishedWhere(ids), { id: { equals: Number(id) } }] } })
      const doc = result.docs[0]
      if (!doc) return null
      const item = map(doc)
      if (action === 'view') {
        if (doc.vimeoId && /^\d+$/.test(doc.vimeoId)) item.vimeoId = doc.vimeoId
        // Owner name and review dates for the detail page. Trusted lookup after the authorized read above.
        const meta = await payload.findByID({ collection: 'content', id: doc.id, req, overrideAccess: true, depth: 1 }) as any
        item.details = { owner: meta.owner?.name || undefined, lastReviewedAt: meta.lastReviewedAt ?? undefined,
          reviewDueAt: meta.reviewDueAt ?? undefined, reviewWindow: meta.reviewWindow ?? undefined }
        // The public content read intentionally hides sourceHash. Resolve it only
        // after the authorized view above; never return the raw source metadata.
        const metadata = await payload.findByID({ collection: 'content', id: doc.id, req, overrideAccess: true, depth: 0 })
        const assets = await payload.find({ collection: 'assets', req, overrideAccess: true, depth: 0, limit: 100,
          where: { and: [{ content: { equals: doc.id } }, { version: { equals: metadata.sourceHash } }] } })
        if (process.env.CONTENT_BUCKET) {
          const downloadable = await profileIds(req, 'download')
          const policyId = typeof doc.accessProfile === 'number' ? doc.accessProfile : doc.accessProfile?.id
          item.downloadAssetIds = downloadable.includes(policyId!) ? assets.docs.map(a => a.id) : []
          // Until a separate derivative exists, embedded PDF is the original.
          if (downloadable.includes(policyId!)) item.previewAssetId = assets.docs.find(a => a.mimeType === 'application/pdf')?.id
          if (downloadable.includes(policyId!)) item.inlineAssets = assets.docs.filter(a => isInlineType(a.mimeType)).map(a => ({ id: a.id, mimeType: a.mimeType }))
        }
      }
      return item
    },
    userId,
    async mostUsed(limit) {
      const counts = await viewCounts(null, 30)
      if (!counts.size) return []
      const docs = await authorized([{ id: { in: [...counts.keys()] } }, { kind: { not_in: ['news', 'bulletin'] } }])
      return docs.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)).slice(0, limit).map(map)
    },
    async recordView(id) {
      if (!pool || !/^\d+$/.test(id)) return
      await pool.query('INSERT INTO content_views (content_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [Number(id), userId]).catch(() => undefined)
    },
    async savedIds() {
      const rows = await payload.find({ collection: 'saved', overrideAccess: true, depth: 0, pagination: false, where: { user: { equals: userId } } })
      return rows.docs.map(r => typeof r.content === 'object' ? r.content.id : r.content)
    },
    async setSaved(id, saved) {
      if (!/^\d+$/.test(id)) return false
      const visible = await authorized([{ id: { equals: Number(id) } }])
      if (!visible.length) return false
      const existing = await payload.find({ collection: 'saved', overrideAccess: true, depth: 0, limit: 1, where: { and: [{ user: { equals: userId } }, { content: { equals: Number(id) } }] } })
      if (saved && !existing.docs.length) await payload.create({ collection: 'saved', overrideAccess: true, data: { user: userId, content: Number(id) } })
      if (!saved && existing.docs.length) await payload.delete({ collection: 'saved', overrideAccess: true, id: existing.docs[0].id })
      return true
    },
    async carriers() {
      const all = await payload.find({ collection: 'carriers', overrideAccess: true, depth: 0, pagination: false, sort: 'name' })
      const docs = await authorized([{ carriers: { exists: true } }])
      const count = new Map<number, number>()
      for (const d of docs) for (const c of (d.carriers ?? []) as (number | { id: number })[]) { const k = typeof c === 'object' ? c.id : c; count.set(k, (count.get(k) ?? 0) + 1) }
      return all.docs.map((c): Carrier => ({ id: c.id, name: c.name, slug: c.slug, lines: c.lines ?? [], summary: c.summary ?? '', logoText: c.logoText || c.name.slice(0, 2).toUpperCase(), count: count.get(c.id) ?? 0 }))
    },
    async kits({ section, contentId, id }) {
      const kits = await payload.find({ collection: 'kits', overrideAccess: true, depth: 0, pagination: false, sort: 'title',
        where: { and: [{ published: { equals: true } }, ...(section ? [{ section: { equals: section } }] : []),
          ...(contentId && /^\d+$/.test(contentId) ? [{ items: { in: [Number(contentId)] } }] : []), ...(id ? [{ id: { equals: id } }] : [])] } })
      const wanted = [...new Set(kits.docs.flatMap(k => ((k.items ?? []) as (number | { id: number })[]).map(i => typeof i === 'object' ? i.id : i)))]
      const visible = wanted.length ? new Map((await authorized([{ id: { in: wanted } }])).map(d => [d.id, map(d)])) : new Map<number, Material>()
      return kits.docs.map((k): Kit => ({ id: k.id, title: k.title, description: k.description ?? '', section: k.section ?? undefined,
        items: ((k.items ?? []) as (number | { id: number })[]).map(i => visible.get(typeof i === 'object' ? i.id : i)).filter((m): m is Material => Boolean(m)) }))
        .filter(k => k.items.length > 0)
    },
    async feedback(id, kind, comment) {
      if (!/^\d+$/.test(id) || !(await authorized([{ id: { equals: Number(id) } }])).length) return false
      await payload.create({ collection: 'feedback', overrideAccess: true, data: { content: Number(id), user: userId, kind, comment: comment?.slice(0, 2000) || undefined } })
      return true
    },
  }
}
