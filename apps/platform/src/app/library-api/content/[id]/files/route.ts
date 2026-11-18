import { editorContext } from '../../../../../server/editor'
import { UploadError, uploadSource } from '../../../../../server/processing'
import { allowsBrowserSession } from '../../../../../auth/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/** POST multipart `file`: editors attach a source file to a library item. Processing is queued by the worker. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!allowsBrowserSession(request.headers) || !request.headers.get('origin')) return json({ error: 'Forbidden' }, 403)
  const context = await editorContext(request.headers)
  if (!context) return json({ error: 'Editor access required.' }, 403)
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id) || id < 1) return json({ error: 'Library item not found.' }, 404)
  if (Number(request.headers.get('content-length') ?? 0) > 52 * 1024 * 1024) return json({ error: 'Files must be 50 MB or smaller.' }, 413)
  let file: FormDataEntryValue | null
  try { file = (await request.formData()).get('file') } catch { return json({ error: 'Choose a file to upload.' }, 400) }
  if (!(file instanceof File)) return json({ error: 'Choose a file to upload.' }, 400)
  try {
    const result = await uploadSource(context.payload, id, file)
    return json({ status: 'uploaded', ...result })
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message }, error.status)
    console.error(`Library upload failed: ${(error as { code?: string; name?: string }).code ?? (error as Error).name}`)
    return json({ error: 'The upload failed. Try again; if it keeps failing, contact an administrator.' }, 500)
  }
}
