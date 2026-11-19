'use client'
import { useMemo, useRef, useState } from 'react'
import Icon from '../Icon'
import { locatorSeconds } from '../../domain/viewers'

/** Image with click-to-zoom. Served inline from /files/<id>; SVG is never served inline. */
export function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(false)
  return <div className={`viewer image-viewer${zoom ? ' zoomed' : ''}`}>
    <button type="button" className="image-zoom" onClick={() => setZoom(!zoom)} aria-label={zoom ? 'Fit to width' : 'Zoom to full size'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" />
      <span className="image-zoom-hint"><Icon name={zoom ? 'zoomOut' : 'zoomIn'} size={14} />{zoom ? 'Fit' : 'Zoom'}</span>
    </button>
  </div>
}

const clock = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`

/** Audio/video player for uploaded files with speed, skip and a transcript that follows playback (design: ViewerOther). */
export function FileMediaViewer({ src, kind, title, start, transcript = [] }: { src: string; kind: 'audio' | 'video'; title: string; start?: number | null; transcript?: { id: string; locator: string; text: string }[] }) {
  const media = useRef<HTMLMediaElement | null>(null)
  const [now, setNow] = useState(start ?? 0)
  const [rate, setRate] = useState(1)
  const lines = useMemo(() => transcript.map(t => ({ ...t, start: locatorSeconds(t.locator) ?? -1 })).filter(t => t.start >= 0).sort((a, b) => a.start - b.start), [transcript])
  const current = lines.findLast(l => l.start <= now + 0.5)
  const url = start ? `${src}#t=${start}` : src
  const seek = (s: number) => { if (media.current) { media.current.currentTime = s; void media.current.play().catch(() => undefined) } }
  const common = { ref: (el: HTMLMediaElement | null) => { media.current = el }, controls: true, preload: 'metadata' as const, src: url, 'aria-label': title,
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => setNow(e.currentTarget.currentTime) }
  return <div className={`viewer ${kind}-viewer${lines.length ? ' with-transcript' : ''}`}>
    <div className="media-main">
      {kind === 'audio' ? <audio {...common} /> : <video {...common} />}
      <div className="media-controls">
        <button type="button" className="btn-ghost small" onClick={() => seek(Math.max(0, now - 15))}>−15s</button>
        <button type="button" className="btn-ghost small" onClick={() => seek(now + 15)}>+15s</button>
        <button type="button" className="btn-ghost small" onClick={() => { const next = rate >= 2 ? 1 : rate + 0.25; setRate(next); if (media.current) media.current.playbackRate = next }}>{rate}×</button>
      </div>
    </div>
    {lines.length > 0 && <ol className="transcript compact" aria-label="Transcript">{lines.map(l => <li key={l.id}><button type="button" className={current?.id === l.id ? 'on' : undefined} onClick={() => seek(l.start)}>
      <span className="t">{clock(l.start)}</span><span>{l.text.length > 200 ? `${l.text.slice(0, 200)}…` : l.text}</span></button></li>)}</ol>}
  </div>
}
