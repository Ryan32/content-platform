// One-off ECS task (operations image) run as aecp_library_migration.
// Applies the versioned Payload migrations twice to prove idempotency, then verifies the migration ledger.
const { Client } = require('pg')
const { spawnSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')

const DATABASE = 'aecp_library'
const USER = 'aecp_library_migration'
const RUNTIME = 'aecp_library_runtime'
const EXPECTED = ['20261118_030155_foundation', '20261118_041309_import_adapter']

async function main() {
  const response = await fetch('https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem', { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('RDS CA unavailable')
  const ca = await response.text()
  const file = '/tmp/aecp-rds.pem'
  writeFileSync(file, ca, { mode: 0o600 })
  const client = () => new Client({ host: process.env.PGHOST, database: DATABASE, user: USER, password: process.env.DB_PASSWORD, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })

  const pg = client()
  await pg.connect()
  try {
    const tls = await pg.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')
    if (tls.rows[0]?.ssl !== true) throw Error('No TLS')
    await pg.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${RUNTIME}`)
    await pg.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${RUNTIME}`)
  } finally { await pg.end() }

  const url = new URL(`postgresql://${process.env.PGHOST}:5432/${DATABASE}`)
  url.username = USER
  url.password = process.env.DB_PASSWORD
  const env = { ...process.env, DATABASE_URI: url.toString(), DATABASE_CA_FILE: file, NODE_EXTRA_CA_CERTS: file }
  delete env.DB_PASSWORD
  for (const pass of [1, 2]) {
    console.log(`Payload migrate pass ${pass}`)
    const result = spawnSync(process.execPath, ['node_modules/payload/bin.js', 'migrate'], { stdio: 'inherit', env })
    if (result.status !== 0) throw Error(`Payload migrate pass ${pass} failed`)
  }

  const verify = client()
  await verify.connect()
  try {
    const { rows } = await verify.query('SELECT name, batch FROM payload_migrations ORDER BY id')
    const ledger = rows.map(row => `${row.name}:${row.batch}`)
    console.log('Migration ledger: ' + ledger.join(', '))
    if (ledger.join(',') !== EXPECTED.map(name => `${name}:1`).join(',')) throw Error('Unexpected migration ledger')
  } finally { await verify.end() }
  console.log('Verified TLS, applied library migrations, and confirmed rerun was a no-op')
}

main().catch(error => { console.error('Library migration failed: ' + (error.code || error.message || error.name)); process.exitCode = 1 })
