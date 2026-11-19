import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { principalFromUser, staff } from '../domain/access'
import { explain, jobLabel, STATE_LABEL } from '../processing/messages'
import { approvedModels, paidAllowedByEnvironment } from '../processing/settings'
import { TAGGING_MODELS } from '../globals/AutomationSettings'

const OUTCOMES: Record<string, string> = { retried: 'Job queued again. The worker picks it up within a few seconds.',
  job_not_retryable: 'That job is no longer failed, or belongs to an older processor version.', invalid_id: 'Unknown job.', retry_failed: 'Retry failed. Try again.' }
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
    ['Migration autopilot (old-site items to Draft)', settings.migrationAutopilot, 'free'],
  ]

  return template(<div style={{ paddingBottom: 48 }}>
    <h1>Automation status</h1>
    <p style={{ maxWidth: 820 }}>What the background worker is doing. When a file is uploaded or a Vimeo ID is set on a library item in Intake or Draft, the worker extracts the text (transcribing audio if needed), then asks the AI for a summary and tags. Results wait in <a href="/admin/review">Review</a>. Failed steps are listed below with the reason; fix the cause, then retry.</p>
    {outcome && <p role="status" className="ae-notice ae-notice--ok">{outcome}</p>}
    {warnings.map(w => <p key={w} role="alert" className="ae-notice ae-notice--warn">{w}</p>)}

    <div className="ae-stats">
      {[['Waiting', queued], ['Running', running], ['Failed', failed], ['Done in last 24h', doneToday], [`Paid jobs in last 24h (limit ${settings.dailyPaidJobLimit ?? 200})`, paidToday], ['Waiting for review', pendingReview]]
        .map(([label, value]) => <div key={String(label)} className="ae-stat"><strong style={label === 'Failed' && Number(value) > 0 ? { color: '#c2414b' } : undefined}>{value}</strong><span className="ae-muted">{label}</span></div>)}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, alignItems: 'start' }}>
      <section className="ae-card">
        <h2>Steps</h2>
        <ul className="ae-rows">{steps.map(([label, on, cost]) => <li key={label}><span>{label} <span className="ae-muted">({cost})</span></span>
          <span className={on === false ? 'ae-pill' : 'ae-pill ae-pill--ok'}>{on === false ? 'Off' : 'On'}</span></li>)}</ul>
        <p className="ae-muted" style={{ margin: '12px 0 0' }}>{isAdmin ? <a href="/admin/globals/automation-settings">Change automation settings →</a> : 'Administrators can change these in Automation settings.'}</p>
      </section>
      <section className="ae-card">
        <h2>Worker</h2>
        <ul className="ae-rows">
          <li><span>Last activity</span><span className="ae-muted">{recent.docs[0] ? `${when(recent.docs[0].updatedAt)} CT` : 'None yet'}</span></li>
          <li><span>Automation</span><span className={settings.paused ? 'ae-pill ae-pill--warn' : 'ae-pill ae-pill--ok'}>{settings.paused ? 'Paused' : 'Running'}</span></li>
          <li><span>Paid processing</span><span className={paidEnv ? 'ae-pill ae-pill--ok' : 'ae-pill'}>{paidEnv ? 'Allowed' : 'Off in this environment'}</span></li>
        </ul>
      </section>
    </div>

    <section className="ae-card">
      <h2>Failed ({failed})</h2>
      {failures.docs.length ? <table className="ae-table"><thead><tr><th>Library item</th><th>Step</th><th>Why it failed</th><th>When</th><th></th></tr></thead>
        <tbody>{failures.docs.map(job => <tr key={job.id}>
          <td><a href={itemLink(job)}>{title(job)}</a></td><td>{jobLabel(job.stage, job.input)}</td>
          <td>{explain(job.errorCode)}</td><td className="ae-muted" style={{ whiteSpace: 'nowrap' }}>{when(job.updatedAt)}</td>
          <td style={{ textAlign: 'right' }}>{isAdmin && <form method="post" action={`/library-api/jobs/${job.id}/retry`}><button type="submit" className="ae-btn ae-btn--secondary ae-btn--small">Retry</button></form>}</td>
        </tr>)}</tbody></table> : <p className="ae-muted" style={{ margin: 0 }}>Nothing has failed.</p>}
    </section>

    <section className="ae-card">
      <h2>In progress ({queued + running})</h2>
      {active.docs.length ? <table className="ae-table"><thead><tr><th>Library item</th><th>Step</th><th>Status</th><th>Attempts</th><th>Next try</th></tr></thead>
        <tbody>{active.docs.map(job => <tr key={job.id}><td><a href={itemLink(job)}>{title(job)}</a></td><td>{jobLabel(job.stage, job.input)}</td>
          <td><span className={job.state === 'running' ? 'ae-pill ae-pill--info' : 'ae-pill'}>{STATE_LABEL[job.state ?? 'queued']}</span>{job.errorCode ? <div className="ae-muted">{explain(job.errorCode)}</div> : null}</td>
          <td>{job.attempts ?? 0} of 5</td><td className="ae-muted">{job.state === 'queued' ? when(job.nextRunAt) : ''}</td></tr>)}</tbody></table>
        : <p className="ae-muted" style={{ margin: 0 }}>The queue is empty.</p>}
    </section>
  </div>)
}