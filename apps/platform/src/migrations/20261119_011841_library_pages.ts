import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_content_licensing" AS ENUM('insurance', 'investment');
  CREATE TYPE "public"."enum_content_lines" AS ENUM('annuity', 'life', 'wealth', 'medicare', 'hnw');
  CREATE TYPE "public"."enum_content_audience" AS ENUM('advisor', 'client');
  CREATE TYPE "public"."enum_content_program" AS ENUM('seminar-success', 'real-wins', 'second-half-playbook', 'ae-marketing-hub', 'express-lane', 'the-journey', 'advisor-talent-solutions', 'next-gen-coaching');
  CREATE TYPE "public"."enum__content_v_version_licensing" AS ENUM('insurance', 'investment');
  CREATE TYPE "public"."enum__content_v_version_lines" AS ENUM('annuity', 'life', 'wealth', 'medicare', 'hnw');
  CREATE TYPE "public"."enum__content_v_version_audience" AS ENUM('advisor', 'client');
  CREATE TYPE "public"."enum__content_v_version_program" AS ENUM('seminar-success', 'real-wins', 'second-half-playbook', 'ae-marketing-hub', 'express-lane', 'the-journey', 'advisor-talent-solutions', 'next-gen-coaching');
  CREATE TYPE "public"."enum_carriers_lines" AS ENUM('annuity', 'life', 'wealth', 'medicare', 'hnw');
  CREATE TYPE "public"."enum_kits_section" AS ENUM('products', 'operations', 'marketing', 'planning', 'coaching', 'events');
  CREATE TYPE "public"."enum_feedback_kind" AS ENUM('helpful', 'not-helpful', 'edit');
  ALTER TYPE "public"."enum_content_kind" ADD VALUE 'news';
  ALTER TYPE "public"."enum_content_kind" ADD VALUE 'bulletin';
  ALTER TYPE "public"."enum__content_v_version_kind" ADD VALUE 'news';
  ALTER TYPE "public"."enum__content_v_version_kind" ADD VALUE 'bulletin';
  CREATE TABLE "content_licensing" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_content_licensing",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "content_lines" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_content_lines",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "content_takeaways" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL
  );
  
  CREATE TABLE "_content_v_version_licensing" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum__content_v_version_licensing",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "_content_v_version_lines" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum__content_v_version_lines",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "_content_v_version_takeaways" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "carriers_lines" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_carriers_lines",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "carriers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"summary" varchar,
  	"logo_text" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "kits" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"description" varchar,
  	"section" "enum_kits_section",
  	"published" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "kits_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"content_id" integer
  );
  
  CREATE TABLE "feedback" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"content_id" integer NOT NULL,
  	"user_id" integer,
  	"kind" "enum_feedback_kind" NOT NULL,
  	"comment" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "saved" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"content_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "content" ADD COLUMN "audience" "enum_content_audience" DEFAULT 'advisor';
  ALTER TABLE "content" ADD COLUMN "program" "enum_content_program";
  ALTER TABLE "content" ADD COLUMN "snoozed_at" timestamp(3) with time zone;
  ALTER TABLE "content_rels" ADD COLUMN "carriers_id" integer;
  ALTER TABLE "_content_v" ADD COLUMN "version_audience" "enum__content_v_version_audience" DEFAULT 'advisor';
  ALTER TABLE "_content_v" ADD COLUMN "version_program" "enum__content_v_version_program";
  ALTER TABLE "_content_v" ADD COLUMN "version_snoozed_at" timestamp(3) with time zone;
  ALTER TABLE "_content_v_rels" ADD COLUMN "carriers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "carriers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "kits_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "feedback_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "saved_id" integer;
  ALTER TABLE "content_licensing" ADD CONSTRAINT "content_licensing_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "content_lines" ADD CONSTRAINT "content_lines_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "content_takeaways" ADD CONSTRAINT "content_takeaways_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v_version_licensing" ADD CONSTRAINT "_content_v_version_licensing_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_content_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v_version_lines" ADD CONSTRAINT "_content_v_version_lines_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_content_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v_version_takeaways" ADD CONSTRAINT "_content_v_version_takeaways_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_content_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "carriers_lines" ADD CONSTRAINT "carriers_lines_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "kits_rels" ADD CONSTRAINT "kits_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."kits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "kits_rels" ADD CONSTRAINT "kits_rels_content_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "feedback" ADD CONSTRAINT "feedback_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "saved" ADD CONSTRAINT "saved_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "saved" ADD CONSTRAINT "saved_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "content_licensing_order_idx" ON "content_licensing" USING btree ("order");
  CREATE INDEX "content_licensing_parent_idx" ON "content_licensing" USING btree ("parent_id");
  CREATE INDEX "content_lines_order_idx" ON "content_lines" USING btree ("order");
  CREATE INDEX "content_lines_parent_idx" ON "content_lines" USING btree ("parent_id");
  CREATE INDEX "content_takeaways_order_idx" ON "content_takeaways" USING btree ("_order");
  CREATE INDEX "content_takeaways_parent_id_idx" ON "content_takeaways" USING btree ("_parent_id");
  CREATE INDEX "_content_v_version_licensing_order_idx" ON "_content_v_version_licensing" USING btree ("order");
  CREATE INDEX "_content_v_version_licensing_parent_idx" ON "_content_v_version_licensing" USING btree ("parent_id");
  CREATE INDEX "_content_v_version_lines_order_idx" ON "_content_v_version_lines" USING btree ("order");
  CREATE INDEX "_content_v_version_lines_parent_idx" ON "_content_v_version_lines" USING btree ("parent_id");
  CREATE INDEX "_content_v_version_takeaways_order_idx" ON "_content_v_version_takeaways" USING btree ("_order");
  CREATE INDEX "_content_v_version_takeaways_parent_id_idx" ON "_content_v_version_takeaways" USING btree ("_parent_id");
  CREATE INDEX "carriers_lines_order_idx" ON "carriers_lines" USING btree ("order");
  CREATE INDEX "carriers_lines_parent_idx" ON "carriers_lines" USING btree ("parent_id");
  CREATE UNIQUE INDEX "carriers_slug_idx" ON "carriers" USING btree ("slug");
  CREATE INDEX "carriers_updated_at_idx" ON "carriers" USING btree ("updated_at");
  CREATE INDEX "carriers_created_at_idx" ON "carriers" USING btree ("created_at");
  CREATE INDEX "kits_section_idx" ON "kits" USING btree ("section");
  CREATE INDEX "kits_updated_at_idx" ON "kits" USING btree ("updated_at");
  CREATE INDEX "kits_created_at_idx" ON "kits" USING btree ("created_at");
  CREATE INDEX "kits_rels_order_idx" ON "kits_rels" USING btree ("order");
  CREATE INDEX "kits_rels_parent_idx" ON "kits_rels" USING btree ("parent_id");
  CREATE INDEX "kits_rels_path_idx" ON "kits_rels" USING btree ("path");
  CREATE INDEX "kits_rels_content_id_idx" ON "kits_rels" USING btree ("content_id");
  CREATE INDEX "feedback_content_idx" ON "feedback" USING btree ("content_id");
  CREATE INDEX "feedback_user_idx" ON "feedback" USING btree ("user_id");
  CREATE INDEX "feedback_updated_at_idx" ON "feedback" USING btree ("updated_at");
  CREATE INDEX "feedback_created_at_idx" ON "feedback" USING btree ("created_at");
  CREATE INDEX "saved_user_idx" ON "saved" USING btree ("user_id");
  CREATE INDEX "saved_content_idx" ON "saved" USING btree ("content_id");
  CREATE INDEX "saved_updated_at_idx" ON "saved" USING btree ("updated_at");
  CREATE INDEX "saved_created_at_idx" ON "saved" USING btree ("created_at");
  CREATE UNIQUE INDEX "user_content_idx" ON "saved" USING btree ("user_id","content_id");
  ALTER TABLE "content_rels" ADD CONSTRAINT "content_rels_carriers_fk" FOREIGN KEY ("carriers_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v_rels" ADD CONSTRAINT "_content_v_rels_carriers_fk" FOREIGN KEY ("carriers_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_carriers_fk" FOREIGN KEY ("carriers_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_kits_fk" FOREIGN KEY ("kits_id") REFERENCES "public"."kits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_feedback_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_saved_fk" FOREIGN KEY ("saved_id") REFERENCES "public"."saved"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "content_rels_carriers_id_idx" ON "content_rels" USING btree ("carriers_id");
  CREATE INDEX "_content_v_rels_carriers_id_idx" ON "_content_v_rels" USING btree ("carriers_id");
  CREATE INDEX "payload_locked_documents_rels_carriers_id_idx" ON "payload_locked_documents_rels" USING btree ("carriers_id");
  CREATE INDEX "payload_locked_documents_rels_kits_id_idx" ON "payload_locked_documents_rels" USING btree ("kits_id");
  CREATE INDEX "payload_locked_documents_rels_feedback_id_idx" ON "payload_locked_documents_rels" USING btree ("feedback_id");
  CREATE INDEX "payload_locked_documents_rels_saved_id_idx" ON "payload_locked_documents_rels" USING btree ("saved_id");
  -- Reader views for "Most used": one row per person, item and day. No content, no query text.
  CREATE TABLE IF NOT EXISTS "content_views" (
    "content_id" integer NOT NULL REFERENCES "content"("id") ON DELETE CASCADE,
    "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "day" date NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY ("content_id", "user_id", "day")
  );
  CREATE INDEX IF NOT EXISTS "content_views_day_idx" ON "content_views" USING btree ("day");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP TABLE IF EXISTS "content_views";
   ALTER TABLE "content_licensing" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "content_lines" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "content_takeaways" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_content_v_version_licensing" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_content_v_version_lines" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_content_v_version_takeaways" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "carriers_lines" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "carriers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "kits" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "kits_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "feedback" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "saved" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "content_licensing" CASCADE;
  DROP TABLE "content_lines" CASCADE;
  DROP TABLE "content_takeaways" CASCADE;
  DROP TABLE "_content_v_version_licensing" CASCADE;
  DROP TABLE "_content_v_version_lines" CASCADE;
  DROP TABLE "_content_v_version_takeaways" CASCADE;
  DROP TABLE "carriers_lines" CASCADE;
  DROP TABLE "carriers" CASCADE;
  DROP TABLE "kits" CASCADE;
  DROP TABLE "kits_rels" CASCADE;
  DROP TABLE "feedback" CASCADE;
  DROP TABLE "saved" CASCADE;
  ALTER TABLE "content_rels" DROP CONSTRAINT "content_rels_carriers_fk";
  
  ALTER TABLE "_content_v_rels" DROP CONSTRAINT "_content_v_rels_carriers_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_carriers_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_kits_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_feedback_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_saved_fk";
  
  ALTER TABLE "content" ALTER COLUMN "kind" SET DATA TYPE text;
  ALTER TABLE "content" ALTER COLUMN "kind" SET DEFAULT 'resource'::text;
  DROP TYPE "public"."enum_content_kind";
  CREATE TYPE "public"."enum_content_kind" AS ENUM('resource', 'howto');
  ALTER TABLE "content" ALTER COLUMN "kind" SET DEFAULT 'resource'::"public"."enum_content_kind";
  ALTER TABLE "content" ALTER COLUMN "kind" SET DATA TYPE "public"."enum_content_kind" USING "kind"::"public"."enum_content_kind";
  ALTER TABLE "_content_v" ALTER COLUMN "version_kind" SET DATA TYPE text;
  ALTER TABLE "_content_v" ALTER COLUMN "version_kind" SET DEFAULT 'resource'::text;
  DROP TYPE "public"."enum__content_v_version_kind";
  CREATE TYPE "public"."enum__content_v_version_kind" AS ENUM('resource', 'howto');
  ALTER TABLE "_content_v" ALTER COLUMN "version_kind" SET DEFAULT 'resource'::"public"."enum__content_v_version_kind";
  ALTER TABLE "_content_v" ALTER COLUMN "version_kind" SET DATA TYPE "public"."enum__content_v_version_kind" USING "version_kind"::"public"."enum__content_v_version_kind";
  DROP INDEX "content_rels_carriers_id_idx";
  DROP INDEX "_content_v_rels_carriers_id_idx";
  DROP INDEX "payload_locked_documents_rels_carriers_id_idx";
  DROP INDEX "payload_locked_documents_rels_kits_id_idx";
  DROP INDEX "payload_locked_documents_rels_feedback_id_idx";
  DROP INDEX "payload_locked_documents_rels_saved_id_idx";
  ALTER TABLE "content" DROP COLUMN "audience";
  ALTER TABLE "content" DROP COLUMN "program";
  ALTER TABLE "content" DROP COLUMN "snoozed_at";
  ALTER TABLE "content_rels" DROP COLUMN "carriers_id";
  ALTER TABLE "_content_v" DROP COLUMN "version_audience";
  ALTER TABLE "_content_v" DROP COLUMN "version_program";
  ALTER TABLE "_content_v" DROP COLUMN "version_snoozed_at";
  ALTER TABLE "_content_v_rels" DROP COLUMN "carriers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "carriers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "kits_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "feedback_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "saved_id";
  DROP TYPE "public"."enum_content_licensing";
  DROP TYPE "public"."enum_content_lines";
  DROP TYPE "public"."enum_content_audience";
  DROP TYPE "public"."enum_content_program";
  DROP TYPE "public"."enum__content_v_version_licensing";
  DROP TYPE "public"."enum__content_v_version_lines";
  DROP TYPE "public"."enum__content_v_version_audience";
  DROP TYPE "public"."enum__content_v_version_program";
  DROP TYPE "public"."enum_carriers_lines";
  DROP TYPE "public"."enum_kits_section";
  DROP TYPE "public"."enum_feedback_kind";`)
}
