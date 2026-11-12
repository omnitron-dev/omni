# @omnitron-dev/cuid

Generate compact string identifiers from a timestamp, counter, fingerprint and hashed entropy.

## Capabilities

- A default 16-character identifier beginning with a lowercase letter.
- `isCuid` for format validation.
- `createOptimizedCuid` for a configured generator.

## Quick start

```sh
pnpm add @omnitron-dev/cuid
```

```ts
import { cuid, isCuid, createOptimizedCuid } from '@omnitron-dev/cuid';

const id = cuid();
console.log(isCuid(id)); // true
const createLongId = createOptimizedCuid({ length: 32 });
console.log(createLongId());
```

The encoded hash does not preserve timestamp order. Entropy uses `Math.random`; use a cryptographic token generator for bearer credentials. Format validation does not prove uniqueness or origin; use a uniqueness constraint where your storage requires one.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
