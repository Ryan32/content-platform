# AI processing, review and semantic search

Status, 2026-11-18: implemented locally and tested (unit tests and a real-PostgreSQL 17 + pgvector SQL check). **Not deployed and not run against AWS, Bedrock, Transcribe, Vimeo or real content.**

## What happens to an item

Applies equally to WordPress imports and to material staff add (single upload, Bulk add, Add content wizard).

1. **Files reach the pipeline.** Uploads already did. Imports now do too: `build_wordpress_import.py batch` exports each verified file once to `files/<sha256>.<ext>`; `import-batches.ps1` uploads them to `imports/files/`; the import task's `attach` step copies each processable file to the item's immutable `content/<id>/<sha256>.<ext>` and records it as the item's file for its current source version. Images and legacy `.doc` are not attached (no extractor yet).
2. **Every source is read.** Documents (PDF, Word, slides, spreadsheets, captions, text) are extracted on our server. **Scanned PDFs** (no text layer, or some pages without one) and PDFs over 50 MB are read by **Amazon Textract OCR**; if paid processing is off, partly scanned PDFs keep their typed text with a warning. Audio/video files go to Amazon Transcribe. Vimeo videos use their captions, or else the smallest MP4 rendition is streamed to S3 (now up to 2 GB, multipart) and transcribed.
3. **One combined analysis per item** (`ae-analysis/2`). Once every source of the item's current version has finished (succeeded or failed), the worker sends all of it — article text, each file, the Vimeo transcript — plus the item's current record (WordPress title, summary, categories, current fields and tags) to the selected Claude model on Bedrock in one call. The model proposes title (only if needed), summary, Type, Section, Topics, Pages, Audience, Program, Licensing, Line of business, Carriers, tags from the list, **new tags** to add, key takeaways, conflicts between the record and the content, and warnings, each with cited source passages. A retried or newly finished source re-analyzes; an accepted version is not re-analyzed.
4. **Field-by-field review** (`/admin/review/<id>`). Per the owner's rule: keep what the team wrote, backfill what's missing, propose clean-up. Title and summary default to the current value; empty fields (and WordPress import defaults nobody chose) default to the AI value; everything else shows current vs. suggested and applies only if the reviewer picks it. Current tags stay; AI tags and new-tag proposals are pre-checked only when the item has no tags. Accepting installs all source text as citations, fills reading text only if the item has none, and moves Intake to Draft. It never publishes, grants access, or deletes.
   - **Migration autopilot (2026-11-19).** For items imported from WordPress, the worker accepts the analysis with exactly these defaults, with no new tags. It also sets the access profile mapped from the item's WordPress roles. An administrator then publishes in bulk on `/admin/approve`. The autopilot can be turned off under *Migration autopilot* in Processing. Items added by staff still go through Review.
5. **Semantic index.** The worker embeds each reviewed citation passage of Draft and Published items (Amazon Titan Text Embeddings V2, 1024-d) into `passage_embeddings` (pgvector, HNSW), and prunes rows for superseded evidence. Reader search and MCP `search_content` fuse keyword and semantic rankings. Only published items with current evidence can match, and the existing authorization filter is applied afterwards, unchanged. If Bedrock is slow or unavailable, search silently falls back to keyword-only.

## Every file type in the backup

The full WordPress inventory (6,680 records) references 7,600 present files: 3,033 PDF, 4,243 images, 144 docx, 105 pptx, 60 xlsx, 8 zip, 3 mp4, 2 doc, 1 xls, 1 xlsm. All are handled:

