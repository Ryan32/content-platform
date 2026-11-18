import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { syncSignedInUser } from '../src/server/identity'
import { emailTrusted } from '../src/auth/browser'
import { Users } from '../src/collections'

const ISSUER = 'https://identity.example/'
type Person = { id: number; subject?: string | null; issuer?: string | null; email?: string | null; name?: string | null }

/** Minimal in-memory stand-in for the users queries made by syncSignedInUser. */
function fakePayload(people: Person[]) {
  const update = vi.fn(async ({ id, data }: { id: number; data: Partial<Person> }) => Object.assign(people.find(p => p.id === id)!, data))
  const find = vi.fn(async ({ where }: { where: any }) => {
    const clauses: any[] = where.and
    const match = (p: Person) => clauses.every(clause => {
      if (clause.or) return clause.or.some((c: any) => c.subject?.exists === false ? !p.subject : c.subject?.equals === '' ? p.subject === '' : false)
      const [key, test] = Object.entries(clause)[0] as [keyof Person | 'id', any]
      if ('equals' in test) return p[key] === test.equals
      if ('not_equals' in test) return p[key] !== test.not_equals
      return true
    })
    return { docs: people.filter(match) }
  })
  return { payload: { find, update } as unknown as Payload, update }
}
const profile = (overrides = {}) => ({ issuer: ISSUER, subject: 'waad|abc', email: 'pat@example.com', emailTrusted: true, name: 'Pat Lee', ...overrides })

afterEach(() => vi.unstubAllEnvs())

describe('REQ-AUTH-04: email invitations and sign-in profile', () => {
  it('links exactly one unlinked invitation with a trusted email, without changing roles or access', async () => {
    const people: Person[] = [{ id: 7, email: 'pat@example.com', name: 'pat@example.com' }]
    const { payload, update } = fakePayload(people)
    expect(await syncSignedInUser(payload, profile(), new Date('2026-11-18T12:00:00Z'))).toBe('linked')
    expect(update.mock.calls[0][0]).toMatchObject({ id: 7, data: { subject: 'waad|abc', issuer: ISSUER, name: 'Pat Lee', lastSignInAt: '2026-11-18T12:00:00.000Z' } })
    expect(Object.keys(update.mock.calls[0][0].data)).not.toEqual(expect.arrayContaining(['roles', 'active', 'memberships']))
  })

  it('never links an untrusted email, an already-linked record, or an ambiguous match', async () => {
    expect(await syncSignedInUser(fakePayload([{ id: 1, email: 'pat@example.com' }]).payload, profile({ emailTrusted: false }))).toBe('unprovisioned')
    expect(await syncSignedInUser(fakePayload([{ id: 1, email: 'pat@example.com', subject: 'waad|someone-else', issuer: ISSUER }]).payload, profile())).toBe('unprovisioned')
    const twin = fakePayload([{ id: 1, email: 'pat@example.com' }, { id: 2, email: 'pat@example.com', subject: '' }])
    expect(await syncSignedInUser(twin.payload, profile())).toBe('unprovisioned')
    expect(twin.update).not.toHaveBeenCalled()
    expect(await syncSignedInUser(fakePayload([]).payload, profile())).toBe('unprovisioned')
  })

  it('refreshes last sign-in and fills a missing name and email for an existing person', async () => {
    const people: Person[] = [{ id: 3, subject: 'waad|abc', issuer: ISSUER, name: null, email: null }]
    const { payload } = fakePayload(people)
    expect(await syncSignedInUser(payload, profile())).toBe('updated')
    expect(people[0]).toMatchObject({ name: 'Pat Lee', email: 'pat@example.com' })
    const named: Person[] = [{ id: 4, subject: 'waad|abc', issuer: ISSUER, name: 'Chosen Name', email: 'kept@example.com' }]
    await syncSignedInUser(fakePayload(named).payload, profile())
    expect(named[0]).toMatchObject({ name: 'Chosen Name', email: 'kept@example.com' })
  })

  it('trusts directory-asserted email for enterprise connections, otherwise only verified email', () => {
    expect(emailTrusted('waad|abc', undefined)).toBe(true)
    expect(emailTrusted('google-oauth2|abc', false)).toBe(false)
    expect(emailTrusted('auth0|abc', true)).toBe(true)
    vi.stubEnv('AUTH0_TRUSTED_EMAIL_CONNECTIONS', '')
    expect(emailTrusted('waad|abc', undefined)).toBe(false)
  })

  it('requires an email or Auth0 ID and normalizes invitations', async () => {
    const [normalize, require] = Users.hooks!.beforeValidate!
    vi.stubEnv('AUTH0_ISSUER', ISSUER)
    const data = await normalize({ data: { email: '  Pat@Example.COM ' } } as any)
    expect(data).toMatchObject({ email: 'pat@example.com', name: 'pat@example.com', issuer: ISSUER })
    expect(() => require({ data: { name: 'No email' } } as any)).toThrow('work email')
  })
})
