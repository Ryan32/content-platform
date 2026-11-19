import { headers } from 'next/headers'
import Link from 'next/link'
import Icon from '../../../components/Icon'
import { ResultRow } from '../../../components/ResultRow'
import { readerLibrary } from '../../../server/library'
import type { Material } from '../../../domain/library'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'News | AE Library' }

/** AE Today stories and bulletins, newest first. */
export default async function NewsPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const params = await searchParams
  const type = params.type === 'bulletin' ? 'bulletin' : params.type === 'news' ? 'news' : undefined
  const page = Math.max(1, Math.min(100, Number(params.page) || 1))
  const { repository, signedIn } = await readerLibrary(await headers())
  let result: { items: Material[]; hasNextPage: boolean } = { items: [], hasNextPage: false }; let saved: number[] = []
  if (repository) [result, saved] = await Promise.all([repository.search('', undefined, page, 'view', { kinds: type ? [type] : ['news', 'bulletin'] }), repository.savedIds()])
  const link = (t?: string, p?: number) => `/news?${new URLSearchParams({ ...(t ? { type: t } : {}), ...(p && p > 1 ? { page: String(p) } : {}) })}`
  return <>
    <div className="page-head"><div><h1>News</h1><p className="subtle">AE Today stories and bulletins.</p></div></div>
    {!repository ? <section className="panel empty"><span className="empty-icon"><Icon name="lock" size={22} /></span><h2>{signedIn ? 'Access not set up' : 'Sign in to read the news'}</h2>
      {!signedIn && <a className="btn-primary" href="/auth/login?returnTo=%2Fnews">Sign in</a>}</section>
      : <section className="panel">
        <nav className="tabs" aria-label="Type"><Link href={link()} aria-current={!type ? 'page' : undefined}>All</Link><Link href={link('news')} aria-current={type === 'news' ? 'page' : undefined}>AE Today</Link><Link href={link('bulletin')} aria-current={type === 'bulletin' ? 'page' : undefined}>Bulletins</Link></nav>
        {result.items.length === 0 ? <div className="empty inline"><h2>No news yet</h2></div> : <div className="result-list">{result.items.map(m => <ResultRow key={m.id} item={m} saved={saved.includes(Number(m.id))} />)}</div>}
        {(page > 1 || result.hasNextPage) && <div className="pager">{page > 1 ? <Link className="btn-ghost" href={link(type, page - 1)}>← Newer</Link> : <span />}<span className="subtle">Page {page}</span>{result.hasNextPage ? <Link className="btn-ghost" href={link(type, page + 1)}>Older →</Link> : <span />}</div>}
      </section>}
  </>
}
