/**
 * Review windows (design handoff, docs/design/ia-and-governance.json). Every item has a review schedule; when its
 * review date passes it is hidden from readers, search, MCP and AXL until a person renews it. Editors still see it.
 * Renewal is a human action (owner or administrator); AI never renews.
 */
export type ReviewWindowId = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'biennial' | 'fixedDate'
export const REVIEW_WINDOWS: { id: ReviewWindowId; label: string; months: number | null }[] = [
  { id: 'monthly', label: 'Monthly', months: 1 },
  { id: 'quarterly', label: 'Every 3 months', months: 3 },
  { id: 'semiannual', label: 'Every 6 months', months: 6 },
  { id: 'annual', label: 'Every 12 months', months: 12 },
  { id: 'biennial', label: 'Every 24 months', months: 24 },
  { id: 'fixedDate', label: 'On a set date', months: null },
]
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
export function applyReviewSchedule(data: Doc, originalDoc: Doc | undefined, { renewal, now = new Date() }: { renewal: boolean; now?: Date }) {
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
  data.reviewDueAt = dueDate(window, last, reviewOn)
  return data
}

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
