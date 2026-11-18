# Portal reader experience and AXL integration

**Deferred:** the user's latest direction is to focus on [core platform and client-independent MCP](CORE-PLATFORM-AND-MCP.md). This document preserves Portal findings and future integration options; neither native Portal integration nor embedded AXL is an initial release requirement.

**Updated direction:** after the user's MCP-first simplification request and review of the newly available backend, the recommended first slice is a standalone branded reader with a content-focused AXL using the existing backend and read-only MCP. See [backend review](AXL-BACKEND-REVIEW.md) for verified capabilities and gaps. Native Portal routes, semantic views, global search, and structured source cards below are optional later work, not initial prerequisites. The earlier backend-unavailable statements describe the first review only.

Status: proposed implementation contract, grounded in a read-only review on 2026-11-17. No application, API, or Portal changes were implemented by this review.

## Recommendation

Build the reader library as a native feature in `portal-v2`, using its existing shell, identity, components, and AXL page framework. Keep Payload as the separate editorial application and content service. Maintain one governed content store and retrieval index; AXL's backend calls that service on behalf of the reader. MCP exposes the same authorized retrieval operations, not a second library or unrestricted CMS CRUD interface.

This extends the [taxonomy/access model](TAXONOMY-AND-ACCESS-MODEL.md). Tags aid discovery; they never grant permission. AWS remains ECS/Fargate, mandatory RDS PostgreSQL, and one private S3 bucket per environment with prefix-scoped access.

## Verified integration points and limits

Reviewed local Portal commit `50016152`. Its local remote-tracking branch was one commit ahead; the checkout also had unrelated untracked files, which were preserved. The current tracked application is React/Vite under `src/`, not the older module-federation layout described by the local untracked `CLAUDE.md`.

Paths below are relative to `D:/source/portal-v2`:

| Evidence | Consequence for this project |
| --- | --- |
| `src/features/ai-assistant/hooks/chat/use-portal-assistant-chat.ts` sends messages, page context, navigation registry, and active view context to the configured AI endpoint's `/chat/messages` | Integrate retrieval behind the existing AI backend; page context helps orient AXL but is not authorization evidence. |
| `src/features/ai-assistant/components/chat/chat-message.tsx` explicitly renders text and tool parts, with other parts falling through | Add explicit source/citation rendering and history support; returning structured source parts alone will not produce citation cards. |
| `src/app/components/auth0/auth-wrapper.tsx` returns raw ID-token claims from the shared token helper | Resolve a dedicated API-token or server delegation contract before connecting Content API. Do not simply accept the existing ID token as an API access token. This observation does not establish how the existing backend validates tokens. |
| `src/context/user/user-context.tsx` models typed/id-scoped roles and permissions, allowed apps, and impersonation; contact ID is optional | Preserve scope boundaries and real/effective identity. A flat list of role strings or a contact ID alone is insufficient. |
| `src/types/portal-routes.ts`, `src/types/portal-pages.ts`, and the assistant's `context/portal-context-provider.tsx` describe allowed pages for both navigation and AXL | Add typed resource pages, access rules, and registry entries. Route visibility is only a coarse gate. |
| `src/view-kit/`, tools catalog view definitions, and card-grid slot summaries expose semantic UI state | Make library and reader views understandable to AXL through explicit state, slots, and actions; do not depend on DOM scraping. |
| `src/features/search/types.ts` normalizes independent providers to internal/external destinations | Add an authorized content search provider to Portal global search as well as a full library search page. |
| `src/styles/tokens.css` defines semantic light/dark tokens; existing component tree supplies reader UI building blocks | Reuse Portal styling and components instead of building a lookalike standalone reader. |
| `src/hooks/api/cache-tiers.ts` allows persistent daily/reference caches | Sensitive content must explicitly use nonpersistent caching and identity-aware invalidation; a catalog-like UI does not justify a persistent reference cache. |

Portal README references a sibling `node-ai-api` checkout. That directory was absent at its documented local path. Server tool registration, existing retrieval/index behavior, MCP transport, token validation, and deployed behavior remain **unverified**. Coordinate that backend review before finalizing tool names or writing an adapter. Local untracked strategy documents are proposals, not proof of implemented capabilities.

## Retrieval contract AXL should consume

Start with three proposed read operations, available through the same service layer to AXL and reader MCP:

