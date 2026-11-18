import Link from 'next/link'
import { notFound } from 'next/navigation'
import Icon from '../../../../components/Icon'
import { searchHref, sectionById } from '../../../../domain/navigation'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const section = sectionById((await params).id)
  return { title: section ? `${section.label} | AE Library` : 'AE Library' }
}

/**
 * Section landing page. Topics and familiar pages currently open a ranked library search for that name; once items are
 * filed into sections (design handoff phase 1) this page lists them directly with type and audience filters.
 */
export default async function SectionPage({ params }: { params: Promise<{ id: string }> }) {
  const section = sectionById((await params).id)
  if (!section) notFound()
  return <>
    <div className="page-head section-head">
      <span className={`section-icon section-${section.id}`}><Icon name={section.icon} size={22} /></span>
      <div><h1>{section.label}</h1><p className="subtle">{section.blurb}</p></div>
    </div>
    <section className="panel" aria-labelledby="topics-h">
      <h2 id="topics-h">Topics</h2>
      <div className="topic-grid">{section.topics.map(t => <Link key={t} className="topic-card" href={searchHref(t)}>
        <span>{t}</span><Icon name="chevronRight" size={14} /></Link>)}</div>
    </section>
    <section className="panel" aria-labelledby="familiar-h">
      <h2 id="familiar-h">Pages you know</h2>
      <p className="subtle">The names advisors know from the previous resource site.</p>
      <div className="chip-row">{section.familiar.map(f => <Link key={f} className="pill-link" href={searchHref(f)}>{f}</Link>)}</div>
    </section>
  </>
}
