---
module: netron-browser
title: "Browser Netron RPC Client"
tags: [rpc, browser, http, websocket, client, frontend]
summary: "Browser-optimized Netron client with HTTP/WebSocket transports, auth, middleware"
depends_on: [common, cuid, eventemitter, msgpack]
---

## Purpose

Browser-side counterpart to Titan's Netron server. Enables frontend apps to call backend RPC services with full type safety.

## Transports

| Transport | Use Case | Features |
|-----------|----------|----------|
| HTTP | Request-response | Retry, batching, caching |
| WebSocket | Real-time, streaming | Keep-alive, reconnection, subscriptions |

## Key Classes

- **NetronClient** — Main client, manages connections to one backend
- **MultiBackendClient** — Routes calls to multiple backends by service name
- **AuthenticationClient** — Handles JWT session storage + auto-refresh
- **ServiceRouter** — Maps service names to backend endpoints

## Usage in Frontend (via @omnitron-dev/prism)

```typescript
// Don't use netron-browser directly — use through @omnitron-dev/prism/netron
import { createMultiBackendClient } from '@omnitron-dev/prism/netron';

const client = createMultiBackendClient<OmnitronSchema>({
  backends: {
    main: { url: '/api/main' },
    storage: { url: '/api/storage' },
  },
});

// Type-safe RPC
const user = await client.call('Auth', 'signIn', username, password);
```

## Middleware Pipeline
Request/response middleware for logging, auth header injection, error transformation.

## Critical Rule
ALL frontend RPC MUST go through `@omnitron-dev/prism/netron`. Never use raw `fetch()` for backend calls.
