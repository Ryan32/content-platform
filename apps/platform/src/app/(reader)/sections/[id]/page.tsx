import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Icon from '../../../../components/Icon'
import { FORMATS, formatPlural } from '../../../../components/Format'
import { ResourceGrid } from '../../../../components/ResourceGrid'
import { pageName, sectionById, sectionHref, slugify, tagValue, topicName } from '../../../../domain/navigation'
import type { BrowseFilters, Material } from '../../../../domain/library'
import { readerLibrary } from '../../../../server/library'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }
const one = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined
const TYPES = ['howto', ...FORMATS] as const

export async function generateMetadata({ params, searchParams }: Params) {
  const section = sectionById((await params).id)
  const query = await searchParams
  const name = section && (topicName(section, one(query.topic)) ?? pageName(section, one(query.page)))
  return { title: section ? `${name ? `${name} · ` : ''}${section.label} | AE Library` : 'AE Library' }
}

/**
 * Section, topic and familiar-page listings. Items are filed with the section/topics/pages fields; the listing uses the
 * same authorized repository as search, so it never shows anything the reader can't open.
 */
export default async function SectionPage({ params, searchParams }: Params) {
  const section = sectionById((await params).id)
  if (!section) notFound()
  const query = await searchParams
  const topic = topicName(section, one(query.topic))
  const familiar = topic ? null : pageName(section, one(query.page))
  const type = (TYPES as readonly string[]).includes(one(query.type) ?? '') ? one(query.type)! : undefined
  const pageNumber = Math.max(1, Math.min(100, Number(one(query.p)) || 1))
  const filters: BrowseFilters = { section: section.id,
    ...(topic ? { topic: tagValue(section.id, topic), section: undefined } : {}),
    ...(familiar ? { page: tagValue(section.id, familiar), section: undefined } : {}),
    ...(type === 'howto' ? { kind: 'howto' } : {}) }
  const format = type && type !== 'howto' ? type : undefined

  let result = { items: [] as Material[], hasNextPage: false }; let repository = null; let signedIn = false; let unavailable = false
  try { ({ repository, signedIn } = await readerLibrary(await headers())) } catch { unavailable = true }
  try { if (repository) result = await repository.search('', format, pageNumber, 'view', filters) } catch { unavailable = true }

  const base: Record<string, string> = topic ? { topic: slugify(topic) } : familiar ? { page: slugify(familiar) } : {}
  const link = (next: { type?: string; p?: number }) => {
    const search = new URLSearchParams(base)
    if (next.type) search.set('type', next.type)
    if (next.p && next.p > 1) search.set('p', String(next.p))
    const value = search.toString()
    return `${sectionHref(section.id)}${value ? `?${value}` : ''}`
  }
  const heading = topic ?? familiar ?? section.label

  return <>
    <div className="page-head section-head">
      <span className={`section-icon section-${section.id}`}><Icon name={section.icon} size={22} /></span>
      <div>
        {(topic || familiar) && <p className="eyebrow"><Link href={sectionHref(section.id)}>{section.label}</Link>{familiar ? ' · Page you know' : ''}</p>}
        <h1>{heading}</h1>
        {!topic && !familiar && <p className="subtle">{section.blurb}</p>}
      </div>
    </div>

    <nav className="chip-row topic-row" aria-label={`${section.label} topics`}>
      <Link className="pill-link" href={sectionHref(section.id)} aria-current={!topic && !familiar ? 'page' : undefined}>All of {section.label}</Link>
      {section.topics.map(t => <Link key={t} className="pill-link" href={`${sectionHref(section.id)}?topic=${slugify(t)}`} aria-current={t === topic ? 'page' : undefined}>{t}</Link>)}
    </nav>

    {unavailable ? <section className="panel empty" role="status"><Icon name="info" size={28} /><h2>The library is temporarily unavailable</h2><p>Please try again in a few minutes.</p></section>
      : !repository ? <section className="panel empty">
        <span className="empty-icon"><Icon name={signedIn ? 'lock' : 'library'} size={22} /></span>
        {signedIn ? <><h2>Your account doesn&apos;t have library access yet</h2><p>Contact the library administrator.</p></>
          : <><h2>Sign in to see this section</h2><p>Use your Advisors Excel account.</p><a className="btn-primary" href={`/auth/login?returnTo=${encodeURIComponent(link({ type }))}`}>Sign in</a></>}
      </section>
      : <section className="panel">
        <nav className="tabs" aria-label="Filter by type">
          <Link href={link({})} aria-current={!type ? 'page' : undefined}>All</Link>
          <Link href={link({ type: 'howto' })} aria-current={type === 'howto' ? 'page' : undefined}>How-to</Link>
          {FORMATS.map(f => <Link key={f} href={link({ type: f })} aria-current={type === f ? 'page' : undefined}>{formatPlural(f)}</Link>)}
        </nav>
        {result.items.length === 0 ? <div className="empty inline">
          <h2>Nothing here yet</h2>
          <p>{type ? 'Try another type, or show all.' : 'Items appear here once they are filed under this ' + (topic ? 'topic' : familiar ? 'page' : 'section') + ' and published for you.'}</p>
        </div> : <ResourceGrid items={result.items} />}
        {(pageNumber > 1 || result.hasNextPage) && <div className="pager">
          {pageNumber > 1 ? <Link className="btn-ghost" href={link({ type, p: pageNumber - 1 })}>← Previous</Link> : <span />}
          <span className="subtle">Page {pageNumber}</span>
          {result.hasNextPage ? <Link className="btn-ghost" href={link({ type, p: pageNumber + 1 })}>Next →</Link> : <span />}
        </div>}
      </section>}

    {!topic && !familiar && <section className="panel" aria-labelledby="familiar-h">
      <h2 id="familiar-h">Pages you know</h2>
      <p className="subtle">The names advisors know from the previous resource site.</p>
      <div className="chip-row">{section.familiar.map(f => <Link key={f} className="pill-link" href={`${sectionHref(section.id)}?page=${slugify(f)}`}>{f}</Link>)}</div>
    </section>}
  </>
}
