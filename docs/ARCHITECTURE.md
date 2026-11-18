# Proposed architecture and environments

Status: nothing below has been provisioned. On 2026-11-17, the user selected ECS/Fargate containers and required Amazon RDS PostgreSQL for the AWS setup handoff. Detailed sizing and processing design remain proposals. See [AWS setup handoff](AWS-SETUP-HANDOFF.md).

## Application boundary

Payload is the working CMS candidate because its TypeScript/React model aligns with Portal and its MIT core permits custom authentication and workflows. Its packaged enterprise SSO and publishing workflow products are commercial; custom implementations are engineering work, not free turnkey features. Enterprise pricing remains quote-only.

The existing Portal in `D:/source/portal-v2` uses React/TypeScript and Auth0. A separate Payload service can supply APIs to that frontend; adopting Payload does not imply rewriting Portal in Next.js.

## Processing flow

1. Source adapter or editor creates an intake record.
2. Original files and source snapshots enter private object storage.
3. A durable queue schedules document extraction, preview generation, or media transcription.
4. Workers save versioned text, page/timestamp mappings, captions, summaries, and proposed tags.
5. Editors resolve classification, ownership, and access decisions.
6. Published eligible content enters a permission-filtered retrieval index.
7. Portal renders content and Axl retrieves approved evidence through MCP.

Keep Vimeo IDs and embed metadata as the stable playback reference. Obtain authorized file URLs only when processing; do not store expiring URLs as canonical identifiers. Prefer existing accurate captions before paying to retranscribe. Speech alone does not describe silent charts or demonstrations; evaluate selective visual extraction.

## AWS deployment proposal

- Containerized Payload application and separate workers on ECS/Fargate (user-selected deployment direction).
- Amazon RDS PostgreSQL (user requirement); evaluate PostgreSQL full-text/vector retrieval during pilot.
- Private S3 for raw imports, originals, previews, transcripts, and exports.
- SQS or equivalent durable jobs with retry/dead-letter handling.
- AWS Transcribe for BYO transcription; parser/OCR providers selected by document tests.
- Secrets Manager, least-privilege IAM roles, logging, monitoring, and budget alerts.
- Authorized preview/download delivery, potentially CloudFront signed access.
- Auth0 applications/API configurations for dev and production.

Do not add a dedicated vector service or RAGFlow merely because it appeared in research. Assess Axl's existing retrieval implementation first. A CMS MCP CRUD interface is not by itself deep document search.

## Environment separation

Use infrastructure as code, separate databases/buckets/indexes/secrets, and preferably separate AWS accounts for dev and prod. Dev starts small but has real access controls because imported content is sensitive. Route dev notifications to a test destination. Production adds appropriate redundancy, recovery objectives, monitoring, and tested restores.

Create the dev environment first when authorized. Define production configuration concurrently; avoid paying for full production capacity before the pilot warrants it.

## Promotion model

Promote application builds and schema migrations, not ad hoc database edits. During migration, dev holds the editorial workbench. Export an explicit approved content release, assets, and derivatives into clean production, then build its index. Do not rename the dev database into production.

After cutover, production is the editorial source of truth. Dev remains for software/workflow testing with controlled data refreshes. Define a content freeze or final delta window and rollback procedure before cutover.
