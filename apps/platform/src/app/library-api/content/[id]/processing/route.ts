import { editorContext } from '../../../../../server/editor'
import { processingStatus } from '../../../../../server/processing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET: files, jobs, and suggestions for one library item, for the admin Processing panel. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await editorContext(request.headers)
  const headers = { 'Cache-Control': 'no-store' }
  if (!context) return Response.json({ error: 'Editor access required.' }, { status: 403, headers })
  const id = Number((await params).id)
  const status = Number.isSafeInteger(id) && id > 0 ? await processingStatus(context.payload, id) : null
  return status ? Response.json(status, { headers }) : Response.json({ error: 'Library item not found.' }, { status: 404, headers })
}
