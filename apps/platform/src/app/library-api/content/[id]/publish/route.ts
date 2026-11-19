import { adminForm, redirectTo, safeAdminPath } from '../../../../../server/forms'
import { principalFromUser, staff } from '../../../../../domain/access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST (form): administrators publish an item. The content hook still requires an access profile and sets the review clock. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = await adminForm(request)
  if ('response' in parsed) return parsed.response
  const { context, form, origin } = parsed
  const id = Number((await params).id)
  const back = safeAdminPath(form.get('returnTo'), `/admin/collections/content/${id}`)
  if (!staff(principalFromUser(context.user), 'admin')) return redirectTo(origin, `${back}&error=admin_only`)
  try { await context.payload.update({ collection: 'content', id, data: { state: 'published' }, user: context.user, overrideAccess: false, depth: 0 }) }
  catch (error) { return redirectTo(origin, `${back}&error=${encodeURIComponent((error instanceof Error ? error.message : 'publish_failed').slice(0, 120))}`) }
  return redirectTo(origin, `${back}&published=1`)
}
