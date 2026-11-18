# Backup validation and migration runbook

## Phase 0: source access (current)

The DBR WordPress backup is located at `data/dbr-backup`. The user confirmed copy completion on 2026-11-17. A stable SQL hash, selected-table extraction, local file inventory, and proposed pilot are recorded under `data/wordpress-inventory/scan-2026-11-17-v2/`; see `WORDPRESS-PILOT.md`. These establish observed local content, not full live-source completeness or restore readiness. The visible source is an extracted WordPress tree; availability of its original archive is unresolved. Preserve the untouched source and, if available, the original archive; record backup timestamp, site identity, and size. Check archive paths and available disk space before any additional extraction.

Inventory the database dump, uploads, plugins, themes, and relevant configuration. Do not assume the archive contains offloaded media or external Vimeo assets. WordPress WXR is supplemental: it omits attachment binaries and site options.

Restore to an isolated local/container environment, or an appropriately isolated host. Disable outbound mail, cron jobs, webhooks, indexing, and production integrations before executing the restored application. Keep the database inaccessible publicly. Treat configuration and database contents as sensitive.

Validate source counts by post type/status, taxonomy relationships, custom fields, page-builder data, restricted-content rules, and representative attachment files. Compare selected restored records/pages with the source when access exists. Report missing/offloaded assets and unsupported plugins/custom tables.

## Phase 1: inventory

Create a machine-readable manifest with:

- Source site, post ID, content type, title, original URL, status, and source timestamps.
- Original body/custom fields, authors, tags, categories, and relationships.
- Source access rules and original-file download rules, with unknowns marked explicitly.
- Attachment identity/path/hash/size and external provider identifiers.
- Vimeo ID, embed/unlisted metadata, ownership/workspace if available, duration and captions availability.
- Processing stage, failure reason, disposition, proposed owner, and target record ID.

Find Vimeo references in body HTML, Gutenberg blocks, iframe URLs, shortcodes, custom fields, and page-builder structures. Do not rely on links in rendered public pages alone. Preserve unlisted hashes where needed without exposing private URLs in tracked reports.

One video used by several articles becomes one asset with multiple relationships. Preserve article-specific audience rules; asset deduplication must not broaden access.

## Phase 2: Vimeo coverage

Existing `.env.local` holds an authenticated token with intended public/private/video_files scopes. The user is an Enterprise admin. One download succeeded; full library coverage is untested.

Validate the authenticated account and enumerate accessible library resources with pagination and rate-limit handling. Team/workspace resources may require different endpoints/account context from the token user's personal library. Cross-check every WordPress Vimeo ID directly. Categorize missing, unauthorized, unavailable, external-owned, and retrievable items. Do not infer a successful inventory solely from `/me/videos`.

Prefer accessible existing captions if accurate. Otherwise request an authorized MP4/download link at job time, download without forwarding the bearer token to the CDN, validate transport length/file structure, and stage privately. Process once per source version. Use API expiry information and refresh links on retry.

Retain Vimeo playback. A downloaded processing copy is not authorization to expose original downloads to readers. Define temporary-media retention separately from master archival policy.

## Phase 3: representative ingestion

Offline preparation is now implemented in `scripts/build_wordpress_import.py`: a deterministic small pilot package, source snapshots/relationships, verified file fingerprints and editorial-preserving dry-run reconciliation. See [package contract and validation](WORDPRESS-IMPORT-PACKAGE.md). This prepares restricted intake proposals; no Payload/RDS writer or live import is implemented by that step.

Start with approximately 200 items, including restricted content, scans, tables, legacy shortcodes, slide notes/charts, recordings, reused assets, and broken references. Expand to approximately 1,000 only after schema, permissions, extraction, and editor experience pass review.

Use source-system/source-ID keys, hashes, job attempts, source modification dates, and processor versions. Separate immutable source capture, generated derivatives, and editorial overrides. On source changes, reconcile rather than blindly overwriting editorial cleanup.

## Phase 4: cleanup and classification

Import into restricted intake. Supported dispositions: keep, update, merge, archive, exclude, investigate. Exact hashes identify byte duplicates; near-duplicate suggestions need human decisions. Preserve provenance and old-to-new URL mappings. Do not delete source files or mark items approved solely from AI suggestions.

Assign owners, validate audiences, normalize taxonomy, and track unresolved items. Full-library processing follows only after the representative batches establish quality and operating cost.

## Phase 5: release and cutover

Deploy production code/schema, transfer approved content and derivatives, reconcile source-to-target counts and hashes, build a production index, and run audience/download/citation tests. Apply a final source delta with conflict handling. Document redirects, canonical replacements, content freeze, rollback, and source retention before cutover.

## Required outputs

Backup validation report; source inventory; Vimeo coverage report; migration manifest; exception queue; approved taxonomy map; editorial decision log; processing reconciliation; permission test results; release manifest and rollback instructions. Sensitive outputs belong under ignored `data/`.
