# Current status and next-engagement handoff

This document captures work completed in the originating Portal conversation. Vendor research was performed on 2026-11-17; recheck time-sensitive terms when needed.

## Active priority — core platform and general MCP

### AI processing for everything, field-by-field review, semantic search — 2026-11-18

- **Implemented and tested locally; not deployed.** Commits `a77c2a4`, `f5c189e`, `d98069f`, `12acb94`. Full description, ADR-035–040 and the deploy/live-check runbook: [AI-PIPELINE.md](AI-PIPELINE.md).
- Imports attach their verified files so they are extracted/transcribed like uploads; each item then gets **one combined Claude analysis** of all its sources plus its current record; **Review** shows current vs. suggested per field (keep team values, backfill empty fields, propose clean-up; AI may propose new tags for approval); accepted passages are embedded into **pgvector** and search/MCP rank by keyword + meaning without widening access. Vimeo videos without captions now transcribe up to 2 GB.
- Batches rebuilt with files: `data/wordpress-import/batches/pilot-200-files/` (same 8 package IDs; 320 files, 1.55 GB: 147 PDF, 14 docx, 11 pptx, 7 xlsx, 139 images and 2 `.doc` not processed). No local audio/video in the 200 pilot records.
- Validation: typecheck; 143 tests in 25 files; production build (8 indexed migrations). A temporary real-PostgreSQL 17 + pgvector check (PGlite, not committed) ran the scheduler, record loader, migration, indexer and semantic query, and caught two bugs now fixed (NULL Vimeo IDs blocked analysis; untyped insert parameters). Not tested: Bedrock/Transcribe/Vimeo calls, RDS, the review page in a browser, the decision route against Payload, AWS scripts.
- Next: AWS laptop follows the AI-PIPELINE runbook (new images → snapshot → bootstrap → migrate → worker/web → Vimeo token → import → live check of one PDF, Vimeo, article and upload).

### WordPress test migration: batch build + one-command run — 2026-11-18

- **Built and validated locally, not run on AWS.** `python scripts/build_wordpress_import.py batch --output data/wordpress-import/batches/<new-name>` splits every eligible pilot record into restricted-intake packages of up to 25 (the adapter ceiling) and writes `batches.json`. Real run: `data/wordpress-import/batches/pilot-200/` = 8 batches, 200 records, 214–371 relationships each; all 8 passed the app's `import:package check`. Transfer copy: `pilot-200.zip` (0.8 MB, ignored).
- AWS laptop: `.\infra\aws\library\import-batches.ps1 -BatchDir <folder> -OperationsDigest sha256:<new operations image> [-PreviewOnly] [-Only batch-001]`. It re-verifies checksums, creates/updates `aecp-dev-library-import-task` (S3 `GetObject` on `imports/*` only), uploads each package to `imports/<packageId>/`, and runs one ECS task (`import.js`, runtime DB role, web execution role) that does check → preview → apply → rerun per batch and stops at the first failure. Safe to rerun.
- Still not carried: original WordPress dates, featured-image covers, file bytes (attachments are metadata only). The v2 scan predates the `featured_image` field. Items arrive as Intake with no access profile. Python importer tests: 19 pass (batch mode added to an existing test).
- Next: run `-PreviewOnly -Only batch-001`, then apply all; reconcile 200 Intake items and confirm anonymous/unauthorized denial.

### Library pages from the design — 2026-11-18

- **Implemented, not deployed.** Builds every reader and Manage screen in `docs/design/mockups` except slides/spreadsheet previews (need Gotenberg) and AXL answers (P5). Screen-by-screen status: [`docs/design/IMPLEMENTATION.md`](design/IMPLEMENTATION.md).
- Reader: new Home (`/`, AXL hero, AE Today, Most used, Bulletins, New in the Library), `/search`, section pages with filter rail, kits, sort and list view, `/carriers` and `/carriers/[slug]`, `/kits/[id]`, `/saved`, `/news`; resource page with key takeaways, kits, related and details; how-to layout with callouts, steps, print, helpful/suggest-an-edit; PDF thumbnails and find; Vimeo transcript that follows playback; audio/video speed, skip and transcript.
- Manage: `/admin` home (replaces the Payload dashboard), `/admin/add-content` 4-step wizard, `/admin/library`, `/admin/due-for-review` with bulk renew/snooze/archive, `/admin/review-policies`. Accepting an AI suggestion now also installs its key takeaways.
- Migration `20261119_011841_library_pages` (additive: content filters, carriers, kits, saved, feedback, `content_views`). Rehearsed on local TLS PostgreSQL 16; rerun is a no-op. Deploy scripts expect it. The runtime image now copies `public/` (AXL artwork).
- Validation: typecheck, 125 tests (21 files), production build (7 indexed migrations). Local browser check with seeded synthetic data of Home, section, carrier, search, resource, how-to, Manage home, content list, add content steps 1–3, due for review and review policies.
- **Deploy (AWS laptop):** pull; build and push web and operations images; RDS snapshot; `run-task.ps1 -Step migrate` with the new digests; `web-service.ps1` and `worker-service.ps1` with the new digests; `run-task.ps1 -Step smoke`.

### Library app pieces (no content yet) — 2026-11-18