| Type | How it is read |
| --- | --- |
| PDF | Text layer; Textract OCR for scanned/partly scanned pages and PDFs over 50 MB (to 500 MB). |
| docx, pptx, xlsx, xlsm | Text, slides, sheets. Up to 200 MB; larger files are refused (the one 742 MB deck is excluded by owner decision). Picture-only slides (under 25 characters of text) have their images read by AI vision (max 25 per deck). |
| doc, xls, ppt | Old binary formats: readable text recovered approximately, with a warning. |
| zip | Every supported file inside is read and labelled `packet › file · page`; pictures inside go to AI vision. No nested zips. |
| jpg, jpeg, png, webp, gif | AI vision (the approved Claude model): description plus transcribed text, as citable passages. Images under 8 KB (icons) are not imported; pictures the model judges decorative add nothing. |
| svg | Title, description and visible text read directly (free); scripts ignored. |
| mp3/mp4/wav/m4a/flac/ogg/webm | Amazon Transcribe (to 2 GB). |
| Vimeo | Captions, else MP4 streamed and transcribed. |

**WordPress featured images** become the item's cover (same storage and fields as an editor-uploaded cover; never replaces one) and are not processed as a source unless the post also uses them elsewhere. **Original dates**: WordPress GMT publication and modification times are stored as `originalPublishedAt` / `originalUpdatedAt`; readers see "Published" and "Updated" from them, and lists sort by `listedAt` (original publication date for migrated items, otherwise when added), so a migration does not flood "New in the Library". Migration `20261119_030446_original_dates` adds the columns and backfills `listedAt` for existing items.

Not processed: 1,628 external links (other sites; kept as references) and 710 files missing from the backup.

## Pages with several files and videos (owner decision, 2026-11-18)

WordPress worked page-first: a Download Manager package (4,294 records) is a landing page with a description and one or more files (189 have 2+). The library keeps that: **one page per package or post; files never get their own page.** Each file has a section on the page (`#file-<id>`) with its real name, type, size and its own AI-suggested description (reviewed in the same Review screen; empty descriptions backfilled, existing ones kept). Pictures used inside an article are marked `inline`: read by AI and shown under "Images in this article", never offered as downloads.

Search covers page text, the reviewed text inside every file (full-text index on passages) and meaning. A hit inside a file links to the page opened at that passage and that file's section (`/resources/<id>?citation=…&file=<id>#file-<id>`), and the result says "Found in <file> · Page n". MCP `search_content` returns the same as `matchedIn` and `matchUrl`.

Pages with several Vimeo videos keep all of them (main player plus "More videos"); each is transcribed and included in the page's analysis and search. **Events (`tribe_events`, 26 records) are not migrated**; events live in AE Portal and may be dropped from the library altogether.

## Keep everything: evidence, full-text index, analytics lake (owner decision, 2026-11-18)

**1. Lossless evidence.** Every raw provider output is kept as returned, gzipped, under `evidence/<item>/<kind>/<processor>/<sha256>.json.gz` in the private bucket (no expiry), and listed in `evidence_artifacts`:
- Textract: every result page with all blocks, confidence and geometry.
- Transcribe: the full output with words, timings, confidence and speaker labels (now enabled).
- Vimeo caption files as served.
- Every full extraction.
- Every model call: purpose, model, prompt version, the full request (image bytes replaced by their fingerprint), the full response, stop reason, tokens and latency.

Captures are saved whether the job succeeds or fails. A failed save fails the job as retryable (`evidence_store_unavailable`), never silently. Extraction limits were raised so large files are kept, not rejected: 64 MiB of text and 50,000 passages.

**2. Everything indexed, weighted.** `search_chunks` holds every piece of text on a Draft or Published item, rebuilt when anything on the item changes:
- title, summary, takeaways, tags, and each file's name and description;
- article text, each file's text, transcripts, OCR text and picture readings.

Long text is split into overlapping windows of about 3,500 characters; short transcript segments are merged. Each chunk carries its source and weight:

| Source | Weight |
| --- | --- |
| title | 3.0 |
| summary | 2.5 |
| takeaway, tag, file | 2.0 |
| article | 1.2 |
| document, slides | 1.0 |
| sheet, captions | 0.9 |
| transcript | 0.8 |
| OCR | 0.7 |
| picture | 0.6 |

