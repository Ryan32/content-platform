import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_users_roles" AS ENUM('reader', 'editor', 'admin');
  CREATE TYPE "public"."enum_access_profiles_grants_action" AS ENUM('view', 'retrieve', 'download');
  CREATE TYPE "public"."enum__access_profiles_v_version_grants_action" AS ENUM('view', 'retrieve', 'download');
  CREATE TYPE "public"."enum_taxonomy_dimension" AS ENUM('business-line', 'topic', 'audience', 'format', 'program', 'entity');
  CREATE TYPE "public"."enum_content_format" AS ENUM('article', 'pdf', 'video', 'audio', 'slides', 'document');
  CREATE TYPE "public"."enum_content_state" AS ENUM('intake', 'draft', 'published', 'archived');
  CREATE TYPE "public"."enum__content_v_version_format" AS ENUM('article', 'pdf', 'video', 'audio', 'slides', 'document');
  CREATE TYPE "public"."enum__content_v_version_state" AS ENUM('intake', 'draft', 'published', 'archived');
  CREATE TYPE "public"."enum_suggestions_decision" AS ENUM('pending', 'accepted', 'rejected');
  CREATE TYPE "public"."enum_processing_jobs_stage" AS ENUM('extract', 'transcribe', 'classify', 'index');
  CREATE TYPE "public"."enum_processing_jobs_state" AS ENUM('queued', 'running', 'succeeded', 'failed');
  CREATE TABLE "users_roles" (
    "order" integer NOT NULL,
    "parent_id" integer NOT NULL,
    "value" "enum_users_roles",
    "id" serial PRIMARY KEY NOT NULL
  );

  CREATE TABLE "users_memberships_entitlements" (
    "_order" integer NOT NULL,
    "_parent_id" varchar NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "users_memberships" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "scope" varchar NOT NULL
  );

  CREATE TABLE "users" (
    "id" serial PRIMARY KEY NOT NULL,
    "subject" varchar NOT NULL,
    "issuer" varchar NOT NULL,
    "active" boolean DEFAULT false,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "access_profiles_grants_entitlements" (
    "_order" integer NOT NULL,
    "_parent_id" varchar NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL
  );

  CREATE TABLE "access_profiles_grants" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "action" "enum_access_profiles_grants_action" NOT NULL,
    "scope" varchar NOT NULL
  );

  CREATE TABLE "access_profiles" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" varchar NOT NULL,
    "active" boolean DEFAULT false,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "_access_profiles_v_version_grants_entitlements" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" serial PRIMARY KEY NOT NULL,
    "value" varchar NOT NULL,
    "_uuid" varchar
  );

  CREATE TABLE "_access_profiles_v_version_grants" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" serial PRIMARY KEY NOT NULL,
    "action" "enum__access_profiles_v_version_grants_action" NOT NULL,
    "scope" varchar NOT NULL,
    "_uuid" varchar
  );

  CREATE TABLE "_access_profiles_v" (
    "id" serial PRIMARY KEY NOT NULL,
    "parent_id" integer,
    "version_name" varchar NOT NULL,
    "version_active" boolean DEFAULT false,
    "version_updated_at" timestamp(3) with time zone,
    "version_created_at" timestamp(3) with time zone,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "taxonomy" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar NOT NULL,
    "label" varchar NOT NULL,
    "definition" varchar,
    "dimension" "enum_taxonomy_dimension" NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "content_passages" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "citation_id" varchar NOT NULL,
    "version" varchar NOT NULL,
    "text" varchar NOT NULL,
    "locator" varchar NOT NULL
  );

  CREATE TABLE "content" (
    "id" serial PRIMARY KEY NOT NULL,
    "title" varchar NOT NULL,
    "description" varchar,
    "body" varchar,
    "format" "enum_content_format" NOT NULL,
    "state" "enum_content_state" DEFAULT 'intake' NOT NULL,
    "access_profile_id" integer,
    "available_at" timestamp(3) with time zone,
    "expires_at" timestamp(3) with time zone,
    "source_key" varchar,
    "source_hash" varchar,
    "evidence_version" varchar DEFAULT 'unprocessed' NOT NULL,
    "vimeo_id" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "content_rels" (
    "id" serial PRIMARY KEY NOT NULL,
    "order" integer,
    "parent_id" integer NOT NULL,
    "path" varchar NOT NULL,
    "taxonomy_id" integer
  );

  CREATE TABLE "_content_v_version_passages" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" serial PRIMARY KEY NOT NULL,
    "citation_id" varchar NOT NULL,
    "version" varchar NOT NULL,
    "text" varchar NOT NULL,
    "locator" varchar NOT NULL,
    "_uuid" varchar
  );

  CREATE TABLE "_content_v" (
    "id" serial PRIMARY KEY NOT NULL,
    "parent_id" integer,
    "version_title" varchar NOT NULL,
    "version_description" varchar,
    "version_body" varchar,
    "version_format" "enum__content_v_version_format" NOT NULL,
    "version_state" "enum__content_v_version_state" DEFAULT 'intake' NOT NULL,
    "version_access_profile_id" integer,
    "version_available_at" timestamp(3) with time zone,
    "version_expires_at" timestamp(3) with time zone,
    "version_source_key" varchar,
    "version_source_hash" varchar,
    "version_evidence_version" varchar DEFAULT 'unprocessed' NOT NULL,
    "version_vimeo_id" varchar,
    "version_updated_at" timestamp(3) with time zone,
    "version_created_at" timestamp(3) with time zone,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "_content_v_rels" (
    "id" serial PRIMARY KEY NOT NULL,
    "order" integer,
    "parent_id" integer NOT NULL,
    "path" varchar NOT NULL,
    "taxonomy_id" integer
  );

  CREATE TABLE "assets" (
    "id" serial PRIMARY KEY NOT NULL,
    "content_id" integer NOT NULL,
    "object_key" varchar NOT NULL,
    "sha256" varchar NOT NULL,
    "mime_type" varchar NOT NULL,
    "version" varchar NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "suggestions" (
    "id" serial PRIMARY KEY NOT NULL,
    "content_id" integer NOT NULL,
    "source_version" varchar NOT NULL,
    "model" varchar NOT NULL,
    "proposal" jsonb NOT NULL,
    "decision" "enum_suggestions_decision" DEFAULT 'pending',
    "review_note" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "processing_jobs" (
    "id" serial PRIMARY KEY NOT NULL,
    "idempotency_key" varchar NOT NULL,
    "content_id" integer NOT NULL,
    "source_version" varchar NOT NULL,
    "stage" "enum_processing_jobs_stage" NOT NULL,
    "state" "enum_processing_jobs_state" DEFAULT 'queued',
    "attempts" numeric DEFAULT 0,
    "error_code" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_kv" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar NOT NULL,
    "data" jsonb NOT NULL
  );

  CREATE TABLE "payload_locked_documents" (
    "id" serial PRIMARY KEY NOT NULL,
    "global_slug" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_locked_documents_rels" (
    "id" serial PRIMARY KEY NOT NULL,
    "order" integer,
    "parent_id" integer NOT NULL,
    "path" varchar NOT NULL,
    "users_id" integer,
    "access_profiles_id" integer,
    "taxonomy_id" integer,
    "content_id" integer,
    "assets_id" integer,
    "suggestions_id" integer,
    "processing_jobs_id" integer
  );

  CREATE TABLE "payload_preferences" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar,
    "value" jsonb,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_preferences_rels" (
    "id" serial PRIMARY KEY NOT NULL,
    "order" integer,
    "parent_id" integer NOT NULL,
    "path" varchar NOT NULL,
    "users_id" integer
  );

  CREATE TABLE "payload_migrations" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" varchar,
    "batch" numeric,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_memberships_entitlements" ADD CONSTRAINT "users_memberships_entitlements_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users_memberships"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_memberships" ADD CONSTRAINT "users_memberships_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "access_profiles_grants_entitlements" ADD CONSTRAINT "access_profiles_grants_entitlements_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."access_profiles_grants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "access_profiles_grants" ADD CONSTRAINT "access_profiles_grants_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."access_profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_access_profiles_v_version_grants_entitlements" ADD CONSTRAINT "_access_profiles_v_version_grants_entitlements_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_access_profiles_v_version_grants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_access_profiles_v_version_grants" ADD CONSTRAINT "_access_profiles_v_version_grants_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_access_profiles_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_access_profiles_v" ADD CONSTRAINT "_access_profiles_v_parent_id_access_profiles_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "content_passages" ADD CONSTRAINT "content_passages_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "content" ADD CONSTRAINT "content_access_profile_id_access_profiles_id_fk" FOREIGN KEY ("access_profile_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "content_rels" ADD CONSTRAINT "content_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "content_rels" ADD CONSTRAINT "content_rels_taxonomy_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."taxonomy"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v_version_passages" ADD CONSTRAINT "_content_v_version_passages_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_content_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v" ADD CONSTRAINT "_content_v_parent_id_content_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_content_v" ADD CONSTRAINT "_content_v_version_access_profile_id_access_profiles_id_fk" FOREIGN KEY ("version_access_profile_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_content_v_rels" ADD CONSTRAINT "_content_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_content_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v_rels" ADD CONSTRAINT "_content_v_rels_taxonomy_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."taxonomy"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "assets" ADD CONSTRAINT "assets_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_access_profiles_fk" FOREIGN KEY ("access_profiles_id") REFERENCES "public"."access_profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_taxonomy_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."taxonomy"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_content_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_assets_fk" FOREIGN KEY ("assets_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_suggestions_fk" FOREIGN KEY ("suggestions_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_processing_jobs_fk" FOREIGN KEY ("processing_jobs_id") REFERENCES "public"."processing_jobs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_roles_order_idx" ON "users_roles" USING btree ("order");
  CREATE INDEX "users_roles_parent_idx" ON "users_roles" USING btree ("parent_id");
  CREATE INDEX "users_memberships_entitlements_order_idx" ON "users_memberships_entitlements" USING btree ("_order");
  CREATE INDEX "users_memberships_entitlements_parent_id_idx" ON "users_memberships_entitlements" USING btree ("_parent_id");
  CREATE INDEX "users_memberships_order_idx" ON "users_memberships" USING btree ("_order");
  CREATE INDEX "users_memberships_parent_id_idx" ON "users_memberships" USING btree ("_parent_id");
  CREATE INDEX "users_subject_idx" ON "users" USING btree ("subject");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "issuer_subject_idx" ON "users" USING btree ("issuer","subject");
  CREATE INDEX "access_profiles_grants_entitlements_order_idx" ON "access_profiles_grants_entitlements" USING btree ("_order");
  CREATE INDEX "access_profiles_grants_entitlements_parent_id_idx" ON "access_profiles_grants_entitlements" USING btree ("_parent_id");
  CREATE INDEX "access_profiles_grants_order_idx" ON "access_profiles_grants" USING btree ("_order");
  CREATE INDEX "access_profiles_grants_parent_id_idx" ON "access_profiles_grants" USING btree ("_parent_id");
  CREATE INDEX "access_profiles_updated_at_idx" ON "access_profiles" USING btree ("updated_at");
  CREATE INDEX "access_profiles_created_at_idx" ON "access_profiles" USING btree ("created_at");
  CREATE INDEX "_access_profiles_v_version_grants_entitlements_order_idx" ON "_access_profiles_v_version_grants_entitlements" USING btree ("_order");
  CREATE INDEX "_access_profiles_v_version_grants_entitlements_parent_id_idx" ON "_access_profiles_v_version_grants_entitlements" USING btree ("_parent_id");
  CREATE INDEX "_access_profiles_v_version_grants_order_idx" ON "_access_profiles_v_version_grants" USING btree ("_order");
  CREATE INDEX "_access_profiles_v_version_grants_parent_id_idx" ON "_access_profiles_v_version_grants" USING btree ("_parent_id");
  CREATE INDEX "_access_profiles_v_parent_idx" ON "_access_profiles_v" USING btree ("parent_id");
  CREATE INDEX "_access_profiles_v_version_version_updated_at_idx" ON "_access_profiles_v" USING btree ("version_updated_at");
  CREATE INDEX "_access_profiles_v_version_version_created_at_idx" ON "_access_profiles_v" USING btree ("version_created_at");
  CREATE INDEX "_access_profiles_v_created_at_idx" ON "_access_profiles_v" USING btree ("created_at");
  CREATE INDEX "_access_profiles_v_updated_at_idx" ON "_access_profiles_v" USING btree ("updated_at");
  CREATE UNIQUE INDEX "taxonomy_key_idx" ON "taxonomy" USING btree ("key");
  CREATE INDEX "taxonomy_updated_at_idx" ON "taxonomy" USING btree ("updated_at");
  CREATE INDEX "taxonomy_created_at_idx" ON "taxonomy" USING btree ("created_at");
  CREATE INDEX "content_passages_order_idx" ON "content_passages" USING btree ("_order");
  CREATE INDEX "content_passages_parent_id_idx" ON "content_passages" USING btree ("_parent_id");
  CREATE INDEX "content_title_idx" ON "content" USING btree ("title");
  CREATE INDEX "content_access_profile_idx" ON "content" USING btree ("access_profile_id");
  CREATE UNIQUE INDEX "content_source_key_idx" ON "content" USING btree ("source_key");
  CREATE INDEX "content_updated_at_idx" ON "content" USING btree ("updated_at");
  CREATE INDEX "content_created_at_idx" ON "content" USING btree ("created_at");
  CREATE INDEX "content_rels_order_idx" ON "content_rels" USING btree ("order");
  CREATE INDEX "content_rels_parent_idx" ON "content_rels" USING btree ("parent_id");
  CREATE INDEX "content_rels_path_idx" ON "content_rels" USING btree ("path");
  CREATE INDEX "content_rels_taxonomy_id_idx" ON "content_rels" USING btree ("taxonomy_id");
  CREATE INDEX "_content_v_version_passages_order_idx" ON "_content_v_version_passages" USING btree ("_order");
  CREATE INDEX "_content_v_version_passages_parent_id_idx" ON "_content_v_version_passages" USING btree ("_parent_id");
  CREATE INDEX "_content_v_parent_idx" ON "_content_v" USING btree ("parent_id");
  CREATE INDEX "_content_v_version_version_title_idx" ON "_content_v" USING btree ("version_title");
  CREATE INDEX "_content_v_version_version_access_profile_idx" ON "_content_v" USING btree ("version_access_profile_id");
  CREATE INDEX "_content_v_version_version_source_key_idx" ON "_content_v" USING btree ("version_source_key");
  CREATE INDEX "_content_v_version_version_updated_at_idx" ON "_content_v" USING btree ("version_updated_at");
  CREATE INDEX "_content_v_version_version_created_at_idx" ON "_content_v" USING btree ("version_created_at");
  CREATE INDEX "_content_v_created_at_idx" ON "_content_v" USING btree ("created_at");
  CREATE INDEX "_content_v_updated_at_idx" ON "_content_v" USING btree ("updated_at");
  CREATE INDEX "_content_v_rels_order_idx" ON "_content_v_rels" USING btree ("order");
  CREATE INDEX "_content_v_rels_parent_idx" ON "_content_v_rels" USING btree ("parent_id");
  CREATE INDEX "_content_v_rels_path_idx" ON "_content_v_rels" USING btree ("path");
  CREATE INDEX "_content_v_rels_taxonomy_id_idx" ON "_content_v_rels" USING btree ("taxonomy_id");
  CREATE INDEX "assets_content_idx" ON "assets" USING btree ("content_id");
  CREATE INDEX "assets_updated_at_idx" ON "assets" USING btree ("updated_at");
  CREATE INDEX "assets_created_at_idx" ON "assets" USING btree ("created_at");
  CREATE INDEX "suggestions_content_idx" ON "suggestions" USING btree ("content_id");
  CREATE INDEX "suggestions_updated_at_idx" ON "suggestions" USING btree ("updated_at");
  CREATE INDEX "suggestions_created_at_idx" ON "suggestions" USING btree ("created_at");
  CREATE UNIQUE INDEX "processing_jobs_idempotency_key_idx" ON "processing_jobs" USING btree ("idempotency_key");
  CREATE INDEX "processing_jobs_content_idx" ON "processing_jobs" USING btree ("content_id");
  CREATE INDEX "processing_jobs_updated_at_idx" ON "processing_jobs" USING btree ("updated_at");
  CREATE INDEX "processing_jobs_created_at_idx" ON "processing_jobs" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_access_profiles_id_idx" ON "payload_locked_documents_rels" USING btree ("access_profiles_id");
  CREATE INDEX "payload_locked_documents_rels_taxonomy_id_idx" ON "payload_locked_documents_rels" USING btree ("taxonomy_id");
  CREATE INDEX "payload_locked_documents_rels_content_id_idx" ON "payload_locked_documents_rels" USING btree ("content_id");
  CREATE INDEX "payload_locked_documents_rels_assets_id_idx" ON "payload_locked_documents_rels" USING btree ("assets_id");
  CREATE INDEX "payload_locked_documents_rels_suggestions_id_idx" ON "payload_locked_documents_rels" USING btree ("suggestions_id");
  CREATE INDEX "payload_locked_documents_rels_processing_jobs_id_idx" ON "payload_locked_documents_rels" USING btree ("processing_jobs_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_roles" CASCADE;
  DROP TABLE "users_memberships_entitlements" CASCADE;
  DROP TABLE "users_memberships" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "access_profiles_grants_entitlements" CASCADE;
  DROP TABLE "access_profiles_grants" CASCADE;
  DROP TABLE "access_profiles" CASCADE;
  DROP TABLE "_access_profiles_v_version_grants_entitlements" CASCADE;
  DROP TABLE "_access_profiles_v_version_grants" CASCADE;
  DROP TABLE "_access_profiles_v" CASCADE;
  DROP TABLE "taxonomy" CASCADE;
  DROP TABLE "content_passages" CASCADE;
  DROP TABLE "content" CASCADE;
  DROP TABLE "content_rels" CASCADE;
  DROP TABLE "_content_v_version_passages" CASCADE;
  DROP TABLE "_content_v" CASCADE;
  DROP TABLE "_content_v_rels" CASCADE;
  DROP TABLE "assets" CASCADE;
  DROP TABLE "suggestions" CASCADE;
  DROP TABLE "processing_jobs" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TYPE "public"."enum_users_roles";
  DROP TYPE "public"."enum_access_profiles_grants_action";
  DROP TYPE "public"."enum__access_profiles_v_version_grants_action";
  DROP TYPE "public"."enum_taxonomy_dimension";
  DROP TYPE "public"."enum_content_format";
  DROP TYPE "public"."enum_content_state";
  DROP TYPE "public"."enum__content_v_version_format";
  DROP TYPE "public"."enum__content_v_version_state";
  DROP TYPE "public"."enum_suggestions_decision";
  DROP TYPE "public"."enum_processing_jobs_stage";
  DROP TYPE "public"."enum_processing_jobs_state";`)
}
