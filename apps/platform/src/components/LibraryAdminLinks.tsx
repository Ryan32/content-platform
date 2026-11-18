import type { ServerProps } from 'payload'
import { principalFromUser, staff } from '../domain/access'
import { Thumbnail } from './Thumbnail'

const card: React.CSSProperties = { background: 'var(--theme-elevation-0)', border: '1px solid var(--theme-elevation-150)', borderRadius: 10, padding: '16px 20px', flex: '1 1 260px' }
const muted: React.CSSProperties = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: '4px 0 12px' }

/** Dashboard guide above Payload's collection cards: what to do next, by role, with live counts. */
export default async function LibraryAdminLinks({ payload, user }: ServerProps) {
  const principal = principalFromUser(user)
  if (!payload || !staff(principal, 'editor')) return null
  const isAdmin = staff(principal, 'admin')
  const count = (collection: 'content' | 'suggestions' | 'processing-jobs' | 'users' | 'taxonomy', where?: object) =>
    payload.count({ collection, overrideAccess: true, ...(where ? { where: where as never } : {}) }).then(r => r.totalDocs).catch(() => 0)
  const [intake, drafts, pending, failed, tags, unlinked, recent] = await Promise.all([
    count('content', { state: { equals: 'intake' } }), count('content', { state: { equals: 'draft' } }),
    count('suggestions', { decision: { equals: 'pending' } }), count('processing-jobs', { state: { equals: 'failed' } }),
    count('taxonomy'), isAdmin ? count('users', { subject: { exists: false } }) : Promise.resolve(0),
    payload.find({ collection: 'content', overrideAccess: true, depth: 0, limit: 8, sort: '-updatedAt' }).then(r => r.docs).catch(() => []),
  ])
  const name = user && typeof user === 'object' && 'name' in user && user.name ? String(user.name).split(' ')[0] : null

  return <section style={{ marginBottom: 32 }}>
    <h2 style={{ marginBottom: 4 }}>{name ? `Welcome, ${name}` : 'Welcome to AE Library admin'}</h2>
    <p style={{ ...muted, fontSize: 14, maxWidth: 860 }}>This is where the library&apos;s content is added, checked, and published. Content moves through <strong>Intake → Draft → Published</strong>. Uploads are processed automatically, AI suggestions wait for an editor, and only administrators publish and decide who can see each item.</p>
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
      <div style={card}><h3>1. Add content</h3>
        <p style={muted}>Create one library item and upload its file or enter a Vimeo ID, or drop in many files at once.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><a className="btn btn--style-primary btn--size-small" href="/admin/collections/content/create" style={{ margin: 0 }}>New library item</a><a className="btn btn--style-secondary btn--size-small" href="/admin/bulk-add" style={{ margin: 0 }}>Add many files</a></div>
        <p style={muted}>{intake} in Intake · {drafts} in Draft · <a href="/admin/collections/content">All library items</a></p></div>
      <div style={card}><h3>2. Review AI suggestions</h3>
        <p style={muted}>Check the proposed summary and tags against the source text, edit, then accept or reject.</p>
        <a className="btn btn--style-primary btn--size-small" href="/admin/review" style={{ margin: 0 }}>{pending ? `Review ${pending} suggestion${pending === 1 ? '' : 's'}` : 'Open Review'}</a>
        <p style={muted}>{tags ? `${tags} approved tags` : <>No tags yet: <a href="/admin/collections/taxonomy/create">add the vocabulary</a> so AI tagging can run.</>}</p></div>
      {isAdmin && <div style={card}><h3>3. Publish and control access</h3>
        <p style={muted}>Open a Draft item, choose its audience (access profile), and set Status to Published. Manage who belongs to each audience under People.</p>
        <a className="btn btn--style-secondary btn--size-small" href="/admin/collections/content?where[state][equals]=draft" style={{ margin: 0 }}>Drafts ready to publish</a>
        <p style={muted}><a href="/admin/collections/users">People</a>{unlinked ? ` · ${unlinked} invited, not yet signed in` : ''} · <a href="/admin/collections/access-profiles">Access profiles</a></p></div>}
      <div style={card}><h3>Automation</h3>
        <p style={muted}>Text extraction, transcription, and AI tagging run in the background.</p>
        <a className="btn btn--style-secondary btn--size-small" href="/admin/automation" style={{ margin: 0 }}>{failed ? `${failed} failed step${failed === 1 ? '' : 's'} — view` : 'Automation status'}</a>
        <p style={muted}>{isAdmin ? <a href="/admin/globals/automation-settings">Automation settings</a> : 'Settings are managed by administrators.'}</p></div>
    </div>
    {recent.length > 0 && <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '28px 0 12px' }}>
        <h3 style={{ margin: 0 }}>Recently updated</h3><a href="/admin/collections/content" style={{ fontSize: 13 }}>All library items →</a></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
        {recent.map(item => <a key={item.id} href={`/admin/collections/content/${item.id}`} style={{ ...card, padding: 0, overflow: 'hidden', textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column' }}>
          <Thumbnail id={item.id} version={item.thumbnailVersion} format={item.format} title={item.title} rounded={0} />
          <span style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>{item.title}</span>
            <span style={{ ...STATUS[item.state] ?? STATUS.intake, alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>{STATUS_LABEL[item.state] ?? item.state}</span>
          </span></a>)}
      </div></>}
  </section>
}

const STATUS: Record<string, React.CSSProperties> = {
  intake: { background: '#eceef2', color: '#374151' }, draft: { background: '#fdecc8', color: '#8a5a00' },
  published: { background: '#dcf3ef', color: '#116d5b' }, archived: { background: '#e5e7eb', color: '#6b7280' },
}
const STATUS_LABEL: Record<string, string> = { intake: 'Intake', draft: 'Draft', published: 'Published', archived: 'Archived' }
