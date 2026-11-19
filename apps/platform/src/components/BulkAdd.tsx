'use client'
import { sendFile, UploadFailure, UPLOAD_HINT } from './upload-client'
import { useRef, useState } from 'react'

const TYPES = '.pdf,.docx,.pptx,.xlsx,.vtt,.txt,.mp3,.mp4,.wav,.m4a,.flac,.ogg,.webm'
const MAX_FILES = 50
const MAX_BYTES = 50 * 1024 * 1024
type Row = { key: string; file: File; title: string; status: 'ready' | 'uploading' | 'done' | 'error'; message?: string; contentId?: number }
const titleFrom = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled'
const size = (bytes: number) => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const cell: React.CSSProperties = { padding: '8px 12px 8px 0', borderBottom: '1px solid var(--theme-elevation-100)', verticalAlign: 'middle', textAlign: 'left' }
const input: React.CSSProperties = { width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--theme-elevation-150)', background: 'var(--theme-input-bg)', color: 'var(--theme-text)' }

/** Drop many files; each becomes its own Intake library item and starts processing. Uploads run one at a time. */
export default function BulkAdd() {
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const update = (key: string, patch: Partial<Row>) => setRows(current => current.map(r => r.key === key ? { ...r, ...patch } : r))

  function add(list: FileList | null) {
    if (!list) return
    const accepted = TYPES.split(',')
    const next = [...list].slice(0, Math.max(0, MAX_FILES - rows.length)).map(file => {
      const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
      const limit = /^\.(mp3|mp4|wav|flac|m4a|ogg|webm)$/.test(ext) ? 2 * 1024 ** 3 : ext === '.pdf' ? 500 * 1024 ** 2 : MAX_BYTES
      const problem = !accepted.includes(ext) ? 'Unsupported file type.' : file.size > limit ? `Larger than ${limit === MAX_BYTES ? '50 MB' : limit > MAX_BYTES * 20 ? '2 GB' : '500 MB'}.` : !file.size ? 'Empty file.' : undefined
      return { key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, title: titleFrom(file.name),
        status: problem ? 'error' : 'ready', message: problem } as Row
    })
    setRows(current => [...current, ...next])
  }

  async function start() {
    setRunning(true)
    for (const row of rows.filter(r => r.status === 'ready')) {
      update(row.key, { status: 'uploading', message: undefined })
      try {
        const result = await sendFile(row.file, { title: row.title, onProgress: f => update(row.key, { message: `${Math.round(f * 100)}%` }) })
        update(row.key, { status: 'done', contentId: result.contentId, message: undefined })
      } catch (e) {
        update(row.key, { status: 'error', message: e instanceof Error ? e.message : 'Upload failed. Check your connection.', contentId: e instanceof UploadFailure ? e.contentId : undefined })
      }
    }
    setRunning(false)
  }

  const ready = rows.filter(r => r.status === 'ready').length
  const done = rows.filter(r => r.status === 'done').length
  return <div>
    <div onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files) }}
      style={{ border: `2px dashed ${dragging ? 'var(--theme-success-500)' : 'var(--theme-elevation-250)'}`, borderRadius: 8, padding: 32, textAlign: 'center', margin: '16px 0' }}>
      <p style={{ margin: '0 0 12px' }}>Drag files here, or</p>
      <button type="button" className="btn btn--style-secondary btn--size-small" style={{ margin: 0 }} onClick={() => picker.current?.click()} disabled={running}>Choose files</button>
      <input ref={picker} type="file" multiple accept={TYPES} hidden onChange={e => { add(e.target.files); e.target.value = '' }} />
      <p style={{ color: 'var(--theme-elevation-500)', fontSize: 13, margin: '12px 0 0' }}>Up to {MAX_FILES} files. {UPLOAD_HINT} PDF, Word, PowerPoint, Excel, captions, text, audio, or video.</p>
    </div>
    {rows.length > 0 && <>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={cell}>File</th><th style={cell}>Title for the library item</th><th style={cell}>Status</th><th style={cell}></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.key}>
          <td style={cell}>{r.file.name}<div style={{ fontSize: 12, color: 'var(--theme-elevation-500)' }}>{size(r.file.size)}</div></td>
          <td style={cell}><input aria-label={`Title for ${r.file.name}`} style={input} value={r.title} maxLength={200} disabled={r.status !== 'ready'} onChange={e => update(r.key, { title: e.target.value })} /></td>
          <td style={cell}>{r.status === 'ready' ? 'Ready' : r.status === 'uploading' ? `Uploading… ${r.message ?? ''}` : r.status === 'done' ? <>Added · processing <a href={`/admin/collections/content/${r.contentId}`}>Open</a></>
            : <span style={{ color: 'var(--theme-error-500)' }}>{r.message}{r.contentId ? <> <a href={`/admin/collections/content/${r.contentId}`}>Open item</a></> : null}</span>}</td>
          <td style={cell}>{r.status !== 'uploading' && r.status !== 'done' && <button type="button" className="btn btn--style-secondary btn--size-small" style={{ margin: 0 }} disabled={running}
            onClick={() => setRows(current => current.filter(x => x.key !== r.key))}>Remove</button>}</td>
        </tr>)}</tbody>
      </table>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
        <button type="button" className="btn btn--style-primary" style={{ margin: 0 }} disabled={running || !ready} onClick={start}>
          {running ? 'Adding…' : `Add ${ready} item${ready === 1 ? '' : 's'} and start processing`}</button>
        {done > 0 && !running && <span>{done} added. Track them on <a href="/admin/automation">Automation status</a>; suggestions arrive in <a href="/admin/review">Review</a>.</span>}
      </div>
    </>}
  </div>
}
