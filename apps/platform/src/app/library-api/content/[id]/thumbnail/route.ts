import { editorContext } from '../../../../../server/editor'
import { allowsBrowserSession } from '../../../../../auth/browser'
import { clearCoverImage, setCoverImage } from '../../../../../server/thumbnails'
import { ProcessingError } from '../../../../../processing/jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const MESSAGES: Record<string, [number, string]> = {
  invalid_thumbnail: [415, 'Use a JPEG, PNG, or WebP image up to 5 MB.'],
  content_bucket_required: [503, 'File storage is not configured.'],
  not_found: [404, 'Library item not found.'],
}

async function guard(request: Request, params: Promise<{ id: string }>) {
  if (!allowsBrowserSession(request.headers) || !request.headers.get('origin')) return { error: json({ error: 'Forbidden' }, 403) }
  const context = await editorContext(request.headers)
  if (!context) return { error: json({ error: 'Editor access required.' }, 403) }
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id) || id < 1) return { error: json({ error: 'Library item not found.' }, 404) }
  return { context, id }
}

/** POST multipart `file`: set the item's cover image. DELETE: remove it and return to the automatic thumbnail. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checked = await guard(request, params)
  if ('error' in checked) return checked.error
  if (Number(request.headers.get('content-length') ?? 0) > 6 * 1024 * 1024) return json({ error: MESSAGES.invalid_thumbnail[1] }, 413)
  let file: FormDataEntryValue | null
  try { file = (await request.formData()).get('file') } catch { return json({ error: 'Choose an image.' }, 400) }
  if (!(file instanceof File)) return json({ error: 'Choose an image.' }, 400)
  try { return json(await setCoverImage(checked.context.payload, checked.id, file)) } catch (error) {
    const [status, message] = error instanceof ProcessingError && MESSAGES[error.code] ? MESSAGES[error.code] : [500, 'The image could not be saved. Try again.']
    if (status === 500) console.error(`Cover upload failed: ${(error as { name?: string }).name}`)
    return json({ error: message }, status)
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checked = await guard(request, params)
  if ('error' in checked) return checked.error
  await clearCoverImage(checked.context.payload, checked.id)
  return json({ status: 'cleared' })
}
