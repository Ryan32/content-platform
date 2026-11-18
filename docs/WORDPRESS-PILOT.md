# WordPress inventory and AI retrieval pilot

Status: source investigation and proposed test plan, 2026-11-17. No CMS import, AI analysis, transcription, vector indexing, MCP deployment, or live WordPress restore has been performed by this scan.

## Source and evidence boundaries

The user confirmed the bulk copy into `data/dbr-backup` is complete. Read the dated results in `docs/STATUS.md` and the private machine-readable reports under `data/wordpress-inventory/scan-2026-11-17-v2/`. Earlier `scan-2026-11-17/` artifacts are exploratory and superseded for content selection; its sanitized Vimeo checks remain valid per checked video ID. The v2 extractor corrects an escaped-quote edge case that affected serialized builder data.

The scan parses literal values from the SQL dump without executing SQL against MySQL or running WordPress/PHP. It preserves the source dump, computes its SHA-256, checks that its size/mtime remain stable, verifies its completion marker, and checks the extracted SQLite database. A dump completion marker and successful parsing do not prove a restorable or fully reconciled live site.

The inventory includes posts, post metadata, taxonomy/term relationships, term access metadata, Pods relationships, Download Manager asset tables, Pretty Links, and allowlisted site/access options. It excludes user accounts, form submissions, security logs, and general site settings. Download master keys and stored package/post passwords are reduced to presence flags in the derivative. All source content and private reports remain ignored under `data/`.

## What constitutes an active material

Use `publish` and `private` as candidate statuses; private material remains restricted. Exclude draft, auto-draft, trash, and future content from the positive pilot. Check Download Manager availability and expiration dates, plus pending past-due PublishPress expiration actions. Unparseable dates require investigation. Being an active candidate is not proof of audience access, current compliance approval, or Axl eligibility.

Primary content types: `wpdmpro`, `post`, `page`, `ae_insider_article`, `training_tool`, `wealth_strategy`, and `tribe_events`. Retain other records as supporting source evidence; builder histories, navigation, notifications, and staff directories should not accidentally populate the material pilot.

The one-year selection window is **2025-11-17 through 2026-11-17 inclusive**, based on WordPress's local `post_date`. Older items modified in that period form a separate cohort. Do not substitute a year found in a filename/title for publication evidence. The dump is a snapshot; later live-site changes are not included.

## Source-to-target extraction mapping

| Source | Preserve or derive | Qualification |
|---|---|---|
| `wp_posts.ID`, type, dates, status, parent | Stable source key, version provenance, parent relationships | WordPress `guid` is preserved as a source identifier, not assumed to be the canonical URL |
| Title, excerpt, body | Title, source HTML, proposed description | Empty excerpt does not imply there is no description elsewhere |
| `page_description`, `intro`, `subheadline`, `notes` | Additional descriptive/editorial evidence | Notes are not automatically reader-visible |
| `embed_code`, video fields, current `_fl_builder_data` | Current embeds, links, layout text | Do not treat saved builder drafts/history as current published content |
| `__wpdm_files`, attached-file metadata, attachment parent IDs | File identities, local presence, external references | Exact local matching; basename-only candidates are unresolved, never silently substituted |
| Vimeo references across content and metadata | Stable video ID and source relationship | Preserve needed private embed metadata in source snapshots; no public posting or privacy changes |
| `wp_terms`, taxonomy, relationships | Existing categories/tags and stable IDs | Starting vocabulary for AE taxonomy; not automatically a clean approved taxonomy |
| Package and category `__wpdm_access` | Proposed source-role mapping evidence | Download Manager combines both; global hooks, user capabilities, and source customizations still need validation |
| WordPress private status, theme behavior, SSO/role settings | Restricted access evidence | UI hiding is not equivalent to backend security |
| `ad_review_number`, expiry, scheduled actions | Compliance/expiry references | A review number is not proof of current approval |
| Pretty Links, package shortcodes, Pods/custom relationships | Link-resolution work queue and supporting source tables | Must reconcile before final canonical URLs and related-content mappings are accepted |

Source code inspection found Download Manager's package/category role combination and the theme's private-content logic. Do not carry those rules into Payload as permissive defaults. An approved mapping must specify view, original download, edit, approval, and Axl retrieval separately.

## Local artifacts

Under the v2 scan directory:

- `extraction-report.json`: dump hash, tables/rows, integrity/stability checks, safe option allowlist.
- `inventory.sqlite`: private source extraction for further read-only queries.
- `files.jsonl`: local file paths, sizes, and mtimes; not an original-site manifest.
- `content-manifest.jsonl`: source titles/descriptions, dates/status, taxonomy, roles, file/Vimeo relationships, flags, and cohort.
- `attachment-manifest.jsonl`: all attachment records and local-file resolution.
- `metadata-key-catalog.json`: available source fields and counts, without their values.
- `pilot-manifest.jsonl`: 200 proposed positive pilot records selected deterministically for format/topic/date diversity.
- `pilot-review.csv`: editor-friendly shortlist, source IDs/titles, description preview, formats, references, flags, and pending disposition.
- `negative-controls.jsonl`: separate stratified draft/future/trash/expired cases; never publish these as positive materials.
- `asset-exceptions.jsonl`: missing, ambiguous, zero-length, or unsafe local references.
- `pilot-file-hashes.json`: hashes and file signatures for locally present pilot assets; asset deduplication does not merge article permissions.
- `summary.json`: aggregate scan results and limitations.
- `document-probe-summary.json` and `document-probes/`: bounded native-text probes with source locations; PDF samples cover only the first three pages. OCR, layout fidelity, table accuracy, and visual understanding remain untested.

