// Replaces Payload's logout button so the browser session cookie and Auth0 session are both ended.
export default function AdminSignOut() {
  return <form method="post" action="/auth/logout" style={{ margin: 0 }}>
    <button type="submit" className="btn btn--style-secondary btn--size-small">Sign out</button>
  </form>
}
