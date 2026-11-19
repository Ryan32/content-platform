import type { ServerProps } from 'payload'
import { principalFromUser, staff } from '../domain/access'
import { DUE_SOON_DAYS } from '../domain/review'
import AdminNavItems, { type NavEntry } from './AdminNavItems'

/**
 * The Manage menu from the AE Library design (mockups AdminDashboard/AdminContent): one short list of jobs instead of
 * Payload's collection groups, which are hidden by the fenced CSS. Everything else stays reachable under "More".
 */
export default async function AdminNav({ payload, user }: ServerProps) {
  const principal = principalFromUser(user)
  if (!payload || !staff(principal, 'editor')) return null
  const isAdmin = staff(principal, 'admin')
  const soon = new Date(Date.now() + DUE_SOON_DAYS * 86400000).toISOString()
  const count = (collection: 'content' | 'suggestions', where: object) =>
    payload.count({ collection, overrideAccess: true, where: where as never }).then(r => r.totalDocs).catch(() => 0)
  const [due, suggestions, drafts] = await Promise.all([
    count('content', { and: [{ state: { equals: 'published' } }, { reviewDueAt: { less_than_equal: soon } }] }),
    count('suggestions', { decision: { equals: 'pending' } }),
    count('content', { and: [{ state: { equals: 'draft' } }, { accessProfile: { exists: true } }] }),
  ])
  const main: NavEntry[] = [
    { href: '/admin', label: 'Home', icon: 'home', exact: true },
    { href: '/admin/library', label: 'Content', icon: 'content', also: ['/admin/collections/content'] },
    { href: '/admin/approve', label: 'Approve drafts', icon: 'approve', badge: drafts },
    { href: '/admin/due-for-review', label: 'Due for review', icon: 'clock', badge: due },
    { href: '/admin/review', label: 'AI suggestions', icon: 'sparkle', badge: suggestions, also: ['/admin/collections/suggestions'] },
    { href: '/admin/review-policies', label: 'Review policies', icon: 'shield' },
    { href: '/admin/collections/taxonomy', label: 'Sections & tags', icon: 'tag' },
    { href: '/admin/collections/carriers', label: 'Carriers', icon: 'building' },
    ...(isAdmin ? [{ href: '/admin/collections/users', label: 'People & access', icon: 'people', also: ['/admin/collections/access-profiles', '/admin/collections/audiences'] } as NavEntry] : []),
    { href: '/admin/automation', label: 'Processing', icon: 'refresh', also: ['/admin/collections/processing-jobs'] },
  ]
  const more: NavEntry[] = [
    { href: '/admin/bulk-add', label: 'Add many files' },
    { href: '/admin/collections/kits', label: 'Ready-made kits' },
    { href: '/admin/collections/assets', label: 'Files' },
    { href: '/admin/collections/feedback', label: 'Reader feedback' },
    ...(isAdmin ? [
      { href: '/admin/collections/access-profiles', label: 'Access profiles' },
      { href: '/admin/collections/audiences', label: 'Audiences' },
      { href: '/admin/collections/processing-jobs', label: 'Processing jobs' },
      { href: '/admin/globals/automation-settings', label: 'Automation settings' },
    ] : []),
  ]
  return <AdminNavItems main={main} more={more} />
}
