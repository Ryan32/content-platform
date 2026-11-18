import { createLocalReq, getPayload } from 'payload'
import config from '../payload.config'
import { profileIds, publishedWhere } from '../collections/access'
import type { LibraryRepository, Material } from '../domain/library'
import { principalFromUser } from '../domain/access'

export async function authenticatedLibrary(headers: Headers): Promise<LibraryRepository | null> {
  if (!headers.get('authorization')?.startsWith('Bearer ')) return null
  if (!process.env.DATABASE_URI || !process.env.PAYLOAD_SECRET) throw new Error('Content storage is not configured')
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers })
  if (!user || !principalFromUser(user)?.active) return null
  const req = await createLocalReq({ user }, payload)
  const map = (doc: any): Material => ({ id: String(doc.id), title: doc.title,
    description: doc.description ?? '', format: doc.format, version: doc.evidenceVersion,
    body: doc.body ?? '', updatedAt: doc.updatedAt,
    evidence: (doc.passages ?? []).filter((p: any) => p.version === doc.evidenceVersion)
      .map((p: any) => ({ id: p.citationId, version: p.version, text: p.text, locator: p.locator })),
  })
  return {
    async search(query, format, page, action) {
      const ids = await profileIds(req, action)
      if (!ids.length) return { items: [], hasNextPage: false }
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
      return result.docs[0] ? map(result.docs[0]) : null
    },
  }
}
