# AE Library — implementation spec from the mockups

Hand this file to the implementing agent along with [`README.md`](README.md) (decisions, phases), [`ia-and-governance.json`](ia-and-governance.json) (sections, topics, review windows, approvals) and [`ae-tokens.css`](ae-tokens.css).

**Visual source of truth:** `mockups/screens/*.jpg` (rendered at 1440 px wide) and `mockups/html/*.html` (the mockup markup, for exact spacing, sizes and colors; content thumbnails don't load in these files, so use the screenshots for imagery). Board titles and sizes are listed below. Mockup counts, takeaways, transcripts and spreadsheet values are sample data. Titles, thumbnails and view counts come from the real WordPress scan.

**State of the code:** see the status columns below. Sections and review windows are deployed to dev (`904c261`); the Library pages commit needs the deploy steps in `docs/STATUS.md`. Read `AGENTS.md` first: permissions are enforced server-side, AI never grants access, approves, renews or deletes, and secrets never appear in code, logs or chat.

## Decisions already made (do not re-open)

- Layout: Portal-style navy sidebar (Home, "Library" label, six sections; current section expands to topics and "Pages you know"). Collapses to a rail on reading pages. **No "AE apps" launcher** (removed by the owner; ignore it in the mockups). Saved, Manage and Appearance live in the account menu.
- One search, centered in the top bar on every page. Ctrl K / `/` opens the live search window with type chips. No second search box on any page.
- How-to articles are a **content type** (badge + filter), not a section and not a category tree.
- Review windows: Monthly, 3, 6, 12, 24 months, or a set date. Lapsed items are hidden from readers, search, MCP and AXL; editors still see them.
- Light and dark themes via the existing `payload-theme` cookie (Auto/Light/Dark).

## Screen-by-screen

Status at the commit after `c359282` ("Library pages"): ✅ built, 🟨 built with a stated gap, ⬜ not built.

### Reader

| Board | Screen | Status | Route / notes |
|---|---|---|---|
| `Main`, `HomeLight` | Home | ✅ | `/`. Floating AXL, greeting, prompt chips, AE Today (items of type *AE Today story*), Most used (30-day view counts; falls back to familiar pages until there are views), Bulletins (type *Bulletin*), **New in the Library** (newest items; the AI "Picked for you" ranking is P5). Old `/?q=` links redirect to `/search`. |
| `Typeahead` | Ctrl K window | ✅ | Chips All/Documents/Videos/Slides/How-to/Pages. 🟨 "Ask AXL" row waits for AXL answers (P5). |
| `Hub`, `HubLight` | Section page | ✅ | `/sections/[id]`: topic pills, Ready-made kits row, filter rail (Type, Audience, Format, Line of business, Program, Updated), Most useful/Newest sort, grid/list, save on cards, item count. |
| `Category`, `CategoryLight` | Familiar page | ✅ | `/sections/[id]?page=…` with its own header. 🟨 page-specific sub-type pills (Intros/Openings/…) would need sub-topics. |
| `Carriers`, `CarriersLight` | Carrier page | ✅ | `/carriers` (A–Z with line-of-business filter) and `/carriers/[slug]`: logo tile, quick actions, groups (How-to, For clients, Pay & product, Apply & submit, Service, Life underwriting, More), related updates, carrier rail. 🟨 logo images (initials tile for now). |
| `Search` | Results | ✅ | `/search`: tabs All/Documents/Videos/Slides/Client-ready, Everything/Resources/How-to toggle, result rows with thumbnail, chips and save. 🟨 AXL answer panel is P5. |
| `Resource` | Resource detail | ✅ | Header with image, chips, Download/Save/Copy link; Key takeaways (from accepted AI suggestions, "Reviewed by an editor"); Part of these kits; More in topic; Details (audience, licensing, line, program, owner, last reviewed, review window). 🟨 "Ask about this" is P5. |
| `KB`, `KBLight` | How-to article | ✅ | Left rail "More in topic" with type tabs, callouts (`>`), numbered step badges, heading anchors with copy link, Copy link/Save/Print, On this page, Page details, "Was this helpful?" and "Suggest an edit" (stored in Reader feedback). 🟨 pasting screenshots in the editor. |
| `ViewerPDF`, `ViewerPDFLight` | PDF | ✅ | PDF.js: page nav, zoom, thumbnails, find in document, opens at the cited page. 🟨 view-only rendered copies and watermark (ADR-026); inline view still needs download permission. |
| `ViewerVideo` | Video | ✅ | Vimeo with transcript that follows playback (Vimeo postMessage API), click to jump, transcript search, "Link at mm:ss". 🟨 chapters. |
| `ViewerSlides` | Slides | ⬜ | Needs Gotenberg (Office → PDF) in the worker; then slides reuse the PDF viewer. |
| `ViewerOther` | Sheet, audio, image | 🟨 | Image zoom; audio/video with speed, skip and synced transcript. Spreadsheet grid needs SheetJS (verify package source/licence) or a Gotenberg PDF. |

Also built: `/saved`, `/news`, `/kits/[id]`; Saved items and News in the account menu.

### Manage (admin)

| Board | Screen | Status | Route / notes |
|---|---|---|---|
| `AdminDashboard` | Manage home | ✅ | `/admin` (replaces Payload's dashboard): need cards, Coming up for review with Still accurate, Library at a glance, Recently added. |
| `AdminCreate` | Add content | ✅ | `/admin/add-content`: 1 Upload (file, Vimeo, or write a how-to) → 2 Check AI details (accept AI summary/takeaways/tags; section, topics, pages, audience, licensing, line, program, carriers) → 3 Access & review (access profile admin-only, window suggested from filing, owner, approval route) → 4 Publish (checklist; administrators publish). |
| `AdminContent` | Content list | ✅ | `/admin/library`: status chips, title/section/format filters, status pills, window, next review, owner. Bulk edit links to the full Payload table. |
| `AdminDue` | Due for review | ✅ | `/admin/due-for-review`: chips with counts, bulk renew/snooze 7 days/archive (admin), per-row Still accurate and Upload new version. 🟨 email reminders 30/14/3 days (no mail service configured). |
| `AdminPolicies` | Review policies | ✅ | `/admin/review-policies`: windows with counts and default content, end-of-window rules, approval routing, AI switches (read from Automation settings; "Publish without human approval" always off). |
| `Review` | Approve AI suggestion | ✅ | Existing `/admin/review`; accepting now also installs Key takeaways. |

## Data model (added in migration `20261119_011841_library_pages`)

- Content: `kind` gains *AE Today story* and *Bulletin*; descriptive filters `audience`, `licensing`, `lines`, `program`; `carriers`; `takeaways`; `snoozedAt`. Filters never grant access; access stays in access profiles and `publishedWhere`.
- Collections: `carriers`, `kits`, `saved` (hidden), `feedback` (Reader feedback).
- Table `content_views (content_id, user_id, day)`: one row per person, item and day, for Most used and the Most useful sort. Counts only are shown.

## Still to build

1. Gotenberg conversion in the worker (Office → PDF) for slides, Word and spreadsheets; then a slides presenter view.
2. View-only rendered copies and watermark, so view-only readers can see previews (ADR-026).
3. Review reminder emails at 30, 14 and 3 days (needs SES or the existing mail path).
4. Screenshot paste/upload in the how-to editor; consider Payload Lexical rich text.
5. Carrier logo images; page-specific sub-type pills on familiar pages; video chapters.
6. AXL (P5): answers with citations in search and the Ctrl K window, "Ask about this" on resources, AI "Picked for you", over reviewed and authorized evidence only.

Each step ends with `npm run typecheck`, `npm test`, `npm run build`, a migration rehearsal on PostgreSQL 16, updates to `infra/aws/library/migrate.js` `EXPECTED` and the web/worker/smoke schema checks, and a `docs/STATUS.md` entry.
