# Netron streams

`NetronReadableStream`, `NetronWritableStream`, `StreamReference`, and `isNetronStream` are exported through `@omnitron-dev/titan/netron`. Stream references allow RPC calls to carry streams associated with a peer.

[Readable streams](readable-stream.ts) receive ordered chunks and track completion. [Writable streams](writable-stream.ts) send indexed chunks and terminal signals. Both maintain peer-owned stream records and enforce limits on concurrent streams.

Use normal stream completion and destruction paths. Handle errors, release streams that are no longer consumed, and stop the owning peer during shutdown. Live streams and finite streams have different timeout behavior; `isLive` is an explicit option, not a promise of unlimited buffering.

| Source | Responsibility |
| --- | --- |
| [Stream reference](stream-reference.ts) | Serializable stream identity |
| [Reference registration](register-stream-reference.ts) | Serializer integration |
| [Readable implementation](readable-stream.ts) | Buffering, ordering, and receive-side cleanup |
| [Writable implementation](writable-stream.ts) | Sending, completion, and teardown |

[Writable teardown tests](../../../test/netron/writable-stream-teardown.spec.ts) cover terminal signals and failures. Browser streaming behavior is exercised in [integration tests](../../../../netron-browser/tests/integration/streaming.test.ts). Use those paths when changing cross-peer behavior.
