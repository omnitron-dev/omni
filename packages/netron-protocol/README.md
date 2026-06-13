# @omnitron-dev/netron-protocol

Dependency-free Netron **wire-protocol primitives**, shared by the server
([`@omnitron-dev/titan`](../titan)) and the browser client
([`@omnitron-dev/netron-browser`](../netron-browser)).

Both ends of a Netron connection must agree on the on-the-wire contract. Before
this package, each side carried its own copy of that contract (UID generation,
wire constants, packet codec, serializer, definitions, error codes) — identical
in intent but maintained separately, which invited silent drift (e.g. NB-2, a
core-task-name prefix mismatch). This package is the single source of truth they
both import.

## Scope

Extracted incrementally (the audit's **SHARED-PROTO** track):

- ✅ `MAX_UID_VALUE` — UID upper bound (32-bit unsigned)
- ✅ `Uid` — sequential, wrap-around UID generator for packet correlation
- ✅ packet wire types — `PacketImpulse`, `TYPE_*` opcodes, `PacketType`, `StreamType`
- ✅ `uuid` — UUIDv7 generator (Web Crypto; was a node:crypto-pooled variant in titan and a getRandomValues variant in netron-browser of the same algorithm)
- ✅ service-definition shape types — `ArgumentInfo`, `MethodInfo`, `PropertyInfo`, `ServiceMetadata`, `ServiceContract`, `ServiceMetadataWithContract`
- ✅ `Definition` — the service-definition class
- ✅ `Reference` — service-definition reference (reconciled to a plain Error; titan's TitanError on the empty-defId guard was unreachable + untyped-by-callers)
- ⏳ `StreamReference`
- ⏳ `Packet` + encode/decode + serializer (the wire CODEC — needs byte-compat verification)
- ⏳ shared error codes
- ⏳ core-task name + wire constants

## Design rules

- **No runtime dependencies** that pull in a server- or browser-only surface.
  This package must import cleanly into both a Node build (titan, `tsc`) and a
  bundled browser build (netron-browser, `tsup`).
- Anything here is **protocol**, not behaviour: values/shapes/codecs that must
  match across the wire, not transport, DI, or app logic.
