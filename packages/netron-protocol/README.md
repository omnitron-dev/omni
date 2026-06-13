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
- ✅ the FULL error-code module (XC-2) — `ErrorCode` + `ErrorCategory` enums, range classifiers, the `ERROR_METADATA` table, and the table-driven `toHttpStatus`/`getErrorName`/`getDefaultMessage`/`isRetryableError`. titan and netron-browser `errors/codes.ts` are now pure re-exports. The browser's previously-inline name/message/retryable helpers were verified output-identical to titan's table before the swap, so the upgrade is behaviour-preserving.
- ✅ `TitanError` class hierarchy (XC-2) — one shared class: `TitanError` + `AggregateError` + `ErrorPool` + `createError`/`isErrorCode`/`ensureError` + the error types. The browser inherits titan's stats/cache/pool/metrics/aggregate machinery and gained `SerializedError`/`fromJSON`; the merge also fixed the browser's raw-`httpStatus` 600/601 leak (XC-3). Both `errors/core.ts` are pure re-exports.
- ⛔ error FACTORIES + subclasses (`Errors.*`, `ValidationError`, `HttpError`, `AuthError`, …) — DIVERGENT: titan's set (491 LOC) builds richer titan-only subclasses (validation / http / transport); the browser's (322) is a deliberate subset. Per-package — these are framework-specific convenience layers, not the wire contract.
- ✅ `Packet` class + `createPacket` — the binary wire-frame. The two impls had identical public APIs but different bit-manipulation internals; unified on titan's canonical impl (dead reference-helpers pruned) after the cross-impl harness proved byte-identical wire output. Both `packet.ts` re-export it (netron-browser keeps its local stream-packet factories, now building the shared Packet).
- ◐ packet SERIALIZER — stays per-package: it registers the env-specific `StreamReference` codecs (server vs browser streams). It now operates on the shared `Packet` / `Definition` / `Reference` / `Uid`, so only the StreamReference codec + the msgpack glue remain package-local. Full serializer unification is blocked on the `StreamReference` divergence.

## Design rules

- **No runtime dependencies** that pull in a server- or browser-only surface.
  This package must import cleanly into both a Node build (titan, `tsc`) and a
  bundled browser build (netron-browser, `tsup`).
- Anything here is **protocol**, not behaviour: values/shapes/codecs that must
  match across the wire, not transport, DI, or app logic.
