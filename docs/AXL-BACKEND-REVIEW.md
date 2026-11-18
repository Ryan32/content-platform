# AXL backend reuse review

Reviewed 2026-11-17: `D:/source/node-ai-api`, commit `94a8d02d1bccad2c121eb1f707c44f17c8dff521`. Read-only source review; clean checkout before and after. No dependencies installed, services started, model calls made, or runtime tests executed. Secrets and local databases were not read.

## Recommended scope

**Deferred by user direction:** retain all findings below for a later revisit. The active milestone is [core platform and general MCP](CORE-PLATFORM-AND-MCP.md), with no dependency on an AXL agent, branded chat, Portal changes, or AXL's authorizer. The recommendation below describes a future option, not the next implementation task. Revisit after independent MCP clients pass authorization and evidence-link tests; refresh both repo snapshots and recheck the external authorizer, MCP cache isolation, agent entry points, conversation boundaries, and frontend/backend streaming compatibility then.

Use a standalone content frontend with AXL branding and reused Portal visual components. Connect its chat to the existing AI backend through a new proposed `content-library-assistant` agent. That agent calls the content platform's read-only MCP service. Portal AXL can use the same MCP adapter later.

This is now the recommended first slice, replacing the earlier recommendation to first build a native Portal resource feature. Deep Portal navigation, semantic view integration, global search, and structured citation cards are optional later enhancements. Start with service-generated clickable links in answers. This direction is a proposal based on the user's request to simplify integration and explore a branded AXL on the content platform.

Reuse the existing backend deployment if its owners approve the new application; do not assume an additional AI backend or vector store must be provisioned. The content service remains ECS/Fargate with RDS PostgreSQL and one private S3 bucket per environment. Do not move or duplicate the existing Lambda AI service just to host the reader application.

## Verified source evidence

All code paths in this table are relative to `D:/source/node-ai-api`.

| Capability | Evidence | Assessment |
| --- | --- | --- |
| Multiple agents with separate instructions/tools | `src/ai/agent/types.ts`, `AgentRegistry.ts`, `service/AgentService.ts` | Already supported in code. Agent definitions support async per-call tools, instructions, model and step limits; database overrides exist. A library agent is a small code addition, not just a branding setting. |
| Existing Portal agent | `src/ai/agent/agents/portal/PortalAgent.ts`, `tools/portalTools.ts` | `portal-assistant` offers Portal navigation, forms, CRM, drafts, and favorites. Reuse shared infrastructure, not that entire tool roster for the library. |
| Existing content agent | `src/ai/agent/agents/content/ContentAgent.ts` | `content-creator` is a presentation generator. It is not the governed library assistant; avoid a naming/function collision. |
| Remote MCP client | `src/ai/mcp/MCPClientManager.ts` | Supports HTTP/SSE transports, headers, discovered tools, cached clients, and invalidation. The content MCP server and its adapter still need implementation. |
| Caller context for chat | `src/chat/runner/agentCallContext.ts` | Client context is spread first; server user data, incoming authorization header, thread and event override it. This is the appropriate starting path for chat integration. |
| Authentication boundary | `config/authorizer.yml`, `src/utils/helpers.ts` | API configuration references an external Auth0 authorizer Lambda. Local helpers decode JWT payloads; that is not signature validation. The external authorizer implementation and deployed audience/issuer rules were not reviewed. |
| Conversation ownership | `src/chat/service/ThreadService.ts` | Existing-thread lookup includes ID and user ID. This is useful ownership protection but does not establish firm/LOB content policy or application isolation. |
| Application context | `src/chat/thread/model/Thread.ts`, `src/chat/context/ChatContext.ts` | Source types are `chat`, `portal`, `api`. Existing lookup does not bind the thread to a source/agent; thread agent is used only when request agent is absent. A client-supplied source label is not an authorization boundary. |
| Citation streaming | `src/chat/runner/runners/AgentChatRunner.ts` | Agent stream explicitly uses `sendSources: false`. Structured citation UI would require backend and frontend changes; ordinary trusted markdown links avoid that dependency for the first slice. |
| Generic agent endpoint | `src/ai/agent/handler/agent-run.ts` | Spreads body context and overwrites user ID, but does not similarly replace every credential/event field. Do not expose a protected content agent through this path without hardening its context and agent authorization. Prefer the existing chat path for the pilot. |

The earlier Portal source review found AI SDK 6 frontend dependencies; this backend declares AI SDK 7. This is a streaming compatibility test requirement, not proof of a defect. Reusing the frontend still needs a real stream/tool/history test.

## Small additions required

1. **Library agent and MCP adapter.** Add an agent with AXL's brand/voice, evidence-first instructions, and an explicit allowlist of `search_content`, `get_content`, and `resolve_citation`. Discovering MCP tools does not authorize exposing every discovered tool. Disable unrelated shared tools for this initial agent. Register the agent in the appropriate entry points and authorize callers to use it server-side.
2. **Delegated content identity.** Agree access-token or signed server delegation with the external Auth0 authorizer owner. The MCP service validates credentials and resolves authoritative firm/LOB/action permissions. Do not blindly forward Portal's ID token to a different audience, accept unsigned user headers, or treat the existing internal/external role as content entitlement.
3. **Safe MCP lifecycle.** The manager reuses a client by caller-supplied key for up to 15 minutes and does not compare new transport headers on cache hit. A single global content-client key would be unsafe with user-specific credentials. Initially use request-scoped clients with guaranteed cleanup, or design keys and expiry/invalidation around verified principal, environment, effective identity, and credential version. Never put raw tokens in keys because keys are logged. A tool call must fail closed on expired/revoked credentials.
4. **Conversation boundaries.** Define an application namespace for the new UI and enforce it on create, list, read, resume, summaries, and agent selection. Do not silently reuse Portal threads. Reject an incompatible agent/source/thread combination. Check other entry points cannot bypass the library agent's restrictions. Content permission changes must also govern saved evidence and summaries before they are returned to a user or model.
5. **Branded chat frontend.** Reuse Portal's visual tokens and chat building blocks, adapting Portal-specific providers/hooks. Configure the new agent ID and endpoint; render authorized service-generated source links. Keep ordinary library/reader pages independent of the chat implementation. Sharing code does not mean the existing panel can be dropped in without extracting dependencies.

The content MCP server owns ingestion-derived passages, retrieval, canonical links, and current authorization. Existing backend RAG code is not evidence that it already indexes this library or enforces its AccessProfiles. Avoid a second copy of the corpus in AXL's chat-upload index.

## Acceptance before live content

Use synthetic fixtures first, then one explicitly approved PDF and Vimeo transcript. Verify:

- The library agent discovers only the allowed tools, retrieves evidence, and links to the correct document page/media time.
- Answers stream and tool results survive history reload with the chosen frontend/backend versions.
- Two users, two firms, denied LOBs, and impersonation cannot share credentials, results, histories, or cached tools across boundaries.
- Request body overrides of user, token, event, agent, source, and thread cannot escalate access through chat or other agent endpoints.
- Token refresh, MCP reconnect, timeout, and expired credentials produce correct failure/retry behavior without leaking credentials in logs.
- Revoked/expired content is denied through new retrieval, old links, and newly served chat/history/summary context.

The source review establishes that reuse is practical. It does not establish deployed authentication correctness or successful live MCP connectivity. Next implementation work is the synthetic MCP vertical slice and dedicated library agent, followed by the branded frontend. No broad Portal rewrite is required.