1. `search_content`: query plus validated taxonomy/type/date filters, bounded limit, and cursor. Identity comes from verified credentials, never model-supplied user or firm IDs. Support exact title/source-ID lookup alongside lexical and semantic passage search. Evaluate PostgreSQL full-text and vector retrieval against the pilot before choosing ranking weights or another search product.
2. `get_content`: authorized record/version metadata, relationships, bounded passage or transcript ranges, and available actions. This supports follow-up questions and synthesis beyond a search snippet without returning an entire library.
3. `resolve_citation`: authorize access again and resolve a stable evidence reference to its exact content version and page, slide, section, or media time range.

Every search result should contain:

- Stable `contentId`, `contentVersionId`, `assetId` where applicable, `passageId`, and `citationId`. Distinct articles retain distinct permissions even when their assets are deduplicated.
- Title, content type, accepted taxonomy IDs/labels, source provenance, publication/update/effective/review dates when known, and freshness state. Unknown dates stay unknown.
- A bounded source excerpt, clearly separated from AI summary and suggested tags; extractor/transcript provenance and uncertainty where material to the answer.
- A typed locator: PDF page (one-based), slide, article section, or transcript start/end seconds. Capture this during extraction; never invent a timestamp or page after generating an answer.
- A server-produced `portalRoute` and environment-configured absolute `canonicalUrl`. Neither contains a bearer token, signed object URL, private bucket path, or ACL membership list.
- Authorized action flags such as view, original download, and AXL retrieval, computed for the caller. These guide the UI but do not replace enforcement at the action endpoint.

Response metadata identifies contract version, returned count, pagination/truncation, and retrieval status. Counts and facets cover authorized items only. Empty evidence, dependency failure, and incomplete results must be distinguishable so AXL does not confidently infer that material does not exist.

Apply authorization while selecting candidates and recheck current publication/access state before returning evidence. Permission filtering after an unrestricted top-K search alone both harms recall and risks leakage. Reranking and generation may receive only authorized evidence. Index changes must follow publication, expiry, archive, deletion, and access changes; an outdated index cannot override the authoritative record's deny decision.

Use AE synonyms and accepted taxonomy to improve recall, but keep exact product names, document identifiers, and meaningful dates searchable. Group related passages for answers without collapsing distinct parent records. AXL must treat retrieved text as evidence, never instructions to execute tools or change permissions.

## Stable links and citations

Proposed router-relative destinations:

- `/resources` for the library.
- `/resources/:contentId` for the current authorized reader view.
- `/resources/:contentId?citation=:citationId` for exact supporting evidence.

These are new routes, not currently implemented URLs. The citation ID resolves the content/asset version and locator on the server. An updated document must not silently substitute new text for the cited version. If that version is no longer available to the reader, show an unavailable or superseded state; offer a separately authorized current version when appropriate.

Use Portal's base-path utilities to support `/v2/` and preview deployments. Preserve citation query parameters through login and refresh. PDFs open at the cited page; transcript clicks seek the retained Vimeo player when supported and authorized. If player seeking fails, retain the cited transcript/time label and explain playback availability rather than claiming a successful seek.

The existing `navigate_user` client tool supports route resolution and arrival outcomes. Register reader view identity and ensure arrival success reflects the loaded record and requested location, not just a changed URL. Do not register every document as an `open_external_tool` catalog entry.

Extend chat rendering to show trusted, clickable sources with title, locator, and version/freshness context. Test streaming, final messages, history reload, and inaccessible citations. Markdown links can be an interim presentation only if generated from authorized service results. Never let the model fabricate source IDs or substitute arbitrary URLs. Stored chat evidence and summaries also need current-access handling; revoking a document must not leave a newly served transcript/snippet accessible through history or shared conversations.

## Identity and permissions

Before live integration, agree the API audience, issuer, scopes, and delegated-user mechanism with the AI backend. Use audience-scoped access tokens or an explicitly validated server delegation flow; validate signature, issuer, audience, expiry, and subject. Do not weaken validation to accommodate Portal's current ID-token helper. A service credential authenticates AXL's backend but does not give its end user unrestricted content access.

Resolve principal identity using issuer plus subject and authoritative memberships. Preserve scope type and ID for firm/organization/LOB permissions. Client page context, requested filters, Auth0 UI decoding, and AI tags cannot establish membership. Map memberships to the proposed versioned AccessProfiles; unresolved mappings remain restricted intake.

