import type { AdminViewServerProps, Payload } from 'payload'
import { AdminPage, muted, panel } from './AdminPage'
import { proposalEnvelope, taxonomyUnchanged } from '../processing/review'
import { Thumbnail } from './Thumbnail'

const ERRORS: Record<string, string> = {
  conflict: 'The decision could not be applied: the item or suggestion changed since you opened it. Review the current state below before trying again.',
  invalid: 'The review form was incomplete. Check the summary and try again.',
}
const STATUS: Record<string, [string, string]> = { intake: ['Intake', 'ae-pill'], draft: ['Draft', 'ae-pill ae-pill--warn'], published: ['Published', 'ae-pill ae-pill--ok'], archived: ['Archived', 'ae-pill'] }
const field: React.CSSProperties = { width: '100%', padding: 10, borderRadius: 4, border: '1px solid var(--theme-elevation-150)', background: 'var(--theme-input-bg)', color: 'var(--theme-text)', font: 'inherit' }
const when = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago' })
const relId = (value: unknown) => typeof value === 'object' && value && 'id' in value ? Number((value as { id: unknown }).id) : Number(value)

/** Admin views /admin/review (list) and /admin/review/:id (one suggestion). Decisions post to /review/:id/decision. */
export default async function ReviewView(props: AdminViewServerProps) {
  const segments = ((await props.params) as { segments?: string[] } | undefined)?.segments ?? []
  const id = segments[1]
  const search = (await props.searchParams) as Record<string, string | undefined> | undefined
  const { payload, user } = props.initPageResult.req
  return AdminPage({ props, title: 'Review AI suggestions', children: () => id ? detail(payload, user, id, search?.error) : list(payload, user) })
}

async function list(payload: Payload, user: unknown) {
  const [pending, recent] = await Promise.all([
    payload.find({ collection: 'suggestions', user: user as never, overrideAccess: false, depth: 1, limit: 100, sort: 'createdAt', where: { decision: { equals: 'pending' } } }),
    payload.find({ collection: 'suggestions', user: user as never, overrideAccess: false, depth: 1, limit: 10, sort: '-reviewedAt', where: { decision: { not_equals: 'pending' } } }),
  ])
  const title = (doc: { content?: unknown }) => typeof doc.content === 'object' && doc.content && 'title' in doc.content ? String((doc.content as { title: string }).title) : 'Library item'
  return <>
    <h1>Review AI suggestions</h1>
    <p style={{ maxWidth: 820 }}>Each suggestion is a proposed summary and tags for one library item, with the passages that support it. Accepting copies the extracted text and your edited summary and tags into the item and moves it to Draft. It never publishes the item or changes who can see it. Oldest first.</p>
    <h2>Waiting ({pending.totalDocs})</h2>
    {pending.docs.length ? <div style={{ display: 'grid', gap: 10, maxWidth: 900 }}>{pending.docs.map(doc => {
      const c = typeof doc.content === 'object' && doc.content ? doc.content as { id: number; format?: string; thumbnailVersion?: string | null } : null
      return <a key={doc.id} href={`/admin/review/${doc.id}`} style={{ ...panel, display: 'flex', gap: 14, alignItems: 'center', textDecoration: 'none', color: 'inherit', padding: 10 }}>
        <span style={{ width: 120, flex: 'none' }}><Thumbnail id={c?.id ?? 0} version={c?.thumbnailVersion} format={c?.format ?? 'document'} title={title(doc)} rounded={6} /></span>
        <span><strong>{title(doc)}</strong><br /><span style={muted}>Suggested {when(doc.createdAt)} · {doc.model}</span></span></a>
    })}</div>
      : <p style={muted}>Nothing is waiting. New suggestions appear after a file or Vimeo video is processed and AI tagging finishes.</p>}
    {recent.docs.length > 0 && <section className="ae-card" style={{ maxWidth: 900, marginTop: 24 }}><h3>Recently decided</h3><ul className="ae-rows">{recent.docs.map(doc => <li key={doc.id}>
      <a href={`/admin/review/${doc.id}`}>{title(doc)}</a><span><span className={doc.decision === 'accepted' ? 'ae-pill ae-pill--ok' : 'ae-pill'}>{doc.decision === 'accepted' ? 'Accepted' : 'Rejected'}</span> <span className="ae-muted">{doc.reviewedAt ? when(doc.reviewedAt) : ''}</span></span></li>)}</ul></section>}
  </>
}

