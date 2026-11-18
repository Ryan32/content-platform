export const dynamic = 'force-dynamic'
export function GET() {
  const origin = process.env.PLATFORM_ORIGIN
  const issuer = process.env.AUTH0_ISSUER
  if (!origin || !issuer) return new Response('Service not configured', { status: 503 })
  return Response.json({ resource: new URL('/mcp', origin).toString(), authorization_servers: [issuer],
    scopes_supported: ['content:search', 'content:read'], bearer_methods_supported: ['header'] })
}
