import { editorContext } from '../../../server/editor'
import { UploadError, createItemFromFile } from '../../../server/processing'
import { allowsBrowserSession } from '../../../auth/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/** POST multipart `file` (+ optional `title`): create one Intake library item from a file. The bulk-add page calls this once per file. */
export async function POST(request: Request) {
  if (!allowsBrowserSession(request.headers) || !request.headers.get('origin')) return json({ error: 'Forbidden' }, 403)
  const context = await editorContext(request.headers)
  if (!context) return json({ error: 'Editor access required.' }, 403)
  if (Number(request.headers.get('content-length') ?? 0) > 52 * 1024 * 1024) return json({ error: 'Files must be 50 MB or smaller.' }, 413)
  let form: FormData
  try { form = await request.formData() } catch { return json({ error: 'Choose a file to upload.' }, 400) }
  const file = form.get('file'), title = form.get('title')
  if (!(file instanceof File)) return json({ error: 'Choose a file to upload.' }, 400)
  try {
    const result = await createItemFromFile(context.payload, { ...context.user, collection: 'users' }, file, typeof title === 'string' ? title : undefined)
    return json({ status: 'created', ...result })
  } catch (error) {
    const contentId = (error as { contentId?: number }).contentId
    if (error instanceof UploadError) return json({ error: error.message, contentId }, error.status)
    console.error(`Library bulk add failed: ${(error as { code?: string; name?: string }).code ?? (error as Error).name}`)
    return json({ error: contentId ? 'The item was created but the file did not upload. Open it and upload again.' : 'The item could not be created.', contentId }, 500)
  }
}
