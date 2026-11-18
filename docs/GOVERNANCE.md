# Taxonomy, permissions, and review workflows

Status: starting proposal to validate against the inventory and content owners.

## Content model

Separate content entries from reusable assets, taxonomy terms, audiences/groups, ownership, source records, and processing jobs. Preserve versions and relationships between replacements and superseded items.

Required structured fields should cover title, summary, content type, accountable owner/team, allowed audiences, download permissions, lifecycle state, review interval/date, effective/expiration dates, and Axl eligibility. Dates have distinct meanings: source publication, last modification, last human review, and next scheduled review must not be conflated.

Descriptive taxonomy may include business area, topic, product/carrier, intended use, and format. Derive the actual vocabulary from source inventory, then approve definitions and synonyms with stakeholders. Avoid uncontrolled tag growth. Keep stable term IDs so renamed labels do not break relationships.

## Access model

View, download original, edit, approve, and retrieve through Axl are separate capabilities. Apply audience and firm restrictions server-side to originals and all derivatives. A transcript can expose the same restricted information as the video. Search titles/snippets, citations, previews, and caches must follow access rules.

For view-only Office files, generate a browser preview and protect the original. For ordinary PDF rendering, acknowledge that the browser receives PDF bytes. Derived page previews and user-specific watermarking can discourage redistribution but cannot prevent screenshots.

Use read-only MCP tools for reader sessions and a separate editor-scoped write interface. Never let retrieved content grant tool permissions. Unknown ownership or access maps to restricted intake until resolved.

## Publishing workflow

Intake -> processing -> editorial review -> required approval -> published. Maintain explicit processing failures and blocked reasons. Publication and Axl eligibility may differ. Human approval must reference the reviewed content version.

AI suggests summaries and descriptive tags with evidence. Only after measuring accuracy should selected low-risk suggestions be auto-applied. AI must not independently assign sensitive audience access, approve compliance content, or delete originals.

## Recurring review

Use a default 365-day cycle where appropriate, with shorter intervals or explicit expirations for volatile guidance. Suggested reminders: 30 and 7 days before due date, followed by escalation. Define reassignment when an owner leaves.

Review actions: reaffirm current version, revise, replace, archive. Record actor, timestamp, version, and decision. Overdue policy depends on content risk: general training may show a notice; expired rates or critical guidance may be excluded from retrieval immediately. These policies need business approval.

Archive, expiry, deletion, publication, replacement, and permission changes must update search/Axl eligibility. Test revocation propagation and cached results, not only CMS page visibility.

## Cleanup queue

Keep, update, merge, archive, exclude, investigate. Track evidence and responsible owner for each disposition. Preserve source snapshots and a reversible decision history. Archive is distinct from deletion and from a legal retention policy, which remains to be established.
