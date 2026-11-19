'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import { matchMarks, occurrences, type Mark, type Occurrence, type TextItem } from './pdf-find'

type PdfDoc = { numPages: number; getPage(n: number): Promise<any>; destroy(): Promise<void> }

/**
 * PDF.js viewer: page navigation, zoom, and opening at a cited page. Pages render lazily as they scroll into view.
 * The file comes from /files/<id> (authorized, inline, no-store); nothing is cached by the viewer.
 */
export default function PdfViewer({ src, title, initialPage = 1 }: { src: string; title: string; initialPage?: number }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [page, setPage] = useState(initialPage)
  const [scale, setScale] = useState(1)
  const [placeholder, setPlaceholder] = useState<{ w: number; h: number } | null>(null)
  const [thumbs, setThumbs] = useState(false)
  const [find, setFind] = useState('')
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<Occurrence[] | null>(null)
  const [hit, setHit] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false; let loaded: PdfDoc | null = null
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
        loaded = await pdfjs.getDocument({ url: src, withCredentials: true, enableXfa: false }).promise as unknown as PdfDoc
        if (cancelled) { void loaded.destroy(); return }
        // Size every page like page 1 until it renders, so jumping to a cited page lands in the right place.
        const first = (await loaded.getPage(1)).getViewport({ scale: 1 })
        const width = scroller.current?.clientWidth ?? 800
        const fit = Math.min(1.6, (width - 32) / first.width)
        setPlaceholder({ w: Math.floor(first.width * fit), h: Math.floor(first.height * fit) })
        setDoc(loaded); setState('ready')
      } catch { if (!cancelled) setState('error') }
    })()
    return () => { cancelled = true; void loaded?.destroy() }
  }, [src])

  useEffect(() => { if (doc && initialPage > 1) requestAnimationFrame(() => scrollTo(Math.min(initialPage, doc.numPages), 'auto')) }, [doc]) // eslint-disable-line react-hooks/exhaustive-deps

  function scrollTo(n: number, behavior: ScrollBehavior = 'smooth') {
    const target = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`)
    if (target && scroller.current) scroller.current.scrollTo({ top: target.offsetTop - 8, behavior })
    setPage(n)
  }
  function onScroll() {
    const box = scroller.current
    if (!box) return
    const pages = Array.from(box.querySelectorAll<HTMLElement>('[data-page]'))
    const mid = box.scrollTop + box.clientHeight / 3
    const current = pages.findLast(p => p.offsetTop <= mid)
    if (current) setPage(Number(current.dataset.page))
  }

  async function search(event: React.FormEvent) {
    event.preventDefault()
    const needle = find.trim().toLowerCase()
    if (!doc || !needle) { setHits(null); setTerm(''); return }
    if (hits && hits.length) { const next = (hit + 1) % hits.length; setHit(next); scrollTo(hits[next].page); return }
    const found: Occurrence[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const items = (await (await doc.getPage(n)).getTextContent()).items as TextItem[]
      const onPage = occurrences(items, needle, n)
      // A phrase split across text runs still finds its page, without a highlight box.
      if (!onPage.length && items.map(i => i.str ?? '').join(' ').toLowerCase().includes(needle)) onPage.push({ page: n, item: -1, start: -1 })
      found.push(...onPage)
    }
    setTerm(needle); setHits(found); setHit(0)
    if (found.length) scrollTo(found[0].page)
  }
  const current = hits?.length ? hits[hit] : null

  if (state === 'error') return <div className="viewer-fallback"><Icon name="info" />This PDF couldn&apos;t be shown here. <a href={src} target="_blank" rel="noopener">Open it in a new tab</a>.</div>
  return <div className="viewer pdf-viewer" aria-label={`PDF: ${title}`}>
    <div className="viewer-bar">
      <button type="button" className="btn-ghost small" onClick={() => scrollTo(Math.max(1, page - 1))} disabled={!doc || page <= 1} aria-label="Previous page"><Icon name="chevronLeft" /></button>
      <label className="viewer-page">Page <input type="number" min={1} max={doc?.numPages ?? 1} value={page}
        onChange={e => { const n = Number(e.target.value); if (doc && n >= 1 && n <= doc.numPages) scrollTo(n) }} /> of {doc?.numPages ?? '…'}</label>
      <button type="button" className="btn-ghost small" onClick={() => doc && scrollTo(Math.min(doc.numPages, page + 1))} disabled={!doc || page >= (doc?.numPages ?? 1)} aria-label="Next page"><Icon name="chevronRight" /></button>
      <button type="button" className={`btn-ghost small${thumbs ? ' on' : ''}`} onClick={() => setThumbs(!thumbs)} aria-pressed={thumbs} aria-label="Page thumbnails"><Icon name="grid" /></button>
      <form className="viewer-find" onSubmit={search} role="search">
        <Icon name="search" size={13} /><input value={find} onChange={e => { setFind(e.target.value); setHits(null); setTerm('') }} placeholder="Find in document" aria-label="Find in document" />
        {hits && <span className="small-text subtle">{hits.length ? `${hit + 1} of ${hits.length}` : 'No matches'}</span>}
      </form>
      <span className="viewer-spacer" />
      <button type="button" className="btn-ghost small" onClick={() => setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))} aria-label="Zoom out"><Icon name="zoomOut" /></button>
      <span className="viewer-zoom">{Math.round(scale * 100)}%</span>
      <button type="button" className="btn-ghost small" onClick={() => setScale(s => Math.min(3, +(s + 0.25).toFixed(2)))} aria-label="Zoom in"><Icon name="zoomIn" /></button>
      <a className="btn-ghost small" href={src} target="_blank" rel="noopener" title="Open in a new tab"><Icon name="external" /></a>
    </div>
    <div className="viewer-body">
    {thumbs && doc && <nav className="pdf-thumbs" aria-label="Pages">{Array.from({ length: doc.numPages }, (_, i) => <button key={i} type="button" className={page === i + 1 ? 'on' : undefined} onClick={() => scrollTo(i + 1)} aria-label={`Page ${i + 1}`}>
      <PdfPage doc={doc} n={i + 1} scale={0.18} placeholder={placeholder ? { w: placeholder.w, h: placeholder.h } : null} thumb /><span>{i + 1}</span></button>)}</nav>}
    <div className="viewer-pages" ref={scroller} onScroll={onScroll}>
      {state === 'loading' && <p className="viewer-loading">Loading PDF…</p>}
      {doc && Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i + 1} doc={doc} n={i + 1} scale={scale} placeholder={placeholder}
        term={term} current={current?.page === i + 1 ? current : null} />)}
    </div>
    </div>
  </div>
}

function PdfPage({ doc, n, scale, placeholder, thumb = false, term = '', current = null }: { doc: PdfDoc; n: number; scale: number; placeholder: { w: number; h: number } | null; thumb?: boolean
  term?: string; current?: Occurrence | null }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(n <= 2)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [viewport, setViewport] = useState<{ transform: number[]; width: number; height: number; scale: number } | null>(null)
  const [marks, setMarks] = useState<Mark[]>([])

  useEffect(() => {
    const el = box.current
    if (!el || visible) return
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '600px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let task: { cancel(): void; promise: Promise<void> } | null = null; let cancelled = false
    ;(async () => {
      const page = await doc.getPage(n)
      if (cancelled || !canvas.current) return
      const width = thumb ? 120 / scale : box.current?.parentElement?.clientWidth ?? 800
      const base = page.getViewport({ scale: 1 })
      const fit = Math.min(1.6, (width - 32) / base.width) * scale
      const viewport = page.getViewport({ scale: fit })
      const ratio = window.devicePixelRatio || 1
      const c = canvas.current
      c.width = Math.floor(viewport.width * ratio); c.height = Math.floor(viewport.height * ratio)
      c.style.width = `${Math.floor(viewport.width)}px`; c.style.height = `${Math.floor(viewport.height)}px`
      setSize({ w: Math.floor(viewport.width), h: Math.floor(viewport.height) })
      if (!thumb) setViewport({ transform: viewport.transform, width: viewport.width, height: viewport.height, scale: viewport.scale })
      task = page.render({ canvas: c, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      try { await task!.promise } catch { /* cancelled */ }
    })()
    return () => { cancelled = true; task?.cancel() }
  }, [doc, n, scale, visible])

  useEffect(() => {
    if (!viewport || !term) { setMarks([]); return }
    let cancelled = false
    ;(async () => {
      const items = (await (await doc.getPage(n)).getTextContent()).items as TextItem[]
      if (!cancelled) setMarks(matchMarks(items, term, viewport))
    })()
    return () => { cancelled = true }
  }, [doc, n, term, viewport])

  // Bring the current match into view once its box is known (the page itself is scrolled to by the viewer first).
  useEffect(() => {
    const mark = current && marks.find(m => m.item === current.item && m.start === current.start)
    const page = box.current, scroller = page?.closest<HTMLElement>('.viewer-pages')
    if (!mark || !page || !scroller) return
    scroller.scrollTo({ top: page.offsetTop + mark.top * page.clientHeight - scroller.clientHeight / 3, behavior: 'smooth' })
  }, [current, marks])

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`
  return <div className={thumb ? 'pdf-page thumb' : 'pdf-page'} data-page={thumb ? undefined : n} ref={box} style={size ? { width: size.w, minHeight: size.h } : placeholder ? { width: placeholder.w * scale, minHeight: placeholder.h * scale } : { minHeight: 600 }}>
    <canvas ref={canvas} aria-label={`Page ${n}`} />
    {marks.length > 0 && <div className="pdf-marks" aria-hidden>{marks.map(m => <span key={`${m.item}:${m.start}`}
      className={current && m.item === current.item && m.start === current.start ? 'pdf-mark current' : 'pdf-mark'}
      style={{ left: pct(m.left), top: pct(m.top), width: pct(m.width), height: pct(m.height) }} />)}</div>}
  </div>
}
