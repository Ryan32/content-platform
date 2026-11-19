import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { readerLibrary } from '../../../../server/library'
import { FormatChip, formatDate, formatLabel } from '../../../../components/Format'
import Icon from '../../../../components/Icon'
import { Thumbnail } from '../../../../components/Thumbnail'
import CopyLink from '../../../../components/CopyLink'
import { Article, OnThisPage } from '../../../../components/Article'
import PdfViewer from '../../../../components/viewers/PdfViewer'
import VimeoViewer from '../../../../components/viewers/VimeoViewer'
import { FileMediaViewer, ImageViewer } from '../../../../components/viewers/MediaViewer'
import { Helpful, SaveButton } from '../../../../components/ReaderActions'
import PrintButton from '../../../../components/PrintButton'
import { parseMarkdown } from '../../../../domain/markdown'
import { AUDIENCES, LICENSING, LINES, PROGRAMS, TOPIC_OPTIONS, labelOf, sectionById, sectionHref, topicHref } from '../../../../domain/navigation'
import { REVIEW_WINDOWS } from '../../../../domain/review'
import { locatorPage, locatorSeconds, viewerFor } from '../../../../domain/viewers'
import type { Kit, Material } from '../../../../domain/library'
import { FilesPanel } from '../../../../components/FilesPanel'
export const dynamic = 'force-dynamic'

const topicName = (value: string) => TOPIC_OPTIONS.find(o => o.value === value)?.label.split(' — ')[1]

