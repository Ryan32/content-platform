# Active delivery plan: core platform and general MCP

Status: user-directed priority, 2026-11-17. This is an implementation and acceptance plan, not evidence of a running service. AWS deployment is being handled on another laptop; obtain its deployment report before assuming resources exist.

Implementation progress: [application foundation](APPLICATION-FOUNDATION.md) records the local code, ADRs, tests and remaining work. The branded reader frontend is explicitly in scope; only embedded AXL/deep Portal integration is deferred. A local build and synthetic MCP tests do not establish live Auth0 or AWS readiness.

## Scope and delivery order

Deliver one governed content platform with a client-independent, read-only MCP interface. AXL agent development, embedded AXL chat, Portal navigation integration, and conversation sharing are deferred. The [AXL review](AXL-BACKEND-REVIEW.md) and [Portal review](PORTAL-AXL-INTEGRATION.md) retain the findings for later; neither is a dependency for general MCP.

1. **Reconcile AWS foundation.** Confirm actual stacks, environment, HTTPS origin, ECS/Fargate services, mandatory RDS PostgreSQL, one private S3 bucket per environment, queue, secrets, migrations, and operational logs. Preserve `source/`, `content/`, and `processing/` boundaries; temporary expiry applies only to `processing/`.
2. **Core CMS and authorization.** Implement content, assets, versions, accepted taxonomy, AI suggestions, access profiles, source lineage, and processing jobs. Provide editorial/manual updates and a basic authorized reader/detail page. Unknown imported access remains restricted. AXL branding is not a release dependency.
3. **Small ingestion slice.** Import a representative PDF, article, and Vimeo reference. Preserve title, description, relationships and original source IDs. Extract text/captions with page/time evidence; use Transcribe when suitable captions are unavailable. Jobs must be restartable, retryable, observable, and preserve reviewed edits. AI proposes summaries/tags; it cannot grant access or approval.
4. **Authorized retrieval.** Implement exact/keyword and semantic passage retrieval over approved material, initially evaluating PostgreSQL full-text and pgvector. Version the embedding/extraction configuration. Use the same authorization/retrieval service for reader API and MCP; no duplicated assistant-specific corpus.
5. **Remote MCP and Auth0.** Prove protocol and OAuth behavior against synthetic data, then the approved ingestion slice. A generic client must work without Portal context, an AXL backend, or a browser session cookie.
6. **Client acceptance and pilot expansion.** Verify Claude, ChatGPT, and the selected Copilot surface individually. Expand to the existing 200-record pilot only after permission isolation, evidence links, and job recovery pass.

Foundation, schema, and a synthetic MCP fixture can progress independently of bulk media processing. Synthetic tests must not be reported as real document retrieval.

## General MCP interface

Expose an HTTPS `/mcp` endpoint using Streamable HTTP. Prefer stateless handling for the initial read-only tools; if transport sessions are used, bind them to verified principals and never treat a session ID as authentication. Keep the service behind the application ingress with RDS/S3 private. Metadata discovery endpoints must be reachable without an interactive application login; content tools require authorization.

Proposed tools:

| Tool | Behavior |
| --- | --- |
| `search_content` | Bounded query, validated filters, cursor; returns authorized evidence excerpts, titles, content/version/citation IDs, locators and canonical links. |
| `get_content` | Retrieves authorized metadata and bounded article/document/transcript ranges, with related links subject to the same policy. |
| `resolve_citation` | Resolves an exact evidence version and page/section/time after checking current permissions. |

Use explicit schemas and descriptions, read-only annotations, and structured results with a text representation for broad client usability. No SQL execution, arbitrary URL fetching, editorial writes, bulk export, or ACL-management tools in reader MCP. Add optional client-specific `search`/`fetch` adapters only when a tested client feature requires them; they must call the same policy/service layer.

Results distinguish no matches, unavailable evidence, partial results, and service failure. Provide stable reader URLs, not signed storage URLs or credentials. Version-bound citation links must not silently show replacement text. Keep excerpts, original evidence, and AI summaries distinguishable. Reader links require their own sign-in/access checks; MCP authentication is not a browser login cookie.

## Auth0 connection contract

Desired experience: the user adds the platform connector in their AI application, follows an Auth0 browser sign-in/consent flow, then queries content under their own identity. Never ask users to paste passwords or ID tokens into an assistant. OAuth access scopes are coarse capabilities; business permissions are evaluated separately against authoritative memberships and AccessProfiles.

