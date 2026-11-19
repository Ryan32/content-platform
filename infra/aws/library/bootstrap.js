// One-off ECS task (operations image) run with the RDS master secret.
// Creates the isolated aecp_library database and its two login roles; the existing aecp database is not modified.
const { Client } = require('pg')

const DATABASE = 'aecp_library'
const RUNTIME = 'aecp_library_runtime'
const MIGRATION = 'aecp_library_migration'

async function main() {
  const response = await fetch('https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem', { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('RDS CA unavailable')
  const ca = await response.text()
  const master = JSON.parse(process.env.DB_MASTER)
  const connect = async database => {
    const client = new Client({ host: process.env.PGHOST, database, user: master.username, password: master.password, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })
    await client.connect()
    const tls = await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')
    if (tls.rows[0]?.ssl !== true) throw Error('No TLS')
    return client
  }

  const admin = await connect('postgres')
  try {
    for (const [role, password] of [[RUNTIME, process.env.RUNTIME_PASSWORD], [MIGRATION, process.env.MIGRATION_PASSWORD]]) {
      if (!/^[A-Za-z0-9]{48}$/.test(password || '')) throw Error('Invalid configured password')
      const present = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount
      await admin.query(`${present ? 'ALTER' : 'CREATE'} ROLE ${role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD '${password}'`)
    }
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE])).rowCount
    if (!exists) await admin.query(`CREATE DATABASE ${DATABASE}`)
    console.log(exists ? `Database ${DATABASE} already existed` : `Created database ${DATABASE}`)
    await admin.query(`REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC`)
    await admin.query(`GRANT CONNECT ON DATABASE ${DATABASE} TO ${MIGRATION}, ${RUNTIME}`)
  } finally { await admin.end() }

  const target = await connect(DATABASE)
  try {
    for (const query of [
      'REVOKE ALL ON SCHEMA public FROM PUBLIC',
      `GRANT USAGE, CREATE ON SCHEMA public TO ${MIGRATION}`,
      `GRANT USAGE ON SCHEMA public TO ${RUNTIME}`,
      // Semantic search (migration 20261119_040000_search_and_evidence). Requires rds_superuser; idempotent.
      'CREATE EXTENSION IF NOT EXISTS vector',
    ]) await target.query(query)
  } finally { await target.end() }
  console.log('Verified TLS and bootstrapped isolated library database and roles')
}

main().catch(error => { console.error('Library bootstrap failed: ' + (error.code || error.name)); process.exitCode = 1 })
