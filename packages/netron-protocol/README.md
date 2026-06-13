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
- ⛔ `StreamReference` — NOT shareable: its `from()`/`to()` factories bind to the concrete, environment-specific `NetronReadable/WritableStream` classes (server vs browser); only the wire data shape matches. Stays per-package.
- ✅ the FULL error-code module (XC-2) — `ErrorCode` + `ErrorCategory` enums, range classifiers, the `ERROR_METADATA` table, and the table-driven `toHttpStatus`/`getErrorName`/`getDefaultMessage`/`isRetryableError`. titan and netron-browser `errors/codes.ts` are now pure re-exports. The browser's previously-inline name/message/retryable helpers were verified output-identical to titan's table before the swap, so the upgrade is behaviour-preserving. (The TitanError class hierarchy + factories + serialization still live per-package — a separate follow-up.)
- ⛔ `Packet` + serializer — the wire CODEC, confirmed DIVERGENT: titan's and the browser's `Packet` bit-manipulation implementations differ substantially (~236/300 lines), wire-compatible but not shared code, and the serializer registers the env-specific `StreamReference` handlers. Unifying needs a byte-compat round-trip harness between the two impls + resolving the StreamReference divergence first — a dedicated sub-EPIC, not a mechanical dedup.
- ⏳ shared error codes
- ⏳ core-task name + wire constants

## Design rules

- **No runtime dependencies** that pull in a server- or browser-only surface.
  This package must import cleanly into both a Node build (titan, `tsc`) and a
  bundled browser build (netron-browser, `tsup`).
- Anything here is **protocol**, not behaviour: values/shapes/codecs that must
  match across the wire, not transport, DI, or app logic.