Keyword relevance and vector similarity are each multiplied by the source weight; page-level keyword, chunk keyword and chunk meaning rankings are fused. Only current chunks of Published items can match for readers, and authorization is applied afterwards as before. Every chunk is embedded (Titan Text Embeddings V2).

**3. Analytics lake (Iceberg on Amazon S3 Tables, read in place by Snowflake).** Rows go first to the `analytics_outbox` table, often in the same transaction as the change they describe. The worker ships them to one Amazon Data Firehose stream per Iceberg table; a row is marked shipped only after Firehose accepts it, and shipped rows are pruned after 7 days (the Iceberg tables are the record). Tables in namespace `library`, all append-only:

| Table | Contents |
| --- | --- |
| `events` | Job success, retry and failure; review decisions field by field (AI value, previous value, pre-selected, chosen, final, edited), tags, new tags and file descriptions. |
| `model_calls` | Purpose, model, prompt version, tokens, latency, evidence key. |
| `evidence` | The evidence manifest. |
| `chunks` | Every chunk with source, weight, text and embedding. |
| `items` | A snapshot each time an item is indexed. |

Every record also carries the full row as JSON text in `payload`, so no field is lost to the column mapping. Staff appear only as `user:<internal id>`; reader identities are not exported.

### Snowflake (read in place, no loading)

