import type { Access, PayloadRequest, Where } from 'payload'
import { allowed, principalFromUser, staff, type Action, type Policy } from '../domain/access'

export const admin = ({ req }: { req: PayloadRequest }): boolean => staff(principalFromUser(req.user), 'admin')
export const editor = ({ req }: { req: PayloadRequest }): boolean => staff(principalFromUser(req.user), 'editor')
export const deny: Access = () => false

export async function profileIds(req: PayloadRequest, action: Action): Promise<(string | number)[]> {
  const principal = principalFromUser(req.user)
  if (!principal?.active) return []
  // Trusted policy lookup only: never returned to readers. Memberships are DB-backed.
  const profiles = await req.payload.find({ collection: 'access-profiles', overrideAccess: true,
    depth: 0, pagination: false, where: { active: { equals: true } }, req })
  return profiles.docs.filter(doc => allowed(principal, {
    id: doc.id, active: doc.active === true,
    grants: (doc.grants ?? []).map((g: any) => ({ ...g, entitlements: (g.entitlements ?? []).map((e: any) => e.value) })),
  } as Policy, action)).map(doc => doc.id)
}

export function publishedWhere(ids: (string | number)[], now = new Date()): Where {
  return { and: [
    { accessProfile: { in: ids } }, { state: { equals: 'published' } },
    { or: [{ availableAt: { exists: false } }, { availableAt: { less_than_equal: now.toISOString() } }] },
    { or: [{ expiresAt: { exists: false } }, { expiresAt: { greater_than: now.toISOString() } }] },
    // Past its review date: hidden from readers, search and AI until renewed (docs/design, review windows).
    { or: [{ reviewDueAt: { exists: false } }, { reviewDueAt: { greater_than: now.toISOString() } }] },
  ] }
}

export const readContent: Access = async ({ req }) => {
  if (staff(principalFromUser(req.user), 'editor')) return true
  const ids = await profileIds(req, 'view')
  return ids.length ? publishedWhere(ids) : false
}
