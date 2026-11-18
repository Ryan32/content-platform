import { createRemoteJWKSet, jwtVerify } from 'jose'

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
export async function verifyBearer(header: string | null) {
  if (!header?.startsWith('Bearer ')) return null
  const issuer = process.env.AUTH0_ISSUER
  const audience = process.env.AUTH0_AUDIENCE
  if (!issuer || !audience) throw new Error('Identity configuration unavailable')
  const url = new URL(issuer)
  if (url.protocol !== 'https:') throw new Error('Auth0 issuer must use HTTPS')
  jwks ??= createRemoteJWKSet(new URL('.well-known/jwks.json', issuer.endsWith('/') ? issuer : `${issuer}/`))
  try {
    const { payload } = await jwtVerify(header.slice(7), jwks, { issuer, audience, algorithms: ['RS256'] })
    if (!payload.sub || typeof payload.exp !== 'number') return null
    return { subject: payload.sub, issuer, scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [] }
  } catch { return null }
}
