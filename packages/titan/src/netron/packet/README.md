# Binary packets

The packet layer encodes Netron calls, control messages, and stream data for binary transports. Its opcodes and wire types come from [`@omnitron-dev/netron-protocol`](../../../../netron-protocol/README.md), shared with the browser client.

[Packet construction and decoding](index.ts) expose `createPacket`, `createStreamPacket`, `encodePacket`, and `decodePacket` through `@omnitron-dev/titan/netron`. Application code normally uses service interfaces rather than constructing packets.

- [Packet](packet.ts): message flags, identifiers, and stream metadata.
- [Serializer](serializer.ts): payload serialization.
- [Wire types](types.ts): shared protocol constants.
- [Browser protocol tests](../../../../netron-browser/tests/integration/packet-protocol.test.ts): cross-client checks.

Decoding validates framing, flags, and payload bounds. Preserve these checks when changing the wire format, and test malformed and oversized input alongside valid round trips. A successful local encode/decode round trip alone does not establish compatibility with the other endpoint.

HTTP uses its own request/response representation; see [the HTTP transport](../transport/http/README.md).
