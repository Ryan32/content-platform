import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_assets_role" AS ENUM('download', 'inline');
  CREATE TABLE "content_more_videos" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"vimeo_id" varchar,
  	"title" varchar
  );
  
  CREATE TABLE "_content_v_version_more_videos" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"vimeo_id" varchar,
  	"title" varchar,
  	"_uuid" varchar
  );
  
  ALTER TABLE "content_passages" ADD COLUMN "asset_id" numeric;
  ALTER TABLE "_content_v_version_passages" ADD COLUMN "asset_id" numeric;
  ALTER TABLE "assets" ADD COLUMN "file_name" varchar;
  ALTER TABLE "assets" ADD COLUMN "role" "enum_assets_role" DEFAULT 'download';
  ALTER TABLE "assets" ADD COLUMN "description" varchar;
  ALTER TABLE "assets" ADD COLUMN "bytes" numeric;
  ALTER TABLE "content_more_videos" ADD CONSTRAINT "content_more_videos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v_version_more_videos" ADD CONSTRAINT "_content_v_version_more_videos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_content_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "content_more_videos_order_idx" ON "content_more_videos" USING btree ("_order");
  CREATE INDEX "content_more_videos_parent_id_idx" ON "content_more_videos" USING btree ("_parent_id");
  CREATE INDEX "_content_v_version_more_videos_order_idx" ON "_content_v_version_more_videos" USING btree ("_order");
  CREATE INDEX "_content_v_version_more_videos_parent_id_idx" ON "_content_v_version_more_videos" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "content_more_videos" CASCADE;
  DROP TABLE "_content_v_version_more_videos" CASCADE;
  ALTER TABLE "content_passages" DROP COLUMN "asset_id";
  ALTER TABLE "_content_v_version_passages" DROP COLUMN "asset_id";
  ALTER TABLE "assets" DROP COLUMN "file_name";
  ALTER TABLE "assets" DROP COLUMN "role";
  ALTER TABLE "assets" DROP COLUMN "description";
  ALTER TABLE "assets" DROP COLUMN "bytes";
  DROP TYPE "public"."enum_assets_role";`)
}
