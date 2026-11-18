import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { readerProfile } from '../../server/library'
import ReaderUserMenu from '../../components/ReaderUserMenu'
import type { MenuLink } from '../../components/UserMenu'
import Breadcrumb from '../../components/Breadcrumb'
import Icon from '../../components/Icon'
import './styles.css'
export const metadata = { title: 'AE Library | Advisors Excel', description: 'Your governed AE resource library.' }

export default async function Layout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const profile = await readerProfile(await headers())
  // Same cookie as the Payload admin; absent means follow the device setting (handled in CSS).
  const saved = jar.get('payload-theme')?.value
  const theme = saved === 'light' || saved === 'dark' ? saved : undefined
  const menu: MenuLink[] = []
  if (profile?.isStaff) menu.push({ href: '/admin', label: 'Admin', icon: 'admin' })
  if (profile?.isAdmin) menu.push({ href: '/admin/collections/users', label: 'Manage people', icon: 'people' })
  return <html lang="en" data-theme={theme}><body>
    <a className="skip" href="#main">Skip to content</a>
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="AE Library home"><span className="brand-ae">ae</span>library</Link>
      <form className="side-search" role="search" action="/">
        <Icon name="search" size={14} /><input name="q" aria-label="Search the library" placeholder="Search" maxLength={200} />
      </form>
      <nav aria-label="Main" className="side-nav">
        <Link className="side-link active" href="/"><Icon name="library" />Content library</Link>
        {profile?.isStaff && <>
          <p className="side-label">Library team</p>
          <a className="side-link" href="/admin/review"><Icon name="review" />Review suggestions</a>
          <a className="side-link" href="/admin"><Icon name="settings" />Admin</a>
        </>}
      </nav>
      <div className="side-user">{profile
        ? <ReaderUserMenu name={profile.name} email={profile.email} links={menu} initial={theme ?? 'system'} />
        : <a className="btn-primary side-signin" href="/auth/login">Sign in</a>}</div>
    </aside>
    <div className="workspace-main">
      <header className="topbar"><Breadcrumb /></header>
      <main id="main">{children}</main>
    </div>
  </body></html>
}