- **Implemented, not deployed.** Migration `20261118_234658_review_windows_and_sections` (additive; backfills already-published items to a 12-month window from their last update). Rehearsed on local TLS PostgreSQL 16: applies cleanly, rerun is a no-op.
- **Sections and topics on content:** new fields Type (Resource / How-to article), Section, Topics and Pages you know. `/sections/[id]` lists authorized items, with `?topic=` and `?page=` views and type tabs; the sidebar and Ctrl K link to them. How-to is a filter and badge, not a section.
- **Review windows:** each item has Review every (monthly, 3, 6, 12, 24 months, or a set date), Owner, Next review due and Last reviewed. Publishing counts as a review. When the due date passes, `publishedWhere` hides the item from the reader, search, suggestions, files and MCP; editors still see it. **Due for review** (`/admin/due-for-review`) lists hidden and due-in-30-days items with Renew (owner or administrator only; set-date items need a new future date).
- **Viewers:** PDF.js viewer (page nav, zoom, opens at a cited page), image zoom, audio and video players, Vimeo opening at a cited time. `/files/[id]` now serves PDF, PNG/JPEG/GIF/WebP, common audio and MP4/WebM inline; SVG and HTML never inline. Inline originals still require download permission (ADR-026).
- **How-to articles:** safe Markdown subset (headings with anchors, lists, links, `/files/` screenshots), Copy link for the page and each heading, On this page, More in section.
- Validation: typecheck, 119 tests (20 files; new REQ-NAV-03, REQ-GOV-01/02, REQ-VIEW-01, REQ-HOWTO-01), production build (6 indexed migrations). Local browser check with seeded synthetic data: section/topic listings, how-to article, Due for review, renew → item reappears, PDF opens at page 2.
- Not built: email reminders before due dates, Office/spreadsheet previews (Gotenberg), screenshot upload in the article editor, Home redesign with AXL, carrier pages.
- **Deploy (AWS laptop):** pull, build web and operations images, take an RDS snapshot, run the migrate task, then deploy web and worker, as for `657e4d0`.

### Navigation v2, phase 0 — 2026-11-18

- **Implemented, not deployed.** Reader sidebar with Home and six sections (active section expands to its topics and familiar pages; collapses to a rail on resource pages), and one search centered in the top bar on every page.
- **Ctrl K / `/` search window:** live, debounced results from the authorized ranked search via `GET /library-api/suggest` (no AI call, `private, no-store`), type chips with counts (Documents, Videos, Slides, Pages), keyboard navigation, and "See all results".
- **Section pages** at `/sections/[id]`. Topics and familiar pages link to search until section tagging lands (P1).
- Typecheck, 106 tests (incl. REQ-NAV-01/02) and production build pass. Not yet built: Home AXL hero, P1–P5 from the brief.

### Design handoff — 2026-11-18

- **Proposed, not implemented.** Navigation v2, carrier pages, saved views for familiar WordPress pages, how-to articles as a content type, Manage (review windows and expiry), and asset viewers. Brief, seed data, tokens and AXL assets are in [`docs/design/`](design/README.md), reconciled against `85c9fe1`. Visual source: the "AE Library — design" canvas. Open decisions A–G are listed in the brief.

### Library pages — deployed to dev 2026-11-18 ~20:15 CST

- Commit `b19d288`, built on this laptop.
- Images: `dev-platform-library-pages` (index `sha256:bea8b737…`, amd64 `sha256:50e45ce3…`) and `dev-platform-ops-library-pages` (index `sha256:b5c1ae6b…`, amd64 `sha256:cc2ae81b…`). Verified identical to the local builds.
- **Snapshot quota:** the account is at its RDS limit of 100 manual snapshots, mostly other systems' snapshots dating from 2014. The pre-migration snapshot failed with `SnapshotQuotaExceeded`, and the migration still ran because the snapshot result was not checked. The risk was low: the migration is additive, and `pre-sections-20261118` was about an hour old with no real content added since.
  - With the owner's approval, deleted our own `aecp-dev-postgres-pre-cms-retire-20261117`, then took `aecp-dev-postgres-post-library-pages-20261118`.
  - Then deleted `aecp-dev-postgres-pre-admin-ux-20261118` (owner request), leaving 99/100 with one slot free for the next pre-migration snapshot. Remaining dev snapshots: `pre-sections-20261118` and `post-library-pages-20261118`. From now on, deploy steps must stop when a snapshot fails.
- Migration `20261119_011841_library_pages` applied (batch 5); the rerun was a no-op.
- Smoke test passed. Web `aecp-dev-library-web:7` is healthy; worker `aecp-dev-library-worker:5` started and reconciled.
- Live checks via the real hostname: health, Home, `/sections/planning`, `/search`, `/axl-mark.svg`, and admin login all 200. Anonymous `/admin/manage` shows the sign-in page only. Anonymous suggest returns navigation pages only.
- Not yet verified: signed-in Manage and add-content flows, and saved items and feedback with real users.
### Sections, review windows and how-to — deployed to dev 2026-11-18 ~18:55 CST

- Commit `f59acd9`, built on this laptop.
- Images: `dev-platform-sections` (index `sha256:7b20e239…`, amd64 `sha256:85882bfe…`) and `dev-platform-ops-sections` (index `sha256:05dc611a…`, amd64 `sha256:862490dd…`). Verified identical to the local builds.
- Database: snapshot `aecp-dev-postgres-pre-sections-20261118` taken first. Migration `20261118_234658_review_windows_and_sections` applied (batch 4); the rerun was a no-op.
- Deploy: smoke test passed; web `aecp-dev-library-web:6` healthy on the target group; worker `aecp-dev-library-worker:4` started and reconciled. The Vimeo token is still not stored.
- Live checks via the real hostname: health 200, home 200, `/sections/planning` 200, admin login 200. Anonymous `/library-api/suggest` returns only navigation pages (no library items), `private, no-store`.
- Not yet verified: the signed-in walkthrough (upload → AI tagging → Review → publish), the Ctrl K search with real content, and review-window hiding.
### Owner actions pending — 2026-11-18

