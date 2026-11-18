'use client'
import { useEffect, useState } from 'react'
import { FieldDescription, FieldError, FieldLabel, useField } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'

type Audience = { key: string; label: string; kind: string }
let cache: Promise<Audience[]> | undefined
// One request per page load, shared by every audience picker on the page.
const loadAudiences = () => cache ??= fetch('/api/audiences?limit=500&depth=0&sort=label&where[active][equals]=true', { credentials: 'same-origin' })
  .then(r => r.ok ? r.json() : { docs: [] }).then(body => (body.docs ?? []).map((d: Audience) => ({ key: d.key, label: d.label, kind: d.kind })))
  .catch(() => [])

/** Dropdown of active Audiences for membership and access-rule scopes. Stores the audience's stable key. */
const AudienceSelect: TextFieldClientComponent = ({ field, path, readOnly }) => {
  const { value, setValue, showError, errorMessage } = useField<string>({ path })
  const [audiences, setAudiences] = useState<Audience[] | null>(null)
  useEffect(() => { void loadAudiences().then(setAudiences) }, [])
  const known = audiences?.some(a => a.key === value)
  const id = `field-${path.replace(/\./g, '__')}`
  return <div className="field-type text" style={{ flex: 1 }}>
    <FieldLabel htmlFor={id} label={field.label} required={field.required} />
    <select id={id} value={value ?? ''} disabled={readOnly || audiences === null} onChange={e => setValue(e.target.value)}
      style={{ width: '100%', padding: '10px 12px', borderRadius: 4, border: '1px solid var(--theme-elevation-150)', background: 'var(--theme-input-bg)', color: 'var(--theme-text)' }}>
      <option value="">{audiences === null ? 'Loading audiences…' : audiences.length ? 'Choose an audience' : 'No audiences yet — add them under Audiences'}</option>
      {value && audiences && !known && <option value={value}>{value} (not in the active list)</option>}
      {audiences?.map(a => <option key={a.key} value={a.key}>{a.label} · {a.key}</option>)}
    </select>
    {showError && <FieldError message={errorMessage} path={path} showError />}
    {field.admin?.description && <FieldDescription description={field.admin.description} path={path} />}
  </div>
}
export default AudienceSelect
