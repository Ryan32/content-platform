import { authenticatedLibrary } from '../../../../server/library'
import { allowsBrowserSession } from '../../../../auth/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

/** POST { kind: helpful | not-helpful | edit, comment? }: reader feedback on an item they can open. Editors read it in the admin. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!allowsBrowserSession(request.headers) || !request.headers.get('origin')) return json({ error: 'Forbidden' }, 403)
  let body: { kind?: string; comment?: string }
  try { body = await request.json() } catch { return json({ error: 'Invalid request' }, 400) }
  if (!['helpful', 'not-helpful', 'edit'].includes(body.kind ?? '')) return json({ error: 'Invalid request' }, 400)
  if (body.kind === 'edit' && !body.comment?.trim()) return json({ error: 'Describe the change.' }, 400)
  let library
  try { library = await authenticatedLibrary(request.headers) } catch { return json({ error: 'Unavailable' }, 503) }
  if (!library) return json({ error: 'Sign in first.' }, 401)
  const ok = await library.feedback((await params).id, body.kind as 'helpful', typeof body.comment === 'string' ? body.comment : undefined)
  return ok ? json({ ok: true }) : json({ error: 'Not found' }, 404)
}
