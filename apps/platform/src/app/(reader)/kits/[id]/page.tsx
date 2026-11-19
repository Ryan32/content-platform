import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Icon from '../../../../components/Icon'
import { ResourceGrid } from '../../../../components/ResourceGrid'
import { sectionById, sectionHref } from '../../../../domain/navigation'
import { readerLibrary } from '../../../../server/library'
export const dynamic = 'force-dynamic'

/** A ready-made kit: everything for one job. Only the items the reader can open are listed. */
export default async function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id)) notFound()
  const { repository, signedIn } = await readerLibrary(await headers())
  if (!repository) return <section className="panel empty"><span className="empty-icon"><Icon name="lock" size={22} /></span>
    <h1>{signedIn ? 'Access not set up' : 'Sign in to open this kit'}</h1>{!signedIn && <a className="btn-primary" href={`/auth/login?returnTo=/kits/${id}`}>Sign in</a>}</section>
  const [kit] = await repository.kits({ id })
  if (!kit) notFound()
  const saved = await repository.savedIds()
  const section = kit.section ? sectionById(kit.section) : undefined
  return <>
    <div className="page-head section-head"><span className="section-icon"><Icon name="kit" size={22} /></span>
      <div>{section && <p className="eyebrow"><Link href={sectionHref(section.id)}>{section.label}</Link> · Ready-made kit</p>}
        <h1>{kit.title}</h1>{kit.description && <p className="subtle">{kit.description}</p>}<p className="small-text subtle">{kit.items.length} items</p></div></div>
    <section className="panel"><ResourceGrid items={kit.items} saved={saved} /></section>
  </>
}