1. ~~**Internal DNS**~~ — done: `library-dev.advisorsexcel.com` now resolves on the corporate network (verified 2026-11-18 18:55 CST).
2. **Vimeo token → Secrets Manager** (on the laptop holding `.env.local`). Run this with a current `ae-dev-mfa` session; it never displays the token or puts it on a command line:

   ```powershell
   $secure = Read-Host 'Paste Vimeo token (hidden)' -AsSecureString
   $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   $file = Join-Path $env:TEMP ("vimeo-" + [guid]::NewGuid().ToString('N') + ".json")
   try {
       $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
       $me = Invoke-RestMethod -Uri 'https://api.vimeo.com/me?fields=name' -Headers @{ Authorization = "Bearer $token"; Accept = 'application/vnd.vimeo.*+json;version=3.4' }
       "Token OK for Vimeo account: $($me.name)"
       @{ SecretId = 'aecp-dev-library-vimeo-token'; SecretString = $token } | ConvertTo-Json -Compress | Set-Content -LiteralPath $file -Encoding ascii
       aws secretsmanager put-secret-value --profile ae-dev-mfa --region us-east-1 --cli-input-json "file://$file" --query 'VersionStages' --output text
   } finally {
       Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
       [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
       Remove-Variable token, secure -ErrorAction SilentlyContinue
   }
   ```

   Then redeploy the worker on the current image so it receives the token. No image push is needed; the script prints `Vimeo token stored: True`:

   ```powershell
   .\infra\aws\library\worker-service.ps1 -ImageDigest sha256:3df8a57f477a46d58e641e5ffdefbeb77a54b1537023d68c06e109e62772d6e4
   ```
3. **Live signed-in check** once DNS resolves: new item → upload a text PDF → extraction → AI tagging → Review → accept → cover image → audience → publish → reader grid.
4. **Content decisions:** starter Tags & topics (AI tagging chooses only from these), audiences and access profiles, and the first editors and admins to invite.

### Admin usability, invitations and automation — 2026-11-18

- **Admin polish — deployed to dev 2026-11-18 ~14:25 CST (commit `657e4d0`).** Images `dev-platform-admin-polish` (amd64 `sha256:b9cc25b5…`) and `dev-platform-ops-admin-polish` (amd64 `sha256:3df8a57f…`), verified identical to local builds. No schema change; migrate was a no-op and the smoke test passed. Web `aecp-dev-library-web:5` is healthy; worker `aecp-dev-library-worker:3` started and reconciled. Pinned-ALB checks: health, home, and admin login 200.
  - Shared admin styles in `custom.css`: cards, buttons, tables, status pills, notices, and a file picker.
  - Automation status: stat tiles; Steps and Worker cards with On/Off pills; Failed and In progress tables in cards.
  - Review: status pill, proper Accept/Reject buttons, and a source-text card.
  - Processing panel: section labels, step pills, and a styled file picker that shows the chosen file name. Upload stays disabled until a file is chosen.
  - Cover image and publish checklist use the same cards and buttons. Disabled buttons are visibly disabled, and the checklist says why Publish is unavailable.
  - People, Audiences, and Access profiles show Yes/No pills instead of `true`.
  - Verified in the local preview; typecheck and 98 tests pass.
- **Deployed to dev (2026-11-18 ~13:50 CST), commit `6392131`.**
  - Images:
    - web `aecp-dev-cms:dev-platform-admin-ux`: index `sha256:1d1b74b1…`, amd64 `sha256:772d1741…`
    - operations `dev-platform-ops-admin-ux`: index `sha256:738eb5a2…`, amd64 `sha256:f29b8275…`
    - Both verified identical to the local builds.
  - RDS snapshot `aecp-dev-postgres-pre-admin-ux-20261118` was taken first. Migration `20261118_190233_admin_usability` applied, and the rerun was a no-op.
  - Smoke test passed. Web service `aecp-dev-library-web:4` is healthy.
  - New always-on worker `aecp-dev-library-worker:2`:
    - Roles `aecp-dev-library-worker-execution` and `-task` (S3 `content/*` and `processing/*`, Transcribe, the two approved Bedrock inference profiles).
    - Private subnets, no public IP.
    - Paid processing on under the daily limit. The Vimeo token is not stored yet, so Vimeo jobs and Vimeo thumbnails wait.
    - Verified it started: TLS, current schema, no DDL privilege, reconcile loop running.
  - Fixed two deploy-script defects found here:
    - `worker-service.ps1` passed unquoted `Key=…,Value=…` tags, which PowerShell splits.
    - `worker.js` passed a database target without `:5432`, so the processing CLI's target check correctly refused to start.
  - The ALB now also admits the owner's new IP. A DNS limitation remains: the owner's current network resolver has no `library-dev.advisorsexcel.com` record, though public DNS returns the CNAME to the ALB. Checks pinned to the ALB address: health 200, home 200, admin login 200, sign-in redirects to Auth0, anonymous thumbnail 404, anonymous cover upload 403.
  - Not yet verified live: signed-in upload → extraction → AI tagging → Review, cover upload to S3, PDF thumbnails, Transcribe.
- **Account menu (Portal pattern).**
  - The signed-in person sits at the bottom of the navy menu on both the reader site and the admin. Clicking it opens a card with name and email, then:
    - Reader site: **Admin** for editors and administrators, and **Manage people** for administrators.
    - Admin: Content library, Review suggestions, and Manage people for administrators.
    - Both: **Appearance** (Auto / Light / Dark, one shared setting for reader and admin) and **Sign out**, which ends both the session cookie and the Auth0 session.
  - The theme switch and Sign out were removed from the reader's top bar and from the admin menu body. On small screens the reader menu collapses to the avatar and opens downward.
  - Verified in the local preview, light and dark: choosing Dark in the admin applies to the reader site. Typecheck and 98 tests pass.
