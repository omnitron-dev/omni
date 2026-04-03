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

## License

MIT
