# AI processing, review and semantic search

Status, 2026-11-18: implemented locally and tested (unit tests and a real-PostgreSQL 17 + pgvector SQL check). **Not deployed and not run against AWS, Bedrock, Transcribe, Vimeo or real content.**

## What happens to an item

Applies equally to WordPress imports and to material staff add (single upload, Bulk add, Add content wizard).

1. **Files reach the pipeline.** Uploads already did. Imports now do too: `build_wordpress_import.py batch` exports each verified file once to `files/<sha256>.<ext>`; `import-batches.ps1` uploads them to `imports/files/`; the import task's `attach` step copies each processable file to the item's immutable `content/<id>/<sha256>.<ext>` and records it as the item's file for its current source version. Images and legacy `.doc` are not attached (no extractor yet).
2. **Every source is read.** Documents (PDF, Word, slides, spreadsheets, captions, text) are extracted on our server. **Scanned PDFs** (no text layer, or some pages without one) and PDFs over 50 MB are read by **Amazon Textract OCR**; if paid processing is off, partly scanned PDFs keep their typed text with a warning. Audio/video files go to Amazon Transcribe. Vimeo videos use their captions, or else the smallest MP4 rendition is streamed to S3 (now up to 2 GB, multipart) and transcribed.
3. **One combined analysis per item** (`ae-analysis/2`). Once every source of the item's current version has finished (succeeded or failed), the worker sends all of it — article text, each file, the Vimeo transcript — plus the item's current record (WordPress title, summary, categories, current fields and tags) to the selected Claude model on Bedrock in one call. The model proposes title (only if needed), summary, Type, Section, Topics, Pages, Audience, Program, Licensing, Line of business, Carriers, tags from the list, **new tags** to add, key takeaways, conflicts between the record and the content, and warnings, each with cited source passages. A retried or newly finished source re-analyzes; an accepted version is not re-analyzed.
4. **Field-by-field review** (`/admin/review/<id>`). Per the owner's rule: keep what the team wrote, backfill what's missing, propose clean-up. Title and summary default to the current value; empty fields (and WordPress import defaults nobody chose) default to the AI value; everything else shows current vs. suggested and applies only if the reviewer picks it. Current tags stay; AI tags and new-tag proposals are pre-checked only when the item has no tags. Accepting installs all source text as citations, fills reading text only if the item has none, and moves Intake to Draft. It never publishes, grants access, or deletes.
5. **Semantic index.** The worker embeds each reviewed citation passage of Draft and Published items (Amazon Titan Text Embeddings V2, 1024-d) into `passage_embeddings` (pgvector, HNSW), and prunes rows for superseded evidence. Reader search and MCP `search_content` fuse keyword and semantic rankings. Only published items with current evidence can match, and the existing authorization filter is applied afterwards, unchanged. If Bedrock is slow or unavailable, search silently falls back to keyword-only.

## Decisions

- **ADR-035 — import files enter the normal pipeline.** No import-only processing path. Bytes are verified at build, re-verified before upload, size-checked on copy, and attached only to items whose source version still matches the package. Reruns reuse objects and file records.
- **ADR-036 — one combined analysis per item, after all its sources finish.** Replaces per-file tagging for new work (old per-file suggestions remain reviewable). The input pins the exact source jobs (`sourceJobIds`, `sourceDigest`). Long items are sampled across sources within a fixed budget, with a warning; the full text is still stored for citations.
- **ADR-037 — review rule for migrated content.** Keep team values; backfill empty ones; propose clean-up. New vocabulary is created only when a reviewer checks it, keyed `dimension:slug` so the same tag is reused across items.
- **ADR-038 — pgvector in the existing RDS database; no separate vector or RAG product.** One table, hand-written migration `20261119_040000_semantic_index`. The extension is created by the bootstrap task (master role). Eligibility is decided by the content row at query time, so publication, expiry, archive and access changes apply immediately; deleting an item cascades.
- **ADR-039 — Titan Text Embeddings V2 for search.** Low cost and in-region; `EMBEDDING_MODEL_ID` can change it (must remain 1024-d). Switched on by `SEMANTIC_SEARCH=true`. The web role may invoke only this model.
- **ADR-040 — large Vimeo renditions stream to S3.** Multipart upload with per-part SHA-256 checksums and abort on failure; Transcribe's 2 GB limit replaces the 50 MB buffer limit for this path.
- **ADR-041 — OCR with Amazon Textract.** Asynchronous text detection on the item's private S3 object (500 MB / 3,000 pages), polled statelessly like Transcribe (idempotent per job key). Counts as a paid step under the Transcription switch and the daily paid-job limit. Results are marked `(OCR)` per page with a check-the-numbers warning.
- **ADR-042 — uploads over 50 MB go browser → S3.** The app signs a one-hour PUT to `uploads/<item>/<uuid>.<ext>` with the exact size, type, encryption and uploader signed (audio/video ≤ 2 GB, PDF ≤ 500 MB). The worker streams and fingerprints every byte, copies it to the immutable `content/<item>/<sha256>.<ext>` key with the fingerprint recorded, registers it through Payload with the same rules as a direct upload, and deletes the staging object. Unsigned, oversized, fake-PDF or unattachable uploads are deleted; abandoned staging objects expire after 2 days (bucket lifecycle). Files up to 50 MB keep the existing direct path.

