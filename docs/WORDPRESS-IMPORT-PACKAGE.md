# WordPress restricted intake package

Status: implemented offline package builder and dry-run reconciliation. This does **not** write to Payload/RDS, upload files to S3, publish content, process media, call Vimeo, or send content to AI. It prepares a reviewable, repeatable handoff while AWS deployment continues. Auth0 work remains shelved by user direction.

## Commands

Run from the repository root:

```powershell
python -m unittest discover -s scripts -p test_wordpress_import.py
python scripts/build_wordpress_import.py build --output data/wordpress-import/NEW-PACKAGE --limit 12
python scripts/build_wordpress_import.py validate --package data/wordpress-import/NEW-PACKAGE
```

Default inputs are the corrected `data/wordpress-inventory/scan-2026-11-17-v2` scan and untouched `data/dbr-backup`. Optional `--scan` and `--source` select another explicitly prepared scan/backup. The namespace is deliberately fixed to `wordpress:dbr`; another source site requires a versioned namespace design, not reuse of these IDs.

Output must be a new directory under ignored `data/`, separate from the input scan/backup. Existing directories are refused, including interrupted runs. A valid package requires a final `complete.json` marker and matching file hashes; an interrupted directory must not be consumed. Rebuild into a new directory instead of deleting evidence or overwriting review work. Console reports contain aggregate counts, identifiers/hashes and sanitized error codes, not titles, source URLs or raw content.

`validate` checks the completed package and its internal hashes/relationships; it does not re-open backup binaries. `build` performs the bounded source-file verification. A later upload/apply step must independently verify the actual transferred bytes against the package before consuming them.

## Package contract

Four files are written:

- `package.json`: schema `ae-wordpress-intake/1`, deterministic package ID, input provenance, source snapshots, initial content proposals, deduplicated local blobs, Vimeo references, source taxonomy and relationship edges, and skipped-source reasons.
- `summary.json`: counts, overlapping formats, issues, skipped controls, zero publication/access grants and zero copied binaries.
- `dry-run.json`: proposed actions against an empty or explicitly supplied target-state snapshot. No mutations are performed.
- `complete.json`: checksums of the package/report files, written only after those files are complete. Checksums detect accidental changes; they are not digital signatures or an authorization mechanism.

Private source text and embedded links remain in the ignored package. Do not commit it or paste raw content/URLs into logs. File references are private backup-relative paths plus verified byte hashes, not public delivery URLs. Transfer the source files separately when needed; this package does not duplicate 20+ GB of media.

## Mapping and ownership

| Source evidence | Package/target proposal | Guardrail |
| --- | --- | --- |
| Site + WordPress post ID | `wordpress:dbr:post:<ID>` → `sourceKey` | Distinct articles never collapse because their files match. |
| Original selected post columns and allowlisted metadata | Immutable `sourceSnapshots`, keyed by source and canonical content hash | Reads SQLite in read-only mode; preserves repeated metadata rows and raw HTML/builder data as inert source data. No PHP execution or arbitrary settings/users export. |
| Source title | Plain-text `initialContent.title` | Original retained; empty titles get a flagged deterministic placeholder. |
| Descriptive fields | Description priority: `page_description`, excerpt, intro, post content | Selected field recorded; empty description flagged. Current manifest descriptions are cleaned derivatives, not raw source replacement. |
| Original post content | Plain-text initial body | Script/style/embed content is excluded from plain text. Builder structures are retained but not rendered or falsely represented as fully extracted text. |
| Source publication/local/GMT timestamps, GUID and author/parent IDs | Source snapshot | No inferred timezone conversion or canonical URL; no migration of author account permissions. GUID is explicitly not a verified canonical URL. |
| Source publication status and source roles | Restricted intake seed, null access profile, zero grants | Published/private WordPress records do not become published platform records. Unknown mapping blocks publication and retrieval. |
| Source taxonomy `(taxonomy, term_id)` | Namespaced source terms and per-record relationships | `acceptedTags` starts empty. Labels are not automatically translated into platform dimensions or entitlements. |
| Current file fingerprint | `sha256:<digest>` blob + per-record asset occurrences | Rehashes each selected present file and compares bytes/hash with the stable pilot baseline; changes/missing expected files abort. No fuzzy path substitution. |
| WordPress attachment ID | Separate attachment identity, metadata in its source snapshot, and record edge | Keeps WordPress identity and parent distinct from byte deduplication. Missing attachment metadata is flagged. |
| Vimeo ID | `vimeo:video:<ID>` reference with field provenance | Does not claim access validation, download or transcript availability. Multiple videos stay as multiple edges; single-value `vimeoId` is set only when unambiguous. |
| Linked download package / parent | Namespaced content edge with in-package/outside-package status | Dependencies outside this subset remain explicit; no invented target IDs or implicit recursive import. |
| Missing/external/ambiguous references | Source-reference edge and review issue | No network fetching, guessed local resolution or silent drop. |

Primary format is a deterministic display proposal using PDF, Vimeo, article, slides, Word, audio, video, spreadsheet precedence. Word/spreadsheet map to the current `document` enum; original overlapping formats remain in the package. A future mapping review can change the display choice without rewriting the source snapshot.

The current Payload schema can accept the `initialContent` fields on **create only**. It cannot yet persist the entire import contract: immutable source snapshots, source taxonomy mapping and multi-record asset/link associations require a subsequent adapter/schema extension. Do not hand the whole package to a generic CMS CRUD endpoint. That adapter must preserve the ownership rules below, validate the contract, use transactions and unique constraints, and record source-to-target reconciliation before live application.

