import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { AuthStrategyFunctionArgs, AuthStrategyResult, Payload, PayloadRequest, Where } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as getFile } from '../src/app/files/[id]/route'
import { POST as postMcp } from '../src/app/mcp/route'
import { Assets, Content, Users } from '../src/collections'
import { profileIds } from '../src/collections/access'
import { ImportArtifacts, ImportReviews, ImportRuns, SourceRelations, SourceSnapshots } from '../src/collections/imports'
import type { Action } from '../src/domain/access'
import type { LibraryRepository } from '../src/domain/library'
import { createContentMcp } from '../src/mcp/server'
import { authenticatedLibrary } from '../src/server/library'

// Synthetic identity and storage only. Exercise the real repository, policy callbacks, and MCP tools.
const payloadMock = vi.hoisted(() => ({ getPayload: vi.fn(), createLocalReq: vi.fn() }))
vi.mock('payload', () => payloadMock)
vi.mock('../src/payload.config', () => ({ default: {} }))
const identityMock = vi.hoisted(() => ({ verifyBearer: vi.fn(), readSession: vi.fn() }))
vi.mock('../src/auth/verify', () => ({ verifyBearer: identityMock.verifyBearer }))
vi.mock('../src/auth/browser', async importOriginal => ({
  ...await importOriginal<typeof import('../src/auth/browser')>(),
  readSession: identityMock.readSession,
}))
const objectStore = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-s3', async importOriginal => ({
  ...await importOriginal<typeof import('@aws-sdk/client-s3')>(),
  S3Client: class { send = objectStore.send },
}))

const origin = 'https://library.synthetic.example'
const issuer = 'https://identity.synthetic.example/'
const now = '2026-11-18T12:00:00.000Z'
const scopes = ['content:search', 'content:read']
const identityFor = (id: string | number) => ({ issuer, subject: `synthetic-subject-${id}` })
const membership = (scope: string, ...entitlements: string[]) => ({ scope, entitlements: entitlements.map(value => ({ value })) })
const user = (id: number, role: string, memberships: ReturnType<typeof membership>[] = [], active = true) =>
  ({ id, collection: 'users', active, roles: [role], memberships, ...identityFor(id) })
const annuity = user(1, 'reader', [membership('firm:a', 'annuity'), membership('firm:b', 'advisor')])
const wealth = user(2, 'reader', [membership('firm:b', 'wealth'), membership('firm:a', 'advisor')])
const inactive = user(3, 'reader', annuity.memberships, false)
const administrator = user(4, 'admin')
const editor = user(5, 'editor')
const bearer = (id: number) => new Headers({ authorization: `Bearer synthetic-token-for-${id}` })
const session = (id: number) => new Headers({ cookie: `__Host-library-session=synthetic-session-for-${id}` })

function authenticatePayload(args: AuthStrategyFunctionArgs) {
  const authenticate = typeof Users.auth === 'object' && Users.auth.strategies?.[0]?.authenticate
  if (!authenticate) throw new Error('Expected the Payload authentication strategy')
  return authenticate(args)
}

function profile(id: number, member: ReturnType<typeof membership>, actions: Action[], active = true) {
  return { id, active, grants: actions.map(action => ({ action, ...member })) }
}

function content(id: number, label: string, accessProfile: number, lifecycle: { state?: string; expiresAt?: string; availableAt?: string; reviewDueAt?: string; section?: string; topics?: string[]; pages?: string[]; kind?: string } = {}) {
  return { id, title: `Synthetic acceptance ${label}`, accessProfile, state: 'published', format: 'article',
    description: `Synthetic description ${id}`, body: `Synthetic private excerpt ${id}`, updatedAt: now,
    evidenceVersion: 'v1', sourceHash: `synthetic-source-${id}`,
    passages: [{ citationId: `synthetic-cite-${id}`, version: 'v1', text: `Synthetic evidence ${id}`, locator: 'Section 1' }], ...lifecycle }
}

