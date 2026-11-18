'use client'
import { useState } from 'react'
import { useAuth, useDocumentInfo, useFormFields, useFormModified } from '@payloadcms/ui'

const muted: React.CSSProperties = { color: 'var(--theme-elevation-500)', fontSize: 12 }
const row = (ok: boolean): React.CSSProperties => ({ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '6px 0', color: ok ? 'var(--theme-text)' : 'var(--theme-elevation-600)' })
const relationId = (value: unknown) => value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : value

/** Sidebar checklist on a library item: what is still needed before publishing, plus one-click Publish for administrators. */
export default function PublishChecklist() {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const modified = useFormModified()
  const values = useFormFields(([fields]) => ({
    state: fields.state?.value as string | undefined, description: fields.description?.value as string | undefined,
    body: fields.body?.value as string | undefined, evidence: fields.evidenceVersion?.value as string | undefined,
    tags: fields.acceptedTags?.value as unknown[] | undefined, audience: relationId(fields.accessProfile?.value),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const roles = (user as unknown as { roles?: unknown } | null)?.roles
  const isAdmin = Array.isArray(roles) && roles.includes('admin')
  if (!id) return null

  const checks: [boolean, string, string, boolean][] = [
    [Boolean(values.audience), 'Audience chosen', 'Choose who can see it (Audience below).', true],
    [values.evidence !== undefined && values.evidence !== 'unprocessed', 'Reviewed text and citations', 'Upload a file or Vimeo ID, then accept its AI suggestion in Review.', false],
    [Boolean(values.description?.trim()), 'Summary written', 'Add a two- or three-sentence summary.', false],
    [Boolean(values.tags?.length), 'Tags added', 'Add at least one tag so people can find it.', false],
  ]
  const published = values.state === 'published'
  const canPublish = isAdmin && !published && Boolean(values.audience) && !modified && !busy

  async function publish() {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/content/${id}`, { method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'published' }) })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        setError(body?.errors?.[0]?.message ?? 'Publishing failed. Reload and try again.')
      } else window.location.reload()
    } catch { setError('Publishing failed. Check your connection.') }
    setBusy(false)
  }

  return <div className="ae-card" style={{ padding: '12px 14px' }}>
    <strong>{published ? 'Published' : 'Ready to publish?'}</strong>
    <p style={muted}>{published ? 'Visible to its audience. Editing the text returns it to Draft for re-approval.' : 'Only the audience is required. The rest makes the item useful and findable.'}</p>
    {checks.map(([ok, label, hint, required]) => <div key={label} style={row(ok)}>
      <span aria-hidden>{ok ? '✓' : required ? '✗' : '○'}</span>
      <div><div>{label}{required ? '' : <span style={muted}> (recommended)</span>}</div>{!ok && <div style={muted}>{hint}</div>}</div>
    </div>)}
    {!published && (isAdmin
      ? <>
        <button type="button" className="ae-btn ae-btn--primary" style={{ margin: '10px 0 0', width: '100%' }} disabled={!canPublish} onClick={publish}>
          {busy ? 'Publishing…' : 'Publish now'}</button>
        {modified && <p style={muted}>Save your changes before publishing.</p>}
        {!modified && !values.audience && <p style={muted}>Choose an audience and save to enable publishing.</p>}
      </>
      : <p style={muted}>An administrator publishes items.</p>)}
    {error && <p role="alert" style={{ color: 'var(--theme-error-500)', fontSize: 12 }}>{error}</p>}
  </div>
}
