import { adminForm, redirectTo, safeAdminPath } from '../../../../../server/forms'
import { principalFromUser, staff } from '../../../../../domain/access'
import { AUDIENCES, LICENSING, LINES, PAGE_OPTIONS, PROGRAMS, SECTION_OPTIONS, TOPIC_OPTIONS } from '../../../../../domain/navigation'
import { REVIEW_WINDOWS } from '../../../../../domain/review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const pick = (form: FormData, key: string, allowed: readonly { value: string }[]) => form.getAll(key).map(String).filter(v => allowed.some(a => a.value === v))
const one = (form: FormData, key: string, allowed: readonly { value: string }[]) => { const v = form.get(key); return typeof v === 'string' && allowed.some(a => a.value === v) ? v : null }

/**
 * POST (form): where an item appears, its filters and its review schedule, from the Add content wizard. Editors can set
 * everything here except the audience (access profile), which only administrators can change. Never touches the text.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = await adminForm(request)
  if ('response' in parsed) return parsed.response
  const { context, form, origin } = parsed
  const id = Number((await params).id)
  const back = safeAdminPath(form.get('returnTo'), `/admin/collections/content/${id}`)
  if (!Number.isSafeInteger(id) || id < 1) return redirectTo(origin, back)
  const data: Record<string, unknown> = {}
  const part = form.get('part')
  if (part === 'details') {
    Object.assign(data, { section: one(form, 'section', SECTION_OPTIONS), topics: pick(form, 'topics', TOPIC_OPTIONS), pages: pick(form, 'pages', PAGE_OPTIONS),
      audience: one(form, 'audience', AUDIENCES) ?? 'advisor', licensing: pick(form, 'licensing', LICENSING), lines: pick(form, 'lines', LINES),
      program: one(form, 'program', PROGRAMS), carriers: form.getAll('carriers').map(Number).filter(n => Number.isSafeInteger(n) && n > 0),
      kind: one(form, 'kind', [{ value: 'resource' }, { value: 'howto' }, { value: 'news' }, { value: 'bulletin' }]) ?? 'resource' })
  }
  if (part === 'review') {
    data.reviewWindow = one(form, 'reviewWindow', REVIEW_WINDOWS.map(w => ({ value: w.id }))) ?? 'annual'
    const on = String(form.get('reviewOn') ?? '')
    if (data.reviewWindow === 'fixedDate') data.reviewOn = /^\d{4}-\d{2}-\d{2}$/.test(on) ? new Date(`${on}T12:00:00Z`).toISOString() : null
    const owner = Number(form.get('owner'))
    if (Number.isSafeInteger(owner) && owner > 0) data.owner = owner
    const profile = Number(form.get('accessProfile'))
    if (staff(principalFromUser(context.user), 'admin') && Number.isSafeInteger(profile) && profile > 0) data.accessProfile = profile
  }
  try {
    // Editors may update content fields; access-profile changes above are admin-only and re-checked by field access.
    await context.payload.update({ collection: 'content', id, data, user: context.user, overrideAccess: false, depth: 0 })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return redirectTo(origin, `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(message.slice(0, 120) || 'save_failed')}`)
  }
  return redirectTo(origin, safeAdminPath(form.get('next'), back))
}
