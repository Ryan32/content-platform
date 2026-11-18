import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_content_topics" AS ENUM('products:carriers-a-z', 'products:commission-schedules', 'products:rates-performance', 'products:aewm-strategies', 'products:product-changes', 'products:carrier-snapshots', 'operations:forms', 'operations:sample-applications', 'operations:new-business-nigo', 'operations:transfers', 'operations:schwab-fidelity', 'operations:compliance', 'marketing:seminar-kits', 'marketing:recorded-seminars', 'marketing:campaigns-print-on-demand', 'marketing:scripts-appointments', 'marketing:client-events-invites', 'marketing:digital-social', 'planning:retirement-income', 'planning:tax-rmds-iras', 'planning:social-security', 'planning:estate-legacy', 'planning:long-term-care', 'planning:high-net-worth', 'coaching:practice-management', 'coaching:hiring-hr-hub', 'coaching:onboard-your-staff', 'coaching:team-training', 'coaching:leadership', 'coaching:coaching-programs', 'events:upcoming-events', 'events:the-journey', 'events:world-series-of-success', 'events:aexchange', 'events:forums-summits', 'events:webinar-replays');
  CREATE TYPE "public"."enum_content_pages" AS ENUM('products:commission-schedules', 'products:annuity-carrier-information', 'products:annuity-rate-watch', 'products:aewm-strategy-menu', 'operations:suitability-quick-reference-matrix', 'operations:transfer-company-list', 'operations:aewm-forms', 'operations:sample-applications', 'marketing:recorded-seminars', 'marketing:turnkey-seminars-webinars', 'marketing:real-wins', 'marketing:print-on-demand', 'planning:advanced-markets', 'planning:ask-the-experts', 'planning:high-net-worth', 'planning:whitepapers', 'coaching:hr-hub', 'coaching:advisor-talent-solutions', 'coaching:onboard-your-staff', 'coaching:stretch-leadership', 'events:the-journey', 'events:world-series-of-success', 'events:ops-connect', 'events:live-events-calendar');
  CREATE TYPE "public"."enum_content_kind" AS ENUM('resource', 'howto');
  CREATE TYPE "public"."enum_content_section" AS ENUM('products', 'operations', 'marketing', 'planning', 'coaching', 'events');
  CREATE TYPE "public"."enum_content_review_window" AS ENUM('monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'fixedDate');
  CREATE TYPE "public"."enum__content_v_version_topics" AS ENUM('products:carriers-a-z', 'products:commission-schedules', 'products:rates-performance', 'products:aewm-strategies', 'products:product-changes', 'products:carrier-snapshots', 'operations:forms', 'operations:sample-applications', 'operations:new-business-nigo', 'operations:transfers', 'operations:schwab-fidelity', 'operations:compliance', 'marketing:seminar-kits', 'marketing:recorded-seminars', 'marketing:campaigns-print-on-demand', 'marketing:scripts-appointments', 'marketing:client-events-invites', 'marketing:digital-social', 'planning:retirement-income', 'planning:tax-rmds-iras', 'planning:social-security', 'planning:estate-legacy', 'planning:long-term-care', 'planning:high-net-worth', 'coaching:practice-management', 'coaching:hiring-hr-hub', 'coaching:onboard-your-staff', 'coaching:team-training', 'coaching:leadership', 'coaching:coaching-programs', 'events:upcoming-events', 'events:the-journey', 'events:world-series-of-success', 'events:aexchange', 'events:forums-summits', 'events:webinar-replays');
  CREATE TYPE "public"."enum__content_v_version_pages" AS ENUM('products:commission-schedules', 'products:annuity-carrier-information', 'products:annuity-rate-watch', 'products:aewm-strategy-menu', 'operations:suitability-quick-reference-matrix', 'operations:transfer-company-list', 'operations:aewm-forms', 'operations:sample-applications', 'marketing:recorded-seminars', 'marketing:turnkey-seminars-webinars', 'marketing:real-wins', 'marketing:print-on-demand', 'planning:advanced-markets', 'planning:ask-the-experts', 'planning:high-net-worth', 'planning:whitepapers', 'coaching:hr-hub', 'coaching:advisor-talent-solutions', 'coaching:onboard-your-staff', 'coaching:stretch-leadership', 'events:the-journey', 'events:world-series-of-success', 'events:ops-connect', 'events:live-events-calendar');
  CREATE TYPE "public"."enum__content_v_version_kind" AS ENUM('resource', 'howto');
  CREATE TYPE "public"."enum__content_v_version_section" AS ENUM('products', 'operations', 'marketing', 'planning', 'coaching', 'events');
  CREATE TYPE "public"."enum__content_v_version_review_window" AS ENUM('monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'fixedDate');
  CREATE TABLE "content_topics" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_content_topics",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "content_pages" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_content_pages",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "_content_v_version_topics" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum__content_v_version_topics",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "_content_v_version_pages" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum__content_v_version_pages",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  ALTER TABLE "content" ADD COLUMN "kind" "enum_content_kind" DEFAULT 'resource' NOT NULL;
  ALTER TABLE "content" ADD COLUMN "section" "enum_content_section";
  ALTER TABLE "content" ADD COLUMN "review_window" "enum_content_review_window" DEFAULT 'annual' NOT NULL;
  ALTER TABLE "content" ADD COLUMN "review_on" timestamp(3) with time zone;
  ALTER TABLE "content" ADD COLUMN "owner_id" integer;
  ALTER TABLE "content" ADD COLUMN "review_due_at" timestamp(3) with time zone;
  ALTER TABLE "content" ADD COLUMN "last_reviewed_at" timestamp(3) with time zone;
  ALTER TABLE "_content_v" ADD COLUMN "version_kind" "enum__content_v_version_kind" DEFAULT 'resource' NOT NULL;
  ALTER TABLE "_content_v" ADD COLUMN "version_section" "enum__content_v_version_section";
  ALTER TABLE "_content_v" ADD COLUMN "version_review_window" "enum__content_v_version_review_window" DEFAULT 'annual' NOT NULL;
  ALTER TABLE "_content_v" ADD COLUMN "version_review_on" timestamp(3) with time zone;
  ALTER TABLE "_content_v" ADD COLUMN "version_owner_id" integer;
  ALTER TABLE "_content_v" ADD COLUMN "version_review_due_at" timestamp(3) with time zone;
  ALTER TABLE "_content_v" ADD COLUMN "version_last_reviewed_at" timestamp(3) with time zone;
  ALTER TABLE "content_topics" ADD CONSTRAINT "content_topics_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v_version_topics" ADD CONSTRAINT "_content_v_version_topics_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_content_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_content_v_version_pages" ADD CONSTRAINT "_content_v_version_pages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_content_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "content_topics_order_idx" ON "content_topics" USING btree ("order");
  CREATE INDEX "content_topics_parent_idx" ON "content_topics" USING btree ("parent_id");
  CREATE INDEX "content_pages_order_idx" ON "content_pages" USING btree ("order");
  CREATE INDEX "content_pages_parent_idx" ON "content_pages" USING btree ("parent_id");
  CREATE INDEX "_content_v_version_topics_order_idx" ON "_content_v_version_topics" USING btree ("order");
  CREATE INDEX "_content_v_version_topics_parent_idx" ON "_content_v_version_topics" USING btree ("parent_id");
  CREATE INDEX "_content_v_version_pages_order_idx" ON "_content_v_version_pages" USING btree ("order");
  CREATE INDEX "_content_v_version_pages_parent_idx" ON "_content_v_version_pages" USING btree ("parent_id");
  ALTER TABLE "content" ADD CONSTRAINT "content_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_content_v" ADD CONSTRAINT "_content_v_version_owner_id_users_id_fk" FOREIGN KEY ("version_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "content_section_idx" ON "content" USING btree ("section");
  CREATE INDEX "content_owner_idx" ON "content" USING btree ("owner_id");
  CREATE INDEX "content_review_due_at_idx" ON "content" USING btree ("review_due_at");
  CREATE INDEX "_content_v_version_version_section_idx" ON "_content_v" USING btree ("version_section");
  CREATE INDEX "_content_v_version_version_owner_idx" ON "_content_v" USING btree ("version_owner_id");
  CREATE INDEX "_content_v_version_version_review_due_at_idx" ON "_content_v" USING btree ("version_review_due_at");
  -- Items already published count as reviewed at their last update and get the default 12-month window.
  UPDATE "content" SET "last_reviewed_at" = "updated_at", "review_due_at" = "updated_at" + interval '12 months'
    WHERE "state" = 'published' AND "last_reviewed_at" IS NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "content_topics" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "content_pages" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_content_v_version_topics" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_content_v_version_pages" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "content_topics" CASCADE;
  DROP TABLE "content_pages" CASCADE;
  DROP TABLE "_content_v_version_topics" CASCADE;
  DROP TABLE "_content_v_version_pages" CASCADE;
  ALTER TABLE "content" DROP CONSTRAINT "content_owner_id_users_id_fk";
  
  ALTER TABLE "_content_v" DROP CONSTRAINT "_content_v_version_owner_id_users_id_fk";
  
  DROP INDEX "content_section_idx";
  DROP INDEX "content_owner_idx";
  DROP INDEX "content_review_due_at_idx";
  DROP INDEX "_content_v_version_version_section_idx";
  DROP INDEX "_content_v_version_version_owner_idx";
  DROP INDEX "_content_v_version_version_review_due_at_idx";
  ALTER TABLE "content" DROP COLUMN "kind";
  ALTER TABLE "content" DROP COLUMN "section";
  ALTER TABLE "content" DROP COLUMN "review_window";
  ALTER TABLE "content" DROP COLUMN "review_on";
  ALTER TABLE "content" DROP COLUMN "owner_id";
  ALTER TABLE "content" DROP COLUMN "review_due_at";
  ALTER TABLE "content" DROP COLUMN "last_reviewed_at";
  ALTER TABLE "_content_v" DROP COLUMN "version_kind";
  ALTER TABLE "_content_v" DROP COLUMN "version_section";
  ALTER TABLE "_content_v" DROP COLUMN "version_review_window";
  ALTER TABLE "_content_v" DROP COLUMN "version_review_on";
  ALTER TABLE "_content_v" DROP COLUMN "version_owner_id";
  ALTER TABLE "_content_v" DROP COLUMN "version_review_due_at";
  ALTER TABLE "_content_v" DROP COLUMN "version_last_reviewed_at";
  DROP TYPE "public"."enum_content_topics";
  DROP TYPE "public"."enum_content_pages";
  DROP TYPE "public"."enum_content_kind";
  DROP TYPE "public"."enum_content_section";
  DROP TYPE "public"."enum_content_review_window";
  DROP TYPE "public"."enum__content_v_version_topics";
  DROP TYPE "public"."enum__content_v_version_pages";
  DROP TYPE "public"."enum__content_v_version_kind";
  DROP TYPE "public"."enum__content_v_version_section";
  DROP TYPE "public"."enum__content_v_version_review_window";`)
}
