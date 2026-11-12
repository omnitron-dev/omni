# Titan integration tests

These tests connect the browser client to real Netron HTTP or WebSocket servers in Node. They complement [browser tests](../README.md), where the same client runs under Playwright.

From the repository root:

```sh
pnpm exec turbo run build --filter=@omnitron-dev/netron-browser...
pnpm --filter @omnitron-dev/netron-browser test:integration
pnpm --filter @omnitron-dev/netron-browser test:integration tests/integration/path-prefix.test.ts
```

[The integration configuration](../../vitest.integration.config.ts) selects this directory, uses Node, and disables file parallelism. [Setup](../setup/integration.ts) supplies a WebSocket implementation when Node does not provide one.

Representative cases:

| Contract | Tests |
| --- | --- |
| HTTP calls and mount paths | [HTTP integration](http-integration.test.ts), [path prefixes](path-prefix.test.ts) |
| WebSocket calls and wire format | [WebSocket integration](websocket-integration.test.ts), [protocol](websocket-protocol.test.ts) |
| Packet compatibility | [Packet protocol](packet-protocol.test.ts), [transport compatibility](transport-compatibility.test.ts) |
| Streams and errors | [Streaming](streaming.test.ts), [errors](errors.test.ts) |
| Multiple backends | [Backend selection](multi-backend.test.ts) |

Use fixture-owned ports and close clients and servers in teardown. A passing Node integration test does not replace browser execution, and timing tests are regression checks rather than published performance guarantees.
