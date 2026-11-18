# AWS setup handoff: AE Content Platform

Prepared 2026-11-17 for the laptop with AWS CLI tooling. This is an implementation brief, not an executed deployment or a tested infrastructure template.

Local implementation update: the [transactional import adapter runbook](PAYLOAD-IMPORT-ADAPTER.md) describes the next operations image, versioned migrations, private package transfer boundary and preview/apply acceptance. These edits need a subsequent build after the current upload. No deployment or RDS import has been verified here.

## 1. Direction and scope

Latest scope: prioritize the [core platform and general MCP](CORE-PLATFORM-AND-MCP.md); AXL integration is deferred. Include authenticated HTTPS Streamable HTTP MCP ingress, OAuth resource discovery, Auth0 API/client configuration, stable reader links, and per-user policy enforcement. Independent clients must not require Portal cookies or the AXL backend. Verify cloud-client network reachability and the specific Copilot product/channel. Keep AWS foundation choices below unchanged.

The user selected **ECS/Fargate containers** after discussing direct EC2 hosting. **PostgreSQL must be Amazon RDS**. Do not deploy PostgreSQL in a container, on EC2, or through another database host. Vercel is not the selected deployment path.

Use Payload for the CMS, private S3 for durable files, separate background workers for extraction/AI, AWS Transcribe for speech, and Vimeo for existing video playback. Containers are replaceable application processes; authoritative content lives in RDS and S3. Fargate manages the underlying hosts; we still own application/base-image updates, permissions, recovery, and monitoring.

First deliver a small, secure dev/POC environment. Production is a separate environment and release, with additional availability and recovery requirements. Do not treat one dev task and a Single-AZ database as production resilience.

This request authorizes preparing these instructions. On the destination laptop, inspect existing AWS resources and prepare a concrete infrastructure change set and current cost estimate. Apply it when the user authorizes dev provisioning, using any authorization already given in that session. Do not infer permission for production cutover, changing shared infrastructure, or bulk AI processing from this handoff alone. Do not repeatedly ask for approval for authorized local implementation or read-only discovery.

## 2. Bring the project and preserve its evidence

Read `AGENTS.md`, `README.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/MIGRATION.md`, and `docs/GOVERNANCE.md` before implementation. Paths are relative to the transferred workspace; do not assume the other laptop uses `D:/source`.

- Application update: `apps/platform` now contains a Payload/Next foundation, reader shell, protected MCP tools, generated initial migration and Dockerfile. See `APPLICATION-FOUNDATION.md` for validation and release gates; interactive sign-in, user provisioning, actual RDS migration and image verification remain. Do not assume the other laptop has these uncommitted changes until they are explicitly transferred or checked in. Infrastructure state must still be reconciled separately. Transfer ignored credentials/backups securely.
- `data/dbr-backup` contains an extracted WordPress tree; the user confirmed copy completion. Offline inventory and a 200-record pilot are documented in `WORDPRESS-PILOT.md`. The SQL dump is 1,948,630,258 bytes. Live-source reconciliation and a successful restore remain unverified.
- Preserve the untouched source and reconcile manifests/hashes when transferring between laptops. Ask about the original archive/timestamp if not available in local evidence.
- `.env.local` contains a Vimeo token. Transfer through the user's secure local method; never paste credentials into chat, source control, build arguments, logs, or this document. One known-video test succeeded; full coverage is unverified.
- Keep `data/`, `.env.local`, local manifests, and private reports ignored. Add `.dockerignore` before any build to exclude `data/`, `.env*` except a safe example if needed, `.git/`, temporary files, and unrelated local content. Send only an allowlisted application directory to remote builds.
- WordPress's MySQL dump cannot be restored into the new PostgreSQL database. Inspect/restore it separately in an isolated MySQL-compatible environment with outbound mail, cron, webhooks, and production callbacks disabled before WordPress starts. Import through a transformation pipeline.

Source validation remains required before real migration. An empty dev platform can be prepared independently once provisioning is authorized.

## 3. Discover and record the environment

