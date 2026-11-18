import type { Payload } from 'payload'
import type { SignedInProfile } from '../auth/browser'

export type SyncOutcome = 'updated' | 'linked' | 'unprovisioned'

/**
 * Runs after a verified sign-in. Refreshes display fields on the matching person, or links an administrator-created
 * invitation (email set, no Auth0 ID yet) when the email is trusted. Never creates people or changes roles/access.
 */
export async function syncSignedInUser(payload: Payload, profile: SignedInProfile, now = new Date()): Promise<SyncOutcome> {
  const lastSignInAt = now.toISOString()
  const existing = await payload.find({ collection: 'users', overrideAccess: true, depth: 0, limit: 1,
    where: { and: [{ issuer: { equals: profile.issuer } }, { subject: { equals: profile.subject } }] } })
  const person = existing.docs[0] as { id: number; name?: string | null; email?: string | null } | undefined
  if (person) {
    const data: Record<string, unknown> = { lastSignInAt }
    if (profile.name && (!person.name || person.name === person.email)) data.name = profile.name
    if (profile.email && profile.emailTrusted && !person.email && !(await emailTaken(payload, profile.email, person.id))) data.email = profile.email
    await payload.update({ collection: 'users', id: person.id, overrideAccess: true, data })
    return 'updated'
  }
  if (!profile.email || !profile.emailTrusted) return 'unprovisioned'
  const invited = await payload.find({ collection: 'users', overrideAccess: true, depth: 0, limit: 2,
    where: { and: [{ email: { equals: profile.email } }, { or: [{ subject: { exists: false } }, { subject: { equals: '' } }] }] } })
  // Exactly one unlinked invitation; ambiguity is left for an administrator to resolve.
  if (invited.docs.length !== 1) return 'unprovisioned'
  const invite = invited.docs[0] as { id: number; name?: string | null; email?: string | null }
  await payload.update({ collection: 'users', id: invite.id, overrideAccess: true, data: {
    subject: profile.subject, issuer: profile.issuer, lastSignInAt,
    ...(profile.name && (!invite.name || invite.name === invite.email) ? { name: profile.name } : {}),
  } })
  return 'linked'
}

async function emailTaken(payload: Payload, email: string, id: number) {
  const other = await payload.find({ collection: 'users', overrideAccess: true, depth: 0, limit: 1,
    where: { and: [{ email: { equals: email } }, { id: { not_equals: id } }] } })
  return other.docs.length > 0
}
