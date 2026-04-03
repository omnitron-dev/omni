# @omnitron-dev/netron-browser

> Browser-optimized Netron RPC client — HTTP and WebSocket transports

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/netron-browser
```

## Overview

A browser RPC client for communicating with Titan backend services. Provides both HTTP and WebSocket transports, type-safe service proxies, and a rich middleware system. This is the transport layer — for React integration, see `@omnitron-dev/netron-react`.

### Key Features

- **Dual transport** — HTTP (with batching, caching, retry) and WebSocket (with auto-reconnect)
- **Type-safe proxies** — `client.service<T>('name')` returns a typed proxy
- **Authentication** — token storage, auto-refresh, cross-tab sync, inactivity timeout
- **Middleware pipeline** — pre-request, post-response, error stages with priority ordering
- **Caching** — LRU cache with stale-while-revalidate and tag-based invalidation
- **Retry + circuit breaker** — exponential backoff with automatic circuit breaking
- **Fluent interface** — chainable `.cache().retry().timeout().api.method()`
- **Connection manager** — pooling, health checks, metrics

## Quick Start

```typescript
import { createClient } from '@omnitron-dev/netron-browser';

const client = createClient({
  url: 'http://localhost:3000',
  transport: 'http',
});

await client.connect();

// Direct invocation
const result = await client.invoke('calculator', 'add', [2, 3]);

// Type-safe proxy
interface Calculator {
  add(a: number, b: number): Promise<number>;
}

const calc = client.service<Calculator>('calculator');
const sum = await calc.add(2, 3);
```

## Related

- `@omnitron-dev/netron-react` — React hooks and providers
- `@omnitron-dev/titan` — Backend framework with Netron RPC server
- `@omnitron-dev/msgpack` — Wire format serialization

## License

MIT
