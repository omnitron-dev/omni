# Cookie-Mode Auth Quickstart

T#176 added a pluggable token-transport layer to netron. The default
remains Bearer (legacy behaviour); this guide is for teams switching
their deployment to HttpOnly cookies + CSRF double-submit.

## Why switch

| | Bearer (default) | Cookie |
|---|---|---|
| JWT visibility | sessionStorage (readable from JS — XSS amplifier) | HttpOnly cookie (invisible to JS) |
| Multi-tab UX | Each tab needs its own signin | Shared cookie jar — open a new tab and you're already in |
| XSRF posture | Immune by construction (attacker can't forge `Authorization`) | Needs `SameSite=Strict` + double-submit token (auto-wired by the framework) |
| Best for | Mobile apps, S2S, machine clients | Browser end-users |

Cookie mode is the recommended posture for the portal. Bearer mode
stays in the codebase for backwards compatibility and S2S — Composite
mode runs both transports so a single backend serves both populations.

## Switching a backend

In your backend's bootstrap, the wiring is already in place — just
flip the env var:

```bash
# default: bearer
AUTH_TRANSPORT=cookie

# allowed origins (CSV) — required for cookie mode
AUTH_ALLOWED_ORIGINS=https://omni.example,https://abc.onion
```

The bootstrap (`apps/*/src/bootstrap.ts` in daos) reads
`selectTokenTransport()` from `@daos/auth-utils` and threads the
resulting `transport`, `csrf`, `allowedOrigins`, `accessCookieName`
into `netron.configureAuth()` + `createCsrfMiddleware` +
`createOriginMiddleware`.

## Switching the portal client

```bash
VITE_AUTH_TRANSPORT=cookie
```

The portal's `src/netron/client.ts` picks the matching
`CookieClientTokenTransport`. The `AuthenticationClient` switches into
`tokenless` mode and resolves the user via a `whoami` probe on app
boot. Multi-tab UX comes for free because the cookie jar is shared.

## What the framework does automatically

On signin / refresh (cookie mode):
1. Server's auth RPC calls `issueTokens({ access, refresh })` inside
   the `runWithTokenIssuanceContext` ALS frame.
2. The configured `CookieTokenTransport` writes three `Set-Cookie`
   headers: `omni_access` (HttpOnly), `omni_refresh` (HttpOnly,
   narrow Path), `omni_csrf` (non-HttpOnly — JS reads it).
3. The HTTP response builder strips `accessToken` / `refreshToken`
   from the JSON body so they don't leak to JS.

On every protected RPC:
1. Browser ships all three cookies.
2. `BearerTokenTransport.extract()` doesn't fire — cookie mode is
   active. `CookieTokenTransport.extract()` parses the Cookie header.
3. Standard auth-manager validates the JWT.
4. `createCsrfMiddleware` reads the Cookie header for `omni_csrf` AND
   the `X-CSRF-Token` request header. They must match (constant-time).
5. `createOriginMiddleware` validates the `Origin` header against
   `AUTH_ALLOWED_ORIGINS`.

On signout:
1. Server calls `clearTokens()` → transport emits `Max-Age=0` cookies
   for all three. Sibling tabs observe `omni_logout_at` localStorage
   write and force-collapse their auth state.

## Operator checklist

- [ ] `AUTH_TRANSPORT=cookie` set on every backend.
- [ ] `AUTH_ALLOWED_ORIGINS` CSV pinned to the deployment's known
      origins (no `*`). Include Tor onion addresses if applicable.
- [ ] HTTPS termination working — `createOmniCookieTransport` throws
      at boot if `NODE_ENV=production` and `secure: false`.
- [ ] CSP headers present (see `infra/nginx/nginx.conf` for the
      template). T#352 wires the report-only policy; lift to enforce
      after observing zero reports for ~7 days.
- [ ] Portal client built with `VITE_AUTH_TRANSPORT=cookie` (default
      is still `bearer` in the Vite env).

## Common pitfalls

- **Mixing modes**: a Composite backend with a Cookie-only portal works
  fine. Bearer-only backend with Cookie-only portal → portal's whoami
  probe fails (no Authorization header sent). Match the modes.
- **Cross-origin browser fetch**: a portal at `omni.example` calling a
  backend at `api.omni.example` ships the cookie only if `SameSite`
  permits. Default `SameSite=Strict` blocks cross-site fetches. Use a
  same-origin gateway (the daos deployment template does this) or
  switch to `SameSite=Lax` if you understand the trade-off.
- **CSRF token reading**: `document.cookie['omni_csrf']` may be
  quote-wrapped (RFC 6265 permits it). T#375 unwraps automatically;
  if you're writing a non-netron client, strip the quotes yourself.
- **WS reconnect with stale cookie**: handled in T#377 — after 5
  failed reconnect attempts the chat client triggers a session
  refresh through the same path HTTP RPC uses.

## Migration path for an existing deployment

1. Set `AUTH_TRANSPORT=composite` on backends (accepts both
   transports). Portal still on `bearer`. No user impact.
2. Switch portal to `VITE_AUTH_TRANSPORT=cookie` and roll. New
   signins now use cookies; existing bearer sessions continue to
   work until JWT exp.
3. After all bearer sessions have rolled over (e.g. 15 min after
   step 2), set `AUTH_TRANSPORT=cookie` on backends. Bearer fallback
   is now disabled — S2S calls need to use the `service_role` JWT
   path documented in T#382.
