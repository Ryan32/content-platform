import { EncryptJWT, createRemoteJWKSet, jwtDecrypt, jwtVerify } from 'jose'
import { createHash, randomBytes } from 'node:crypto'

/** Server-held browser identity. Authorization still comes from the provisioned users record. */
export interface BrowserIdentity { issuer: string; subject: string }

const SESSION_AUDIENCE = 'ae-library-session'
const LOGIN_AUDIENCE = 'ae-library-login'
const SESSION_SECONDS = 8 * 60 * 60
const LOGIN_SECONDS = 10 * 60

function issuerBase(issuer: string) {
  const url = new URL(issuer)
  if (url.protocol !== 'https:') throw new Error('Auth0 issuer must use HTTPS')
  return issuer.endsWith('/') ? issuer : `${issuer}/`
}
function secureOrigin() {
  const origin = process.env.PLATFORM_ORIGIN
  return Boolean(origin && new URL(origin).protocol === 'https:')
}
function sessionKey() {
  const secret = process.env.AUTH_SESSION_SECRET
  return secret && secret.length >= 32 ? createHash('sha256').update(`session:${secret}`).digest() : null
}
// __Host- cookies require Secure, so plain-HTTP loopback development uses unprefixed names.
export const cookieNames = () => secureOrigin()
  ? { session: '__Host-library-session', login: '__Host-library-login' }
  : { session: 'library-session', login: 'library-login' }

function readCookie(header: string | null, name: string) {
  for (const part of header?.split(';') ?? []) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}
