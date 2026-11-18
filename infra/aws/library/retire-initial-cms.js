// One-off ECS task (operations image) run with the RDS master secret to retire the initial CMS database.
// Refuses to drop the aecp database if any table other than the migration ledger holds rows or a session is connected.
const { Client } = require('pg')

const RETIRED_DATABASE = 'aecp'
const RETIRED_ROLES = ['aecp_runtime', 'aecp_migration']

async function main() {
  const response = await fetch('https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem', { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('RDS CA unavailable')
  const ca = await response.text()
  const master = JSON.parse(process.env.DB_MASTER)
  const connect = async database => {
    const client = new Client({ host: process.env.PGHOST, database, user: master.username, password: master.password, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })
    await client.connect()
    return client
  }

  const admin = await connect('postgres')
  try {
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [RETIRED_DATABASE])).rowCount
    if (exists) {
      const target = await connect(RETIRED_DATABASE)
      try {
        const { rows } = await target.query('SELECT relname, n_live_tup::int AS rows FROM pg_stat_user_tables ORDER BY relname')
        console.log('Initial CMS tables: ' + rows.map(row => `${row.relname}=${row.rows}`).join(', '))
        const populated = rows.filter(row => row.relname !== 'payload_migrations' && row.rows > 0)
        if (populated.length) throw Error('Initial CMS database contains data: ' + populated.map(row => row.relname).join(', '))
      } finally { await target.end() }
      const sessions = (await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [RETIRED_DATABASE])).rows[0].n
      if (sessions) throw Error(`Initial CMS database still has ${sessions} connected session(s)`)
      await admin.query(`DROP DATABASE ${RETIRED_DATABASE}`)
      console.log(`Dropped database ${RETIRED_DATABASE}`)
    } else console.log(`Database ${RETIRED_DATABASE} already absent`)

    for (const role of RETIRED_ROLES) {
      if ((await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount) {
        await admin.query(`DROP ROLE ${role}`)
        console.log(`Dropped role ${role}`)
      } else console.log(`Role ${role} already absent`)
    }
    const remaining = (await admin.query("SELECT string_agg(datname, ',' ORDER BY datname) AS names FROM pg_database WHERE NOT datistemplate")).rows[0].names
    console.log('Remaining databases: ' + remaining)
  } finally { await admin.end() }
}

main().catch(error => { console.error('Initial CMS retirement failed: ' + (error.code || error.message || error.name)); process.exitCode = 1 })
