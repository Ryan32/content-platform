# Project brief

## Outcome

Replace the creative team's WordPress CMS with a platform that serves both a polished content library and a trustworthy knowledge source for Axl. Prefer one editorial system; processing and search services can operate behind it.

## Confirmed user requirements

- Approximately 3,500 authenticated readers, combining employees and external advisors; approximately 25 editors.
- Portal-like styling and navigation, ideally reusing the existing Portal experience and Auth0 identity.
- MCP access for Axl retrieval and authorized content/tagging management.
- Extract actual content from PDF, Word, and PowerPoint, including scanned/visual material where necessary.
- Automatically transcribe and index audio/video; prefer BYO AWS Transcribe or another interchangeable provider.
- Much existing video is hosted on Vimeo. Retaining embedded Vimeo is acceptable and preferred initially to avoid unnecessary media migration.
- Separate view-only and view-with-download rights, potentially differing by audience for the same content.
- Owners, scheduled annual reviews, cleanup, replacement, and archive workflows.
- Long-lived dev and production environments; use dev first as the POC and migration workbench.
- Compare commercial and open-source economics; include implementation and ongoing labor rather than only software prices.

## Planning assumptions, not measured facts

Initial model: 20,000 documents, 100,000 pages, 500 GB media, independently assumed 1,000 media hours, and 20% annual content growth. These numbers must be replaced by inventory results. Storage size does not determine duration. Existing Auth0 and Vimeo contract entitlements/costs are unknown.

## Constraints and boundaries

View-only means no authorized original-file download; it cannot prevent screenshots or recording. Browser PDF viewers receive PDF bytes. Stronger original-file controls require derived previews, with watermarking evaluated where appropriate.

The platform must preserve firm-specific and internal/external access boundaries. Axl retrieval eligibility is a separate governed decision from merely storing an item.

## Pilot acceptance criteria to finalize with owners

- Representative documents and recordings ingest with usable citations and visible failure reasons.
- Creative-team editors can upload, classify, review, and publish without developer assistance for routine work.
- Multiple audience scenarios pass both positive and negative access tests.
- Original-download restrictions are enforced by the backend.
- Review expiry and permission revocation affect Axl and search, not just page visibility.
- Imports can rerun without duplicates or loss of editorial decisions.
- Content and derivatives can be exported without dependence on the original WordPress instance.
