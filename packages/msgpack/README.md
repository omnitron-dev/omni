# @omnitron-dev/msgpack

MessagePack serialization with JavaScript value extensions. Netron uses it for binary RPC payloads.

## Capabilities

- Encode and decode values, including registered Date, Map, Set, RegExp and BigInt extensions.
- Create isolated `Serializer` instances and register application codecs.
- Read concatenated or partial values with `tryDecode`. It returns the first value and its exact `bytesConsumed`, or `null` if it cannot decode that value.

## Quick start

```sh
pnpm add @omnitron-dev/msgpack
```

```ts
import { encode, decode } from '@omnitron-dev/msgpack';

const bytes = encode({ title: 'Guide', created: new Date('2026-01-01') });
const value = decode(bytes);
console.log(value.created instanceof Date); // true
```

Custom extension IDs and codecs must agree at both ends. Decoding reconstructs values; application payload validation and authorization belong to the caller.

Plain objects encode their own enumerable string keys as standard MessagePack maps. Up to 15 pairs use fixmap, 16 through 65,535 use map16, and larger objects use map32. The decoder accepts all three headers for any count they can represent. JavaScript `Map` uses the registered extension to preserve key types. [MessagePack map format](https://github.com/msgpack/msgpack/blob/master/spec.md#map-format-family)

`decode` and `tryDecode` accept a `Buffer`, a `Uint8Array` view, or a `SmartBuffer` from `@omnitron-dev/msgpack/smart-buffer`. Both helpers read from the current `SmartBuffer` cursor and leave it in place. Use `serializer.decode(buffer)` to advance past a value. With chunked input, keep the unread bytes when `tryDecode` returns `null` and retry after appending the next chunk.

## Verification

From the repository root, `pnpm exec xec verify-model msgpack` checks a finite model of two ordinary messages sent through a fragmented stream. A separate encoder supplies the reference frame lengths. The profile compares delivery order, visible bytes, peek results and cursor position after each operation. Its JSON receipt records the depth, observations and outcome. [Stream model](test/stream-model.test.ts) · [Run and replay a profile](../../tests/verification/README.md)

Map-format tests cover cardinality thresholds, legal wider headers, independent decoding and adjacent frames. Keep these wire-format cases alongside the stream model when changing the codec. [Map framing tests](test/map-framing.test.ts)

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
