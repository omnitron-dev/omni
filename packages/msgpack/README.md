# @omnitron-dev/msgpack

MessagePack serialization with JavaScript value extensions. Netron uses it for binary RPC payloads.

## Capabilities

- Encode and decode values, including registered Date, Map, Set, RegExp and BigInt extensions.
- Create isolated `Serializer` instances and register application codecs.
- Read partial buffers with `tryDecode`; access buffer utilities through `./smart-buffer`.

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

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