// Minimal synthetic store for the operators the repository sends. Unknown rules fail the test.
function matches(doc: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([field, rules]) => {
    if (Array.isArray(rules)) {
      if (field === 'and') return rules.every(rule => matches(doc, rule))
      if (field === 'or') return rules.some(rule => matches(doc, rule))
      throw new Error(`Unsupported synthetic query group: ${field}`)
    }
    const value = doc[field]
    return Object.entries(rules).every(([operator, operand]) => {
      switch (operator) {
        case 'equals': return value === operand
        case 'in': return Array.isArray(operand) && (Array.isArray(value) ? value.some(v => operand.includes(v)) : operand.includes(value))
        case 'exists': return (value != null) === operand
        case 'contains': return typeof value === 'string' && typeof operand === 'string' && value.toLowerCase().includes(operand.toLowerCase())
        case 'less_than_equal': return typeof value === 'string' && typeof operand === 'string' && value <= operand
        case 'greater_than': return typeof value === 'string' && typeof operand === 'string' && value > operand
        default: throw new Error(`Unsupported synthetic query operator: ${operator}`)
      }
    })
  })
}

function fixture({ assetReads = false } = {}) {
  const users = new Map([annuity, wealth, inactive, administrator].map(({ collection, ...entry }) => [entry.id, entry]))
  const profiles = [
    profile(31, membership('firm:a', 'annuity'), ['view', 'retrieve']),
    profile(32, membership('firm:a', 'annuity'), ['view']),
    profile(33, membership('firm:b', 'wealth'), ['view', 'download']),
    profile(34, membership('firm:a', 'annuity', 'advisor'), ['view', 'retrieve', 'download']),
    profile(35, membership('firm:a', 'annuity'), ['view', 'retrieve'], false),
    profile(36, membership('firm:a', 'annuity'), ['retrieve', 'download']),
    profile(37, membership('firm:b', 'wealth'), ['view', 'retrieve']),
  ]
  const documents = [
    content(101, 'annuity retrieval', 31, { section: 'products', topics: ['products:commission-schedules'], pages: ['products:commission-schedules'], reviewDueAt: '2027-11-18T12:00:00.000Z' }),
    content(102, 'annuity view', 32, { section: 'operations', kind: 'howto' }),
    content(103, 'wealth download', 33), content(104, 'crossed membership', 34),
    content(105, 'inactive profile', 35), content(106, 'missing view', 36), content(107, 'wealth retrieval', 37),
    content(108, 'expired at current time', 31, { expiresAt: now }),
    content(109, 'archived', 31, { state: 'archived' }), content(110, 'intake', 31, { state: 'intake' }),
    content(111, 'future release', 31, { availableAt: '2026-11-19T12:00:00.000Z' }),
    content(112, 'expired PDF', 33, { expiresAt: now }), content(114, 'review lapsed', 31, { section: 'products', reviewDueAt: now }), content(113, 'archived PDF', 33, { state: 'archived' }),
    ...Array.from({ length: 21 }, (_, index) => content(200 + index, `denied pagination ${index}`, 34)),
  ]
  const assets = [101, 102, 103, 112, 113].map(id => ({
    id: id + 900, content: id, objectKey: `content/synthetic/${id}.pdf`, mimeType: 'application/pdf', version: `synthetic-source-${id}`,
  }))
  const payload = {
    auth: vi.fn(async ({ headers }: { headers: Headers }): Promise<AuthStrategyResult> =>
      authenticatePayload({ headers, payload: payload as unknown as Payload })),
    findByID: vi.fn(async ({ collection, id, overrideAccess }: { collection: string; id: number; overrideAccess: boolean }) => {
      expect(collection).toBe('content')
      expect(overrideAccess).toBe(true)
      return documents.find(doc => doc.id === id)
    }),
    find: vi.fn(async ({ collection, req, where, overrideAccess, limit = 20, page = 1 }: {
      collection: string; req: PayloadRequest; where: Where; overrideAccess: boolean; limit?: number; page?: number
    }) => {
      if (collection === 'users') {
        expect(overrideAccess).toBe(true)
        return { docs: [...users.values()].filter(entry => matches(entry, where)).slice(0, limit) }
      }
      if (collection === 'access-profiles') {
        expect(overrideAccess).toBe(true)
        return { docs: profiles.filter(doc => matches(doc, where)) }
      }
      if (collection === 'assets') {
        expect(overrideAccess).toBe(true)
        return { docs: assets.filter(asset => matches(asset, where)) }
      }
      expect(collection).toBe('content')
      if (!assetReads) expect(overrideAccess).toBe(false)
      const access = overrideAccess || await Content.access?.read?.({ req })
      const visible = documents.filter(doc => matches(doc, where) && (access === true || Boolean(access && matches(doc, access))))
      return { docs: visible.slice((page - 1) * limit, page * limit), hasNextPage: visible.length > page * limit }
    }),
  }
  payloadMock.getPayload.mockResolvedValue(payload)
  payloadMock.createLocalReq.mockImplementation(({ user }) => ({ user, payload }))
  return { users, profiles, documents, payload, request: (identity: ReturnType<typeof user> | null) => ({ user: identity, payload }) as unknown as PayloadRequest }
}

