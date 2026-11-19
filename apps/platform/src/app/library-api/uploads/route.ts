import { z } from 'zod'
import { editorContext } from '../../../server/editor'
import { UploadError } from '../../../server/processing'
import { createItemForLargeUpload, signLargeUpload } from '../../../server/large-upload'
import { allowsBrowserSession } from '../../../auth/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const input = z.object({ contentId: z.number().int().positive().optional(), name: z.string().min(1).max(300), size: z.number().int().positive(),
  title: z.string().max(200).optional() }).strict()

/**
 * POST JSON { name, size, contentId?, title? }: signs a direct-to-S3 upload for a file over 50 MB (audio/video up to
 * 2 GB, PDF up to 500 MB). Without contentId it first creates an Intake item (Add content, Bulk add). Editors only.
 */
export async function POST(request: Request) {
  if (!allowsBrowserSession(request.headers) || !request.headers.get('origin')) return json({ error: 'Forbidden' }, 403)
  const context = await editorContext(request.headers)
  if (!context) return json({ error: 'Editor access required.' }, 403)
  if (Number(request.headers.get('content-length') ?? 0) > 4096) return json({ error: 'Request too large' }, 413)
  const parsed = input.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: 'Choose a file to upload.' }, 400)
  const { contentId, name, size, title } = parsed.data
  try {
    const signed = contentId ? await signLargeUpload(context.payload, context.user.id, contentId, name, size)
      : await createItemForLargeUpload(context.payload, context.user as { id: number }, name, size, title)
    return json({ status: 'signed', ...signed })
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message }, error.status)
    console.error(`Large upload signing failed: ${(error as { code?: string; name?: string }).code ?? (error as Error).name}`)
    return json({ error: 'The upload could not be started. Try again.' }, 500)
  }
}
