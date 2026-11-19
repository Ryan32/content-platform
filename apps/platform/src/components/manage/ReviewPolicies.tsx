import type { AdminViewServerProps } from 'payload'
import { AdminPage } from '../AdminPage'
import { REVIEW_WINDOWS, SNOOZE_DAYS } from '../../domain/review'

/**
 * Review policies & AI settings (design: AdminPolicies). The windows and routing are the platform's rules; the AI switches
 * mirror Automation settings, which administrators change there. Publishing without a person is not an option.
 */
export default async function ReviewPolicies(props: AdminViewServerProps) {
  return AdminPage({ props, title: 'Review policies', children: async ({ isAdmin }) => {
    const { payload } = props.initPageResult.req
    const settings = await payload.findGlobal({ slug: 'automation-settings', overrideAccess: true, depth: 0 }).catch(() => null) as Record<string, unknown> | null
    const counts = await Promise.all(REVIEW_WINDOWS.map(w => payload.count({ collection: 'content', overrideAccess: true, where: { and: [{ reviewWindow: { equals: w.id } }, { state: { not_equals: 'archived' } }] } }).then(r => r.totalDocs)))
    const on = (key: string) => settings ? settings[key] !== false : true
    const toggles: [string, string, boolean | 'locked'][] = [
      ['Tag and sort new uploads', 'Section, topics, audience, licensing and format. Editors approve.', on('taggingEnabled')],
      ['Transcribe video and audio', 'Transcript and time-stamped passages AXL can cite.', on('transcriptionEnabled') || on('vimeoEnabled')],
      ['Write summaries and key takeaways', 'Plain-language summaries readers see first. Editors approve.', on('taggingEnabled')],
      ['Read text from documents', 'PDF, Word, PowerPoint and Excel text for search and citations.', on('documentsEnabled')],
      ['Publish without human approval', 'Off: a person always approves before anything goes live.', 'locked'],
    ]
    return <div className="ae-manage">
      <div className="ae-head"><div><h1>Review policies</h1><p className="ae-muted">How often each kind of content is checked, who approves it, and what AI does on its own.</p></div></div>
      <h2 className="ae-label">Standard review windows</h2>
      <div className="ae-windows">{REVIEW_WINDOWS.map((w, i) => <section key={w.id} className="ae-card ae-window">
        <div className="ae-card-row"><div><h3>{w.label}</h3><span className="ae-muted">{w.hint}</span></div><span className="ae-pill">{counts[i]} {counts[i] === 1 ? 'item' : 'items'}</span></div>
        <div className="ae-tags">{w.defaultFor.map(t => <span key={t} className="ae-tag">{t}</span>)}</div></section>)}</div>
      <p className="ae-muted">New content gets a window automatically from where it&apos;s filed (for example Commission Schedules → Monthly). Owners can change it on the item.</p>
      <div className="ae-grid-2">
        <section className="ae-card"><h2>When a window ends</h2><ul className="ae-kv">
          <li><span>Remind the owner</span><strong>30, 14 and 3 days before <em className="ae-muted">(email setup pending)</em></strong></li>
          <li><span>If nobody renews</span><strong>Hidden from advisors, search and AI on the due date</strong></li>
          <li><span>Snooze</span><strong>Once per review, {SNOOZE_DAYS} days</strong></li>
          <li><span>Who can renew</span><strong>The item&apos;s owner or an administrator</strong></li>
          <li><span>Items without an owner</span><strong>Shown on Manage home under “Missing an owner”</strong></li></ul></section>
        <section className="ae-card"><h2>Who approves</h2><ul className="ae-kv">
          <li><span>Client-ready material</span><strong>Compliance, then Creative Services</strong></li>
          <li><span>Wealth (AEWM) material</span><strong>AEWM Compliance</strong></li>
          <li><span>Carrier documents and forms</span><strong>Annuity, Life or Medicare Operations</strong></li>
          <li><span>Everything else</span><strong>Section owner</strong></li></ul>
          <p className="ae-muted">Routing is shown on each item in Add content. An administrator publishes after approval.</p></section>
      </div>
      <section className="ae-card"><h2>What AI handles</h2><ul className="ae-switches">{toggles.map(([title, body, state]) => <li key={title}>
        <span className={`ae-switch${state === true ? ' on' : ''}`} aria-hidden /><span><strong>{title}</strong><span className="ae-muted">{body}</span></span>
        <span className="ae-muted">{state === 'locked' ? 'Always off' : state ? 'On' : 'Off'}</span></li>)}</ul>
        <p className="ae-muted">{isAdmin ? <a href="/admin/globals/automation-settings">Change automation settings →</a> : 'Administrators change these in Automation settings.'}</p></section>
    </div>
  } })
}
