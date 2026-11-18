import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { readerProfile } from '../../server/library'
import ReaderUserMenu from '../../components/ReaderUserMenu'
import type { MenuLink } from '../../components/UserMenu'
import Breadcrumb from '../../components/Breadcrumb'
import ReaderSidebar from '../../components/ReaderSidebar'
import SearchPalette from '../../components/SearchPalette'
import './styles.css'
export const metadata = { title: 'AE Library | Advisors Excel', description: 'Your governed AE resource library.' }

export default async function Layout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const profile = await readerProfile(await headers())
  // Same cookie as the Payload admin; absent means follow the device setting (handled in CSS).
  const saved = jar.get('payload-theme')?.value
  const theme = saved === 'light' || saved === 'dark' ? saved : undefined
  const menu: MenuLink[] = []
  if (profile?.isStaff) menu.push({ href: '/admin', label: 'Admin', icon: 'admin' }, { href: '/admin/review', label: 'Review suggestions', icon: 'review' })
  if (profile?.isAdmin) menu.push({ href: '/admin/collections/users', label: 'Manage people', icon: 'people' })
  return <html lang="en" data-theme={theme}><body>
    <a className="skip" href="#main">Skip to content</a>
    <ReaderSidebar>{profile
      ? <ReaderUserMenu name={profile.name} email={profile.email} links={menu} initial={theme ?? 'system'} />
      : <a className="btn-primary side-signin" href="/auth/login">Sign in</a>}</ReaderSidebar>
    <div className="workspace-main">
      <header className="topbar"><Breadcrumb /><SearchPalette /><span className="topbar-end" aria-hidden /></header>
      <main id="main">{children}</main>
    </div>
  </body></html>
}
