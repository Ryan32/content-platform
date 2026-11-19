import type { AdminViewServerProps, Where } from 'payload'
import { AdminPage } from './AdminPage'
import { Thumbnail } from './Thumbnail'
import { DUE_SOON_DAYS, REVIEW_WINDOWS, SNOOZE_DAYS, canRenew } from '../domain/review'
import { Pill, day } from './manage/shared'

const OUTCOMES: Record<string, [string, string]> = {
  renewed: ['ok', 'Renewed. The item is visible again and its next review date is set.'],
  not_owner: ['warn', 'Only the item\'s owner or an administrator can renew it.'],
  date_required: ['warn', 'This item is reviewed on a set date. Choose a new date in the future, then renew.'],
  renew_failed: ['fail', 'Renewal failed. Try again.'], not_found: ['fail', 'Library item not found.'], invalid: ['fail', 'Renewal failed. Try again.'],
  nothing_selected: ['warn', 'Select at least one item first.'], admin_only: ['warn', 'Only administrators can archive.'],
}
const windowLabel = (id?: string | null) => REVIEW_WINDOWS.find(w => w.id === id)?.label ?? 'Every 12 months'
const CHIPS = [['all', 'All due'], ['hidden', 'Hidden now'], ['7', 'Next 7 days'], ['30', `Next ${DUE_SOON_DAYS} days`], ['snoozed', 'Snoozed']] as const

/** Due for review (design: AdminDue): hidden and soon-due items, renew/snooze/archive one at a time or in bulk. */
export default async function DueForReview(props: AdminViewServerProps) {
  return AdminPage({ props, title: 'Due for review', children: async ({ isAdmin }) => {
    const { payload, user } = props.initPageResult.req
    const now = new Date(); const iso = now.toISOString()
    const ahead = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString()
    const params = await props.searchParams
    const chip = CHIPS.find(c => c[0] === params?.view)?.[0] ?? 'all'
    const base: Where = { state: { equals: 'published' } }
    const filters: Record<string, Where> = {
      all: { reviewDueAt: { less_than_equal: ahead(DUE_SOON_DAYS) } }, hidden: { reviewDueAt: { less_than_equal: iso } },
      '7': { and: [{ reviewDueAt: { greater_than: iso } }, { reviewDueAt: { less_than_equal: ahead(7) } }] },
      '30': { and: [{ reviewDueAt: { greater_than: iso } }, { reviewDueAt: { less_than_equal: ahead(DUE_SOON_DAYS) } }] },
      snoozed: { snoozedAt: { exists: true } },
    }
    const count = (w: Where) => payload.count({ collection: 'content', overrideAccess: true, where: { and: [base, w] } }).then(r => r.totalDocs)
    const [docs, counts] = await Promise.all([
      payload.find({ collection: 'content', overrideAccess: true, depth: 1, limit: 200, sort: 'reviewDueAt', where: { and: [base, filters[chip]] } }),
      Promise.all(CHIPS.map(c => count(filters[c[0]]))),
    ])
    const outcomeKey = typeof params?.outcome === 'string' ? params.outcome : ''
    const bulk = /^bulk_(renew|snooze|archive)$/.exec(outcomeKey)
    const outcome = bulk ? ['ok', `${params?.done ?? 0} ${bulk[1] === 'renew' ? 'renewed' : bulk[1] === 'snooze' ? `snoozed ${SNOOZE_DAYS} days` : 'archived'}${Number(params?.skipped) ? `; ${params?.skipped} skipped (not yours, set-date, or already snoozed)` : ''}.`] : OUTCOMES[outcomeKey]
    const hint = (d: { updatedAt: string; lastReviewedAt?: string | null; snoozedAt?: string | null }) => d.snoozedAt ? `Snoozed ${day(d.snoozedAt)}` : `Not changed since ${day(d.updatedAt)}`

    return <div className="ae-manage">
      <div className="ae-head"><div><h1>Due for review</h1><p className="ae-muted">Confirm content is still accurate before its window ends.</p></div><a className="ae-btn ae-btn--secondary" href="/admin/review-policies">Review policies</a></div>
      <p className="ae-notice"><strong>How this works:</strong> every item has a review window. If nobody confirms it by the due date, it&apos;s hidden from advisors, search and AI assistants. Editors can still see it, and one click brings it back.</p>
      {outcome && <p role="status" className={`ae-notice ae-notice--${outcome[0]}`}>{outcome[1]}</p>}
      <nav className="ae-chips" aria-label="Show">{CHIPS.map(([id, label], i) => <a key={id} href={`/admin/due-for-review${id === 'all' ? '' : `?view=${id}`}`} aria-current={chip === id ? 'page' : undefined}>{label} · {counts[i]}</a>)}</nav>
      <form method="post" action="/library-api/review-bulk" className="ae-card" style={{ padding: 0 }}>
        <div className="ae-bulkbar"><span className="ae-muted">Select items, then</span>
          <button className="ae-btn ae-btn--primary ae-btn--small" name="action" value="renew">Still accurate — renew</button>
          <button className="ae-btn ae-btn--secondary ae-btn--small" name="action" value="snooze">Snooze {SNOOZE_DAYS} days</button>
          {isAdmin && <button className="ae-btn ae-btn--secondary ae-btn--small" name="action" value="archive">Archive</button>}</div>
        {docs.docs.length === 0 ? <p className="ae-muted" style={{ padding: 20 }}>Nothing here. Every published item is within its review window.</p>
          : <ul className="ae-due">{docs.docs.map(d => {
            const owner = typeof d.owner === 'object' && d.owner ? d.owner : null
            const allowed = canRenew({ isAdmin, userId: user!.id, owner: d.owner as never })
            return <li key={d.id} id={`item-${d.id}`}>
              <input type="checkbox" name="ids" value={d.id} disabled={!allowed} aria-label={`Select ${d.title}`} />
              <span className="ae-thumb"><Thumbnail id={d.id} version={d.thumbnailVersion} format={d.format} title={d.title} rounded={6} compact /></span>
              <span className="ae-list-main"><a href={`/admin/collections/content/${d.id}`}><strong>{d.title}</strong></a>
                <span className="ae-muted">{windowLabel(d.reviewWindow)} · Owner: {owner ? owner.name || owner.email : 'none'}</span>
                <span className="ae-muted small">{hint(d)}</span></span>
              <Pill doc={d} />
              <span className="ae-row-actions">{allowed && d.reviewWindow !== 'fixedDate' && <button className="ae-btn ae-btn--primary ae-btn--small" formAction={`/library-api/content/${d.id}/review`} formMethod="post">Still accurate</button>}
                {allowed && d.reviewWindow === 'fixedDate' && <a className="ae-btn ae-btn--primary ae-btn--small" href={`/admin/collections/content/${d.id}`}>Set new date</a>}
                <a className="ae-btn ae-btn--secondary ae-btn--small" href={`/admin/collections/content/${d.id}`}>Upload new version</a>
                {!allowed && <span className="ae-muted">Owner renews</span>}</span>
            </li> })}</ul>}
      </form>
      {!isAdmin && <p className="ae-muted">You can renew and snooze items you own. Ask an administrator to change an item&apos;s owner.</p>}
    </div>
  } })
}