Keep view, original download, edit, approve, and AXL retrieval distinct. In an impersonation session, validate both the real actor and effective principal server-side and audit both; default to blocking editorial/approval operations until explicit impersonation policy exists. Route permission prefixes must be reviewed so a broad Portal scope does not accidentally grant new content actions.

Enforce the same policy on search, metadata, previews, passages, transcripts, citations, related links, exports, and originals. A browser PDF viewer receives the underlying bytes: do not use an original-file PDF URL to implement view-only access. Use approved derivatives where originals are restricted. Viewer controls cannot prevent screenshots or all copying; that is separate from withholding originals.

Partition caches by effective principal, environment, and authorization version; invalidate on logout, impersonation changes, and access changes. Initially avoid persistent browser storage for restricted evidence. Backend caches, model conversation state, and generated answers must not cross principals. Test history authorization separately from link authorization.

## Reader experience matching Portal

Implement a proposed `src/features/resources` feature in Portal, keeping the current sidebar, breadcrumbs, responsive layout, and docked AXL panel. Payload admin remains the editorial workspace; do not expose its administrative screens as the reader library.

- Library: existing card-grid/table patterns, keyword/semantic discovery, accepted taxonomy filters, format/date/freshness indicators, saved filters if warranted, explicit empty/error/loading states, and authorized counts.
- Reader: title, reviewed summary, accepted tags, owner/review information, primary viewer, transcript or extracted-text panel, related authorized material, and separately authorized download action. Show original source provenance without exposing private source locations.
- AXL context: typed PageIdentity/ViewIdentity, selected content/version/citation, filter state, loading/readiness, bounded visible excerpts, and permitted actions. Card-grid summaries are bounded previews, not full-library retrieval. Keep full transcripts out of ambient page context.
- Styling: reuse semantic tokens, Geist typography, existing Radix-based components, Lucide icons, spacing, and light/dark modes. Use LOB treatments consistently without implying that a colored tag grants access.
- Accessibility: keyboard navigation, focus after citation navigation, meaningful page/time labels, mobile reader behavior with AXL open, and clear denied/expired/unavailable states. Validate component states in Storybook and integration tests.

Add resource area/entity definitions and route metadata to the existing closed type registries. Add a global-search provider using the existing SearchHit contract with namespaced IDs to prevent collisions. Export new navigation/active-view fixtures to the AI backend only once that checkout is available and the paired contract is agreed.

## Work sequence and acceptance

1. Review the actual AI backend and agree token delegation, tools, citation parts/history, and fixture versions. Record existing capabilities rather than introducing duplicate retrieval infrastructure.
2. Implement the Content API and ingestion passage schema with restartable source/version IDs and the agreed access resolver. Define the API contract with synthetic fixtures before using private material.
3. Build one vertical slice: one approved PDF and one approved Vimeo transcript, authorized search, cited AXL answer, and exact-location Portal navigation. Keep unresolved source policies restricted.
4. Add Portal library/reader views and global-search provider with shared styling and semantic view definitions. Wire the same retrieval service to reader MCP and keep editorial writes separately authorized.
5. Evaluate against the [200-record pilot and negative controls](WORDPRESS-PILOT.md), then expand ingestion.

Acceptance cases must include exact-title and paraphrase recall, AE terminology, source-backed answers, page/time accuracy, related-material preservation, unknown query/no-evidence behavior, OCR/transcription uncertainty, expired/superseded documents, and failed jobs/retries. Create a human-reviewed query/expected-evidence set; measure retrieval recall and citation correctness before setting quality thresholds. Do not use AI self-scoring as sole acceptance evidence.

Security tests must cover two firms, multiple LOBs, unknown membership, deactivated accounts, view-without-download, view-without-AXL, impersonation, index lag after revocation, cached/history evidence, and citation URLs shared with unauthorized readers. No denied title, snippet, count, or asset bytes may leak. Reruns must preserve reviewed taxonomy and citation/version lineage.

## Implications for the AWS laptop

Continue the selected foundation: ECS/Fargate, RDS PostgreSQL, and one private bucket per environment. This review does not require a second content frontend host, second CMS, or separate vector database. Portal hosts the reader feature through its existing delivery process.

Before wiring applications, coordinate environment-specific Content API origin, Portal origin/base path, allowed browser origins, Auth0 API audience/delegation, service-to-service access, and citation URL configuration. Keep these configurable and credentials in Secrets Manager. Do not claim that infrastructure deployment alone completes the AXL integration. Foundation deployment can proceed independently; connecting live users is gated on the authentication and authorization contract above.
