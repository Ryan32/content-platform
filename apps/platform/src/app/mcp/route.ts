import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { verifyBearer } from '../../auth/verify'
import { authenticatedLibrary } from '../../server/library'
import { createContentMcp } from '../../mcp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || !process.env.AUTH0_ISSUER || !process.env.AUTH0_AUDIENCE) return new Response('Service not configured', { status: 503 })
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(origin).origin) return new Response('Origin not allowed', { status: 403 })
  try {
    const identity = await verifyBearer(request.headers.get('authorization'))
    if (!identity) return new Response('Authentication required', { status: 401, headers: {
      'WWW-Authenticate': `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', origin)}"`,
      'Cache-Control': 'no-store',
    } })
    if (!identity.scopes.some(scope => ['content:read', 'content:search'].includes(scope))) return new Response('Insufficient scope', {
      status: 403, headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="content:read content:search"' },
    })
    // Read incrementally so chunked requests cannot evade the payload limit.
    const reader = request.body?.getReader()
    if (!reader) return new Response('Missing request', { status: 400 })
    const chunks: Uint8Array[] = []; let size = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > 65536) { await reader.cancel(); return new Response('Request too large', { status: 413 }) }
      chunks.push(part.value)
    }
    let parsed: unknown
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return new Response('Invalid JSON', { status: 400 }) }
    const repository = await authenticatedLibrary(request.headers)
    if (!repository) return new Response('Access denied', { status: 403 })
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    const server = createContentMcp(repository, origin, identity.scopes)
    try {
      await server.connect(transport)
      const response = await transport.handleRequest(request, { parsedBody: parsed })
      // Consume JSON before cleanup; no long-lived sessions or shared user clients.
      const body = await response.arrayBuffer()
      const headers = new Headers(response.headers); headers.set('Cache-Control', 'no-store')
      return new Response(body.byteLength ? body : null, { status: response.status, headers })
    } finally { await server.close() }
  } catch { return new Response('Content service unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } }) }
}
export function GET() { return new Response(null, { status: 405, headers: { Allow: 'POST' } }) }
export const DELETE = GET