async function withMcp(repository: LibraryRepository, check: (client: Client) => Promise<void>) {
  const client = new Client({ name: 'synthetic-permission-client', version: '1' })
  const server = createContentMcp(repository, origin, scopes)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    await check(client)
  } finally {
    await Promise.all([client.close(), server.close()])
  }
}

async function mcpOutput(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args })
  expect(result.isError).toBeFalsy()
  expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }])
  const [message] = result.content as { text: string }[]
  return message.text
}

describe('synthetic two-firm, two-business-line permission acceptance', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URI', 'postgresql://synthetic.invalid/content')
    vi.stubEnv('PAYLOAD_SECRET', 'synthetic-permission-fixture-unused-secret')
    vi.stubEnv('PLATFORM_ORIGIN', origin)
    vi.stubEnv('AUTH0_ISSUER', issuer)
    vi.stubEnv('AUTH0_AUDIENCE', `${origin}/mcp`)
    vi.stubEnv('CONTENT_BUCKET', undefined)
    identityMock.verifyBearer.mockImplementation(async (authorization: string | null) => {
      const id = /^Bearer synthetic-token-for-(\d+)$/.exec(authorization ?? '')?.[1]
      return id ? { ...identityFor(id), scopes } : null
    })
    identityMock.readSession.mockImplementation(async (cookie: string | null) => {
      const id = /^__Host-library-session=synthetic-session-for-(\d+)$/.exec(cookie ?? '')?.[1]
      return id ? identityFor(id) : null
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  it.each([
    { reader: annuity, otherId: 107, view: [101, 102], retrieveId: 101, viewOnlyId: 102, downloadProfiles: [] },
    { reader: wealth, otherId: 101, view: [103, 107], retrieveId: 107, viewOnlyId: 103, downloadProfiles: [33] },
  ])('limits reader and MCP results to the assigned firm and line for user $reader.id', async ({ reader, otherId, view, retrieveId, viewOnlyId, downloadProfiles }) => {
    const f = fixture()
    const repository = (await authenticatedLibrary(session(reader.id)))!
    const result = await repository.search('acceptance', undefined, 1, 'view')
    expect(result.items.map(item => Number(item.id))).toEqual(view)
    expect(result.hasNextPage).toBe(false)
    expect(await repository.get(String(otherId), 'view')).toBeNull()
    expect(await profileIds(f.request(reader), 'download')).toEqual(downloadProfiles)

    const mcp = (await authenticatedLibrary(bearer(reader.id), 'mcp'))!
    await withMcp(mcp, async client => {
      const search = JSON.parse(await mcpOutput(client, 'search_content', { query: 'acceptance' }))
      expect(search.items.map((item: { id: string }) => Number(item.id))).toEqual([retrieveId])
      expect(search.hasNextPage).toBe(false)
      expect(await mcpOutput(client, 'get_content', { id: String(viewOnlyId) })).toBe('null')
      expect(await mcpOutput(client, 'resolve_citation', { id: String(otherId), citationId: `synthetic-cite-${otherId}` })).toBe('null')
      expect(await mcpOutput(client, 'resolve_citation', { id: String(retrieveId), citationId: `synthetic-cite-${retrieveId}` }))
        .toContain(`${origin}/resources/${retrieveId}?citation=synthetic-cite-${retrieveId}`)
    })
  })

  it('filters inactive policies and expired, archived, intake and future material from direct and paginated reads', async () => {
    fixture()
    const repository = (await authenticatedLibrary(session(annuity.id)))!
    const mcp = (await authenticatedLibrary(bearer(annuity.id), 'mcp'))!
    for (const id of [104, 105, 106, 108, 109, 110, 111, 114]) {
      expect(await repository.get(String(id), 'view')).toBeNull()
      expect(await mcp.get(String(id), 'retrieve')).toBeNull()
    }
    expect(await repository.search('', undefined, 2, 'view')).toEqual({ items: [], hasNextPage: false })
    expect(await authenticatedLibrary(session(inactive.id))).toBeNull()
    expect(await authenticatedLibrary(bearer(inactive.id), 'mcp')).toBeNull()
    expect(await authenticatedLibrary(bearer(99), 'mcp')).toBeNull()
    const adminRepository = (await authenticatedLibrary(bearer(administrator.id), 'mcp'))!
    expect(await adminRepository.get('101', 'retrieve')).toBeNull()
  })

  it('REQ-NAV-03: section, topic, page and how-to listings stay inside the reader\'s authorization', async () => {
    fixture()
    const repository = (await authenticatedLibrary(session(annuity.id)))!
    const ids = async (filters: Parameters<typeof repository.search>[4]) => (await repository.search('', undefined, 1, 'view', filters)).items.map(i => Number(i.id))
    expect(await ids({ section: 'products' })).toEqual([101])
    expect(await ids({ topic: 'products:commission-schedules' })).toEqual([101])
    expect(await ids({ page: 'products:commission-schedules' })).toEqual([101])
    expect(await ids({ kind: 'howto' })).toEqual([102])
    expect(await ids({ section: 'operations' })).toEqual([102])
    const other = (await authenticatedLibrary(session(wealth.id)))!
    expect((await other.search('', undefined, 1, 'view', { section: 'products' })).items).toEqual([])
  })

  it('rechecks current grants and memberships before returning previously issued citations', async () => {
    const f = fixture()
    const repository = (await authenticatedLibrary(session(annuity.id)))!
    const mcp = (await authenticatedLibrary(bearer(annuity.id), 'mcp'))!
    const citation = { id: '101', citationId: 'synthetic-cite-101' }
    const policy = f.profiles.find(policy => policy.id === 31)!
    const grants = policy.grants
    await withMcp(mcp, async client => {
      expect(await mcpOutput(client, 'resolve_citation', citation)).toContain('Synthetic evidence 101')
      policy.grants = grants.filter(grant => grant.action !== 'retrieve')
      expect(await repository.get('101', 'view')).toMatchObject({ id: '101' })
      expect(await mcpOutput(client, 'resolve_citation', citation)).toBe('null')
      expect(await mcpOutput(client, 'get_content', { id: '101' })).toBe('null')
      expect(JSON.parse(await mcpOutput(client, 'search_content', { query: 'acceptance' }))).toEqual({ items: [], hasNextPage: false })
    })
    policy.grants = grants
    f.users.set(annuity.id, { ...f.users.get(annuity.id)!, memberships: [] })
    const freshRepository = (await authenticatedLibrary(session(annuity.id)))!
    const freshMcp = (await authenticatedLibrary(bearer(annuity.id), 'mcp'))!
    expect(await freshRepository.get('101', 'view')).toBeNull()
    expect(await freshMcp.get('101', 'retrieve')).toBeNull()
  })

  it('restricts source collections to administrator reads and denies direct writes for every role', async () => {
    const f = fixture()
    for (const collection of [ImportArtifacts, SourceSnapshots, SourceRelations, ImportReviews, ImportRuns]) {
      for (const identity of [null, annuity, wealth, inactive, editor, administrator]) {
        const args = { req: f.request(identity) }
        expect(await collection.access?.read?.(args)).toBe(identity === administrator)
        for (const operation of ['create', 'update', 'delete'] as const) {
          expect(await collection.access?.[operation]?.(args)).toBe(false)
        }
      }
    }
    // Even the synthetic reader with a download grant cannot access raw storage metadata.
    expect(await Assets.access?.read?.({ req: f.request(wealth) })).toBe(false)
    expect(f.payload.find).not.toHaveBeenCalled()
  })

  it('accepts a verified bearer only through MCP, even when the subject is a Payload administrator', async () => {
    const f = fixture()
    const headers = bearer(administrator.id)
    expect(await identityMock.verifyBearer(headers.get('authorization'))).toEqual({ ...identityFor(administrator.id), scopes })
    identityMock.verifyBearer.mockClear()
    for (const cookie of [undefined, session(administrator.id).get('cookie')!]) {
      if (cookie) headers.set('cookie', cookie)
      const result = await authenticatePayload({ headers, payload: f.payload as unknown as Payload })
      expect(result.user).toBeNull()
      expect(await authenticatedLibrary(headers)).toBeNull()
    }
    expect(identityMock.verifyBearer).not.toHaveBeenCalled()
    expect(identityMock.readSession).not.toHaveBeenCalled()
    expect(f.payload.find).not.toHaveBeenCalled()

    const makeMcpRequest = (headers: Headers) => {
      headers.set('content-type', 'application/json')
      headers.set('accept', 'application/json, text/event-stream')
      return new Request(`${origin}/mcp`, {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
          protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-permission-client', version: '1' },
        } }),
      })
    }
    expect((await postMcp(makeMcpRequest(session(administrator.id)))).status).toBe(401)
    f.payload.auth.mockClear()
    const initialized = await postMcp(makeMcpRequest(bearer(administrator.id)))
    expect(initialized.status).toBe(200)
    expect((await initialized.json()).result.serverInfo.name).toBe('ae-content-platform')
    expect(f.payload.auth).not.toHaveBeenCalled()
  })

  it('requires browser authentication and download grants for both inline and attached original PDFs', async () => {
    const f = fixture({ assetReads: true })
    vi.stubEnv('CONTENT_BUCKET', 'synthetic-content-bucket')
    objectStore.send.mockImplementation(async () => ({
      Body: { transformToWebStream: () => new Response('synthetic file bytes').body },
    }))
    const request = (headers: Headers, id: number, download: boolean) => getFile(
      new Request(`${origin}/files/${id}${download ? '?download=1' : ''}`, { headers }),
      { params: Promise.resolve({ id: String(id) }) },
    )

    const annuityHeaders = session(annuity.id)
    const wealthHeaders = session(wealth.id)
    const annuityRepository = (await authenticatedLibrary(annuityHeaders))!
    const wealthRepository = (await authenticatedLibrary(wealthHeaders))!
    const viewOnly = await annuityRepository.get('102', 'view')
    expect(viewOnly?.id).toBe('102')
    expect(viewOnly?.previewAssetId).toBeUndefined()
    expect(viewOnly?.downloadAssetIds ?? []).toEqual([])
    expect(await wealthRepository.get('103', 'view')).toMatchObject({ previewAssetId: 1003, downloadAssetIds: [1003] })

    const preview = await request(wealthHeaders, 1003, false)
    expect(preview.status).toBe(200)
    expect(preview.headers.get('Content-Disposition')).toMatch(/^inline;/)
    expect(await preview.text()).toBe('synthetic file bytes')
    const download = await request(wealthHeaders, 1003, true)
    expect(download.status).toBe(200)
    expect(download.headers.get('Content-Disposition')).toMatch(/^attachment;/)
    expect(await download.text()).toBe('synthetic file bytes')
    expect(objectStore.send.mock.calls.map(([command]) => command.input)).toEqual([
      { Bucket: 'synthetic-content-bucket', Key: 'content/synthetic/103.pdf' },
      { Bucket: 'synthetic-content-bucket', Key: 'content/synthetic/103.pdf' },
    ])

    objectStore.send.mockClear()
    for (const denied of [
      await request(annuityHeaders, 1002, true), await request(annuityHeaders, 1002, false),
      await request(wealthHeaders, 1002, false), await request(annuityHeaders, 1003, true),
      await request(session(inactive.id), 1003, true), await request(bearer(wealth.id), 1003, true),
      await request(wealthHeaders, 1012, false), await request(wealthHeaders, 1013, false),
    ]) {
      expect(denied.status).toBe(404)
      expect(await denied.text()).toBe('Not found')
    }
    const document = f.documents.find(doc => doc.id === 103)!
    const sourceVersion = document.sourceHash
    document.sourceHash = 'synthetic-replacement-source'
    expect((await request(wealthHeaders, 1003, false)).status).toBe(404)
    expect((await request(wealthHeaders, 1003, true)).status).toBe(404)
    document.sourceHash = sourceVersion
    const policy = f.profiles.find(policy => policy.id === 33)!
    policy.active = false
    expect((await request(wealthHeaders, 1003, false)).status).toBe(404)
    expect((await request(wealthHeaders, 1003, true)).status).toBe(404)
    expect(objectStore.send).not.toHaveBeenCalled()
  })
})
