import { adminForm, redirectTo } from '../../../server/forms'
import { principalFromUser, staff } from '../../../domain/access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST (form) from Approve drafts: administrators publish the ticked drafts (`ids`, at most one page). Each goes through
 * the same content rules as a single publish (as the signed-in admin, never overriding access): an item without an
 * audience, or no longer a draft, is counted as skipped.
 */
export async function POST(request: Request) {
  const parsed = await adminForm(request)
  if ('response' in parsed) return parsed.response
  const { context, form, origin } = parsed
  if (!staff(principalFromUser(context.user), 'admin')) return redirectTo(origin, '/admin/approve?outcome=admin_only')
  const ids = [...new Set(form.getAll('ids').map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 100)
  if (!ids.length) return redirectTo(origin, '/admin/approve?outcome=nothing_selected')
  let done = 0, skipped = 0
  for (const id of ids) {
    try {
      const doc = await context.payload.findByID({ collection: 'content', id, overrideAccess: true, depth: 0 })
      if (doc.state !== 'draft' || !doc.accessProfile) { skipped++; continue }
      await context.payload.update({ collection: 'content', id, data: { state: 'published' }, user: context.user, overrideAccess: false, depth: 0 })
      done++
    } catch { skipped++ }
  }
  return redirectTo(origin, `/admin/approve?${new URLSearchParams({ outcome: 'published', done: String(done), skipped: String(skipped) })}`)
}
