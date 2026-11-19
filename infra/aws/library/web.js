// Long-running ECS entrypoint (runtime image) for aecp-dev-library-web.
// Fetches the RDS CA, verifies the runtime role over TLS, then starts the Next.js standalone server.
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

  const pg = new Client({ host: process.env.PGHOST, database: DATABASE, user: USER, password: process.env.DB_PASSWORD, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })
  await pg.connect()
  try {
    const { rows: [state] } = await pg.query(`SELECT current_user AS role, ssl, has_schema_privilege(current_user, 'public', 'CREATE') AS ddl,
      EXISTS(SELECT 1 FROM payload_migrations WHERE name='20261119_011841_library_pages') AS processing_schema,
      (SELECT count(*)::int FROM payload_migrations) AS migrations FROM pg_stat_ssl WHERE pid = pg_backend_pid()`)
    if (state?.role !== USER || !state.ssl || state.ddl || !state.processing_schema) throw Error('Unexpected runtime database state')
    console.log('Verified runtime TLS, migrated schema, and no schema CREATE privilege')
  } finally { await pg.end() }

  const url = new URL(`postgresql://${process.env.PGHOST}:5432/${DATABASE}`)
  url.username = USER
  url.password = process.env.DB_PASSWORD
  // Fargate sets HOSTNAME to the task's DNS name; bind to all interfaces so local health checks work.
  const env = { ...process.env, DATABASE_URI: url.toString(), DATABASE_CA_FILE: file, NODE_EXTRA_CA_CERTS: file, HOSTNAME: '0.0.0.0', PORT: '3000' }
  delete env.DB_PASSWORD
  const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
  server.once('error', () => { process.exitCode = 1 })
  server.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1) })
}

main().catch(error => { console.error('Library startup failed: ' + (error.code || error.message || error.name)); process.exitCode = 1 })
