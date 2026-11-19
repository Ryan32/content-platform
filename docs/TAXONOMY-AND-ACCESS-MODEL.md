# Proposed AE taxonomy, AI editorial workflow, and access model

> **Superseded for access (2026-11-18):** the decided access model, with WordPress evidence and the role mapping, is in [ACCESS-MODEL.md](ACCESS-MODEL.md). This document remains the earlier framework and taxonomy discussion.

Prepared 2026-11-17 from the WordPress backup inspection. This is a concrete design proposal for review, not an approved business policy or implemented security model. Detailed source role/term inventories remain private under `data/wordpress-inventory/scan-2026-11-17-v2/`.

## 1. What the existing system tells us

Verified: WordPress has separate source roots for Business Unit, Licensure, Content Topic, Audience, Content Type, Brand/SubBrand, Carrier, Vendor, Strategy, Event, Advisor Success Track, and AE Signature Status. Its 611 Download Manager categories combine these dimensions in one taxonomy; its 709 tags include many people/presenters. These counts describe source vocabulary, not the target tag count.

The current Business Unit branch includes AE Wealth Management, Annuity, Life Insurance, Medicare Solutions, AE Financial Services, Operations, Creative Services, Compliance, Legal, General, and High Net Worth. Audience includes Advisor-facing and Consumer-facing. Licensure includes IAR-RIA, Insurance Only, and AEFS. Content Type mixes file formats (PowerPoint, Video, Spreadsheet) with editorial forms (Guide, FAQ, Checklist, Webinar, Case Study).

The 29 configured WordPress roles mix application responsibilities, access tiers, business affiliations, program/coaching enrollment, firm/cohort access, signature status, and account lifecycle. Several standard WordPress role slugs have custom business labels: `editor` is Content Manager and `author` is Stakeholder. Do not migrate roles by their default WordPress meanings. Pending and deactivated accounts are states, not normal reader roles.

Download Manager combines direct package roles and category roles, and filters can modify the result. The theme handles private content and role-specific navigation separately. We have not tested all effective live-site permissions or inspected user membership records; these rules are evidence for mapping, not a certification of current behavior.

## 2. Target classification fields

Give taxonomy terms stable IDs, names, definitions, approved synonyms, optional parent terms, owners, lifecycle state, and versioned source mappings. Avoid a single unrestricted bag of tags. Retain legacy IDs even when labels are merged or renamed.

| Field | Proposed values or examples | Population and review |
|---|---|---|
| Owning team | Annuity, Life, AEWM, Medicare, Operations, Creative, Compliance, Legal | Required human/accountable ownership; route suggestions to a queue |
| Business lines discussed | Annuity, Life Insurance, Wealth Management, Medicare; AE Financial Services where confirmed | AI suggests one or more; editor accepts; descriptive only |
| Topics and subtopics | Retirement planning, carrier guidelines, marketing, practice management, tax planning, client relationships, investments, operations | Approved controlled vocabulary; AI evidence required |
| Editorial content type | Guide, FAQ, checklist, form, template, case study, webinar, course, commentary, policy/procedure | One primary type, optional secondary types |
| File/media format | PDF, Word, slides, spreadsheet, HTML, audio, video | Deterministic MIME/container detection; multiple assets allowed |
| Intended use/audience | Advisor-facing, consumer-facing, employee training; marketing, client education, internal procedure | Descriptive classification; never a public-access flag or compliance approval |
| Entities | Carrier, product, platform/vendor, named strategy, presenter/author | Match approved entity IDs and aliases; ambiguous names need review |
| Program/brand/series | Existing approved brands, coaching series, events, campaign, episode/session | Descriptive membership; separate from paid/restricted enrollment |
| Experience/learning path | Existing CEO/Optimize/Scale tracks; beginner/intermediate/advanced if useful | Curated vocabulary, optional AI suggestion |
| Client/practice segment | High Net Worth, practice stage, advisor-team use cases | Treat High Net Worth as a segment proposal, not an automatic security group |
| Applicability | Relevant jurisdiction, credential context, effective dates | AI can flag evidence; human verifies any operational restriction |
| Source-grounded knowledge | Summary, key takeaways, questions answered, passage citations | AI-generated proposals with explicit provenance |
| Lifecycle/quality | Owner, review due date, expiry, approval state, extraction quality, superseded-by | Human rules plus deterministic workflow; AI flags possible issues |

