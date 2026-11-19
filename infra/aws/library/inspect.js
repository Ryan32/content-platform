// One-off read-only ECS diagnostics (runtime image, aecp_library_runtime). Prints people and their memberships,
// published items by access profile, and failed processing jobs with their details. Changes nothing.
const { Client } = require('pg')

const clip = (value, n) => { const s = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value); return s.length > n ? s.slice(0, n) + '…' : s }
// Never print signed links or bearer material if a provider error echoed one.
const safe = s => s.replace(/https?:\/\/[^\s"']*[?&](X-Amz-[^\s"']*|token=[^\s"']*|s=[^\s"']*)/gi, '[signed-url]').replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')

async function main() {
  const response = await fetch('https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem', { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('RDS CA unavailable')
  const pg = new Client({ host: process.env.PGHOST, database: 'aecp_library', user: 'aecp_library_runtime', password: process.env.DB_PASSWORD,
    ssl: { ca: await response.text(), rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })
  await pg.connect()
  try {
    await pg.query('BEGIN READ ONLY')
    const people = await pg.query(`SELECT u.id, u.active, to_jsonb(u)->>'email' AS email,
      (SELECT array_agg(m.scope ORDER BY m._order) FROM users_memberships m WHERE m._parent_id = u.id) AS memberships
      FROM users u ORDER BY u.id`)
    for (const p of people.rows) console.log('person ' + JSON.stringify(p))
    const states = await pg.query(`SELECT c.state, ap.name AS profile, count(*)::int AS items,
      count(*) FILTER (WHERE to_jsonb(c)->>'review_due_at' IS NOT NULL AND (to_jsonb(c)->>'review_due_at')::timestamptz <= now())::int AS past_review,
      count(*) FILTER (WHERE c.available_at > now())::int AS not_yet_available
      FROM content c LEFT JOIN access_profiles ap ON ap.id = c.access_profile_id GROUP BY 1, 2 ORDER BY 1, 2`)
    for (const s of states.rows) console.log('content ' + JSON.stringify(s))
    const profiles = await pg.query(`SELECT ap.id, ap.name, ap.active, (SELECT count(*)::int FROM access_profiles_grants g WHERE g._parent_id = ap.id) AS rules FROM access_profiles ap ORDER BY ap.id`)
    for (const p of profiles.rows) console.log('profile ' + JSON.stringify(p))
    const failed = await pg.query(`SELECT j.content_id, c.title, c.vimeo_id IS NOT NULL AS has_vimeo, j.stage, j.state, j.attempts, j.error_code, j.input, j.result, j.updated_at
      FROM processing_jobs j JOIN content c ON c.id = j.content_id
      WHERE j.content_id IN (SELECT content_id FROM processing_jobs WHERE state = 'failed') ORDER BY j.content_id, j.id`)
    for (const j of failed.rows) console.log('job ' + safe(JSON.stringify({ ...j, input: clip(j.input, 500), result: clip(j.result, 700) })))
    await pg.query('ROLLBACK')
  } finally { await pg.end() }
}

main().catch(error => { console.error('Inspect failed: ' + (error?.message ?? error)); process.exit(1) })
