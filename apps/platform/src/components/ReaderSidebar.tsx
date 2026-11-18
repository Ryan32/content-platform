'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { SECTIONS, isReadingPath, pageHref, sectionFromPath, sectionHref, topicHref } from '../domain/navigation'
import Icon from './Icon'

/**
 * Portal-style sidebar: Home and the six sections; the current section expands to its topics and familiar pages.
 * Reading pages (resources) collapse it to an icon rail, which the reader can expand. The account menu sits at the bottom.
 */
export default function ReaderSidebar({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? '/'
  const active = sectionFromPath(path)
  const reading = isReadingPath(path)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { setExpanded(false) }, [path])
  const collapsed = reading && !expanded

  return <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Library menu">
    <Link className="brand" href="/" aria-label="AE Library home">{collapsed ? <span className="brand-ae">ae</span> : <><span className="brand-ae">ae</span>library</>}</Link>
    <nav aria-label="Main" className="side-nav">
      <Link className={`side-link${path === '/' ? ' active' : ''}`} href="/" aria-current={path === '/' ? 'page' : undefined} title="Home"><Icon name="home" /><span className="side-text">Home</span></Link>
      <p className="side-label">Library</p>
      {SECTIONS.map(section => {
        const on = section.id === active
        return <div key={section.id}>
          <Link className={`side-link${on ? ' active' : ''}`} href={sectionHref(section.id)} aria-current={on ? 'page' : undefined} title={section.label}>
            <Icon name={section.icon} /><span className="side-text">{section.label}</span></Link>
          {on && !collapsed && <div className="side-sub">
            {section.topics.slice(0, 5).map(t => <Link key={t} href={topicHref(section.id, t)}>{t}</Link>)}
            <p className="side-sublabel">Pages you know</p>
            {section.familiar.map(f => <Link key={f} href={pageHref(section.id, f)}>{f}</Link>)}
          </div>}
        </div>
      })}
    </nav>
    <div className="side-foot">
      {reading && <button type="button" className="side-link side-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={!collapsed}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}><Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} /><span className="side-text">Collapse menu</span></button>}
      <div className="side-user">{children}</div>
    </div>
  </aside>
}
