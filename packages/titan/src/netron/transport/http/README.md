# Netron HTTP transport

`@omnitron-dev/titan/netron/transport/http` provides the Node HTTP transport and client. It exposes Netron service calls over HTTP while retaining service contracts and the host's authentication and authorization policy.

Register `HttpTransport` with the owning `Netron` instance and configure its server through transport options. Await normal Netron startup and shutdown; do not treat constructing a transport as a listening server.

| Source | Responsibility |
| --- | --- |
| [Transport](http-transport.ts) | Server and connection integration |
| [Server](server.ts) | Request dispatch and lifecycle |
| [Peer](peer.ts), [connection](connection.ts) | Remote peer and connection state |
| [Client](client.ts), [interface](interface.ts) | Client calls and remote interfaces |
| [Middleware](middleware/index.ts) | Request processing hooks |
| [Body handling](request-body.ts) | Request size and body handling |
| [Rate limiter](rate-limiter.ts) | Sliding-window request limits |
| [Batcher](request-batcher.ts) | Configured client request batching |

[Transport options](../types.ts) define listening configuration, CORS, limits, and `pathPrefix`. Keep the client base URL and server prefix aligned. Browser cookie authentication also needs matching credentials and CSRF configuration; see [the cookie guide](../../../../../netron-browser/docs/cookie-mode-quickstart.md).

The public entry also exports `HttpTransportClient`, `EnhancedHttpInterface`, and fluent-interface helpers. [The export list](index.ts) is authoritative for their types. [Browser HTTP integration tests](../../../../../netron-browser/tests/integration/http-integration.test.ts) exercise the client/server boundary.