Verify the syntax against current Snowflake docs before running ([REST catalog integration](https://docs.snowflake.com/en/sql-reference/sql/create-catalog-integration-rest); S3 Tables REST integration GA 2026-08-10). The IAM role must trust Snowflake's principal and allow S3 Tables read access on the table bucket.

```sql
CREATE CATALOG INTEGRATION ae_library_s3tables
  CATALOG_SOURCE = ICEBERG_REST
  TABLE_FORMAT = ICEBERG
  CATALOG_API_TYPE = AWS_S3TABLES
  CATALOG_NAME = '<table bucket ARN printed by analytics-iceberg.ps1>'
  REST_CONFIG = ( CATALOG_URI = 'https://s3tables.us-east-1.amazonaws.com/iceberg' )
  REST_AUTHENTICATION = ( TYPE = SIGV4  SIGV4_IAM_ROLE = '<arn of a Snowflake read role>'  SIGV4_SIGNING_REGION = 'us-east-1' )
  ACCESS_DELEGATION_MODE = VENDED_CREDENTIALS
  ENABLED = TRUE;
CREATE DATABASE ae_library_lake LINKED_CATALOG = ( CATALOG = 'ae_library_s3tables' );
-- Then: SELECT * FROM ae_library_lake."library".events; current chunks per item = latest build_version per content_id.
```

Library content is access-restricted; grant Snowflake roles accordingly.

## Decisions

- **ADR-035 — import files enter the normal pipeline.** No import-only processing path. Bytes are verified at build, re-verified before upload, size-checked on copy, and attached only to items whose source version still matches the package. Reruns reuse objects and file records.
- **ADR-036 — one combined analysis per item, after all its sources finish.** Replaces per-file tagging for new work (old per-file suggestions remain reviewable). The input pins the exact source jobs (`sourceJobIds`, `sourceDigest`). Long items are sampled across sources within a fixed budget, with a warning; the full text is still stored for citations.
- **ADR-037 — review rule for migrated content.** Keep team values; backfill empty ones; propose clean-up. New vocabulary is created only when a reviewer checks it, keyed `dimension:slug` so the same tag is reused across items.
- **ADR-038 — pgvector in the existing RDS database; no separate vector or RAG product.** One table, hand-written migration `20261119_040000_semantic_index`. The extension is created by the bootstrap task (master role). Eligibility is decided by the content row at query time, so publication, expiry, archive and access changes apply immediately; deleting an item cascades.
- **ADR-039 — Titan Text Embeddings V2 for search.** Low cost and in-region; `EMBEDDING_MODEL_ID` can change it (must remain 1024-d). Switched on by `SEMANTIC_SEARCH=true`. The web role may invoke only this model.
- **ADR-040 — large Vimeo renditions stream to S3.** Multipart upload with per-part SHA-256 checksums and abort on failure; Transcribe's 2 GB limit replaces the 50 MB buffer limit for this path.
- **ADR-043 — one file-type registry** (`processing/formats.ts`) drives uploads, import, the job queue and the browser, with per-type size limits (Office/zip 200 MB, legacy 50 MB, PDF 500 MB, media 2 GB, images 20 MB).
- **ADR-044 — pictures are read by AI vision**, normalized through the worker's canvas to ≤1568 px JPEG; a paid step under the AI tagging switch and the daily limit. Worker memory raised to 3 GB for 200 MB Office/zip files.
- **ADR-045 — original source dates are separate fields**, never overwriting Payload's own timestamps; `listedAt` is the reader's sort date.
- **ADR-046 — page-first files (hybrid).** One library item per WordPress package/post; each file is a named section with its own description and deep link, not a separate item. Keeps one set of access, review dates and approval per page. A file can later be split into its own item if it needs to stand alone.
- **ADR-047 — citations know their file.** Passages carry the asset they came from, so search, citations and MCP can point to the exact file on the page.
- **ADR-048 — lossless evidence.** Raw provider outputs, full extractions and model calls are kept forever under `evidence/` (content-addressed, gzipped) with a database manifest; reprocessing never needs to pay for OCR or transcription again.
- **ADR-049 — one weighted index over everything.** `search_chunks` replaces passage-only embeddings: every source is chunked, keyword-indexed and embedded, weighted by source; nothing is excluded from search, curated fields simply rank higher.
- **ADR-050 — analytics as append-only Iceberg tables on S3 Tables** via a transactional outbox and Firehose; Snowflake reads them in place through a catalog-linked database. Chosen over nightly file exports (owner decision, 2026-11-18).
- **ADR-051 — review decisions are labels.** Each decision records, per field, the AI value, prior value, pre-selection, choice, final value and whether the reviewer edited the AI wording.
- **ADR-052 — keep Payload, contain the coupling.** Payload provides the admin, data model, migrations, save-time rules and versions; product logic (search, AI processing, retrieval, reader site, analytics) stays outside it. Payload-generated names live only in `src/db/payload-schema.ts`, Payload internals only in `src/db/payload-db.ts`, checked by a schema contract test on real PostgreSQL. See [UPGRADING-PAYLOAD.md](UPGRADING-PAYLOAD.md).
- **ADR-041 — OCR with Amazon Textract.** Asynchronous text detection on the item's private S3 object (500 MB / 3,000 pages), polled statelessly like Transcribe (idempotent per job key). Counts as a paid step under the Transcription switch and the daily paid-job limit. Results are marked `(OCR)` per page with a check-the-numbers warning.
- **ADR-042 — uploads over 50 MB go browser → S3.** The app signs a one-hour PUT to `uploads/<item>/<uuid>.<ext>` with the exact size, type, encryption and uploader signed (audio/video ≤ 2 GB, PDF ≤ 500 MB). The worker streams and fingerprints every byte, copies it to the immutable `content/<item>/<sha256>.<ext>` key with the fingerprint recorded, registers it through Payload with the same rules as a direct upload, and deletes the staging object. Unsigned, oversized, fake-PDF or unattachable uploads are deleted; abandoned staging objects expire after 2 days (bucket lifecycle). Files up to 50 MB keep the existing direct path.

Requirements: **REQ-DATA-01** (analytics outbox to Iceberg), **REQ-DATA-02** (lossless evidence), **REQ-DATA-03** (review labels), **REQ-SEARCH-05** (everything indexed, weighted), **REQ-IMPORT-09** (one page per package, real file names, roles), **REQ-AI-04** (per-file descriptions), **REQ-SEARCH-04** (hits inside files open the page at that file), **REQ-INGEST-05** (every video on a page), **REQ-INGEST-04** (every backup file type), **REQ-AI-03** (pictures), **REQ-IMPORT-08** (original dates, featured-image covers), **REQ-INGEST-03** (OCR), **REQ-ASSET-03** (large uploads), **REQ-IMPORT-07** (import files attach idempotently, version-pinned), **REQ-AI-02** (combined analysis, keep/backfill/propose review), **REQ-SEARCH-02** (hybrid ranking never widens access; degrades to keyword), **REQ-SEARCH-03** (index tracks current evidence and state). Tests: `import-attach`, `analysis`, `analysis-review`, `automation`, `vimeo-media`, `semantic-search`, `ocr-and-large-uploads`, `all-formats`, `file-pages`.

## Deploy and live check (AWS laptop)

Pull `main`, then:

1. Build and push **new** web and operations images from `apps/platform` (images built before these commits lack all of this).
2. RDS snapshot.
3. `run-task.ps1 -Step bootstrap -OperationsDigest <ops>` — idempotent; now also runs `CREATE EXTENSION IF NOT EXISTS vector` as the master role.
4. `run-task.ps1 -Step migrate -OperationsDigest <ops>` — applies `20261119_040000_semantic_index`.
5. `bucket-uploads.ps1` (browser-upload CORS for the library origin; 2-day expiry for abandoned `uploads/`; keeps existing rules).
6. `analytics-iceberg.ps1` (after enabling the S3 Tables integration with AWS analytics services in the S3 console): table bucket `aecp-dev-library-analytics`, namespace `library`, five Iceberg tables, Firehose role and five streams `aecp-dev-library-*`. If Lake Formation governs the catalog, grant the Firehose role DESCRIBE/SELECT/INSERT/ALTER on the tables. Until this runs, analytics rows wait safely in the outbox.
6b. `worker-service.ps1 -ImageDigest <ops>` (adds Textract, Titan embedding, `uploads/` finalize, `evidence/` write/read, Firehose delivery and multipart-abort permissions, `PAYLOAD_SECRET`, `SEMANTIC_SEARCH=true`, `ANALYTICS_FIREHOSE_PREFIX`) and `web-service.ps1 -ImageDigest <web>` (adds the Titan query permission, signing PUTs into `uploads/`, `SEMANTIC_SEARCH=true`), then `run-task.ps1 -Step smoke`.
7. Store the Vimeo token in `aecp-dev-library-vimeo-token`, then rerun `worker-service.ps1` so the worker receives it.
8. Confirm Textract is available and in Bedrock that Claude Haiku/Sonnet 5.5 and Titan Text Embeddings V2 are invocable in us-east-1.
9. Import: `import-batches.ps1 -BatchDir <copied pilot-200-v3> -OperationsDigest <ops> -PreviewOnly -Only batch-001`, then without `-PreviewOnly`.
10. Live check, one of each: a PDF item, a scanned PDF, a Vimeo item, an article-only item, a manual upload, and an audio/video upload over 50 MB (watch the progress, then "preparing", then transcription). Watch `/admin/automation`; then in `/admin/review` confirm sources, keep/backfill defaults, conflicts, new tags; accept; publish one with an access profile; search for it by a phrase that is not in its title, and confirm an unauthorized user cannot find it.

Cost controls: paid steps (Transcribe, Claude analysis) count against **Daily paid-job limit** in Automation settings (default 200/day); embeddings are not counted but cost roughly cents per thousand passages. Pause automation there at any time.

## Not covered yet

Office files over 200 MB (refused by design); external links; files missing from the backup; the full 6,680-record migration (only the 200-record pilot is batched so far); a staged-change merge UI for re-imported WordPress sources; a reviewed-evidence passage-level answer view in MCP.
