import { Pool } from 'pg'
import { readFile, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { S3Client } from '@aws-sdk/client-s3'
import { JobStore, inputSchema, ProcessingError } from './jobs'
import { workOnce } from './engine'
import { stageOriginal, MAX_DOCUMENT_BYTES } from './storage'
import { approvedModels, readSettings } from './settings'
import { reconcile } from './reconcile'

let pool: Pool | undefined
try {
  const [command, expectedTarget, ...args] = process.argv.slice(2)
  if (!['enqueue', 'work', 'retry', 'stage', 'loop'].includes(command) || process.env.PROCESSING_ENVIRONMENT !== 'development') throw new ProcessingError('development_operation_required')
  if (!process.env.DATABASE_URI) throw new ProcessingError('database_configuration_required')
  const url = new URL(process.env.DATABASE_URI)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || expectedTarget !== `${url.hostname}${url.port ? ':' + url.port : ''}${url.pathname}`) throw new ProcessingError('database_target_mismatch')
  // Avoid URL options that override the explicitly verified TLS configuration.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) if (url.searchParams.has(key)) throw new ProcessingError('tls_options_in_uri_forbidden')
  pool = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 10000, statement_timeout: 30000,
    ssl: { rejectUnauthorized: true, ...(process.env.DATABASE_CA_FILE ? { ca: readFileSync(process.env.DATABASE_CA_FILE, 'utf8') } : {}) } })
  const store = new JobStore(pool)
  const positive = (arg: string) => { const n = Number(arg); if (!Number.isSafeInteger(n) || n < 1) throw new ProcessingError('invalid_id'); return n }
  if (command === 'loop') {
    // Always-on worker: honor settings, queue the next automatic steps, then work one job at a time.
    if (args.length) throw new ProcessingError('unexpected_arguments')
    const { runtimeProcessors } = await import('./runtime')
    const processors = runtimeProcessors(pool)
    let stopping = false
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { stopping = true })
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    let lastScan = 0, lastThumbs = 0, lastIndex = 0, lastUploads = 0, lastShip = 0, lastAutopilot = 0, lastSeed = 0, lastEmbeds = 0, lastSummary = ''
    const autopilotSkip = new Set<number>()
    // Payload (for registering large uploads with the same rules as direct uploads) starts on first use.
    let payloadInstance: import('payload').Payload | undefined
    const payloadFor = async () => payloadInstance ??= await (async () => {
      const [{ getPayload }, { default: config }] = await Promise.all([import('payload'), import('../payload.config')])
      const resolved = await config
      resolved.logger = { options: { level: 'warn' } } as typeof resolved.logger
      return getPayload({ config: resolved })
    })()
    const { bedrockEmbedder, semanticSearchEnabled } = await import('./embeddings')
    const { syncChunks, embedChunks } = await import('./chunks')
    const { shipOutbox, firehoseShipper, firehoseStreams } = await import('./analytics')
    // Chunks (keyword index) are always kept current; embeddings need Bedrock; analytics ship when streams are configured.
    const embedding = semanticSearchEnabled() && process.env.ALLOW_PAID_PROCESSING === 'true' ? bedrockEmbedder() : null
    const shipping = Object.keys(firehoseStreams()).length ? firehoseShipper() : null
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const { readOriginal } = await import('./storage')
    const [{ syncThumbnails, vimeoThumbnail }, { renderPdfThumbnail }] = await Promise.all([import('./thumbnails'), import('./pdf-thumbnail')])
    const s3 = new S3Client({})
    const thumbnailDeps = {
      readOriginal: (key: string, sha: string) => readOriginal(s3, process.env.CONTENT_BUCKET!, key, sha).then(b => new Uint8Array(b)),
      put: async (key: string, bytes: Uint8Array, mime: string) => { await s3.send(new PutObjectCommand({ Bucket: process.env.CONTENT_BUCKET, Key: key, Body: bytes, ContentType: mime, ServerSideEncryption: 'AES256' })) },
      vimeo: process.env.VIMEO_ACCESS_TOKEN ? (id: string) => vimeoThumbnail(id, process.env.VIMEO_ACCESS_TOKEN!) : undefined,
      pdf: (bytes: Uint8Array) => renderPdfThumbnail(bytes),
    }
    console.log(JSON.stringify({ status: 'worker_started' }))
    while (!stopping) {
      try {
        const settings = await readSettings(pool)
        if (settings.paused) { await sleep(15000); continue }
        if (Date.now() - lastScan > 10000) {
          lastScan = Date.now()
          const scan = await reconcile(pool, store, settings)
          const summary = JSON.stringify({ status: 'reconciled', ...scan })
          if (scan.queued || summary !== lastSummary) console.log(summary)
          lastSummary = summary
        }
        if (settings.thumbnailsEnabled && process.env.CONTENT_BUCKET && Date.now() - lastThumbs > 30000) {
          lastThumbs = Date.now()
          const made = await syncThumbnails(pool, thumbnailDeps)
          if (made.length) console.log(JSON.stringify({ status: 'thumbnails', results: made }))
        }
        if (process.env.VIMEO_ACCESS_TOKEN && Date.now() - lastEmbeds > 60000) {
          // Unlisted videos only play with their privacy hash in the player address.
          lastEmbeds = Date.now()
          const { syncVimeoEmbeds } = await import('./vimeo-embeds')
          const checked = await syncVimeoEmbeds(pool, process.env.VIMEO_ACCESS_TOKEN)
          if (Object.keys(checked).length) console.log(JSON.stringify({ status: 'vimeo_embeds', ...checked }))
        }
        if (process.env.CONTENT_BUCKET && process.env.PAYLOAD_SECRET && Date.now() - lastUploads > 15000) {
          // Large uploads (over 50 MB) arrive in uploads/; fingerprint, move into place and register them.
          lastUploads = Date.now()
          const [{ finalizeUploads, s3FinalizeDeps }, { registerSource, UploadError }] = await Promise.all([import('./finalize-uploads'), import('../server/processing')])
          const results = await finalizeUploads(s3FinalizeDeps(s3, process.env.CONTENT_BUCKET, async (contentId, object, extension, fileName, bytes) => {
            const payload = await payloadFor()
            const content = await payload.findByID({ collection: 'content', id: contentId, depth: 0, overrideAccess: true, disableErrors: true })
            if (!content) throw new UploadError(404, 'Library item not found.')
            await registerSource(payload, content as never, object, extension, fileName, bytes)
          }))
          if (results.length) console.log(JSON.stringify({ status: 'large_uploads', results: results.map(r => ({ status: r.status, code: r.code })) }))
        }
        if (process.env.PAYLOAD_SECRET && Date.now() - lastSeed > 600000) {
          // Reference data: the decided audiences and access profiles, plus carriers/tags from the WordPress reference
          // file when one has been uploaded to processing/reference/. Create-only; never edits what people changed.
          lastSeed = Date.now()
          const { seedReference, wordpressReference } = await import('../reference/seed')
          const { GetObjectCommand } = await import('@aws-sdk/client-s3')
          let reference: import('zod').infer<typeof wordpressReference> | undefined
          if (process.env.CONTENT_BUCKET) {
            try {
              const object = await s3.send(new GetObjectCommand({ Bucket: process.env.CONTENT_BUCKET, Key: 'processing/reference/wordpress-reference.json' }))
              reference = wordpressReference.parse(JSON.parse(await object.Body!.transformToString()))
            } catch (error) { if ((error as { name?: string }).name !== 'NoSuchKey') console.error(JSON.stringify({ status: 'reference_unreadable', code: (error as { name?: string }).name ?? 'invalid' })) }
          }
          const created = await seedReference(await payloadFor(), reference)
          if (Object.values(created).some(Boolean)) console.log(JSON.stringify({ status: 'reference_seeded', ...created }))
        }
        if (settings.migrationAutopilot && process.env.PAYLOAD_SECRET && Date.now() - lastAutopilot > 20000) {
          // Migrated WordPress items: apply AI details by the review rule and the mapped audience; never publishes.
          lastAutopilot = Date.now()
          const { runAutopilot } = await import('./autopilot')
          const applied = await runAutopilot(await payloadFor(), autopilotSkip)
          if (applied.length) console.log(JSON.stringify({ status: 'autopilot', results: applied }))
        }
        if (Date.now() - lastIndex > 15000) {
          // Search index: rebuild changed items' chunks, then embed new chunks. Bounded per pass; repeats sooner while busy.
          lastIndex = Date.now()
          const built = await syncChunks(pool)
          const embedded = embedding ? await embedChunks(pool, embedding) : { embedded: 0 }
          if (built.rebuilt || built.dropped || embedded.embedded) { console.log(JSON.stringify({ status: 'indexed', ...built, ...embedded })); lastIndex = 0 }
        }
        if (shipping && Date.now() - lastShip > 30000) {
          // Analytics outbox -> Firehose -> Iceberg (S3 Tables). Rows stay pending until Firehose accepts them.
          lastShip = Date.now()
          const shipped = await shipOutbox(pool, shipping)
          if (Object.values(shipped).some(Boolean)) console.log(JSON.stringify({ status: 'analytics_shipped', ...shipped }))
        }
        const outcome = await workOnce(store, processors)
        if (outcome.status === 'idle') await sleep(5000)
        else console.log(JSON.stringify(outcome))
      } catch (error) {
        // Database or network interruption: log a fixed code and back off; ECS restarts the task if it exits.
        console.error(JSON.stringify({ status: 'worker_error', code: error instanceof ProcessingError ? error.code : (error as { code?: string }).code ?? 'unknown' }))
        await sleep(30000)
      }
    }
    await payloadInstance?.destroy().catch(() => undefined)
    console.log(JSON.stringify({ status: 'worker_stopped' }))
  } else if (command === 'work') {
    if (args.length) throw new ProcessingError('unexpected_arguments')
    const { runtimeProcessors } = await import('./runtime')
    const outcome = await workOnce(store, runtimeProcessors(pool))
    console.log(JSON.stringify(outcome))
    if (outcome.status === 'failed') process.exitCode = 1
  } else if (command === 'retry') {
    if (args.length !== 1) throw new ProcessingError('usage_retry_target_job_id')
    await store.retry(positive(args[0])); console.log(JSON.stringify({ status: 'queued' }))
  } else if (command === 'enqueue') {
    if (args.length !== 2) throw new ProcessingError('usage_enqueue_target_content_id_input_json_file')
    const contentId = positive(args[0]), info = await stat(args[1])
    if (info.size > 1024 * 1024) throw new ProcessingError('input_size_limit')
    const input = inputSchema.parse(JSON.parse(await readFile(args[1], 'utf8')))
    // Capture taxonomy from the database, never caller-invented model vocabulary.
    if (input.kind === 'classify') {
      if (!approvedModels().includes(input.modelId)) throw new ProcessingError('model_not_approved')
      const { rows } = await pool.query('SELECT id,label,COALESCE(definition,\'\') AS definition,dimension FROM taxonomy WHERE id=ANY($1) ORDER BY id', [input.taxonomy.map(t => t.id)])
      if (rows.length !== new Set(input.taxonomy.map(t => t.id)).size) throw new ProcessingError('unknown_taxonomy')
      input.taxonomy = rows
      const extraction = await pool.query('SELECT input FROM processing_jobs WHERE id=$1 AND content_id=$2', [input.extractionJobId, contentId])
      input.videoId = extraction.rows[0]?.input?.videoId
    }
    const { rows } = await pool.query('SELECT source_hash,vimeo_id FROM content WHERE id=$1', [contentId])
    if (!rows[0]?.source_hash) throw new ProcessingError('source_identity_required')
    if (input.kind === 'vimeo') input.videoId = rows[0].vimeo_id
    const id = await store.enqueue(contentId, rows[0].source_hash, input)
    console.log(JSON.stringify({ status: 'queued', jobId: id }))
  } else {
    if (args.length !== 2 || !process.env.CONTENT_BUCKET) throw new ProcessingError('usage_stage_target_content_id_file')
    const contentId = positive(args[0]), info = await stat(args[1])
    if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) throw new ProcessingError('input_size_limit')
    const { rows } = await pool.query('SELECT source_hash,state FROM content WHERE id=$1', [contentId])
    if (!rows[0]?.source_hash) throw new ProcessingError('source_identity_required')
    if (!['intake', 'draft'].includes(rows[0].state)) throw new ProcessingError('staging_requires_draft_or_intake')
    const ext = path.extname(args[1]).slice(1).toLowerCase()
    const bytes = await readFile(args[1])
    const object = await stageOriginal(new S3Client({}), process.env.CONTENT_BUCKET, contentId, bytes, ext)
    const mime: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', vtt: 'text/vtt', txt: 'text/plain' }
    const db = await pool.connect()
    let assetId: number
    try {
      await db.query('BEGIN')
      // Serializes duplicate staging for this content without merging distinct articles.
      await db.query('SELECT pg_advisory_xact_lock($1)', [contentId])
      const current = await db.query('SELECT source_hash,state FROM content WHERE id=$1 FOR SHARE', [contentId])
      if (current.rows[0]?.source_hash !== rows[0].source_hash) throw new ProcessingError('source_version_mismatch')
      if (!['intake', 'draft'].includes(current.rows[0].state)) throw new ProcessingError('staging_requires_draft_or_intake')
      const existing = await db.query('SELECT id FROM assets WHERE content_id=$1 AND sha256=$2 AND version=$3', [contentId, object.hash, rows[0].source_hash])
      assetId = existing.rows[0]?.id ?? (await db.query('INSERT INTO assets(content_id,object_key,sha256,mime_type,version) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [contentId, object.key, object.hash, mime[ext] ?? 'application/octet-stream', rows[0].source_hash])).rows[0].id
      await db.query('COMMIT')
    } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
    const input = mime[ext] ? { kind: 'document', assetId, format: ext } : { kind: 'transcribe', assetId }
    const id = await store.enqueue(contentId, rows[0].source_hash, input)
    // A crash between asset commit and enqueue is repaired by rerunning the same stage command.
    console.log(JSON.stringify({ status: 'queued', assetId, jobId: id }))
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: error instanceof ProcessingError ? error.code : 'processing_operation_failed' }))
  process.exitCode = 1
} finally { await pool?.end() }
if (process.exitCode) process.exit(process.exitCode)
