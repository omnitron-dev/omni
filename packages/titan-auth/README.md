# @omnitron-dev/titan-auth

JWT authentication, session verification and identity propagation for Titan applications. Netron uses the admitted identity to enforce method authorization.

## Capabilities

- Token issuance and verification, HTTP adapters and async invocation context.
- Shared-session authentication with a current revocable authority.
- An optional authenticated Netron session-authority service.

## Quick start

```sh
pnpm add @omnitron-dev/titan-auth
```

```ts
import { TitanAuthModule } from '@omnitron-dev/titan-auth';

export function authentication(jwtSecret: string) {
  return TitanAuthModule.forRoot({ algorithm: 'HS256', jwtSecret });
}
```

Provide the configured module through the application's imports and keep secrets in its configuration boundary. Authentication alone does not grant access: declare roles, permissions or policies on protected Netron methods.

For database-backed revocation, use `createSharedSessionAuthManager` from `./preset/shared-session` with `sessionAuthority(sessionId, userId)`. The authority returns current session ownership, expiry, revocation and grants from one consistent snapshot. Missing or revoked sessions reject; unavailable or malformed authority returns 503. Human sessions cannot claim `service_role`.

`./preset/session-authority` exposes an optional `SessionAuthorityService`; callers require both `service_role` and `sessions.resolve`. The application owns the transport, database and lifecycle. Critical mutations should also check resource ownership inside their transaction.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
