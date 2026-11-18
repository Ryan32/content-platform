# Decisions and open questions

## Confirmed direction

- Validate the WordPress backup and Vimeo access before cloud provisioning.
- New standalone workspace: `D:/source/ae-content-platform`.
- Keep one editorial source of truth, with background processing/search services as needed.
- Retain Vimeo playback initially; use authorized media access for processing.
- Use long-lived isolated dev and prod; dev begins as the POC/migration workbench.
- Separate view and download rights and preserve internal/external/firm boundaries.
- Support BYO transcription and MCP access for Axl.
- On 2026-11-17, user selected ECS/Fargate containers after considering Vercel and direct EC2 hosting. PostgreSQL must be Amazon RDS. Requested an AWS setup handoff for another laptop; no provisioning was performed.

## Working proposals, not final decisions

- Payload as the primary CMS candidate; AWS deployment direction is selected, with concrete environment configuration still to establish.
- SQS-backed processing, AWS Transcribe, versioned AE taxonomy/context, and evidence-backed AI enrichment are detailed in `AWS-SETUP-HANDOFF.md`. Bedrock and RDS pgvector are proposed pending model/region approval, quality testing, and existing Axl integration review.
- Custom Auth0 integration rather than Payload enterprise SSO, subject to validation and a vendor quote.
- PostgreSQL-based retrieval initially if suitable; assess existing Axl retrieval before introducing another product.
- 365-day default review cycle with content-specific exceptions.

## Unresolved prerequisites

- DBR WordPress backup is located at `data/dbr-backup`; the user reports an approximately 20 GB bulk folder is still copying. Final completeness/size, backup timestamp, original archive availability, and original site's architecture remain unresolved.
- Custom WordPress content types, page-builder/plugin data, audience/download enforcement, and offloaded files.
- Actual corpus size, media duration, duplicates, and ownership gaps.
- Vimeo workspace/account coverage, transcript access, plan entitlements, and API limits.
- Whether the client secret visible in an earlier screenshot has been rotated; do not assume it has. No secret value is recorded here.
- Existing AWS/identity/Axl infrastructure and approved deployment conventions.
- Internal/external reader split and per-firm access rules.
- Editorial stakeholders, final taxonomy, review/retention policy, and cutover ownership.
- Production availability/recovery requirements and permitted dev data access.

## Evidence boundaries

A successful authorized Vimeo download proves access to that video only. An admin role supports expected broad access but does not prove cross-workspace or externally owned content access. A backup being readable does not prove a viable restore. A CMS's MCP support does not prove permission-aware full-content retrieval.
