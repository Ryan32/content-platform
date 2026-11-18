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
import { FileMediaViewer, ImageViewer } from '../../../../components/viewers/MediaViewer'
import { parseMarkdown } from '../../../../domain/markdown'
import { sectionById, sectionHref } from '../../../../domain/navigation'
import { locatorPage, locatorSeconds, viewerFor } from '../../../../domain/viewers'
import type { Material } from '../../../../domain/library'
export const dynamic = 'force-dynamic'

export default async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ citation?: string }> }) {
  const { id } = await params
  const citation = (await searchParams).citation
  const returnTo = `/resources/${encodeURIComponent(id)}${citation ? `?${new URLSearchParams({ citation })}` : ''}`
  const { repository, signedIn } = await readerLibrary(await headers())
  if (!repository) return <section className="panel empty">
    <span className="empty-icon"><Icon name="lock" size={22} /></span>
    {signedIn ? <><h1>Access not set up</h1><p>You&apos;re signed in, but this account doesn&apos;t have library access yet. Contact the library administrator.</p><Link className="btn-ghost" href="/">Back to library</Link></>
      : <><h1>Sign in to open this resource</h1><p>This resource is available to authorized Advisors Excel accounts.</p><a className="btn-primary" href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</a></>}
  </section>
  const item = await repository.get(id, 'view')
  if (!item) notFound()
  const evidence = citation ? item.evidence.find(e => e.id === citation && e.version === item.version) : undefined
  const downloads = item.downloadAssetIds ?? []
  const section = item.section ? sectionById(item.section) : undefined
  const howto = item.kind === 'howto'
  const path = `/resources/${encodeURIComponent(id)}`
  let related: Material[] = []
  try { if (section) related = (await repository.search('', undefined, 1, 'view', { section: section.id })).items.filter(r => r.id !== item.id).slice(0, 5) } catch { /* optional */ }
  const inline = (item.inlineAssets ?? []).filter(a => a.id !== item.previewAssetId)
  const startAt = locatorSeconds(evidence?.locator)
  const blocks = howto ? parseMarkdown(item.body) : []

  const head = <div className="page-head detail-head">
    <Link className="back-link" href={section ? sectionHref(section.id) : '/'} aria-label={section ? `Back to ${section.label}` : 'Back to content library'}><Icon name="back" size={18} /></Link>
    <div className="detail-title">
      {section && <p className="eyebrow"><Link href={sectionHref(section.id)}>{section.label}</Link></p>}
      <h1>{item.title}</h1>
      <p className="subtle">{howto ? <span className="chip chip-howto">How-to</span> : <FormatChip format={item.format} />} · Updated {formatDate(item.updatedAt)}</p>
    </div>
    <CopyLink path={path} />
  </div>
  const citationPanel = citation && <section className={`panel citation ${evidence ? '' : 'muted'}`} aria-label="Cited passage">
    <h2><Icon name="quote" />Cited passage{evidence ? ` · ${evidence.locator}` : ''}</h2>
    <p>{evidence ? evidence.text : 'This citation is no longer current. The resource may have been updated; the latest version is shown below.'}</p>
  </section>
  const moreIn = section && related.length > 0 && <section className="panel more-in"><h2>More in {section.label}</h2>
    <ul>{related.map(r => <li key={r.id}><Link href={`/resources/${r.id}`}>{r.title}</Link><span className="subtle small-text">{r.kind === 'howto' ? 'How-to' : formatLabel(r.format)}</span></li>)}</ul></section>

  if (howto) return <>
    {head}
    {citationPanel}
    <div className="detail-grid">
      <div className="detail-main">
        <section className="panel">{item.description && <p className="lead">{item.description}</p>}
          {blocks.length ? <Article blocks={blocks} path={path} /> : <p className="subtle">This article has no content yet.</p>}</section>
      </div>
      <aside className="detail-side sticky-side"><OnThisPage blocks={blocks} />{moreIn}</aside>
    </div>
  </>

  return <>
    {head}
    {item.version === 'unprocessed' && <p className="alert"><Icon name="info" />Citations aren&apos;t ready for this resource yet. Its summary and preview are still available.</p>}
    {citationPanel}

    <div className="detail-grid">
      <div className="detail-main">
        {!item.vimeoId && !item.previewAssetId && !inline.length && item.thumbnailVersion && <section className="panel media"><Thumbnail id={item.id} version={item.thumbnailVersion} format={item.format} title={item.title} ratio="21 / 9" rounded={0} /></section>}
        {item.vimeoId && <section className="panel media"><iframe className="media-preview" title={item.title} src={`https://player.vimeo.com/video/${item.vimeoId}?dnt=1${startAt ? `#t=${startAt}s` : ''}`}
          allow="fullscreen; picture-in-picture" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" /></section>}
        {item.previewAssetId && <section className="panel media"><PdfViewer src={`/files/${item.previewAssetId}`} title={item.title} initialPage={locatorPage(evidence?.locator) ?? 1} /></section>}
        {inline.map(asset => {
          const viewer = viewerFor(asset.mimeType)
          const src = `/files/${asset.id}`
          return <section key={asset.id} className="panel media">{viewer === 'image' ? <ImageViewer src={src} alt={item.title} />
            : viewer === 'audio' || viewer === 'video' ? <FileMediaViewer src={src} kind={viewer} title={item.title} start={startAt} />
            : viewer === 'pdf' ? <PdfViewer src={src} title={item.title} /> : null}</section>
        })}
        {item.description && <section className="panel"><h2>Summary</h2><p className="lead">{item.description}</p></section>}
        <section className="panel"><h2>Full text</h2>
          {item.body ? <article className="reading">{item.body}</article> : <p className="subtle">A text version isn&apos;t available for this resource yet.</p>}</section>
      </div>
      <aside className="detail-side">
        <section className="panel"><h2>Resource information</h2>
          <dl className="facts">
            <div><dt>Format</dt><dd><FormatChip format={item.format} /></dd></div>
            {section && <div><dt>Section</dt><dd><Link href={sectionHref(section.id)}>{section.label}</Link></dd></div>}
            <div><dt>Last updated</dt><dd>{formatDate(item.updatedAt)}</dd></div>
            <div><dt>Citable passages</dt><dd>{item.evidence.length || '—'}</dd></div>
          </dl>
        </section>
        <section className="panel"><h2>Files</h2>
          {downloads.length ? <ul className="files">{downloads.map((assetId, i) => <li key={assetId}>
            <span className="file-icon"><Icon name="file" /></span><span className="file-name">Original file{downloads.length > 1 ? ` ${i + 1}` : ''}</span>
            <a className="btn-ghost small" href={`/files/${assetId}?download=1`}><Icon name="download" size={14} />Download</a></li>)}</ul>
            : <p className="subtle">Downloads aren&apos;t included with your access to this resource.</p>}
        </section>
        {moreIn}
      </aside>
    </div>
  </>
}
