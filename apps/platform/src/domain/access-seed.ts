/**
 * The decided AE Library access model (docs/ACCESS-MODEL.md, 2026-11-18) as seed data, and the fixed WordPress
 * mapping (section 6). Membership keys are what the Access Management payload will place on people; until that is wired
 * (section 8), memberships are set by hand. Tiers inherit upward by membership: a Legends person holds tier:premier,
 * tier:elite and tier:legends.
 */
export type AudienceSeed = { key: string; label: string; kind: 'business-line' | 'firm' | 'internal' | 'program' | 'plan' | 'other'; description: string }
export type ProfileSeed = { name: string; scopes: string[] }

export const AUDIENCE_SEED: AudienceSeed[] = [
  { key: 'internal:employees', label: 'AE and AEWM employees', kind: 'internal', description: 'Staff signing in through Azure AD. They see member content and AEWM-restricted content.' },
  { key: 'plan:basic', label: 'Basic members', kind: 'plan', description: 'Members on the Basic plan (WordPress "subscriber").' },
  { key: 'plan:full-active', label: 'Full-Active members', kind: 'plan', description: 'Members on the Full-Active plan (WordPress "full-only").' },
  { key: 'affiliation:aewm', label: 'AEWM firms', kind: 'business-line', description: 'Advisors and staff of AE Wealth Management firms.' },
  { key: 'affiliation:agency', label: 'Agency offices (Sub-Advisor)', kind: 'business-line', description: 'Agency model offices (WordPress "Sub-Advisor"). Open item: keep or retire.' },
  { key: 'tier:premier', label: 'Premier and above', kind: 'plan', description: 'Signature tier Premier, Elite or Legends.' },
  { key: 'tier:elite', label: 'Elite and above', kind: 'plan', description: 'Signature tier Elite or Legends.' },
  { key: 'tier:legends', label: 'Legends', kind: 'plan', description: 'Signature tier Legends.' },
  { key: 'program:rob-russell-coaching', label: 'Rob Russell Coaching', kind: 'program', description: 'Enrolled in Rob Russell Next Generation Coaching.' },
  { key: 'program:rob-russell-bootcamp', label: 'Rob Russell Bootcamp', kind: 'program', description: 'Enrolled in the Rob Russell Bootcamp.' },
  { key: 'program:transformation-taxes', label: 'Transformation: Taxes', kind: 'program', description: 'Enrolled in Transformation: Taxes.' },
  { key: 'program:transformation-marketing', label: 'Transformation: Marketing', kind: 'program', description: 'Enrolled in Transformation: Marketing.' },
  { key: 'program:iul-masters', label: 'IUL Masters Academy', kind: 'program', description: 'Enrolled in IUL Masters Academy.' },
  { key: 'program:aewm-mastermind', label: 'AE Wealth Mastermind', kind: 'program', description: 'Enrolled in the AE Wealth Mastermind.' },
  { key: 'program:ridgeback', label: 'Ridgeback: Climbing Together', kind: 'program', description: 'Enrolled in Ridgeback: Climbing Together.' },
  { key: 'program:g2', label: 'G2', kind: 'program', description: 'Enrolled in G2.' },
  { key: 'program:aei', label: 'AEI', kind: 'program', description: 'AEI participants.' },
]

const staff = 'internal:employees'
/** WordPress packages that had no gating roles. */
export const NO_ROLES_PROFILE = 'No WordPress roles (hidden)'
export const PROFILE_SEED: ProfileSeed[] = [
  { name: 'Employees only', scopes: [staff] },
  { name: 'All members', scopes: ['plan:basic', 'plan:full-active', staff] },
  { name: 'Full-Active members', scopes: ['plan:full-active', staff] },
  { name: 'AEWM-restricted', scopes: ['affiliation:aewm', staff] },
  { name: 'Premier and above', scopes: ['tier:premier', staff] },
  { name: 'Elite and above', scopes: ['tier:elite', staff] },
  { name: 'Legends', scopes: ['tier:legends', staff] },
  { name: 'Program: Rob Russell (Coaching or Bootcamp)', scopes: ['program:rob-russell-coaching', 'program:rob-russell-bootcamp', staff] },
  { name: 'Program: Rob Russell Coaching', scopes: ['program:rob-russell-coaching', staff] },
  { name: 'Program: Transformation', scopes: ['program:transformation-taxes', 'program:transformation-marketing', staff] },
  { name: 'Program: IUL Masters Academy', scopes: ['program:iul-masters', staff] },
  { name: 'Program: AE Wealth Mastermind', scopes: ['program:aewm-mastermind', staff] },
  { name: 'Program: Ridgeback', scopes: ['program:ridgeback', staff] },
  { name: 'Program: G2', scopes: ['program:g2', staff] },
  { name: 'Program: AEI', scopes: ['program:aei', staff] },
  // Owner decision 2026-11-19: label, don't open. No rules, so its items are visible to no reader even when published;
  // adding rules to this one profile later opens all of them at once.
  { name: NO_ROLES_PROFILE, scopes: [] },
]
/** Decided default: view, AI retrieval and download all on (ACCESS-MODEL 4.2). */
export const PROFILE_ACTIONS = ['view', 'retrieve', 'download'] as const

/** WordPress roles that granted nothing (phantom or internal markers) or are retired (ACCESS-MODEL section 6). */
const IGNORED = new Set(['__wpdm__', 'io', 'life', 'medicare', 'aefs', 'guest'])
const TIERS = ['premier-signature-status', 'elite-signature-status', 'legends-signature-status']
const PROGRAM_PROFILES: [string[], string][] = [
  [['rob-russell-coaching', 'rob-russell-bootcamp'], 'Program: Rob Russell (Coaching or Bootcamp)'],
  [['rob-russell-coaching'], 'Program: Rob Russell Coaching'],
]

/**
 * The access profile a migrated item gets from its WordPress package roles ("any of" semantics), or null to hold it
 * for a person: unknown roles, the open "AEWM or Full-Active" case, and mixes of different kinds. Packages with no
 * gating roles get the closed NO_ROLES_PROFILE. Never decided by AI.
 */
export function profileForWordPressRoles(raw: readonly string[]): string | null {
  const roles = [...new Set(raw.map(r => r.trim().toLowerCase()))].filter(r => r && !IGNORED.has(r))
  if (!roles.length) return NO_ROLES_PROFILE
  const has = (r: string) => roles.includes(r)
  // Commission schedules are baseline material for all members (decision 7).
  if (has('commission-schedules') && roles.every(r => r === 'commission-schedules' || r === 'subscriber' || r === 'full-only')) return 'All members'
  if (roles.every(r => r === 'subscriber' || r === 'full-only')) return has('subscriber') ? 'All members' : 'Full-Active members'
  if (roles.length === 1 && has('aewm')) return 'AEWM-restricted'
  if (roles.every(r => TIERS.includes(r))) return ['Premier and above', 'Elite and above', 'Legends'][Math.min(...roles.map(r => TIERS.indexOf(r)))]
  for (const [set, profile] of PROGRAM_PROFILES) if (roles.length === set.length && set.every(has)) return profile
  return null
}
