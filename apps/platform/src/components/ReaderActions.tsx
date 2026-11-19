'use client'
import { useState } from 'react'
import Icon from './Icon'

/** Save / unsave an item. The server checks the reader can open it. */
export function SaveButton({ id, initial, compact = false, title }: { id: string; initial: boolean; compact?: boolean; title?: string }) {
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState(false)
  async function toggle(event: React.MouseEvent) {
    event.preventDefault(); event.stopPropagation()
    setBusy(true)
    const next = !saved
    const response = await fetch(`/library-api/saved/${id}`, { method: next ? 'PUT' : 'DELETE' }).catch(() => null)
    if (response?.ok) setSaved(next)
    setBusy(false)
  }
  const label = saved ? `Remove ${title ?? 'item'} from saved` : `Save ${title ?? 'item'}`
  return <button type="button" className={compact ? `save-icon${saved ? ' on' : ''}` : `btn-ghost small${saved ? ' on' : ''}`} onClick={toggle} disabled={busy} aria-pressed={saved} aria-label={label} title={label}>
    <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} size={compact ? 15 : 14} />{!compact && (saved ? 'Saved' : 'Save')}
  </button>
}

/** "Was this helpful?" plus "Suggest an edit" for how-to articles. */
export function Helpful({ id }: { id: string }) {
  const [state, setState] = useState<'idle' | 'thanks' | 'editing' | 'sent' | 'error'>('idle')
  const [comment, setComment] = useState('')
  async function send(kind: 'helpful' | 'not-helpful' | 'edit') {
    const response = await fetch(`/library-api/feedback/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, comment }) }).catch(() => null)
    setState(response?.ok ? (kind === 'edit' ? 'sent' : 'thanks') : 'error')
  }
  return <section className="helpful" aria-label="Feedback">
    {state === 'idle' && <><span className="helpful-q">Was this article helpful?</span>
      <button type="button" className="btn-ghost small" onClick={() => send('helpful')}>Yes</button>
      <button type="button" className="btn-ghost small" onClick={() => send('not-helpful')}>No</button>
      <span className="viewer-spacer" />
      <button type="button" className="btn-ghost small" onClick={() => setState('editing')}><Icon name="edit" size={14} />Suggest an edit</button></>}
    {state === 'thanks' && <p className="subtle">Thanks. Your answer goes to the article&apos;s owner.</p>}
    {state === 'sent' && <p className="subtle">Thanks. The owner will review your suggestion.</p>}
    {state === 'error' && <p className="subtle">That didn&apos;t send. Try again in a moment.</p>}
    {state === 'editing' && <form className="helpful-form" onSubmit={e => { e.preventDefault(); if (comment.trim()) send('edit') }}>
      <label htmlFor="suggest">What should change?</label>
      <textarea id="suggest" value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} rows={3} />
      <div className="helpful-actions"><button type="button" className="btn-ghost small" onClick={() => setState('idle')}>Cancel</button><button type="submit" className="btn-primary small">Send</button></div>
    </form>}
  </section>
}
