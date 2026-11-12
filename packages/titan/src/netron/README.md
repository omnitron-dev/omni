# Netron service communication

`@omnitron-dev/titan/netron` provides the Node service runtime: peers, service definitions, remote interfaces, calls, events, and streams. Browser applications use [`@omnitron-dev/netron-browser`](../../../netron-browser/README.md).

A service is exposed by a local peer, discovered by a remote peer, and called through its interface. Service names and versions form part of that contract. Register transports and services before starting the Netron instance, and await `stop()` when the owning application shuts down.

Use [Titan application integration](../application/README.md) when Netron belongs to an application. Standalone hosts own the same start/stop lifecycle explicitly.

| Guide | Boundary |
| --- | --- |
| [Authentication and authorization](auth/README.md) | Credentials, policy, and invocation identity |
| [Transports](transport/README.md) | HTTP, WebSocket, TCP, and local sockets |
| [HTTP](transport/http/README.md) | HTTP server, client, and middleware |
| [Streams](streams/README.md) | Stream references and teardown |
| [Packets](packet/README.md) | Binary framing and serialization |
| [Core tasks](core-tasks/README.md) | Internal peer-control operations |

[Public exports](index.ts) include `Netron`, `Interface`, service decorators, and stream types. [Options](types.ts) and [transport options](transport/types.ts) define the supported configuration.

Use the authenticated invocation context for request-specific identity. Transport connectivity and service discovery do not by themselves establish permission to invoke a method.
