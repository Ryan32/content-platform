import { createLocalReq, getPayload } from 'payload'
import config from '../payload.config'
import { profileIds, publishedWhere } from '../collections/access'
import type { LibraryRepository, Material } from '../domain/library'
import { principalFromUser } from '../domain/access'
import { hasSessionCookie, readSession } from '../auth/browser'
import { verifyBearer } from '../auth/verify'
import { rankedContentIds } from './search'

export type LibraryAccess = { repository: LibraryRepository | null; signedIn: boolean }
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

export async function authenticatedLibrary(headers: Headers, mode: 'browser' | 'mcp' = 'browser'): Promise<LibraryRepository | null> {
  if (!headers.get('authorization')?.startsWith('Bearer ') && !hasSessionCookie(headers)) return null
  if (!process.env.DATABASE_URI || !process.env.PAYLOAD_SECRET) throw new Error('Content storage is not configured')
  const payload = await getPayload({ config })
  let user
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
    evidence: (doc.passages ?? []).filter((p: any) => p.version === doc.evidenceVersion)
      .map((p: any) => ({ id: p.citationId, version: p.version, text: p.text, locator: p.locator })),
  })
  return {
    async search(query, format, page, action) {
      const ids = await profileIds(req, action)
      if (!ids.length) return { items: [], hasNextPage: false }
      const pool = (payload.db as { pool?: Parameters<typeof rankedContentIds>[0] } | undefined)?.pool
      const ranked = query && pool ? await rankedContentIds(pool, query) : null
      if (ranked) {
        // Relevance order from PostgreSQL; the authorization filter below is unchanged, so ranking never widens access.
        if (!ranked.length) return { items: [], hasNextPage: false }
        const allowed = await payload.find({ collection: 'content', req, user, overrideAccess: false, depth: 0, pagination: false,
          where: { and: [publishedWhere(ids), { id: { in: ranked } }, ...(format ? [{ format: { equals: format } }] : [])] } })
        const order = new Map(ranked.map((id, index) => [id, index]))
        const sorted = allowed.docs.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
        return { items: sorted.slice((page - 1) * 20, page * 20).map(map), hasNextPage: sorted.length > page * 20 }
      }
      const result = await payload.find({ collection: 'content', req, user, overrideAccess: false, depth: 0,
        limit: 20, page, sort: '-updatedAt', where: { and: [publishedWhere(ids),
          ...(query ? [{ or: [{ title: { contains: query } }, { description: { contains: query } }, { body: { contains: query } }] }] : []),
          ...(format ? [{ format: { equals: format } }] : []),
        ] } })
      return { items: result.docs.map(map), hasNextPage: result.hasNextPage }
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
        }
      }
      return item
    },
  }
}
