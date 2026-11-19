import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Lossless processing evidence, the weighted search index and the analytics event log. Hand-written: none of these are
 * Payload collections, so Payload schema snapshots are unchanged. The pgvector extension must be created by the
 * database owner first (infra/aws/library/bootstrap.js); IF NOT EXISTS is then a no-op.
 *
 *  - evidence_artifacts: manifest of every raw provider output and full extraction kept in S3 under evidence/ (forever).
 *  - search_chunks: every piece of text on an item (curated fields, article, files, transcripts, OCR, pictures), chunked,
 *    weighted by source, keyword-indexed and embedded. Reader eligibility is always decided by the content row.
 *  - search_chunk_state: which version of an item the chunks were built from.
 *  - analytics_outbox: append-only rows for the Iceberg analytics tables (events, model calls, evidence, chunks, items),
 *    shipped by the worker to Amazon Data Firehose -> S3 Tables, which Snowflake reads in place. Shipped rows are pruned
 *    after 7 days; the Iceberg tables are the permanent record.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE IF NOT EXISTS "evidence_artifacts" (
    "id" serial PRIMARY KEY NOT NULL,
    "content_id" integer REFERENCES "public"."content"("id") ON DELETE SET NULL,
    "job_id" integer,
    "asset_id" integer,
    "kind" varchar NOT NULL,
    "processor" varchar NOT NULL,
    "model" varchar,
    "s3_key" varchar NOT NULL,
    "sha256" varchar NOT NULL,
    "bytes" bigint NOT NULL,
    "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "evidence_artifacts_key" ON "evidence_artifacts" ("s3_key");
  CREATE INDEX IF NOT EXISTS "evidence_artifacts_content" ON "evidence_artifacts" ("content_id", "kind");
  CREATE INDEX IF NOT EXISTS "evidence_artifacts_created" ON "evidence_artifacts" ("created_at");

  CREATE TABLE IF NOT EXISTS "search_chunks" (
    "id" bigserial PRIMARY KEY NOT NULL,
    "content_id" integer NOT NULL REFERENCES "public"."content"("id") ON DELETE cascade,
    "build_version" varchar NOT NULL,
    "seq" integer NOT NULL,
    "source" varchar NOT NULL,
    "weight" real NOT NULL,
    "asset_id" integer,
    "citation_id" varchar,
    "locator" varchar NOT NULL,
    "text" text NOT NULL,
    "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED,
    "embedding" vector(1024),
    "model" varchar,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "search_chunks_unique" ON "search_chunks" ("content_id", "build_version", "seq");
  CREATE INDEX IF NOT EXISTS "search_chunks_tsv" ON "search_chunks" USING gin ("tsv");
  CREATE INDEX IF NOT EXISTS "search_chunks_hnsw" ON "search_chunks" USING hnsw ("embedding" vector_cosine_ops);
  CREATE INDEX IF NOT EXISTS "search_chunks_pending" ON "search_chunks" ("id") WHERE "embedding" IS NULL;

  CREATE TABLE IF NOT EXISTS "search_chunk_state" (
    "content_id" integer PRIMARY KEY NOT NULL REFERENCES "public"."content"("id") ON DELETE cascade,
    "build_version" varchar NOT NULL,
    "chunks" integer NOT NULL,
    "built_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "analytics_outbox" (
    "id" bigserial PRIMARY KEY NOT NULL,
    "occurred_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "stream" varchar NOT NULL,
    "event" varchar NOT NULL,
    "content_id" integer,
    "job_id" integer,
    "actor" varchar,
    "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "shipped_at" timestamp(3) with time zone
  );
  CREATE INDEX IF NOT EXISTS "analytics_outbox_pending" ON "analytics_outbox" ("stream", "id") WHERE "shipped_at" IS NULL;
  CREATE INDEX IF NOT EXISTS "analytics_outbox_shipped" ON "analytics_outbox" ("shipped_at") WHERE "shipped_at" IS NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Disposable environments only. Leaves the extension installed; S3 evidence is never deleted by a migration.
  await db.execute(sql`DROP TABLE IF EXISTS "analytics_outbox"; DROP TABLE IF EXISTS "search_chunk_state";
    DROP TABLE IF EXISTS "search_chunks"; DROP TABLE IF EXISTS "evidence_artifacts";`)
}
