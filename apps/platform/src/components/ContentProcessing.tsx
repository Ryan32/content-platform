'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocumentInfo, useFormFields } from '@payloadcms/ui'

type Status = {
  state: string; vimeoId: string | null
  automation: { paused: boolean; documents: boolean; vimeo: boolean; transcription: boolean; tagging: boolean } | null
  files: { id: number; type: string; current: boolean; uploadedAt: string }[]
  jobs: { id: number; step: string; state: string; stateLabel: string; current: boolean; reason: string; updatedAt: string }[]
  suggestions: { id: number; decision: string; current: boolean; createdAt: string }[]
}
const TYPE_NAMES: Record<string, string> = { 'application/pdf': 'PDF', 'text/vtt': 'Captions (VTT)', 'text/plain': 'Text', 'audio/mpeg': 'MP3 audio',
  'video/mp4': 'MP4 video', 'audio/wav': 'WAV audio', 'audio/mp4': 'M4A audio', 'audio/flac': 'FLAC audio', 'audio/ogg': 'OGG audio', 'video/webm': 'WEBM video' }
const typeName = (mime: string) => TYPE_NAMES[mime] ?? (mime.includes('word') ? 'Word document' : mime.includes('presentation') ? 'PowerPoint' : mime.includes('sheet') ? 'Excel' : mime)
const when = (value: string) => new Date(value).toLocaleString()
const box: React.CSSProperties = { background: 'var(--theme-elevation-0)', border: '1px solid var(--theme-elevation-150)', borderRadius: 10, padding: 16, margin: '8px 0 24px' }
const muted: React.CSSProperties = { color: 'var(--theme-elevation-500)', fontSize: 13 }
const badge = (state: string): React.CSSProperties => ({ fontSize: 12, padding: '2px 8px', borderRadius: 10, marginLeft: 8,
  background: state === 'failed' ? 'var(--theme-error-100)' : state === 'succeeded' ? 'var(--theme-success-100)' : 'var(--theme-elevation-100)' })

/** Processing panel on a library item: upload its file, then follow extraction, transcription and AI tagging. */
export default function ContentProcessing() {
  const { id } = useDocumentInfo()
  const vimeoField = useFormFields(([fields]) => fields.vimeoId?.value)
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!id) return
    const response = await fetch(`/library-api/content/${id}/processing`, { credentials: 'same-origin', cache: 'no-store' })
    if (response.ok) setStatus(await response.json())
  }, [id])
  useEffect(() => { void load() }, [load])
  const active = status?.jobs.some(j => j.current && ['queued', 'running'].includes(j.state))
  useEffect(() => {
    if (!id) return
    const timer = setInterval(() => { void load() }, active ? 5000 : 20000)
    return () => clearInterval(timer)
  }, [id, active, load])

  if (!id) return <div style={box}><strong>Processing</strong><p style={muted}>Save this item first. Then you can upload its file or add a Vimeo ID here, and processing starts automatically.</p></div>

  async function upload() {
    const file = input.current?.files?.[0]
    if (!file) { setMessage({ kind: 'error', text: 'Choose a file first.' }); return }
    setBusy(true); setMessage(null)
    const body = new FormData(); body.append('file', file)
    try {
      const response = await fetch(`/library-api/content/${id}/files`, { method: 'POST', body, credentials: 'same-origin' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) setMessage({ kind: 'error', text: result.error ?? 'Upload failed.' })
      else {
        setMessage({ kind: 'ok', text: 'Uploaded. Processing will start within a few seconds. Reload the page to see updated source details.' })
        if (input.current) input.current.value = ''
      }
    } catch { setMessage({ kind: 'error', text: 'Upload failed. Check your connection and try again.' }) }
    setBusy(false); void load()
  }

  const current = status?.jobs.filter(j => j.current) ?? []
  const pending = status?.suggestions.filter(s => s.current && s.decision === 'pending') ?? []
  const auto = status?.automation
  const off = auto && [auto.paused && 'all automation is paused', !auto.documents && 'text extraction is off', !auto.tagging && 'AI tagging is off',
    !auto.transcription && 'transcription is off', !auto.vimeo && 'Vimeo captions are off'].filter(Boolean)
  return <div style={box}>
    <strong>Processing</strong>
    <p style={muted}>Upload the original file (PDF, Word, PowerPoint, Excel, captions, text, or audio/video up to 50 MB){vimeoField ? ', or rely on the Vimeo ID above' : ''}. The system extracts the text, transcribes audio if needed, and suggests a summary and tags. Suggestions wait in Review; nothing is published automatically.</p>
    {off && off.length > 0 && <p style={{ ...muted, color: 'var(--theme-warning-650)' }}>Note: {off.join(', ')} (Automation settings).</p>}
    {status && !['intake', 'draft'].includes(status.state)
      ? <p style={muted}>Files can be added while the item is in Intake or Draft.</p>
      : <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={input} type="file" aria-label="Source file" accept=".pdf,.docx,.pptx,.xlsx,.vtt,.txt,.mp3,.mp4,.wav,.m4a,.flac,.ogg,.webm" disabled={busy} />
        <button type="button" className="btn btn--style-primary btn--size-small" onClick={upload} disabled={busy}>{busy ? 'Uploading…' : 'Upload and process'}</button>
      </div>}
    {message && <p role={message.kind === 'error' ? 'alert' : 'status'} style={{ color: message.kind === 'error' ? 'var(--theme-error-500)' : 'var(--theme-success-500)' }}>{message.text}</p>}

    {status && <>
      <h4 style={{ marginTop: 16 }}>Files</h4>
      {status.files.length ? <ul>{status.files.map(f => <li key={f.id}>{typeName(f.type)} · uploaded {when(f.uploadedAt)}{f.current ? '' : <span style={muted}> (replaced)</span>}</li>)}</ul>
        : <p style={muted}>No files yet.</p>}
      <h4>Steps</h4>
      {current.length ? <ul>{current.map(j => <li key={j.id}>{j.step}<span style={badge(j.state)}>{j.stateLabel}</span>
        {j.reason && <div style={muted}>{j.reason}</div>}</li>)}</ul>
        : <p style={muted}>{status.files.some(f => f.current) || status.vimeoId ? 'Waiting for the background worker to pick this up…' : 'Nothing to process yet.'}</p>}
      <h4>AI suggestions</h4>
      {pending.length ? <p><a href={`/admin/review/${pending[0].id}`}>Review the suggested summary and tags →</a></p>
        : <p style={muted}>{status.suggestions.some(s => s.current) ? 'All suggestions for this version have been reviewed.' : 'None yet. They appear here after text extraction and AI tagging finish.'}</p>}
    </>}
  </div>
}