- **Thumbnails and media-library layout (latest, same image).** The owner asked for CMS imagery inside the Portal styling, using real preview images, not generated art.
  - Library items now have a preview image (ADR-034): an editor-uploaded cover (sidebar **Cover image**: upload, replace, or remove), else the Vimeo poster, else page 1 of the PDF. The worker creates the automatic ones; there is a new **Automatic thumbnails** setting.
  - Reader home defaults to a **grid** of 16:9 cards (image, format chip, title, two-line summary, date), with a **List** toggle that adds small thumbnails. A resource without a video or PDF preview shows its cover on the detail page.
  - Admin: a **Preview** column in Library items, a **Recently updated** image grid on the dashboard, and thumbnails in Review.
  - Items without imagery show a neutral format tile.
  - All WordPress import screens are now hidden from the admin, because the migration is a separate, held-aside one-time process (see `MIGRATION.md`). The planner records each post's real featured image for that migration.
  - The migration was regenerated as `20261118_190233_admin_usability` and the task scripts were updated.
  - Validation:
    - Type checking; 98 tests (4 new: image sniffing, storage keys and limits, Vimeo picture host filtering, Vimeo token never sent to the CDN).
    - Python import tests (28, 1 new for featured-image selection); production build with 5 indexed migrations.
    - TLS PostgreSQL 16.15: 27 integration checks (7 new), including a **real PDF page-1 render to a 640 px JPEG inside the Linux operations image** and thumbnail sync rules (PDF-only without Vimeo, no regeneration, editor cover never replaced, missing Vimeo picture marked unavailable, a new Vimeo ID retries, temporary failures retry).
    - Local preview with an S3-compatible stand-in: cover upload → stored → served byte-identical with security headers, shown in the reader grid and admin list; anonymous 404; cross-origin 403; non-image 415; removal reverts.
    - Live S3, Vimeo pictures, and worker thumbnailing in AWS remain unverified until deployed.
- Owner reported the admin was hard to use (raw Auth0 IDs, unexplained screens) and asked for plain-language guidance, simple content entry, and an automation framework. Decisions: keep Payload and customize it; **email invitations** link on first sign-in; paid processing **on in dev** under a daily limit; **always-on** Fargate worker.
- Admin: plain-language names and menu groups (Library; Review & automation; People & access; WordPress import, admin only), a description on every page and field, technical fields collapsed, a role-based start-here dashboard with live counts, workflow links in the menu, and readable list columns. Files can only be added through a library item's upload. Per the owner, WordPress snapshots and links are hidden from the admin entirely; the one-time backend migration still writes those tables for provenance.
- People: name, work email (unique, normalized), Can sign in, roles, last sign-in. Administrators invite by email with no Auth0 ID. A verified sign-in links exactly one unlinked invitation when the email is trusted: `waad` directory email, or `email_verified: true` (`AUTH0_TRUSTED_EMAIL_CONNECTIONS`). Sign-in refreshes the name, email, and last sign-in. It never creates people or changes roles or access. Sign-in now requests `openid profile email`.
- Content entry: a Processing panel on each library item uploads the original file (50 MB limit; stored by content hash, never overwritten) and shows files, step status with plain-language reasons, and a link to Review. Manual items take the uploaded file's hash, or a Vimeo-derived hash, as their source version. Imported items keep their WordPress version.
- Automation: `Automation settings` global (pause; text extraction; Vimeo captions; transcription; AI tagging model — Claude Haiku 5.5 default or Sonnet 5.5; tag categories; daily paid-job limit). The worker (`processing loop`) reconciles every 10 seconds: it queues extraction for new files and Vimeo IDs, and AI tagging after extraction, only for Intake/Draft items and never re-queues an existing job. Paid steps require `ALLOW_PAID_PROCESSING`, the setting, an approved model (`BEDROCK_MODEL_IDS`), and room under the limit. `/admin/automation` shows counts, failures with reasons, the queue, and administrator Retry.
- Fixed a pre-existing queue defect found by the first real-PostgreSQL run: `JobStore.enqueue` and `fail` used parameters PostgreSQL could not type (`inconsistent types deduced for parameter $3`), so no job could be queued in RDS. Added explicit casts.
- Validation: type checking; 89 tests in 15 files (12 new: automation gating, invitation linking, email trust, settings parsing, messages); production build with 5 indexed migrations. On TLS PostgreSQL 16.15, an upgrade from the deployed schema applied `20261118_163038_admin_usability`, and 17 integration checks passed (reconcile, tagging queue, settings, queue lifecycle including claim/backoff/defer/fail/retry/finish, unique invitation emails). A local admin preview with a generated test session confirmed the grouped menu, dashboard, People columns, Processing panel, settings save, invitation create, and status-page Retry. Live upload, worker, Transcribe, Bedrock, and invitation linking are unverified until deployed.
- AWS prepared: web task role can also `PutObject` to `content/*`; Vimeo token secret `aecp-dev-library-vimeo-token` exists without a value (the token is on the other laptop). The worker starts without it; Vimeo jobs report "Vimeo access is not configured". Next: push `admin-ux` images, migrate, deploy web and worker (`infra/aws/library/worker-service.ps1`), then test upload → extraction → AI tagging → Review.
- Added in the same image, at the owner's request:
  - **Bulk add** (`/admin/bulk-add`): drop up to 50 files; each becomes an Intake library item named from its file (titles editable first) and starts processing. Stops before creating items if file storage is not configured.
  - **Audiences** collection (People & access): the approved list of firms, business lines, teams, programs, and plans. Membership and access-rule scopes are chosen from a dropdown and validated server-side against active audiences; a typo can no longer silently block access. Keys are permanent; values saved before the list existed stay valid until changed.
  - **Publish checklist** in each item's sidebar (audience required; reviewed text, summary, and tags recommended) with a one-click **Publish now** for administrators.
  - **Review inside the admin** (`/admin/review`, `/admin/review/:id`): current vs. suggested summary and tags with tag names, evidence locations, editable decision, and source text. Old `/review` URLs redirect; decision errors return to the page with an explanation.
  - **Ranked full-text search** for the reader site and MCP: PostgreSQL `websearch_to_tsquery` with title > summary > text weighting and a GIN index. Ranking only orders IDs; the existing authorization query still decides what each person can see. Stop-word-only queries fall back to substring matching.
  - **Light / Dark / Auto** switch in the reader header and admin menu, sharing Payload's `payload-theme` cookie so one choice applies to both.
  - The single new migration is now `20261118_190233_admin_usability` (users, automation settings, audiences, search index, thumbnails); task scripts expect it.
