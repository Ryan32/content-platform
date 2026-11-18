# Research summary and cost qualifications

Research date: 2026-11-17. These are planning findings, not procurement quotes or tested production implementations.

## Shortlist

- **Payload:** MIT core, official MCP plugin, strong alignment with Portal's TypeScript/React stack. Extraction/transcription, reader retrieval, annual governance, and custom Auth0 integration require implementation. Packaged enterprise SSO/workflows are commercial and quote-only.
- **Bloomfire:** closest packaged media-knowledge candidate. Verify BYO transcript import, exact annual-review behavior, editor write tools, audience permissions, and Portal/headless presentation. No verified public dollar price; do not treat agent estimates as vendor quotes.
- **Directus:** current research found v12 MSCL source-available licensing, not unrestricted free OSS at 25 editors. Published Team math was $14,988/year for 25 Studio editors; readers using Portal APIs are distinct from Studio users. Verify current terms before purchase.
- **Sanity:** managed content platform with authoring MCP and Context extraction/retrieval. Context document support is broader than one initial agent reported. Chunk capacity and mixed-audience access controls require validation; media transcription remains a separate pipeline.
- **Document360:** strong article KB and review reminders. Comprehensive Office/media ingestion and custom playback need work. A stale reminder does not automatically remove content from reader access or Axl.
- **Drupal:** true OSS with mature editorial/taxonomy foundations; introduces PHP expertise and contributed MCP maturity considerations.
- **SharePoint:** useful benchmark when existing licenses cover internal users. External presentation, integration, and actual licensing need evaluation.

## Cost model interpretation

Copied CSVs in `docs/research/` preserve the normalized planning model and source register. Assumptions: 25 editors, 3,500 readers, 20k documents/100k pages, 500 GB/1,000 media hours, 20% content growth, $125/hour engineering. These volume assumptions are unverified.

The model includes implementation plus software/infrastructure/technical maintenance allowances. Editorial cleanup, recurring content review, answer-time Axl usage, new identity licensing, taxes, and contingency are separate. Commercial subscriptions without published prices are allowances, not quotes. Initial Payload technology estimate was $134k–272k in year one; do not treat it as the cost of a small local access-validation POC.

The model predates confirmation that much video already resides on Vimeo. Retaining Vimeo means carrying its existing subscription and revising any duplicated video-hosting allowance. Inventory must establish actual duration, storage, viewer traffic, and existing contract costs.

AWS Transcribe's cited batch example was $0.006/minute, or $360 for 1,000 initial hours. Recheck region, current rate, features, and billable units before processing. Source and model assumptions use day-zero corpus plus three full years of growth; agent reports using year-one inventory can yield different cumulative totals.

One research agent proposed very precise low implementation hours and mandatory RAGFlow. Those were not accepted as established facts. Another called a services-only Microsoft bill fully loaded; implementation and maintenance must be added. Do not inherit either error.

## Primary sources

- Payload core license: https://github.com/payloadcms/payload/blob/main/LICENSE.md
- Payload custom auth: https://payloadcms.com/docs/authentication/custom-strategies
- Payload enterprise: https://payloadcms.com/enterprise
- Payload MCP: https://payloadcms.com/docs/plugins/mcp
- Payload deployment: https://payloadcms.com/docs/production/deployment
- Payload migrations: https://payloadcms.com/docs/database/migrations
- WordPress export limitations: https://developer.wordpress.org/cli/commands/export/
- WordPress media API: https://developer.wordpress.org/rest-api/reference/media/
- Vimeo token creation: https://help.vimeo.com/hc/en-us/articles/12427789081745-How-to-generate-a-personal-access-token
- Vimeo authorized file links: https://help.vimeo.com/hc/en-us/articles/12427806914577-About-video-file-download-links-from-the-API
- AWS Transcribe pricing: https://aws.amazon.com/transcribe/pricing/

See `docs/research/source-register.csv` for the broader vendor/source register. Revalidate claims before implementing against a specific released version.
