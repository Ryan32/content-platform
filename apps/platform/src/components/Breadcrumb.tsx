'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { sectionById } from '../domain/navigation'

/** Top-bar breadcrumb, Portal style: Library › Content library › Resource. */
export default function Breadcrumb() {
  const path = usePathname()
  const crumbs: [string, string | null][] = [['Library', '/']]
  const section = path.startsWith('/sections/') ? sectionById(path.split('/')[2] ?? '') : undefined
  if (section) crumbs.push([section.label, null])
  else { crumbs.push(['Content library', path === '/' ? null : '/']); if (path.startsWith('/resources/')) crumbs.push(['Resource', null]) }
  return <nav className="crumbs" aria-label="Breadcrumb"><ol>
    {crumbs.map(([label, href], i) => <li key={label}>{href && i < crumbs.length - 1 ? <Link href={href}>{label}</Link> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{label}</span>}</li>)}
  </ol></nav>
}
