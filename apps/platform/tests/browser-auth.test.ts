import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, generateKeyPair } from 'jose'
import { createHash } from 'node:crypto'

const keys = vi.hoisted(() => ({ publicKey: undefined as CryptoKey | undefined }))
vi.mock('jose', async importOriginal => ({ ...await importOriginal<typeof import('jose')>(),
  createRemoteJWKSet: () => async () => keys.publicKey,
}))
import { beginLogin, completeLogin, logout, readSession, safeReturnTo } from '../src/auth/browser'
import { Users } from '../src/collections'

const ISSUER = 'https://identity.example/'
const ORIGIN = 'https://library.example'
const CLIENT = 'library-web-client'
let privateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey; keys.publicKey = pair.publicKey
  vi.stubEnv('AUTH0_ISSUER', ISSUER)
  vi.stubEnv('AUTH0_AUDIENCE', `${ORIGIN}/mcp`)
  vi.stubEnv('AUTH0_CLIENT_ID', CLIENT)
  vi.stubEnv('AUTH0_CLIENT_SECRET', 'synthetic-client-secret')
  vi.stubEnv('AUTH_SESSION_SECRET', 'synthetic-session-secret-with-at-least-32-chars')
  vi.stubEnv('PLATFORM_ORIGIN', ORIGIN)
})
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
beforeEach(() => vi.unstubAllGlobals())

const cookieValue = (response: Response, name: string) =>
  response.headers.getSetCookie().find(value => value.startsWith(`${name}=`))?.split(';')[0]

async function idToken(claims: Record<string, unknown>, audience = CLIENT) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).setIssuer(ISSUER).setAudience(audience)
    .setSubject('waad|synthetic-user').setIssuedAt().setExpirationTime('5m').sign(privateKey)
}

/** Runs the login redirect, then the callback with a mocked Auth0 token endpoint. */
async function signIn(options: { nonce?: string; state?: string; audience?: string } = {}) {
  const start = await beginLogin(new Request(`${ORIGIN}/auth/login?returnTo=%2Fresources%2F7`))
  const authorize = new URL(start.headers.get('location')!)
  const loginCookie = cookieValue(start, '__Host-library-login')!
  const tokenRequests: URLSearchParams[] = []
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    tokenRequests.push(new URLSearchParams(String(init.body)))
    return Response.json({ id_token: await idToken({ nonce: options.nonce ?? authorize.searchParams.get('nonce') }, options.audience) })
  })
  const callback = await completeLogin(new Request(
    `${ORIGIN}/auth/callback?code=synthetic-code&state=${options.state ?? authorize.searchParams.get('state')}`,
    { headers: { cookie: loginCookie } }))
  return { start, authorize, loginCookie, callback, tokenRequests }
}

describe('REQ-AUTH-03: Auth0 browser sign-in', () => {
  it('starts an authorization-code flow with PKCE, state and nonce in a secure, HTTP-only cookie', async () => {
    const { start, authorize, loginCookie } = await signIn()
    expect(start.status).toBe(303)
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${ISSUER}authorize`)
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({ response_type: 'code', client_id: CLIENT,
      redirect_uri: `${ORIGIN}/auth/callback`, scope: 'openid profile email', code_challenge_method: 'S256' })
    expect(loginCookie).toBeTruthy()
    expect(start.headers.getSetCookie()[0]).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600; Secure/)
  })

  it('exchanges the code with the PKCE verifier, verifies the ID token, and sets an encrypted session', async () => {
    const { authorize, callback, tokenRequests } = await signIn()
    const verifier = tokenRequests[0].get('code_verifier')!
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(authorize.searchParams.get('code_challenge'))
    expect(tokenRequests[0].get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`)
    expect(callback.headers.get('location')).toBe(`${ORIGIN}/resources/7`)
    const session = cookieValue(callback, '__Host-library-session')!
    expect(session).not.toContain('waad|synthetic-user')
    expect(await readSession(session)).toEqual({ issuer: ISSUER, subject: 'waad|synthetic-user' })
  })

  it('rejects mismatched state, mismatched nonce, and ID tokens for another client', async () => {
    for (const options of [{ state: 'forged' }, { nonce: 'replayed' }, { audience: 'portal-client' }]) {
      const { callback } = await signIn(options)
      expect(callback.headers.get('location')).toBe(`${ORIGIN}/?signin=failed`)
      expect(cookieValue(callback, '__Host-library-session')).toBeUndefined()
    }
  })

  it('rejects tampered or foreign session cookies', async () => {
    const session = cookieValue((await signIn()).callback, '__Host-library-session')!
    const [name, value] = session.split('=')
    const tampered = `${name}=${value.slice(0, -4)}${value.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`
    expect(await readSession(tampered)).toBeNull()
    vi.stubEnv('AUTH0_ISSUER', 'https://other-tenant.example/')
    expect(await readSession(session)).toBeNull()
    vi.stubEnv('AUTH0_ISSUER', ISSUER)
  })

  it('only returns to same-site relative paths', () => {
    for (const unsafe of ['//evil.example', 'https://evil.example', '/\\evil.example', 'resources/1', '/\r\ninvalid', '/\tinvalid', null]) expect(safeReturnTo(unsafe)).toBe('/')
    expect(safeReturnTo('/resources/12?citation=c1')).toBe('/resources/12?citation=c1')
  })

  it('signs out only same-origin requests and ends the Auth0 session', async () => {
    expect((await logout(new Request(`${ORIGIN}/auth/logout`, { method: 'POST' }))).status).toBe(403)
    expect((await logout(new Request(`${ORIGIN}/auth/logout`, { method: 'POST', headers: { origin: 'https://evil.example' } }))).status).toBe(403)
    const response = await logout(new Request(`${ORIGIN}/auth/logout`, { method: 'POST', headers: { origin: ORIGIN } }))
    expect(response.headers.get('location')).toBe(`${ISSUER}oidc/logout?client_id=${CLIENT}&post_logout_redirect_uri=${encodeURIComponent(ORIGIN)}`)
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-library-session=; .*Max-Age=0/)
  })
})

describe('REQ-AUTH-03: Payload strategy uses sessions only for browser requests', () => {
  const authenticate = (Users.auth as any).strategies[0].authenticate
  const payload = { find: vi.fn(async () => ({ docs: [{ id: 1, active: true, roles: ['admin'] }] })) }

  it('resolves a provisioned, active user from a same-site session cookie', async () => {
    const session = cookieValue((await signIn()).callback, '__Host-library-session')!
    payload.find.mockClear()
    const { user } = await authenticate({ headers: new Headers({ cookie: session, 'sec-fetch-site': 'same-origin' }), payload })
    expect(user).toMatchObject({ id: 1, collection: 'users' })
    expect(JSON.stringify(payload.find.mock.calls[0])).toContain('waad|synthetic-user')
  })

  it('ignores the cookie for cross-site requests or when an (invalid) bearer token is supplied', async () => {
    const session = cookieValue((await signIn()).callback, '__Host-library-session')!
    payload.find.mockClear()
    const cases: Record<string, string>[] = [{ cookie: session, 'sec-fetch-site': 'cross-site' },
      { cookie: session, 'sec-fetch-site': 'same-site', origin: 'https://other.library.example' },
      { cookie: session, origin: 'null' }, { cookie: session, authorization: 'Bearer invalid' }]
    for (const headers of cases) {
      expect((await authenticate({ headers: new Headers(headers), payload })).user).toBeNull()
    }
    expect(payload.find).not.toHaveBeenCalled()
  })
})
