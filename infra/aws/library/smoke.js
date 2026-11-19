// One-off ECS smoke task (runtime image) run as aecp_library_runtime in the private web security group.
// Verifies database privileges and isolation, starts the server, checks anonymous HTTP behavior, then exits.
const { Client } = require('pg')
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')

const DATABASE = 'aecp_library'
const USER = 'aecp_library_runtime'

async function main() {
  const response = await fetch('https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem', { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('RDS CA unavailable')
  const ca = await response.text()
  const file = '/tmp/aecp-rds.pem'
  writeFileSync(file, ca, { mode: 0o600 })
  const client = database => new Client({ host: process.env.PGHOST, database, user: USER, password: process.env.DB_PASSWORD, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })

  const pg = client(DATABASE)
  await pg.connect()
  try {
    const { rows: [state] } = await pg.query(`SELECT current_user AS role, ssl, version,
      has_schema_privilege(current_user, 'public', 'CREATE') AS ddl,
      has_database_privilege(current_user, current_database(), 'CREATE') AS dbcreate,
      has_table_privilege(current_user, 'public.users', 'SELECT') AS read,
      EXISTS(SELECT 1 FROM payload_migrations WHERE name='20261119_200000_vimeo_embeds') AS processing_schema,
      (SELECT count(*)::int FROM payload_migrations) AS migrations
      FROM pg_stat_ssl WHERE pid = pg_backend_pid()`)
    console.log('Runtime database check: ' + JSON.stringify(state))
    if (state?.role !== USER || !state.ssl || state.ddl || state.dbcreate || !state.read || !state.processing_schema) throw Error('Unexpected runtime database permissions')
  } finally { await pg.end() }

  // The initial CMS database must not be readable with the library runtime credential.
  const other = client('aecp')
  let isolation
  try {
    await other.connect()
    try { await other.query('SELECT 1 FROM public.users LIMIT 1'); isolation = 'readable' } catch (error) { isolation = 'denied:' + error.code }
  } catch (error) { isolation = 'connect-denied:' + error.code } finally { await other.end().catch(() => {}) }
  console.log('Initial CMS database access with library runtime role: ' + isolation)
  if (isolation === 'readable') throw Error('Library runtime role can read the initial CMS database')

  const url = new URL(`postgresql://${process.env.PGHOST}:5432/${DATABASE}`)
  url.username = USER
  url.password = process.env.DB_PASSWORD
  // Fargate sets HOSTNAME to the task's DNS name; Next.js standalone would otherwise bind only to that interface.
  const env = { ...process.env, DATABASE_URI: url.toString(), DATABASE_CA_FILE: file, NODE_EXTRA_CA_CERTS: file, HOSTNAME: '0.0.0.0', PORT: '3000' }
  delete env.DB_PASSWORD
  const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env })
  try {
    const base = 'http://127.0.0.1:3000'
    let health
    for (let i = 0; i < 60 && !health?.ok; i++) {
      try { health = await fetch(base + '/health') } catch {}
      if (!health?.ok) await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!health?.ok) throw Error('Server did not become healthy')
    const home = await fetch(base + '/')
    const users = await fetch(base + '/api/users')
    const mcp = await fetch(base + '/mcp', { method: 'POST' })
    const metadata = await fetch(base + '/.well-known/oauth-protected-resource/mcp')
    const result = { uid: process.getuid(), health: health.status, home: home.status, anonymousUsers: users.status, anonymousMcp: mcp.status, mcpChallenge: Boolean(mcp.headers.get('www-authenticate')?.includes('resource_metadata=')), resourceMetadata: metadata.status }
    console.log('HTTP smoke: ' + JSON.stringify(result))
    if (result.uid === 0 || !home.ok || ![401, 403].includes(users.status) || mcp.status !== 401 || !result.mcpChallenge || !metadata.ok) throw Error('Unexpected HTTP smoke results')
    console.log('Library smoke test passed')
  } finally { server.kill('SIGTERM') }
}

main().catch(error => { console.error('Library smoke test failed: ' + (error.code || error.message || error.name)); process.exitCode = 1 })
