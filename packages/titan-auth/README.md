# @omnitron-dev/titan-auth

> JWT authentication module for the Titan framework

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-auth
```

## Overview

Provides JWT-based authentication for Titan applications. Handles token issuance (HS256, via `jose`), validation in HTTP middleware, and bridges auth context into Titan's async-local-storage RLS layer so every RPC call has access to the authenticated user.

### Key Features

- JWT issuance and validation
- `AuthenticationManager` for HTTP middleware
- `AuthenticationClient` with pluggable token storage
- Auth context propagation via `AsyncLocalStorage`
- Method-level authorization via `@Public({ auth: { roles, permissions, policies } })`

## Live session authority

Use `createSharedSessionAuthManager` from `@omnitron-dev/titan-auth/preset/shared-session`
with `sessionAuthority(sessionId, userId)` for current, revocable authorization.
The adapter returns `userId`, `expiresAt`, `isRevoked`, `roles`, `permissions`, and
optionally `activeRefreshTokenId` from one consistent database snapshot. A missing
or revoked session is rejected; an unavailable or malformed authority returns 503.
The token's subject must own the session. Current grants replace its role and
permission claims, so a database role edit does not depend on cache invalidation.

`SessionAuthorityService` from `./preset/session-authority` is an optional Netron
adapter for cooperating backends. Its `resolve({ sessionId, userId })` method
requires both `service_role` and `sessions.resolve`; it returns no bearer tokens.
The application owns the authenticated transport, deadline, database and lifecycle.
Deploy the authority endpoint before its consumers. Authority unavailability
refuses protected requests; replicate the owner and its database for availability.

Registry mode remains available with `sessionRedis` and optional `sessionLookup`.
The lookup can recover a registry miss, but this preset never writes Redis:
restoration must serialize with revocation in the adapter. Cached registry hits
are only as current as the application's registry update protocol. Prefer canonical
mode where revocation must reflect committed database state on the next request.

Tokens require bounded subject/session identifiers and an unexpired `exp`.
Human sessions cannot claim `service_role`. The authentication-result cache is
disabled in this preset (`cacheTtl` is deprecated); signature caching is separate.
Netron revalidates token-backed persistent peers before calls, property access and
core tasks, and binds the checked identity to that invocation's async context.
An already admitted invocation retains its identity; critical mutations should
also check resource ownership and authority under the transaction's locks.

## License

MIT