Selected naming: **AE Library**, with development origin `https://library-dev.advisorsexcel.com` and production origin `https://library.advisorsexcel.com`. Use the development origin for `PLATFORM_ORIGIN` and its `/mcp` URL as the planned Auth0 API audience/resource identifier. Production uses its own corresponding values. Reuse Portal's existing Auth0 tenant; create/configure separate library application/API registrations. Verify DNS ownership and existing records before changes; DNS/certificates and OAuth registrations have not been confirmed here. Reader, `/admin`, `/api/...` and `/mcp` share each environment's host. Final browser callback paths will follow the implemented login SDK; do not guess registrations from the hostname alone.

Use existing account conventions and resources where appropriate; never silently modify shared VPCs, IAM roles, DNS zones, or databases. Record unresolved inputs in the implementation plan:

- AWS profile, expected account ID, organization/environment, and approved region.
- Dev hostname, DNS ownership, permitted editor network access, and Auth0 dev tenant/application/API details.
- Existing VPC/subnets, routing, IAM boundaries, service control policies, encryption conventions, and logging.
- Resource owner, budget amount/notification recipients, backup retention, and permitted AI processing regions/providers.
- Source repository and CI provider, or an AWS CodeBuild path if the laptop has no Linux-container builder.

Read-only PowerShell starting commands (replace the profile/region values):

```powershell
aws --version
$AwsProfile = 'REPLACE_WITH_EXISTING_PROFILE'
$AwsRegion = 'REPLACE_WITH_APPROVED_REGION'
aws sts get-caller-identity --profile $AwsProfile --region $AwsRegion
aws ec2 describe-vpcs --profile $AwsProfile --region $AwsRegion --query 'Vpcs[].{Id:VpcId,Cidr:CidrBlock,Default:IsDefault}'
aws ecs list-clusters --profile $AwsProfile --region $AwsRegion
aws rds describe-db-instances --profile $AwsProfile --region $AwsRegion --query 'DBInstances[].{Id:DBInstanceIdentifier,Engine:Engine,Public:PubliclyAccessible}'
```

Use `aws sso login --profile ...` if the established profile uses SSO and needs login. Never create long-lived administrator keys just to bypass authentication. Keep subsequent output sanitized; do not dump secret values or raw private content. Explicitly verify the expected account before mutations.

## 4. Infrastructure as code and deployment order

Follow existing organizational IaC conventions. If none exist, use CloudFormation YAML with separate foundation, data, and application stacks under `infra/aws/`, parameterized for dev/prod. Use change sets before updates. Preserve data resources with retention policies and RDS snapshots on replacement/deletion where supported. Do not deploy a stack that expects a nonexistent container image.

Sequence: discovery -> costed design -> foundation/data/ECR -> application implementation and build -> database bootstrap/migration task -> ECS service -> smoke/access tests -> processing workers -> representative import. Treat migrations and initial administrator creation as explicit steps.

Tag resources with project, environment, owner, and managed-by values. Record resource identifiers in a sanitized deployment report under ignored `data/aws-validation/`; document nonsecret configuration and operational instructions in the repository.

## 5. Network, HTTPS, and access

Provision or select a VPC with DNS support and two availability zones. If creating one, select non-overlapping CIDRs after checking existing connectivity.

- Two public subnets: internet-facing ALB and NAT routing.
- Two private application subnets: Fargate tasks with public IP assignment disabled.
- Two isolated database subnets: RDS subnet group, no public database access.
- One NAT gateway is a possible dev cost tradeoff; record its single-AZ dependency and cross-AZ traffic. Production normally needs independent egress per active AZ or an approved equivalent.
- Add an S3 gateway endpoint to application route tables. NAT still provides HTTPS egress to Vimeo, Auth0, and other approved external APIs. Interface endpoints for ECR, Logs, Secrets Manager, and other services are optional after comparing their cost and routing requirements.

Security-group rules:

- ALB: inbound TCP 443 from approved client ranges for restricted dev, or approved public ingress with application authentication. Port 80, if enabled, only redirects to HTTPS.
- App: inbound TCP 3000 only from the ALB security group. No SSH or public task address.
- Worker/migration: no inbound listener needed.
- RDS: inbound TCP 5432 only from the relevant app, worker, and migration security groups. No broad VPC-wide or internet database rule.
- Explicit required outbound paths: app/worker to RDS, HTTPS endpoints/external APIs, and DNS. S3 endpoint policies must permit the designated resources.

