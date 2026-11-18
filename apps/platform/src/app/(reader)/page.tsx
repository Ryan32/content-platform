import { headers } from 'next/headers'
import Link from 'next/link'
import { readerLibrary } from '../../server/library'
import { FORMATS, FormatChip, formatDate, formatPlural } from '../../components/Format'
import { Thumbnail } from '../../components/Thumbnail'
import Icon from '../../components/Icon'
import { ResourceGrid } from '../../components/ResourceGrid'
export const dynamic = 'force-dynamic'

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q.slice(0, 200) : ''
  const format = typeof params.format === 'string' && (FORMATS as readonly string[]).includes(params.format) ? params.format : undefined
  const view = params.view === 'list' ? 'list' : 'grid'
  const page = Math.max(1, Math.min(100, Number(params.page) || 1))
  let repository = null; let signedIn = false; let unavailable = false
  try { ({ repository, signedIn } = await readerLibrary(await headers())) } catch { unavailable = true }
  let result = { items: [] as Awaited<ReturnType<NonNullable<typeof repository>['search']>>['items'], hasNextPage: false }
  try { if (repository) result = await repository.search(query, format, page, 'view') } catch { unavailable = true }
  const link = (next: { format?: string; page?: number; view?: string }) => {
    const search = new URLSearchParams()
    if (query) search.set('q', query)
    if (next.format) search.set('format', next.format)
    if ((next.view ?? view) === 'list') search.set('view', 'list')
    if (next.page && next.page > 1) search.set('page', String(next.page))
    const value = search.toString()
    return value ? `/?${value}` : '/'
  }

  return <>
    {params.signin === 'failed' && <p className="alert" role="alert"><Icon name="info" />Sign-in did not complete. Please try again.</p>}
    <div className="page-head">
      <div><h1>Content library</h1><p className="subtle">Guides, recordings, and documents approved for you, with citations you can trust.</p></div>
    </div>

    {unavailable ? <section className="panel empty" role="status"><Icon name="info" size={28} /><h2>The library is temporarily unavailable</h2><p>Please try again in a few minutes.</p></section>
      : !repository ? <section className="panel empty">
        <span className="empty-icon"><Icon name={signedIn ? 'lock' : 'library'} size={22} /></span>
        {signedIn ? <><h2>Your account doesn&apos;t have library access yet</h2><p>You&apos;re signed in, but no library access has been set up for this account. Contact the library administrator.</p></>
          : <><h2>Sign in to see your library</h2><p>Use your Advisors Excel account. You&apos;ll see the resources shared with your firm, team, and programs.</p>
            <a className="btn-primary" href="/auth/login">Sign in</a></>}
      </section>
      : <section className="panel">
        <nav className="tabs" aria-label="Filter by format">
          <Link href={link({})} aria-current={!format ? 'page' : undefined}>All</Link>
          {FORMATS.map(f => <Link key={f} href={link({ format: f })} aria-current={format === f ? 'page' : undefined}>{formatPlural(f)}</Link>)}
        </nav>
        <div className="toolbar">
          <form className="toolbar-search" role="search">
            {format && <input type="hidden" name="format" value={format} />}
            {view === 'list' && <input type="hidden" name="view" value="list" />}
            <label className="search-field"><Icon name="search" size={15} /><span className="sr-only">Search the library</span>
              <input name="q" defaultValue={query} placeholder="Search titles, topics, or questions…" maxLength={200} /></label>
            <button className="btn-primary" type="submit">Search</button>
            {(query || format) && <Link className="btn-ghost" href={view === 'list' ? '/?view=list' : '/'}>Clear</Link>}
          </form>
          <div className="view-toggle" role="group" aria-label="Layout">
            <Link href={link({ format, view: 'grid' })} aria-current={view === 'grid' ? 'true' : undefined} title="Grid"><Icon name="grid" />Grid</Link>
            <Link href={link({ format, view: 'list' })} aria-current={view === 'list' ? 'true' : undefined} title="List"><Icon name="list" />List</Link>
          </div>
        </div>
        {query && <p className="result-note">{result.items.length ? `Most relevant results for “${query}”` : `No results for “${query}”`}{format ? ` in ${formatPlural(format)}` : ''}</p>}
        {result.items.length === 0 ? <div className="empty inline">
          <h2>{query || format ? 'Nothing matches yet' : 'No resources yet'}</h2>
          <p>{query || format ? 'Try different words, or clear the filters.' : 'Resources appear here once they are published for you.'}</p>
        </div> : view === 'grid' ? <ResourceGrid items={result.items} />
        : <table className="list">
          <thead><tr><th scope="col" className="thumb-col"><span className="sr-only">Preview</span></th><th scope="col">Resource</th><th scope="col">Format</th><th scope="col">Updated</th></tr></thead>
          <tbody>{result.items.map(item => <tr key={item.id}>
            <td className="thumb-col"><Thumbnail id={item.id} version={item.thumbnailVersion} format={item.format} title={item.title} rounded={6} compact /></td>
            <td><Link className="row-title" href={`/resources/${item.id}`}>{item.title}</Link>{item.description && <span className="row-sub">{item.description}</span>}</td>
            <td><FormatChip format={item.format} /></td>
            <td className="nowrap subtle">{formatDate(item.updatedAt)}</td>
          </tr>)}</tbody>
        </table>}
        {(page > 1 || result.hasNextPage) && <div className="pager">
          {page > 1 ? <Link className="btn-ghost" href={link({ format, page: page - 1 })}>← Previous</Link> : <span />}
          <span className="subtle">Page {page}</span>
          {result.hasNextPage ? <Link className="btn-ghost" href={link({ format, page: page + 1 })}>Next →</Link> : <span />}
        </div>}
      </section>}
  </>
}
