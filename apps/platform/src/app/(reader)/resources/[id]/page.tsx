import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { authenticatedLibrary } from '../../../../server/library'
export const dynamic = 'force-dynamic'
export default async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ citation?: string }> }) {
  const repository = await authenticatedLibrary(await headers())
  if (!repository) return <div className="empty"><h1>Sign-in required</h1><p>This resource requires an authorized account. Reader sign-in is being connected for this environment.</p><Link href="/">Back to library</Link></div>
  const item = await repository.get((await params).id, 'view')
  if (!item) notFound()
  const citation = (await searchParams).citation
  const evidence = citation ? item.evidence.find(e => e.id === citation && e.version === item.version) : undefined
  return <><Link className="back" href="/">← Content library</Link><p className="eyebrow">{item.format}</p><h1>{item.title}</h1><p className="intro">{item.description}</p>
    {citation && <section className="citation" aria-label="Cited evidence">{evidence ? <><strong>{evidence.locator}</strong><p>{evidence.text}</p></> : <p>This citation is unavailable or has been superseded. The current resource is shown below.</p>}</section>}
    <article className="reading">{item.body || 'A reader preview is not yet available for this resource.'}</article>
  </>
}
