'use client'
import { useEffect, useRef, useState } from 'react'
import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { Thumbnail } from './Thumbnail'

type Info = { version: string | null; source: string | null }
const SOURCE: Record<string, string> = { upload: 'Uploaded cover', vimeo: 'From the Vimeo video', pdf: 'First page of the PDF', unavailable: 'No automatic thumbnail available' }
const muted: React.CSSProperties = { color: 'var(--theme-elevation-500)', fontSize: 12, margin: '6px 0' }

/** Sidebar panel on a library item: shows its thumbnail and lets editors upload or remove a cover image. */
export default function CoverImage() {
  const { id } = useDocumentInfo()
  const format = useFormFields(([fields]) => fields.format?.value as string | undefined) ?? 'document'
  const title = useFormFields(([fields]) => fields.title?.value as string | undefined) ?? ''
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function load() {
    if (!id) return
    const response = await fetch(`/library-api/content/${id}/processing`, { credentials: 'same-origin', cache: 'no-store' })
    if (response.ok) { const body = await response.json(); setInfo(body.thumbnail ?? { version: null, source: null }) }
  }
  useEffect(() => { void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function send(method: 'POST' | 'DELETE', file?: File) {
    setBusy(true); setError('')
    const body = file ? (() => { const f = new FormData(); f.append('file', file); return f })() : undefined
    const response = await fetch(`/library-api/content/${id}/thumbnail`, { method, body, credentials: 'same-origin' }).catch(() => null)
    if (!response?.ok) setError((await response?.json().catch(() => null))?.error ?? 'The change could not be saved.')
    if (input.current) input.current.value = ''
    await load(); setBusy(false)
  }

  return <div className="ae-card" style={{ padding: 12 }}>
    <strong style={{ display: 'block', marginBottom: 8 }}>Cover image</strong>
    <Thumbnail id={id ?? 0} version={id ? info?.version : null} format={format} title={title} rounded={8} />
    <p style={muted}>{!id ? 'Save the item first, then add a cover image.' : info?.source ? SOURCE[info.source] : 'Shown on library cards. A thumbnail is created automatically from a Vimeo video or PDF, or upload your own.'}</p>
    {id && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void send('POST', f) }} />
      <button type="button" className="ae-btn ae-btn--secondary ae-btn--small" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Saving…' : info?.source === 'upload' ? 'Replace' : 'Upload cover'}</button>
      {info?.source === 'upload' && <button type="button" className="ae-btn ae-btn--secondary ae-btn--small" disabled={busy} onClick={() => void send('DELETE')}>Use automatic</button>}
    </div>}
    {error && <p role="alert" style={{ ...muted, color: 'var(--theme-error-500)' }}>{error}</p>}
  </div>
}
