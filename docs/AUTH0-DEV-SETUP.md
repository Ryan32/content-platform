# AE Library development Auth0 setup

Status: instructions, not verified tenant changes. Use the existing Portal development tenant. DNS can be configured later. Confirmed product origin: `https://library-dev.advisorsexcel.com`.

## Web application

Create a Regular Web Application named **AE Library Dev**. The proposed browser integration uses Auth0's Next.js SDK v4 routes; its callback will be `/auth/callback`. This route is not implemented in the foundation yet. Use a dedicated library registration rather than altering Portal's application.

Allowed Callback URLs:

```text
https://library-dev.advisorsexcel.com/auth/callback
http://127.0.0.1:3000/auth/callback
```

Allowed Logout URLs:

```text
https://library-dev.advisorsexcel.com
http://127.0.0.1:3000
```

The local hostname matches the application's loopback development command. Use it consistently instead of switching between localhost and 127.0.0.1. Server-side web login does not require configuring cross-origin browser API access; leave Allowed Web Origins/CORS unset unless the eventual implementation requires them. Enable only the existing identity connections intended for pilot users. Do not change shared connection signup rules or Portal settings as a side effect.

Record domain and client ID as nonsecret configuration. Store the application client secret in the approved private configuration/Secrets Manager location, never chat or Markdown. The application session-encryption secret will be separately generated during browser-login implementation; it is not the Auth0 client secret or Payload secret.

## API resource

Create an API named **AE Library Dev API**, identifier `https://library-dev.advisorsexcel.com/mcp`, signing algorithm **RS256**. This identifier is the access-token audience; it does not need DNS resolution to be registered. Do not edit an existing API identifier or tenant-wide default audience.

Add permissions `content:search` (search authorized library content) and `content:read` (read authorized evidence and resolve citations). Firm/LOB/action access remains in the platform policy layer. Permission assignment/RBAC and resource-parameter compatibility will be validated with the actual MCP OAuth flow; adding scope definitions alone does not grant record access. Do not use a generated machine-to-machine test token as the user-facing login mechanism.

These application callback URLs are for AE Library browser login. Claude, ChatGPT and Copilot OAuth client registrations/callbacks are a separate step. No wildcard callback URLs, public signup endpoint, or unrestricted service identity are required for this setup.

## Evidence to collect

After configuration, record the tenant domain, client ID, API identifier, enabled connection names and callback/logout URLs; omit secret values. Live login testing follows browser-session implementation and private credential configuration. Next: initial administrator/test-user mapping and approved pilot memberships.

References checked 2026-11-17: [Auth0 Next.js SDK](https://github.com/auth0/nextjs-auth0), [Auth0 API registration guidance](https://github.com/auth0/docs/blob/master/articles/getting-started/set-up-api.md).
