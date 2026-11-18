import type { AdminViewServerProps } from 'payload'
import { AdminPage } from './AdminPage'
import { DUE_SOON_DAYS, REVIEW_WINDOWS, canRenew, reviewStatus } from '../domain/review'
import { sectionById } from '../domain/navigation'
import { principalFromUser } from '../domain/access'

const OUTCOMES: Record<string, [string, string]> = {
  renewed: ['ok', 'Renewed. The item is visible again and its next review date is set.'],
  not_owner: ['warn', 'Only the item\'s owner or an administrator can renew it.'],
  date_required: ['warn', 'This item is reviewed on a set date. Choose a new date in the future, then renew.'],
  renew_failed: ['fail', 'Renewal failed. Try again.'], not_found: ['fail', 'Library item not found.'], invalid: ['fail', 'Renewal failed. Try again.'],
}
const day = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : '—'
const windowLabel = (id?: string | null) => REVIEW_WINDOWS.find(w => w.id === id)?.label ?? 'Every 12 months'

/** Admin view at /admin/due-for-review: what's hidden because its review lapsed, and what's coming due, with Renew. */
export default async function DueForReview(props: AdminViewServerProps) {
  return AdminPage({ props, title: 'Due for review', children: async ({ isAdmin }) => {
    const { payload, user } = props.initPageResult.req
    const now = new Date()
    const soon = new Date(now.getTime() + DUE_SOON_DAYS * 86_400_000).toISOString()
    const find = (where: object) => payload.find({ collection: 'content', overrideAccess: true, depth: 1, limit: 200, sort: 'reviewDueAt', where: where as never })
    const [overdue, upcoming] = await Promise.all([
      find({ and: [{ state: { equals: 'published' } }, { reviewDueAt: { less_than_equal: now.toISOString() } }] }),
      find({ and: [{ state: { equals: 'published' } }, { reviewDueAt: { greater_than: now.toISOString() } }, { reviewDueAt: { less_than_equal: soon } }] }),
    ])
    const params = await props.searchParams
    const outcome = typeof params?.outcome === 'string' ? OUTCOMES[params.outcome] : undefined
    const mine = (owner: unknown) => canRenew({ isAdmin: false, userId: user!.id, owner: owner as never })

    const table = (docs: typeof overdue.docs, empty: string) => docs.length === 0 ? <p className="ae-muted">{empty}</p> : <table className="ae-table">
      <thead><tr><th>Item</th><th>Section</th><th>Review every</th><th>Owner</th><th>Due</th><th /></tr></thead>
      <tbody>{docs.map(doc => {
        const owner = typeof doc.owner === 'object' && doc.owner ? doc.owner : null
        const status = reviewStatus(doc.reviewDueAt, now)
        const allowed = canRenew({ isAdmin, userId: user!.id, owner: doc.owner as never })
        return <tr key={doc.id} id={`item-${doc.id}`}>
          <td><a href={`/admin/collections/content/${doc.id}`}><strong>{doc.title}</strong></a>{mine(doc.owner) && <> <span className="ae-pill ae-pill--info">Yours</span></>}</td>
          <td>{doc.section ? sectionById(doc.section)?.label : <span className="ae-muted">Not filed</span>}</td>
          <td>{windowLabel(doc.reviewWindow)}</td>
          <td>{owner ? owner.name || owner.email : <span className="ae-muted">No owner</span>}</td>
          <td><span className={`ae-pill ${status === 'overdue' ? 'ae-pill--fail' : 'ae-pill--warn'}`}>{status === 'overdue' ? `Hidden since ${day(doc.reviewDueAt)}` : day(doc.reviewDueAt)}</span></td>
          <td style={{ textAlign: 'right' }}>{allowed ? <form method="post" action={`/library-api/content/${doc.id}/review`} style={{ display: 'inline-flex', gap: 6 }}>
            {doc.reviewWindow === 'fixedDate' && <input type="date" name="reviewOn" required aria-label="New review date" min={new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10)} />}
            <button type="submit" className="ae-btn ae-btn--primary ae-btn--small">Renew</button></form>
            : <span className="ae-muted">Owner renews</span>}</td>
        </tr>
      })}</tbody></table>

    return <>
      <h1>Due for review</h1>
      <p style={{ maxWidth: 820 }}>Every published item has a review window. When the review date passes, the item is hidden from readers, search and AI assistants until its owner or an administrator renews it. Renewing confirms the item is still accurate; edit or replace it first if it isn&apos;t. Set the window and owner in each item&apos;s <em>Review schedule</em>.</p>
      {outcome && <p role="status" className={`ae-notice ae-notice--${outcome[0]}`}>{outcome[1]}</p>}
      <div className="ae-stats">
        <div className="ae-stat"><strong style={overdue.totalDocs ? { color: '#c2414b' } : undefined}>{overdue.totalDocs}</strong><span className="ae-muted">Hidden — review lapsed</span></div>
        <div className="ae-stat"><strong>{upcoming.totalDocs}</strong><span className="ae-muted">Due in the next {DUE_SOON_DAYS} days</span></div>
      </div>
      <section className="ae-card"><h2>Hidden — review lapsed</h2>{table(overdue.docs, 'Nothing is hidden. Every published item is within its review window.')}</section>
      <section className="ae-card"><h2>Due in the next {DUE_SOON_DAYS} days</h2>{table(upcoming.docs, 'Nothing is due soon.')}</section>
      {!principalFromUser(user)?.roles.includes('admin') && <p className="ae-muted">You can renew items you own. Ask an administrator to change an item&apos;s owner.</p>}
    </>
  } })
}
