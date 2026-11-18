import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { readerLibrary } from '../../../../server/library'
import { FormatChip, formatDate, formatLabel } from '../../../../components/Format'
import Icon from '../../../../components/Icon'
import { Thumbnail } from '../../../../components/Thumbnail'
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

  return <>
    <div className="page-head detail-head">
      <Link className="back-link" href="/" aria-label="Back to content library"><Icon name="back" size={18} /></Link>
      <div><h1>{item.title}</h1><p className="subtle">{formatLabel(item.format)} · Updated {formatDate(item.updatedAt)}</p></div>
    </div>

    {item.version === 'unprocessed' && <p className="alert"><Icon name="info" />Citations aren&apos;t ready for this resource yet. Its summary and preview are still available.</p>}
    {citation && <section className={`panel citation ${evidence ? '' : 'muted'}`} aria-label="Cited passage">
      <h2><Icon name="quote" />Cited passage{evidence ? ` · ${evidence.locator}` : ''}</h2>
      <p>{evidence ? evidence.text : 'This citation is no longer current. The resource may have been updated; the latest version is shown below.'}</p>
    </section>}

    <div className="detail-grid">
      <div className="detail-main">
        {!item.vimeoId && !item.previewAssetId && item.thumbnailVersion && <section className="panel media"><Thumbnail id={item.id} version={item.thumbnailVersion} format={item.format} title={item.title} ratio="21 / 9" rounded={0} /></section>}
        {item.description && <section className="panel"><h2>Summary</h2><p className="lead">{item.description}</p></section>}
        {item.vimeoId && <section className="panel media"><iframe className="media-preview" title={item.title} src={`https://player.vimeo.com/video/${item.vimeoId}?dnt=1`}
          allow="fullscreen; picture-in-picture" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" /></section>}
        {item.previewAssetId && <section className="panel media"><iframe className="document-preview" title={`PDF: ${item.title}`} src={`/files/${item.previewAssetId}`} loading="lazy" /></section>}
        <section className="panel"><h2>Full text</h2>
          {item.body ? <article className="reading">{item.body}</article> : <p className="subtle">A text version isn&apos;t available for this resource yet.</p>}</section>
      </div>
      <aside className="detail-side">
        <section className="panel"><h2>Resource information</h2>
          <dl className="facts">
            <div><dt>Format</dt><dd><FormatChip format={item.format} /></dd></div>
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
      </aside>
    </div>
  </>
}
