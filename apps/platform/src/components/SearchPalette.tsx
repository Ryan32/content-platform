'use client'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { FILTERS, groupSuggestions, highlight, toggleFilter, type SuggestItem, type SuggestKind } from '../domain/suggest'
import Icon, { type IconName } from './Icon'

const KIND_ICON: Record<SuggestKind, IconName> = { document: 'file', video: 'video', slides: 'slides', howto: 'howto', page: 'page' }

/**
 * Top-bar search plus the Ctrl K window. Typing shows live, authorized results grouped by kind, with one row of
 * type chips. Enter opens the selected result; the last row opens the full results page. No AI runs while typing.
 */
export default function SearchPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SuggestItem[]>([])
  const [selected, setSelected] = useState<SuggestKind[]>([])
  const [active, setActive] = useState(0)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target?.closest('input, textarea, select, [contenteditable=true]')
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setOpen(true) }
      else if (e.key === '/' && !typing) { e.preventDefault(); setOpen(true) }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  useEffect(() => { if (open) requestAnimationFrame(() => input.current?.focus()) }, [open])

  // Debounced live search; stale responses are ignored.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) { setResults([]); setState('idle'); return }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setState('loading')
      try {
        const response = await fetch(`/library-api/suggest?${new URLSearchParams({ q })}`, { signal: controller.signal, credentials: 'same-origin' })
        if (!response.ok) throw new Error(String(response.status))
        const body = await response.json() as { results: SuggestItem[] }
        setResults(body.results); setActive(0); setState('idle')
      } catch (error) { if ((error as Error).name !== 'AbortError') setState('error') }
    }, 140)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, open])

  const view = useMemo(() => groupSuggestions(results, selected), [results, selected])
  const allHref = `/?${new URLSearchParams({ q: query.trim() })}`
  const rows = view.flat.length + (query.trim() ? 1 : 0)
  const close = useCallback(() => { setOpen(false); setActive(0) }, [])
  const go = (href: string) => { close(); router.push(href) }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(rows - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (active < view.flat.length) go(view.flat[active].href)
      else if (query.trim()) go(allHref)
    }
  }

  let index = -1
  return <>
    <button type="button" className="top-search" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <Icon name="search" size={15} /><span>Search the Library</span><kbd>Ctrl K</kbd>
    </button>
    {open && <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search the Library">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input ref={input} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Search the Library"
            maxLength={200} autoComplete="off" spellCheck={false} role="combobox" aria-expanded="true" aria-controls={listId}
            aria-activedescendant={view.flat.length ? `${listId}-${active}` : undefined} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-chips" role="group" aria-label="Show only">
          {FILTERS.map(f => {
            const on = f.id === 'all' ? selected.length === 0 : selected.includes(f.id as SuggestKind)
            return <button key={f.id} type="button" aria-pressed={on} onClick={() => { setSelected(s => toggleFilter(s, f.id)); setActive(0); input.current?.focus() }}>
              {f.label}{query.trim() && <span>{view.counts[f.id]}</span>}</button>
          })}
        </div>
        <div className="palette-results" id={listId} role="listbox" aria-label="Results">
          {!query.trim() && <p className="palette-note">Type a title, carrier, form or topic. Press <kbd>/</kbd> or <kbd>Ctrl K</kbd> from any page.</p>}
          {query.trim() && state === 'error' && <p className="palette-note">Search is unavailable right now. Press Enter to try the full results page.</p>}
          {query.trim() && state !== 'error' && view.flat.length === 0 && state === 'idle' && <p className="palette-note">
            {selected.length ? 'Nothing in the selected types. Turn a filter off to see more.' : 'No matches yet. Try other words.'}</p>}
          {view.groups.map(group => <div key={group.label}>
            <p className="palette-group">{group.label}</p>
            {group.items.map(item => {
              index += 1
              const i = index
              const [before, match, after] = highlight(item.title, query)
              return <a key={item.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} href={item.href}
                className="palette-row" onMouseEnter={() => setActive(i)} onClick={e => { e.preventDefault(); go(item.href) }}>
                <span className="palette-icon"><Icon name={KIND_ICON[item.kind]} /></span>
                <span className="palette-text"><span>{before}<mark>{match}</mark>{after}</span><small>{item.meta}</small></span>
                {i === active && <kbd>Enter</kbd>}
              </a>
            })}
          </div>)}
        </div>
        {query.trim() && <a className={`palette-all${active === view.flat.length ? ' on' : ''}`} href={allHref}
          onMouseEnter={() => setActive(view.flat.length)} onClick={e => { e.preventDefault(); go(allHref) }}>
          <Icon name="search" />See all results for “{query.trim()}”</a>}
        <div className="palette-foot"><span>↑ ↓ move</span><span>Enter open</span><span>Esc close</span><span className="palette-foot-end">Only shows what you have access to</span></div>
      </div>
    </div>}
  </>
}
