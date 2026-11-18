'use client'
import { useState } from 'react'
import Icon from '../Icon'

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

/** Native audio/video player for uploaded files, opening at a cited time when there is one. */
export function FileMediaViewer({ src, kind, title, start }: { src: string; kind: 'audio' | 'video'; title: string; start?: number | null }) {
  const url = start ? `${src}#t=${start}` : src
  return <div className={`viewer ${kind}-viewer`}>
    {kind === 'audio' ? <audio controls preload="metadata" src={url} aria-label={title} /> : <video controls preload="metadata" src={url} aria-label={title} />}
  </div>
}
