import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Icon from '../../../../components/Icon'
import AutoSubmit from '../../../../components/AutoSubmit'
import { FORMATS, formatPlural } from '../../../../components/Format'
import { ResourceGrid, ResourceList } from '../../../../components/ResourceGrid'
import { Thumbnail } from '../../../../components/Thumbnail'
import { AUDIENCES, LINES, PROGRAMS, pageName, sectionById, sectionHref, slugify, tagValue, topicHref, topicName } from '../../../../domain/navigation'
import type { BrowseFilters, Kit, Material } from '../../../../domain/library'
import { readerLibrary } from '../../../../server/library'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }
const one = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined
const many = (value: string | string[] | undefined) => (Array.isArray(value) ? value : value ? [value] : [])
const UPDATED = [{ value: '', label: 'Any time' }, { value: '365', label: 'Past 12 months' }, { value: '30', label: 'Past 30 days' }]

export async function generateMetadata({ params, searchParams }: Params) {
  const section = sectionById((await params).id)
  const query = await searchParams
  const name = section && (topicName(section, one(query.topic)) ?? pageName(section, one(query.page)))
  return { title: section ? `${name ? `${name} · ` : ''}${section.label} | AE Library` : 'AE Library' }
}

/**
 * Section, topic and familiar-page listings (designs: Hub, Category). Filters are descriptive fields; the listing uses the
 * same authorized repository as search, so it never shows anything the reader can't open.
 */
