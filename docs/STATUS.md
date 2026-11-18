# Current status and next-engagement handoff

This document captures work completed in the originating Portal conversation. Vendor research was performed on 2026-11-17; recheck time-sensitive terms when needed.

## Completed

- Compared commercial, open-source, and source-available CMS/KB options using multiple research agents and primary documentation.
- Selected Payload as the working custom-platform candidate, with Bloomfire as the packaged benchmark and Directus as another self-hosted option.
- User supplied the DBR WordPress backup at `data/dbr-backup`; the bulk file copy is still in progress (user reports approximately 20 GB). Completeness is not yet verified.
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

No full Vimeo inventory, full WordPress backup validation/restore, content extraction, transcription, cleanup, taxonomy approval, CMS installation, cloud provisioning, or production deployment.

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

1. After the user confirms the copy into `data/dbr-backup` has finished, preserve the source and record a stable manifest/hashes. Establish backup timestamp, source totals, and whether the original archive is also available; do not assume the extracted tree is the original archive.
2. Validate the database dump and file inventory, reconcile against available source evidence, and report missing or unresolved components. Then plan an isolated restore using compatible versions and disabled outbound integrations.
3. Extract a source manifest, including custom fields/access rules and Vimeo references.
4. Inventory Vimeo API coverage with pagination and sanitized output, then reconcile against actual WordPress video IDs. Check workspace/account context rather than assuming the personal-library endpoint covers everything.
5. Resolve access and missing-content exceptions before platform provisioning or large downloads.

While the backup copy is in progress, a read-only Vimeo metadata inventory is useful independent work when requested. Avoid bulk media downloads merely to count videos.

## Suggested opening prompt for the new engagement

> Read AGENTS.md, README.md, and docs/STATUS.md. Continue the source-validation phase. Inspect the WP Engine backup I provide, preserve the original, and build a content/Vimeo inventory before provisioning the new platform. Use the existing .env.local token without printing it or signed media URLs.
