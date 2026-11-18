# Dependency review — 2026-11-18

Scope: `apps/platform`, the current library application. The retired `cms/` scaffold is not the deployment target and was not upgraded. Lockfiles pin the resolved graph.

Before: npm audit reported 20 affected packages (16 high, four moderate). After: 16 high, zero moderate/critical. The high findings are the dependency chain for one unresolved picomatch advisory, not 16 independently discovered vulnerabilities.

## Remediation

The old esbuild 0.18.20 instance under `@esbuild-kit/core-utils` was overridden to 0.25.12. The [upstream esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99) affects <=0.24.2 and identifies 0.25.0 as patched. This is a targeted tooling dependency change; do not run an esbuild development server in deployed tasks. Validate Payload CLI, schema generation and the production build after changes to this override.

The existing DOMPurify 3.4.18 override is retained. No forced Payload/Next major upgrades or test-runner downgrades were applied.

## Unresolved upstream issue

[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) reports repeated-extglob ReDoS through picomatch 4.0.7 and lists **no patched version**. npm's latest release is also 4.0.7 at review time. Upgrading to that version or following npm's suggested Vitest downgrade does not resolve this advisory.

Observed paths include Payload schema generation, Sass file watching, and Vite/Vitest file discovery. Application source does not import picomatch or accept caller-supplied glob patterns. This narrows exposure; it is not a complete reachability proof for all transitive runtime code. Keep production web tasks on the standalone server, do not expose tooling/dev servers, and never pass upload names or user filters as glob patterns. Review the standalone artifact and re-run audit on each release. Production risk acceptance or an upstream patch remains a release gate; audit is not green.

Private audit JSON is stored under ignored `tmp/`; no credentials/source content were used. Reproduce with `npm audit --json` from `apps/platform`. The newly added parser/AWS dependencies must be included in future audits, and untrusted document work must run in separate constrained worker tasks.
