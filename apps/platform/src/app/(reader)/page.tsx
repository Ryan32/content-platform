import { headers } from 'next/headers'
import Link from 'next/link'
import { readerLibrary } from '../../server/library'
export const dynamic = 'force-dynamic'
const formats = ['article', 'pdf', 'video', 'audio', 'slides', 'document']
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q.slice(0, 200) : ''
  const format = typeof params.format === 'string' && formats.includes(params.format) ? params.format : undefined
  const page = Math.max(1, Math.min(100, Number(params.page) || 1))
  let repository = null; let signedIn = false; let unavailable = false
  try { ({ repository, signedIn } = await readerLibrary(await headers())) } catch { unavailable = true }
  let result = { items: [] as Awaited<ReturnType<NonNullable<typeof repository>['search']>>['items'], hasNextPage: false }
  try { if (repository) result = await repository.search(query, format, page, 'view') } catch { unavailable = true }
  return <>
    {params.signin === 'failed' && <p className="notice" role="alert">Sign-in did not complete. Please try again.</p>}
    <p className="eyebrow">YOUR RESOURCE CENTER</p><h1>Ideas. Answers. Expertise.</h1>
    <p className="intro">Find the resources you need to move your business forward.</p>
    <form className="search" role="search"><label htmlFor="q">Search the library</label>
      <div className="search-row"><input id="q" name="q" defaultValue={query} placeholder="Search topics, titles, or questions" maxLength={200}/>
        <select name="format" aria-label="Content format" defaultValue={format ?? ''}><option value="">All formats</option>{formats.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
        <button type="submit">Search</button></div></form>
    <section aria-labelledby="resources-heading"><div className="section-heading"><h2 id="resources-heading">Explore resources</h2><span>Guides · Videos · Articles</span></div>
      {unavailable ? <div className="empty" role="status"><h3>The library is temporarily unavailable</h3><p>Please try again later.</p></div> : !repository ? (signedIn ?
        <div className="empty"><div className="resource-icon">▤</div><h3>Your account doesn&apos;t have library access yet</h3><p>You&apos;re signed in, but no library access has been set up for this account. Contact the library administrator.</p><span className="pill">Access protected</span></div> :
        <div className="empty"><div className="resource-icon">▤</div><h3>Your library, connected</h3><p>Sign in with your Advisors Excel account to see the resources available to you.</p><a className="pill" href="/auth/login">Sign in</a></div>) : result.items.length === 0 ?
        <div className="empty"><h3>No resources found</h3><p>Try another search or content format.</p><Link href="/">Clear filters</Link></div> :
        <div className="grid">{result.items.map(item => <article className="card" key={item.id}><span className="format">{item.format.toUpperCase()}</span>
          <h3><Link href={`/resources/${item.id}`}>{item.title}</Link></h3><p>{item.description}</p><Link className="open" href={`/resources/${item.id}`}>Open resource →</Link></article>)}</div>}
      {result.hasNextPage && <Link className="open" href={`/?${new URLSearchParams({ q: query, format: format ?? '', page: String(page + 1) })}`}>Next page →</Link>}
    </section>
  </>
}