/** Resource and how-to article detail (designs: Resource, KB, ViewerPDF, ViewerVideo, ViewerOther). */
export default async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ citation?: string; t?: string; file?: string }> }) {
  const { id } = await params
  const query = await searchParams
  const citation = query.citation
  const returnTo = `/resources/${encodeURIComponent(id)}${citation ? `?${new URLSearchParams({ citation })}` : ''}`
  const { repository, signedIn } = await readerLibrary(await headers())
  if (!repository) return <section className="panel empty">
    <span className="empty-icon"><Icon name="lock" size={22} /></span>
    {signedIn ? <><h1>Access not set up</h1><p>You&apos;re signed in, but this account doesn&apos;t have library access yet. Contact the library administrator.</p><Link className="btn-ghost" href="/">Back to library</Link></>
      : <><h1>Sign in to open this resource</h1><p>This resource is available to authorized Advisors Excel accounts.</p><a className="btn-primary" href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</a></>}
  </section>
  // ?file= comes from a search hit inside one of this page's files: preview and highlight that file.
  const chosenFile = query.file && /^\d{1,10}$/.test(query.file) ? Number(query.file) : undefined
  const item = await repository.get(id, 'view', chosenFile ? { file: chosenFile } : undefined)
  if (!item) notFound()
  await repository.recordView(id)
  const evidence = citation ? item.evidence.find(e => e.id === citation && e.version === item.version) : undefined
  const downloads = item.downloadAssetIds ?? []
  const section = item.section ? sectionById(item.section) : undefined
  const howto = item.kind === 'howto'
  const path = `/resources/${encodeURIComponent(id)}`
  let related: Material[] = []; let kits: Kit[] = []; let saved: number[] = []
  try {
    ;[related, kits, saved] = await Promise.all([
      section ? repository.search('', undefined, 1, 'view', { ...(item.topics?.[0] ? { topic: item.topics[0] } : { section: section.id }), excludeKinds: ['news', 'bulletin'], sort: 'popular' }).then(r => r.items.filter(r => r.id !== item.id).slice(0, 6)) : Promise.resolve([]),
      repository.kits({ contentId: id }), repository.savedIds()])
  } catch { /* optional panels */ }
  const isSaved = saved.includes(Number(id))
  const inline = (item.inlineAssets ?? []).filter(a => a.id !== item.previewAssetId)
  const startAt = query.t && /^\d{1,6}$/.test(query.t) ? Number(query.t) : locatorSeconds(evidence?.locator)
  const blocks = howto ? parseMarkdown(item.body) : []
  const d = item.details ?? {}
  const facts: [string, React.ReactNode][] = [
    ['Audience', labelOf(AUDIENCES, item.audience)],
    ...(item.licensing?.length ? [['Licensing', item.licensing.map(l => labelOf(LICENSING, l)).join(' & ')] as [string, string]] : []),
    ...(item.lines?.length ? [['Line of business', item.lines.map(l => labelOf(LINES, l)).join(', ')] as [string, string]] : []),
    ...(item.program ? [['Program', labelOf(PROGRAMS, item.program)] as [string, string]] : []),
    ['Format', howto ? 'How-to article' : formatLabel(item.format)],
    ...(item.originalPublishedAt ? [['Published', formatDate(item.originalPublishedAt)] as [string, string]] : []),
    ['Updated', formatDate(item.updatedAt)],
    ...(d.owner ? [['Owner', d.owner] as [string, string]] : []),
    ...(d.lastReviewedAt ? [['Last reviewed', formatDate(d.lastReviewedAt)] as [string, string]] : []),
    ...(d.reviewWindow ? [['Review', REVIEW_WINDOWS.find(w => w.id === d.reviewWindow)?.label ?? ''] as [string, string]] : []),
  ]
  const detailsPanel = <section className="panel"><h2>Details</h2><dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
  const kitsPanel = kits.length > 0 && <section className="panel"><h2>Part of these kits</h2><ul className="plain-list">{kits.map(k => <li key={k.id}><Link href={`/kits/${k.id}`}><Icon name="kit" size={14} />{k.title}</Link></li>)}</ul></section>
  const relatedPanel = related.length > 0 && <section className="panel more-in"><h2>{item.topics?.[0] ? `More in ${topicName(item.topics[0])}` : section ? `More in ${section.label}` : 'Related'}</h2>
    <ul>{related.map(r => <li key={r.id}><Link className="related-row" href={`/resources/${r.id}`}><span className="related-thumb"><Thumbnail id={r.id} version={r.thumbnailVersion} format={r.format} title={r.title} rounded={6} compact /></span>
      <span><strong>{r.title}</strong><span className="small-text subtle">{r.kind === 'howto' ? 'How-to' : formatLabel(r.format)}</span></span></Link></li>)}</ul></section>
  const citationPanel = citation && <section className={`panel citation ${evidence ? '' : 'muted'}`} aria-label="Cited passage">
    <h2><Icon name="quote" />Cited passage{evidence ? ` · ${evidence.locator}` : ''}</h2>
    <p>{evidence ? evidence.text : 'This citation is no longer current. The resource may have been updated; the latest version is shown below.'}</p>
  </section>
  const trail = section && <p className="eyebrow"><Link href={sectionHref(section.id)}>{section.label}</Link>
    {item.topics?.[0] && <> / <Link href={topicHref(section.id, topicName(item.topics[0]) ?? '')}>{topicName(item.topics[0])}</Link></>}</p>
  const takeaways = (item.takeaways?.length ?? 0) > 0 && <section className="panel takeaways" aria-labelledby="tk-h">
    <h2 id="tk-h"><Icon name="sparkle" />Key takeaways <span className="chip chip-ok">Reviewed by an editor</span></h2>
    <ul>{item.takeaways!.map((t, i) => <li key={i}><Icon name="check" size={14} />{t}</li>)}</ul></section>

  if (howto) return <div className="kb-layout">
    <aside className="kb-rail" aria-label={section ? `More in ${section.label}` : 'Related'}>
      {section && <><p className="small-text subtle">{section.label}</p><h2>{item.topics?.[0] ? `More in ${topicName(item.topics[0])}` : `More in ${section.label}`}</h2>
        <nav className="seg small" aria-label="Type"><Link href={sectionHref(section.id)}>All</Link><Link href={`${sectionHref(section.id)}?type=howto`}>How-to</Link><Link href={`${sectionHref(section.id)}?type=resource`}>Resources</Link></nav></>}
      <ul>{related.map(r => <li key={r.id}><Link href={`/resources/${r.id}`}><Icon name={r.kind === 'howto' ? 'howto' : 'file'} size={14} /><span>{r.title}</span>{r.kind === 'howto' && <span className="chip chip-howto">How-to</span>}</Link></li>)}</ul>
      {section && <Link className="small-text" href={sectionHref(section.id)}>All of {section.label} →</Link>}
    </aside>
    <article className="kb-main">
      {trail}
      <h1>{item.title}</h1>
      {item.description && <p className="lead">{item.description}</p>}
      <p className="chip-line"><span className="chip chip-howto">How-to article</span>{item.lines?.map(l => <span key={l} className="chip chip-topic">{labelOf(LINES, l)}</span>)}
        <span className="small-text subtle">Updated {formatDate(item.updatedAt)}{d.owner ? ` by ${d.owner}` : ''}</span></p>
      {citationPanel}
      {blocks.length ? <Article blocks={blocks} path={path} /> : <p className="subtle">This article has no content yet.</p>}
      <Helpful id={item.id} />
    </article>
    <aside className="kb-side">
      <div className="kb-actions"><CopyLink path={path} /><SaveButton id={item.id} initial={isSaved} title={item.title} /><PrintButton /></div>
      <OnThisPage blocks={blocks} />
      <section className="panel"><h2>Page details</h2><dl className="facts">{facts.filter(([k]) => ['Owner', 'Last reviewed', 'Review', 'Audience'].includes(k)).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
      {kitsPanel}
    </aside>
  </div>

  const pdfPage = locatorPage(evidence?.locator) ?? 1
  return <>
    <div className="resource-head">
      {item.thumbnailVersion && <span className="resource-head-img"><Thumbnail id={item.id} version={item.thumbnailVersion} format={item.format} title={item.title} rounded={10} /></span>}
      <div className="detail-title">
        {trail}
        <p className="chip-line"><FormatChip format={item.format} />{section && <span className={`chip chip-section section-${section.id}`}>{section.label}</span>}
          {item.program && <span className="chip chip-topic">{labelOf(PROGRAMS, item.program)}</span>}{item.audience === 'client' && <span className="chip chip-client">Client-ready</span>}</p>
        <h1>{item.title}</h1>
        {item.description && <p className="lead">{item.description}</p>}
        <div className="head-actions">
          {downloads[0] && <a className="btn-primary" href={`/files/${downloads[0]}?download=1`}><Icon name="download" size={14} />Download</a>}
          <SaveButton id={item.id} initial={isSaved} title={item.title} />
          <CopyLink path={path} />
        </div>
      </div>
    </div>
    {item.version === 'unprocessed' && <p className="alert"><Icon name="info" />Citations aren&apos;t ready for this resource yet. Its summary and preview are still available.</p>}
    {citationPanel}

    <div className="detail-grid">
      <div className="detail-main">
        {takeaways}
        {item.vimeoId && <section className="panel media"><VimeoViewer vimeoId={item.vimeoId} hash={item.vimeoHash} title={item.title} start={startAt} path={path}
          passages={item.evidence.map(e => ({ id: e.id, locator: e.locator, text: e.text }))} /></section>}
        {(item.moreVideos ?? []).map((v, i) => <section key={v.vimeoId} className="panel media"><h2 className="small-heading">{v.title ?? `Video ${i + 2}`}</h2>
          <VimeoViewer vimeoId={v.vimeoId} hash={v.hash} title={v.title ?? item.title} path={path} passages={[]} /></section>)}
        {item.previewAssetId && <section className="panel media">{(item.files?.length ?? 0) > 1 && <h2 className="small-heading">{item.files!.find(f => f.id === item.previewAssetId)?.name}</h2>}
          <PdfViewer key={item.previewAssetId} src={`/files/${item.previewAssetId}`} title={item.title} initialPage={pdfPage} /></section>}
        {inline.map(asset => {
          const viewer = viewerFor(asset.mimeType)
          const src = `/files/${asset.id}`
          return <section key={asset.id} className="panel media">{viewer === 'image' ? <ImageViewer src={src} alt={item.title} />
            : viewer === 'audio' || viewer === 'video' ? <FileMediaViewer src={src} kind={viewer} title={item.title} start={startAt} transcript={item.evidence.map(e => ({ id: e.id, locator: e.locator, text: e.text }))} />
            : viewer === 'pdf' ? <PdfViewer src={src} title={item.title} /> : null}</section>
        })}
        {!item.vimeoId && !item.previewAssetId && !inline.length && downloads.length === 0 && item.body && <p className="subtle small-text">{(item.files?.length ?? 0) > 0
          ? <>A preview isn&apos;t available with your access. The full text is below.</>
          : <>There&apos;s no file to preview for this item yet. The full text is below.</>}</p>}
        {item.body && !item.vimeoId && <section className="panel"><h2>Full text</h2><article className="reading">{item.body}</article></section>}
        {(item.articleImages?.length ?? 0) > 0 && <section className="panel"><h2>Images in this article</h2><div className="article-images">
          {item.articleImages!.map(imageId => <a key={imageId} href={`/files/${imageId}`} target="_blank" rel="noreferrer"><img src={`/files/${imageId}`} alt="" loading="lazy" /></a>)}</div></section>}
      </div>
      <aside className="detail-side">
        {kitsPanel}
        {relatedPanel}
        {detailsPanel}
        <FilesPanel files={item.files ?? []} downloadable={downloads} previewing={item.previewAssetId} highlighted={chosenFile} path={path} />
      </aside>
    </div>
  </>
}
