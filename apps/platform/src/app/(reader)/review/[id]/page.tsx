import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { editorContext } from '../../../../server/editor'
import { proposalEnvelope, taxonomyUnchanged } from '../../../../processing/review'
export const dynamic = 'force-dynamic'
export default async function Review({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await editorContext(await headers())
  if (!ctx) return <div className="empty"><h1>Editor access required</h1><a href="/auth/login?returnTo=%2Freview">Sign in</a></div>
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const doc = (await ctx.payload.find({ collection: 'suggestions', user: ctx.user, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: Number(id) } } })).docs[0]
  if (!doc) notFound()
  const parsed = proposalEnvelope.safeParse(doc.proposal)
  if (!parsed.success) return <div className="empty"><h1>Proposal needs investigation</h1><p>This proposal does not match the current review format. No changes have been applied.</p></div>
  const contentId = typeof doc.content === 'number' ? doc.content : doc.content.id
  const content = await ctx.payload.findByID({ collection: 'content', id: contentId, user: ctx.user, overrideAccess: false, depth: 0 })
  const { extraction, proposal, taxonomyIds } = parsed.data
  const terms = await ctx.payload.find({ collection: 'taxonomy', user: ctx.user, overrideAccess: false, depth: 0, pagination: false, where: { id: { in: taxonomyIds } } })
  const stale = content.sourceHash !== doc.sourceVersion || Boolean(parsed.data.sourceVimeoId && parsed.data.sourceVimeoId !== content.vimeoId)
    || !taxonomyUnchanged(parsed.data, terms.docs, parsed.data.taxonomyIds)
  return <><h1>Review: {content.title}</h1><p>Current summary: {content.description || 'None'}</p>
    <p>Current tags: {(content.acceptedTags ?? []).map(t => typeof t === 'number' ? t : t.id).join(', ') || 'None'}</p>
    {[...extraction.warnings, ...proposal.warnings].map((warning, i) => <p key={i} className="notice">{warning}</p>)}
    {stale && <p role="alert">The source or taxonomy has changed. Run analysis for the current version before reviewing.</p>}
    {stale && doc.decision === 'pending' && <form method="post" action={`/review/${doc.id}/decision`}>
      <input type="hidden" name="decision" value="rejected"/><input type="hidden" name="summary" value=""/>
      <input type="hidden" name="expectedUpdatedAt" value={content.updatedAt}/><input type="hidden" name="note" value="Rejected superseded source/taxonomy proposal"/>
      <button type="submit">Reject superseded proposal</button>
    </form>}
    <p>Captured taxonomy: {parsed.data.taxonomyVersion}</p>
    <section className="reading"><h2>Suggested takeaways</h2>{proposal.takeaways.map((t, i) => <p key={i}>{t.text} <small>Evidence: {t.evidenceIds.join(', ')}</small></p>)}
      <h2>Tag evidence</h2>{proposal.tags.map(t => <p key={t.termId}>{parsed.data.taxonomy.find(term => term.id === t.termId)?.label ?? t.termId}: {t.evidenceIds.join(', ')} · confidence {Math.round(t.confidence * 100)}%</p>)}</section>
    {doc.decision === 'pending' && !stale ? <form method="post" action={`/review/${doc.id}/decision`} className="review-form">
      <input type="hidden" name="expectedUpdatedAt" value={content.updatedAt}/>
      <label>Summary<textarea name="summary" maxLength={2000} defaultValue={proposal.summary} rows={6}/></label>
      <fieldset><legend>Descriptive tags (no access changes)</legend>{terms.docs.map(t => <label key={t.id}><input type="checkbox" name="tags" value={t.id} defaultChecked={proposal.tags.some(p => p.termId === t.id)}/>{t.label}</label>)}</fieldset>
      <label>Review note<textarea name="note" maxLength={2000}/></label>
      <p>Accepting replaces the summary, tags and extracted evidence with this reviewed version, and moves the record to draft for separate publication approval.</p>
      <button name="decision" value="accepted">Apply reviewed values to draft</button> <button name="decision" value="rejected">Reject proposal</button>
    </form> : <p>Decision: {doc.decision}. {doc.reviewNote}</p>}
    <h2>Source evidence</h2>{extraction.passages.map(p => <details key={p.id}><summary>{p.locator} · {p.id}</summary><p className="reading">{p.text}</p></details>)}
  </>
}
