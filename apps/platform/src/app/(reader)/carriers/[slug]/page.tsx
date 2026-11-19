import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Icon from '../../../../components/Icon'
import { formatLabel } from '../../../../components/Format'
import { LINES, labelOf } from '../../../../domain/navigation'
import { carrierGroups } from '../../../../domain/carriers'
import { readerLibrary } from '../../../../server/library'
import type { Carrier, Material } from '../../../../domain/library'
export const dynamic = 'force-dynamic'

/** Carrier page (design: Carriers). Everything tagged with the carrier, grouped by what the advisor needs to do. */
export default async function CarrierPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ line?: string }> }) {
  const { slug } = await params
  const wantedLine = (await searchParams).line
  const line = LINES.find(l => l.value === wantedLine)?.value
  const { repository, signedIn } = await readerLibrary(await headers())
  if (!repository) return <section className="panel empty"><span className="empty-icon"><Icon name="lock" size={22} /></span>
    <h1>{signedIn ? 'Access not set up' : 'Sign in to see this carrier'}</h1>{!signedIn && <a className="btn-primary" href={`/auth/login?returnTo=${encodeURIComponent(`/carriers/${slug}`)}`}>Sign in</a>}</section>
  const carriers = await repository.carriers()
  const carrier = carriers.find(c => c.slug === slug)
  if (!carrier) notFound()
  const { items } = await repository.search('', undefined, 1, 'view', { carrier: carrier.id, excludeKinds: ['news', 'bulletin'], pageSize: 200, ...(line ? { lines: [line] } : {}) })
  const updates = (await repository.search('', undefined, 1, 'view', { carrier: carrier.id, kinds: ['news', 'bulletin'], pageSize: 4 })).items
  const groups = carrierGroups(items)
  const quick = (topic: string) => items.find(i => i.topics?.includes(topic))
  const commission = quick('products:commission-schedules'); const sample = quick('operations:sample-applications')
  const others = carriers.filter(c => c.count > 0 || c.id === carrier.id).slice(0, 14)

  return <div className="carrier-layout">
    <aside className="carrier-rail" aria-label="Carriers">
      <nav>{others.map(c => <Link key={c.id} href={`/carriers/${c.slug}`} aria-current={c.id === carrier.id ? 'page' : undefined}><span>{c.name}</span><span className="subtle">{c.count}</span></Link>)}</nav>
      <Link className="small-text" href="/carriers">All carriers →</Link>
    </aside>
    <div className="carrier-main">
      <nav className="chip-row topic-row" aria-label="Line of business">
        <Link className="pill-link" href={`/carriers/${slug}`} aria-current={!line ? 'page' : undefined}>All</Link>
        {LINES.filter(l => carrier.lines.includes(l.value)).map(l => <Link key={l.value} className="pill-link" href={`/carriers/${slug}?line=${l.value}`} aria-current={line === l.value ? 'page' : undefined}>{l.label}</Link>)}
      </nav>
      <section className="panel carrier-head">
        <span className="carrier-logo large">{carrier.logoText}</span>
        <div><h1>{carrier.name}</h1>
          <p className="chip-line">{carrier.lines.map(l => <span key={l} className="chip chip-topic">{labelOf(LINES, l)}</span>)}</p>
          <p className="small-text subtle">{items.length} {items.length === 1 ? 'resource' : 'resources'}, grouped by what you need to do{carrier.summary ? ` · ${carrier.summary}` : ''}</p></div>
        <span className="viewer-spacer" />
        {commission && <Link className="btn-primary" href={`/resources/${commission.id}`}><Icon name="file" size={14} />Commission schedule</Link>}
        {sample && <Link className="btn-ghost" href={`/resources/${sample.id}`}><Icon name="file" size={14} />Sample application</Link>}
      </section>
      {items.length === 0 ? <section className="panel empty inline"><h2>Nothing for {carrier.name} yet</h2><p>Items appear here when editors tag them with this carrier.</p></section>
        : <div className="carrier-groups">{groups.map(g => <section key={g.id} className="panel carrier-box" aria-labelledby={`g-${g.id}`}>
          <h2 id={`g-${g.id}`}>{g.label} <span className="subtle">{g.items.length}</span></h2>
          <ul>{g.items.map(m => <li key={m.id}><Link href={`/resources/${m.id}`}><Icon name={m.kind === 'howto' ? 'howto' : 'file'} size={14} />
            <span><strong>{m.title}</strong><span className="small-text subtle">{m.kind === 'howto' ? 'How-to' : formatLabel(m.format)}{m.lines?.length ? ` · ${m.lines.map(l => labelOf(LINES, l)).join(', ')}` : ''}</span></span></Link></li>)}</ul>
        </section>)}</div>}
      {updates.length > 0 && <section className="panel carrier-box"><h2>Related updates</h2><ul>{updates.map((u: Material) => <li key={u.id}><Link href={`/resources/${u.id}`}><Icon name="news" size={14} /><span><strong>{u.title}</strong></span></Link></li>)}</ul></section>}
    </div>
  </div>
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: `${(await params).slug.replace(/-/g, ' ')} | Carriers | AE Library` }
}
export type { Carrier }