async function detail(payload: Payload, user: unknown, id: string, error?: string) {
  if (!/^\d+$/.test(id)) return <><h1>Suggestion not found</h1><a href="/admin/review">Back to Review</a></>
  const doc = (await payload.find({ collection: 'suggestions', user: user as never, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: Number(id) } } })).docs[0]
  if (!doc) return <><h1>Suggestion not found</h1><a href="/admin/review">Back to Review</a></>
  const parsed = proposalEnvelope.safeParse(doc.proposal)
  if (!parsed.success) return <><h1>Suggestion needs investigation</h1><p>This suggestion does not match the current review format. No changes have been applied.</p></>
  const contentId = relId(doc.content)
  const content = await payload.findByID({ collection: 'content', id: contentId, user: user as never, overrideAccess: false, depth: 0 })
  const { extraction, proposal, taxonomyIds, taxonomy } = parsed.data
  const currentTagIds = (content.acceptedTags ?? []).map(relId)
  const terms = await payload.find({ collection: 'taxonomy', user: user as never, overrideAccess: false, depth: 0, pagination: false, where: { id: { in: [...new Set([...taxonomyIds, ...currentTagIds])] } } })
  const label = (termId: number) => terms.docs.find(t => t.id === termId)?.label ?? taxonomy.find(t => t.id === termId)?.label ?? `Tag ${termId}`
  const offered = terms.docs.filter(t => taxonomyIds.includes(t.id))
  const stale = content.sourceHash !== doc.sourceVersion || Boolean(parsed.data.sourceVimeoId && parsed.data.sourceVimeoId !== content.vimeoId)
    || !taxonomyUnchanged(parsed.data, terms.docs, taxonomyIds)
  const warnings = [...extraction.warnings, ...proposal.warnings]
  const passage = (pid: string) => extraction.passages.find(p => p.id === pid)?.locator ?? pid

  return <>
    <p style={muted}><a href="/admin/review">← Review</a></p>
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <span style={{ width: 160, flex: 'none' }}><Thumbnail id={contentId} version={content.thumbnailVersion} format={content.format} title={content.title} rounded={8} /></span>
      <div><h1 style={{ marginBottom: 4 }}>{content.title}</h1>
        <p style={muted}><span className={(STATUS[content.state ?? 'intake'] ?? STATUS.intake)[1]}>{(STATUS[content.state ?? 'intake'] ?? STATUS.intake)[0]}</span> · <a href={`/admin/collections/content/${contentId}`}>Open library item</a> · suggested {when(doc.createdAt)} by {doc.model}</p></div>
    </div>
    {error && <p role="alert" className="ae-notice ae-notice--fail">{ERRORS[error] ?? 'The decision could not be applied.'}</p>}
    {warnings.map((w, i) => <p key={i} className="ae-notice ae-notice--warn">{w}</p>)}
    {stale && <p role="alert" className="ae-notice ae-notice--warn">The item&apos;s file, Vimeo ID, or tags changed after this suggestion was made, so it can&apos;t be accepted. A new suggestion is created automatically for the current version.</p>}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, margin: '16px 0' }}>
      <section style={panel}><h3 style={{ marginTop: 0 }}>Current</h3>
        <p><strong>Summary</strong><br />{content.description || <span style={muted}>None</span>}</p>
        <p><strong>Tags</strong><br />{currentTagIds.length ? currentTagIds.map(label).join(', ') : <span style={muted}>None</span>}</p></section>
      <section style={panel}><h3 style={{ marginTop: 0 }}>Suggested</h3>
        <p><strong>Summary</strong><br />{proposal.summary}</p>
        <p><strong>Tags</strong><br />{proposal.tags.length ? proposal.tags.map(t => `${label(t.termId)} (${Math.round(t.confidence * 100)}%)`).join(', ') : <span style={muted}>None</span>}</p>
        {proposal.takeaways.length > 0 && <><strong>Key takeaways</strong><ul>{proposal.takeaways.map((t, i) => <li key={i}>{t.text} <span style={muted}>— {t.evidenceIds.map(passage).join(', ')}</span></li>)}</ul></>}</section>
    </div>

    {doc.decision === 'pending' && !stale ? <form method="post" action={`/review/${doc.id}/decision`} style={{ ...panel, maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>Your decision</h3>
      <input type="hidden" name="expectedUpdatedAt" value={content.updatedAt} />
      <label style={{ display: 'block', marginBottom: 12 }}><strong>Summary</strong><span style={muted}> — edit as needed</span>
        <textarea name="summary" maxLength={2000} defaultValue={proposal.summary} rows={5} style={field} /></label>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}><legend><strong>Tags</strong><span style={muted}> — descriptive only; tags never change who can see the item</span></legend>
        {offered.map(t => { const p = proposal.tags.find(x => x.termId === t.id)
          return <label key={t.id} style={{ display: 'block', margin: '4px 0' }}><input type="checkbox" name="tags" value={t.id} defaultChecked={Boolean(p)} /> {t.label}
            {p && <span style={muted}> · suggested ({Math.round(p.confidence * 100)}%, from {p.evidenceIds.map(passage).join(', ')})</span>}</label> })}</fieldset>
      <label style={{ display: 'block', marginBottom: 12 }}><strong>Note</strong><span style={muted}> — optional, kept with the decision</span>
        <textarea name="note" maxLength={2000} rows={2} style={field} /></label>
      <p style={muted}>Accept installs the extracted text as the item&apos;s reading text and citations, applies this summary and these tags, and moves the item to Draft for an administrator to publish.</p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="ae-btn ae-btn--primary" name="decision" value="accepted">Accept and apply to draft</button>
        <button className="ae-btn ae-btn--secondary" name="decision" value="rejected">Reject</button>
      </div>
    </form> : doc.decision === 'pending' ? <form method="post" action={`/review/${doc.id}/decision`}>
      <input type="hidden" name="decision" value="rejected" /><input type="hidden" name="summary" value="" />
      <input type="hidden" name="expectedUpdatedAt" value={content.updatedAt} /><input type="hidden" name="note" value="Rejected superseded suggestion" />
      <button className="ae-btn ae-btn--secondary" type="submit">Dismiss outdated suggestion</button>
    </form> : <p style={panel}><strong>{doc.decision === 'accepted' ? 'Accepted' : 'Rejected'}</strong>{doc.reviewedAt ? ` on ${when(doc.reviewedAt)}` : ''}{doc.reviewNote ? `. Note: ${doc.reviewNote}` : ''}</p>}

    <section className="ae-card" style={{ maxWidth: 900 }}>
      <h3>Source text <span className="ae-muted">· {extraction.passages.length} {extraction.passages.length === 1 ? 'passage' : 'passages'}</span></h3>
      <p className="ae-muted" style={{ marginTop: 0 }}>The extracted text the AI read. Check the summary and tags against it.</p>
      {extraction.passages.map((p, i) => <details key={p.id} className="ae-passage" open={i === 0}><summary>{p.locator}</summary><p>{p.text}</p></details>)}
    </section>
  </>
}
