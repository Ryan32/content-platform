// Long-running ECS entrypoint (operations image) for aecp-dev-library-worker.
// Verifies the runtime role over TLS, then runs the processing loop: honor Automation settings, queue the next
// automatic steps, and work one job at a time. Secrets arrive from ECS and are passed only to the child process.
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
      EXISTS(SELECT 1 FROM payload_migrations WHERE name='20261119_040000_semantic_index') AS schema_ready
      FROM pg_stat_ssl WHERE pid = pg_backend_pid()`)
    if (state?.role !== USER || !state.ssl || state.ddl || !state.schema_ready) throw Error('Unexpected worker database state')
    console.log('Verified worker TLS, current schema, and no schema CREATE privilege')
  } finally { await pg.end() }

  const url = new URL(`postgresql://${process.env.PGHOST}:5432/${DATABASE}`)
  url.username = USER
  url.password = process.env.DB_PASSWORD
  const env = { ...process.env, DATABASE_URI: url.toString(), DATABASE_CA_FILE: file, NODE_EXTRA_CA_CERTS: file, PROCESSING_ENVIRONMENT: 'development' }
  delete env.DB_PASSWORD
  const target = `${url.hostname}:${url.port}${url.pathname}` // Must equal the CLI's expected host:port/database.
  const worker = spawn(process.execPath, ['node_modules/payload/bin.js', 'run', 'src/processing/cli.ts', 'loop', target], { stdio: 'inherit', env })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => worker.kill(signal))
  worker.once('error', () => { process.exitCode = 1 })
  worker.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1) })
}

main().catch(error => { console.error('Worker startup failed: ' + (error.code || error.message || error.name)); process.exitCode = 1 })
