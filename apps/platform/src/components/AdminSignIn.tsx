// Shown on the Payload admin login view. Local password login is disabled; staff sign in through Auth0.
export default function AdminSignIn() {
  return <div style={{ marginBottom: 24 }}>
    <p>Sign in with your Advisors Excel account. Only provisioned editors and administrators can use the admin.</p>
    <a className="btn btn--style-primary btn--size-medium" href="/auth/login?returnTo=%2Fadmin">Sign in with Advisors Excel</a>
  </div>
}
