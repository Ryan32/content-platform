'use client'
import { useEffect, useId, useRef, useState } from 'react'

// Portal-style account menu: the signed-in person at the bottom of the navy menu opens a card with
// their identity, the areas they may use, appearance, and sign out. Shared by the reader site and the admin.
export type ThemeChoice = 'system' | 'light' | 'dark'
export type MenuLink = { href: string; label: string; icon: keyof typeof ICONS }

const ICONS = {
  admin: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  library: 'M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2.5M8 7h7M8 11h5',
  review: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  updown: 'M7 15l5 5 5-5M7 9l5-5 5 5',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5',
}
const Glyph = ({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
  stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false"><path d={ICONS[name]} /></svg>

export const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'AE'

const PALETTE = {
  light: { '--um-bg': '#ffffff', '--um-text': '#111827', '--um-muted': '#6b7280', '--um-border': '#e5e7eb', '--um-hover': '#f3f4f6', '--um-soft': '#eef0f3' },
  dark: { '--um-bg': '#1b2330', '--um-text': '#e5e7eb', '--um-muted': '#9ca3af', '--um-border': '#2b3646', '--um-hover': '#253043', '--um-soft': '#111823' },
}
// Selectors are prefixed with .ae-um twice so Payload's nav link colors cannot override the card.
const CSS = `
.ae-um{position:relative}
.ae-um .ae-um-trigger{display:flex;align-items:center;gap:10px;width:100%;padding:8px;border:0;border-radius:8px;background:transparent;color:#fff;cursor:pointer;text-align:left;font:inherit}
.ae-um .ae-um-trigger:hover,.ae-um .ae-um-trigger[aria-expanded=true]{background:rgba(255,255,255,.08)}
.ae-um .ae-um-trigger:focus-visible{outline:2px solid #6f87ff;outline-offset:2px}
.ae-um .ae-um-avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;flex:none;background:rgba(255,255,255,.14);color:#fff}
.ae-um .ae-um-who{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.3}
.ae-um .ae-um-who strong,.ae-um .ae-um-who span,.ae-um .ae-um-head div strong,.ae-um .ae-um-head div span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-um .ae-um-who strong{font-size:13px;color:#fff}
.ae-um .ae-um-who span{font-size:12px;color:rgba(255,255,255,.65)}
.ae-um .ae-um-chevron{color:rgba(255,255,255,.65);flex:none}
.ae-um .ae-um-pop{position:absolute;z-index:60;width:292px;background:var(--um-bg);color:var(--um-text);border:1px solid var(--um-border);border-radius:12px;box-shadow:0 14px 36px rgba(16,24,40,.22);padding:6px;font-size:14px;line-height:1.3;text-align:left}
.ae-um .ae-um-pop[data-placement=right]{position:fixed}
.ae-um .ae-um-pop[data-placement=up]{left:0;right:0;bottom:calc(100% + 8px);width:auto}
.ae-um .ae-um-head{display:flex;gap:10px;align-items:center;padding:8px 10px 10px}
.ae-um .ae-um-head .ae-um-avatar{background:var(--um-soft);color:var(--um-text)}
.ae-um .ae-um-head div{min-width:0}
.ae-um .ae-um-head div strong{display:block;font-size:14px;color:var(--um-text)}
.ae-um .ae-um-head div span{display:block;font-size:12px;color:var(--um-muted)}
.ae-um .ae-um-sep{height:1px;background:var(--um-border);margin:4px -6px}
.ae-um .ae-um-pop .ae-um-item{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:var(--um-text);text-decoration:none;font:inherit;font-size:14px;cursor:pointer;text-align:left}
.ae-um .ae-um-pop .ae-um-item:hover,.ae-um .ae-um-pop .ae-um-item:focus-visible{background:var(--um-hover);color:var(--um-text);text-decoration:none;outline:none}
.ae-um .ae-um-pop svg{color:var(--um-muted);flex:none}
.ae-um .ae-um-theme{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:6px 10px;color:var(--um-text)}
.ae-um .ae-um-seg{margin-left:auto;display:inline-flex;background:var(--um-soft);border-radius:8px;padding:2px}
.ae-um .ae-um-seg button{border:0;background:transparent;color:var(--um-muted);font:inherit;font-size:12px;padding:3px 8px;border-radius:6px;cursor:pointer}
.ae-um .ae-um-seg button[aria-pressed=true]{background:var(--um-bg);color:var(--um-text);font-weight:600;box-shadow:0 1px 2px rgba(16,24,40,.15)}
.ae-um form{margin:0}
`

export default function UserMenu({ name, email, links, theme, onTheme, dark, placement = 'right' }: {
  name: string; email: string; links: MenuLink[]; theme: ThemeChoice; onTheme: (choice: ThemeChoice) => void; dark: boolean; placement?: 'right' | 'up'
}) {
  const [open, setOpen] = useState(false)
  const [spot, setSpot] = useState<React.CSSProperties>({})
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useId()
  useEffect(() => {
    if (!open) return
    const click = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    // 'right' opens beside a scrolling sidebar, which would clip it (and show a sideways scrollbar), so it is placed against
    // the window instead: to the right of the trigger, or below it on narrow screens where the sidebar becomes a top bar.
    const place = () => { const r = trigger.current?.getBoundingClientRect(); if (!r || placement !== 'right') return
      setSpot(window.innerWidth <= 800 ? { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) } : { left: r.right + 14, bottom: Math.max(8, window.innerHeight - r.bottom) }) }
    place(); window.addEventListener('resize', place)
    document.addEventListener('mousedown', click); document.addEventListener('keydown', key)
    return () => { window.removeEventListener('resize', place); document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key) }
  }, [open, placement])

  return <div className="ae-um" ref={root}>
    <style>{CSS}</style>
    <button ref={trigger} type="button" className="ae-um-trigger" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}
      title={`Signed in as ${name}`}>
      <span className="ae-um-avatar" aria-hidden>{initials(name)}</span>
      <span className="ae-um-who"><strong>{name}</strong>{email && <span>{email}</span>}</span>
      <span className="ae-um-chevron"><Glyph name="updown" size={16} /></span>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Account menu</span>
    </button>
    {open && <div id={panel} className="ae-um-pop" data-placement={placement} style={{ ...(PALETTE[dark ? 'dark' : 'light'] as React.CSSProperties), ...(placement === 'right' ? spot : {}) }}>
      <div className="ae-um-head"><span className="ae-um-avatar" aria-hidden>{initials(name)}</span>
        <div><strong>{name}</strong>{email && <span>{email}</span>}</div></div>
      {links.length > 0 && <><div className="ae-um-sep" />
        {links.map(link => <a key={link.href} className="ae-um-item" href={link.href}><Glyph name={link.icon} />{link.label}</a>)}</>}
      <div className="ae-um-sep" />
      <div className="ae-um-theme"><Glyph name="moon" /><span>Appearance</span>
        <div className="ae-um-seg" role="group" aria-label="Color theme">
          {(['system', 'light', 'dark'] as const).map(option => <button key={option} type="button" aria-pressed={theme === option} onClick={() => onTheme(option)}>
            {option === 'system' ? 'Auto' : option === 'light' ? 'Light' : 'Dark'}</button>)}
        </div>
      </div>
      <div className="ae-um-sep" />
      <form method="post" action="/auth/logout"><button type="submit" className="ae-um-item"><Glyph name="logout" />Sign out</button></form>
    </div>}
  </div>
}
