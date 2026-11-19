import type { AdminViewServerProps } from 'payload'
import { AdminPage } from '../AdminPage'
import { Thumbnail } from '../Thumbnail'
import { formatLabel } from '../Format'
import { AutoRefresh, UploadStep } from './AddContentClient'
import { processingStatus } from '../../server/processing'
import { proposalEnvelope } from '../../processing/review'
import { AUDIENCES, CONTENT_KINDS, LICENSING, LINES, PROGRAMS, SECTIONS, tagValue } from '../../domain/navigation'
import { REVIEW_WINDOWS, approvalRoute, suggestedWindow } from '../../domain/review'

const STEPS = ['Upload', 'Check AI details', 'Access & review', 'Publish']
const ERRORS: Record<string, string> = { conflict: 'The item changed while you were reviewing. Check the suggestion again.', invalid: 'Some fields were not valid.', admin_only: 'Only administrators can publish.' }

/** Add content (design: AdminCreate). Four steps; AI fills the details, a person checks them, an administrator publishes. */
export default async function AddContent(props: AdminViewServerProps) {
  return AdminPage({ props, title: 'Add content', children: async ({ isAdmin }) => {
    const { payload, user } = props.initPageResult.req
    const params = await props.searchParams
    const id = Number(typeof params?.id === 'string' ? params.id : 0)
    const step = Math.min(4, Math.max(id ? 2 : 1, Number(params?.step) || 1))
    const error = typeof params?.error === 'string' ? ERRORS[params.error] ?? decodeURIComponent(params.error) : null
    const stepper = <ol className="ae-stepper">{STEPS.map((label, i) => <li key={label} className={i + 1 < step ? 'done' : i + 1 === step ? 'on' : ''}>
      {id && i > 0 ? <a href={`/admin/add-content?id=${id}&step=${i + 1}`}><span>{i + 1 < step ? '✓' : i + 1}</span>{label}</a> : <span className="ae-step"><span>{i + 1 < step ? '✓' : i + 1}</span>{label}</span>}</li>)}</ol>
    const head = <div className="ae-head"><div><h1>Add content</h1><p className="ae-muted">Upload a file and AI fills in the details. You check them and send them for approval.</p></div></div>
    if (!id) return <div className="ae-manage">{head}{stepper}<UploadStep /></div>

    const doc = await payload.findByID({ collection: 'content', id, overrideAccess: true, depth: 0, disableErrors: true }) as any
    if (!doc) return <div className="ae-manage">{head}<p className="ae-notice ae-notice--fail">Library item not found.</p></div>
    const status = await processingStatus(payload, id)
    const back = (s: number) => `/admin/add-content?id=${id}&step=${s}`
    const aside = <aside className="ae-stack">
      <section className="ae-card"><Thumbnail id={id} version={doc.thumbnailVersion} format={doc.format} title={doc.title} rounded={8} />
        <p style={{ margin: '10px 0 0' }}><strong>{doc.title}</strong><br /><span className="ae-muted">{doc.kind === 'howto' ? 'How-to article' : formatLabel(doc.format)} · {status?.files.length ?? 0} file{status?.files.length === 1 ? '' : 's'}</span></p>
        <a className="ae-muted" href={`/admin/collections/content/${id}`}>Open the full item →</a></section>
      <section className="ae-card"><h2>What AI did</h2><ul className="ae-checks">
        {(status?.jobs.length ? status.jobs.filter(j => j.current) : []).map(j => <li key={j.id} className={j.state}><span aria-hidden>{j.state === 'succeeded' ? '✓' : j.state === 'failed' ? '!' : '…'}</span>{j.step}{j.state === 'failed' && j.reason ? <em className="ae-muted"> — {j.reason}</em> : j.state !== 'succeeded' ? <em className="ae-muted"> — {j.stateLabel}</em> : null}</li>)}
        {!status?.jobs.length && <li><span aria-hidden>…</span>Waiting for the file to be processed</li>}
        <li className={doc.thumbnailVersion ? 'succeeded' : ''}><span aria-hidden>{doc.thumbnailVersion ? '✓' : '…'}</span>Cover image</li>
      </ul></section>
    </aside>

    if (step === 2) {
      const suggestionRef = status?.suggestions.find(s => s.current && s.decision === 'pending')
      const accepted = status?.suggestions.find(s => s.current && s.decision === 'accepted')
      const working = !suggestionRef && !accepted && status?.jobs.some(j => j.current && (j.state === 'queued' || j.state === 'running'))
      let proposal: ReturnType<typeof proposalEnvelope.parse> | null = null
      let terms: { id: number; label: string }[] = []
      if (suggestionRef) {
        const s = await payload.findByID({ collection: 'suggestions', id: suggestionRef.id, overrideAccess: true, depth: 0 })
        const parsed = proposalEnvelope.safeParse(s.proposal)
        if (parsed.success) { proposal = parsed.data; terms = (await payload.find({ collection: 'taxonomy', overrideAccess: true, pagination: false, where: { id: { in: parsed.data.taxonomyIds } } })).docs.map(t => ({ id: t.id, label: t.label })) }
      }
      const carriers = (await payload.find({ collection: 'carriers', overrideAccess: true, depth: 0, pagination: false, sort: 'name' })).docs
      const sel = (v: string, list: string[] | null | undefined) => (list ?? []).includes(v)
      return <div className="ae-manage">{head}{stepper}
        {error && <p role="alert" className="ae-notice ae-notice--fail">{error}</p>}
        <div className="ae-grid-2 aside-left">{aside}<div className="ae-stack">
          {working && <section className="ae-card"><h2>Reading your file</h2><AutoRefresh /></section>}
          {proposal && suggestionRef && <form className="ae-card" method="post" action={`/review/${suggestionRef.id}/decision`}>
            <div className="ae-card-row"><h2>Check what AI wrote</h2><span className="ae-muted">Nothing goes live until it&apos;s approved.</span></div>
            <input type="hidden" name="expectedUpdatedAt" value={doc.updatedAt} /><input type="hidden" name="returnTo" value={back(2)} />
            <label className="ae-field"><span>Summary for advisors <em className="ae-ai">✦ AI suggested</em></span><textarea name="summary" rows={4} maxLength={2000} defaultValue={proposal.proposal.summary} /></label>
            {proposal.proposal.takeaways.length > 0 && <div className="ae-field"><span>Key takeaways <em className="ae-ai">✦ AI suggested</em></span><ul className="ae-bullets">{proposal.proposal.takeaways.map((t, i) => <li key={i}>{t.text}</li>)}</ul></div>}
            {terms.length > 0 && <fieldset className="ae-field"><legend>Search tags <em className="ae-ai">✦ AI suggested</em></legend><div className="ae-tags">{terms.map(t => { const p = proposal!.proposal.tags.find(x => x.termId === t.id)
              return <label key={t.id} className="ae-tag check"><input type="checkbox" name="tags" value={t.id} defaultChecked={Boolean(p)} />{t.label}{p ? ` · ${Math.round(p.confidence * 100)}%` : ''}</label> })}</div></fieldset>}
            <div className="ae-actions"><button className="ae-btn ae-btn--secondary" name="decision" value="rejected">Reject</button><button className="ae-btn ae-btn--primary" name="decision" value="accepted">Accept AI summary, takeaways and tags</button></div>
          </form>}
          {!proposal && suggestionRef && <section className="ae-card"><div className="ae-card-row"><h2>AI analysis is ready</h2><span className="ae-muted">Nothing goes live until it&apos;s approved.</span></div>
            <p>The AI read everything attached to this item and suggested a summary, where it belongs, filters, tags and key takeaways.</p>
            <a className="ae-btn ae-btn--primary" href={`/admin/review/${suggestionRef.id}`}>Review field by field</a></section>}
          {accepted && <p className="ae-notice ae-notice--ok">AI summary, takeaways and tags accepted. The extracted text is now the item&apos;s reading text and citations.</p>}
          {!working && !proposal && !accepted && <p className="ae-notice">No AI suggestion yet. Check <a href="/admin/automation">Automation status</a> if processing failed, or fill in the details yourself.</p>}

          <form className="ae-card" method="post" action={`/library-api/content/${id}/details`}>
            <input type="hidden" name="part" value="details" /><input type="hidden" name="returnTo" value={back(2)} /><input type="hidden" name="next" value={back(3)} />
            <div className="ae-card-row"><h2>Where it appears</h2><span className="ae-muted">Helps people find it. Never changes who can see it.</span></div>
            <div className="ae-row"><label className="ae-field"><span>Type</span><select name="kind" defaultValue={doc.kind ?? 'resource'}>{CONTENT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
              <label className="ae-field"><span>Section</span><select name="section" defaultValue={doc.section ?? ''}><option value="">Choose a section</option>{SECTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label></div>
            <fieldset className="ae-field"><legend>Topics and pages you know</legend>{SECTIONS.map(s => <details key={s.id} open={doc.section === s.id} className="ae-topic-group"><summary>{s.label}</summary><div className="ae-tags">
              {s.topics.map(t => <label key={t} className="ae-tag check"><input type="checkbox" name="topics" value={tagValue(s.id, t)} defaultChecked={sel(tagValue(s.id, t), doc.topics)} />{t}</label>)}
              {s.familiar.map(f => <label key={f} className="ae-tag check page"><input type="checkbox" name="pages" value={tagValue(s.id, f)} defaultChecked={sel(tagValue(s.id, f), doc.pages)} />{f}</label>)}</div></details>)}</fieldset>
            <div className="ae-row">
              <fieldset className="ae-field"><legend>Who is it for?</legend><div className="ae-seg">{AUDIENCES.map(a => <label key={a.value}><input type="radio" name="audience" value={a.value} defaultChecked={(doc.audience ?? 'advisor') === a.value} /><span>{a.label === 'Client-ready' ? 'Advisors can share with clients' : 'Advisors only'}</span></label>)}</div></fieldset>
              <fieldset className="ae-field"><legend>Licensing</legend><div className="ae-seg">{LICENSING.map(l => <label key={l.value}><input type="checkbox" name="licensing" value={l.value} defaultChecked={sel(l.value, doc.licensing)} /><span>{l.label}</span></label>)}</div></fieldset></div>
            <fieldset className="ae-field"><legend>Line of business</legend><div className="ae-tags">{LINES.map(l => <label key={l.value} className="ae-tag check"><input type="checkbox" name="lines" value={l.value} defaultChecked={sel(l.value, doc.lines)} />{l.label}</label>)}</div></fieldset>
            <div className="ae-row"><label className="ae-field"><span>Program</span><select name="program" defaultValue={doc.program ?? ''}><option value="">None</option>{PROGRAMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
              {carriers.length > 0 && <fieldset className="ae-field"><legend>Carriers</legend><div className="ae-tags">{carriers.map(c => <label key={c.id} className="ae-tag check"><input type="checkbox" name="carriers" value={c.id} defaultChecked={(doc.carriers ?? []).includes(c.id)} />{c.name}</label>)}</div></fieldset>}</div>
            <div className="ae-actions"><a className="ae-btn ae-btn--secondary" href="/admin/library">Save as draft and exit</a><button className="ae-btn ae-btn--primary">Next: access &amp; review</button></div>
          </form>
        </div></div></div>
    }

    if (step === 3) {
      const [people, profiles] = await Promise.all([
        payload.find({ collection: 'users', overrideAccess: true, depth: 0, pagination: false, sort: 'name', where: { and: [{ active: { equals: true } }, { roles: { in: ['editor', 'admin'] } }] } }),
        payload.find({ collection: 'access-profiles', overrideAccess: true, depth: 0, pagination: false, sort: 'name', where: { active: { equals: true } } }),
      ])
      const window = doc.reviewWindow && doc.lastReviewedAt ? doc.reviewWindow : suggestedWindow(doc)
      const route = approvalRoute(doc)
      return <div className="ae-manage">{head}{stepper}
        {error && <p role="alert" className="ae-notice ae-notice--fail">{error}</p>}
        <div className="ae-grid-2 aside-left">{aside}<form className="ae-card" method="post" action={`/library-api/content/${id}/details`}>
          <input type="hidden" name="part" value="review" /><input type="hidden" name="returnTo" value={back(3)} /><input type="hidden" name="next" value={back(4)} />
          <h2>Who can see it</h2>
          {isAdmin ? <label className="ae-field"><span>Access profile</span><select name="accessProfile" defaultValue={doc.accessProfile ?? ''}><option value="">Choose who can see it</option>{profiles.docs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <em className="ae-muted">Required to publish. Set by people, never by AI.</em></label>
            : <p className="ae-muted">An administrator chooses who can see it when publishing.</p>}
          <h2>Review schedule</h2>
          <div className="ae-row"><label className="ae-field"><span>Review every</span><select name="reviewWindow" defaultValue={window}>{REVIEW_WINDOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</select>
            <em className="ae-muted">Suggested from where it&apos;s filed. When it lapses, the item is hidden until renewed.</em></label>
            <label className="ae-field"><span>Review on (set-date only)</span><input type="date" name="reviewOn" defaultValue={doc.reviewOn ? String(doc.reviewOn).slice(0, 10) : ''} /></label></div>
          <label className="ae-field"><span>Owner</span><select name="owner" defaultValue={doc.owner ?? user!.id}>{people.docs.map(p => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}</select>
            <em className="ae-muted">Gets the review reminders and can renew it.</em></label>
          <h2>Who approves</h2><p className="ae-route"><strong>{route.when}</strong> → {route.approvers}</p>
          <div className="ae-actions"><a className="ae-btn ae-btn--secondary" href={back(2)}>Back</a><button className="ae-btn ae-btn--primary">Next: publish</button></div>
        </form></div></div>
    }

    const checks: [string, boolean, string][] = [
      ['Reading text and citations accepted', doc.evidenceVersion !== 'unprocessed' || doc.kind === 'howto', back(2)],
      ['Filed in a section', Boolean(doc.section), back(2)],
      ['Who can see it is set', Boolean(doc.accessProfile), back(3)],
      ['Review schedule and owner set', Boolean(doc.reviewWindow && doc.owner), back(3)],
    ]
    const published = doc.state === 'published' || params?.published === '1'
    return <div className="ae-manage">{head}{stepper}
      {error && <p role="alert" className="ae-notice ae-notice--fail">{error}</p>}
      <div className="ae-grid-2 aside-left">{aside}<section className="ae-card">
        <h2>{published ? 'Published' : 'Ready to publish?'}</h2>
        <ul className="ae-checks big">{checks.map(([label, ok, href]) => <li key={label} className={ok ? 'succeeded' : ''}><span aria-hidden>{ok ? '✓' : '○'}</span>{label}{!ok && <a href={href}> Fix</a>}</li>)}</ul>
        <p className="ae-route"><strong>Approval:</strong> {approvalRoute(doc).approvers}</p>
        {published ? <p className="ae-notice ae-notice--ok">Live for its audience. <a href={`/resources/${id}`} target="_blank" rel="noreferrer">View as an advisor ↗</a></p>
          : isAdmin ? <form method="post" action={`/library-api/content/${id}/publish`}><input type="hidden" name="returnTo" value={back(4)} />
            <div className="ae-actions"><a className="ae-btn ae-btn--secondary" href={back(3)}>Back</a><button className="ae-btn ae-btn--primary" disabled={!checks.every(c => c[1])}>Publish</button></div></form>
          : <p className="ae-notice">Saved as a draft. An administrator publishes it after approval.</p>}
      </section></div></div>
  } })
}
