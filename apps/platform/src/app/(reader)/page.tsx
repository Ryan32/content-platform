import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { readerLibrary, readerProfile } from '../../server/library'
import { Thumbnail } from '../../components/Thumbnail'
import Icon from '../../components/Icon'
import { formatDate, formatLabel } from '../../components/Format'
import { SECTIONS, labelOf, pageHref, sectionById, SECTION_OPTIONS } from '../../domain/navigation'
import type { Material } from '../../domain/library'
export const dynamic = 'force-dynamic'

const PROMPTS = ['How do I handle seminar no-shows?', 'Allianz commission schedule', 'Resolve a Held at AE NIGO']
const sectionLabel = (m: Material) => m.section ? labelOf(SECTION_OPTIONS, m.section) : formatLabel(m.format)
const searchLink = (q: string) => `/search?${new URLSearchParams({ q })}`

/** Home (design: Main / HomeLight). Old `/?q=` links keep working by moving to /search. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  if (typeof params.q === 'string' || typeof params.format === 'string') redirect(`/search?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'))}`)
  const head = await headers()
  const profile = await readerProfile(head)
  const first = profile && profile.name !== 'Signed in' ? profile.name.split(/[\s@]/)[0] : null
  let repository = null; let signedIn = false; let unavailable = false
  try { ({ repository, signedIn } = await readerLibrary(head)) } catch { unavailable = true }

  let news: Material[] = [], bulletins: Material[] = [], popular: Material[] = [], fresh: Material[] = []
  if (repository) {
    try {
      ;[news, bulletins, popular, fresh] = await Promise.all([
        repository.search('', undefined, 1, 'view', { kinds: ['news'], pageSize: 4 }).then(r => r.items),
        repository.search('', undefined, 1, 'view', { kinds: ['bulletin'], pageSize: 3 }).then(r => r.items),
        repository.mostUsed(6),
        repository.search('', undefined, 1, 'view', { excludeKinds: ['news', 'bulletin'], pageSize: 4 }).then(r => r.items),
      ])
    } catch { unavailable = true }
  }
  const [lead, ...moreNews] = news
  // Until there are enough views to rank, "Most used" shows the most-used pages from the old site.
  const familiar = SECTIONS.flatMap(s => s.familiar.slice(0, 1).map(f => ({ label: f, href: pageHref(s.id, f) })))

  return <div className="home">
    <section className="home-hero" aria-labelledby="ask-h">
      <div className="axl-stage">
        <span className="axl-glow" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="axl-float" src="/axl-books.png" alt="AXL, the AE assistant, sitting with a stack of books" width={150} height={150} />
        <span className="axl-shadow" aria-hidden />
      </div>
      <h1 id="ask-h">What can we help you find{first ? `, ${first}` : ''}?</h1>
      <p className="subtle">Search from the bar above, or press <kbd>Ctrl K</kbd> anywhere.</p>
      <div className="prompt-row">{PROMPTS.map(p => <Link key={p} className="pill-link" href={searchLink(p)}>{p}</Link>)}</div>
    </section>

    {params.signin === 'failed' && <p className="alert" role="alert"><Icon name="info" />Sign-in did not complete. Please try again.</p>}
    {unavailable ? <section className="panel empty" role="status"><Icon name="info" size={28} /><h2>The library is temporarily unavailable</h2><p>Please try again in a few minutes.</p></section>
      : !repository ? <section className="panel empty">
        <span className="empty-icon"><Icon name={signedIn ? 'lock' : 'library'} size={22} /></span>
        {signedIn ? <><h2>Your account doesn&apos;t have library access yet</h2><p>You&apos;re signed in, but no library access has been set up for this account. Contact the library administrator.</p></>
          : <><h2>Sign in to see your library</h2><p>Use your Advisors Excel account. You&apos;ll see the resources shared with your firm, team, and programs.</p>
            <a className="btn-primary" href="/auth/login">Sign in</a></>}
      </section>
      : <>
        <div className="home-split">
          <section className="home-today" aria-labelledby="today-h">
            <div className="section-title"><h2 id="today-h">AE Today</h2><Link href="/news">All news →</Link></div>
            {lead ? <>
              <Link className="news-lead" href={`/resources/${lead.id}`}>
                <span className="news-lead-img"><Thumbnail id={lead.id} version={lead.thumbnailVersion} format={lead.format} title={lead.title} rounded={0} /></span>
                <span className="news-lead-body"><span className="small-text subtle">{formatDate(lead.updatedAt)}{lead.section ? ` · ${sectionLabel(lead)}` : ''}</span>
                  <strong>{lead.title}</strong>{lead.description && <span className="subtle">{lead.description}</span>}</span>
              </Link>
              <div className="news-list">{moreNews.map(n => <Link key={n.id} className="news-row" href={`/resources/${n.id}`}>
                <span className="news-thumb"><Thumbnail id={n.id} version={n.thumbnailVersion} format={n.format} title={n.title} rounded={8} compact /></span>
                <span><strong>{n.title}</strong><span className="small-text subtle">{formatDate(n.updatedAt)}{n.section ? ` · ${sectionLabel(n)}` : ''}</span></span></Link>)}</div>
            </> : <div className="panel empty inline"><p>No AE Today stories yet. Editors publish them as <em>AE Today story</em> items.</p></div>}
          </section>
          <aside className="home-side">
            <section className="panel side-card" aria-labelledby="mu-h">
              <div className="side-card-head"><h2 id="mu-h">Most used</h2><span className="small-text subtle">{popular.length ? 'What people open most this month' : 'Pages people use most'}</span></div>
              {popular.length ? popular.map(m => <Link key={m.id} className="side-row" href={`/resources/${m.id}`}><Icon name={m.kind === 'howto' ? 'howto' : 'file'} size={14} /><span>{m.title}</span><Icon name="chevronRight" size={12} /></Link>)
                : familiar.map(f => <Link key={f.href} className="side-row" href={f.href}><Icon name="page" size={14} /><span>{f.label}</span><Icon name="chevronRight" size={12} /></Link>)}
            </section>
            <section className="panel side-card" aria-labelledby="bul-h">
              <div className="side-card-head row"><h2 id="bul-h">Bulletins</h2><Link className="small-text" href="/news?type=bulletin">All news</Link></div>
              {bulletins.length ? bulletins.map(b => <Link key={b.id} className="side-row stacked" href={`/resources/${b.id}`}><strong>{b.title}</strong>
                <span className="small-text subtle">{formatDate(b.updatedAt)}{b.section ? ` · ${sectionById(b.section)?.label}` : ''}</span></Link>)
                : <p className="side-empty subtle">No bulletins right now.</p>}
            </section>
          </aside>
        </div>

        <section aria-labelledby="new-h">
          <div className="section-title"><h2 id="new-h"><Icon name="sparkle" />New in the Library</h2><Link href="/search">Browse everything →</Link></div>
          {fresh.length ? <div className="pick-grid">{fresh.map(m => <Link key={m.id} className="pick-card" href={`/resources/${m.id}`}>
            <Thumbnail id={m.id} version={m.thumbnailVersion} format={m.format} title={m.title} rounded={0} />
            <span className="pick-body"><strong>{m.title}</strong><span className="small-text subtle">{m.kind === 'howto' ? 'How-to' : formatLabel(m.format)}{m.section ? ` · ${sectionLabel(m)}` : ''}</span></span></Link>)}</div>
            : <div className="panel empty inline"><p>New items appear here as they are published for you.</p></div>}
        </section>
      </>}
  </div>
}