Requirements: **REQ-INGEST-03** (OCR), **REQ-ASSET-03** (large uploads), **REQ-IMPORT-07** (import files attach idempotently, version-pinned), **REQ-AI-02** (combined analysis, keep/backfill/propose review), **REQ-SEARCH-02** (hybrid ranking never widens access; degrades to keyword), **REQ-SEARCH-03** (index tracks current evidence and state). Tests: `import-attach`, `analysis`, `analysis-review`, `automation`, `vimeo-media`, `semantic-search`, `ocr-and-large-uploads`.

## Deploy and live check (AWS laptop)

Pull `main`, then:

1. Build and push **new** web and operations images from `apps/platform` (images built before these commits lack all of this).
2. RDS snapshot.
3. `run-task.ps1 -Step bootstrap -OperationsDigest <ops>` — idempotent; now also runs `CREATE EXTENSION IF NOT EXISTS vector` as the master role.
4. `run-task.ps1 -Step migrate -OperationsDigest <ops>` — applies `20261119_040000_semantic_index`.
5. `bucket-uploads.ps1` (browser-upload CORS for the library origin; 2-day expiry for abandoned `uploads/`; keeps existing rules).
6. `worker-service.ps1 -ImageDigest <ops>` (adds Textract, Titan embedding, `uploads/` finalize and multipart-abort permissions, `PAYLOAD_SECRET`, `SEMANTIC_SEARCH=true`) and `web-service.ps1 -ImageDigest <web>` (adds the Titan query permission, signing PUTs into `uploads/`, `SEMANTIC_SEARCH=true`), then `run-task.ps1 -Step smoke`.
7. Store the Vimeo token in `aecp-dev-library-vimeo-token`, then rerun `worker-service.ps1` so the worker receives it.
8. Confirm Textract is available and in Bedrock that Claude Haiku/Sonnet 5.5 and Titan Text Embeddings V2 are invocable in us-east-1.
9. Import: `import-batches.ps1 -BatchDir <copied pilot-200-files> -OperationsDigest <ops> -PreviewOnly -Only batch-001`, then without `-PreviewOnly`.
10. Live check, one of each: a PDF item, a scanned PDF, a Vimeo item, an article-only item, a manual upload, and an audio/video upload over 50 MB (watch the progress, then "preparing", then transcription). Watch `/admin/automation`; then in `/admin/review` confirm sources, keep/backfill defaults, conflicts, new tags; accept; publish one with an access profile; search for it by a phrase that is not in its title, and confirm an unauthorized user cannot find it.

Cost controls: paid steps (Transcribe, Claude analysis) count against **Daily paid-job limit** in Automation settings (default 200/day); embeddings are not counted but cost roughly cents per thousand passages. Pause automation there at any time.

## Not covered yet

Legacy `.doc/.ppt/.xls`; Word/PowerPoint/Excel over 50 MB; OCR of images inside Office files; image understanding (WordPress featured images as covers is still pending); original WordPress dates; a staged-change merge UI for re-imported WordPress sources; a reviewed-evidence passage-level answer view in MCP.
