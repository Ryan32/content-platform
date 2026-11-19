import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Vimeo embed hashes. Most AE videos are unlisted: the player only plays them when its address carries the video's
 * privacy hash (?h=...). The worker reads each video's hash from the Vimeo API once and keeps it here, keyed by video ID,
 * for main and additional videos alike. Hand-written: not a Payload collection, so Payload schema snapshots are unchanged.
 * Readers only receive a hash on the page of an item they may view.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TABLE IF NOT EXISTS "vimeo_embeds" (
    "video_id" varchar PRIMARY KEY NOT NULL CHECK ("video_id" ~ '^[1-9][0-9]{0,19}$'),
    "hash" varchar CHECK ("hash" IS NULL OR "hash" ~ '^[0-9a-f]{6,40}$'),
    "status" varchar NOT NULL,
    "checked_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "vimeo_embeds";`)
}
