import type { Payload } from 'payload'
import { muted, panel } from './AdminPage'
import { Thumbnail } from './Thumbnail'
import { ANALYSIS_VERSION, type AnalysisEnvelope } from '../processing/analysis'
import { backfillTags, currentValue, defaultChoice, REVIEW_FIELDS, suggestedValue, type ReviewField } from '../processing/analysis-review'
import { AUDIENCES, CONTENT_KINDS, LICENSING, LINES, PAGE_OPTIONS, PROGRAMS, SECTION_OPTIONS, TOPIC_OPTIONS, labelOf } from '../domain/navigation'

const FIELD_LABEL: Record<ReviewField, string> = { title: 'Title', summary: 'Summary', kind: 'Type', section: 'Section', audience: 'Who it\'s for',
  program: 'Program', topics: 'Topics', pages: 'Pages you know', licensing: 'Licensing', lines: 'Line of business', carriers: 'Carriers', takeaways: 'Key takeaways' }
const OPTIONS: Partial<Record<ReviewField, readonly { value: string; label: string }[]>> = { kind: CONTENT_KINDS, section: SECTION_OPTIONS, audience: AUDIENCES,
  program: PROGRAMS, topics: TOPIC_OPTIONS, pages: PAGE_OPTIONS, licensing: LICENSING, lines: LINES }
const input: React.CSSProperties = { width: '100%', padding: 8, borderRadius: 4, border: '1px solid var(--theme-elevation-150)', background: 'var(--theme-input-bg)', color: 'var(--theme-text)', font: 'inherit' }
const cell: React.CSSProperties = { padding: '10px 8px', verticalAlign: 'top', borderTop: '1px solid var(--theme-elevation-100)' }
const when = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago' })

function show(e: AnalysisEnvelope, field: ReviewField, value: unknown) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return <span style={muted}>Empty</span>
  if (field === 'carriers') return (value as number[]).map(id => e.carriers.find(c => c.id === id)?.name ?? `Carrier ${id}`).join(', ')
  if (field === 'takeaways') return <ul style={{ margin: 0, paddingLeft: 18 }}>{(value as string[]).map((t, i) => <li key={i}>{t}</li>)}</ul>
  const list = OPTIONS[field]
  if (list) return (Array.isArray(value) ? value : [value]).map(v => labelOf(list, String(v))).join(', ')
  return String(value)
}
function reasonOf(e: AnalysisEnvelope, field: ReviewField) {
  const a = e.analysis as Record<string, unknown>
  const v = a[field] as { reason?: string; evidenceIds?: string[] } | null | undefined
  if (field === 'takeaways') return { reason: '', evidence: [...new Set(e.analysis.takeaways.flatMap(t => t.evidenceIds))] }
  return { reason: v?.reason ?? '', evidence: v?.evidenceIds ?? [] }
}

