# Application foundation and traceable implementation decisions

Implemented locally beginning 2026-11-17. Application: `apps/platform`. This document supplements the [active delivery plan](CORE-PLATFORM-AND-MCP.md), which remains the wider scope. No AWS deployment or live Auth0 client certification is implied.

## Decision record

| ID | Decision and rationale | Consequence / revisit trigger |
| --- | --- | --- |
| ADR-001 | Use a single Next.js/Payload application for the initial CMS, branded reader, and MCP transport. One shared authorization/retrieval layer prevents divergent policies. | Separate workers remain a later process; no dependency on Portal or AXL deployments. |
| ADR-002 | Pin Payload 3.94.0, Next 16.4.6, React 19.3.1, MCP SDK 1.32.2 and Node 24.22.3; commit the npm lockfile. Node was raised because Payload's engine range excludes the laptop's Node 22.17.1. | The project-local development Node package permits testing without changing the user's global runtime. Container runtime is pinned separately. Audit before deployment. |
| ADR-003 | RDS PostgreSQL adapter with certificate verification and `push: false`; generate a versioned initial migration instead of runtime schema push. | Generated SQL is reviewable but not yet executed against RDS. Do not use this migration against a shared/unknown schema. |
| ADR-004 | Server-maintained principal records keyed by issuer + subject; explicit active status and scoped membership clauses. No auto-provisioning on login. | Initial membership provisioning and the authoritative membership synchronization mechanism remain to implement. Unknown users cannot gain access. |
| ADR-005 | Auth0 RS256 bearer access tokens, audience/issuer/expiry validation; disable Payload local-password authentication. Browser sign-in uses the authorization-code flow with PKCE and an encrypted `__Host-` session cookie, implemented with `jose` instead of adding the Auth0 SDK. | No open first-admin signup or password fallback. Bearer tokens take precedence over cookies; cookies are ignored for cross-site requests. Users are provisioned by a trusted operator task, never on first sign-in. |
| ADR-006 | Separate view, retrieve, download grants. Conditions in a clause must match one scope membership; complete clauses are OR. Admin/editor privileges do not implicitly grant reader MCP access. | Tests cover crossed-firm entitlements and action separation. Fine-grained editorial scopes are a later extension; initial trusted editors are global. |
| ADR-007 | Restrict access profiles, membership changes, publication, evidence and source identifiers to admins. Editors can maintain draft content, accepted taxonomy, and suggestion decisions. Editing published evidence withdraws it to draft. | Approval is an initial admin gate, not yet the full compliance workflow. Accepting a suggestion does not automatically mutate accepted tags. |
| ADR-008 | Shared read service enforces current publication/access dates in database queries; raw reader responses are allowlisted. Asset metadata has no public binary delivery endpoint. | No original downloads/previews or signed S3 links until separate delivery authorization is implemented. |
| ADR-009 | Stateless Streamable HTTP MCP with three read tools, bounded payloads, token scopes and fresh principal lookup; no shared user credential cache. | OAuth registration/consent/refresh must be tested in actual clients. Discovery metadata alone is not a complete OAuth integration. |
| ADR-010 | Plain text bodies and versioned passage records in the first slice; keyword matching initially. | Superseded for search by ADR-038/039 (hybrid keyword + pgvector, see [AI-PIPELINE.md](AI-PIPELINE.md)). OCR remains unimplemented. |
| ADR-011 | Portal-aligned semantic colors, responsive library and detail templates, accessible forms and focus styles. No invented content, statistics or sign-in success. | Initial typography is a system fallback if Geist is not installed. Exact branding/assets, font packaging, PDF/Vimeo viewers and visual review remain. |
| ADR-012 | Build and test only against synthetic evidence; do not load the private backup into a new app without policy mapping. | Generated fixtures are clearly synthetic; source backup is untouched. |

## Requirements ledger

Follow-on ingestion work: [WordPress import package](WORDPRESS-IMPORT-PACKAGE.md) records ADR-013–016 and REQ-IMPORT-01–04. The [transactional Payload adapter](PAYLOAD-IMPORT-ADAPTER.md) adds ADR-017–020, immutable private staging, preview/apply and retry tests. Isolated RDS acceptance and processing workers remain pending.

These IDs are implementation traceability anchors, not a claim that the full business requirements have been approved.

