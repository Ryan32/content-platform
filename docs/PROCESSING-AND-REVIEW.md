# Processing, review and protected reading

Local implementation — 2026-11-18. This extends the restricted importer; it does not certify live AWS jobs, paid model calls, successful tenant permissions, or production readiness. No private material was sent to an AI model during implementation.

## Decisions

- **ADR-021 — durable PostgreSQL work queue for the bounded pilot.** Reuse `processing-jobs` in mandatory RDS PostgreSQL. Atomic `FOR UPDATE SKIP LOCKED` claims, lease tokens, five-minute leases, heartbeat, capped retries and a 24-hour deadline support restart/recovery. A one-shot operations command processes one ready job. Schedule repeated invocations externally. SQS/outbox scale-out remains the later architecture; the current CLI does not pretend an in-memory queue or S3 event is reliable delivery.
- **ADR-022 — bounded, isolated extraction.** Run PDF/Office/caption parsing in operations workers, not web requests. Originals are immutable hashed S3 objects. Input size is bounded at 50 MiB for this pilot; unsupported/large/scanned/encrypted inputs must remain visible failures or warnings rather than invented successful text. Office extraction does not execute macros or resolve external relationships. This is text extraction, not a faithful layout renderer/OCR system.
- **ADR-023 — provider jobs are resumable.** Prefer authorized Vimeo captions. Without usable captions, resolve an authorized MP4 download, send the bearer only to `api.vimeo.com`, validate HTTPS CDN redirects, verify MP4 signature, and stage temporary media privately. Transcribe receives an S3 object, never a Vimeo watch URL. Deterministic Transcribe job identity allows polling/recovery after uncertain submission. Polls release the database lease instead of holding a task open for hours.
- **ADR-024 — AI proposes, editors decide.** Bedrock Converse receives bounded source evidence plus a captured approved taxonomy. Output is validated against allowed term/evidence IDs; extra policy/approval fields are rejected. Store raw proposal, extraction, model, processor and taxonomy versions separately from content. No tool execution from source text. Live AI/Transcribe calls require `ALLOW_PAID_PROCESSING=true` and an explicitly configured model.
- **ADR-025 — explicit audited review.** `/review` requires a provisioned editor/admin. The review shows current values, proposed values, evidence and warnings. Acceptance may revise summary/tags and installs extracted evidence into a draft; it never grants access or publishes. Source version and the content update timestamp must still match. Accepted/rejected decisions record reviewer/time/note; ordinary API mutation of jobs/proposals is denied. A rerun cannot reset a reviewed proposal.
- **ADR-026 — protected file delivery.** `/files/[id]` checks current user, policy, publication dates, asset/source version and prefix before S3 access. Both inline PDF and original download require view plus download because the current PDF viewer serves original bytes. View-only readers receive extracted text; a separately generated preview derivative is deferred. Responses are private/no-store, support bounded range syntax, and never expose S3 keys or signed URLs. PDF preview exposes bytes to an authorized viewer; separate download permission controls original-delivery functionality, not DRM. Vimeo continues enforcing its own playback/embed restrictions.
- **ADR-027 — release gates.** Production builds validate admin CSS, standalone routes and migration registration. Runtime configuration checks inspect injected environment values without printing them. Dependency review remains explicit when upstream has no patched release.

Cross-model review corrections: MCP bearer tokens are accepted only by the read-only MCP path, never as Payload/admin browser sessions. Original PDF inline delivery requires download permission until a distinct derivative exists. Only the trusted review workflow may replace evidence on existing records; manual text edits clear passages and invalidate evidence. Import returns durable completion mappings even if a concurrent attempt committed. Review completion verifies an unpredictable attempt ID, binds the captured Vimeo ID, and rejects changed taxonomy meaning. Conditional Vimeo staging conflicts re-read/hash-verify the winner's bytes instead of permanently failing an otherwise recoverable job.

Final review corrections: the content hook branches on Payload's `operation`, since normal creates supply an empty original document. New records always start with unprocessed/empty evidence; create-time publication is reduced to draft. Content duplication is disabled in the server collection configuration and defensively rejected when a create supplies a source record. Source-key/hash edits invalidate evidence and withdraw published content. These corrections have synthetic regression coverage; an actual RDS create/import remains a live gate. Authorized Vimeo media links may start at exact `player.vimeo.com` before redirecting to approved CDN hosts; every hop is HTTPS-checked and receives no bearer.

## Operational sequence (development only)

Apply migrations `20261118_091607_processing_review` and `20261118_092849_review_receipt` before replacing the web image. The new startup/smoke scripts require that migration. Migration adds proposal job identity/reviewer audit fields and queue input/output/lease/schedule fields. Existing legacy job rows with no processor version are not claimed; enqueue explicit current-version work instead.