- Validation: type checking, 94 tests (5 new: bulk naming/formats, audience validation on memberships and rules, audience keys, search ranking), production build. TLS PostgreSQL 16.15 integration: 20 checks including search order, unpublished exclusion, stop-word fallback, and GIN index use. Local browser walk-through with sample data: in-admin review → accept → checklist → choose audience → publish; access rule and membership via audience picker; reader search finds the item; dark mode applies to reader and admin from one setting; bulk-add page renders. Live S3 upload not exercised locally.
- **Portal-aligned visual design** (owner supplied AE Portal light-mode screens): the reader site now uses Portal's layout and palette: navy sidebar with an "ae library" wordmark, quick search, staff links (Review suggestions, Admin), and a signed-in user block; a white top bar with breadcrumbs; a light grey page with white bordered cards; and Portal blue (#3d5af1). The library is a Portal-style list card: format tabs, search toolbar, and a table with title, summary, colored format chips, and date, plus pagination. The resource page has a back arrow and title with subtitle, a cited-passage callout, summary, preview, and full-text cards, and a right-hand Resource information and Files panel. Signed-out, no-access, error, and not-found states use the same cards. Dark mode has a matching palette. Admin (`app/(payload)/custom.css`): navy menu in light mode, light grey canvas, white cards, and Portal-blue primary buttons in both themes; custom admin panels use white cards. Verified by screenshots of the reader list and detail in light and dark, and the admin dashboard with the navy menu.

### Dev deployment of c8f2d4b — 2026-11-18

- Owner resolved the Auth0 `access_denied` (an application permission in the tenant) and reports successful sign-in.
- Local: `npm ci`, type checking, 77 tests across 13 files, and the production build with artifact gate (2 admin CSS assets, 4 indexed migrations) passed. Upgrade rehearsal on TLS PostgreSQL 16.15: the previously deployed operations image applied the first two migrations, then the new operations image applied `20261118_091607_processing_review` and `20261118_092849_review_receipt`; the rerun was a no-op.
- Owner pushed `dev-platform-c8f2d4b` and `dev-platform-ops-c8f2d4b`; ECR index digests match the local builds. Tasks pin amd64 manifests (`sha256:df14d746…` web, `sha256:d6d40518…` operations); `run-task.ps1` now takes `-OperationsDigest`/`-RuntimeDigest` and `migrate.js` expects all four migrations by name.
- Dev migration task applied both migrations over verified TLS; ledger has four rows (batches 1, 1, 2, 2), and the rerun was a no-op. Private smoke task passed (runtime role read access, no `CREATE`, processing schema present, expected anonymous responses).
- Created task role `aecp-dev-library-web-task` with only `s3:GetObject` on `content/*` in `aecp-dev-381003255014-us-east-1`; the web service now sets `CONTENT_BUCKET`. No objects are stored yet. Worker/processing IAM, Vimeo, Transcribe, and Bedrock access are not granted; paid processing stays disabled.
- `aecp-dev-library-web:3` is healthy behind the ALB. Verified live: `/health`, `/`, and `/admin/login` return 200; both admin CSS assets load (293,598 and 32,541 bytes); anonymous `/review` shows "Editor access required"; anonymous `/api/users` 403, `/mcp` 401, and `/files/1` 404; sign-in redirects to Auth0.
- Next: owner confirms styled admin, edit/save, sign-out/sign-in, and citation return after sign-in. Then create an access profile and reader membership, stage approved sample content, and run two-user isolation, protected file, and MCP checks.

### Other-device build handoff — 2026-11-18

User authorized checking in the complete reviewed pre-deployment bundle to `main`. Pull the resulting commit on the AWS laptop, install from the updated lockfile, and build both web and operations targets from `apps/platform`. Apply `20261118_091607_processing_review` and `20261118_092849_review_receipt` through the operations image before rolling out the new web image: its startup check requires the latter migration. Follow [processing/review](PROCESSING-AND-REVIEW.md) and [local/live acceptance](LOCAL-ACCEPTANCE.md). Keep paid processing disabled until the destination session authorizes provider validation. Private packages, backups and credentials remain excluded from Git. The unresolved dependency advisory is documented in [DEPENDENCY-REVIEW.md](DEPENDENCY-REVIEW.md).

### Expanded pre-deployment slice — 2026-11-18 (local implementation)