Implement OAuth authorization-code flow with PKCE where applicable, protected-resource metadata, authorization-server discovery, resource/audience binding, and proper challenges. Validate issuer, signature, intended audience, expiry, and required scopes on every protected request. Do not pass a token intended for this resource to another API. These requirements follow the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization); pin and test the supported protocol version during implementation rather than assuming all clients negotiate identically.

Proposed read scopes are `content:search` and `content:read`; neither grants original download, editing, publication, or access to every record. Retrieval additionally requires the record's AI-retrieval permission. That existing permission is client-independent even where historical documents call it “Axl retrieval.” Policy may additionally restrict approved client applications/workspaces for sensitive content.

Configure a dedicated API identifier and appropriate OAuth client registrations per environment. Test the tenant's MCP `resource` parameter compatibility so tokens receive the correct audience. Auth0 documents [Auth for MCP](https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/) and a [resource/audience compatibility issue](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0). Verify enabled tenant capabilities; do not change a shared tenant's default audience to make one client work. Pre-register clients where supported, with exact callback URIs; use DCR or client metadata support only where the selected client/tenant requires and supports it. No blanket dynamic registration or wildcard redirects by default.

Identity resolution uses verified issuer/subject plus authoritative memberships. Client-provided user/firm IDs, descriptive tags, and successful sign-in cannot grant access. Enforce access before evidence is returned, including counts/facets, citations, transcripts, previews, and downloads. A maker's shared connection or admin token cannot stand in for all users. Reject unsupported identity modes instead of silently widening access.

## Client compatibility register

Official documentation checked 2026-11-17. These are integration routes to test, not certifications or proof of tenant enablement. Record exact product, version/plan, workspace, registration method, callback, scopes, and end-user identity evidence in a sanitized test report.

| Client | Documented route | Required validation | Current status |
| --- | --- | --- | --- |
| Claude | Remote custom connector; connections originate from Anthropic infrastructure. [Documentation](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) | OAuth login/refresh, endpoint reachability, two-user separation, tool output and links, organization policy. | Not tested |
| ChatGPT | Custom remote MCP server with OAuth; registration options depend on configuration. [Documentation](https://developers.openai.com/api/docs/guides/custom-mcp-server) | Workspace availability/admin settings, chosen registration flow, tools and citations; separately verify any search/deep-research feature contract. | Not tested |
| Copilot Studio | Existing remote MCP server via onboarding/custom connector; supports Streamable transport and OAuth options. [Documentation](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent) | Actual published channel and end-user credential mode, not only a maker's successful test connection. | Not tested |
| Other Copilot surfaces | “Copilot” is not one client. Microsoft 365 Copilot deployment via an agent and GitHub Copilot require their own supported setup. | Select the intended product/channel and validate independently before claiming support. | Unresolved |

Do not require a localhost-only or VPN-only endpoint for cloud-hosted clients unless their documented connectivity path supports it. Provide reachable HTTPS ingress, authentication, rate limits, payload limits, and sanitized audit logs. Browser CORS configuration alone does not establish cloud-client connectivity or authorization.

## Revocation and external-client boundary

Current publication and access state must override stale indexes and caches. Cache by principal/authorization context; invalidate on access changes. Record principal, approved client, tool, content/version IDs, policy decision, request correlation, and timing without tokens or raw private excerpts.

Revocation prevents subsequent platform retrieval and reader access. It cannot guarantee deletion of excerpts or generated answers already stored by Claude, ChatGPT, Copilot, or another external client. Select approved workspaces/data-handling policies accordingly and return bounded evidence. Do not promise universal remote history deletion. This limitation differs from future AXL-owned history, which we may be able to reauthorize before serving.

## Acceptance gates

- Protocol: initialize, tools discovery/calls, pagination, stable result schema, malformed inputs, rate limits, reconnect and timeout behavior.
- Identity: unauthenticated challenge; valid OAuth flow; wrong issuer/audience/signature; expired token; insufficient scope; refresh/reconnect; two users; impersonation; maker-versus-end-user identity in published Copilot.
- Permissions: two firms/LOBs, unknown/deactivated memberships, view-without-AI-retrieval, view-without-original-download, stale-index revocation, shared citation URLs, no leaked title/count/snippet/asset bytes.
- Content: actual PDF page and Vimeo time evidence, exact title and paraphrase queries, source-backed answers, missing captions/OCR uncertainty, version replacement and expiry.
- Operations: idempotent imports, failed-job recovery, preserved manual tags, no secrets in logs, migration repeatability, documented backup/recovery checks.

First success criterion: a signed-in user can search real approved sample content from an independent MCP client and open a correct evidence link, while another unauthorized user cannot retrieve it. Client acceptance remains separate for each product. AXL may be reconsidered after this core path works.