Create an ACM certificate in the ALB region, complete DNS validation, and route the new dev hostname to the ALB. Do not alter existing production names. Use a current recommended TLS policy. Configure allowed application origins/cookies/proxy handling for the real HTTPS hostname.

Before exposing `/admin`, securely create the initial administrator via a one-time bootstrap task or a restricted setup path; no anonymous first-user registration on a public endpoint. Implement server-side authorization even while dev ingress is restricted.

## 6. RDS PostgreSQL — mandatory

Create a dedicated encrypted RDS PostgreSQL instance for dev, with the private subnet group and database security group. Select a currently supported engine version compatible with the pinned Payload adapter and required extensions. Recheck regional instance availability.

Suggested sizing to estimate and test: a 2-vCPU/4-GiB burstable instance and 50 GiB gp3 storage, with a defined autoscaling cap. These are initial allowances, not measured capacity requirements. Start Single-AZ for dev; plan Multi-AZ for production. Enable automated backups (proposed dev retention: 7 days), maintenance windows, deletion protection, storage/connection alarms, and restore testing.

- Use RDS-managed master credentials in Secrets Manager for controlled bootstrap administration. Do not run Payload as the master user.
- Create a dedicated application database and separate runtime and migration roles. Runtime privileges must support actual Payload operations; schema changes belong to migrations. Test the privilege split.
- Require TLS with proper RDS CA/hostname verification. Do not bypass certificate validation to fix connectivity.
- Limit connection pools per task and calculate total demand across app replicas, workers, migration tasks, and rolling deployments.
- For the pilot, consider PostgreSQL full-text search plus `pgvector` in a separate managed schema, subject to Axl requirements. Verify extension availability for the selected engine. Do not add a separate vector service by default.
- Restore into a new isolated database for recovery drills. An image rollback does not undo schema changes.

RDS manages database infrastructure; the team still owns schema migrations, access controls, backup policy, and evidence of recovery.

## 7. Private S3 and secrets

Use **one private content-platform bucket per environment**, named `aecp-<env>-<account-id>-<region>` (confirm availability before provisioning). Separate storage by object key prefix; use a different bucket for prod.

- `source/`: WordPress snapshots and migration inputs. Only the migration role can write; grant no delete permissions to that role and no access to the web or worker roles. No automatic expiration.
- `content/`: originals, previews, extracted text, captions, transcripts, and approved exports. Grant the web and worker roles only the object access they need. Do not expire originals by default.
- `processing/`: temporary staged media and intermediates. Allow the worker and any explicitly authorized processing service to access only the required keys. Set a prefix-filtered lifecycle rule to expire temporary objects and noncurrent versions after a documented retention period.

Enable bucket-wide Block Public Access, bucket-owner-enforced ownership, encryption, TLS-only access, and versioning. Use organizational KMS standards; scope key permissions if using customer-managed keys. Prefixes are not security boundaries by themselves: scope object actions to the required prefix ARNs and any `s3:ListBucket` grants to the allowed prefixes using `s3:prefix`. Configure CORS only for required origins/methods if direct uploads are used. Keep any CodeBuild artifacts separate from project content.

Use task roles for S3 access, not embedded AWS keys. Keep Payload file access checks enabled. Short-lived signed URLs must be issued only after authorization; they remain usable until expiry, so use short TTLs and an application proxy where immediate revocation is necessary. View-only users receive approved derivatives, not the original through a different URL.

Secrets: application DB credential, stable Payload secret, Auth0 server-side settings, and Vimeo token only for workers that need it. Use separate dev/prod values. Reference secrets by ARN in task definitions; never put values in templates, outputs, images, build contexts, or user data. ECS-injected secrets require task replacement to pick up changes. Plan credential rotation accordingly.

## 8. ECR, IAM, build, and ECS application

Create ECR repositories with immutable version tags, vulnerability scanning, and a lifecycle policy that retains active and rollback images. Pin deployed image digests; avoid mutable `latest` deployments.

Separate IAM roles:

