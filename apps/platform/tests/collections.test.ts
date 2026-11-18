import { describe, it, expect } from 'vitest'
import { Content, Users } from '../src/collections'
import { admin, editor, publishedWhere } from '../src/collections/access'
import type { PayloadRequest } from 'payload'
const req = (roles: string[]) => ({ user: { collection: 'users', id: 1, active: true, roles } }) as unknown as PayloadRequest
describe('REQ-CMS-01: editorial and publication separation', () => {
  it('lets editors edit but reserves policy and publication changes for administrators', () => {
    expect(editor({ req: req(['editor']) })).toBe(true)
    expect(admin({ req: req(['editor']) })).toBe(false)
    for (const name of ['state', 'accessProfile', 'availableAt', 'expiresAt', 'evidenceVersion', 'passages']) {
      const field = Content.fields.find(f => 'name' in f && f.name === name)
      expect(field && 'access' in field && field.access?.update).toBe(admin)
    }
    expect(Content.access?.readVersions).toBe(editor)
    expect(typeof Users.auth === 'object' && Users.auth.disableLocalStrategy).toBe(true)
  })
  it('withdraws edited published evidence for reapproval', async () => {
    const hook = Content.hooks!.beforeChange![0]
    const result = await hook({ data: { body: 'Changed claim' }, originalDoc: { state: 'published', body: 'Old claim', evidenceVersion: 'v1' } } as any)
    expect(result.state).toBe('draft')
    expect(result.evidenceVersion).toBe('unprocessed')
  })
  it('refuses publication without a policy', async () => {
    await expect(async () => Content.hooks!.beforeChange![0]({ data: { state: 'published' } } as any)).rejects.toThrow('access profile')
  })
  it('includes publication, policy, start and expiry constraints in database queries', () => {
    const where = JSON.stringify(publishedWhere([7], new Date('2026-11-17T00:00:00Z')))
    expect(where).toContain('"in":[7]')
    for (const key of ['published', 'availableAt', 'expiresAt', '2026-11-17T00:00:00.000Z']) expect(where).toContain(key)
  })
})
