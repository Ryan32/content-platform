import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Semantic search index (pgvector). Hand-written: not a Payload collection, so Payload schema snapshots are unchanged.
 * One embedding per reviewed citation passage. Rows for superseded evidence are excluded at query time and pruned by
 * the worker; deleting an item cascades. Retrieval eligibility is always decided by the content row, never this table.
 * The extension must be created by the database owner first (infra/aws/library/bootstrap.js); IF NOT EXISTS is a no-op then.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS "passage_embeddings" (
    "id" serial PRIMARY KEY NOT NULL,
    "content_id" integer NOT NULL REFERENCES "public"."content"("id") ON DELETE cascade,
    "citation_id" varchar NOT NULL,
    "evidence_version" varchar NOT NULL,
    "model" varchar NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "passage_embeddings_unique" ON "passage_embeddings" ("content_id", "citation_id", "model");
  CREATE INDEX IF NOT EXISTS "passage_embeddings_content" ON "passage_embeddings" ("content_id", "evidence_version");
  CREATE INDEX IF NOT EXISTS "passage_embeddings_hnsw" ON "passage_embeddings" USING hnsw ("embedding" vector_cosine_ops);
  -- Keyword search inside reviewed file text (src/server/search.ts PASSAGE_DOCUMENT must match this expression).
  CREATE INDEX IF NOT EXISTS "content_passages_fts" ON "content_passages" USING gin (to_tsvector('english', "text"));`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Disposable environments only. Leaves the extension installed.
  await db.execute(sql`DROP INDEX IF EXISTS "content_passages_fts"; DROP TABLE IF EXISTS "passage_embeddings";`)
}