- Implemented bounded PDF/Office/caption extraction, Vimeo caption-first processing with authorized MP4 fallback, private S3 staging, resumable Transcribe and Bedrock proposal adapters. Added an RDS-backed leased job queue, CLI staging/enqueue/work/retry, retries/deadlines, immutable completion/proposals and source/version checks. Paid providers remain disabled by default; no real content/provider calls occurred here.
- Added `/review` with source evidence, editable summary/tags, acceptance/rejection, reviewer audit and stale source/taxonomy checks. Acceptance writes a draft in one transaction and confirms a unique receipt; it cannot grant access or publish. Added protected PDF/original delivery, Vimeo embeds and reader error/empty/status messages. Originals require download permission even inline; view-only PDF derivatives remain deferred.
- User requested subagents and other models for cross-validation. Codex extraction/acceptance agents implemented and tested focused areas; a different Codex model reviewed queue/review races. Independent Grok review identified bearer-token privilege bleed, original-PDF permission mismatch, citation mutation and import receipt races. Fixed these: cookie-only Payload/browser auth, explicit MCP principal resolution, download checks for originals, reviewed evidence-only writes with invalidation on manual edits, and durable import mappings. Additional review fixes bind Vimeo IDs/taxonomy meanings and recover overlapping S3 staging. The independent follow-up confirmed the original fixes and found create/duplicate/source-identity hook defects. Fixed locally: operation-aware create handling, server-side duplication disabled with a defensive hook check, and source-key/hash changes invalidate evidence. Added three regressions; the follow-up itself was read-only and the residual fixes were verified by local tests/build, not a third model review.
- New migrations: `20261118_091607_processing_review`, then `20261118_092849_review_receipt`; generated offline, not applied here. Startup/smoke scripts require the latest migration before the next image. The custom admin import-map destination is now explicit, avoiding competing generated JS/TS maps.
- Dependency remediation removed the four moderate esbuild-chain findings. Remaining 16 high entries trace to the unpatched picomatch advisory; see [dependency review](DEPENDENCY-REVIEW.md). Do not report a clean audit or production approval.
- Validation: TypeScript passed; 77 tests across 13 files passed; production build and artifact gate passed (required standalone routes, two admin CSS assets, four indexed migrations). Eight isolated synthetic runtime-config cases passed in the acceptance subtask. CLI negative smoke refused work before database access and exited 1. A scan of 60 changed/new files found no excluded private paths or matches for the credential patterns checked. All database/provider tests use synthetic inputs/doubles; real RDS concurrency, Docker image/runtime and live provider/UI acceptance were not run here. See [processing/review architecture and commands](PROCESSING-AND-REVIEW.md), ADR-021–027 and [local acceptance gates](LOCAL-ACCEPTANCE.md).
- No new commit/push/deploy, cloud resources, live migrations, paid AI/transcription, or private-source processing in this slice. Next: commit/push the reviewed local bundle, then deploy under the destination session's authorization and run real RDS/provider/permission acceptance. SQS/outbox automation, OCR/large-media streaming, preview derivatives and vector search remain follow-on work.

### Pre-deployment admin/browser fixes — 2026-11-18

- User reports successful sign-in and supplied an authenticated admin screenshot with missing styling. Verified the platform admin layout omitted `@payloadcms/next/css`; added the import. Production output now contains Payload theme CSS (two matching CSS chunks, 326,139 bytes combined). Docker runtime already copies `.next/static`.
- Reviewed adjacent browser flows before rebuilding the image: retain citation query parameters through resource sign-in; reject control characters in return destinations; reject cookie authentication with a foreign Origin, including sibling same-site apps; require matching Origin or explicit same-origin Fetch Metadata for sign-out. Bearer authentication remains independent.
- Validation: TypeScript, 39 tests across seven files, production build and diff whitespace check passed. Extended existing authentication cases for same-site foreign origins, opaque origins, missing logout origin evidence and control characters. No authenticated browser or live AWS verification performed here.
- Fixes are local pending delivery. Next: rebuild/deploy the updated web image, verify styled admin and asset requests, admin edit/save, sign-out/sign-in, and citation return behavior. RDS import acceptance and actual two-user permissions remain separate gates.

### Browser login investigation — 2026-11-18

- User-supplied Auth0 event shows `access_denied` with application-specific text, “Access to AE Library Dev is not allowed,” and a recorded Action execution. User screenshot confirms the AAD enterprise connection is enabled for AE Library Dev.
- Likely next investigation: the deployed post-login Action's application entitlement/allowlist logic. An Action execution alone does not prove which condition denied access; inspect its execution details and deployed code before changing policy. Do not disable tenant-wide checks or grant broad API permissions as a workaround.
- Current browser code requests authorization code + PKCE with `openid` and the expected library callback. The supplied denial originates at Auth0 authorization, before the application's code exchange/session creation. No tenant settings changed here; successful login remains unverified.

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

