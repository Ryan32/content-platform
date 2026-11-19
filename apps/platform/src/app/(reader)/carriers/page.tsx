import { headers } from 'next/headers'
import Link from 'next/link'
import Icon from '../../../components/Icon'
import { LINES, labelOf } from '../../../domain/navigation'
import { readerLibrary } from '../../../server/library'
import type { Carrier } from '../../../domain/library'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Carriers A–Z | AE Library' }

/** Carriers A–Z: every carrier with a page, filterable by line of business. */
export default async function CarriersIndex({ searchParams }: { searchParams: Promise<{ line?: string }> }) {
  const wantedLine = (await searchParams).line
  const line = LINES.find(l => l.value === wantedLine)?.value
  let carriers: Carrier[] = []; let repository = null; let signedIn = false
  try { ({ repository, signedIn } = await readerLibrary(await headers())); if (repository) carriers = await repository.carriers() } catch { /* shown as empty */ }
  const shown = carriers.filter(c => !line || c.lines.includes(line))
  const groups = new Map<string, Carrier[]>()
  for (const c of shown) { const k = /[a-z]/i.test(c.name[0]) ? c.name[0].toUpperCase() : '#'; groups.set(k, [...(groups.get(k) ?? []), c]) }
  return <>
    <div className="page-head section-head"><span className="section-icon section-products"><Icon name="products" size={22} /></span>
      <div><p className="eyebrow"><Link href="/sections/products">Products &amp; Carriers</Link></p><h1>Carriers A–Z</h1><p className="subtle">Everything for a carrier on one page: pay and product, applications, service, underwriting and how-tos.</p></div></div>
    <nav className="chip-row topic-row" aria-label="Line of business">
      <Link className="pill-link" href="/carriers" aria-current={!line ? 'page' : undefined}>All</Link>
      {LINES.map(l => <Link key={l.value} className="pill-link" href={`/carriers?line=${l.value}`} aria-current={line === l.value ? 'page' : undefined}>{l.label}</Link>)}
    </nav>
    {!repository ? <section className="panel empty"><span className="empty-icon"><Icon name={signedIn ? 'lock' : 'library'} size={22} /></span>
      <h2>{signedIn ? 'Your account doesn’t have library access yet' : 'Sign in to see carriers'}</h2>{!signedIn && <a className="btn-primary" href="/auth/login?returnTo=%2Fcarriers">Sign in</a>}</section>
      : shown.length === 0 ? <section className="panel empty inline"><h2>No carriers yet</h2><p>Editors add carriers under Library → Carriers in the admin, then tag items with them.</p></section>
      : <section className="panel carrier-index">{[...groups.entries()].map(([letter, list]) => <div key={letter} className="carrier-group">
        <h2>{letter}</h2>
        <div className="carrier-grid">{list.map(c => <Link key={c.id} className="carrier-tile" href={`/carriers/${c.slug}`}>
          <span className="carrier-logo">{c.logoText}</span>
          <span><strong>{c.name}</strong><span className="small-text subtle">{c.lines.map(l => labelOf(LINES, l)).join(' · ') || 'Carrier'} · {c.count} {c.count === 1 ? 'item' : 'items'}</span></span></Link>)}</div>
      </div>)}</section>}
  </>
}
