import { headers } from 'next/headers'
import Link from 'next/link'
import { readerLibrary } from '../../../server/library'
import Icon from '../../../components/Icon'
import { ResultRow } from '../../../components/ResultRow'
import type { BrowseFilters, Material } from '../../../domain/library'
export const dynamic = 'force-dynamic'

type Params = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => typeof v === 'string' ? v : undefined
/** Tabs from the Search mockup, mapped onto real fields. */
const TABS: { id: string; label: string; filters: BrowseFilters; format?: string }[] = [
  { id: 'all', label: 'All', filters: {} },
  { id: 'documents', label: 'Documents', filters: { formats: ['pdf', 'document', 'article'] } },
  { id: 'videos', label: 'Videos', filters: { formats: ['video', 'audio'] } },
  { id: 'slides', label: 'Slides', filters: { formats: ['slides'] } },
  { id: 'client', label: 'Client-ready', filters: { audience: 'client' } },
]
const TYPES = [{ id: 'everything', label: 'Everything' }, { id: 'resource', label: 'Resources' }, { id: 'howto', label: 'How-to articles' }]

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }) {
  const q = one((await searchParams).q)
  return { title: q ? `${q} · Search | AE Library` : 'Search | AE Library' }
}

/** Full results (design: Search). Ranked, authorized search; tabs and the type toggle only narrow it. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams
  const query = (one(params.q) ?? '').slice(0, 200)
  const tab = TABS.find(t => t.id === one(params.tab)) ?? TABS[0]
  const type = TYPES.find(t => t.id === one(params.type)) ?? TYPES[0]
  const legacyFormat = one(params.format)
  const page = Math.max(1, Math.min(100, Number(one(params.page)) || 1))
  let repository = null; let signedIn = false; let unavailable = false
  try { ({ repository, signedIn } = await readerLibrary(await headers())) } catch { unavailable = true }
  let result: { items: Material[]; hasNextPage: boolean; total?: number } = { items: [], hasNextPage: false }
  let saved: number[] = []
  const filters: BrowseFilters = { ...tab.filters, ...(type.id === 'everything' ? { excludeKinds: ['news', 'bulletin'] } : { kind: type.id }) }
  try {
    if (repository) [result, saved] = await Promise.all([repository.search(query, legacyFormat, page, 'view', filters), repository.savedIds()])
  } catch { unavailable = true }
  const link = (next: { tab?: string; type?: string; page?: number }) => {
    const s = new URLSearchParams()
    if (query) s.set('q', query)
    const t = next.tab ?? tab.id; if (t !== 'all') s.set('tab', t)
    const ty = next.type ?? type.id; if (ty !== 'everything') s.set('type', ty)
    if (next.page && next.page > 1) s.set('page', String(next.page))
    return `/search?${s}`
  }

  return <>
    <div className="page-head"><div>
      {query ? <><p className="eyebrow">Results for</p><h1>{query}</h1></> : <><h1>Browse the Library</h1><p className="subtle">Everything published for you, newest first. Type in the search bar to narrow it down.</p></>}
    </div></div>
    {unavailable ? <section className="panel empty" role="status"><Icon name="info" size={28} /><h2>Search is temporarily unavailable</h2><p>Please try again in a few minutes.</p></section>
      : !repository ? <section className="panel empty"><span className="empty-icon"><Icon name={signedIn ? 'lock' : 'library'} size={22} /></span>
        {signedIn ? <><h2>Your account doesn&apos;t have library access yet</h2><p>Contact the library administrator.</p></>
          : <><h2>Sign in to search the library</h2><a className="btn-primary" href={`/auth/login?returnTo=${encodeURIComponent(link({}))}`}>Sign in</a></>}</section>
      : <section className="panel">
        <div className="results-bar">
          <nav className="tabs" aria-label="Filter results">{TABS.map(t => <Link key={t.id} href={link({ tab: t.id, page: 1 })} aria-current={t.id === tab.id ? 'page' : undefined}>{t.label}</Link>)}</nav>
          <div className="seg" role="group" aria-label="Type">{TYPES.map(t => <Link key={t.id} href={link({ type: t.id, page: 1 })} aria-current={t.id === type.id ? 'true' : undefined}>{t.label}</Link>)}</div>
        </div>
        {result.items.length === 0 ? <div className="empty inline"><h2>{query ? `No results for “${query}”` : 'Nothing here yet'}</h2>
          <p>{query ? 'Try fewer or different words, or switch back to All.' : 'Items appear here once they are published for you.'}</p></div>
          : <div className="result-list">{result.items.map(m => <ResultRow key={m.id} item={m} saved={saved.includes(Number(m.id))} />)}</div>}
        {(page > 1 || result.hasNextPage) && <div className="pager">
          {page > 1 ? <Link className="btn-ghost" href={link({ page: page - 1 })}>← Previous</Link> : <span />}
          <span className="subtle">Page {page}</span>
          {result.hasNextPage ? <Link className="btn-ghost" href={link({ page: page + 1 })}>Show more results →</Link> : <span />}
        </div>}
      </section>}
  </>
}
