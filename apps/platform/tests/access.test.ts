import { describe, expect, it } from 'vitest'
import { allowed, principalFromUser, type Principal, type Policy } from '../src/domain/access'

const user: Principal = { id: 'alice', active: true, roles: ['reader'], memberships: [
  { scope: 'firm:a', entitlements: ['annuity', 'active'] }, { scope: 'firm:b', entitlements: ['wealth'] },
] }
const policy: Policy = { id: 1, active: true, grants: [
  { action: 'view', scope: 'firm:a', entitlements: ['annuity', 'active'] },
  { action: 'retrieve', scope: 'firm:a', entitlements: ['annuity', 'active'] },
] }
describe('REQ-AUTH-01: scoped grants', () => {
  it('requires active identity and active approved policy', () => {
    expect(allowed(null, policy, 'view')).toBe(false)
    expect(allowed({ ...user, active: false }, policy, 'view')).toBe(false)
    expect(allowed(user, { ...policy, active: false }, 'view')).toBe(false)
    expect(allowed(user, { ...policy, grants: [] }, 'view')).toBe(false)
  })
  it('does not combine entitlements across firms', () => {
    expect(allowed(user, { ...policy, grants: [{ action: 'view', scope: 'firm:a', entitlements: ['annuity', 'wealth'] }] }, 'view')).toBe(false)
    expect(allowed({ ...user, memberships: [{ scope: 'firm:b', entitlements: ['annuity', 'active'] }] }, policy, 'view')).toBe(false)
  })
  it('keeps retrieval and download distinct and requires view for both', () => {
    expect(allowed(user, policy, 'view')).toBe(true)
    expect(allowed(user, policy, 'retrieve')).toBe(true)
    expect(allowed(user, policy, 'download')).toBe(false)
    expect(allowed(user, { ...policy, grants: policy.grants.filter(g => g.action === 'retrieve') }, 'retrieve')).toBe(false)
    expect(allowed(user, { ...policy, grants: policy.grants.filter(g => g.action === 'view') }, 'retrieve')).toBe(false)
  })
  it('does not grant reader access through an admin role alone', () => {
    expect(allowed({ ...user, roles: ['admin'], memberships: [] }, policy, 'retrieve')).toBe(false)
  })
  it('rejects unknown principal sources and inactive records', () => {
    expect(principalFromUser({ id: 'x', roles: ['admin'] })).toBeNull()
    expect(principalFromUser({ id: 'x', collection: 'users' })?.active).toBe(false)
  })
})
