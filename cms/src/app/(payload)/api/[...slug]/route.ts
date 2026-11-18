import config from '@payload-config'
import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from '@payloadcms/next/routes'

export const dynamic = 'force-dynamic'

export const GET = REST_GET(config)
export const DELETE = REST_DELETE(config)
export const PATCH = REST_PATCH(config)
export const PUT = REST_PUT(config)
export const OPTIONS = REST_OPTIONS(config)

const post = REST_POST(config)

export async function POST(...[request, context]: Parameters<typeof post>) {
  const { slug } = await context.params
  if (slug?.includes('first-register')) return new Response(null, { status: 404 })
  return post(request, context)
}
