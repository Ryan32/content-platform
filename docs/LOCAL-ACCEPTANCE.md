# Local acceptance

Run from `apps/platform` under Node 24.22.3.

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

The build runs `check:build` automatically. Run `npm run check:build` to recheck existing output. It checks compiled reader, review, protected file, Payload admin and API, Auth0, health, and MCP routes in both the production output and the standalone server. It follows the admin route’s client manifest to the emitted CSS and looks for Payload theme definitions and layout styles. It also confirms that the migration index references every migration source file in order. Browser rendering and database migration execution are separate acceptance steps.

## Runtime configuration

After injecting the intended runtime settings into the current process environment, run `npm run check:config`. The check reads only the current environment and limits output to variable names and validation errors. It runs offline.

| Setting | Expected format |
| --- | --- |
| `DATABASE_URI` | PostgreSQL URI with a host and database name |
| `PLATFORM_ORIGIN` | Canonical HTTPS origin. HTTP is supported for local loopback. |
| `AUTH0_ISSUER` | Exact HTTPS issuer with a trailing slash |
| `AUTH0_AUDIENCE` | The platform origin followed by `/mcp`, matching the discovery resource |
| `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | Populated settings for the browser application |
| `PAYLOAD_SECRET`, `AUTH_SESSION_SECRET` | At least 32 characters each |

Optional `DATABASE_CA_FILE` and `CONTENT_BUCKET` settings depend on the runtime environment. A passing check establishes configuration shape. Live Auth0 registration, credentials, database TLS, permissions, private storage, and worker connectivity require verification in the target environment.

## Synthetic permission matrix

Run the matrix alone with `npm test -- tests/permission-matrix.test.ts`. It exercises the application repository, collection access callbacks, MCP tools using an in-memory SDK transport, and the protected file route. Identity records, persistence and object storage are synthetic.

| Condition | Expected result |
| --- | --- |
| Firm A annuity and firm B wealth each have a scoped view and retrieve grant | Each reader receives only the assigned material. The other firm’s detail and citation are unavailable. |
| A clause requires entitlements split across two memberships | Access is denied. Denied rows do not create a next page. |
| View-only coverage | Reader detail/text are available. MCP reads and both inline/attached original PDF bytes are denied. A separate preview derivative is not yet implemented. |
| View and download grants | Original file download is available for the matching asset version. The download grant does not add MCP retrieval rights. |
| Unknown or inactive user, inactive policy, expired, archived, intake, or future content | Reader and MCP results exclude restricted material. Denied file requests produce no object storage call. |
| Retrieval grant revoked or membership removed | Subsequent MCP calls stop resolving previously issued citations. Removing membership also removes reader access on a fresh request. |
| Source version replaced or file policy revoked | Previously authorized file links return the same unavailable response as other denied file requests. |
| Imported source snapshots, artifacts, relations, reviews and run records | Active administrators may read through collection access. Normal collection writes are denied for every role. |

Use separate development acceptance for Auth0 sign-in and logout, admin styling and edit/save, real two-user permissions, database migration and import reruns, and protected S3 streaming. Actual MCP client OAuth acceptance remains per client. See [application foundation](APPLICATION-FOUNDATION.md) and the [core platform and MCP plan](CORE-PLATFORM-AND-MCP.md).
