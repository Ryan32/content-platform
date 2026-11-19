'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { sectionById } from '../domain/navigation'

const PAGES: Record<string, string> = { '/search': 'Search', '/saved': 'Saved', '/news': 'News', '/carriers': 'Carriers A–Z' }

/** Top-bar breadcrumb, Portal style. Detail pages show their own section trail in the page header. */
export default function Breadcrumb() {
  const path = usePathname()
  const crumbs: [string, string | null][] = [['Library', path === '/' ? null : '/']]
  const section = path.startsWith('/sections/') ? sectionById(path.split('/')[2] ?? '') : undefined
  if (section) crumbs.push([section.label, null])
  else if (path.startsWith('/carriers/')) crumbs.push(['Carriers', '/carriers'], ['Carrier', null])
  else if (path.startsWith('/kits/')) crumbs.push(['Kit', null])
  else if (path.startsWith('/resources/')) crumbs.push(['Resource', null])
  else if (PAGES[path]) crumbs.push([PAGES[path], null])
  else if (path === '/') crumbs[0] = ['Home', null]
  return <nav className="crumbs" aria-label="Breadcrumb"><ol>
    {crumbs.map(([label, href], i) => <li key={label}>{href && i < crumbs.length - 1 ? <Link href={href}>{label}</Link> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{label}</span>}</li>)}
  </ol></nav>
}
