import type { AdminViewServerProps } from 'payload'
import { AdminPage } from '../AdminPage'
import { Thumbnail } from '../Thumbnail'
import { DUE_SOON_DAYS, REVIEW_WINDOWS } from '../../domain/review'
import { Pill, day } from './shared'
import { openFailures, supersededFailures } from '../../processing/jobs'
import { queuePool } from '../../server/db'

/** Manage home (design: AdminDashboard): what needs you today. Every number is a live count. */
export default async function ManageHome(props: AdminViewServerProps) {
  return AdminPage({ props, title: 'Manage', bare: true, children: async () => {
    const { payload, user } = props.initPageResult.req
    const now = new Date(); const soon = new Date(now.getTime() + DUE_SOON_DAYS * 86_400_000).toISOString()
    const count = (where: object) => payload.count({ collection: 'content', overrideAccess: true, where: where as never }).then(r => r.totalDocs)
    const [due, hidden, drafts, pendingAi, failed, live, noOwner, coming, recent] = await Promise.all([
      count({ and: [{ state: { equals: 'published' } }, { reviewDueAt: { less_than_equal: soon } }] }),
      count({ and: [{ state: { equals: 'published' } }, { reviewDueAt: { less_than_equal: now.toISOString() } }] }),
      count({ state: { equals: 'draft' } }),
      payload.count({ collection: 'suggestions', overrideAccess: true, where: { decision: { equals: 'pending' } } }).then(r => r.totalDocs),
      payload.count({ collection: 'processing-jobs', overrideAccess: true, where: openFailures(await supersededFailures(queuePool()).catch(() => [])) as never }).then(r => r.totalDocs),
      count({ state: { equals: 'published' } }),
      count({ and: [{ state: { in: ['published', 'draft'] } }, { owner: { exists: false } }] }),
      payload.find({ collection: 'content', overrideAccess: true, depth: 0, limit: 5, sort: 'reviewDueAt', where: { and: [{ state: { equals: 'published' } }, { reviewDueAt: { less_than_equal: soon } }] } }),
      payload.find({ collection: 'content', overrideAccess: true, depth: 0, limit: 5, sort: '-createdAt' }),
    ])
    const first = (user as { name?: string } | null)?.name?.split(' ')[0] ?? ''
    const hour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Chicago' }))
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
    const card = (icon: string, title: string, body: string, href: string, action: string, tone = '') => <section className={`ae-card ae-need ${tone}`}>
      <span className="ae-need-icon" aria-hidden>{icon}</span><div><h2>{title}</h2><p className="ae-muted">{body}</p><a className="ae-btn ae-btn--secondary ae-btn--small" href={href}>{action}</a></div></section>

    return <div className="ae-manage">
      <div className="ae-head"><div><h1>{greeting}{first ? `, ${first}` : ''}</h1><p className="ae-muted">Here&apos;s what needs you today. Everything else is handled.</p></div>
        <a className="ae-btn ae-btn--primary" href="/admin/add-content">+ Add content</a></div>
      <div className="ae-needs">
        {card('⏱', `${due} ${due === 1 ? 'item reaches' : 'items reach'} the review date in the next ${DUE_SOON_DAYS} days`, hidden ? `${hidden} already hidden from advisors until someone checks ${hidden === 1 ? 'it' : 'them'}.` : 'Nothing is hidden right now.', '/admin/due-for-review', 'Review now', hidden ? 'warn' : '')}
        {card('✦', `${pendingAi} ${pendingAi === 1 ? 'upload is' : 'uploads are'} ready to check`, 'AI has written summaries, takeaways and tags. You check and accept them.', '/admin/review', 'Check suggestions')}
        {card('✓', `${drafts} ${drafts === 1 ? 'item needs' : 'items need'} approval`, 'AI and the migration have filled in the details. Glance over them and publish in bulk.', '/admin/approve', 'Approve drafts')}
        {failed > 0 && card('!', `${failed} processing ${failed === 1 ? 'step needs' : 'steps need'} attention`, 'Usually an unreadable scan or a private Vimeo link.', '/admin/automation', 'See details', 'fail')}
      </div>
      <div className="ae-grid-2">
        <section className="ae-card"><div className="ae-card-row"><h2>Coming up for review</h2><a href="/admin/due-for-review">All {due} →</a></div>
          {coming.docs.length ? <ul className="ae-list">{coming.docs.map(d => <li key={d.id}>
            <span className="ae-thumb"><Thumbnail id={d.id} version={d.thumbnailVersion} format={d.format} title={d.title} rounded={6} compact /></span>
            <span className="ae-list-main"><a href={`/admin/collections/content/${d.id}`}><strong>{d.title}</strong></a><span className="ae-muted">{REVIEW_WINDOWS.find(w => w.id === d.reviewWindow)?.label}</span></span>
            <Pill doc={d} />
            <form method="post" action={`/library-api/content/${d.id}/review`}><button className="ae-btn ae-btn--secondary ae-btn--small" disabled={d.reviewWindow === 'fixedDate'}>Still accurate</button></form></li>)}</ul>
            : <p className="ae-muted">Nothing due in the next {DUE_SOON_DAYS} days.</p>}</section>
        <aside className="ae-stack">
          <section className="ae-card"><h2>Library at a glance</h2><ul className="ae-kv">
            <li><span>Live for advisors</span><strong>{live}</strong></li><li><span>Waiting for approval</span><strong>{drafts}</strong></li>
            <li><span>Hidden after review lapsed</span><strong>{hidden}</strong></li><li><span>Missing an owner</span><strong>{noOwner}</strong></li></ul></section>
          <section className="ae-card"><h2>Recently added</h2>{recent.docs.length ? <ul className="ae-list compact">{recent.docs.map(d => <li key={d.id}>
            <span className="ae-thumb"><Thumbnail id={d.id} version={d.thumbnailVersion} format={d.format} title={d.title} rounded={6} compact /></span>
            <span className="ae-list-main"><a href={`/admin/collections/content/${d.id}`}><strong>{d.title}</strong></a><span className="ae-muted">Added {day(d.createdAt)}</span></span><Pill doc={d} /></li>)}</ul>
            : <p className="ae-muted">Nothing yet. <a href="/admin/add-content">Add the first item</a>.</p>}</section>
        </aside>
      </div>
    </div>
  } })
}
