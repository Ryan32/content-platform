import { reviewStatus } from '../../domain/review'

export const day = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : '—'
export const shortDay = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }) : '—'

type Doc = { state?: string | null; reviewDueAt?: string | null; processing?: string }
/** One status pill per item, in the words the Manage mockups use. */
export function statusOf(doc: Doc, now = new Date()): [string, string] {
  if (doc.processing) return [doc.processing, 'ae-pill--info']
  if (doc.state === 'archived') return ['Archived', '']
  if (doc.state === 'intake') return ['New — not reviewed', '']
  if (doc.state === 'draft') return ['Needs approval', 'ae-pill--warn']
  const s = reviewStatus(doc.reviewDueAt, now)
  if (s === 'overdue') return ['Hidden — review due', 'ae-pill--fail']
  if (s === 'soon') return [`Due ${shortDay(doc.reviewDueAt)}`, 'ae-pill--warn']
  return ['Live', 'ae-pill--ok']
}
export function Pill({ doc }: { doc: Doc }) { const [label, tone] = statusOf(doc); return <span className={`ae-pill ${tone}`}>{label}</span> }
