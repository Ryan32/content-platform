# Upgrading Payload (and Next.js)

Payload is the admin app, data model, migrations, data-access rules and versions. The reader site, search, MCP, processing worker, evidence and analytics are our own code (see ADR-052). Payload 3 runs inside Next.js, so the two are upgraded together, using the versions Payload's release notes require. Both are pinned to exact versions in `apps/platform/package.json`.

Status checked 2026-11-18 on the npm registry: stable `latest` is **3.94.0** (what we run); **4.0.0** is in beta (`4.0.0-beta.10`, daily canaries). Payload 4 brings a redesigned admin, TanStack support, MCP updates and built-in hierarchies/taxonomies; see Payload's [3.0 → 4.0 migration guide](https://payloadcms.com/docs/v4/migration-guide/v4.md).

## Where Payload coupling lives (and only here)

| Coupling | Where | Safety net |
| --- | --- | --- |
| Tables, columns and enum values our raw SQL uses (Payload's generated naming: `_rels`, `<collection>_<field>`, `_parent_id`/`_order`, `enum_*`) | `src/db/payload-schema.ts` (`SCHEMA`, `ENUMS`, table constants `T.*`) | `tests/schema-contract.test.ts` runs every migration on a real PostgreSQL + pgvector (PGlite) and checks every registered table, column and enum value; it also fails if raw SQL anywhere in `src` names an unregistered table. `tests/sql-integration.test.ts` executes the scheduler, job queue, analysis, chunk index, search and analytics queries against that schema. |
| Payload internals: its PostgreSQL pool, transactions, local requests, and the 3.94 commit-confirmation workaround | `src/db/payload-db.ts` (`sqlPool`, `optionalSqlPool`, `localRequest`, `inTransaction`) | Unit tests with doubles; the review and import paths confirm commits with a fresh read. |
| CSS on Payload's own admin markup (menu, buttons, cards, header) | The fenced `PAYLOAD CHROME OVERRIDES` block at the top of `src/app/(payload)/custom.css` | A test fails if a rule targeting Payload's class names appears outside the block. Visual check needed after upgrades. |
| Custom admin components and views (`admin.components`, `views`), `@payloadcms/ui` hooks | `src/payload.config.ts`, `src/collections/*`, `src/components/*` | Typecheck and build; admin walkthrough. |
| Collection hooks and access rules | `src/collections/*` | `collections`, `permission-matrix`, `access` tests. |

Nothing outside `src/db/payload-db.ts` may touch `payload.db.pool`, `beginTransaction`/`commitTransaction`/`rollbackTransaction` or `createLocalReq`.

## Monthly 3.x update (a few hours)

1. Read the Payload releases since our version (breaking notes, required Next.js version, database adapter changes).
2. In `apps/platform`: update `payload`, `@payloadcms/*` and, if required, `next` to exact versions; `npm install`.
3. `npm run generate:types`; then `npm run migrate:create -- payload_<version>` with the offline environment used for migrations. If it produces a migration, read it: Payload schema changes show up here first. Delete it if empty.
4. `npm run typecheck`, `npm test` (includes the schema contract and SQL integration tests), `npm run build`.
5. Local admin walkthrough in light and dark mode: menu, buttons, cards, header (the fenced CSS), Manage home, Add content, Review, Automation, a library item's Processing panel, publish checklist.
6. Commit with the versions in the message; deploy through the normal sequence (images → snapshot → migrate → web/worker → smoke).

If the schema contract fails: the failure names the missing table, column or enum value. Find the new name in the generated migration or `src/payload-types.ts`, update `src/db/payload-schema.ts` (and any query naming it directly), and rerun.

## Payload 4 (plan when it is stable)

1. Create a branch; follow the official 3.0 → 4.0 migration guide.
2. Run `npm test`. Fix in this order: schema contract (`payload-schema.ts`), internals (`payload-db.ts`), typecheck and build, admin components and views, then the fenced CSS.
3. Decide deliberately, don't drift: whether built-in hierarchies/taxonomies should replace our Tags & topics and sections; whether Payload's MCP plugin becomes the editors' MCP (read/update only, no delete, no publish/access changes, editors only); whether TanStack support changes our hosting.
4. Rehearse the migration on a copy of the dev database before deploying.
