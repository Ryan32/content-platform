# Current status and next-engagement handoff

This document captures work completed in the originating Portal conversation. Vendor research was performed on 2026-11-17; recheck time-sensitive terms when needed.

## Completed

- Compared commercial, open-source, and source-available CMS/KB options using multiple research agents and primary documentation.
- Selected Payload as the working custom-platform candidate, with Bloomfire as the packaged benchmark and Directus as another self-hosted option.
- User supplied the DBR WordPress backup at `data/dbr-backup` and later confirmed copy completion. Offline inventory is complete as described below; live-source completeness and restore readiness remain unverified.
- Created this workspace, `.env.local`, `.gitignore`, and the Vimeo diagnostic script.
- User created an authenticated Vimeo API token and placed it locally. Do not expose or overwrite it.
- Downloaded the configured video successfully without enabling viewer downloads or modifying Vimeo settings.

## Verified Vimeo test

- Video ID: `1247791213`.
- Title: `Oct. 2026 - Retirement Analyzer Webinar`.
- Token authenticated as Ryan Fickel, API user `/users/265993816`.
- Vimeo reported unlisted visibility and `privacy.download = false`.
- API returned six download entries and six file entries.
- Downloaded the smallest MP4 rendition, 426 x 240, for a lightweight access test.
- API duration: 986 seconds (16 minutes 26 seconds).
- Downloaded size: 31,130,096 bytes, matching HTTP Content-Length.
- API metadata size: 31,571,174 bytes; this differed from the actual response and is recorded in the report.
- SHA-256: `71df2383a32e599918ab071df90c2aa435a90c51d4d61f679fe6fa93512c4e1f`.
- HTTP media type and MP4 file signature checked. Full decoding/audio quality have not been tested.

Local artifacts (ignored): `data/vimeo-validation/1247791213-test.mp4` and `data/vimeo-validation/1247791213-report.json`.

## Not completed

No full Vimeo inventory, full WordPress backup validation/restore, full-library document extraction, transcription, cleanup, taxonomy approval, CMS installation, cloud provisioning, or production deployment. Offline metadata extraction and bounded document probes have been completed.

## Offline inventory, pilot, and governance proposal — 2026-11-17

- User confirmed that the bulk backup copy is complete. Source files were not changed, and WordPress/PHP was not executed.
- Authoritative scan output: `data/wordpress-inventory/scan-2026-11-17-v2/`. Earlier scan artifacts are exploratory; the corrected v2 parser preserves escaped paired quotes in serialized builder data. Both passes observed the same unchanged source hash. Completion-marker handling was also corrected for this dump's bare `-- Dump completed` footer.
- SQL dump: 1,948,630,258 bytes; SHA-256 `af580deb9af330c182fc52671331ef0e7a0d0b01adb9991a595add6639072e31`. Extracted 9,664 posts, 442,946 postmeta rows, 1,526 terms/taxonomy rows, and 37,797 taxonomy relationships, plus selected supporting tables. SQLite integrity and extracted table counts passed. This is literal extraction, not a MySQL restore.
- Observed local tree: 58,939 files, 23,036,880,763 bytes. All 1,835 WordPress attachment records resolve to nonempty local files. This does not establish completeness of offloaded/external material. Found 3,927 orphan postmeta rows and no orphan taxonomy-ID relationships; investigate orphan metadata as source residue, not automatically missing content.
- Material candidates after status/availability/expiry screening: 5,280. Of these, 1,348 were published within 2025-11-17 through 2026-11-17, and 2,727 older records were modified in that window. Audience authorization remains unresolved/restricted intake. Recent material references 204 distinct Vimeo IDs.
- Created a deterministic 200-record proposed pilot and 20 stratified negative controls. Pilot format labels overlap: 107 PDF-linked, 56 Vimeo-linked, 12 Word-linked, 10 slide-linked, 8 audio-linked, 5 video-file-linked, 6 spreadsheet-linked, and 30 article records. Hashed 321 distinct locally present pilot files; all remained stable during hashing.
- Across recent active candidates: 3 unresolved local image references represent 2 distinct paths, plus 78 external asset-reference occurrences (including staging/third-party links). No recent referenced local PDF/Office file was classified as missing by the implemented resolver. One recent builder value remains unparsed; 47 recent candidate records have no description in the directly extracted descriptive fields. Canonical URLs, complex relationships, and actual source access enforcement still require review.
- Bounded native-text probes: 20 PDFs (first three pages only), 10 Word documents, and 10 PowerPoint decks. Text was found in 39; one PDF needs OCR/inspection. This is not a full quality/layout validation. Pinned optional pypdf dependency installed only under ignored `tmp/`.
- Direct read-only Vimeo checks confirmed metadata and authorized MP4-link presence for 16 final-pilot videos, 15 with caption tracks reported. The next request returned HTTP 429 and the batch stopped. No media/caption download, API mutation, or full-library coverage claim. Sanitized results are linked to the final pilot in `vimeo-pilot-check.json`.
- Added reusable inventory, pilot selection, document probe, and Vimeo diagnostic scripts; eight synthetic parser/path/serialization tests pass. Source SQL, PHP, and serialized objects are never executed by the inventory tooling. Data/credential exclusion remains intact.
- Added `docs/WORDPRESS-PILOT.md` and `docs/TAXONOMY-AND-ACCESS-MODEL.md`. The latter separates descriptive facets, user memberships, scoped action roles, and named access profiles; AI suggestions remain separate from manual decisions and security policy.
- No private material was sent to an AI model. No AWS resources, vector index, MCP endpoint, or application were created by this workspace's scan. The user subsequently requested check-in of the inventory tooling and updated plans; this check-in includes those scripts/docs, while private scan artifacts and credentials remain excluded.

