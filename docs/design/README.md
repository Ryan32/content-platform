# AE Library — design handoff

**Implementing this?** Start with [`IMPLEMENTATION.md`](IMPLEMENTATION.md): every mockup screen, what is built at `f59acd9`, what is left, and the data model still needed. Screenshots are in [`mockups/screens/`](mockups/screens/).

Status: **proposed design, ready to build in phases.** Checked against `main` at `85c9fe1` (pulled 2026-11-18). Part of it is already built; see “Reconciling with main” below.
Source of truth for visuals: the Design canvas "AE Library — design" (https://claude.ai/artifact/WSPghuYiqQxgKwJrt7JENq, private to Ryan until shared). Every screen exists in dark; Home, Browse, Carrier, Section, Category and How-to also exist in light.

## What's in this folder

| File | Use |
| --- | --- |
| `README.md` | This brief: decisions, screen-to-route map, data model changes, build phases with acceptance checks |
| `ia-and-governance.json` | Machine-readable seed: the six sections, their topics, “pages you know”, WordPress category → section rules, content types, filters, review windows, expiry and approval rules |
| `ae-tokens.css` | AE Portal tokens as CSS variables for dark (verified) and light (draft), section colours, type scale, spacing, radii, AXL float animation |
| `assets/axl-books.png` | Floating AXL for Home (transparent, 520 px; ask design for a 2× original) |
| `assets/axl-mark.svg` | AXL head mark (from the AE Portal design system, gradient restored) for the search box |

## Reconciling with main (`85c9fe1`)

Built on the other track since the mockups started (see `docs/STATUS.md`). The build should extend this work, not replace it:

| Already in `apps/platform` | What the design adds or changes |
| --- | --- |
| Portal-aligned reader from real Portal **light** screens: navy sidebar, white top bar, Portal blue `#3d5af1`, Auto/Light/Dark switch shared with admin | Top-bar layout with Browse instead of the sidebar (**decision G**). Sections, carrier pages, saved views and how-to articles. Dark palette from the design system. |
| Reader grid of 16:9 cards with real thumbnails and a List toggle | Same pattern. Add section/type badges and the Type filter. |
| Ranked PostgreSQL full-text search | Header type-ahead, page scope chip, AXL answer with citations |
| Admin polish in Payload (`custom.css`), publish checklist, cover image, bulk add, audiences, people invites, AutomationSettings, worker | Manage screens (what needs you, due for review, review policies) and review windows/expiry. This settles **decision A** toward extending Payload admin. |
| Thumbnails pipeline (PDF, Vimeo, cover upload) | Viewers: slides/sheet/audio, view-only copies, open-at-citation |

## Decisions captured in the design

1. **Navigate by what advisors do, ordered by real use** (1.26M lifetime views across 3,827 WordPress downloads): Products & Carriers, Forms & Operations, Marketing & Seminars, Planning & Advanced Markets, Coaching & Training, Events, plus News.
2. **One search box per page.** It sits in the header and picks up the current page (“in Allianz”). Home hides it and uses the large box under AXL instead. Typing a known title jumps straight to it (44% of views are lookups); questions go to AXL with numbered citations.
3. **Carriers get pages.** Everything about one carrier sits in one place, grouped by task. 25% of views are tied to a carrier.
4. **Familiar pages stay as saved views.** The eight old mega-menu trees collapse into a Browse menu: sections on the left, with “Pages you know” for each. Old WordPress URLs redirect to the matching saved view.
5. **Line of business, licensing, client-ready, format, carrier, program and type are filters, not menus.** Licensing is applied automatically from the user's profile.
6. **How-to articles are a content type, not a section.** They use the same sections and topics as everything else, are shown with an outlined “How-to” badge, and can be filtered in or out. There are no extra categories to manage.
7. **Apps** (ChatAE, AE Portal, Leaderboards, Retirement Analyzer) move out of the content menus into an Apps launcher.
8. **Every item has a review window.** When it lapses without review, the item is hidden from readers, search, MCP and AXL until someone confirms it. AI proposes changes and a person always approves.
9. **One AssetViewer** for every format. View and download are separate permissions, and every viewer can open at an exact page, slide, cell or timestamp.

## Screen → route map (proposed)

| Canvas board | Route | Notes |
| --- | --- | --- |
| Reader · Home | `/` | Hero ask + six section tiles + AE Today + Most used + Bulletins + Picked for you |
| Browse menu | header component | Sections rail, Topics, Pages you know, promo, Popular, A–Z |
| Search suggestions | header component | Carrier match, top documents, how-to articles, pages, “Ask AXL” |
| Carrier page | `/carriers/[slug]` | Groups: Pay & product, Apply & submit, Service in-force, Underwriting, How-to, Clients & planning |
| Section | `/[section]` and `/[section]/[topic]` | Kits, Type/Audience/Format/LOB/Program/Updated filters, grid/list |
| Familiar category | `/c/[legacy-slug]` | Saved view with original name and sub-tabs, plus a 301 from the WordPress URL |
| AI search & answer | `/search?q=&type=` | Answer with citations, Everything / Resources / How-to switch |
| Resource + viewers | `/resources/[id]` (`?citation=`) | PDF, video, slides, spreadsheet, audio, image; Ask-about-this panel |
| How-to article | `/resources/[id]` (type = howto) | Section-scoped “More in …” rail, heading anchors, Copy link, On this page |
| Manage · Home / Add / Content / Due / Policies / Approve | `/manage/*` | Plain-language editor workspace (see decision A below) |

## Data model changes (Payload)

- `content`: add `type` (`resource` | `howto`), `slug`, `section`, `topics` (taxonomy), `carriers` (taxonomy `entity`), `thumbnail` (asset), `owner` (user or team), `reviewPolicy` (relation), `nextReviewAt`, `lastReviewedAt`, `lastReviewedBy`, and `howtoBody` (Lexical with Callout, Steps and Screenshot blocks). Keep the existing `availableAt`/`expiresAt`, `accessProfile` and evidence fields.
- New collections: `review-policies` (the windows in the JSON), `saved-views` (familiar pages: name, filters, legacy URL), `kits` (curated bundles, AI-drafted and editor-approved).
- `taxonomy.dimension`: add `section` and `carrier` (or reuse `entity` for carriers).
- `processing-jobs.stage`: add `thumbnail`, `convert` (Office → PDF), `chapters`, plus a scheduled `review-sweep` that sends reminders and hides lapsed items **and removes them from the search/MCP index**.

## Build phases

Each phase ends with `npm run typecheck`, `npm test`, `npm run build` and an update to `docs/STATUS.md`, per `AGENTS.md`.

**P0 — Foundation.** Import `ae-tokens.css`, add a theme switch (`data-theme`), and build the shell: single-row header with Browse, News, scoped search, Apps, Saved and Manage. Decide the font (decision B).
*Done when:* the existing reader pages render in the new shell in both themes, keyboard focus is visible, and there is no layout break at 390 px.

**P1 — Navigation and discovery.** Seed sections, topics and saved views from `ia-and-governance.json`. Build Home, section and topic pages, carrier pages, the Browse menu, search with type-ahead, and filters. Add 301 redirects from WordPress URLs.
*Done when:* each of the top 10 items on the navigation board is reachable within 2 clicks or 1 search, and the filters respect licensing server-side.

**P2 — Viewers.** One AssetViewer with these libraries: PDF.js (already a dependency), Gotenberg to convert Office files to PDF in the worker, SheetJS, the Vimeo Player SDK, wavesurfer.js, and an image zoom component. Also build the view-only copy deferred in ADR-026.
*Done when:* view-only users never receive original bytes, and citation links open at the correct page or timestamp.

**P3 — How-to articles.** Lexical blocks, a reading layout, heading anchors, Copy link (Clipboard API with a toast), On this page, and the section-scoped “More in …” rail.
*Done when:* links to pages and to sections survive edits, and pasted screenshots upload as assets.

**P4 — Manage.** Home (what needs you), Add content (upload, AI fills the details, the user checks them, approval routing), Content list, Due for review (bulk renew/snooze), Review policies, and Approve AI suggestion (existing `/review`).
*Done when:* a lapsed item disappears from the reader, search, MCP and AXL, and comes back after renewal.

**P5 — AI.** AXL answers with citations in search and on resources, AI-drafted kits, “Picked for you”, and AI labeling of the 5,040 imported items (audience 29% missing, licensing 66% missing). All of it goes through human review.

## Open decisions

- **A. Where Manage lives.** Main already extends Payload admin with custom views and `custom.css`. Recommended: keep doing that, and build the Manage screens as Payload custom views.
- **B. Font.** The design system assumes Inter; `docs/PORTAL-AXL-INTEGRATION.md` says the Portal uses Geist.
- **C. Light theme.** `ae-tokens.css` now uses the light palette main already ships. Update the AE Portal design system's drafted light values to match.
- **G. Layout.** Keep the Portal-style navy sidebar (shipped), or move to the top-bar + Browse layout in the mockups. The sections, filters and pages work with either; the mockups chose the top bar to give the Library its own feel.
- **D. Roles.** Can Auth0/Portal roles distinguish advisors from staff (operations, marketing)? This decides whether Home adapts per role.
- **E. Approvers and owners.** The routing in the JSON is a draft; confirm the real teams.
- **F. AXL artwork.** Get a high-resolution transparent export of the book-reading AXL.

## Validate before locking the navigation

Run a tree test with the top 25 tasks, 10 advisors and 10 staff, targeting 80% first-click success. View counts are lifetime totals, so older items are overstated. Use the new Library's analytics (failed searches and unanswered AXL questions) to adjust labels monthly.

## Mockup caveats

Counts on Manage screens, takeaways, kits, transcripts, spreadsheet values and the drawn AE Portal screenshots are sample content. Titles, thumbnails, view counts, menu structure and category data come from the real WordPress scan.
