import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { SignJWT, generateKeyPair } from 'jose'

const keys = vi.hoisted(() => ({ publicKey: undefined as CryptoKey | undefined }))
vi.mock('jose', async importOriginal => ({ ...await importOriginal<typeof import('jose')>(),
  createRemoteJWKSet: () => async () => keys.publicKey,
}))
import { verifyBearer } from '../src/auth/verify'

let privateKey: CryptoKey
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey; keys.publicKey = pair.publicKey
  vi.stubEnv('AUTH0_ISSUER', 'https://identity.example/')
  vi.stubEnv('AUTH0_AUDIENCE', 'https://library.example/mcp')
})
afterAll(() => vi.unstubAllEnvs())
async function token(options: { audience?: string; issuer?: string; expires?: string; omitExpiry?: boolean } = {}) {
  let jwt = new SignJWT({ scope: 'content:read' }).setProtectedHeader({ alg: 'RS256' })
    .setSubject('auth0|synthetic').setIssuer(options.issuer ?? 'https://identity.example/')
    .setAudience(options.audience ?? 'https://library.example/mcp')
  if (!options.omitExpiry) jwt = jwt.setExpirationTime(options.expires ?? '5m')
  return `Bearer ${await jwt.sign(privateKey)}`
}
describe('REQ-AUTH-02: validate access-token identity', () => {
  it('accepts a signed, unexpired token for this resource', async () => {
    expect(await verifyBearer(await token())).toEqual({ subject: 'auth0|synthetic', issuer: 'https://identity.example/', scopes: ['content:read'] })
  })
  it('rejects another audience, another issuer, expiry, missing expiry and missing token', async () => {
    for (const value of [await token({ audience: 'portal-id-token-client' }), await token({ issuer: 'https://other.example/' }),
      await token({ expires: '-1s' }), await token({ omitExpiry: true }), null, 'Bearer malformed']) {
      expect(await verifyBearer(value)).toBeNull()
    }
  })
  it('rejects tampered signed payloads', async () => {
    const signed = (await token()).slice(7).split('.')
    signed[1] = Buffer.from(JSON.stringify({ sub: 'admin', exp: 9999999999 })).toString('base64url')
    expect(await verifyBearer(`Bearer ${signed.join('.')}`)).toBeNull()
  })
})
