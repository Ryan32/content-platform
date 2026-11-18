import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_content_thumbnail_source" AS ENUM('upload', 'vimeo', 'pdf', 'unavailable');
  CREATE TYPE "public"."enum__content_v_version_thumbnail_source" AS ENUM('upload', 'vimeo', 'pdf', 'unavailable');
  CREATE TYPE "public"."enum_audiences_kind" AS ENUM('business-line', 'firm', 'internal', 'program', 'plan', 'other');
  CREATE TYPE "public"."enum_automation_settings_tagging_dimensions" AS ENUM('topic', 'business-line', 'audience', 'format', 'program', 'entity');
  CREATE TYPE "public"."enum_automation_settings_tagging_model" AS ENUM('us.anthropic.claude-haiku-5-5', 'us.anthropic.claude-sonnet-5-5');
  CREATE TABLE "audiences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"kind" "enum_audiences_kind" DEFAULT 'business-line' NOT NULL,
  	"key" varchar NOT NULL,
  	"description" varchar,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "automation_settings_tagging_dimensions" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_automation_settings_tagging_dimensions",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "automation_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"paused" boolean DEFAULT false,
  	"documents_enabled" boolean DEFAULT true,
  	"vimeo_enabled" boolean DEFAULT true,
  	"thumbnails_enabled" boolean DEFAULT true,
  	"transcription_enabled" boolean DEFAULT true,
  	"tagging_enabled" boolean DEFAULT true,
  	"tagging_model" "enum_automation_settings_tagging_model" DEFAULT 'us.anthropic.claude-haiku-5-5' NOT NULL,
  	"daily_paid_job_limit" numeric DEFAULT 200 NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "users" ALTER COLUMN "subject" DROP NOT NULL;
  ALTER TABLE "users" ALTER COLUMN "issuer" DROP NOT NULL;
  ALTER TABLE "users" ALTER COLUMN "active" SET DEFAULT true;
  ALTER TABLE "users" ADD COLUMN "name" varchar;
  ALTER TABLE "users" ADD COLUMN "email" varchar;
  ALTER TABLE "users" ADD COLUMN "last_sign_in_at" timestamp(3) with time zone;
  ALTER TABLE "content" ADD COLUMN "thumbnail_version" varchar;
  ALTER TABLE "content" ADD COLUMN "thumbnail_key" varchar;
  ALTER TABLE "content" ADD COLUMN "thumbnail_source" "enum_content_thumbnail_source";
  ALTER TABLE "content" ADD COLUMN "thumbnail_for" varchar;
  ALTER TABLE "_content_v" ADD COLUMN "version_thumbnail_version" varchar;
  ALTER TABLE "_content_v" ADD COLUMN "version_thumbnail_key" varchar;
  ALTER TABLE "_content_v" ADD COLUMN "version_thumbnail_source" "enum__content_v_version_thumbnail_source";
  ALTER TABLE "_content_v" ADD COLUMN "version_thumbnail_for" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "audiences_id" integer;
  ALTER TABLE "automation_settings_tagging_dimensions" ADD CONSTRAINT "automation_settings_tagging_dimensions_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."automation_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "audiences_key_idx" ON "audiences" USING btree ("key");
  CREATE INDEX "audiences_updated_at_idx" ON "audiences" USING btree ("updated_at");
  CREATE INDEX "audiences_created_at_idx" ON "audiences" USING btree ("created_at");
  CREATE INDEX "automation_settings_tagging_dimensions_order_idx" ON "automation_settings_tagging_dimensions" USING btree ("order");
  CREATE INDEX "automation_settings_tagging_dimensions_parent_idx" ON "automation_settings_tagging_dimensions" USING btree ("parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_audiences_fk" FOREIGN KEY ("audiences_id") REFERENCES "public"."audiences"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  -- Ranked library search (src/server/search.ts SEARCH_DOCUMENT must match this expression).
  CREATE INDEX "content_search_idx" ON "content" USING gin ((setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(body, '')), 'C')));
  CREATE INDEX "payload_locked_documents_rels_audiences_id_idx" ON "payload_locked_documents_rels" USING btree ("audiences_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS "content_search_idx";`)
  await db.execute(sql`
   ALTER TABLE "audiences" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "automation_settings_tagging_dimensions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "automation_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "audiences" CASCADE;
  DROP TABLE "automation_settings_tagging_dimensions" CASCADE;
  DROP TABLE "automation_settings" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_audiences_fk";
  
  DROP INDEX "users_email_idx";
  DROP INDEX "payload_locked_documents_rels_audiences_id_idx";
  ALTER TABLE "users" ALTER COLUMN "active" SET DEFAULT false;
  ALTER TABLE "users" ALTER COLUMN "subject" SET NOT NULL;
  ALTER TABLE "users" ALTER COLUMN "issuer" SET NOT NULL;
  ALTER TABLE "content" DROP COLUMN "thumbnail_version";
  ALTER TABLE "content" DROP COLUMN "thumbnail_key";
  ALTER TABLE "content" DROP COLUMN "thumbnail_source";
  ALTER TABLE "content" DROP COLUMN "thumbnail_for";
  ALTER TABLE "_content_v" DROP COLUMN "version_thumbnail_version";
  ALTER TABLE "_content_v" DROP COLUMN "version_thumbnail_key";
  ALTER TABLE "_content_v" DROP COLUMN "version_thumbnail_source";
  ALTER TABLE "_content_v" DROP COLUMN "version_thumbnail_for";
  ALTER TABLE "users" DROP COLUMN "name";
  ALTER TABLE "users" DROP COLUMN "email";
  ALTER TABLE "users" DROP COLUMN "last_sign_in_at";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "audiences_id";
  DROP TYPE "public"."enum_content_thumbnail_source";
  DROP TYPE "public"."enum__content_v_version_thumbnail_source";
  DROP TYPE "public"."enum_audiences_kind";
  DROP TYPE "public"."enum_automation_settings_tagging_dimensions";
  DROP TYPE "public"."enum_automation_settings_tagging_model";`)
}
