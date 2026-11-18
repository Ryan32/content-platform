# AE Content Platform

Replacement for the existing WordPress CMS: one governed content library for Portal readers, creative-team editors, and Axl retrieval.

## Start here

Read [AGENTS.md](AGENTS.md), then [current status and handoff](docs/STATUS.md). The immediate objective is **validate the WP Engine backup and inventory the source content**, followed by verifying Vimeo coverage. Do not jump ahead to cloud provisioning or a full migration.

## Project documents

- [Requirements and scope](docs/PROJECT-BRIEF.md)
- [Proposed architecture and environments](docs/ARCHITECTURE.md)
- [AWS setup handoff for the other laptop](docs/AWS-SETUP-HANDOFF.md) — ECS/Fargate, mandatory RDS PostgreSQL, and automated ingestion plan.
- [Source validation and migration runbook](docs/MIGRATION.md)
- [Taxonomy, permissions, and governance](docs/GOVERNANCE.md)
- [Decisions and unresolved questions](docs/DECISIONS.md)
- [Research findings and cost qualifications](docs/RESEARCH.md)
- [Current status and next engagement](docs/STATUS.md)
- [Research cost model](docs/research/cost-estimates.csv)
- [Cost assumptions](docs/research/model-assumptions.csv)
- [Primary-source register](docs/research/source-register.csv)

## Existing local tooling

`scripts/test_vimeo_download.py` reads `.env.local`, calls Vimeo read-only APIs, and downloads the smallest authorized MP4 rendition for the configured video. It writes a sanitized report under `data/vimeo-validation/`. It does not change Vimeo privacy or download settings.

```powershell
python scripts/test_vimeo_download.py
```

The script intentionally refuses to overwrite a completed test file. A partial `.part` file may be overwritten on retry. It validates HTTP Content-Length and an MP4 signature; it does not fully decode the video. This is a diagnostic script, not the production importer.

## Local configuration

`.env.local` already exists and contains the user's Vimeo token. Never print it or overwrite it. `.env.example` documents variable names without secrets. Local credentials, downloads, and raw backups are excluded by `.gitignore`.

No CMS application, infrastructure, database, or production deployment has been initialized. Project documentation and diagnostic tooling are versioned at https://github.com/Ryan32/content-platform. Backups and credentials must be transferred separately through secure local methods; they are not included in a clone.