No full Vimeo inventory, full WordPress backup validation/restore, full-library document extraction, transcription, cleanup, taxonomy approval, or production deployment. Offline metadata extraction and bounded document probes have been completed. The private dev foundation and initial CMS are live; deployment of `apps/platform` is not verified.

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
- Prepared [`infra/aws/data.yaml`](../infra/aws/data.yaml) locally for the existing Web Hosting VPC. The shared `database` subnet group uses internet-gateway-routed subnets; the known app pair uses NAT. Next: resolve the isolated subnet pair and validate sizing, engine compatibility, and cost before a change set. The repository still has no CMS build or deployment image. No AWS resources were created or changed.
- Read-only dev preflight found no existing isolated subnet pair. CloudFormation template validation passed, and the regional price list gives a $53.60/month data-stack baseline before S3 and usage-based charges. PostgreSQL 16.15 was orderable; application compatibility is not yet verified. See the [handoff](AWS-SETUP-HANDOFF.md) for assumptions. No change set was created.
- Prepared [`infra/aws/db-network.yaml`](../infra/aws/db-network.yaml) locally for two project-only database subnets and a dedicated route table in the existing Web Hosting VPC. Next: confirm available CIDRs with the network owner before a change set. No existing network resources were modified.
- The user approved the network execution and confirmed the owner tag. Verified the preview contained only the five expected additions. CloudFormation reported `AccessDenied` for `ec2:DescribeAvailabilityZones` and finished in `ROLLBACK_COMPLETE`; the same call succeeded directly from the CLI. Verified zero stack resources and no project subnets. Next: resolve CloudFormation execution permissions before retrying. RDS and S3 remain untouched.
- The user approved using the EC2 CLI instead. Created only the two approved project subnets, their dedicated route table, and the two associations. Verified two AZs, no automatic public addresses, VPC-local routes only, and the project/owner tags. The live resources are not CloudFormation-managed; IDs are in the ignored `data/aws-validation/dev-db-network.json` inventory. Next: use the verified subnet IDs for the separate data-stack preview when authorized. RDS and S3 were not created.
- The data change set rolled back before creating resources with `AccessDenied` for `ec2:DescribeSubnets`. With approval, created and verified the private, empty S3 bucket and the dedicated database security group, subnet group, and TLS parameter group via direct AWS CLI. RDS returned `KMSKeyNotAccessibleFault` with both the default and explicitly selected AWS-managed RDS key; no database instance was created. Next: verify RDS/KMS authorization or obtain an approved key before retrying just the instance. No app, ingestion, or import was deployed.
- CloudTrail correlated both RDS failures with an explicit identity-policy deny on `kms:DescribeKey` via RDS. IAM simulation denied that call without MFA and allowed it with MFA. The deployment identity has an MFA device enrolled. Next: authenticate the CLI with MFA and retry only the encrypted database instance; no AWS infrastructure or IAM policies were changed during diagnosis.
- After MFA login, created only `aecp-dev-postgres`. Verified `available` status, PostgreSQL 16.15, encrypted storage, no public access or inbound rules, seven-day backups, deletion protection, an active RDS-managed master secret, and an in-sync parameter group with `rds.force_ssl=1`. No database connection or application migration has been tested. Next: build and test the Payload image, then bootstrap database roles and verify TLS from an authorized task before deploying the service.
- Built and type-checked the initial [dev Payload CMS](../cms/). With disposable local PostgreSQL 18, verified initial migration and rerun, liveness, anonymous user API denial, and blocking of both public first-user entry points. The Linux Dockerfile was not built, and no AWS calls, RDS connections, deployments, or imports were made. Next: build and test the Linux image for dev, then run the separately authorized database bootstrap and TLS checks.
- Created and verified the private `aecp-dev-cms` ECR repository in `us-east-1` with immutable tags, scan on push, and AES256 encryption. The repository is empty. The next step is for the approved release pipeline to publish a Linux `amd64` image and provide its digest. No image, ECS service, or database migration was deployed.
- Built `aecp-dev-cms:local` on Docker Desktop's Linux engine and verified `linux/amd64` and non-root execution. The image served `/health` and blocked the first-user admin page in an isolated container with no external networking. Nothing was pushed to ECR or deployed to ECS. Next: publish the verified local image and record its ECR digest.
- Verified the user-published ECR image and pinned its Linux `amd64` platform digest (`sha256:598fe63a3620908448f6feb4016c3ad2951370ac77e7fe3f4d14351b273649a2`). Bootstrapped separate database roles and applied the initial Payload migration from a private task using verified RDS TLS. ECS reports `aecp-dev-web` rollout complete with one healthy CMS task, no public IP, and no load balancer. The runtime role passed read access and schema-create denial checks. The managed GuardDuty sidecar reported an image pull denial; security-owner review remains open. Editor access, admin bootstrap, and content ingestion are not enabled.
- The live dev service uses the initial `cms/` build. The newer `apps/platform` and its migrations arrived from the other device and have not been deployed. Reconcile the migration histories before applying the newer migrations to the existing dev database.
- Built non-root Linux/amd64 runtime (`aecp-dev-platform:local-rehearsal`) and operations (`aecp-dev-platform-operations:local-rehearsal`) images from `apps/platform`. Type checking and all 31 tests passed. On isolated, disposable PostgreSQL 16.15, the operations image applied `20261118_030155_foundation` and `20261118_041309_import_adapter` over verified TLS; rerunning left exactly those two ledger rows. The separate runtime role read `users` and `import_runs` over TLS 1.3 without schema `CREATE`. The app served `/` and `/health` and denied anonymous users API and MCP requests. No real data, Auth0 connection, AWS changes, or image publication. Next: review dependency audit findings for the release, then validate the images privately with a fresh logical database on dev RDS and keep the initial service intact.
- Reviewed `npm audit --omit=dev`: 18 affected dependency entries (14 high, four moderate) trace to two advisories, picomatch and legacy esbuild. The operations image contains both affected npm dependencies and should run only as a private one-off task, not as a server. Neither advisory's npm package path is shipped in the standalone runtime, but it contains an unversioned Next.js copy of picomatch; the runtime is not cleared for external exposure. No automatic fix was available, and no dependency changes were made. Read-only AWS checks confirmed RDS is private and available and `aecp-dev-web` is active with one running task and a completed rollout. Private ECR still has only the initial CMS tag. The new app's private RDS validation awaits image publication through the approved release process; no cloud changes were made.
- **AE Library app deployed to dev (2026-11-17).** The owner pushed `dev-platform-59d2311` (runtime) and `dev-platform-ops-59d2311` (operations) to `aecp-dev-cms`; digests match the locally tested images, and tasks pin their Linux/amd64 manifests. Created via the scripts in [`infra/aws/library/`](../infra/aws/library/) and the [`library-secrets.yaml`](../infra/aws/library-secrets.yaml) stack:
  - Secrets stack `aecp-dev-library-secrets` (AWS-generated runtime/migration passwords and Payload secret), three secret-scoped execution roles `aecp-dev-library-{bootstrap,migration,web}-execution`, and log group `/ecs/aecp-dev/library` (30 days).
  - Separate database `aecp_library` on `aecp-dev-postgres` with roles `aecp_library_migration` and `aecp_library_runtime`; `CONNECT` revoked from `PUBLIC`. The initial CMS database `aecp` and service `aecp-dev-web` were not modified.
  - Migration task applied `20261118_030155_foundation` and `20261118_041309_import_adapter` over verified TLS; the rerun was a no-op, and the ledger has exactly those two rows.
  - Private smoke task: runtime role on TLS 1.3, no schema or database `CREATE`, denied (`42501`) on the initial CMS tables; non-root server returned 200 for `/`, `/health`, and MCP resource metadata, 403 for anonymous users API, and 401 with a resource-metadata challenge for anonymous MCP.
  - ACM certificate for `library-dev.advisorsexcel.com`, DNS-validated through a CNAME in DNS Made Easy (keep it for renewal). Internet-facing ALB `aecp-dev-library-alb` in the public Web Hosting subnet pair, HTTPS with `ELBSecurityPolicy-TLS13-1-2-2021-06`, HTTP redirected to HTTPS, invalid headers dropped. Its security group allows 80/443 only from the owner's approved IP; the app security group allows 3000 only from the ALB; RDS gained one rule for the app security group.
  - ECS service `aecp-dev-library-web` (one Fargate task, private subnets, no public IP, circuit-breaker rollback) is healthy in target group `aecp-dev-library-tg`. HTTPS through the ALB with the real hostname verified the certificate and returned the same responses as the smoke test.
  - Auth0 is still a non-resolving placeholder, so protected routes fail closed. There is no browser or admin sign-in and no provisioned user. Not cleared for public exposure (dependency review above). Estimated added cost: ALB about $16–20/month plus one Fargate task.
