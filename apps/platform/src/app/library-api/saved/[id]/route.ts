import { authenticatedLibrary } from '../../../../server/library'
import { allowsBrowserSession } from '../../../../auth/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

/** PUT saves an item for the signed-in reader; DELETE removes it. Only items the reader can open can be saved. */
async function handle(request: Request, params: Promise<{ id: string }>, saved: boolean) {
  if (!allowsBrowserSession(request.headers) || !request.headers.get('origin')) return json({ error: 'Forbidden' }, 403)
  let library
  try { library = await authenticatedLibrary(request.headers) } catch { return json({ error: 'Unavailable' }, 503) }
  if (!library) return json({ error: 'Sign in to save items.' }, 401)
  const ok = await library.setSaved((await params).id, saved)
  return ok ? json({ saved }) : json({ error: 'Not found' }, 404)
}
export const PUT = (request: Request, { params }: { params: Promise<{ id: string }> }) => handle(request, params, true)
export const DELETE = (request: Request, { params }: { params: Promise<{ id: string }> }) => handle(request, params, false)