Vimeo validation writes sanitized metadata, authorized-file-link presence, caption availability, and errors. It never downloads media or persists expiring file URLs. A rate-limit response stops the batch. Do not report a partial batch as full Vimeo coverage.

## Pilot execution order

1. **Resolve source readiness.** Review the CSV, confirm owners/audiences, separate external and staging references, and investigate actual local misses. Keep an exception cohort instead of hiding broken sources. Confirm canonical link behavior and custom relationships with source owners or an isolated restore.
2. **Freeze a 25-item smoke set.** Select from the 200 records: native PDFs, the no-text/OCR candidate, Word tables, slides with notes/charts, Vimeo with captions, Vimeo requiring Transcribe, local audio, an internal article, and a reused asset. Label exact source version/hash. Do not replace a missing format with a falsely labeled sample.
3. **Extract with evidence.** Store source, extracted text, page/slide/timestamp mappings, parser version, failures, and quality flags separately. Import to restricted intake. Use usable existing Vimeo captions first; stage an authorized file in private S3 for AWS Transcribe when captions are absent or unsuitable. Never change Vimeo download/embed settings.
4. **Propose AE enrichment.** Use a versioned AE vocabulary derived from the real source terms and approved examples. Generate proposed summaries, tags, entities, use cases, and questions answered with evidence references. Flag ambiguity and contradictions. AI cannot grant access, approve compliance, or delete originals.
5. **Evaluate retrieval before expansion.** Compare keyword-only and hybrid keyword/vector retrieval on the same labeled cases. Proposed implementation: RDS PostgreSQL full-text and pgvector, subject to Axl integration review. Index eligible source-grounded passages with source version, permissions, and citation offsets.
6. **Exercise MCP.** Expose reader-scoped search and citation/content fetch tools, then test through Axl with two distinct audiences. Editorial write tools remain separate. Backend authorization applies before returning titles, snippets, transcripts, originals, or citations.
7. **Expand to the frozen 200-item set** only after the smoke set exposes and resolves systemic failures. Preserve a holdout subset that is not used to tune prompts or retrieval settings.

## Evaluation specification

Create human-reviewed labels against the frozen source versions. Candidate questions generated by AI are suggestions until someone checks the expected evidence and answerability.

| Capability | Test and expected evidence |
|---|---|
| Extraction | Title/description fidelity; PDF page, slide notes, table cells, and audio timestamps against originals; OCR candidates flagged rather than silently empty |
| AE tagging | Approved taxonomy IDs; precision/recall on labeled items; unsupported tags and inferred claims recorded |
| Retrieval | At least 30 reviewed questions spanning exact terms, AE acronyms/synonyms, concepts absent from titles, and multi-item questions; measure recall@5/10 and ranking quality against labeled relevant sources |
| Citation quality | Every answer claim is supported by the cited approved version and correct page/slide/time; unsupported-answer and no-answer cases included |
| Access isolation | Authorized audience succeeds; another firm/audience and anonymous caller receive no restricted titles, snippets, transcripts, or citations |
| Download separation | View-only can access permitted previews; original and alternate direct-file routes deny access |
| Lifecycle | Draft, future, expired, archived, revoked, and replaced items excluded from reader retrieval; revocation checked even with stale index/cache entries |
| Reliability | Duplicate upload/event, worker failure, transcription delay, provider throttling, retry, and late completion do not duplicate records or overwrite reviewed edits |
| Content injection | Text that instructs the model to ignore rules or run tools remains source data and cannot authorize actions |
| Operations | Per-item status, errors, latency, transcript minutes, OCR pages, token usage, and processing cost are visible |

Proposed release gates: zero access leaks in the test matrix; all expected source relationships reconciled or explicitly blocked; all returned citations resolvable to an authorized current version; idempotent reruns; and no silent overwrite of editorial decisions. Set numerical relevance/tagging targets after the initial labeled baseline rather than inventing performance claims now.

## Reproducing the investigation

Use a new output directory for a new dump/version. The SQL extractor refuses to overwrite an existing scan directory. The analysis script regenerates machine outputs but refuses to overwrite a review CSV with recorded decisions.

```powershell
python -m unittest discover -s scripts -p test_inventory_wordpress.py
python scripts/inventory_wordpress.py --output data/wordpress-inventory/NEW-SCAN
python scripts/plan_wordpress_pilot.py --scan data/wordpress-inventory/NEW-SCAN --since 2025-11-17 --as-of 2026-11-17 --limit 200
python -m pip install --target tmp/pilot-python -r scripts/pilot-requirements.txt
python scripts/probe_pilot_documents.py --scan data/wordpress-inventory/NEW-SCAN
```

When Vimeo rate limits permit, perform an explicitly bounded read-only check using the local token:

```powershell
python scripts/check_pilot_vimeo.py --manifest data/wordpress-inventory/NEW-SCAN/pilot-manifest.jsonl --output data/wordpress-inventory/NEW-SCAN/vimeo-check.json --limit 20
```

The small check supports resuming a matching interrupted partial report; completed reports are preserved. Inspect rate-limit results before a later batch. This script is a diagnostic, not the production job framework described in `AWS-SETUP-HANDOFF.md`.

PDF probing uses [pypdf's native text extraction](https://pypdf.readthedocs.io/en/7.0.0/user/extract-text.html); it does not perform OCR. No private material was sent to an AI model during this investigation.
