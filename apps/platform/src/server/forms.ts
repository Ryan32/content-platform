import { editorContext } from './editor'
import { allowsBrowserSession } from '../auth/browser'

/** Same-origin form posts from the admin. Returns the editor context, or a Response to send back. */
export async function adminForm(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!allowsBrowserSession(request.headers) || request.headers.get('origin') !== origin) return { response: new Response('Forbidden', { status: 403 }) }
  if (Number(request.headers.get('content-length') ?? 0) > 50000) return { response: new Response('Request too large', { status: 413 }) }
  const context = await editorContext(request.headers)
  if (!context) return { response: new Response('Editor access required', { status: 403 }) }
  let form: FormData
  try { form = await request.formData() } catch { return { response: new Response('Invalid request', { status: 400 }) } }
  return { context, form, origin }
}
export const redirectTo = (origin: string, path: string) => new Response(null, { status: 303, headers: { Location: `${origin}${path}`, 'Cache-Control': 'no-store' } })
/** Only internal admin paths are allowed as a return address. */
export const safeAdminPath = (value: FormDataEntryValue | null, fallback: string) => typeof value === 'string' && /^\/admin\/[A-Za-z0-9/_?=&.-]*$/.test(value) && !value.startsWith('//') ? value : fallback
