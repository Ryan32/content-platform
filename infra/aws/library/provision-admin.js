// One-off ECS task (operations image) run as aecp_library_migration to provision a trusted administrator.
// The Auth0 issuer/subject come from task environment set by the operator; sign-in never creates users.
const { Client } = require('pg')

async function main() {
  const subject = process.env.ADMIN_SUBJECT, issuer = process.env.ADMIN_ISSUER
  if (!subject || !/^[\w|.@-]{3,200}$/.test(subject) || !issuer?.startsWith('https://') || !issuer.endsWith('/')) throw Error('Invalid ADMIN_SUBJECT or ADMIN_ISSUER')
  const response = await fetch('https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem', { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('RDS CA unavailable')
  const pg = new Client({ host: process.env.PGHOST, database: 'aecp_library', user: 'aecp_library_migration', password: process.env.DB_PASSWORD,
    ssl: { ca: await response.text(), rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })
  await pg.connect()
  try {
    await pg.query('BEGIN')
    const { rows: [user] } = await pg.query(`INSERT INTO users (subject, issuer, active) VALUES ($1, $2, true)
      ON CONFLICT (issuer, subject) DO UPDATE SET active = true, updated_at = now() RETURNING id`, [subject, issuer])
    await pg.query('DELETE FROM users_roles WHERE parent_id = $1', [user.id])
    await pg.query(`INSERT INTO users_roles ("order", parent_id, value) VALUES (1, $1, 'admin'), (2, $1, 'reader')`, [user.id])
    await pg.query('COMMIT')
    const { rows: [check] } = await pg.query(`SELECT u.id, u.active, array_agg(r.value::text ORDER BY r."order") AS roles
      FROM users u JOIN users_roles r ON r.parent_id = u.id WHERE u.id = $1 GROUP BY u.id, u.active`, [user.id])
    console.log(`Provisioned administrator: user ${check.id}, active=${check.active}, roles=${check.roles.join(',')}, subject=${subject}`)
  } catch (error) { await pg.query('ROLLBACK').catch(() => {}); throw error } finally { await pg.end() }
}

main().catch(error => { console.error('Administrator provisioning failed: ' + (error.code || error.message || error.name)); process.exitCode = 1 })
