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

## Invocation lifetime and response validation

`NetronClient`, `HttpClient`, `WebSocketClient`, `BackendClient` and
`MultiBackendClient` accept local invocation controls:

```typescript
const controller = new AbortController();
const result = client.invoke('knowledge', 'read', ['object-id'], {
  signal: controller.signal,
  timeout: 15_000,
});
controller.abort();
```

`signal` is never serialized. Cancellation rejects with `signal.reason` and
aborts the HTTP fetch, including body consumption. WebSocket cancellation
releases the local pending call and ignores its late response. It cannot undo
server work already admitted; it does not disconnect other callers or cancel
their shared service discovery. Queries should pass their cache's signal.
Mutations are not automatically cancelled on component unmount.

The timeout covers transport attempts, retry backoff, complete response body
consumption and response middleware. Pre-request middleware receives caller
cancellation; the transport deadline starts after it selects the request timeout.
A deadline produces `TIMEOUT`; caller cancellation does not become a timeout,
trigger authentication refresh, or replay a request. HTTP latency summaries use
constant storage and include response body consumption.

HTTP envelopes must contain a boolean `success` and match the request ID.
`X-Request-ID` carries the same ID for Titan's pre-admission refusals. Titan's
transport-level `{ error: true, code, message }` errors are accepted only under
non-2xx HTTP statuses and cannot provide successful data. Invalid envelopes
reject with `INVALID_RESPONSE`; RPC refusals retain their original code, details
and non-2xx HTTP status. Generic result types do not validate application payloads;
services and callers still need their own response schemas.

HTTP network retries require **both** client `http.retry: true` (or `HttpClient`
`retry: true`) and invocation `idempotent: true`. The latter is the caller's
assertion that an ambiguous request can safely be replayed, not a deduplication
or exactly-once guarantee. Existing retry-enabled clients must opt each safe
operation in explicitly. Neither method names nor HTTP POST alone establish
idempotence. Protocol errors and ordinary server refusals are not automatically
retried. Authentication middleware may request one re-invocation after a refusal,
within the same deadline.

## Related

- `@omnitron-dev/netron-react` — React hooks and providers
- `@omnitron-dev/titan` — Backend framework with Netron RPC server
- `@omnitron-dev/msgpack` — Wire format serialization

## License

MIT
