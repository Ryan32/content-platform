'use client'
import { useAuth, useTheme } from '@payloadcms/ui'
import UserMenu, { type MenuLink } from './UserMenu'

/**
 * Replaces Payload's logout button at the bottom of the admin menu with the signed-in person and the shared
 * account menu. Sign out ends both the browser session cookie and the Auth0 session.
 */
export default function AdminUserMenu() {
  const { user } = useAuth()
  const { theme, autoMode, setTheme } = useTheme()
  const record = (user ?? {}) as { name?: string | null; email?: string | null; roles?: string[] | null }
  const links: MenuLink[] = [{ href: '/', label: 'Content library', icon: 'library' }, { href: '/admin/review', label: 'Review suggestions', icon: 'review' }]
  if (record.roles?.includes('admin')) links.push({ href: '/admin/collections/users', label: 'Manage people', icon: 'people' })
  return <div style={{ width: '100%', marginTop: 8 }}>
    <UserMenu name={record.name || record.email || 'Signed in'} email={record.email ?? ''} links={links} placement="up"
      theme={autoMode ? 'system' : theme} dark={theme === 'dark'}
      onTheme={choice => setTheme((choice === 'system' ? 'auto' : choice) as 'light')} />
  </div>
}
