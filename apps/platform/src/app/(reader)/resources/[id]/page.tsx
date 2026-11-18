import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { readerLibrary } from '../../../../server/library'
export const dynamic = 'force-dynamic'
export default async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ citation?: string }> }) {
  const { id } = await params
  const citation = (await searchParams).citation
  const returnTo = `/resources/${encodeURIComponent(id)}${citation ? `?${new URLSearchParams({ citation })}` : ''}`
  const { repository, signedIn } = await readerLibrary(await headers())
  if (!repository) return signedIn
    ? <div className="empty"><h1>Access not set up</h1><p>You&apos;re signed in, but this account doesn&apos;t have library access yet. Contact the library administrator.</p><Link href="/">Back to library</Link></div>
    : <div className="empty"><h1>Sign-in required</h1><p>This resource requires an authorized account.</p><a className="pill" href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</a></div>
  const item = await repository.get(id, 'view')
  if (!item) notFound()
  const evidence = citation ? item.evidence.find(e => e.id === citation && e.version === item.version) : undefined
  return <><Link className="back" href="/">← Content library</Link><p className="eyebrow">{item.format}</p><h1>{item.title}</h1><p className="intro">{item.description}</p>
    {item.vimeoId && <iframe className="media-preview" title={item.title} src={`https://player.vimeo.com/video/${item.vimeoId}?dnt=1`} allow="fullscreen; picture-in-picture" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin"/>}
    {item.previewAssetId && <iframe className="document-preview" title={`PDF: ${item.title}`} src={`/files/${item.previewAssetId}`} loading="lazy"/>}
    {item.downloadAssetIds?.map(id => <p key={id}><a href={`/files/${id}?download=1`}>Download original file {id}</a></p>)}
    {item.version === 'unprocessed' && <p className="notice">Searchable evidence is not ready for this resource yet. Its description may still be available.</p>}
    {citation && <section className="citation" aria-label="Cited evidence">{evidence ? <><strong>{evidence.locator}</strong><p>{evidence.text}</p></> : <p>This citation is unavailable or has been superseded. The current resource is shown below.</p>}</section>}
    <article className="reading">{item.body || 'A reader preview is not yet available for this resource.'}</article>
  </>
}
