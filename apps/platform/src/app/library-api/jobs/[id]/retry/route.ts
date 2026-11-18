import { editorContext } from '../../../../../server/editor'
import { allowsBrowserSession } from '../../../../../auth/browser'
import { principalFromUser, staff } from '../../../../../domain/access'
import { JobStore, ProcessingError } from '../../../../../processing/jobs'
import { queuePool } from '../../../../../server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST (form): administrators retry a failed job. Returns to the automation status page. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!allowsBrowserSession(request.headers) || request.headers.get('origin') !== origin) return new Response('Forbidden', { status: 403 })
  const context = await editorContext(request.headers)
  if (!context || !staff(principalFromUser(context.user), 'admin')) return new Response('Administrator access required', { status: 403 })
  const id = Number((await params).id)
  let outcome = 'retried'
  try {
    if (!Number.isSafeInteger(id) || id < 1) throw new ProcessingError('invalid_id')
    await new JobStore(queuePool()).retry(id)
  } catch (error) { outcome = error instanceof ProcessingError ? error.code : 'retry_failed' }
  return new Response(null, { status: 303, headers: { Location: `${origin}/admin/automation?${new URLSearchParams({ outcome, job: String(id) })}`, 'Cache-Control': 'no-store' } })
}
