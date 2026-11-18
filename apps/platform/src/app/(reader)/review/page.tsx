import { headers } from 'next/headers'
import Link from 'next/link'
import { editorContext } from '../../../server/editor'
export const dynamic = 'force-dynamic'
export default async function Reviews() {
  const ctx = await editorContext(await headers())
  if (!ctx) return <div className="empty"><h1>Editor access required</h1><a href="/auth/login?returnTo=%2Freview">Sign in</a></div>
  const result = await ctx.payload.find({ collection: 'suggestions', user: ctx.user, overrideAccess: false, depth: 0, limit: 100,
    sort: '-createdAt', where: { decision: { equals: 'pending' } } })
  return <><h1>Review AI suggestions</h1><p>Suggestions never publish content or change audience access. Review the supporting evidence before applying.</p>
    {result.docs.length ? <ul>{result.docs.map(doc => <li key={doc.id}><Link href={`/review/${doc.id}`}>Review proposal {doc.id}</Link> · {doc.model}</li>)}</ul>
      : <div className="empty"><h2>No pending proposals</h2><p>Completed analysis jobs will appear here for review.</p></div>}
    {result.hasNextPage && <p>Showing the newest 100 proposals. Additional pending items are available in <Link href="/admin/collections/suggestions">the admin list</Link>.</p>}
  </>
}
