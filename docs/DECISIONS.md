# Decisions and open questions

## Confirmed direction

- Before another deployment, implement local permission/build checks, bounded PDF/Office/Vimeo processing, an RDS job queue, AI proposal review and protected reader delivery. ADR-021–027 are in [processing and review](PROCESSING-AND-REVIEW.md). This does not authorize paid processing, AWS resource changes or automatic publication. SQS/outbox integration and large-media/OCR/vector work remain distinct follow-on tasks.

- Implemented a bounded transactional Payload importer with immutable source staging and completion receipts. ADR-017–020 and requirement/test mappings are in the [adapter runbook](PAYLOAD-IMPORT-ADAPTER.md). Live isolated RDS validation remains pending; importer writes are confined to explicit operations tasks and do not publish content or overwrite editorial decisions.

- Proceed with a small, repeatable WordPress intake package while AWS is pending. Preserve source snapshots and relationship identities, keep unresolved permissions restricted, and stage changed source versions without overwriting reviewed edits. ADR-013–016 and requirement/test mappings are in [the importer runbook](WORDPRESS-IMPORT-PACKAGE.md). No live publication, paid AI processing or CMS writes are part of this offline slice.

- Product name: **AE Library**. Production hostname: `library.advisorsexcel.com`; development: `library-dev.advisorsexcel.com`. Keep AE Content Platform as the technical project name. Frontend, CMS, API and MCP share the environment hostname/deployment. Use Portal's existing Auth0 tenant, with separate application/API configuration for the library. DNS, certificate issuance and Auth0 configuration remain to verify; these names are selected, not evidence of live services.

- Record implementation decisions, architecture changes, and requirement/test traceability in project Markdown as work proceeds. The first code-level ADRs and requirements ledger are in [application foundation](APPLICATION-FOUNDATION.md).

- Latest user direction: preserve AXL/Portal findings for later and prioritize core AWS platform functionality plus general, read-only MCP for independently authenticated clients. Target Claude, ChatGPT, and the selected Copilot product through Auth0 OAuth; compatibility requires per-client testing. See [active plan](CORE-PLATFORM-AND-MCP.md). AXL-specific implementation is deferred.

- Validate the WordPress backup and Vimeo access before cloud provisioning.
- New standalone workspace: `D:/source/ae-content-platform`.
- Keep one editorial source of truth, with background processing/search services as needed.
- Retain Vimeo playback initially; use authorized media access for processing.
- Use long-lived isolated dev and prod; dev begins as the POC/migration workbench.
- Use one private S3 content bucket per environment with `source/`, `content/`, and `processing/` prefixes. Enforce access by prefix and limit temporary-file expiration to `processing/`.
- Separate view and download rights and preserve internal/external/firm boundaries.
- Support BYO transcription and MCP access for Axl.
- On 2026-11-17, user selected ECS/Fargate containers after considering Vercel and direct EC2 hosting. PostgreSQL must be Amazon RDS. Requested an AWS setup handoff for another laptop; no provisioning was performed.

## Working proposals, not final decisions

- Updated after the MCP-first discussion: standalone Portal-styled content frontend with branded AXL, a dedicated library agent on the existing AI backend, and read-only content MCP. The backend review verifies agent/MCP infrastructure; delegated identity and application isolation require additions. This supersedes native Portal feature work as the recommended first slice; that remains optional. See [backend review](AXL-BACKEND-REVIEW.md).

- Build the reader library inside Portal's current React/Vite shell with shared styling and semantic AXL views; keep Payload as the separate editorial/content service. Use one authorized retrieval service for AXL and reader MCP, with stable versioned citations. See [Portal/AXL integration](PORTAL-AXL-INTEGRATION.md). Backend tool implementation and API-token delegation remain to validate.

- Payload as the primary CMS candidate; AWS deployment direction is selected, with concrete environment configuration still to establish.
- SQS-backed processing, AWS Transcribe, versioned AE taxonomy/context, and evidence-backed AI enrichment are detailed in `AWS-SETUP-HANDOFF.md`. Bedrock and RDS pgvector are proposed pending model/region approval, quality testing, and existing Axl integration review.
- Custom Auth0 integration rather than Payload enterprise SSO, subject to validation and a vendor quote.
- PostgreSQL-based retrieval initially if suitable; assess existing Axl retrieval before introducing another product.
- 365-day default review cycle with content-specific exceptions.

## Unresolved prerequisites

- User confirmed the copy into `data/dbr-backup` complete. Offline SQL/file inventory and a proposed past-year pilot are available; live-source reconciliation, isolated restore, backup timestamp, and original archive availability remain unresolved.
- Custom WordPress content types, page-builder/plugin data, audience/download enforcement, and offloaded files.
- Actual corpus size, media duration, duplicates, and ownership gaps.
- Vimeo workspace/account coverage, transcript access, plan entitlements, and API limits.
- Whether the client secret visible in an earlier screenshot has been rotated; do not assume it has. No secret value is recorded here.
- Existing AWS/identity/Axl infrastructure and approved deployment conventions.
- Internal/external reader split and per-firm access rules.
- Editorial stakeholders, final taxonomy, review/retention policy, and cutover ownership.
- Proposed source-grounded taxonomy/access model is in `TAXONOMY-AND-ACCESS-MODEL.md`. Identity/membership authority, business-line gates, Full Active/tier inheritance, firm delegation, access-profile owners, and Axl restrictions require business confirmation. AI tags must never act as access grants.
- Production availability/recovery requirements and permitted dev data access.

## Evidence boundaries

A successful authorized Vimeo download proves access to that video only. An admin role supports expected broad access but does not prove cross-workspace or externally owned content access. A backup being readable does not prove a viable restore. A CMS's MCP support does not prove permission-aware full-content retrieval.