- Next: add `library-dev` CNAME to the ALB DNS name in DNS Made Easy; implement Auth0 browser sessions for reader/admin; create the Auth0 API and application registrations; add a trusted one-off task to provision the first admin principal; redeploy with real Auth0 settings. Then retire the initial `aecp-dev-web` CMS service and its `aecp` database after confirming no data needs to be retained.
- **Initial CMS retired (2026-11-17).** Snapshot `aecp-dev-postgres-pre-cms-retire-20261117` taken first. A guarded task verified the `aecp` database held no data beyond its migration row (0 users), then dropped it and the `aecp_runtime`/`aecp_migration` roles. Removed service `aecp-dev-web`, its task definitions, three execution roles, the web security group and its RDS rule, image `dev-20261117-220926`, log group `/ecs/aecp-dev/cms`, and the `aecp-dev-cms-secrets`, `aecp-dev-data`, and `aecp-dev-db-network` stacks. Its three secrets are scheduled for deletion with a seven-day recovery window. `aecp-dev-cms-init-sg` is retained for library one-off tasks. The local `cms/` source is no longer deployed.
- **Browser sign-in deployed (2026-11-17).** Added Auth0 authorization-code sign-in with PKCE, state, and nonce (`/auth/login`, `/auth/callback`, POST `/auth/logout`) using `jose`. It sets an encrypted, HTTP-only, `__Host-` session cookie (8 hours). The Payload strategy uses a bearer token whenever one is present and otherwise the session cookie, never for cross-site requests. Admin access requires the editor or admin role. Signing in never creates users. Eight new tests cover PKCE, state, nonce, audience, tampering, return-path safety, sign-out origin, and bearer/cookie separation; all 39 tests, type checking, and the build pass. Auth0 tenant `auth-dev.advisorsexcel.com` (issuer verified from discovery), application client ID recorded in `infra/aws/library/web-service.ps1`. The owner stored the client secret in `aecp-dev-library-auth0-client-secret`; the session key is generated in `aecp-dev-library-session-secret`. The first administrator was provisioned as user 1 (admin, reader) for the owner's Auth0 identity by `run-task.ps1 -Step provision-admin`. Image `dev-platform-auth-20261117` (amd64 `sha256:59d559ea…`) runs as `aecp-dev-library-web:2`, healthy. DNS `library-dev` resolves to the ALB. Verified live: the login redirect reaches the Auth0 sign-in page with the registered callback, and the reader and admin login pages show sign-in. A full interactive sign-in by the owner is pending.
- Next: owner completes an interactive sign-in to the reader and `/admin`; then create access profiles and reader memberships, load the approved sample content, and test two-user isolation. MCP OAuth client registration and broader ingress remain separate steps.

### Source validation

1. Review the proposed 200-record pilot in `data/wordpress-inventory/scan-2026-11-17-v2/pilot-review.csv` and approve a 25-item smoke set with owners/audiences.
2. Resolve the two local image paths, external/staging references, unparsed builder value, canonical URLs, and source permission/firm hierarchy mappings. Establish original archive, backup timestamp, and live-source totals; plan an isolated restore for behavioral validation.
3. Confirm the taxonomy/access proposal's identity authority, business-line/profile rules, and human approval responsibilities. Keep all pilot intake restricted until mapping is approved.
4. Resume bounded Vimeo checks only when rate limits permit, then expand coverage and reconcile against source IDs. Check account/workspace context; do not assume personal-library enumeration covers everything.
5. Implement the local/dev smoke pipeline and labeled AI/retrieval/MCP evaluation described in `WORDPRESS-PILOT.md`, before expanding or running paid bulk processing.

Avoid bulk media downloads merely to count videos. Preserve the source backup and previous scan evidence.

## Suggested opening prompt for the new engagement

> Read AGENTS.md, README.md, and docs/STATUS.md. Continue the source-validation phase. Inspect the WP Engine backup I provide, preserve the original, and build a content/Vimeo inventory before provisioning the new platform. Use the existing .env.local token without printing it or signed media URLs.