## Initial source-control check-in — 2026-11-17

- User requested connection and initial check-in to `https://github.com/Ryan32/content-platform.git`. The remote was reachable and advertised no existing refs before initialization.
- Initial check-in contains project documentation, research artifacts, agent instructions, the Vimeo diagnostic, and the empty configuration example.
- Local credentials, `data/` backups/downloads, temporary files, editor settings, and Python caches are excluded. A clone on the other laptop will not contain the source backup or Vimeo token; transfer those separately using secure local methods.
- AWS handoff references to the workspace having no Git repository describe its state when that document was originally prepared; source control is now being established by this check-in.

## Project review and backup arrival — 2026-11-17

- Reviewed the project brief, architecture, migration runbook, governance, decisions, research summary, and existing Vimeo diagnostic. The workspace remains a planning/source-validation project; Payload and AWS remain proposals.
- Verified by shallow directory inspection: `data/dbr-backup` contains `wp-admin`, `wp-includes`, `wp-content`, and `wp-config.php`. The content directory includes uploads, plugins, must-use plugins, themes, and `mysql.sql` (1,948,630,258 bytes at inspection time). Presence and observed size do not establish file integrity or completeness.
- User reports the backup is intended to be full, but one bulk folder is still copying, approximately 20 GB. The specific folder and final source totals are not yet confirmed. Do not treat this arrival snapshot as a completed backup inventory.
- Inspected directory entries only inside the backup; did not read configuration/database contents, hash the moving dataset, execute WordPress, or alter source files. Some visible files are zero bytes; their significance remains unresolved until the copy finishes and source comparison is possible.
- Verified `.gitignore` includes `/data/` and local credential exclusions. `git status` confirmed this workspace is not currently a Git repository.
- Review priority: establish complete source evidence and source access rules before implementing the proposed platform. Existing volume/cost models remain estimates; the one-video Vimeo test does not establish library-wide coverage.

## Next concrete steps

### AWS handoff prepared — 2026-11-17

- Created `docs/AWS-SETUP-HANDOFF.md` for the laptop with AWS CLI tooling. User selected ECS/Fargate containers after discussing EC2 and explicitly required RDS PostgreSQL.
- Handoff covers discovery, infrastructure as code, networking, RDS, S3, IAM/secrets, container builds, migrations, ECS deployment, monitoring, recovery, and acceptance checks.
- Added the requested automated ingestion design: durable upload events, SQS workers, document extraction, Vimeo/captions and AWS Transcribe, AE-specific evidence-backed AI proposals, review, permission-aware indexing, retries, and invalidation. These are implementation instructions, not existing features.
- Checked relevant current primary Payload/AWS documentation and reviewed the handoff for consistency. No AWS calls, builds, provisioning, application tests, or source processing were performed. Bedrock and pgvector remain proposals.
- On the other laptop: read the handoff, discover the authorized account/region and existing conventions, then prepare IaC and a costed dev change set. The current request created instructions; apply infrastructure under the destination session's provisioning authorization. Continue source validation before importing real content.

### Source validation

1. Review the proposed 200-record pilot in `data/wordpress-inventory/scan-2026-11-17-v2/pilot-review.csv` and approve a 25-item smoke set with owners/audiences.
2. Resolve the two local image paths, external/staging references, unparsed builder value, canonical URLs, and source permission/firm hierarchy mappings. Establish original archive, backup timestamp, and live-source totals; plan an isolated restore for behavioral validation.
3. Confirm the taxonomy/access proposal's identity authority, business-line/profile rules, and human approval responsibilities. Keep all pilot intake restricted until mapping is approved.
4. Resume bounded Vimeo checks only when rate limits permit, then expand coverage and reconcile against source IDs. Check account/workspace context; do not assume personal-library enumeration covers everything.
5. Implement the local/dev smoke pipeline and labeled AI/retrieval/MCP evaluation described in `WORDPRESS-PILOT.md`, before expanding or running paid bulk processing.

Avoid bulk media downloads merely to count videos. Preserve the source backup and previous scan evidence.

## Suggested opening prompt for the new engagement

> Read AGENTS.md, README.md, and docs/STATUS.md. Continue the source-validation phase. Inspect the WP Engine backup I provide, preserve the original, and build a content/Vimeo inventory before provisioning the new platform. Use the existing .env.local token without printing it or signed media URLs.
