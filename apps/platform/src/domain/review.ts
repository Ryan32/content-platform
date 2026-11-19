/**
 * Review windows (design handoff, docs/design/ia-and-governance.json). Every item has a review schedule; when its
 * review date passes it is hidden from readers, search, MCP and AXL until a person renews it. Editors still see it.
 * Renewal is a human action (owner or administrator); AI never renews.
 */
export type ReviewWindowId = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'biennial' | 'fixedDate'
export const REVIEW_WINDOWS: { id: ReviewWindowId; label: string; months: number | null; hint: string; defaultFor: string[] }[] = [
  { id: 'monthly', label: 'Monthly', months: 1, hint: 'Rates and pay', defaultFor: ['Commission Schedules', 'Annuity Rate Watch', 'Rate Shift Report', 'AE Indexed Performance Report'] },
  { id: 'quarterly', label: 'Every 3 months', months: 3, hint: 'Fast-moving product info', defaultFor: ['Fact Sheets', 'Holdings Summaries', 'Performance', 'Carrier & Product Changes'] },
  { id: 'semiannual', label: 'Every 6 months', months: 6, hint: 'Carrier rules and forms', defaultFor: ['Carrier Guidelines', 'Forms', 'Acceptable Forms of Payment', 'Certifications'] },
  { id: 'annual', label: 'Every 12 months', months: 12, hint: 'Most content', defaultFor: ['Compliance', 'Operations how-tos', 'Client-ready materials', 'Scripts & templates'] },
  { id: 'biennial', label: 'Every 24 months', months: 24, hint: 'Long-lasting learning', defaultFor: ['Training & coaching', 'Seminar recordings', 'Articles', 'Event replays'] },
  { id: 'fixedDate', label: 'On a set date', months: null, hint: 'Time-limited', defaultFor: ['Event registrations', 'Promotions', 'Enrollment periods'] },
]

/** Default window for a new item, from where it's filed (design: Review policies). Owners can change it. */
export function suggestedWindow(item: { topics?: string[] | null; kind?: string | null; section?: string | null; audience?: string | null; format?: string | null }): ReviewWindowId {
  const topics = item.topics ?? []
  if (topics.some(t => ['products:commission-schedules', 'products:rates-performance'].includes(t))) return 'monthly'
  if (topics.some(t => ['products:product-changes', 'products:carrier-snapshots'].includes(t))) return 'quarterly'
  if (topics.some(t => ['operations:forms', 'operations:sample-applications'].includes(t))) return 'semiannual'
  if (item.section === 'events') return 'fixedDate'
  if (item.section === 'coaching' || item.format === 'video' || topics.includes('marketing:recorded-seminars')) return 'biennial'
  return 'annual'
}

/** Who approves before publishing (design: Review policies). Display only: publishing stays an administrator action. */
export function approvalRoute(item: { audience?: string | null; lines?: string[] | null; carriers?: unknown[] | null; section?: string | null }): { when: string; approvers: string } {
  if (item.audience === 'client') return { when: 'Client-ready material', approvers: 'Compliance, then Creative Services' }
  if (item.lines?.includes('wealth')) return { when: 'AEWM material', approvers: 'AEWM Compliance' }
  if (item.carriers?.length || item.section === 'operations') return { when: 'Carrier documents and forms', approvers: 'Annuity, Life or Medicare Operations by line of business' }
  return { when: 'Everything else', approvers: 'Section owner' }
}
/** Days before the due date when an item shows as "due soon" in Manage. */
export const DUE_SOON_DAYS = 30

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

/** Next due date from the window and the last review. Null when there is nothing to anchor it to yet. */
export function dueDate(window: string | null | undefined, lastReviewedAt: string | null | undefined, reviewOn?: string | null): string | null {
  const spec = REVIEW_WINDOWS.find(w => w.id === window) ?? REVIEW_WINDOWS.find(w => w.id === 'annual')!
  if (spec.months === null) return reviewOn ? new Date(reviewOn).toISOString() : null
  if (!lastReviewedAt) return null
  return addMonths(new Date(lastReviewedAt), spec.months).toISOString()
}

type Doc = Record<string, any>
/**
 * Keeps the review fields consistent on every save. Publishing counts as a review; a renewal (context flag set only by
 * the renew route) records a new review. Ordinary edits can change the window but cannot set the review dates.
 */
export function applyReviewSchedule(data: Doc, originalDoc: Doc | undefined, { renewal, snooze = false, now = new Date() }: { renewal: boolean; snooze?: boolean; now?: Date }) {
  const before = originalDoc ?? {}
  let last: string | null = before.lastReviewedAt ?? null
  if (renewal) last = now.toISOString()
  else delete data.lastReviewedAt
  const publishing = data.state === 'published' && before.state !== 'published'
  if (publishing && !last) last = now.toISOString()
  if (last !== (before.lastReviewedAt ?? null)) data.lastReviewedAt = last
  const window = data.reviewWindow ?? before.reviewWindow ?? 'annual'
  const reviewOn = 'reviewOn' in data ? data.reviewOn : before.reviewOn
  if (window === 'fixedDate' && data.state === 'published' && !reviewOn) throw new Error('Choose a review date before publishing.')
  // A fixed date that already passed is a renewal of nothing; require a future date when setting it.
  if (window === 'fixedDate' && 'reviewOn' in data && reviewOn && new Date(reviewOn) <= now && !renewal) throw new Error('Choose a review date in the future.')
  let due = dueDate(window, last, reviewOn)
  // One 7-day snooze per review cycle. Renewing clears it; ordinary edits keep it.
  let snoozedAt: string | null = renewal ? null : before.snoozedAt ?? null
  if (snoozedAt && last && new Date(snoozedAt) <= new Date(last)) snoozedAt = null
  if (snooze) {
    if (snoozedAt) throw new Error('This item was already snoozed. Renew it or upload a new version.')
    snoozedAt = now.toISOString()
  }
  if (snoozedAt && due) due = new Date(Math.max(new Date(due).getTime(), new Date(snoozedAt).getTime() + SNOOZE_DAYS * 86_400_000)).toISOString()
  if (snooze || renewal) data.snoozedAt = snoozedAt
  else delete data.snoozedAt
  data.reviewDueAt = due
  return data
}
export const SNOOZE_DAYS = 7

export type ReviewStatus = 'ok' | 'soon' | 'overdue' | 'unscheduled'
export function reviewStatus(reviewDueAt: string | null | undefined, now = new Date()): ReviewStatus {
  if (!reviewDueAt) return 'unscheduled'
  const due = new Date(reviewDueAt).getTime()
  if (due <= now.getTime()) return 'overdue'
  return due - now.getTime() <= DUE_SOON_DAYS * 86_400_000 ? 'soon' : 'ok'
}

/** Owners and administrators renew. Editors who don't own the item can see it in Manage but not renew it. */
export function canRenew({ isAdmin, userId, owner }: { isAdmin: boolean; userId: number | string; owner: number | { id: number } | null | undefined }) {
  if (isAdmin) return true
  const ownerId = typeof owner === 'object' && owner ? owner.id : owner
  return ownerId !== undefined && ownerId !== null && String(ownerId) === String(userId)
}
