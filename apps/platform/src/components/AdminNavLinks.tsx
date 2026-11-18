/** Extra admin navigation for pages that are not collections. */
export default function AdminNavLinks() {
  const link: React.CSSProperties = { display: 'block', padding: '4px 0', color: 'inherit', textDecoration: 'none' }
  return <div style={{ marginTop: 16 }}>
    <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 4 }}>Workflow</div>
    <a style={link} href="/admin/review">Review AI suggestions</a>
    <a style={link} href="/admin/bulk-add">Add many files</a>
    <a style={link} href="/admin/automation">Automation status</a>
    <a style={link} href="/" target="_blank" rel="noreferrer">Open the reader library ↗</a>
  </div>
}
