import type { AdminViewServerProps, Where } from 'payload'
import { AdminPage } from '../AdminPage'
import { Thumbnail } from '../Thumbnail'
import { FORMATS, formatLabel } from '../Format'
import { DUE_SOON_DAYS, REVIEW_WINDOWS } from '../../domain/review'
import { SECTION_OPTIONS, labelOf } from '../../domain/navigation'
import { Pill, shortDay } from './shared'

const CHIPS = [['all', 'All'], ['live', 'Live'], ['approval', 'Needs approval'], ['soon', 'Due soon'], ['hidden', 'Hidden'], ['new', 'New'], ['mine', 'Mine'], ['archived', 'Archived']] as const

/** Content list (design: AdminContent): everything with its status, review window, next review and owner. */
export default async function LibraryList(props: AdminViewServerProps) {
  return AdminPage({ props, title: 'Content', children: async () => {
    const { payload, user } = props.initPageResult.req
    const params = await props.searchParams
    const get = (k: string) => typeof params?.[k] === 'string' ? params[k] as string : ''
    const status = CHIPS.find(c => c[0] === get('status'))?.[0] ?? 'all'
    const section = SECTION_OPTIONS.find(s => s.value === get('section'))?.value
    const format = (FORMATS as readonly string[]).includes(get('format')) ? get('format') : ''
    const q = get('q').slice(0, 100)
    const page = Math.max(1, Number(get('page')) || 1)
    const now = new Date().toISOString(); const soon = new Date(Date.now() + DUE_SOON_DAYS * 86_400_000).toISOString()
    const byStatus: Record<string, Where> = {
      all: { state: { not_equals: 'archived' } }, live: { and: [{ state: { equals: 'published' } }, { or: [{ reviewDueAt: { exists: false } }, { reviewDueAt: { greater_than: now } }] }] },
      approval: { state: { equals: 'draft' } }, soon: { and: [{ state: { equals: 'published' } }, { reviewDueAt: { greater_than: now } }, { reviewDueAt: { less_than_equal: soon } }] },
      hidden: { and: [{ state: { equals: 'published' } }, { reviewDueAt: { less_than_equal: now } }] }, new: { state: { equals: 'intake' } },
      mine: { owner: { equals: user!.id } }, archived: { state: { equals: 'archived' } },
    }
    const where: Where = { and: [byStatus[status], ...(section ? [{ section: { equals: section } }] : []), ...(format ? [{ format: { equals: format } }] : []), ...(q ? [{ title: { contains: q } }] : [])] }
    const result = await payload.find({ collection: 'content', overrideAccess: true, depth: 1, limit: 50, page, sort: '-updatedAt', where })
    const link = (changes: Record<string, string>) => { const s = new URLSearchParams({ ...(status !== 'all' ? { status } : {}), ...(section ? { section } : {}), ...(format ? { format } : {}), ...(q ? { q } : {}), ...changes }); for (const [k, v] of [...s]) if (!v) s.delete(k); return `/admin/library?${s}` }

    return <div className="ae-manage">
      <div className="ae-head"><div><h1>Content</h1><p className="ae-muted">Everything in the library, with its status and when it&apos;s next checked.</p></div>
        <div style={{ display: 'flex', gap: 8 }}><a className="ae-btn ae-btn--secondary" href="/admin/bulk-add">Add many files</a><a className="ae-btn ae-btn--primary" href="/admin/add-content">+ Add content</a></div></div>
      <div className="ae-toolbar">
        <nav className="ae-chips" aria-label="Status">{CHIPS.map(([id, label]) => <a key={id} href={link({ status: id === 'all' ? '' : id, page: '' })} aria-current={status === id ? 'page' : undefined}>{label}</a>)}</nav>
        <form method="get" className="ae-filters">
          {status !== 'all' && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q} placeholder="Find by title" aria-label="Find by title" />
          <select name="section" defaultValue={section ?? ''} aria-label="Section"><option value="">All sections</option>{SECTION_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          <select name="format" defaultValue={format} aria-label="Format"><option value="">All formats</option>{FORMATS.map(f => <option key={f} value={f}>{formatLabel(f)}</option>)}</select>
          <button className="ae-btn ae-btn--secondary ae-btn--small">Apply</button>
        </form>
      </div>
      <section className="ae-card" style={{ padding: 0 }}>
        {result.docs.length === 0 ? <p className="ae-muted" style={{ padding: 20 }}>Nothing matches. <a href="/admin/library">Show everything</a>.</p>
          : <table className="ae-table"><thead><tr><th>Content</th><th>Section</th><th>Status</th><th>Review window</th><th>Next review</th><th>Owner</th></tr></thead>
            <tbody>{result.docs.map(d => { const owner = typeof d.owner === 'object' && d.owner ? d.owner : null
              return <tr key={d.id}>
                <td><div className="ae-row-title"><span className="ae-thumb"><Thumbnail id={d.id} version={d.thumbnailVersion} format={d.format} title={d.title} rounded={6} compact /></span>
                  <span><a href={`/admin/collections/content/${d.id}`}><strong>{d.title}</strong></a><span className="ae-muted">{d.kind === 'howto' ? 'How-to article' : formatLabel(d.format)}</span></span></div></td>
                <td>{d.section ? labelOf(SECTION_OPTIONS, d.section) : <span className="ae-muted">Not filed</span>}</td>
                <td><Pill doc={d} /></td>
                <td>{REVIEW_WINDOWS.find(w => w.id === d.reviewWindow)?.label ?? '—'}</td>
                <td>{shortDay(d.reviewDueAt)}</td>
                <td>{owner ? owner.name || owner.email : <span className="ae-muted">No owner</span>}</td></tr> })}</tbody></table>}
      </section>
      <div className="ae-pager"><span className="ae-muted">Showing {result.docs.length} of {result.totalDocs}</span>
        <span style={{ display: 'flex', gap: 8 }}>{result.hasPrevPage && <a className="ae-btn ae-btn--secondary ae-btn--small" href={link({ page: String(page - 1) })}>Previous</a>}
          {result.hasNextPage && <a className="ae-btn ae-btn--secondary ae-btn--small" href={link({ page: String(page + 1) })}>Load more</a>}
          <a className="ae-btn ae-btn--secondary ae-btn--small" href="/admin/collections/content">Bulk edit in the full table</a></span></div>
    </div>
  } })
}
