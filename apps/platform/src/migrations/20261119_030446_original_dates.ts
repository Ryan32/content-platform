import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "content" ADD COLUMN "original_published_at" timestamp(3) with time zone;
  ALTER TABLE "content" ADD COLUMN "original_updated_at" timestamp(3) with time zone;
  ALTER TABLE "content" ADD COLUMN "listed_at" timestamp(3) with time zone;
  ALTER TABLE "_content_v" ADD COLUMN "version_original_published_at" timestamp(3) with time zone;
  ALTER TABLE "_content_v" ADD COLUMN "version_original_updated_at" timestamp(3) with time zone;
  ALTER TABLE "_content_v" ADD COLUMN "version_listed_at" timestamp(3) with time zone;
  CREATE INDEX "content_listed_at_idx" ON "content" USING btree ("listed_at");
  CREATE INDEX "_content_v_version_version_listed_at_idx" ON "_content_v" USING btree ("version_listed_at");
  -- Existing items are listed by when they were added.
  UPDATE "content" SET "listed_at" = COALESCE("original_published_at", "created_at") WHERE "listed_at" IS NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "content_listed_at_idx";
  DROP INDEX "_content_v_version_version_listed_at_idx";
  ALTER TABLE "content" DROP COLUMN "original_published_at";
  ALTER TABLE "content" DROP COLUMN "original_updated_at";
  ALTER TABLE "content" DROP COLUMN "listed_at";
  ALTER TABLE "_content_v" DROP COLUMN "version_original_published_at";
  ALTER TABLE "_content_v" DROP COLUMN "version_original_updated_at";
  ALTER TABLE "_content_v" DROP COLUMN "version_listed_at";`)
}
