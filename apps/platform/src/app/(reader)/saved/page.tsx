import { headers } from 'next/headers'
import Icon from '../../../components/Icon'
import { ResultRow } from '../../../components/ResultRow'
import { readerLibrary } from '../../../server/library'
import type { Material } from '../../../domain/library'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Saved | AE Library' }

/** The reader's saved items. Items they can no longer open drop out automatically. */
export default async function SavedPage() {
  const { repository, signedIn } = await readerLibrary(await headers())
  let items: Material[] = []; let ids: number[] = []
  if (repository) { ids = await repository.savedIds(); if (ids.length) items = (await repository.search('', undefined, 1, 'view', { ids, pageSize: 200 })).items }
  return <>
    <div className="page-head"><div><h1>Saved</h1><p className="subtle">Items you bookmarked. Use the bookmark on any card or resource to add more.</p></div></div>
    {!repository ? <section className="panel empty"><span className="empty-icon"><Icon name="lock" size={22} /></span><h2>{signedIn ? 'Access not set up' : 'Sign in to see saved items'}</h2>
      {!signedIn && <a className="btn-primary" href="/auth/login?returnTo=%2Fsaved">Sign in</a>}</section>
      : items.length === 0 ? <section className="panel empty inline"><Icon name="bookmark" size={22} /><h2>Nothing saved yet</h2><p>Tap the bookmark on anything you want to find again.</p></section>
      : <section className="panel"><div className="result-list">{items.map(m => <ResultRow key={m.id} item={m} saved />)}</div></section>}
  </>
}