## Rerun and editorial preservation

Use `--target-state data/.../target-state.json` with a private snapshot of this shape:

```json
{
  "schema": "ae-import-target-state/1",
  "records": [
    {
      "sourceKey": "wordpress:dbr:post:123",
      "sourceHash": "previous-source-snapshot-sha256",
      "stagedSourceHashes": [],
      "title": "Human-reviewed title",
      "acceptedTags": ["reviewed-term-id"]
    }
  ]
}
```

This is an illustrative format, not an existing target exporter. The current dry-run planner accepts additional editorial fields and never modifies the supplied state.

- Absent source key → `create_restricted_intake` using the insert proposal.
- Matching current or staged source hash → `unchanged`.
- Changed source hash → `stage_source_version_for_review`; existing title, body, tags, policy and publication state are preserved, not patched.
- Existing target whose known source is now ineligible → `review_existing_source_ineligible`. This flags a lifecycle concern; it does not itself withdraw a published target. The future adapter/review workflow must resolve it before release.
- Target records outside the subset are preserved. Absence from a small package never means delete/archive.

The source hash covers selected raw data, repeated metadata, source taxonomy/links, attachment metadata and verified file hashes. Relationship-only changes count even when WordPress's modified timestamp does not change. Set-like manifest arrays are canonicalized so ordering alone does not create revisions. Snapshot changes never authorize overwriting human editorial decisions.

## Selection and actual validation

The bounded selector starts from the existing 200-record past-year pilot. It covers available format classes, then builder/missing-description/attachment/shared-asset cases. It favors shared-path examples to exercise distinct-record preservation. All 20 negative controls are excluded. Source eligibility is the inventory's as-of assessment, **not** proof of current live-site publication or authorization.

Authoritative local package: `data/wordpress-import/pilot-v3/`; independent rebuild: `pilot-v3-repeat/`. Earlier v1/v2 outputs are preserved exploratory selections. The v3 package ID is `62f1ecfa909f1777334b0149af0a79fa62db23197f82c354f9effe39e19e1119`.

Observed results:

- 12 restricted records and source snapshots; 83 verified local file paths/blobs totaling 69,858,518 bytes. No binaries copied.
- Formats overlap: 5 PDF-linked, and one each article, Vimeo, Word, slides, spreadsheet, audio and local video. A missing-description edge case can lack a recognized format.
- 1 Vimeo provider reference; 80 source taxonomy terms; 104 taxonomy edges; 3 attachment edges; 117 asset edges. One blob has relationships to multiple distinct records.
- 188 pilot records are outside the requested subset; all 20 negative controls are ineligible/skipped. No linked-package examples exist in the 200-record pilot; outside-subset and in-package links are tested with synthetic fixtures.
- Issues: unresolved policy/canonical URL for all 12; 3 records with external-reference issues, 1 with a missing-reference issue, 2 with builder content not reconstructed, and 2 without a description. These are record-level issue counts, not necessarily unique asset counts.
- Independent builds produced byte-identical packages. A simulated target with edited titles/tags yielded 12 unchanged actions, without modifying any editorial state. Evidence report: `data/wordpress-import/pilot-v3-validation.json`. This is not a live CMS rerun test.

Synthetic tests cover crossed data namespaces, shared assets, changed-source staging, repeated metadata, sensitive-key exclusion, source-file fingerprint mismatch, path traversal/Windows alternate streams, output overwrite refusal, incomplete markers, package tampering, source-order normalization and source-ineligible review. Existing SQL/serialization tests remain part of verification. Final test counts and review findings are recorded in `STATUS.md`.

Final validation passed 19 importer tests plus eight inventory/parser tests. Independent review identified incomplete completion-marker enumeration and acceptance of unknown relationship kinds; both were fixed with regression cases. Every completed package must list exactly its package, summary and dry-run files, and all relationship kind/status pairs must belong to the documented contract.

## Decisions and next boundary

- **ADR-013:** Build a transportable private intake package before an RDS writer. This separates source mapping verification from cloud availability and prevents accidental production writes.
- **ADR-014:** Source snapshots and manual target state have different ownership. Import inserts only for new identities; updates stage evidence for review. No automatic widening of access or destructive source disposition.
- **ADR-015:** Preserve all relationship occurrences while deduplicating file bytes by SHA-256. An asset hash is not a permission identity or a reason to merge articles.
- **ADR-016:** Rehash bounded selected files against the existing stable inventory rather than re-reading the entire SQL/media backup. The package preserves the original dump hash; it does not claim a new full-backup integrity audit.

Requirements: **REQ-IMPORT-01** stable identity/reproducible output; **REQ-IMPORT-02** editorial-preserving reconciliation; **REQ-IMPORT-03** relationship/source fidelity; **REQ-IMPORT-04** restricted intake and private artifacts. Tests are in `scripts/test_wordpress_import.py`.

Update: the [transactional Payload adapter](PAYLOAD-IMPORT-ADAPTER.md) is implemented locally with synthetic tests and a generated migration. Next: isolated dev RDS acceptance and source-mapping review, then document extraction and caption/transcript ingestion. AI tagging, vector search, file delivery and live client acceptance remain separate steps. No paid processing or publication was performed here.
