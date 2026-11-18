# Restricted Payload import adapter

Implemented locally on 2026-11-17. Ready for an isolated development RDS acceptance test; **not yet tested against RDS**. These changes require a new image build after the image currently uploading. Auth0 and AXL integration remain deferred.

## Behavior and architecture

The trusted operations CLI validates the private package before connecting to a database: exact completion-marker file enumeration and checksums, package/snapshot/relationship hashes, identities, restricted proposals, reference targets and allowed statuses. It validates transport metadata, not the current source binaries; the Python builder handles source-file verification.

A bounded package is one serializable transaction containing content, immutable snapshots, artifacts, relationships, lifecycle review flags and a completion receipt. Preview/apply allow at most 25 records and 5,000 edges; split larger imports into deterministic packages. Every Payload operation receives the same transaction request. Disabled transactions fail closed. A fresh receipt query must confirm completion after commit, also guarding against suppressed commit errors in the pinned adapter.

- New source: create intake with no access profile, accepted tags or passages and unprocessed evidence.
- Known snapshot/completed package: skip without duplicate writes.
- Changed source: append a staged snapshot and proposed fields. Preserve existing editorial content, permissions, tags and publication state.
- Ineligible existing source: append a review flag. This does not itself withdraw published material; resolve the flag before release.
- Shared bytes: reuse immutable artifact metadata, retain separate content records and relationship occurrences. Artifacts grant no access and provide no downloads.
- Outside-package links: retain source key/status without inventing a target record.

Five collections implement this: `import-artifacts`, `source-snapshots`, `source-relations`, `import-reviews`, `import-runs`. Administrators can read; normal API create/update/delete and non-admin reads are denied. Only the trusted CLI uses explicit Local API access overrides. Do not expose this adapter through reader APIs or MCP. Source taxonomy remains unreviewed, separate from accepted taxonomy and access grants.

After an uncertain disconnect, rerun the unchanged package: a committed receipt reconciles success, otherwise the transaction retries. Serialization/uniqueness conflicts may require rerunning after the competing import ends. There is no partial per-record success mode or automatic retry loop.

## Development handoff

From `apps/platform`, offline validation requires no credentials/database:

```powershell
npm run import:package -- check ../../data/wordpress-import/pilot-v3
```

Expected ID: `62f1ecfa909f1777334b0149af0a79fa62db23197f82c354f9effe39e19e1119`, with 12 records and 350 relationships.

For an approved isolated dev target, inject `DATABASE_URI`, `PAYLOAD_SECRET`, `DATABASE_CA_FILE` for RDS TLS, and `IMPORT_ENVIRONMENT=development` using the secure operations environment. Credentials must not appear in arguments. The explicit target must match the URI's `hostname[:port]/database`, including port if specified. These guards prevent mistakes; environment-specific secrets/IAM/database permissions remain necessary.

Run from the updated source/operations image, replacing the angle-bracket placeholders:

```text
npm run migrate
npm run import:package -- preview /private/pilot-v3 <dev-rds-host:5432/database> 62f1ecfa909f1777334b0149af0a79fa62db23197f82c354f9effe39e19e1119
npm run import:package -- apply /private/pilot-v3 <dev-rds-host:5432/database> 62f1ecfa909f1777334b0149af0a79fa62db23197f82c354f9effe39e19e1119
```

Preview uses a read-only serializable transaction. Apply prints package ID, status and aggregate counts; private mappings stay in the administrator-only receipt. Errors use fixed codes instead of raw source/driver output.

The Dockerfile has an optional `operations` target containing source, migrations and CLI dependencies. Build from `apps/platform`: `docker build --target operations -t ae-library-operations:<version> .`. The final/default target remains the standalone web runtime. No Docker build/run was performed here. Supply the package through approved private read-only staging/mounting; transfer and ECS task wiring remain to configure. Never bake packages, backups or credentials into an image. Run migrations/import as one-off tasks, not on every web startup.

Apply existing migration `20261118_030155_foundation`, then `20261118_041309_import_adapter`. UTC filenames differ from local work date. Both were generated offline, not applied here. The new migration adds five tables, unique indexes, enums, foreign keys and Payload lock relationships. Its destructive down migration is only for disposable test environments.

## Evidence and acceptance gate

TypeScript, production build and 31 tests across six files passed. Fifteen new tests cover rollback/retry, missing commit receipts, unchanged reruns, changed-source/manual-edit preservation, shared artifacts, ineligible-source review, preview without writes, denied source APIs, transport tampering and transaction wiring. Test doubles are not evidence of actual PostgreSQL atomicity. The real private v3 package passed the new CLI validator unchanged.

On isolated dev RDS: migrate, preview/apply, reconcile 12 restricted content records, 12 snapshots, 350 relationships and one receipt; rerun without growth. Use synthetic changed-source/failure cases to prove staging/rollback. Verify intake and raw source are inaccessible to anonymous/unauthorized users across REST, MCP, detail/citation and admin routes. Store private acceptance evidence under ignored `data/`.

Pending: staged-change review/merge UI, source-ineligible resolution, principal provisioning/login, binary transfer, document extraction, Vimeo captions/transcription, AI suggestions, vector ranking and actual client OAuth acceptance. No cloud resources, paid processing, publication or database writes occurred here.

## Decisions and requirements

- **ADR-017:** bounded atomic packages with serializable transactions and verified completion receipts; retry exact packages after uncertain outcomes.
- **ADR-018:** immutable source evidence and proposals separate from editorial state; importer has no update/delete operations. Later merge decisions require explicit audited review.
- **ADR-019:** private metadata artifacts deduplicate bytes without merging permissions/content; binary delivery remains separate.
- **ADR-020:** trusted one-off operations CLI/image with explicit dev target/package guards, separate from reader APIs and normal startup.

REQ-IMPORT-01–04 continue from the package runbook. **REQ-IMPORT-05** covers atomic rollback/retry/completion reconciliation; **REQ-IMPORT-06** covers immutable private staging and explicit targeting. Implementation: `apps/platform/src/import/`, `src/collections/imports.ts`; tests: `tests/import.test.ts`, `tests/import-store.test.ts`.
