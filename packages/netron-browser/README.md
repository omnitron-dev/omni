# @omnitron-dev/netron-browser

HTTP and WebSocket clients for Netron services. Use this package directly in browser applications, or use [Netron React](../netron-react/README.md) for React state and hooks.

## Capabilities

- Direct RPC invocation and typed service proxies.
- HTTP batching, caching and explicit retry policy; WebSocket connections and subscriptions.
- Request middleware, authentication integration and multiple backend routing.
- Per-call cancellation, timeouts and response-envelope validation.

## Quick start

```sh
pnpm add @omnitron-dev/netron-browser
```

```ts
import { createClient } from '@omnitron-dev/netron-browser';

interface Calculator {
  add(a: number, b: number): Promise<number>;
}

const client = createClient({
  url: 'http://localhost:3000',
  transport: 'http',
});
await client.connect();
const calculator = client.service<Calculator>('Calculator');
console.log(await calculator.add(2, 3));
await client.disconnect();
```

The server must publish the named service. Use an exact version such as `Calculator@1.0.0` when the caller requires that publication. Generics check local code; validate application data at the server boundary.

For a fixed HTTP endpoint, import `HttpClient` from `@omnitron-dev/netron-browser/client/http`. Set `redirect: 'error'` when a redirect must not forward the call elsewhere.

## Invocation lifetime

`invoke` accepts a local `signal` and `timeout`. HTTP cancellation aborts Fetch; WebSocket cancellation releases the local pending call and ignores a late reply. Neither can undo work already admitted by the server.

HTTP retries require both configured retry policy and an invocation marked `idempotent: true`. A timeout covers attempts, backoff, body consumption and response middleware. The client validates the RPC envelope and request identity; it does not infer a schema for arbitrary result data.

## Documentation

[Client guides](docs/README.md) · [Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