Keep General as a broad descriptive category where justified; never interpret it as public or unrestricted. Lending is present in the source taxonomy but needs an owner/business decision before being promoted to a target business-line entitlement. Compliance, Legal, Operations, and Creative are shared functions; tagging them does not automatically make material internal-only or external-safe.

Recommended initial burden: require owner, primary type, business relevance, access profile, lifecycle state, and Axl eligibility before publication. Suggest a small number of precise topics rather than requiring editors to fill every optional field. Additional terms can be proposed to a taxonomy steward; AI cannot silently create hundreds of permanent tags.

## 3. AI and manual editing

1. Capture immutable source/version, existing classifications, and access evidence in restricted intake.
2. Extract text/captions/transcripts and page/slide/timestamp locations. Incomplete extraction is visible and can block downstream claims.
3. Supply the model with a versioned AE vocabulary, definitions, synonyms, and reviewed examples. Ask it to select existing term IDs and return evidence, ambiguities, and unsupported-claim flags in a validated schema.
4. Store suggestions independently from accepted editorial values. Each suggestion records field/term, source version, evidence references, model/prompt/taxonomy versions, reviewer status, and optional model confidence. Confidence is advisory until calibrated against labeled examples.
5. Give editors a review screen with the original/preview, current values, suggested values, and the supporting passage. They can accept, reject, replace, add approved terms, edit summaries, and propose new vocabulary.
6. Preserve decisions as explicit overrides: accepted manual values, rejected suggestions, reason, actor, timestamp, and reviewed source version. A rerun may propose a change but cannot overwrite or silently re-add a rejected value.
7. For a new source version, show what changed and which prior decisions need reconfirmation. Publication approval binds to a specific version; a modified asset must not inherit approval silently.

POC default: all AI classifications remain suggestions until reviewed. Later, measured low-risk rules may auto-apply descriptive tags under a documented policy; access, approval, expiry decisions, and Axl publication remain governed. Format, source IDs, hashes, and observed media duration are deterministic metadata, not AI judgments.

Support batch review with filters, a concrete preview of affected items, and an audit/reversal path. Descriptive bulk editing does not grant bulk access-policy privileges. Reviewers can lock selected fields; security changes invalidate relevant approval and retrieval state.

## 4. User identity and entitlements

Use Auth0 for authenticated identity and token validation. Decide which existing Portal/CRM/directory system owns each membership before implementing synchronization. Authentication alone does not establish business access. The CMS should not become an accidental second master for firm membership or licensing.

Proposed principal attributes:

- Stable subject ID and active/disabled/pending state.
- User kind: employee, advisor, advisor staff, or approved service identity.
- Firm/office IDs and explicit parent/child delegation where approved.
- Business-line memberships and scoped internal team responsibilities.
- Access-plan entitlement: Basic, Full Active, or other explicitly defined plan.
- Program/cohort memberships and optional start/end dates.
- Signature-status entitlement, represented explicitly rather than assuming a tier hierarchy.
- Verified credential/affiliation attributes if a business-approved rule requires them.
- Application action roles and their scope.
- Entitlement version and last synchronization time for revocation/cache handling.

Suggested mapping approach:

- Basic/Full Active -> access-plan memberships; do not assume Full Active includes every program or firm.
- AEWM-only -> an explicit reviewed AEWM access bundle; not an organizational superuser.
- Commission Schedules -> a dedicated sensitive-content entitlement.
- Coaching/academy/transformation roles -> program enrollments with scope and expiry.
- Firm-specific exchange roles -> opaque cohort IDs mapped to the correct firm relationship; never infer membership from a person's name or email domain.
- Elite/Legends/Premier -> separate approved membership sets unless the business explicitly approves inheritance.
- Pending/deactivated -> fail-closed account states, regardless of residual memberships.
- MRM/Stakeholder/Case Design/Builder Editor -> review actual responsibilities, then map to scoped actions. Their historical capability sets do not automatically carry forward.

There are substantial Pods hierarchy relationships in the source, including `head_of_hierarchy`. That is a reason to validate firm/agency delegation, not evidence that parent offices should see every child's restricted material.

## 5. Application roles: actions, not audience labels

| Role | Proposed scope |
|---|---|
| Reader | View/search authorized published material; original download only when separately granted |
| Contributor | Create restricted drafts and propose edits within assigned teams; cannot publish or broaden access |
| Content editor | Edit content, accepted taxonomy, summaries, and review queues within assigned scope |
| Content owner | Accountable for currency and recurring review; ownership does not automatically grant publishing or security administration |
| Reviewer/approver | Approve the designated content/version within assigned business/compliance scope |
| Publisher | Release versions that have required approvals and a valid access policy |
| Taxonomy steward | Maintain controlled terms, definitions, aliases, and merge mappings |
| Access administrator | Manage approved permission profiles and authorized membership exceptions, with audit |
| Platform operator | Operate deployment/jobs; infrastructure administration is not a routine reader bypass |

Roles can be combined where appropriate, but regulated or sensitive content should require a separate approver under the agreed workflow. Editors may choose among permission profiles delegated to their team; creating broader profiles, changing sensitive restrictions, or granting memberships requires access-administration authority. Any emergency access is explicit, time-bounded, audited, and excluded from normal reader/MCP behavior.

## 6. Permission sets attached to content

Maintain named, versioned `AccessProfile` records. Editors select understandable profiles instead of assembling raw roles on every upload. Examples to validate with owners:

- AE employee resources, scoped to approved internal groups.
- General advisor resources for designated active plan memberships.
- Annuity advisor resources.
- Life Insurance advisor resources.
- AEWM advisor resources.
- Medicare advisor resources.
- Commission schedules for explicitly entitled users.
- A specific coaching/program cohort.
- A specific firm/office and its explicitly delegated staff.

Each profile defines **who may view**, **who may download originals**, **whether an authorized reader may retrieve it through Axl**, and separately **who may edit/approve/publish**. Axl eligibility is both a content setting and a permission check; a chatbot service identity never substitutes for the caller.

Business-line access is an explicit entitlement gate when a profile requires it. It is independent of `business_lines_discussed`. For example, tagging an annuity webinar with tax planning and Wealth Management improves discovery without granting it to AEWM-only users. Conversely, an approved cross-business resource can have multiple explicitly authorized audience clauses without changing its descriptive tags.

Permission evaluation:

1. Require a valid active principal and permitted content lifecycle/version for the requested operation.
2. Apply mandatory restrictions: tenant/firm scope, effective/expiry dates, explicit deny, revoked membership, required credential/program restrictions, and content/asset confidentiality constraints.
3. Require at least one complete approved grant clause for the action. Conditions within a clause are AND; separate intentionally approved clauses are OR. Do not combine partial matches from different clauses.
4. Original download additionally requires view and an original-download grant. Axl retrieval additionally requires view, published/approved current content, and Axl eligibility.
5. No matching rule, unresolved source policy, missing membership, or stale authorization beyond the allowed freshness window -> deny/restricted intake.

An example external AEWM clause could require active advisor/staff identity AND AEWM resource entitlement AND the approved plan/credential conditions AND any applicable firm scope. A separate internal clause can explicitly allow authorized AEWM employees. This is a proposed shape; neither the actual plan combinations nor credential gates have been approved by this design document.

