import { editorContext } from '../../../../../server/editor'
import { allowsBrowserSession } from '../../../../../auth/browser'
import { principalFromUser, staff } from '../../../../../domain/access'
import { canRenew } from '../../../../../domain/review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST (form): renew an item's review. Allowed for administrators and the item's owner. Renewing records a human review
 * now and sets the next due date from the item's window; a "set date" item needs a new future date. AI never calls this.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!allowsBrowserSession(request.headers) || request.headers.get('origin') !== origin) return new Response('Forbidden', { status: 403 })
  const context = await editorContext(request.headers)
  if (!context) return new Response('Editor access required', { status: 403 })
  const back = (outcome: string, id?: number) => new Response(null, { status: 303,
    headers: { Location: `${origin}/admin/due-for-review?${new URLSearchParams({ outcome, ...(id ? { item: String(id) } : {}) })}`, 'Cache-Control': 'no-store' } })
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id) || id < 1) return back('not_found')
  const { payload, user } = context
  let doc
  try { doc = await payload.findByID({ collection: 'content', id, overrideAccess: true, depth: 0 }) } catch { return back('not_found') }
  const isAdmin = staff(principalFromUser(user), 'admin')
  if (!canRenew({ isAdmin, userId: user.id, owner: doc.owner as number | { id: number } | null | undefined })) return back('not_owner', id)
  let form: FormData
  try { form = await request.formData() } catch { return back('invalid', id) }
  const data: Record<string, unknown> = {}
  if (doc.reviewWindow === 'fixedDate') {
    const raw = String(form.get('reviewOn') ?? '')
    const next = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00Z`) : null
    if (!next || next.getTime() <= Date.now()) return back('date_required', id)
    data.reviewOn = next.toISOString()
  }
  try {
    await payload.update({ collection: 'content', id, data, overrideAccess: true, depth: 0, context: { reviewRenewal: true } })
  } catch { return back('renew_failed', id) }
  return back('renewed', id)
}