- Deployment/CI: only required stack, ECR, ECS, and scoped `iam:PassRole` permissions; use federation/OIDC where available.
- ECS execution: image pulls, log delivery, and access to only secrets injected into its tasks.
- Web task: required content prefixes and application integrations; no source archive mutations or bulk processing privileges.
- Worker task: specific queue operations, processing/content prefixes, selected AI/Transcribe permissions, and its own secrets.
- Migration/bootstrap: database administrative scope needed for the one-time operation, separate from ordinary runtime.

Implement Payload using pinned compatible releases, a lockfile, and a supported Node LTS runtime. Verify the exact version combination against current Payload documentation. Build a Linux container with a nonroot runtime user, production dependencies, and explicit startup command; expose port 3000 and bind to `0.0.0.0`. Keep all persistent assets in S3, not container storage.

The other laptop's AWS CLI alone cannot build an image. Use an available Docker-compatible Linux builder or provision CodeBuild with the required container-build mode and narrowly scoped service role. Do not require the user to install Docker if CodeBuild is the selected build path. Upload only allowlisted source. Keep production secrets out of image layers; ensure the build does not fetch private production content or require production DB credentials.

Create an ECS cluster and Fargate web task definition. Initial sizing to test: 1 vCPU / 2 GiB RAM, one dev task, x86_64 Linux unless dependencies have been validated on ARM. Configure logs, secrets, resource limits, graceful shutdown, container health, and sufficient ephemeral scratch storage for measured needs. Do not use Fargate Spot for the sole web task.

Create an `ip` target group for Fargate and an HTTPS ALB listener. Implement a lightweight unauthenticated health endpoint that returns no sensitive details; separate liveness from readiness/dependency diagnosis. Configure startup grace, draining, and ECS rolling deployment circuit breaker with rollback. The first deployment has no previous successful revision to roll back to.

Deploy workflow:

1. Build/test/scan and publish an immutable image; record digest and source revision.
2. Run a one-off Fargate migration task inside private subnets, using the release image and migration credentials. Serialize migrations; require successful exit before service deployment.
3. Update the web service to that digest. Wait for health and perform smoke/access tests.
4. On failure, investigate sanitized logs and restore the prior compatible task definition. Use backward-compatible expand/contract schema changes; never assume ECS rollback reverses database mutations.

Use CloudWatch retention (proposed dev: 30 days) and alarms for unhealthy targets, errors, task restarts, memory/CPU, RDS storage/connections, and queue age/failures. Set budget alerts using current regional prices; include ALB, NAT, public IPv4, RDS, Fargate, storage, logs, transfer, and AI usage. Budget alerts are not a hard spending cap.

## 9. Automated ingestion and AE-specific indexing

This pipeline is application work to implement on the AWS foundation; enabling AWS services alone does not provide it.

### Intake and durable scheduling

An authenticated editor uploads a file or adds an approved Vimeo reference. Create a restricted intake record with source identity, source version/hash, owner, explicit audience/download/Axl permissions, and processing status. Validate actual file type/size, quarantine and scan uploads before parsing, and enforce upload authorization on the server. Do not process arbitrary user-supplied URLs without provider validation and SSRF defenses.

After upload completion is verified, commit the record and an outbox event in the same database transaction. A dispatcher sends the event to an encrypted SQS standard queue and marks delivery. A reconciliation job finds stuck uploads and undelivered events. An S3 event may assist reconciliation, but an object-created event by itself must not grant publication or establish an authorized content record.

Create a worker ECS service/task definition separate from the web service and an SQS dead-letter queue. Start small with bounded concurrency. Message bodies hold identifiers, not secrets, signed URLs, or document text. Make each stage idempotent using source ID + source version/hash + processing stage + processor version. Use database uniqueness/leases to handle duplicates and concurrent workers. SQS delivery is not exactly-once execution.

Persist job state/attempts, transient versus permanent failures, provider job IDs, and sanitized error messages in RDS. Renew message visibility for bounded active work; delete messages only after durable progress. Do not hold an SQS message open for hours awaiting transcription. Store the external job ID, release the message, and resume via completion event or scheduled polling. Use bounded retry/backoff, rate limits, a DLQ, and explicit operator retry controls.

### Extraction by content type

