# AE Library — implementation spec from the mockups

Hand this file to the implementing agent along with [`README.md`](README.md) (decisions, phases), [`ia-and-governance.json`](ia-and-governance.json) (sections, topics, review windows, approvals) and [`ae-tokens.css`](ae-tokens.css).

**Visual source of truth:** `mockups/screens/*.jpg` (rendered at 1440 px wide) and `mockups/html/*.html` (the mockup markup, for exact spacing, sizes and colors; content thumbnails don't load in these files, so use the screenshots for imagery). Board titles and sizes are listed below. Mockup counts, takeaways, transcripts and spreadsheet values are sample data. Titles, thumbnails and view counts come from the real WordPress scan.

**State of the code at `f59acd9`:** the items marked ✅ are in `main` but **not yet deployed to dev** (dev runs `657e4d0`). Everything marked ⬜ is not built. Read `AGENTS.md` first: permissions are enforced server-side, AI never grants access, approves, renews or deletes, and secrets never appear in code, logs or chat.

## Decisions already made (do not re-open)

- Layout: Portal-style navy sidebar (Home, "Library" label, six sections; current section expands to topics and "Pages you know"). Collapses to a rail on reading pages. **No "AE apps" launcher** (removed by the owner; ignore it in the mockups). Saved, Manage and Appearance live in the account menu.
- One search, centered in the top bar on every page. Ctrl K / `/` opens the live search window with type chips. No second search box on any page.
- How-to articles are a **content type** (badge + filter), not a section and not a category tree.
- Review windows: Monthly, 3, 6, 12, 24 months, or a set date. Lapsed items are hidden from readers, search, MCP and AXL; editors still see them.
- Light and dark themes via the existing `payload-theme` cookie (Auto/Light/Dark).

## Screen-by-screen

### Reader

| Board | Screen | Status | What's left |
|---|---|---|---|
| `Main`, `HomeLight` | Home | ⬜ | Current `/` is still the old "Content library" grid. Build: floating AXL (`assets/axl-books.png`, gentle float animation, respects `prefers-reduced-motion`), "What can we help you find, {first name}?", 3 suggested-question chips that open search, **AE Today** (news: needs a `news`/bulletin flag or kind + published date), **Most used** (needs view counting, see Data below), **Bulletins**, **Picked for you** (start with recent items in the reader's sections; AI later). Move the existing full list to `/browse` or drop it. |
| `Typeahead` | Ctrl K window | ✅ | Built: live authorized results, chips All/Documents/Videos/Slides/How-to/Pages, keyboard nav. Left: "Ask AXL" row (Tab) once AXL answers exist; "in {section}" scope pill when opened from a section. |
| `Hub`, `HubLight` | Section page | 🟨 partial | Built: header, topic pills, type tabs, card grid, Pages you know, pagination. Left: **left filter rail** (Type: Resources/How-to; Audience: Advisor-facing/Client-ready; Format; Line of business; Program; Updated) — needs `audience`, `lineOfBusiness`, `program` fields; **Ready-made kits** row (needs a `kits` collection: a named bundle of items); sort (Most useful/Newest); grid/list toggle; save (bookmark) button on cards; item count "1,786 resources · showing what your licenses allow". |
| `Category`, `CategoryLight` | Familiar page ("Recorded Seminars") | 🟨 partial | Built as `/sections/[id]?page=`. Left: hero header with "Part of {section}" note, sub-type pills (Full seminars/Intros/Openings/Main content/Closings → a per-page `subtype` tag or topic children), sort, "Show more". |
| `Carriers`, `CarriersLight` | Carrier page (Allianz) | ⬜ | Needs a `carriers` collection (name, logo, lines of business, slug) and a `carriers` relationship on content. Page `/carriers/[slug]`: logo header, quick actions (Commission schedule, Sample application), groups: Pay & product, Apply & submit, Service in-force business, Life underwriting, How-to articles, For clients & planning, Related updates. Left rail: carrier list with counts + line-of-business tabs (All/Annuity/Life/Medicare/AEWM partners). "Carriers A–Z" topic links here. |
| `Search` | Full results + AI answer | 🟨 partial | `/?q=` gives ranked results. Left: AXL answer panel with numbered citations and follow-up box (P5, behind human-reviewed evidence only), "Turn into a kit", tabs All/Videos/Scripts & templates/Guides/Client-ready, Everything/Resources/How-to toggle, result rows with thumbnail + section chip + meta. |
| `Resource` | Resource detail | 🟨 partial | Built: header with section eyebrow, copy link, viewer, summary, full text, info, files, More in section. Left: **Key takeaways** ("Reviewed by an editor" — from accepted AI suggestion), Save, Add to kit, "Also in" breadcrumb, **Part of these kits**, **Ask about this** panel (AXL, P5), Details list (Audience, Licensing, Program, Format, Owner) once those fields exist. |
| `KB`, `KBLight` | How-to article | 🟨 partial | Built: Markdown body, heading anchors with copy link, On this page, More in section, copy page link. Left: left rail "More in {topic}" with All/How-to/Resources tabs; callout boxes (`> **Note**` style); numbered step blocks; inline screenshot upload in the editor (paste/drag → asset → `![](/files/id)`); annotated screenshot markers (1, 2, 3); Save, Print; Page details (Owner, Last reviewed, Review, Audience); "Was this helpful? Yes/No" + "Suggest an edit"; toast "Link copied". Consider replacing the textarea with Payload's Lexical rich text for authors. |
| `ViewerPDF`, `ViewerPDFLight` | PDF viewer | 🟨 partial | Built: PDF.js, page nav, zoom, opens at cited page, open in new tab. Left: thumbnail strip, in-document find, highlight the cited passage ("AXL cited this row"), side panel tabs Ask AXL / Takeaways / Details, light watermark "Viewed by {name} · {date}" for view-only readers, **view-only rendered copy** so view-only users never receive the original (ADR-026; today inline view still requires download permission). |
| `ViewerVideo` | Video | 🟨 partial | Built: Vimeo embed starting at a cited time. Left: chapters row, transcript panel synced to playback (Vimeo Player SDK `@vimeo/player`), "Link at 05:48" copy, transcript search. Transcripts already come from captions/Transcribe in the worker. |
| `ViewerSlides` | Slides | ⬜ | Gotenberg (LibreOffice) in the processing worker converts PPTX/DOCX → PDF; render slides one at a time with notes, grid view, filmstrip, Present (full screen). |
| `ViewerOther` | Spreadsheet, audio, image | 🟨 partial | Built: image zoom, native audio/video players. Left: read-only spreadsheet grid (SheetJS; check the package source and license before adding, the npm registry copy is outdated), audio waveform (wavesurfer.js) with transcript, image "Customize in Print on Demand" link. |
| `ViewerStack` | Viewer rules | reference | The library choices and access rules for all viewers. |
| `IA` | Navigation evidence | reference | Why the six sections exist; top-10 items and where they live. |

### Manage (admin)

The Manage boards use their own left menu (Home, Content, Due for review, AI suggestions, Review policies, Sections & tags, People & access, Processing) and an **Add content** button. Build them as Payload custom admin views (decision A in the README), restyled with `custom.css`.

| Board | Screen | Status | What's left |
|---|---|---|---|
| `AdminDashboard` | Manage home | ⬜ | "Good morning, {name}" + three cards (items reaching review in 30 days / new uploads ready to approve / uploads needing attention), Coming up for review with **Still accurate** buttons, Recently added by your team, Library at a glance counts, AI clean-up progress. All counts are queries on existing data. |
| `AdminCreate` | Add content wizard | ⬜ | 4 steps: Upload → Check AI details → Access & review → Publish. Step 2 shows each field with an "AI suggested" marker (title, summary, section, format, who it's for, licensing, topics, search keywords) and a "What AI did" checklist. Reuse the existing upload + processing + suggestion pipeline; the wizard just presents the pending suggestion inline instead of on `/admin/review`. Approval routing from `ia-and-governance.json` (client-ready → Compliance then Creative Services, etc.). |
| `AdminContent` | Content list | ⬜ | Table: thumbnail, title, section, status pill (Live / Needs approval / Hidden — review due / Due in N days / AI is transcribing / Draft), review window, next review, owner. Filter chips All/Live/Needs approval/Due soon/Hidden/Drafts/Mine; Section/Owner/Format dropdowns; Bulk edit. |
| `AdminDue` | Due for review | 🟨 partial | Built: `/admin/due-for-review` with hidden + due-in-30-days tables and Renew (owner/admin only, set-date items need a new date). Left: chips All due / Hidden now / Next 7 days / Next 30 days / Snoozed; checkbox **bulk renew**; **Upload new version** and **Archive** actions; **Snooze 7 days**; AI hint per row ("Not changed since Oct 2026", "A newer version may exist") — AI only flags, never renews; **email reminders 30/14/3 days before** (needs SES or the existing mail path; none configured today). |
| `AdminPolicies` | Review policies & AI settings | ⬜ | Cards for each window with the content types it applies to (from `reviewWindows[].defaultFor`), "When a window ends" rules, "Who approves" routing, "What AI handles" toggles (map to existing Automation settings; "Publish without human approval" is shown **off and locked**). New content gets its default window from its format/type automatically. |
| `Review` | Approve AI suggestion | ✅ exists | `/admin/review` already does this; restyle to match (proposed vs current summary, tag evidence bars with page refs, source evidence accordions). |

## Data model still needed

All additive Payload fields + one migration per slice. Keep `publishedWhere` as the single visibility filter.

- `audience` select: advisor-facing / client-ready. `licensing` select hasMany: insurance / investment (IAR-RIA). `lineOfBusiness` hasMany: annuity, life, wealth, medicare, high-net-worth. `program` relationship or select. These are **descriptive filters, not access** — access stays in access profiles.
- `carriers` collection + `content.carriers` relationship.
- `kits` collection: title, description, ordered items, section, owner, review window.
- `news` flag or `kind: 'bulletin'` with a publish date for AE Today / Bulletins.
- `keyTakeaways` (array of text) accepted from AI suggestions in Review.
- View counting: an append-only `views` table (content id, user id, day) written by the resource page; "Most used" = 30-day counts filtered by the reader's authorization.
- Saved items: `saved` (user, content) for the bookmark buttons and the Saved menu entry.

## Build order (suggested)

1. Home (with AE Today/Bulletins/Most used/Picked for you) + `news` + views + saved.
2. Section filter rail fields (audience, licensing, line of business, program) + sort + list view.
3. Carriers collection and carrier pages.
4. Manage: dashboard, content list, add-content wizard, policies, due-for-review bulk actions and reminders.
5. Viewers: Gotenberg conversions + slides, transcript sync, spreadsheet, waveform, view-only rendered copies.
6. How-to authoring (Lexical, screenshot paste), kits.
7. AXL answers and "Ask about this" (P5), only over reviewed, authorized evidence.

Each step ends with `npm run typecheck`, `npm test`, `npm run build`, a migration rehearsal on PostgreSQL 16, updates to `infra/aws/library/migrate.js` `EXPECTED` and the web/worker/smoke schema checks, and a `docs/STATUS.md` entry.