| Requirement | Current evidence | Status |
| --- | --- | --- |
| REQ-CMS-01: manual authoring separated from policy/publication | Collections and `tests/collections.test.ts` | Implemented rules; real admin UI workflow awaits browser sign-in and database |
| REQ-AUTH-01: fail-closed scoped permissions | `src/domain/access.ts`, `tests/access.test.ts` | Unit-tested; actual RDS/API isolation still required |
| REQ-AUTH-02: validated API identity | `src/auth/verify.ts`, `tests/auth.test.ts` | JWT cryptography tested with local keys; Auth0 tenant untested |
| REQ-MCP-01: generic read tools and transport | `src/mcp/server.ts`, `src/app/mcp/route.ts`, `tests/mcp.test.ts` | SDK client + stateless HTTP tests; real client/OAuth matrix pending |
| REQ-CITE-01: stable links and version checks | Library service, detail route, superseded-citation test | Basic implementation; typed extraction locators pending |
| REQ-UI-01: branded library/detail/search states | Reader route group and semantic CSS | Implemented shell; no browser/visual acceptance yet |
| REQ-INGEST-01: idempotent ingestion and retries | Unique source/job keys, transactional package importer and completion receipts | Synthetic rollback/retry and preservation tests pass; real RDS and processing workers pending |
| REQ-AI-01: suggested tags separate from manual decisions | Suggestions collection | Schema only; model pipeline not implemented |
| REQ-SEARCH-01: lexical/vector retrieval | Permission-filtered keyword query | Keyword foundation only; full-text ranking/embeddings pending |
| REQ-ASSET-01: protected previews/downloads | Private asset metadata collection | Delivery deliberately unavailable until implemented |
| REQ-CARRIER-01: carrier pages | `carriers` collection, `/carriers`, `/carriers/[slug]`, `src/domain/carriers.ts`, `tests/library-pages.test.ts` | Implemented; groups derive from type, audience and topics |
| REQ-GOV-03: snooze, default windows, approval routing, Manage screens | `src/domain/review.ts`, `/admin`, `/admin/add-content`, `/admin/library`, `/admin/review-policies`, `/library-api/review-bulk` | Implemented; routing is shown, publishing stays an administrator action |
| REQ-HOME-01: Home, news, saved items, most used | `/`, `/news`, `/saved`, `content_views`, `saved` | Implemented; view counts are per person per day, shown only as counts |
| REQ-AWS-01: deployable app and versioned schema | Linux/amd64 runtime and operations images, versioned migrations, `infra/aws/library` tasks | Migrated and smoke-tested on dev RDS (`aecp_library`); serving via HTTPS ALB in dev |
| REQ-NAV-01/02: section menu and Ctrl K search | `src/domain/navigation.ts`, `suggest.ts`, `/library-api/suggest`, `tests/navigation.test.ts` | Implemented; live results use the authorized ranked search |
| REQ-NAV-03: section, topic, familiar-page and how-to listings | `section`/`topics`/`pages`/`kind` fields, `/sections/[id]`, `permission-matrix.test.ts` | Implemented; filters never widen authorization. Content still needs filing (migration wave) |
| REQ-GOV-01/02: review windows hide lapsed items until renewed | `src/domain/review.ts`, `publishedWhere`, `/admin/due-for-review`, renew route, `tests/manage-review.test.ts` | Implemented; renewal is owner/admin only. Email reminders (30/14/3 days) pending |
| REQ-VIEW-01: inline viewers | `src/domain/viewers.ts`, `components/viewers`, `/files/[id]` | PDF.js, image, audio, video, Vimeo with cited page/time. Inline originals still need download permission (ADR-026); Office/sheets need Gotenberg previews |
| REQ-HOWTO-01: how-to articles | `src/domain/markdown.ts`, `components/Article.tsx`, `tests/viewers.test.ts` | Safe Markdown subset with anchors, copy link, On this page, More in section. Screenshot upload from the editor pending |

## Run and configure

From `apps/platform`, use Node 24.22.3 and `npm ci`. `npm run typecheck`, `npm test`, and `npm run build` verify the foundation. `npm run dev` binds to loopback. Existing Node 22 can install the project-local Node dependency but emits engine warnings; npm scripts use that local binary. Prefer the documented Node version on CI and the AWS laptop.

