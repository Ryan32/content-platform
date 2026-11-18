# Current status and next-engagement handoff

This document captures work completed in the originating Portal conversation. Vendor research was performed on 2026-11-17; recheck time-sensitive terms when needed.

## Active priority — core platform and general MCP

### GitHub handoff preparation

- User authorized committing and pushing the local application foundation, importer, migrations, tests and documentation to `main`. Pre-commit fetch showed local `main` aligned with `origin/main`.
- Reviewed 63 staged files: no excluded data/credential/build paths or matches for the credential patterns checked. Private packages/backups and real environment files remain ignored. Normalized whitespace in generated migration SQL; no schema changes.
- Other laptop: pull the resulting commit before building updated web/operations images. Private import packages require separate secure transfer; Git does not contain them. Prior validation remains 31 passing application tests, TypeScript and production build; live RDS acceptance is outstanding.

### Transactional Payload import adapter — local implementation

- Added private immutable source snapshots, artifacts, relationships, lifecycle review flags and completion receipts, with generated types and migration `20261118_041309_import_adapter`. New content stays restricted intake; changed source stages proposals without overwriting editorial state.
- Added offline `check`, read-only database `preview`, and bounded serializable `apply`, explicit development target/package guards and fresh completion-receipt confirmation. Completed packages rerun without duplication. No binary transfer.
- Validation: TypeScript and production build passed; 31 tests across six files passed (15 new importer/transaction-wiring tests). Real v3 package validated: 12 records, 350 relationships, unchanged package ID. Transaction tests use doubles; no live RDS atomicity/permissions claim.
- Migration generated offline with a disposable schema-generation placeholder after the first attempt reported a missing secret. No actual secrets read, migrations applied, or cloud/database changes made. Optional Docker operations target added; image build/run untested here.
- [Adapter runbook](PAYLOAD-IMPORT-ADAPTER.md) documents ADR-017–020 and acceptance steps. Next: subsequent image build, isolated dev RDS migrations, preview/apply and live rerun/access validation. The current image upload does not automatically include these edits. Auth0/AXL remain deferred; processing and vectors follow the acceptance gate.

### Offline WordPress import package

- Implemented `scripts/build_wordpress_import.py` and synthetic tests. Produces a deterministic private intake package, original selected SQLite source snapshots, normalized create-only content proposals, taxonomy/attachment/Vimeo/file relationships, and a dry-run plan. No Payload/RDS apply operation, network call, media download, source modification, publication or paid AI processing.
- Authoritative package: `data/wordpress-import/pilot-v3/`, independently reproduced in `pilot-v3-repeat/`. Package ID `62f1ecfa909f1777334b0149af0a79fa62db23197f82c354f9effe39e19e1119`; both `package.json` files are byte-identical. Earlier v1/v2 packages are exploratory subsets preserved locally.
- Selected 12 records with 12 source snapshots, 83 freshly verified local file paths/blobs (69,858,518 bytes), one Vimeo provider reference, 80 source taxonomy terms, 104 taxonomy edges, three attachment edges and 117 asset edges. One blob is shared across distinct records without merging their identities. Format coverage includes PDF, article, Vimeo, Word, slides, spreadsheet, audio and local video.
- All 20 negative controls excluded; 188 other pilot records left outside this bounded subset. All selected content remains intake with no access grants. Flags preserve unresolved policies/canonical URLs, external or missing references, builder-rendering gaps and missing descriptions. No original binary files copied.
- Reconciliation against a simulated target with reviewed titles/tags produced 12 unchanged actions and left target state intact. Changed-source staging, already-staged hashes, and review of an existing ineligible source are covered by synthetic tests; this is not a live CMS idempotency claim. Repeat evidence is in ignored `data/wordpress-import/pilot-v3-validation.json`.
- Validation: 19 importer tests and all eight existing inventory/parser tests passed (27 total); final real-package validation and `git diff --check` passed. A GPT-6.2 Astra subagent reviewed the design/code and identified two validation gaps. Fixed both: completion markers must enumerate all three expected artifact files, and relationship kinds/status pairs are allowlisted. Added regression tests; no private source data was opened by the reviewer.
- Added [package runbook and mappings](WORDPRESS-IMPORT-PACKAGE.md), ADR-013–016, requirement traceability and the next adapter boundary. General Auth0 setup remains shelved; AWS state is still to reconcile. Next: review source issues, implement the transactional Payload/source-snapshot adapter for isolated dev RDS, then extraction and caption/transcript jobs.