/** Field-by-field review of a combined analysis. Keeps team-written values by default; backfills empty ones. */
export async function AnalysisReview({ payload, user, doc, e, content, error, errors, stale }: {
  payload: Payload; user: unknown; doc: { id: number; decision?: string | null; createdAt: string; model: string; reviewedAt?: string | null; reviewNote?: string | null }
  e: AnalysisEnvelope; content: { id: number; title: string; updatedAt: string; format?: string | null; thumbnailVersion?: string | null; state?: string | null }
  error?: string; errors: Record<string, string>; stale: boolean
}) {
  const termIds = [...new Set([...e.taxonomyIds, ...e.current.tags])]
  const terms = await payload.find({ collection: 'taxonomy', user: user as never, overrideAccess: false, depth: 0, pagination: false, where: { id: { in: termIds } } })
  const label = (id: number) => terms.docs.find(t => t.id === id)?.label ?? e.taxonomy.find(t => t.id === id)?.label ?? `Tag ${id}`
  const locator = (pid: string) => e.passages.find(p => p.id === pid)?.locator ?? pid
  const cite = (ids: string[]) => ids.length ? <span style={muted}> — {[...new Set(ids.map(locator))].slice(0, 3).join('; ')}</span> : null
  const a = e.analysis
  const backfill = backfillTags(e)
  const suggestedTags = new Map(a.tags.map(t => [t.termId, t]))
  const pending = doc.decision === 'pending' && !stale
  const rows = REVIEW_FIELDS.filter(f => suggestedValue(e, f) !== undefined || f === 'title' || f === 'summary')

  return <>
    <p style={muted}><a href="/admin/review">← Review</a></p>
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <span style={{ width: 160, flex: 'none' }}><Thumbnail id={content.id} version={content.thumbnailVersion} format={content.format ?? 'document'} title={content.title} rounded={8} /></span>
      <div><h1 style={{ marginBottom: 4 }}>{content.title}</h1>
        <p style={muted}>{e.current.migrated ? 'Migrated from WordPress' : 'Added in the Library'} · <a href={`/admin/collections/content/${content.id}`}>Open library item</a> · analyzed {when(doc.createdAt)} by {doc.model}</p></div>
    </div>
    {error && <p role="alert" className="ae-notice ae-notice--fail">{errors[error] ?? 'The decision could not be applied.'}</p>}
    {stale && <p role="alert" className="ae-notice ae-notice--warn">The item changed after this analysis was made, so it can&apos;t be accepted. A new analysis is queued automatically for the current version.</p>}
    {a.conflicts.map((c, i) => <p key={i} className="ae-notice ae-notice--warn"><strong>Possible conflict{c.field ? ` (${c.field})` : ''}:</strong> {c.note}{cite(c.evidenceIds)}</p>)}
    {a.warnings.map((w, i) => <p key={`w${i}`} className="ae-notice ae-notice--warn">{w}</p>)}

    <section className="ae-card" style={{ maxWidth: 1100 }}>
      <h3 style={{ marginTop: 0 }}>What the AI read</h3>
      <p style={{ margin: 0 }}>{e.sources.map((s, i) => <span key={i} className={s.status === 'failed' ? 'ae-pill ae-pill--warn' : 'ae-pill'} style={{ marginRight: 6 }}>
        {s.label}{s.status === 'failed' ? ' — could not be read' : s.status === 'truncated' ? ` — first ${s.passages} passages` : ''}</span>)}</p>
      {e.current.sourceCategories.length > 0 && <p style={{ ...muted, marginBottom: 0 }}>WordPress categories: {e.current.sourceCategories.join(', ')}</p>}
    </section>

    <form method="post" action={`/review/${doc.id}/decision`} style={{ ...panel, maxWidth: 1100, marginTop: 16 }}>
      <input type="hidden" name="format" value={ANALYSIS_VERSION} />
      <input type="hidden" name="expectedUpdatedAt" value={content.updatedAt} />
      <h3 style={{ marginTop: 0 }}>Fields</h3>
      <p style={muted}>The team&apos;s current values are kept unless you choose the suggestion. Empty fields are pre-set to the suggestion.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left' }}><th style={cell}>Field</th><th style={cell}>Current</th><th style={cell}>Suggested</th><th style={cell}>Use</th></tr></thead>
        <tbody>{rows.map(f => {
          const proposed = suggestedValue(e, f), choice = defaultChoice(e, f), { reason, evidence } = reasonOf(e, f)
          const editable = f === 'title' || f === 'summary'
          return <tr key={f}>
            <td style={{ ...cell, width: 130 }}><strong>{FIELD_LABEL[f]}</strong></td>
            <td style={{ ...cell, width: '32%' }}>{show(e, f, currentValue(e.current, f))}</td>
            <td style={cell}>{proposed === undefined ? <span style={muted}>No change suggested</span> : editable
              ? f === 'summary' ? <textarea name="summary" maxLength={2000} rows={4} defaultValue={String(proposed)} style={input} disabled={!pending} />
                : <input name="title" maxLength={300} defaultValue={String(proposed)} style={input} disabled={!pending} />
              : show(e, f, proposed)}
              {(reason || evidence.length > 0) && <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>{reason}{cite(evidence)}</div>}</td>
            <td style={{ ...cell, width: 150, whiteSpace: 'nowrap' }}>{proposed === undefined ? <span style={muted}>Keep</span> : <>
              <label style={{ display: 'block' }}><input type="radio" name={`use_${f}`} value="current" defaultChecked={choice === 'current'} disabled={!pending} /> Keep current</label>
              <label style={{ display: 'block' }}><input type="radio" name={`use_${f}`} value="suggested" defaultChecked={choice === 'suggested'} disabled={!pending} /> Use suggestion</label></>}</td>
          </tr>
        })}</tbody>
      </table>

      <h3>Tags</h3>
      <p style={muted}>Descriptive only; tags never change who can see the item.{backfill ? ' This item has no tags yet, so the suggestions are pre-selected.' : ''}</p>
      {[...new Set([...e.current.tags, ...a.tags.map(t => t.termId)])].map(id => { const s = suggestedTags.get(id), mine = e.current.tags.includes(id)
        return <label key={id} style={{ display: 'block', margin: '4px 0' }}><input type="checkbox" name="tags" value={id} defaultChecked={mine || (backfill && Boolean(s))} disabled={!pending} /> {label(id)}
          <span style={muted}>{mine ? ' · current' : ''}{s ? ` · suggested (${Math.round(s.confidence * 100)}%)` : ''}</span>{s && cite(s.evidenceIds)}</label> })}
      {a.newTags.length > 0 && <>
        <p style={{ marginBottom: 4 }}><strong>New tags the AI suggests adding to Tags &amp; topics</strong></p>
        {a.newTags.map((t, i) => <label key={i} style={{ display: 'block', margin: '4px 0' }}><input type="checkbox" name="newTags" value={i} defaultChecked={backfill} disabled={!pending} /> {t.label} <span className="ae-pill">{t.dimension}</span>
          <span style={muted}> — {t.definition}</span>{cite(t.evidenceIds)}</label>)}
        <p style={muted}>A checked new tag is created (or reused if one with the same name and category exists) and applied to this item.</p></>}

      {pending ? <>
        <label style={{ display: 'block', margin: '12px 0' }}><strong>Note</strong><span style={muted}> — optional, kept with the decision</span>
          <textarea name="note" maxLength={2000} rows={2} style={input} /></label>
        <p style={muted}>Accept applies your choices, installs the source text as citations{e.current.body.trim() ? '' : ' and reading text'}, and moves an Intake item to Draft. It never publishes or changes who can see the item.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="ae-btn ae-btn--primary" name="decision" value="accepted">Accept selected</button>
          <button className="ae-btn ae-btn--secondary" name="decision" value="rejected">Reject</button>
        </div></>
        : doc.decision === 'pending' ? <button className="ae-btn ae-btn--secondary" name="decision" value="rejected">Dismiss outdated analysis</button>
          : <p><strong>{doc.decision === 'accepted' ? 'Accepted' : 'Rejected'}</strong>{doc.reviewedAt ? ` on ${when(doc.reviewedAt)}` : ''}{doc.reviewNote ? `. Note: ${doc.reviewNote}` : ''}</p>}
    </form>

    <section className="ae-card" style={{ maxWidth: 1100, marginTop: 16 }}>
      <h3>Source text <span className="ae-muted">· {e.passages.length} {e.passages.length === 1 ? 'passage' : 'passages'}</span></h3>
      <p className="ae-muted" style={{ marginTop: 0 }}>Everything the analysis drew on, by source. Check the suggestions against it.</p>
      {e.passages.slice(0, 300).map((p, i) => <details key={p.id} className="ae-passage" open={i === 0}><summary>{p.locator}</summary><p>{p.text}</p></details>)}
      {e.passages.length > 300 && <p style={muted}>{e.passages.length - 300} more passages are stored and become citations on acceptance.</p>}
    </section>
  </>
}
