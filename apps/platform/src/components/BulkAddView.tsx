import type { AdminViewServerProps } from 'payload'
import { AdminPage, muted } from './AdminPage'
import BulkAdd from './BulkAdd'

/** Admin view at /admin/bulk-add. */
export default async function BulkAddView(props: AdminViewServerProps) {
  return AdminPage({ props, title: 'Add many files', children: () => <>
    <h1>Add many files</h1>
    <p style={{ maxWidth: 820 }}>Each file becomes its own library item in Intake, named from the file (you can edit titles before adding). Text extraction, transcription, and AI tagging start automatically; suggested summaries and tags wait in Review. To add a single item with more detail, use <a href="/admin/collections/content/create">New library item</a>.</p>
    <p style={muted}>Uploads run one at a time. Keep this page open until every row says Added.</p>
    <BulkAdd />
  </> })
}
