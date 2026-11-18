export type Action = 'view' | 'retrieve' | 'download'
export interface Membership { scope: string; entitlements: string[] }
export interface Principal {
  id: string; active: boolean; roles: string[]; memberships: Membership[]
}
export interface Grant { action: Action; scope: string; entitlements: string[] }
export interface Policy { id: string | number; active: boolean; grants: Grant[] }

/** AND within a membership/clause; OR across whole clauses. Never flatten firms. */
export function allowed(principal: Principal | null, policy: Policy, action: Action): boolean {
  if (!principal?.active || !policy.active) return false
  const grants = (requested: Action) => policy.grants.some(clause =>
    clause.action === requested && clause.scope.length > 0 &&
    principal.memberships.some(member => member.scope === clause.scope &&
      clause.entitlements.every(value => member.entitlements.includes(value))))
  return grants('view') && (action === 'view' || grants(action))
}

export function staff(principal: Principal | null, role: 'admin' | 'editor'): boolean {
  return Boolean(principal?.active && (principal.roles.includes('admin') || principal.roles.includes(role)))
}

/** Only call with a server-loaded identity record, never request JSON/decoded JWT claims. */
export function principalFromUser(user: unknown): Principal | null {
  if (!user || typeof user !== 'object') return null
  const value = user as Record<string, unknown>
  if (!value.id || value.collection !== 'users') return null
  return {
    id: String(value.id), active: value.active === true,
    roles: Array.isArray(value.roles) ? value.roles.filter((r): r is string => typeof r === 'string') : [],
    memberships: Array.isArray(value.memberships) ? value.memberships.flatMap(item => {
      if (!item || typeof item.scope !== 'string') return []
      return [{ scope: item.scope, entitlements: Array.isArray(item.entitlements)
        ? item.entitlements.flatMap((e: { value?: unknown }) => typeof e.value === 'string' ? [e.value] : []) : [] }]
    }) : [],
  }
}
