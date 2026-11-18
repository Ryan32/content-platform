'use client'
import { useEffect, useState } from 'react'
import UserMenu, { type MenuLink, type ThemeChoice } from './UserMenu'

// Shared with the Payload admin, which reads the same cookie, so one choice applies everywhere.
const COOKIE = 'payload-theme'
const readTheme = (): ThemeChoice => {
  const value = document.cookie.split('; ').find(row => row.startsWith(`${COOKIE}=`))?.split('=')[1]
  return value === 'light' || value === 'dark' ? value : 'system'
}

/** Reader-site account menu; applies the theme by setting data-theme on <html> (absent = follow the device). */
export default function ReaderUserMenu({ name, email, links, initial }: { name: string; email: string; links: MenuLink[]; initial: ThemeChoice }) {
  const [theme, setTheme] = useState<ThemeChoice>(initial)
  const [deviceDark, setDeviceDark] = useState(false)
  useEffect(() => {
    setTheme(readTheme())
    const query = matchMedia('(prefers-color-scheme: dark)')
    setDeviceDark(query.matches)
    const change = () => setDeviceDark(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  function choose(next: ThemeChoice) {
    setTheme(next)
    document.cookie = next === 'system' ? `${COOKIE}=; path=/; max-age=0; SameSite=Lax` : `${COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`
    if (next === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = next
  }
  return <UserMenu name={name} email={email} links={links} theme={theme} onTheme={choose} dark={theme === 'dark' || (theme === 'system' && deviceDark)} />
}