export default async function SectionPage({ params, searchParams }: Params) {
  const section = sectionById((await params).id)
  if (!section) notFound()
  const query = await searchParams
  const topic = topicName(section, one(query.topic))
  const familiar = topic ? null : pageName(section, one(query.page))
  const types = many(query.type).filter(t => t === 'resource' || t === 'howto')
  const formats = many(query.format).filter(f => (FORMATS as readonly string[]).includes(f))
  const lines = many(query.line).filter(l => LINES.some(o => o.value === l))
  const audience = AUDIENCES.find(a => a.value === one(query.audience))?.value
  const program = PROGRAMS.find(p => p.value === one(query.program))?.value
  const updated = UPDATED.find(u => u.value === one(query.updated) && u.value)?.value
  const sort = one(query.sort) === 'newest' ? 'recent' : 'popular'
  const view = one(query.view) === 'list' ? 'list' : 'grid'
  const pageNumber = Math.max(1, Math.min(100, Number(one(query.p)) || 1))
  const filters: BrowseFilters = {
    ...(topic ? { topic: tagValue(section.id, topic) } : familiar ? { page: tagValue(section.id, familiar) } : { section: section.id }),
    ...(types.length === 1 ? { kind: types[0] } : { excludeKinds: ['news', 'bulletin'] }),
    ...(formats.length ? { formats } : {}), ...(lines.length ? { lines } : {}), ...(audience ? { audience } : {}), ...(program ? { program } : {}),
    ...(updated ? { updatedSince: new Date(Date.now() - Number(updated) * 86_400_000).toISOString() } : {}),
    sort, pageSize: 24,
  }

  let result: { items: Material[]; hasNextPage: boolean; total?: number } = { items: [], hasNextPage: false }
  let repository = null; let signedIn = false; let unavailable = false; let saved: number[] = []; let kits: Kit[] = []
  try { ({ repository, signedIn } = await readerLibrary(await headers())) } catch { unavailable = true }
  try {
    if (repository) [result, saved, kits] = await Promise.all([repository.search('', undefined, pageNumber, 'view', filters), repository.savedIds(),
      topic || familiar ? Promise.resolve([]) : repository.kits({ section: section.id })])
  } catch { unavailable = true }

  const base: Record<string, string> = topic ? { topic: slugify(topic) } : familiar ? { page: slugify(familiar) } : {}
  const current = new URLSearchParams(base)
  for (const t of types) current.append('type', t)
  for (const f of formats) current.append('format', f)
  for (const l of lines) current.append('line', l)
  if (audience) current.set('audience', audience)
  if (program) current.set('program', program)
  if (updated) current.set('updated', updated)
  if (sort === 'recent') current.set('sort', 'newest')
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(current)
    for (const [k, v] of Object.entries(changes)) { if (v === null) next.delete(k); else next.set(k, v) }
    if (!('p' in changes)) next.delete('p')
    const value = next.toString()
    return `${sectionHref(section.id)}${value ? `?${value}` : ''}`
  }
  const heading = topic ?? familiar ?? section.label
  const filtered = types.length + formats.length + lines.length + (audience ? 1 : 0) + (program ? 1 : 0) + (updated ? 1 : 0) > 0

  return <>
    <div className={`page-head section-head${familiar ? ' familiar-head' : ''}`}>
      <span className={`section-icon section-${section.id}`}><Icon name={section.icon} size={22} /></span>
      <div>
        {(topic || familiar) && <p className="eyebrow"><Link href={sectionHref(section.id)}>{section.label}</Link>{familiar ? ' · Page you know' : ' · Topic'}</p>}
        <h1>{heading}</h1>
        {!topic && !familiar && <p className="subtle">{section.blurb}</p>}
        {familiar && <p className="subtle">Same page as on the old resource site, now with search and filters.</p>}
        {repository && <p className="small-text subtle">{result.total ?? result.items.length} {result.total === 1 ? 'item' : 'items'} · showing what your access allows</p>}
      </div>
    </div>

    <nav className="chip-row topic-row" aria-label={`${section.label} topics`}>
      <Link className="pill-link" href={sectionHref(section.id)} aria-current={!topic && !familiar ? 'page' : undefined}>All</Link>
      {section.topics.map(t => <Link key={t} className="pill-link" href={topicHref(section.id, t)} aria-current={t === topic ? 'page' : undefined}>{t}</Link>)}
    </nav>

    {unavailable ? <section className="panel empty" role="status"><Icon name="info" size={28} /><h2>The library is temporarily unavailable</h2><p>Please try again in a few minutes.</p></section>
      : !repository ? <section className="panel empty">
        <span className="empty-icon"><Icon name={signedIn ? 'lock' : 'library'} size={22} /></span>
        {signedIn ? <><h2>Your account doesn&apos;t have library access yet</h2><p>Contact the library administrator.</p></>
          : <><h2>Sign in to see this section</h2><p>Use your Advisors Excel account.</p><a className="btn-primary" href={`/auth/login?returnTo=${encodeURIComponent(href({}))}`}>Sign in</a></>}
      </section>
      : <>
        {kits.length > 0 && <section aria-labelledby="kits-h" className="kits">
          <div className="section-title"><h2 id="kits-h"><Icon name="kit" />Ready-made kits</h2><span className="small-text subtle">Everything for one job, assembled and approved by the team</span></div>
          <div className="kit-grid">{kits.slice(0, 3).map(k => <Link key={k.id} className="kit-card" href={`/kits/${k.id}`}>
            <span className="kit-art">{k.items.slice(0, 3).map(m => <Thumbnail key={m.id} id={m.id} version={m.thumbnailVersion} format={m.format} title={m.title} rounded={0} compact />)}</span>
            <span className="kit-body"><span className="small-text subtle">{k.items.length} items</span><strong>{k.title}</strong>{k.description && <span className="subtle">{k.description}</span>}</span></Link>)}</div>
        </section>}

        <div className="browse">
          <AutoSubmit className="filter-rail" action={sectionHref(section.id)} label="Filters">
            {Object.entries(base).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            {sort === 'recent' && <input type="hidden" name="sort" value="newest" />}
            {view === 'list' && <input type="hidden" name="view" value="list" />}
            <fieldset><legend>Type</legend>
              <label><input type="checkbox" name="type" value="resource" defaultChecked={types.includes('resource')} /> Resources</label>
              <label><input type="checkbox" name="type" value="howto" defaultChecked={types.includes('howto')} /> How-to articles</label></fieldset>
            <fieldset><legend>Audience</legend>{AUDIENCES.map(a => <label key={a.value}><input type="radio" name="audience" value={a.value} defaultChecked={audience === a.value} /> {a.label}</label>)}
              {audience && <Link className="small-text" href={href({ audience: null })}>Any audience</Link>}</fieldset>
            <fieldset><legend>Format</legend>{FORMATS.map(f => <label key={f}><input type="checkbox" name="format" value={f} defaultChecked={formats.includes(f)} /> {formatPlural(f)}</label>)}</fieldset>
            <fieldset><legend>Line of business</legend>{LINES.map(l => <label key={l.value}><input type="checkbox" name="line" value={l.value} defaultChecked={lines.includes(l.value)} /> {l.label}</label>)}</fieldset>
            <fieldset><legend>Program</legend>{PROGRAMS.map(p => <label key={p.value}><input type="radio" name="program" value={p.value} defaultChecked={program === p.value} /> {p.label}</label>)}
              {program && <Link className="small-text" href={href({ program: null })}>Any program</Link>}</fieldset>
            <fieldset><legend>Updated</legend>{UPDATED.map(u => <label key={u.label}><input type="radio" name="updated" value={u.value} defaultChecked={(updated ?? '') === u.value} /> {u.label}</label>)}</fieldset>
            <div className="filter-actions"><button type="submit" className="btn-ghost small">Apply</button>{filtered && <Link className="small-text" href={`${sectionHref(section.id)}${Object.keys(base).length ? `?${new URLSearchParams(base)}` : ''}`}>Clear filters</Link>}</div>
          </AutoSubmit>

          <section className="panel browse-main" aria-label="Items">
            <div className="browse-bar">
              <strong>{topic || familiar ? heading : `All in ${section.label}`}</strong>
              <span className="viewer-spacer" />
              <div className="view-toggle" role="group" aria-label="Layout">
                <Link href={href({ view: null })} aria-current={view === 'grid' ? 'true' : undefined} title="Grid"><Icon name="grid" /></Link>
                <Link href={href({ view: 'list' })} aria-current={view === 'list' ? 'true' : undefined} title="List"><Icon name="list" /></Link>
              </div>
              <div className="seg" role="group" aria-label="Sort">
                <Link href={href({ sort: null })} aria-current={sort === 'popular' ? 'true' : undefined}>Most useful</Link>
                <Link href={href({ sort: 'newest' })} aria-current={sort === 'recent' ? 'true' : undefined}>Newest</Link>
              </div>
            </div>
            {result.items.length === 0 ? <div className="empty inline">
              <h2>Nothing here yet</h2>
              <p>{filtered ? 'Try fewer filters.' : `Items appear here once they are filed under this ${topic ? 'topic' : familiar ? 'page' : 'section'} and published for you.`}</p>
            </div> : view === 'grid' ? <ResourceGrid items={result.items} saved={saved} /> : <ResourceList items={result.items} saved={saved} />}
            {(pageNumber > 1 || result.hasNextPage) && <div className="pager">
              {pageNumber > 1 ? <Link className="btn-ghost" href={href({ p: String(pageNumber - 1) })}>← Previous</Link> : <span />}
              <span className="subtle">Page {pageNumber}</span>
              {result.hasNextPage ? <Link className="btn-ghost" href={href({ p: String(pageNumber + 1) })}>Show more →</Link> : <span />}
            </div>}
          </section>
        </div>
      </>}

    {!topic && !familiar && <section className="panel" aria-labelledby="familiar-h">
      <h2 id="familiar-h">Pages you know</h2>
      <p className="subtle">The names advisors know from the previous resource site.</p>
      <div className="chip-row">{section.familiar.map(f => <Link key={f} className="pill-link" href={`${sectionHref(section.id)}?page=${slugify(f)}`}>{f}</Link>)}
</div>
    </section>}
  </>
}
