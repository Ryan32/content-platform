import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { principalFromUser, staff } from '../domain/access'

export const muted: React.CSSProperties = { color: 'var(--theme-elevation-500)', fontSize: 13 }
export const panel: React.CSSProperties = { background: 'var(--theme-elevation-0)', border: '1px solid var(--theme-elevation-150)', borderRadius: 10, padding: '14px 18px' }

/** Wraps a custom admin view in Payload's standard chrome (menu, header, theme) and enforces the editor role. */
export async function AdminPage({ props, title, children }: { props: AdminViewServerProps; title: string; children: (ctx: { isAdmin: boolean }) => React.ReactNode | Promise<React.ReactNode> }) {
  const { initPageResult, params, searchParams } = props
  const { req, permissions, visibleEntities, locale } = initPageResult
  const principal = principalFromUser(req.user)
  const body = staff(principal, 'editor')
    ? await children({ isAdmin: staff(principal, 'admin') })
    : <><h1>{title}</h1><p>Editor access required.</p></>
  return <DefaultTemplate i18n={req.i18n} locale={locale} params={params} payload={req.payload} permissions={permissions}
    searchParams={searchParams} user={req.user ?? undefined} visibleEntities={visibleEntities}>
    <Gutter><div style={{ paddingBottom: 48 }}>{body}</div></Gutter>
  </DefaultTemplate>
}
