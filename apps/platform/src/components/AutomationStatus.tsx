import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { principalFromUser, staff } from '../domain/access'
import { explain, jobLabel, STATE_LABEL } from '../processing/messages'
import { approvedModels, paidAllowedByEnvironment } from '../processing/settings'
import { TAGGING_MODELS } from '../globals/AutomationSettings'

const OUTCOMES: Record<string, string> = { retried: 'Job queued again. The worker picks it up within a few seconds.',
  job_not_retryable: 'That job is no longer failed, or belongs to an older processor version.', invalid_id: 'Unknown job.', retry_failed: 'Retry failed. Try again.' }
const card: React.CSSProperties = { background: 'var(--theme-elevation-0)', border: '1px solid var(--theme-elevation-150)', borderRadius: 10, padding: '12px 16px', minWidth: 150 }
const muted: React.CSSProperties = { color: 'var(--theme-elevation-500)', fontSize: 13 }
const cell: React.CSSProperties = { padding: '8px 12px 8px 0', borderBottom: '1px solid var(--theme-elevation-100)', verticalAlign: 'top', textAlign: 'left' }
const when = (value?: string | null) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : ''

/** Admin view at /admin/automation: what the background worker is doing, what failed and why, and retry. */
export default async function AutomationStatus({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const { payload, user } = req
  const isAdmin = staff(principalFromUser(user), 'admin')
  const template = (body: React.ReactNode) => <DefaultTemplate i18n={req.i18n} locale={locale} params={params} payload={payload} permissions={permissions}
    searchParams={searchParams} user={user ?? undefined} visibleEntities={visibleEntities}><Gutter>{body}</Gutter></DefaultTemplate>
  if (!staff(principalFromUser(user), 'editor')) return template(<><h1>Automation status</h1><p>Editor access required.</p></>)

  const since = new Date(Date.now() - 86400000).toISOString()
  const count = (where: object) => payload.count({ collection: 'processing-jobs', overrideAccess: true, where: where as never }).then(r => r.totalDocs)
  const [queued, running, failed, doneToday, paidToday, pendingReview, tags, failures, active, recent, settings] = await Promise.all([
    count({ state: { equals: 'queued' } }), count({ state: { equals: 'running' } }), count({ state: { equals: 'failed' } }),
    count({ and: [{ state: { equals: 'succeeded' } }, { updatedAt: { greater_than: since } }] }),
    count({ and: [{ stage: { in: ['transcribe', 'classify'] } }, { createdAt: { greater_than: since } }] }),
    payload.count({ collection: 'suggestions', overrideAccess: true, where: { decision: { equals: 'pending' } } }).then(r => r.totalDocs),
    payload.count({ collection: 'taxonomy', overrideAccess: true }).then(r => r.totalDocs),
    payload.find({ collection: 'processing-jobs', overrideAccess: true, depth: 1, limit: 50, sort: '-updatedAt', where: { state: { equals: 'failed' } } }),
    payload.find({ collection: 'processing-jobs', overrideAccess: true, depth: 1, limit: 20, sort: 'nextRunAt', where: { state: { in: ['queued', 'running'] } } }),
    payload.find({ collection: 'processing-jobs', overrideAccess: true, depth: 0, limit: 1, sort: '-updatedAt' }),
    payload.findGlobal({ slug: 'automation-settings', overrideAccess: true, depth: 0 }),
  ])
  const params_ = await searchParams
  const outcome = typeof params_?.outcome === 'string' ? OUTCOMES[params_.outcome] ?? params_.outcome : null
  const title = (doc: { content?: unknown }) => typeof doc.content === 'object' && doc.content && 'title' in doc.content ? String((doc.content as { title: string }).title) : 'Library item'
  const itemLink = (doc: { content?: unknown }) => typeof doc.content === 'object' && doc.content && 'id' in doc.content ? `/admin/collections/content/${(doc.content as { id: number }).id}` : '#'
  const modelLabel = TAGGING_MODELS.find(m => m.value === settings.taggingModel)?.label ?? settings.taggingModel
  const paidEnv = paidAllowedByEnvironment()
  const warnings = [
    settings.paused && 'All automation is paused. Queued jobs will wait.',
    !paidEnv && 'Paid processing (transcription and AI tagging) is switched off for this environment by the deployment.',
    paidEnv && settings.taggingEnabled && !approvedModels().includes(settings.taggingModel ?? '') && 'The selected AI model is not approved for this environment.',
    settings.taggingEnabled && tags === 0 && 'AI tagging is on but there are no tags yet. Add the approved vocabulary in Tags & topics.',
    paidToday >= (settings.dailyPaidJobLimit ?? 200) && 'The daily paid job limit has been reached.',
  ].filter(Boolean) as string[]
  const steps: [string, boolean | null | undefined, string][] = [
    ['Text extraction from files', settings.documentsEnabled, 'free'], ['Vimeo captions', settings.vimeoEnabled, 'free'],
    ['Transcription', settings.transcriptionEnabled, 'paid'], [`AI tagging (${modelLabel})`, settings.taggingEnabled, 'paid'],
  ]

  return template(<div style={{ paddingBottom: 48 }}>
    <h1>Automation status</h1>
    <p style={{ maxWidth: 820 }}>What the background worker is doing. When a file is uploaded or a Vimeo ID is set on a library item in Intake or Draft, the worker extracts the text (transcribing audio if needed), then asks the AI for a summary and tags. Results wait in <a href="/admin/review">Review</a>. Failed steps are listed below with the reason; fix the cause, then retry.</p>
    {outcome && <p role="status" style={{ padding: 12, border: '1px solid var(--theme-success-500)', borderRadius: 6 }}>{outcome}</p>}
    {warnings.map(w => <p key={w} role="alert" style={{ padding: 12, border: '1px solid var(--theme-warning-500)', borderRadius: 6 }}>{w}</p>)}

    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0 24px' }}>
      {[['Waiting', queued], ['Running', running], ['Failed', failed], ['Done in last 24h', doneToday], [`Paid jobs in last 24h (limit ${settings.dailyPaidJobLimit ?? 200})`, paidToday], ['Waiting for review', pendingReview]]
        .map(([label, value]) => <div key={String(label)} style={card}><div style={{ fontSize: 24, fontWeight: 600 }}>{value}</div><div style={muted}>{label}</div></div>)}
    </div>
    <p style={muted}>Last worker activity: {recent.docs[0] ? when(recent.docs[0].updatedAt) : 'none yet'} (Central time).</p>

    <h2>Steps</h2>
    <ul>{steps.map(([label, on, cost]) => <li key={label}>{label}: <strong>{on === false ? 'Off' : 'On'}</strong> <span style={muted}>({cost})</span></li>)}</ul>
    <p>{isAdmin ? <a href="/admin/globals/automation-settings">Change automation settings →</a> : <span style={muted}>Administrators can change these in Automation settings.</span>}</p>

    <h2>Failed ({failed})</h2>
    {failures.docs.length ? <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>
      <th style={cell}>Library item</th><th style={cell}>Step</th><th style={cell}>Why it failed</th><th style={cell}>When</th><th style={cell}></th></tr></thead>
      <tbody>{failures.docs.map(job => <tr key={job.id}>
        <td style={cell}><a href={itemLink(job)}>{title(job)}</a></td><td style={cell}>{jobLabel(job.stage, job.input)}</td>
        <td style={cell}>{explain(job.errorCode)}</td><td style={cell}>{when(job.updatedAt)}</td>
        <td style={cell}>{isAdmin && <form method="post" action={`/library-api/jobs/${job.id}/retry`}><button type="submit" className="btn btn--style-secondary btn--size-small" style={{ margin: 0 }}>Retry</button></form>}</td>
      </tr>)}</tbody></table> : <p style={muted}>Nothing has failed.</p>}

    <h2>In progress ({queued + running})</h2>
    {active.docs.length ? <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>
      <th style={cell}>Library item</th><th style={cell}>Step</th><th style={cell}>Status</th><th style={cell}>Attempts</th><th style={cell}>Next try</th></tr></thead>
      <tbody>{active.docs.map(job => <tr key={job.id}><td style={cell}><a href={itemLink(job)}>{title(job)}</a></td><td style={cell}>{jobLabel(job.stage, job.input)}</td>
        <td style={cell}>{STATE_LABEL[job.state ?? 'queued']}{job.errorCode ? <div style={muted}>{explain(job.errorCode)}</div> : null}</td>
        <td style={cell}>{job.attempts ?? 0} of 5</td><td style={cell}>{job.state === 'queued' ? when(job.nextRunAt) : ''}</td></tr>)}</tbody></table>
      : <p style={muted}>The queue is empty.</p>}
  </div>)
}
