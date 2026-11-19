import type { AdminViewServerProps, Where } from 'payload'
import { AdminPage } from './AdminPage'
import { Thumbnail } from './Thumbnail'
import { SECTION_OPTIONS, labelOf } from '../domain/navigation'
import { day } from './manage/shared'

const PAGE = 100
const CHIPS = [['ready', 'Ready to publish'], ['audience', 'Needs an audience'], ['processing', 'Still processing']] as const
type Chip = typeof CHIPS[number][0]
const WHERE: Record<Chip, Where> = {
  ready: { and: [{ state: { equals: 'draft' } }, { accessProfile: { exists: true } }] },
  audience: { and: [{ state: { equals: 'draft' } }, { accessProfile: { exists: false } }] },
  processing: { state: { equals: 'intake' } },
}
const OUTCOMES: Record<string, string> = { admin_only: 'Only administrators can publish.', nothing_selected: 'Select at least one item first.' }

/**
 * Approve drafts (design: AdminDashboard "Approve drafts"): every Draft on one page so an administrator can glance and
 * publish many at once. AI and the migration have already filled the details; publishing still requires an audience.
 */
export default async function ApproveDrafts(props: AdminViewServerProps) {
  return AdminPage({ props, title: 'Approve drafts', children: async ({ isAdmin }) => {
    const { payload } = props.initPageResult.req
    const params = (await props.searchParams) as Record<string, string | undefined> | undefined
    const chip: Chip = CHIPS.some(c => c[0] === params?.show) ? params!.show as Chip : 'ready'
    const page = Math.max(1, Number(params?.page) || 1)
    const [list, ...counts] = await Promise.all([
      payload.find({ collection: 'content', overrideAccess: true, depth: 1, limit: PAGE, page, sort: '-listedAt', where: WHERE[chip] }),
      ...CHIPS.map(c => payload.count({ collection: 'content', overrideAccess: true, where: WHERE[c[0]] }).then(r => r.totalDocs)),
    ])
    const done = Number(params?.done ?? 0), skipped = Number(params?.skipped ?? 0)
    const message = params?.outcome === 'published' ? `${done} published${skipped ? `; ${skipped} could not be published (open them to see why)` : ''}.` : OUTCOMES[params?.outcome ?? '']
    const canPublish = isAdmin && chip === 'ready'
    const href = (show: Chip, p = 1) => `/admin/approve?${new URLSearchParams({ show, ...(p > 1 ? { page: String(p) } : {}) })}`
    return <>
      <h1 style={{ marginBottom: 4 }}>Approve drafts</h1>
      <p className="ae-muted" style={{ maxWidth: 820, marginTop: 0 }}>Items whose details are filled in, by your team, the old site or AI, and are waiting to go live. Glance over them, untick anything that needs a closer look, then publish the rest in one step. Publishing makes an item visible to its audience; it never changes who that audience is.</p>
      {message && <p role="status" className={`ae-notice ae-notice--${params?.outcome === 'published' && !skipped ? 'ok' : 'warn'}`}>{message}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 16px' }}>
        {CHIPS.map(([id, label], i) => <a key={id} href={href(id)} className={`ae-btn ae-btn--small ${chip === id ? 'ae-btn--primary' : 'ae-btn--secondary'}`}>{label} · {counts[i]}</a>)}
      </div>
      {chip === 'audience' && <p className="ae-notice">These have no audience yet, usually because their WordPress access could not be mapped automatically. Open one and choose an access profile, then it moves to Ready to publish.</p>}
      {chip === 'processing' && <p className="ae-notice">Still being read and described by AI. They appear under Ready to publish when finished.</p>}
      {list.docs.length === 0 ? <div className="ae-card"><p className="ae-muted" style={{ margin: 0 }}>Nothing here right now.</p></div>
        : <form method="post" action="/library-api/approve-bulk" className="ae-card" style={{ padding: 0 }}>
          {canPublish && <div className="ae-bulkbar" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--theme-elevation-100)' }}>
            <span className="ae-muted" style={{ flex: 1 }}>All items on this page are selected. Untick any you want to hold back.</span>
            <button className="ae-btn ae-btn--primary" name="scope" value="selected">Publish selected</button>
          </div>}
          <table className="ae-table">
            <thead><tr>{canPublish && <th style={{ width: 36 }}><span className="ae-muted">✓</span></th>}<th>Item</th><th>Section</th><th>Audience</th><th>On the old site</th></tr></thead>
            <tbody>{list.docs.map(d => {
              const profile = typeof d.accessProfile === 'object' && d.accessProfile ? (d.accessProfile as { name?: string }).name : null
              return <tr key={d.id}>
                {canPublish && <td><input type="checkbox" name="ids" value={d.id} defaultChecked aria-label={`Publish ${d.title}`} /></td>}
                <td><div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ width: 96, flex: 'none' }}><Thumbnail id={d.id} version={d.thumbnailVersion} format={d.format} title={d.title} rounded={6} compact /></span>
                  <span style={{ minWidth: 0 }}><a href={`/admin/collections/content/${d.id}`} style={{ fontWeight: 600 }}>{d.title}</a>
                    {d.description && <span className="ae-muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{d.description}</span>}</span>
                </div></td>
                <td>{labelOf(SECTION_OPTIONS, d.section) || <span className="ae-muted">—</span>}</td>
                <td>{profile ?? <span className="ae-pill ae-pill--warn">None yet</span>}</td>
                <td className="ae-muted" style={{ whiteSpace: 'nowrap' }}>{d.originalPublishedAt ? day(d.originalPublishedAt) : '—'}</td>
              </tr>
            })}</tbody>
          </table>
        </form>}
      {list.totalPages > 1 && <p style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {list.hasPrevPage && <a className="ae-btn ae-btn--secondary ae-btn--small" href={href(chip, page - 1)}>← Previous</a>}
        <span className="ae-muted">Page {page} of {list.totalPages} · {list.totalDocs} items</span>
        {list.hasNextPage && <a className="ae-btn ae-btn--secondary ae-btn--small" href={href(chip, page + 1)}>Next →</a>}
      </p>}
      {!isAdmin && <p className="ae-muted">Only administrators can publish.</p>}
    </>
  } })
}
