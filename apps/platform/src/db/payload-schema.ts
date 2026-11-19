/**
 * The one place that records which database tables, columns and enum values our hand-written SQL relies on.
 *
 * Payload generates most tables from collection configs, using its Postgres adapter's naming conventions
 * (snake_case columns, `<collection>_rels` with `<slug>_id` columns, hasMany selects as `<collection>_<field>` with
 * parent_id/order/value, arrays as `<collection>_<field>` with _parent_id/_order). Those conventions are not a public
 * API and can change between major versions. Everything listed here is verified against the real migrated schema by
 * tests/schema-contract.test.ts, and that test also fails if raw SQL anywhere in src names a table not listed here.
 *
 * Upgrading Payload: run `npm test`. A failure in the schema contract names exactly what changed; fix it here and in
 * the queries using that table (search for the constant). See docs/UPGRADING-PAYLOAD.md.
 */
type TableSpec = { owner: 'payload' | 'app'; columns: readonly string[] }

export const SCHEMA = {
  // Payload-generated (collection configs in src/collections, globals in src/globals)
  content: { owner: 'payload', columns: ['id', 'title', 'description', 'body', 'kind', 'section', 'audience', 'program', 'state', 'format', 'source_hash', 'source_key',
    'vimeo_id', 'evidence_version', 'created_at', 'updated_at', 'listed_at', 'thumbnail_key', 'thumbnail_version', 'thumbnail_source', 'thumbnail_for'] },
  content_rels: { owner: 'payload', columns: ['id', 'order', 'parent_id', 'path', 'taxonomy_id', 'carriers_id'] },
  content_topics: { owner: 'payload', columns: ['parent_id', 'order', 'value'] },
  content_pages: { owner: 'payload', columns: ['parent_id', 'order', 'value'] },
  content_licensing: { owner: 'payload', columns: ['parent_id', 'order', 'value'] },
  content_lines: { owner: 'payload', columns: ['parent_id', 'order', 'value'] },
  content_takeaways: { owner: 'payload', columns: ['_parent_id', '_order', 'text'] },
  content_passages: { owner: 'payload', columns: ['_parent_id', '_order', 'citation_id', 'version', 'text', 'locator', 'asset_id'] },
  content_more_videos: { owner: 'payload', columns: ['_parent_id', '_order', 'vimeo_id', 'title'] },
  assets: { owner: 'payload', columns: ['id', 'content_id', 'object_key', 'sha256', 'mime_type', 'version', 'file_name', 'role', 'description', 'bytes', 'updated_at'] },
  taxonomy: { owner: 'payload', columns: ['id', 'label', 'definition', 'dimension'] },
  carriers: { owner: 'payload', columns: ['id', 'name'] },
  processing_jobs: { owner: 'payload', columns: ['id', 'idempotency_key', 'content_id', 'source_version', 'stage', 'state', 'attempts', 'input', 'result',
    'processor_version', 'next_run_at', 'deadline_at', 'lease_token', 'lease_until', 'error_code', 'created_at', 'updated_at'] },
  suggestions: { owner: 'payload', columns: ['id', 'job_key', 'content_id', 'source_version', 'model', 'proposal', 'decision'] },
  automation_settings: { owner: 'payload', columns: ['id', 'paused', 'documents_enabled', 'vimeo_enabled', 'thumbnails_enabled', 'transcription_enabled',
    'tagging_enabled', 'tagging_model', 'daily_paid_job_limit'] },
  automation_settings_tagging_dimensions: { owner: 'payload', columns: ['parent_id', 'order', 'value'] },
  source_relations: { owner: 'payload', columns: ['content_id', 'artifact_id', 'kind'] },
  import_artifacts: { owner: 'payload', columns: ['id', 'data'] },
  payload_migrations: { owner: 'payload', columns: ['name', 'batch'] },
  // Our own hand-written migrations (not Payload collections)
  content_views: { owner: 'app', columns: ['content_id', 'user_id', 'day'] },
  evidence_artifacts: { owner: 'app', columns: ['content_id', 'job_id', 'asset_id', 'kind', 'processor', 'model', 's3_key', 'sha256', 'bytes', 'meta'] },
  search_chunks: { owner: 'app', columns: ['id', 'content_id', 'build_version', 'seq', 'source', 'weight', 'asset_id', 'citation_id', 'locator', 'text', 'tsv', 'embedding', 'model'] },
  search_chunk_state: { owner: 'app', columns: ['content_id', 'build_version', 'chunks', 'built_at'] },
  analytics_outbox: { owner: 'app', columns: ['id', 'occurred_at', 'stream', 'event', 'content_id', 'job_id', 'actor', 'data', 'shipped_at'] },
} as const satisfies Record<string, TableSpec>

/** Enum types (Payload names them enum_<collection>_<field>) and the values our SQL compares against or casts to. */
export const ENUMS = {
  enum_processing_jobs_stage: ['extract', 'transcribe', 'classify'],
  enum_processing_jobs_state: ['queued', 'running', 'succeeded', 'failed'],
  enum_content_state: ['intake', 'draft', 'published', 'archived'],
  enum_assets_role: ['download', 'inline'],
} as const

export type TableName = keyof typeof SCHEMA
/** Table name constants for SQL, e.g. `FROM ${T.content_passages}`: a rename is one edit here. */
export const T = Object.fromEntries(Object.keys(SCHEMA).map(k => [k, k])) as { readonly [K in TableName]: K }