Auth0 setup: added [development registration instructions](AUTH0-DEV-SETUP.md) for the user's current tenant setup. Chosen browser integration route contract is Next.js SDK v4 `/auth/callback` (implementation pending). Tenant changes and live login remain unverified.

Naming confirmed: **AE Library**, development `library-dev.advisorsexcel.com`, production `library.advisorsexcel.com`; use the same Auth0 tenant as Portal with separate library registrations. Updated the configuration example and AWS handoff. DNS, certificates and Auth0 registrations have not been changed or verified in this step.

### Application foundation implemented — 2026-11-17 (local date)

- Created `apps/platform`: Payload 3.94/Next 16.4 application, pinned Node 24.22.3, RDS PostgreSQL adapter with verified TLS and automatic schema push disabled, seven domain collections, generated types and an initial versioned migration. Migration filename uses UTC date `20261118`; it was generated without a database connection and has not been applied.
- Added server-maintained Auth0 principal lookup and RS256 issuer/audience/expiry verification, scoped view/retrieve/download grants, protected editorial/publication fields, version-access restrictions, and withdrawal to draft when published evidence changes. Local passwords and public first-admin signup are disabled. Interactive browser sign-in, identity provisioning and real database enforcement tests remain outstanding.
- Added a Portal-aligned branded library shell with search/filter form and guarded detail/citation pages. No real content or demo identities are exposed. PDF/Vimeo viewers and original-file delivery remain unimplemented.
- Added stateless Streamable HTTP MCP with `search_content`, `get_content`, `resolve_citation`, OAuth protected-resource metadata, coarse scopes, shared retrieval policy, payload-size limits, and version checks. Keyword retrieval is implemented; embeddings/vector ranking and processing workers are not.
- Validation: TypeScript check passed; 16 tests across four files passed (scoped permissions, JWT signatures/issuer/audience/expiry, editorial restrictions, publication withdrawal, SDK tool calls, stateless HTTP initialization, simulated revocation and superseded citations). Production build passed. Standalone HTTP checks returned 200 for reader HTML/CSS and liveness, and 503 for unconfigured protected-resource metadata/MCP. The local smoke server was stopped. No browser visual test or live OAuth/database/cloud test was performed.
- Dependency audit: initial critical DOMPurify finding resolved with a pinned 3.4.18 override; final install reports 20 affected packages (16 high, 4 moderate), including transitive picomatch and legacy esbuild. Remaining findings require remediation/runtime review before production release. No forced major-version dependency changes.
- Added [application architecture decisions and requirements ledger](APPLICATION-FOUNDATION.md), including ADR-001 through ADR-012, implementation/test mapping, setup instructions, limitations and release gates. Dockerfile prepared but image build/run not tested. No secrets/private backups were read or changed; generated output/dependencies are ignored.
- Next: reconcile AWS state, validate the migration in isolated dev, add secure principal provisioning and interactive reader/admin Auth0 sessions, then test actual two-user MCP/REST access before ingestion and protected file delivery. General client compatibility remains unverified; AXL remains deferred.

User directed that AXL findings be retained for later. [Core platform and MCP](CORE-PLATFORM-AND-MCP.md) is now the active delivery plan, superseding the AXL-specific next steps in historical sections below. Deliver CMS/manual editing, ingestion/enrichment, governed retrieval, stable reader links, and read-only remote MCP with per-user Auth0 authorization. Claude, ChatGPT, and the selected Copilot surface are targets, not validated integrations.

AXL and Portal evidence is preserved in their review documents and explicitly marked deferred. Primary MCP/vendor documentation was checked on 2026-11-17; client registration, tenant configuration, end-user identity, and actual compatibility remain to test. The plan distinguishes future access revocation from external clients' already-retained evidence.

The original planning next step was the schema/access and synthetic MCP slice; the foundation above now implements that code. Live Auth0/OAuth, RDS and approved real-content acceptance remain to complete. No new cloud resources were created here.

## Completed