- PDF: preserve page boundaries; extract native text, using OCR for scans and selective visual analysis where needed.
- Word: preserve headings, paragraphs, tables, and source locations.
- PowerPoint: extract slide text, notes, tables, and relevant chart/image evidence with slide numbers.
- Audio/video uploads: inspect format and duration, stage supported media in private S3, and start AWS Transcribe batch jobs with an explicit private output bucket/prefix.
- Vimeo links: resolve a stable video ID and authorized metadata via the API; prefer usable authorized captions. Otherwise obtain an authorized processing file, download without forwarding the Vimeo bearer token to the CDN, validate it, and stage media/audio in S3 for Transcribe. Never send a Vimeo watch-page URL as a Transcribe media object. Keep Vimeo playback references and their permissions separate from processing copies.

Use AWS Transcribe custom vocabulary for approved AE acronyms, product/carrier names, and terminology where supported. Validate on representative recordings; vocabulary is a recognition aid, not a guarantee. Preserve timestamps, speaker/channel metadata when useful, transcript quality indicators, and caption/transcription provenance. Do not infer named speaker identity from a speaker label alone.

Speech extraction does not capture silent slides/charts. Add selected frame/slide extraction when the use case requires it, with timestamp evidence and separate validation. Treat parser/media tools as processing untrusted input; minimize privileges, bound resources, and keep libraries patched.

### AE context and AI enrichment

Create a versioned, editor-approved AE context pack: business areas, product/carrier names and aliases, acronyms, training subjects, approved content types, use cases, and examples of correct classification. Derive it from inventory and stakeholder input; do not invent AE policy. Permission rules and compliance approval are outside the descriptive taxonomy.

Use a replaceable AI provider interface. Amazon Bedrock is the proposed AWS-native option for analysis and embeddings; confirm permitted model/region, access, pricing, data handling, and quality before processing sensitive content. Do not automatically buy or enable an unrelated RAG platform. Textract is optional for OCR based on sample quality; Office parsing remains separate.

Require schema-validated output with: source-grounded summary; proposed taxonomy IDs/entities; AE relevance/use cases; key takeaways; candidate questions answered; references to source pages/slides/timestamps; ambiguity/unsupported-claim flags; model, prompt, and taxonomy versions. Distinguish what the source says from any proposed interpretation. Validate evidence references programmatically and sample semantic accuracy with humans. Model-reported confidence is not calibrated truth.

Treat source text as untrusted data, never instructions. The AI analysis step gets no authority to execute tools, change access, approve compliance, or delete originals. Keep immutable source, generated derivatives, and reviewed editorial overrides separate. Reprocessing must not silently overwrite reviewed edits.

### Review and retrieval

Processing state and publication state are separate. Proposed processing stages: queued -> extracting/transcribing -> analyzing -> ready-for-review, with retryable/blocked/failed states. Publication remains intake -> editorial review -> approved/published, with archive/expiry controls. AI proposes classifications; an authorized human decides sensitive audience grants, approval, and Axl eligibility.

Automatically index extracted content for authorized editorial preview if desired. Publish reader/Axl search entries only for eligible approved versions. Chunk by meaningful sections with page/slide/time provenance; create embeddings from source-grounded text, retain original passages, and add descriptive metadata. Proposed initial index: PostgreSQL full-text + pgvector in RDS, subject to existing Axl integration and permission-filtered retrieval tests. Store embedding model/dimensions/version so reindexing is deterministic.

Enforce reader/firm/audience authorization, published state, expiry, and Axl eligibility in retrieval queries before returning text. Recheck current authorization when resolving citations/downloads; never trust a stale index ACL alone. Make caches identity/permission-version aware. Permission revocation must deny access immediately at the authoritative read path even if asynchronous index cleanup is pending.

Content changes, replacement, permissions, publication, expiry, archive, and deletion all emit durable indexing/invalidation events. Guard against late jobs publishing an older version. Reconcile periodically. Deduplicate physical assets without merging article-specific access rights. Separate reader retrieval MCP tools from authenticated editorial write tools.

### Operational controls and cost

Track per-item processing stage, duration/pages, provider cost estimate, attempts, and failures. Show editors progress and actionable errors without exposing internals or secrets. Bound daily job count, media minutes, OCR pages, model tokens, and concurrent jobs; pause processing on configured spend/usage thresholds. Budget alerts alone cannot do this.

