# Netron transports

Transports connect the service layer to a network or local socket. Choose a supported public entry point for the host environment:

| Transport | Package entry |
| --- | --- |
| HTTP | `@omnitron-dev/titan/netron/transport/http` |
| WebSocket | `@omnitron-dev/titan/netron/transport/websocket` |
| TCP | `@omnitron-dev/titan/netron/transport/tcp` |
| Unix socket / named pipe | `@omnitron-dev/titan/netron/transport/unix` |

Applications normally register and configure these through `Netron`, which owns server startup, peer connections, and shutdown. The directory-level `transport/index.ts` is internal; it is not a published `/netron/transport` entry point.

[Types](types.ts) define connection, server, address, capability, and configuration contracts. [The registry](transport-registry.ts) resolves implementations. [Base classes](base-transport.ts) supply shared transport behavior.

Configure listening addresses, limits, and authentication for the intended boundary. Transport capabilities differ; do not assume an HTTP endpoint provides every binary-protocol operation.

See the [HTTP guide](http/README.md), [authentication guide](../auth/README.md), and [Netron guide](../README.md). Browser clients use [netron-browser](../../../../netron-browser/README.md) rather than Node transport implementations.