Use the Dockerfile `operations` target with Node 24.22.3. Provide TLS-verified `DATABASE_URI`/`DATABASE_CA_FILE`, `PROCESSING_ENVIRONMENT=development`, `CONTENT_BUCKET`, and AWS task credentials. Optional provider configuration is `VIMEO_ACCESS_TOKEN`, `BEDROCK_MODEL_ID`, and `ALLOW_PAID_PROCESSING`; keep Vimeo/model credentials off the web task. The CLI's explicit target argument is `hostname[:port]/database`, matching the injected URI. Never put credentials in CLI arguments.

From `apps/platform`, examples below use placeholders, not real resource IDs:

```text
npm run processing -- stage <dev-target> <content-id> /private/pilot.pdf
npm run processing -- enqueue <dev-target> <content-id> /private/job-input.json
npm run processing -- work <dev-target>
npm run processing -- retry <dev-target> <failed-job-id>
```

`stage` requires intake/draft content, hashes and conditionally writes the original, re-reads/hash-verifies it, creates/reuses asset metadata, then enqueues extraction (or transcription for audio/video). It rechecks publication state inside asset registration and never changes source backups. If the process dies between S3, asset registration and enqueue, rerun the same command; deterministic keys and serialized asset registration recover it. An orphan S3 object may remain after a database failure; automatic deletion is deliberately absent. This is a restartable operator workflow, not yet an automatic upload/outbox service.

Example private job input for an already-registered document:

```json
{"kind":"document","assetId":123,"format":"pdf"}
```

Other extraction inputs: `{"kind":"vimeo"}` uses the content's numeric Vimeo ID, and `{"kind":"transcribe","assetId":123}` uses its current source-version asset. No arbitrary URL fields are accepted. Vimeo no-caption fallback is bounded to authorized MP4 files <=50 MiB; unsupported CDN hosts or larger media produce an actionable job failure rather than widening network access. Larger-library transcoding/streaming is separate work.

After extraction succeeds, enqueue analysis referencing that job and the intended controlled vocabulary:

```json
{"kind":"classify","extractionJobId":456,"modelId":"configured-approved-model","taxonomy":[{"id":1,"label":"placeholder","definition":"","dimension":"topic"}]}
```

The enqueue command replaces the supplied taxonomy text with the actual database terms, snapshots it in the job, and requires the model to match `BEDROCK_MODEL_ID`. Source-version mismatches fail. Output creates one immutable pending suggestion with the job completion transaction. Work does not update content or create accepted tags. The editor then opens `/review`; acceptance moves content to draft for separate approval.

Proposal envelopes record `analysisVersion=ae-analysis/1`, extraction processor version, model ID and taxonomy hash/snapshot. Bump the analysis/queue processor version when prompts or extraction semantics change; otherwise idempotency intentionally reuses the prior result. Changed Vimeo IDs participate in job identity and are rechecked through completion/review. Stale proposals can be rejected without changing the current record.

Warnings and provider failures are visible under **Processing Jobs**. Only fixed failure codes are logged. Provider polling reschedules after 60 seconds without using a failed attempt; transient errors use bounded exponential delay. Unknown failures stop for investigation. `retry` resets only a failed current-processor job; source-version checks still apply. Do not repeatedly retry permanent parser/permission failures without resolving the cause.

## IAM, delivery and live acceptance

Prepare, but do not apply without deployment authorization: worker DB access to queue/source asset metadata and proposals; S3 read/write on necessary `content/` and `processing/` keys; Transcribe start/get for task jobs; Bedrock invoke for the approved model; Vimeo secret for the worker. Web needs read-only access to deliverable `content/` objects and no `source/` or provider secrets. Transcribe input/output bucket/service permissions, encryption, networking and retention require live verification. Do not grant public S3 access.

Reader pages render authorized PDF/video previews and separate original-download links; MCP remains limited to approved textual evidence. Processing never automatically publishes. The review interface can replace the currently accepted extracted body; an editor must deliberately choose which asset's extraction is authoritative when a record has multiple assets. Combined multi-asset synthesis, batch review, automatic upload events, streaming large media, OCR, embeddings/vector ranking and production scheduling are not claimed by this bounded slice.

Live acceptance: migrated dev schema; stage/retry one PDF; captions and Transcribe paths for one approved Vimeo video; verify interrupted/pending provider recovery; analysis and manual revision/rejection; no duplicate suggestions; two users with different firm/LOB grants; denied PDF/download/MCP/citation access after policy/version/expiry changes; signed-in admin edit/save and logout. Keep actual outputs/logs in ignored `data/`, sanitized outcome summaries in `STATUS.md`.

Primary references checked: [Transcribe input/output contract](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html), [Transcribe polling](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_GetTranscriptionJob.html), [Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html), [PDF.js examples](https://github.com/mozilla/pdf.js/blob/master/docs/contents/examples/index.md).
