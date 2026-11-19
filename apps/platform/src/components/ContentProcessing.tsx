'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { sendFile, UPLOAD_HINT } from './upload-client'

type Status = {
  state: string; vimeoId: string | null; pendingUploads?: number
  automation: { paused: boolean; documents: boolean; vimeo: boolean; transcription: boolean; tagging: boolean } | null
  files: { id: number; type: string; current: boolean; uploadedAt: string }[]
  jobs: { id: number; step: string; state: string; stateLabel: string; current: boolean; reason: string; updatedAt: string }[]
  suggestions: { id: number; decision: string; current: boolean; createdAt: string }[]
}
const TYPE_NAMES: Record<string, string> = { 'application/pdf': 'PDF', 'text/vtt': 'Captions (VTT)', 'text/plain': 'Text', 'audio/mpeg': 'MP3 audio',
  'video/mp4': 'MP4 video', 'audio/wav': 'WAV audio', 'audio/mp4': 'M4A audio', 'audio/flac': 'FLAC audio', 'audio/ogg': 'OGG audio', 'video/webm': 'WEBM video' }
const typeName = (mime: string) => TYPE_NAMES[mime] ?? (mime.includes('word') ? 'Word document' : mime.includes('presentation') ? 'PowerPoint' : mime.includes('sheet') ? 'Excel' : mime)
const when = (value: string) => new Date(value).toLocaleString()

/** Processing panel on a library item: upload its file, then follow extraction, transcription and AI tagging. */
export default function ContentProcessing() {
  const { id } = useDocumentInfo()
  const vimeoField = useFormFields(([fields]) => fields.vimeoId?.value)
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [chosen, setChosen] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!id) return
    const response = await fetch(`/library-api/content/${id}/processing`, { credentials: 'same-origin', cache: 'no-store' })
    if (response.ok) setStatus(await response.json())
  }, [id])
  useEffect(() => { void load() }, [load])
  const active = status?.jobs.some(j => j.current && ['queued', 'running'].includes(j.state)) || Boolean(status?.pendingUploads)
  useEffect(() => {
    if (!id) return
    const timer = setInterval(() => { void load() }, active ? 5000 : 20000)
    return () => clearInterval(timer)
  }, [id, active, load])

  if (!id) return <div className="ae-card"><div className="ae-card-title">Processing</div><p className="ae-muted" style={{ margin: 0 }}>Save this item first. Then you can upload its file or add a Vimeo ID here, and processing starts automatically.</p></div>

  async function upload() {
    const file = input.current?.files?.[0]
    if (!file) { setMessage({ kind: 'error', text: 'Choose a file first.' }); return }
    setBusy(true); setMessage(null)
    try {
      const result = await sendFile(file, { contentId: Number(id), onProgress: setProgress })
      setMessage({ kind: 'ok', text: result.large ? 'Uploaded. The file is being prepared (about a minute for large files); processing starts automatically.'
        : 'Uploaded. Processing will start within a few seconds. Reload the page to see updated source details.' })
      if (input.current) input.current.value = ''
      setChosen('')
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Upload failed. Check your connection and try again.' }) }
    setBusy(false); setProgress(null); void load()
  }

  const current = status?.jobs.filter(j => j.current) ?? []
  const pending = status?.suggestions.filter(s => s.current && s.decision === 'pending') ?? []
  const auto = status?.automation
  const off = auto && [auto.paused && 'all automation is paused', !auto.documents && 'text extraction is off', !auto.tagging && 'AI tagging is off',
    !auto.transcription && 'transcription is off', !auto.vimeo && 'Vimeo captions are off'].filter(Boolean)
  const pill = (state: string) => `ae-pill${state === 'failed' ? ' ae-pill--fail' : state === 'succeeded' ? ' ae-pill--ok' : state === 'running' ? ' ae-pill--info' : ''}`
  return <div className="ae-card" style={{ margin: '8px 0 24px' }}>
    <div className="ae-card-title">Processing</div>
    <p className="ae-muted" style={{ margin: 0 }}>Upload the original file (PDF, Word, PowerPoint, Excel, captions, text, audio or video. {UPLOAD_HINT}){vimeoField ? ', or rely on the Vimeo ID above' : ''}. The system extracts the text, transcribes audio if needed, and suggests a summary and tags. Suggestions wait in Review; nothing is published automatically.</p>
    {off && off.length > 0 && <p className="ae-notice ae-notice--warn">Note: {off.join(', ')} (Automation settings).</p>}
    {status && !['intake', 'draft'].includes(status.state)
      ? <p className="ae-muted">Files can be added while the item is in Intake or Draft.</p>
      : <label className="ae-file" style={{ marginTop: 12 }}>
        <input ref={input} type="file" aria-label="Choose the source file" accept=".pdf,.docx,.pptx,.xlsx,.vtt,.txt,.mp3,.mp4,.wav,.m4a,.flac,.ogg,.webm" disabled={busy}
          onChange={event => setChosen(event.target.files?.[0]?.name ?? '')} />
        <span className="ae-btn ae-btn--secondary ae-btn--small">Choose file</span>
        <span className="ae-file-name">{chosen || 'No file chosen'}</span>
        <button type="button" className="ae-btn ae-btn--primary ae-btn--small" onClick={event => { event.preventDefault(); void upload() }} disabled={busy || !chosen}>{busy ? (progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Uploading…') : 'Upload and process'}</button>
      </label>}
    {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`ae-notice ae-notice--${message.kind === 'error' ? 'fail' : 'ok'}`}>{message.text}</p>}

    {status && <>
      <div className="ae-label">Files</div>
      {Boolean(status.pendingUploads) && <p className="ae-notice">Large upload received; preparing the file for processing…</p>}
      {status.files.length ? <ul className="ae-rows">{status.files.map(f => <li key={f.id}><span>{typeName(f.type)}{f.current ? '' : <span className="ae-muted"> (replaced)</span>}</span>
        <span className="ae-muted">{when(f.uploadedAt)}</span></li>)}</ul>
        : <p className="ae-muted">No files yet.</p>}
      <div className="ae-label">Steps</div>
      {current.length ? <ul className="ae-rows">{current.map(j => <li key={j.id}><span>{j.step}{j.reason && <span className="ae-muted" style={{ display: 'block' }}>{j.reason}</span>}</span>
        <span className={pill(j.state)}>{j.stateLabel}</span></li>)}</ul>
        : <p className="ae-muted">{status.files.some(f => f.current) || status.vimeoId ? 'Waiting for the background worker to pick this up…' : 'Nothing to process yet.'}</p>}
      <div className="ae-label">AI suggestions</div>
      {pending.length ? <a className="ae-btn ae-btn--secondary ae-btn--small" href={`/admin/review/${pending[0].id}`}>Review the AI analysis →</a>
        : <p className="ae-muted">{status.suggestions.some(s => s.current) ? 'All suggestions for this version have been reviewed.' : 'None yet. It appears here once every file, video and text for this item has been read and analyzed.'}</p>}
    </>}
  </div>
}