function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureOrigin() ? '; Secure' : ''}`
}

export function hasSessionCookie(headers: Headers) { return Boolean(readCookie(headers.get('cookie'), cookieNames().session)) }

/** Same-site sibling applications are not trusted to submit library mutations. */
export function allowsBrowserSession(headers: Headers) {
  if (headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = headers.get('origin')
  if (!origin) return true // Includes server renders and top-level GET navigation.
  const configured = process.env.PLATFORM_ORIGIN
  return Boolean(configured && origin === new URL(configured).origin)
}

/** Returns the verified issuer/subject from the encrypted session cookie, or null. */
export async function readSession(cookieHeader: string | null): Promise<BrowserIdentity | null> {
  const key = sessionKey(); const issuer = process.env.AUTH0_ISSUER
  const token = readCookie(cookieHeader, cookieNames().session)
  if (!key || !issuer || !token) return null
  try {
    const { payload } = await jwtDecrypt(token, key, { audience: SESSION_AUDIENCE, maxTokenAge: SESSION_SECONDS })
    if (payload.idp !== issuer || typeof payload.sub !== 'string' || !payload.sub) return null
    return { issuer, subject: payload.sub }
  } catch { return null }
}

export function safeReturnTo(value: string | null | undefined) {
  if (!value || value.length > 500 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u0020\u007f]/.test(value)) return '/'
  return value
}

function config() {
  const issuer = process.env.AUTH0_ISSUER, clientId = process.env.AUTH0_CLIENT_ID, clientSecret = process.env.AUTH0_CLIENT_SECRET
  const origin = process.env.PLATFORM_ORIGIN, key = sessionKey()
  if (!issuer || !clientId || !clientSecret || !origin || !key) return null
  return { issuer, base: issuerBase(issuer), clientId, clientSecret, origin: new URL(origin).origin, key }
}
const random = () => randomBytes(32).toString('base64url')
function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const value of cookies) headers.append('Set-Cookie', value)
  return new Response(null, { status: 303, headers })
}
const unavailable = () => new Response('Sign-in is not configured', { status: 503, headers: { 'Cache-Control': 'no-store' } })

/** GET /auth/login: authorization-code flow with PKCE, state and nonce held in an encrypted, short-lived cookie. */
export async function beginLogin(request: Request) {
  const settings = config()
  if (!settings) return unavailable()
  const state = random(), nonce = random(), verifier = random()
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'))
  const transaction = await new EncryptJWT({ state, nonce, verifier, returnTo })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setAudience(LOGIN_AUDIENCE).setIssuedAt().setExpirationTime(`${LOGIN_SECONDS}s`)
    .encrypt(settings.key)
  const authorize = new URL('authorize', settings.base)
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: settings.clientId, redirect_uri: `${settings.origin}/auth/callback`,
    scope: 'openid', state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString()
  return redirect(authorize.toString(), [cookie(cookieNames().login, transaction, LOGIN_SECONDS)])
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
let jwksIssuer: string | undefined

// Reason codes only; never log codes, tokens, cookies, or claims.
function signInFailure(reason: string) { console.warn(`Browser sign-in failed: ${reason}`) }

/** Verifies an Auth0 ID token against the tenant JWKS. The application must use RS256. */
async function verifyIdToken(token: string, settings: NonNullable<ReturnType<typeof config>>) {
  if (!jwks || jwksIssuer !== settings.base) { jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', settings.base)); jwksIssuer = settings.base }
  return (await jwtVerify(token, jwks, { issuer: settings.issuer, audience: settings.clientId, algorithms: ['RS256'] })).payload
}

/** GET /auth/callback: validates state, exchanges the code, verifies the ID token, and sets the session cookie. */
export async function completeLogin(request: Request) {
  const settings = config()
  if (!settings) return unavailable()
  const names = cookieNames()
  const clear = cookie(names.login, '', 0)
  const failed = (reason: string) => { signInFailure(reason); return redirect(`${settings.origin}/?signin=failed`, [clear]) }
  const url = new URL(request.url)
  const providerError = url.searchParams.get('error')
  if (providerError) return failed(`provider_error:${providerError.replace(/[^\w.-]/g, '').slice(0, 60)}`)
  const code = url.searchParams.get('code'), state = url.searchParams.get('state')
  const stored = readCookie(request.headers.get('cookie'), names.login)
  if (!code || !state) return failed('missing_code_or_state')
  if (!stored) return failed('missing_login_cookie')
  let stage = 'login_cookie'
  try {
    const { payload: transaction } = await jwtDecrypt(stored, settings.key, { audience: LOGIN_AUDIENCE, maxTokenAge: LOGIN_SECONDS })
    if (transaction.state !== state || typeof transaction.verifier !== 'string' || typeof transaction.nonce !== 'string') return failed('state_mismatch')
    stage = 'token_exchange'
    const response = await fetch(new URL('oauth/token', settings.base), {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: settings.clientId, client_secret: settings.clientSecret,
        code, redirect_uri: `${settings.origin}/auth/callback`, code_verifier: transaction.verifier }),
    })
    if (!response.ok) {
      const error = await response.json().then((body: { error?: unknown }) => typeof body.error === 'string' ? body.error : 'unknown', () => 'unknown')
      return failed(`token_http_${response.status}:${error.replace(/[^\w.-]/g, '').slice(0, 60)}`)
    }
    const tokens = await response.json() as { id_token?: unknown }
    if (typeof tokens.id_token !== 'string') return failed('missing_id_token')
    stage = 'id_token'
    const idToken = await verifyIdToken(tokens.id_token, settings)
    if (idToken.nonce !== transaction.nonce) return failed('nonce_mismatch')
    if (typeof idToken.sub !== 'string' || !idToken.sub) return failed('missing_subject')
    const session = await new EncryptJWT({ idp: settings.issuer, sub: idToken.sub })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setAudience(SESSION_AUDIENCE).setIssuedAt().setExpirationTime(`${SESSION_SECONDS}s`)
      .encrypt(settings.key)
    const returnTo = safeReturnTo(typeof transaction.returnTo === 'string' ? transaction.returnTo : '/')
    return redirect(`${settings.origin}${returnTo}`, [clear, cookie(names.session, session, SESSION_SECONDS)])
  } catch (error) { return failed(`${stage}:${(error as { code?: string }).code ?? (error as Error).name}`) }
}

/** POST /auth/logout: same-origin only; clears the session and ends the Auth0 session. */
export async function logout(request: Request) {
  const settings = config()
  const origin = settings?.origin ?? (process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : null)
  const sent = request.headers.get('origin')
  if (!origin || (sent ? sent !== origin : request.headers.get('sec-fetch-site') !== 'same-origin')) return new Response('Forbidden', { status: 403 })
  const clear = cookie(cookieNames().session, '', 0)
  if (!settings) return redirect(`${origin}/`, [clear])
  const end = new URL('oidc/logout', settings.base)
  end.search = new URLSearchParams({ client_id: settings.clientId, post_logout_redirect_uri: origin }).toString()
  return redirect(end.toString(), [clear])
}
