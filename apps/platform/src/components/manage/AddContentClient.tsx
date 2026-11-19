'use client'
import { useEffect, useRef, useState } from 'react'
import { sendFile, UploadFailure, UPLOAD_HINT } from '../upload-client'

const TYPES = '.pdf,.docx,.pptx,.xlsx,.vtt,.txt,.mp3,.mp4,.wav,.m4a,.flac,.ogg,.webm'
const titleFrom = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled'

/** Step 1 of Add content: one file, a Vimeo link, or a how-to article written here. Creates the item and moves to step 2. */
export function UploadStep() {
  const [mode, setMode] = useState<'file' | 'vimeo' | 'article'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [vimeo, setVimeo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const go = (id: number) => { window.location.href = `/admin/add-content?id=${id}&step=2` }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      if (mode === 'file') {
        if (!file) throw new Error('Choose a file.')
        try {
          const result = await sendFile(file, { title: title || titleFrom(file.name), onProgress: setProgress })
          return go(result.contentId)
        } catch (e) {
          // The item exists but its file did not arrive: continue to it so the editor can retry from its Processing panel.
          if (e instanceof UploadFailure && e.contentId) return go(e.contentId)
          throw e
        }
      }
      const id = /(\d{6,})/.exec(vimeo)?.[1]
      if (mode === 'vimeo' && !id) throw new Error('Paste the Vimeo link or the number at the end of it.')
      if (!title.trim()) throw new Error('Give it a title.')
      const data = mode === 'vimeo' ? { title: title.trim(), format: 'video', vimeoId: id } : { title: title.trim(), format: 'article', kind: 'howto' }
      const response = await fetch('/api/content', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.errors?.[0]?.message ?? 'Could not create the item.')
      if (mode === 'article') { window.location.href = `/admin/collections/content/${result.doc.id}`; return }
      go(result.doc.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); setBusy(false) }
  }

  return <form className="ae-card ae-upload" onSubmit={submit}>
    <nav className="ae-chips" aria-label="What are you adding?">
      <button type="button" aria-current={mode === 'file' ? 'page' : undefined} onClick={() => setMode('file')}>Upload a file</button>
      <button type="button" aria-current={mode === 'vimeo' ? 'page' : undefined} onClick={() => setMode('vimeo')}>Vimeo video</button>
      <button type="button" aria-current={mode === 'article' ? 'page' : undefined} onClick={() => setMode('article')}>Write a how-to article</button>
    </nav>
    {mode === 'file' && <div className={`ae-drop${dragging ? ' on' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) { setFile(f); if (!title) setTitle(titleFrom(f.name)) } }}>
      <strong>{file ? file.name : 'Drop a file here'}</strong>
      <span className="ae-muted">{file ? `${(file.size / 1048576).toFixed(1)} MB` : `PDF, Word, PowerPoint, Excel, captions, text, audio or video. ${UPLOAD_HINT}`}</span>
      <button type="button" className="ae-btn ae-btn--secondary ae-btn--small" onClick={() => picker.current?.click()}>{file ? 'Replace' : 'Choose a file'}</button>
      <input ref={picker} type="file" accept={TYPES} hidden onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); if (!title) setTitle(titleFrom(f.name)) } }} />
    </div>}
    {mode === 'vimeo' && <label className="ae-field"><span>Vimeo link</span><input value={vimeo} onChange={e => setVimeo(e.target.value)} placeholder="https://vimeo.com/123456789" /></label>}
    {mode === 'article' && <p className="ae-muted">You&apos;ll write the article in the editor. Use ## for headings, numbered lists for steps, and &gt; for a callout. AI still suggests where it belongs.</p>}
    <label className="ae-field"><span>Title {mode === 'file' && <em className="ae-muted">(AI can improve it)</em>}</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} /></label>
    {error && <p role="alert" className="ae-notice ae-notice--fail">{error}</p>}
    <div className="ae-actions"><span className="ae-muted">AI reads it, writes a summary and takeaways, and suggests where it belongs. Nothing goes live until it&apos;s approved.</span>
      <button className="ae-btn ae-btn--primary" disabled={busy}>{busy ? (progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Uploading…') : 'Continue'}</button></div>
  </form>
}

/** Reloads the page every few seconds while AI is still working, so step 2 fills in without clicking. */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  useEffect(() => { const t = setTimeout(() => window.location.reload(), seconds * 1000); return () => clearTimeout(t) }, [seconds])
  return <p className="ae-muted" role="status">Working on it… this page updates by itself.</p>
}
