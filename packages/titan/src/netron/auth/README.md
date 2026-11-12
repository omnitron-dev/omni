# Netron authentication and authorization

`@omnitron-dev/titan/netron/auth` defines server authentication, authorization policies, sessions, token transport, and browser request protections. Configure these through the owning Netron instance before accepting clients.

Authentication establishes an identity; authorization decides whether that identity may perform a particular operation. A client-supplied role or user ID is not an authenticated server context.

| Source | Responsibility |
| --- | --- |
| [Authentication manager](authentication-manager.ts) | Credential and token validation |
| [Authorization manager](authorization-manager.ts) | Permission checks |
| [Policy engine](policy-engine.ts), [built-in policies](built-in-policies.ts) | Policy evaluation |
| [Session manager](session-manager.ts) | Session lifecycle |
| [Token transport](token-transport.ts), [implementations](token-transports/index.ts) | Transport-specific credential handling |
| [Token issuance](token-issuance.ts), [cookie codec](cookie-codec.ts) | Issuance and cookie representation |
| [CSRF](csrf-middleware.ts), [origin checks](origin-middleware.ts) | Browser request protections |
| [Audit logger](audit-logger.ts) | Authentication and authorization events |

Use `getCurrentInvocationContext` from `@omnitron-dev/titan/netron` for per-call identity inside service code. Configure both server and browser client consistently when using cookies; see the [browser cookie guide](../../../../netron-browser/docs/cookie-mode-quickstart.md).

[Types](types.ts) and [public exports](index.ts) define the integration contracts. Keep credentials, token secrets, and policy configuration in the application rather than embedding them in service examples.
