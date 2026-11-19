'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon'
import { locatorSeconds } from '../../domain/viewers'

type Line = { id: string; start: number; text: string }
const clock = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`

/**
 * Vimeo embed with a transcript that follows playback (design: ViewerVideo). Uses Vimeo's postMessage player API directly,
 * so no extra dependency. Transcript lines are the item's reviewed citable passages that carry a time.
 */
export default function VimeoViewer({ vimeoId, hash, title, passages, start, path }: { vimeoId: string; hash?: string; title: string; passages: { id: string; locator: string; text: string }[]; start?: number | null; path: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [now, setNow] = useState(start ?? 0)
  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState(false)
  const lines = useMemo<Line[]>(() => passages.map(p => ({ id: p.id, start: locatorSeconds(p.locator) ?? -1, text: p.text })).filter(l => l.start >= 0).sort((a, b) => a.start - b.start), [passages])
  const post = (method: string, value?: unknown) => frame.current?.contentWindow?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), 'https://player.vimeo.com')

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== 'https://player.vimeo.com') return
      let data: { event?: string; data?: { seconds?: number } }
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data } catch { return }
      if (data.event === 'ready') { post('addEventListener', 'timeupdate'); post('addEventListener', 'playProgress') }
      if ((data.event === 'timeupdate' || data.event === 'playProgress') && typeof data.data?.seconds === 'number') setNow(data.data.seconds)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const current = lines.findLast(l => l.start <= now + 0.5)
  const shown = filter ? lines.filter(l => l.text.toLowerCase().includes(filter.toLowerCase())) : lines
  async function copyAt() {
    const url = new URL(path, window.location.origin); url.searchParams.set('t', String(Math.floor(now)))
    try { await navigator.clipboard.writeText(url.toString()) } catch { /* ignore */ }
    setCopied(true); setTimeout(() => setCopied(false), 1600)
  }
  // Unlisted videos play only with their privacy hash.
  const src = `https://player.vimeo.com/video/${vimeoId}?${hash && /^[0-9a-f]{6,40}$/.test(hash) ? `h=${hash}&` : ''}dnt=1&api=1&player_id=library${start ? `#t=${Math.floor(start)}s` : ''}`

  return <div className={`video-viewer-wrap${lines.length ? ' with-transcript' : ''}`}>
    <div className="video-main">
      <div className="video-bar"><span className="small-text subtle">{lines.length ? 'Transcript from the reviewed captions' : 'Video'}</span><span className="viewer-spacer" />
        <button type="button" className="btn-ghost small" onClick={copyAt}><Icon name={copied ? 'check' : 'link'} size={14} />{copied ? 'Copied' : `Link at ${clock(now)}`}</button></div>
      <iframe ref={frame} className="media-preview" title={title} src={src} allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
    </div>
    {lines.length > 0 && <aside className="transcript" aria-label="Transcript">
      <div className="transcript-head"><strong>Transcript</strong>
        <label className="search-field small"><Icon name="search" size={13} /><span className="sr-only">Search the transcript</span>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search the transcript" /></label></div>
      <ol>{shown.map(l => <li key={l.id}><button type="button" className={current?.id === l.id ? 'on' : undefined} onClick={() => { post('setCurrentTime', l.start); post('play'); setNow(l.start) }}>
        <span className="t">{clock(l.start)}</span><span>{l.text.length > 220 ? `${l.text.slice(0, 220)}…` : l.text}</span></button></li>)}</ol>
    </aside>}
  </div>
}
