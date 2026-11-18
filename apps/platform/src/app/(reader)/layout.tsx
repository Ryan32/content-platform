import Link from 'next/link'
import './styles.css'
export const metadata = { title: 'Content Library | Advisors Excel', description: 'Your governed AE resource library.' }
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><a className="skip" href="#main">Skip to content</a>
    <aside className="sidebar"><Link className="brand" href="/">ADVISORS<span>EXCEL</span></Link>
      <p className="workspace">CONTENT PLATFORM</p><nav aria-label="Main"><Link className="selected" href="/">▤ &nbsp; Content library</Link></nav>
      <p className="side-note">Knowledge for your next conversation.</p></aside>
    <div className="workspace-main"><header><span>Resources <span className="crumb">/ Content library</span></span><span className="pill">AE Content</span></header>
      <main id="main">{children}</main><footer>Advisors Excel · Content library</footer></div>
  </body></html>
}