- Compared commercial, open-source, and source-available CMS/KB options using multiple research agents and primary documentation.
- Selected Payload as the working custom-platform candidate, with Bloomfire as the packaged benchmark and Directus as another self-hosted option.
- User supplied the DBR WordPress backup at `data/dbr-backup` and later confirmed copy completion. Offline inventory is complete as described below; live-source completeness and restore readiness remain unverified.
- Created this workspace, `.env.local`, `.gitignore`, and the Vimeo diagnostic script.
- User created an authenticated Vimeo API token and placed it locally. Do not expose or overwrite it.
- Downloaded the configured video successfully without enabling viewer downloads or modifying Vimeo settings.

## AXL backend review — 2026-11-17

- User supplied `D:/source/node-ai-api`; reviewed commit `94a8d02d1bccad2c121eb1f707c44f17c8dff521` read-only. Agent-specific instructions/tools and authenticated HTTP MCP client support exist in source. No runtime deployment or connectivity claim.
- Added [AXL backend review](AXL-BACKEND-REVIEW.md). Recommended first slice is a standalone Portal-styled reader with a dedicated AXL library agent on the existing backend and a read-only content MCP server. Deep Portal integration is deferred.
- Identified concrete integration requirements: delegated content identity, principal-safe MCP client caching, application/agent-bound conversations, restricted agent entry points, and stream/history compatibility. Existing agent streams disable structured sources; trusted markdown source links are sufficient initially.
- External Auth0 authorizer behavior remains unverified. No backend edits, dependency installs, credentials read, live calls, or runtime tests. Next step: implement and test a synthetic MCP/library-agent vertical slice, then approved PDF/Vimeo evidence and the branded reader UI.

## Portal and AXL integration review — 2026-11-17

- Read-only review of `D:/source/portal-v2` at `50016152` verified the current React/Vite shell, shared design tokens, typed navigation/access rules, semantic view framework, assistant transport, and global-search provider contract. Preserved unrelated untracked files; did not pull, edit, or test Portal runtime.
- Added [Portal reader UI and AXL integration contract](PORTAL-AXL-INTEGRATION.md). Recommends a native Portal reader feature, one authorized retrieval service, versioned page/time citations, explicit chat source rendering, and scoped server-side authorization.
- Verified that Portal's shared token helper returns an ID token and its chat component does not explicitly render structured citation/source parts. Both need an agreed integration implementation; this is not a claim about existing backend token validation.
- The AI backend checkout referenced by Portal README (`../node-ai-api`) was absent. Existing server tools, MCP, retrieval, and delegated identity remain unverified. Next concrete step: inspect that backend and finalize the token/tool/citation contract, then build a PDF-plus-Vimeo vertical slice with permission isolation tests.
- No cloud changes, live source calls, private-content AI processing, application code, or runtime integration tests occurred in this review. AWS foundation remains ECS/Fargate, RDS PostgreSQL, and one private S3 bucket per environment.

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
- Revised the storage plan to one private S3 bucket per environment, with prefix-scoped IAM and expiration limited to `processing/`. Carry these rules into the dev change set and verify them before importing content. No bucket was created.

### Source validation

1. Review the proposed 200-record pilot in `data/wordpress-inventory/scan-2026-11-17-v2/pilot-review.csv` and approve a 25-item smoke set with owners/audiences.
2. Resolve the two local image paths, external/staging references, unparsed builder value, canonical URLs, and source permission/firm hierarchy mappings. Establish original archive, backup timestamp, and live-source totals; plan an isolated restore for behavioral validation.
3. Confirm the taxonomy/access proposal's identity authority, business-line/profile rules, and human approval responsibilities. Keep all pilot intake restricted until mapping is approved.
4. Resume bounded Vimeo checks only when rate limits permit, then expand coverage and reconcile against source IDs. Check account/workspace context; do not assume personal-library enumeration covers everything.
5. Implement the local/dev smoke pipeline and labeled AI/retrieval/MCP evaluation described in `WORDPRESS-PILOT.md`, before expanding or running paid bulk processing.

Avoid bulk media downloads merely to count videos. Preserve the source backup and previous scan evidence.

## Suggested opening prompt for the new engagement

> Read AGENTS.md, README.md, and docs/STATUS.md. Continue the source-validation phase. Inspect the WP Engine backup I provide, preserve the original, and build a content/Vimeo inventory before provisioning the new platform. Use the existing .env.local token without printing it or signed media URLs.