Configure Transcribe/IAM/S3 permissions, completion-event handling or polling, SQS redrive, optional OCR access, and chosen AI model permissions only as required for the first pilot. Use EventBridge Scheduler for dispatch/reconciliation/review jobs if selected; keep processing state in RDS. Do not add Step Functions, Redis, OpenSearch, or a separate KB without a demonstrated need.

## 10. Verification and acceptance

Infrastructure acceptance:

- Correct account/region; all resources reproducible from IaC; inventory and current cost estimate recorded.
- HTTPS works, admin bootstrap is closed, unauthorized users are denied, tasks and RDS have no public addresses/access, and S3 anonymous access fails.
- S3 role tests verify intended prefix access and deny web/worker listing, reading, and writing under `source/`. Confirm temporary-object and noncurrent-version expiration applies only to `processing/`.
- Application uses the nonmaster RDS credential over verified TLS. Secrets are absent from images, source, output, and logs.
- Upload an authorized sample, restart/replace the task, and verify content survives through RDS/S3.
- Migration failure prevents release; a bad application release is detected; rollback to a compatible revision works.
- Restore a database backup to an isolated instance and retrieve a versioned S3 sample. Record observed recovery time and data loss window.

Pipeline acceptance using approximately 200 representative items:

- Native PDF, scanned PDF, Word table, slides with notes/charts, audio, uploaded video, and Vimeo reference produce traceable results.
- Existing captions are reused where appropriate; the Transcribe path produces timestamped output; revoked Vimeo access produces a recoverable, visible exception.
- Duplicate events/reruns produce no duplicate content or unnecessary repeat transcription. Worker death, expired file URL, throttling, provider timeout, and DLQ replay recover predictably.
- Human edits survive reprocessing. Late completion cannot replace newer approved content. Every claimed insight has usable evidence or is explicitly flagged.
- Two audiences/firms pass positive and negative tests for original, preview, transcript, search snippet, citation, and Axl retrieval. A view-only reader cannot obtain the original through an alternate path.
- Permission revocation, expiry, archive, and replacement invalidate retrieval and caches as designed. Prompt-injection text cannot change policies or trigger actions.

Infrastructure healthy, application deployed, pipeline implemented, and migration validated are separate milestones. Report each honestly.

## 11. Production readiness and handback

After pilot acceptance, define production recovery objectives and operating ownership. Provision separate production data, secrets, and indexes, preferably in a separate account. Use at least two web tasks across AZs, RDS Multi-AZ, resilient egress, tested scaling/connection budgets, scheduled recovery drills, vulnerability/patch routines, and notifications. Evaluate WAF/CloudFront as delivery needs justify them. Multi-AZ availability does not replace backups.

Keep worker capacity independently scalable. Promote code and migrations plus an explicit approved content release; do not rename the dev database into production. Plan source delta/cutover, redirects, and rollback. Scope any teardown to resources created for this project, retain source/data/backups, and never auto-delete shared infrastructure.

Hand back: IaC and parameter examples; build/deployment/migration instructions; sanitized resource inventory; deployed image digest and versions; validation results; cost estimate; unresolved items; next action. Update `docs/STATUS.md`, architecture, and decisions. Never claim application/ingestion features work merely because their AWS resources exist.

## 12. Primary references

Checked 2026-11-17; recheck version-, region-, and pricing-sensitive details during implementation.

- [Payload deployment](https://payloadcms.com/docs/production/deployment)
- [Payload PostgreSQL](https://payloadcms.com/docs/database/postgres)
- [Payload migrations](https://payloadcms.com/docs/database/migrations)
- [Payload storage adapters and access controls](https://payloadcms.com/docs/upload/storage-adapters)
- [ECS outbound networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html)
- [ECS task execution role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [ECS deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)
- [RDS-managed secrets](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)
- [RDS PostgreSQL extension versions](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html)
- [S3 event types and duplicate delivery](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)
- [SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Transcribe media input and output](https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html)
- [Transcribe batch setup](https://docs.aws.amazon.com/transcribe/latest/dg/getting-started.html)
- [Bedrock structured output](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html)
