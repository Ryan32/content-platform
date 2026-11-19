// One-off ECS task (operations image) run as aecp_library_runtime (DML only, no schema CREATE).
// For each package ID in order: downloads the private WordPress intake package from S3, validates it offline, then
// runs a read-only preview. With IMPORT_MODE=apply it also applies it and immediately reruns it to prove the rerun
// is a no-op, then attaches the uploaded files (imports/files/) to the items. Stops at the first failure; rerunning the whole list is safe because completed packages are skipped.
// Prints only the CLI's sanitized JSON status lines; never source content, credentials or signed URLs.
const { Client } = require('pg')
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3')
const { spawnSync } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')

const DATABASE = 'aecp_library'
const USER = 'aecp_library_runtime'
const FILES = ['complete.json', 'package.json', 'summary.json', 'dry-run.json']
const LATEST = '20261119_200000_vimeo_embeds' // Keep in step with migrate.js EXPECTED.

async function main() {
  const { IMPORT_BUCKET: bucket, IMPORT_MODE: mode } = process.env
  const packageIds = (process.env.IMPORT_PACKAGE_IDS || '').split(',').filter(Boolean)
  if (!bucket || !packageIds.length || !packageIds.every(id => /^[0-9a-f]{64}$/.test(id)) || !['preview', 'apply'].includes(mode)) throw Error('import_task_configuration')

  const response = await fetch('https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem', { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('RDS CA unavailable')
  const ca = await response.text()
  const caFile = '/tmp/aecp-rds.pem'
  writeFileSync(caFile, ca, { mode: 0o600 })

  const pg = new Client({ host: process.env.PGHOST, database: DATABASE, user: USER, password: process.env.DB_PASSWORD, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })
  await pg.connect()
  try {
    const { rows: [state] } = await pg.query(`SELECT current_user AS role, ssl, has_schema_privilege(current_user, 'public', 'CREATE') AS ddl,
      EXISTS(SELECT 1 FROM payload_migrations WHERE name=$1) AS schema_ready FROM pg_stat_ssl WHERE pid = pg_backend_pid()`, [LATEST])
    if (state?.role !== USER || !state.ssl || state.ddl || !state.schema_ready) throw Error('Unexpected import database state (run the migrate step first)')
    console.log('Verified runtime role over TLS, current schema, no schema CREATE')
  } finally { await pg.end() }

  const s3 = new S3Client({ region: process.env.AWS_REGION })
  const url = new URL(`postgresql://${process.env.PGHOST}:5432/${DATABASE}`)
  url.username = USER
  url.password = process.env.DB_PASSWORD
  const env = { ...process.env, DATABASE_URI: url.toString(), DATABASE_CA_FILE: caFile, NODE_EXTRA_CA_CERTS: caFile, IMPORT_ENVIRONMENT: 'development', CONTENT_BUCKET: bucket }
  delete env.DB_PASSWORD
  const target = `${url.hostname}:${url.port}${url.pathname}` // Must equal the CLI's expected host:port/database.
  const run = (label, args) => {
    console.log(`Import ${label}`)
    const result = spawnSync(process.execPath, ['node_modules/payload/bin.js', 'run', 'src/import/cli.ts', ...args], { stdio: 'inherit', env })
    if (result.status !== 0) throw Error(`Import ${label} failed`)
  }
  for (const [index, packageId] of packageIds.entries()) {
    console.log(`=== Package ${index + 1}/${packageIds.length}: ${packageId}`)
    // Package lives only in task-local /tmp for the life of this task.
    const dir = `/tmp/import-package/${packageId}`
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const name of FILES) {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `imports/${packageId}/${name}` }))
      writeFileSync(`${dir}/${name}`, Buffer.from(await object.Body.transformToByteArray()), { mode: 0o600 })
    }
    // Optional: media the pages embedded from Widen, fetched on the operator laptop (scripts/fetch_external_media.py).
    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `imports/${packageId}/external-media.json` }))
      writeFileSync(`${dir}/external-media.json`, Buffer.from(await object.Body.transformToByteArray()), { mode: 0o600 })
    } catch (error) {
      if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) throw error
    }
    run('check', ['check', dir])
    run('preview', ['preview', dir, target, packageId])
    if (mode === 'apply') {
      run('apply', ['apply', dir, target, packageId])
      run('rerun (expect alreadyCompleted: true)', ['apply', dir, target, packageId])
      // Link the uploaded file bytes to the imported items; the worker then extracts and analyzes them.
      run('attach files', ['attach', dir, target, packageId])
    }
  }
  console.log(`Import ${mode} finished for ${packageIds.length} package(s)`)
}

main().catch(error => { console.error('Library import failed: ' + (error.code || error.message || error.name)); process.exitCode = 1 })
