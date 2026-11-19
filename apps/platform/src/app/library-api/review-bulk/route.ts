import { adminForm, redirectTo } from '../../../server/forms'
import { principalFromUser, staff } from '../../../domain/access'
import { canRenew } from '../../../domain/review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST (form) from Due for review: `ids` plus action renew | snooze | archive. Renew and snooze are allowed for each
 * item's owner and administrators; archive is administrators only. Items that fail are counted, not silently skipped.
 */
export async function POST(request: Request) {
  const parsed = await adminForm(request)
  if ('response' in parsed) return parsed.response
  const { context, form, origin } = parsed
  const action = String(form.get('action') ?? '')
  const ids = [...new Set(form.getAll('ids').map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 200)
  const isAdmin = staff(principalFromUser(context.user), 'admin')
  if (!['renew', 'snooze', 'archive'].includes(action) || !ids.length) return redirectTo(origin, '/admin/due-for-review?outcome=nothing_selected')
  if (action === 'archive' && !isAdmin) return redirectTo(origin, '/admin/due-for-review?outcome=admin_only')
  let done = 0, skipped = 0
  for (const id of ids) {
    try {
      const doc = await context.payload.findByID({ collection: 'content', id, overrideAccess: true, depth: 0 })
      if (!canRenew({ isAdmin, userId: context.user.id, owner: doc.owner as never })) { skipped++; continue }
      if (action !== 'archive' && doc.reviewWindow === 'fixedDate' && action === 'renew') { skipped++; continue }
      await context.payload.update({ collection: 'content', id, overrideAccess: true, depth: 0,
        data: action === 'archive' ? { state: 'archived' } : {}, context: action === 'renew' ? { reviewRenewal: true } : action === 'snooze' ? { reviewSnooze: true } : {} })
      done++
    } catch { skipped++ }
  }
  return redirectTo(origin, `/admin/due-for-review?${new URLSearchParams({ outcome: `bulk_${action}`, done: String(done), skipped: String(skipped) })}`)
}
