import { describe, it, expect } from 'vitest'
import { Content, Users } from '../src/collections'
import { admin, editor, publishedWhere } from '../src/collections/access'
import type { PayloadRequest } from 'payload'
const req = (roles: string[]) => ({ user: { collection: 'users', id: 1, active: true, roles } }) as unknown as PayloadRequest
describe('REQ-CMS-01: editorial and publication separation', () => {
  it('lets editors edit but reserves policy and publication changes for administrators', () => {
    expect(editor({ req: req(['editor']) })).toBe(true)
    expect(admin({ req: req(['editor']) })).toBe(false)
    for (const name of ['state', 'accessProfile', 'availableAt', 'expiresAt']) {
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
  it('cannot rewrite existing citation evidence through ordinary admin edits', async () => {
    const hook = Content.hooks!.beforeChange![0]
    await expect(async () => hook({ data: { passages: [{ text: 'Changed evidence' }] }, originalDoc: { state: 'draft', passages: [] } } as any)).rejects.toThrow('reviewed extraction')
    const data = await hook({ data: { body: 'Manual revision' }, originalDoc: { state: 'draft', body: 'Old', passages: [{ citationId: 'old' }], evidenceVersion: 'v1' } } as any)
    expect(data.passages).toEqual([]); expect(data.evidenceVersion).toBe('unprocessed')
    const reviewed = await hook({ data: { passages: [], evidenceVersion: 'v2' }, originalDoc: { state: 'published', passages: [{ citationId: 'old' }], evidenceVersion: 'v1' }, context: { reviewedEvidence: true } } as any)
    expect(reviewed.state).toBe('draft')
  })
  it('includes publication, policy, start and expiry constraints in database queries', () => {
    const where = JSON.stringify(publishedWhere([7], new Date('2026-11-17T00:00:00Z')))
    expect(where).toContain('"in":[7]')
    for (const key of ['published', 'availableAt', 'expiresAt', '2026-11-17T00:00:00.000Z']) expect(where).toContain(key)
  })
  it('accepts defaulted normal and import creates with Payload\'s empty original document', async () => {
    const hook = Content.hooks!.beforeChange![0]
    for (const seed of [{ title: 'New article', evidenceVersion: 'unprocessed' },
      { title: 'Imported', state: 'intake', sourceKey: 'wordpress:dbr:post:1', sourceHash: 'hash', evidenceVersion: 'unprocessed', passages: [] }]) {
      const created = await hook({ operation: 'create', originalDoc: {}, data: seed } as any)
      expect(created.evidenceVersion).toBe('unprocessed'); expect(created.passages).toEqual([])
      if ('sourceHash' in seed) expect(created.sourceHash).toBe('hash')
    }
    const created = await hook({ operation: 'create', originalDoc: {}, data: { state: 'published', evidenceVersion: 'copied', passages: [{ citationId: 'old' }] } } as any)
    expect(created.state).toBe('draft'); expect(created.passages).toEqual([])
  })
  it('disables duplication server-side and rejects a populated duplicate source in the hook', async () => {
    expect(Content.disableDuplicate).toBe(true)
    await expect(async () => Content.hooks!.beforeChange![0]({ operation: 'create', originalDoc: { id: 1, state: 'published' }, data: { state: 'published' } } as any)).rejects.toThrow('duplication')
  })
  it('withdraws published citations when source identity changes', async () => {
    for (const key of ['sourceKey', 'sourceHash']) {
      const updated = await Content.hooks!.beforeChange![0]({ operation: 'update', originalDoc: { state: 'published', [key]: 'old', evidenceVersion: 'v1' }, data: { [key]: 'new' } } as any)
      expect(updated.state).toBe('draft'); expect(updated.evidenceVersion).toBe('unprocessed'); expect(updated.passages).toEqual([])
    }
  })
})
