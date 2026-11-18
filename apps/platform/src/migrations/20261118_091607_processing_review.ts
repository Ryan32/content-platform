import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "suggestions" ADD COLUMN "job_key" varchar;
  ALTER TABLE "suggestions" ADD COLUMN "reviewed_by_id" integer;
  ALTER TABLE "suggestions" ADD COLUMN "reviewed_at" timestamp(3) with time zone;
  ALTER TABLE "processing_jobs" ADD COLUMN "input" jsonb;
  ALTER TABLE "processing_jobs" ADD COLUMN "result" jsonb;
  ALTER TABLE "processing_jobs" ADD COLUMN "processor_version" varchar;
  ALTER TABLE "processing_jobs" ADD COLUMN "lease_token" varchar;
  ALTER TABLE "processing_jobs" ADD COLUMN "lease_until" timestamp(3) with time zone;
  ALTER TABLE "processing_jobs" ADD COLUMN "next_run_at" timestamp(3) with time zone;
  ALTER TABLE "processing_jobs" ADD COLUMN "deadline_at" timestamp(3) with time zone;
  ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "suggestions_job_key_idx" ON "suggestions" USING btree ("job_key");
  CREATE INDEX "suggestions_reviewed_by_idx" ON "suggestions" USING btree ("reviewed_by_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "suggestions" DROP CONSTRAINT "suggestions_reviewed_by_id_users_id_fk";

  DROP INDEX "suggestions_job_key_idx";
  DROP INDEX "suggestions_reviewed_by_idx";
  ALTER TABLE "suggestions" DROP COLUMN "job_key";
  ALTER TABLE "suggestions" DROP COLUMN "reviewed_by_id";
  ALTER TABLE "suggestions" DROP COLUMN "reviewed_at";
  ALTER TABLE "processing_jobs" DROP COLUMN "input";
  ALTER TABLE "processing_jobs" DROP COLUMN "result";
  ALTER TABLE "processing_jobs" DROP COLUMN "processor_version";
  ALTER TABLE "processing_jobs" DROP COLUMN "lease_token";
  ALTER TABLE "processing_jobs" DROP COLUMN "lease_until";
  ALTER TABLE "processing_jobs" DROP COLUMN "next_run_at";
  ALTER TABLE "processing_jobs" DROP COLUMN "deadline_at";`)
}
