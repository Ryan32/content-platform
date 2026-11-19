'use client'
import { usePathname } from 'next/navigation'

export type NavEntry = { href: string; label: string; icon?: keyof typeof ICONS; badge?: number; exact?: boolean; also?: string[] }

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  content: 'M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h4',
  approve: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2',
  sparkle: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01',
  building: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5',
  plus: 'M12 5v14M5 12h14',
  more: 'M6 9l6 6 6-6',
}
const Glyph = ({ name }: { name: keyof typeof ICONS }) => <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false"><path d={ICONS[name]} /></svg>

/** Client half of the Manage menu: highlights the current page (including the Payload screens behind each entry). */
export default function AdminNavItems({ main, more }: { main: NavEntry[]; more: NavEntry[] }) {
  const path = usePathname() ?? ''
  const active = (e: NavEntry) => e.exact ? path === e.href : [e.href, ...(e.also ?? [])].some(h => path === h || path.startsWith(h + '/'))
  const moreActive = more.some(active)
  return <nav className="ae-nav" aria-label="Manage">
    <a className="ae-nav-brand" href="/admin"><span className="ae-nav-mark">AE</span><span><strong>Library</strong><span>Manage</span></span></a>
    <a className="ae-nav-add" href="/admin/add-content"><Glyph name="plus" />Add content</a>
    <ul className="ae-nav-list">
      {main.map(e => <li key={e.href}><a className="ae-nav-link" href={e.href} aria-current={active(e) ? 'page' : undefined}>
        {e.icon && <Glyph name={e.icon} />}<span className="ae-nav-text">{e.label}</span>
        {Boolean(e.badge) && <span className="ae-nav-badge">{e.badge! > 999 ? '999+' : e.badge}</span>}</a></li>)}
    </ul>
    {more.length > 0 && <details className="ae-nav-more" open={moreActive}>
      <summary>More<Glyph name="more" /></summary>
      <ul className="ae-nav-list">{more.map(e => <li key={e.href}><a className="ae-nav-link ae-nav-sub" href={e.href} aria-current={active(e) ? 'page' : undefined}>{e.label}</a></li>)}</ul>
    </details>}
    <a className="ae-nav-reader" href="/" target="_blank" rel="noreferrer">View library as an advisor →</a>
  </nav>
}