The reader shell and `/health` can run without data configuration. The health route is liveness only, not proof of database readiness. Protected operations fail closed when configuration is missing. The shell reports that reader sign-in is not yet connected; it never substitutes a demo identity.

Copy the app's `.env.example` to a private `.env.local` or inject settings through the deployment environment. Do not reuse the repository root's Vimeo diagnostic file. Configure `DATABASE_URI`, `DATABASE_CA_FILE` when required by the approved RDS CA chain, `PAYLOAD_SECRET`, `PLATFORM_ORIGIN`, `AUTH0_ISSUER`, and `AUTH0_AUDIENCE`. Use Secrets Manager for secrets. The canonical MCP resource must match the configured API audience. No secrets belong in image build arguments.

`npm run generate:types` updates Payload types. `npm run migrate:create -- NAME` generates a reviewed schema migration without connecting to a database; `npm run migrate` executes migrations and must only target the verified environment. The foundation and import adapter migrations were rehearsed together on a fresh PostgreSQL 16.15 database using the Dockerfile's `operations` target with the command overridden to `npm run migrate`. Do not apply this foundation over the initial dev CMS schema. Initial users require a trusted provisioning step; no bootstrap endpoint is exposed. The AWS migration task and membership provisioning tooling are not yet in place.

Docker build context must be `apps/platform`, not the repository root. `.dockerignore` excludes secrets and build output; the repository root also excludes the backup if accidentally selected. The runtime image runs as non-root and expects secrets/configuration at runtime. Build and smoke tests passed locally for Linux/amd64; see [status](STATUS.md) for what was verified.

## Validation and limitations

The next local slice is documented in [processing and review](PROCESSING-AND-REVIEW.md), ADR-021–027. REQ-INGEST-02 covers leased/retryable PostgreSQL jobs and provider polling; REQ-AI-01 covers schema-validated evidence/taxonomy proposals; REQ-REVIEW-01 covers stale-safe human decisions and immutable provenance; REQ-ASSET-02 covers current-policy/source-version PDF and download delivery. Tests in `processing.test.ts`, `job-store.test.ts`, extraction/provider tests and `permission-matrix.test.ts` use synthetic inputs and mocked cloud/database boundaries. Real RDS concurrency, provider IAM/paid calls and authenticated visual acceptance remain live gates.

Build/config acceptance is in [LOCAL-ACCEPTANCE.md](LOCAL-ACCEPTANCE.md). Dependency remediation and the remaining upstream picomatch blocker are in [DEPENDENCY-REVIEW.md](DEPENDENCY-REVIEW.md); historical audit totals below describe the original foundation only.

Pre-deployment browser corrections (2026-11-18): the Payload route-group layout explicitly imports `@payloadcms/next/css`; keep it when regenerating/customizing the layout. Resource sign-in preserves citation parameters. Cookie authentication rejects foreign Origin headers (including same-site siblings), while sign-out requires matching Origin or explicit same-origin Fetch Metadata. Return destinations reject control characters. Existing auth regression cases cover these origin/redirect boundaries; production CSS presence is verified from build output. Live browser acceptance follows deployment.

Type checking, automated tests, migration generation and production-build results are recorded in `STATUS.md`. Tests use no live Auth0, AWS, Vimeo, database, or private content. MCP protocol tests exercise an independent SDK client and Web-standard HTTP transport; they do not certify Claude, ChatGPT or Copilot OAuth flows.

Initial dependency audit reported 22 affected packages including DOMPurify. Pinned a patched DOMPurify 3.4.18 override, removing the critical/low findings. Remaining audit findings include transitive picomatch (high) and legacy esbuild (moderate) through Payload tooling. Do not declare production-ready until the remaining advisories are resolved or reviewed for the actual runtime paths. `npm audit fix` itself failed with an npm dependency-graph error; no forced major-version upgrades were applied. The lockfile and final audit totals are the reproducible evidence.

Next: validate the RDS migration in the isolated dev environment; implement secure identity provisioning plus interactive Auth0 sessions for reader/admin; test real two-user API/MCP isolation; then wire S3 delivery and the approved sample ingestion. Keep each decision, acceptance result and deviation in this ledger/status as implementation proceeds.