An editor adding a descriptive business tag never changes a grant clause. An access-profile change has an affected-record preview, explicit authorization, versioned audit, and immediate enforcement. Narrowing access takes effect immediately; widening requires the approved review path.

## 7. Illustrative records

These are hypothetical examples of the proposed model, not assertions about the access rights of specific source items.

**AEWM tax-planning webinar:** topics include tax planning and retirement; format is video plus transcript; brand/series and presenter are entity references. Its selected profile grants approved AEWM audiences and authorized internal staff. Original media download can be disabled while preview/playback and Axl retrieval are permitted. Every transcript passage shares the content restrictions.

**Consumer-facing annuity brochure:** topics describe the annuity/product and use case; intended use is consumer-facing. The record is still delivered only to its authorized advisor audience until a separate public-distribution decision is approved. Download rights can be enabled for that audience after the applicable approval. Consumer-facing is not equivalent to anonymous public access.

**Commission schedule:** type is commission schedule; line/product/carrier are descriptive metadata. Access requires the specific commission entitlement plus any firm or business-line constraints. Axl eligibility defaults off pending explicit approval because these items can be sensitive and time-dependent. An expiry event blocks retrieval even if the vector row has not yet been removed.

## 8. Enforcement and data model

Proposed records: ContentEntry, Asset/AssetVersion, SourceSnapshot, TaxonomyTerm, Entity, ClassificationSuggestion, EditorialDecision, AccessProfile/PolicyVersion, PrincipalMembership, ReviewApproval, ProcessingJob, SearchChunk, and AuditEvent. Use stable source-system/source-ID keys and version/hash associations.

Policy is enforced on server-side Payload/API reads and writes, protected asset delivery, preview/transcript endpoints, index query filters, citation resolution, and MCP tools. Never expose a collection through an unrestricted backend identity merely because the frontend hides a button. Validate all alternate API paths and field-level writes that could modify access or publication.

Deduplicated assets preserve each content relationship's policy. If the original asset itself has confidentiality restrictions, those remain mandatory across all relationships. Granting access to one article cannot expose a stricter article's description or unrelated assets. A generated summary combining sources must be scoped to readers authorized for every included source, or generated per authorized source set.

Use a durable outbox for content/policy/version events and idempotent index updates. Apply current authoritative permissions at query/citation delivery so eventual index cleanup cannot leak revoked content. Cache keys include principal/entitlement and content/policy versions; define a maximum authorization-staleness window. Short-lived object URLs still survive until expiry; use proxy delivery when immediate revocation is required.

Index original passages alongside accepted metadata. Store generated questions/summaries as clearly identified enrichment, not primary factual evidence. Reader MCP can expose `search_content`, `get_content`, and `get_citation` with caller-scoped authorization. Any download capability checks its distinct grant. Editorial tagging/write MCP requires separate scopes, validation, and audit; retrieved text cannot invoke it as an instruction.

## 9. Decisions to settle in the pilot

1. Which system owns firm/office hierarchy, active status, plans, programs, signature status, and credential verification?
2. Which business lines truly require a hard gate, and which general resources intentionally cross those boundaries?
3. Does Full Active imply any other entitlement? Do signature tiers inherit? Default proposal: no implicit inheritance until documented.
4. What delegated access should advisor staff/sub-advisors have, and can any parent firm administer child access?
5. Who owns each profile and approves access widening, compliance publication, and exceptions?
6. Which classes require original download disabled, Axl disabled, shorter review cycles, or explicit expiry?

Proceed with source mapping and restricted pilot records while these are resolved. Do not choose permissive answers on behalf of stakeholders. Validate positive/negative users for each profile, crossed firm/LOB/program cases, multi-role users, pending/deactivated accounts, direct asset routes, search/citations, and mid-session revocation before release.
