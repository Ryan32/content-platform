import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_import_artifacts_kind" AS ENUM('blob', 'vimeo', 'taxonomy', 'attachment', 'reference');
  CREATE TYPE "public"."enum_source_snapshots_disposition" AS ENUM('initial-intake', 'staged-for-review');
  CREATE TYPE "public"."enum_import_reviews_reason" AS ENUM('source-ineligible');
  CREATE TYPE "public"."enum_import_runs_state" AS ENUM('completed');
  CREATE TABLE "import_artifacts" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar NOT NULL,
    "identity" varchar NOT NULL,
    "kind" "enum_import_artifacts_kind" NOT NULL,
    "data" jsonb NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "source_snapshots" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar NOT NULL,
    "content_id" integer NOT NULL,
    "source_key" varchar NOT NULL,
    "source_hash" varchar NOT NULL,
    "package_id" varchar NOT NULL,
    "disposition" "enum_source_snapshots_disposition" NOT NULL,
    "snapshot" jsonb NOT NULL,
    "proposed_content" jsonb NOT NULL,
    "issues" jsonb NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "source_relations" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar NOT NULL,
    "content_id" integer NOT NULL,
    "snapshot_id" integer NOT NULL,
    "artifact_id" integer,
    "target_source_key" varchar NOT NULL,
    "kind" varchar NOT NULL,
    "status" varchar NOT NULL,
    "edge" jsonb NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "import_reviews" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar NOT NULL,
    "content_id" integer NOT NULL,
    "package_id" varchar NOT NULL,
    "reason" "enum_import_reviews_reason" NOT NULL,
    "source_evidence" jsonb NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "import_runs" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar NOT NULL,
    "package_id" varchar NOT NULL,
    "state" "enum_import_runs_state" NOT NULL,
    "provenance" jsonb NOT NULL,
    "result" jsonb NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "import_artifacts_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "source_snapshots_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "source_relations_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "import_reviews_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "import_runs_id" integer;
  ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "source_relations" ADD CONSTRAINT "source_relations_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "source_relations" ADD CONSTRAINT "source_relations_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "source_relations" ADD CONSTRAINT "source_relations_artifact_id_import_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."import_artifacts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "import_reviews" ADD CONSTRAINT "import_reviews_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "import_artifacts_key_idx" ON "import_artifacts" USING btree ("key");
  CREATE INDEX "import_artifacts_identity_idx" ON "import_artifacts" USING btree ("identity");
  CREATE INDEX "import_artifacts_updated_at_idx" ON "import_artifacts" USING btree ("updated_at");
  CREATE INDEX "import_artifacts_created_at_idx" ON "import_artifacts" USING btree ("created_at");
  CREATE UNIQUE INDEX "source_snapshots_key_idx" ON "source_snapshots" USING btree ("key");
  CREATE INDEX "source_snapshots_content_idx" ON "source_snapshots" USING btree ("content_id");
  CREATE INDEX "source_snapshots_source_key_idx" ON "source_snapshots" USING btree ("source_key");
  CREATE INDEX "source_snapshots_updated_at_idx" ON "source_snapshots" USING btree ("updated_at");
  CREATE INDEX "source_snapshots_created_at_idx" ON "source_snapshots" USING btree ("created_at");
  CREATE UNIQUE INDEX "source_relations_key_idx" ON "source_relations" USING btree ("key");
  CREATE INDEX "source_relations_content_idx" ON "source_relations" USING btree ("content_id");
  CREATE INDEX "source_relations_snapshot_idx" ON "source_relations" USING btree ("snapshot_id");
  CREATE INDEX "source_relations_artifact_idx" ON "source_relations" USING btree ("artifact_id");
  CREATE INDEX "source_relations_target_source_key_idx" ON "source_relations" USING btree ("target_source_key");
  CREATE INDEX "source_relations_updated_at_idx" ON "source_relations" USING btree ("updated_at");
  CREATE INDEX "source_relations_created_at_idx" ON "source_relations" USING btree ("created_at");
  CREATE UNIQUE INDEX "import_reviews_key_idx" ON "import_reviews" USING btree ("key");
  CREATE INDEX "import_reviews_content_idx" ON "import_reviews" USING btree ("content_id");
  CREATE INDEX "import_reviews_updated_at_idx" ON "import_reviews" USING btree ("updated_at");
  CREATE INDEX "import_reviews_created_at_idx" ON "import_reviews" USING btree ("created_at");
  CREATE UNIQUE INDEX "import_runs_key_idx" ON "import_runs" USING btree ("key");
  CREATE UNIQUE INDEX "import_runs_package_id_idx" ON "import_runs" USING btree ("package_id");
  CREATE INDEX "import_runs_updated_at_idx" ON "import_runs" USING btree ("updated_at");
  CREATE INDEX "import_runs_created_at_idx" ON "import_runs" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_import_artifacts_fk" FOREIGN KEY ("import_artifacts_id") REFERENCES "public"."import_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_snapshots_fk" FOREIGN KEY ("source_snapshots_id") REFERENCES "public"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_relations_fk" FOREIGN KEY ("source_relations_id") REFERENCES "public"."source_relations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_import_reviews_fk" FOREIGN KEY ("import_reviews_id") REFERENCES "public"."import_reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_import_runs_fk" FOREIGN KEY ("import_runs_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_import_artifacts_id_idx" ON "payload_locked_documents_rels" USING btree ("import_artifacts_id");
  CREATE INDEX "payload_locked_documents_rels_source_snapshots_id_idx" ON "payload_locked_documents_rels" USING btree ("source_snapshots_id");
  CREATE INDEX "payload_locked_documents_rels_source_relations_id_idx" ON "payload_locked_documents_rels" USING btree ("source_relations_id");
  CREATE INDEX "payload_locked_documents_rels_import_reviews_id_idx" ON "payload_locked_documents_rels" USING btree ("import_reviews_id");
  CREATE INDEX "payload_locked_documents_rels_import_runs_id_idx" ON "payload_locked_documents_rels" USING btree ("import_runs_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "import_artifacts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "source_snapshots" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "source_relations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "import_reviews" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "import_runs" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "import_artifacts" CASCADE;
  DROP TABLE "source_snapshots" CASCADE;
  DROP TABLE "source_relations" CASCADE;
  DROP TABLE "import_reviews" CASCADE;
  DROP TABLE "import_runs" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_import_artifacts_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_source_snapshots_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_source_relations_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_import_reviews_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_import_runs_fk";

  DROP INDEX "payload_locked_documents_rels_import_artifacts_id_idx";
  DROP INDEX "payload_locked_documents_rels_source_snapshots_id_idx";
  DROP INDEX "payload_locked_documents_rels_source_relations_id_idx";
  DROP INDEX "payload_locked_documents_rels_import_reviews_id_idx";
  DROP INDEX "payload_locked_documents_rels_import_runs_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "import_artifacts_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "source_snapshots_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "source_relations_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "import_reviews_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "import_runs_id";
  DROP TYPE "public"."enum_import_artifacts_kind";
  DROP TYPE "public"."enum_source_snapshots_disposition";
  DROP TYPE "public"."enum_import_reviews_reason";
  DROP TYPE "public"."enum_import_runs_state";`)
}
