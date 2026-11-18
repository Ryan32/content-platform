# AE Content Platform

User-facing product: **AE Library**. Selected hostnames: `library.advisorsexcel.com` (production) and `library-dev.advisorsexcel.com` (development). DNS/deployment is not yet verified here. The technical project name remains AE Content Platform.

Replacement for the existing WordPress CMS: one governed content library for readers, creative-team editors, and authorized retrieval through general MCP clients.

## Start here

Read [AGENTS.md](AGENTS.md), then [current status and handoff](docs/STATUS.md). The active priority is the **core AWS content platform and client-independent, Auth0-authorized MCP**, following the [delivery plan](docs/CORE-PLATFORM-AND-MCP.md). Backup inventory/pilot evidence is available; source-policy validation remains required before publishing imported content. AXL integration is documented and deferred.

## Project documents

- [Active core-platform and general MCP delivery plan](docs/CORE-PLATFORM-AND-MCP.md)

- [Requirements and scope](docs/PROJECT-BRIEF.md)
- [Proposed architecture and environments](docs/ARCHITECTURE.md)
- [Portal reader UI and AXL integration contract](docs/PORTAL-AXL-INTEGRATION.md)
- [AXL backend review and simplified MCP-first approach](docs/AXL-BACKEND-REVIEW.md)
- [AWS setup handoff for the other laptop](docs/AWS-SETUP-HANDOFF.md) — ECS/Fargate, mandatory RDS PostgreSQL, and automated ingestion plan.
- [Source validation and migration runbook](docs/MIGRATION.md)
- [Taxonomy, permissions, and governance](docs/GOVERNANCE.md)
- [Proposed AE taxonomy and access model](docs/TAXONOMY-AND-ACCESS-MODEL.md)
- [WordPress inventory and AI retrieval pilot](docs/WORDPRESS-PILOT.md)
- [Restricted WordPress import package and dry-run mappings](docs/WORDPRESS-IMPORT-PACKAGE.md)
- [Transactional Payload importer and development handoff](docs/PAYLOAD-IMPORT-ADAPTER.md)
- [Decisions and unresolved questions](docs/DECISIONS.md)
- [Research findings and cost qualifications](docs/RESEARCH.md)
- [Current status and next engagement](docs/STATUS.md)
- [Research cost model](docs/research/cost-estimates.csv)
- [Cost assumptions](docs/research/model-assumptions.csv)
- [Primary-source register](docs/research/source-register.csv)

## Existing local tooling

The application foundation now lives in [apps/platform](apps/platform). See [implementation decisions, requirements ledger, and run instructions](docs/APPLICATION-FOUNDATION.md). It includes Payload collections, reader templates, shared authorization, and a tested synthetic MCP slice. Interactive sign-in, live infrastructure integration, ingestion workers, and client OAuth acceptance remain incomplete.

`scripts/test_vimeo_download.py` reads `.env.local`, calls Vimeo read-only APIs, and downloads the smallest authorized MP4 rendition for the configured video. It writes a sanitized report under `data/vimeo-validation/`. It does not change Vimeo privacy or download settings.

```powershell
python scripts/test_vimeo_download.py
```

The script intentionally refuses to overwrite a completed test file. A partial `.part` file may be overwritten on retry. It validates HTTP Content-Length and an MP4 signature; it does not fully decode the video. This is a diagnostic script, not the production importer.

## Local configuration

Offline inventory tooling and the private 200-record pilot are documented in [the pilot runbook](docs/WORDPRESS-PILOT.md). Generated databases, manifests, text probes, and Vimeo validation reports stay under ignored `data/`; they are not included in a clone.

`.env.local` already exists and contains the user's Vimeo token. Never print it or overwrite it. `.env.example` documents variable names without secrets. Local credentials, downloads, and raw backups are excluded by `.gitignore`.

The application foundation is local; no AWS database or production deployment has been verified from this workspace. Project source is versioned at https://github.com/Ryan32/content-platform. Backups and credentials must be transferred separately through secure local methods; they are not included in a clone.
