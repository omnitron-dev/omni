# @omnitron-dev/common

Shared TypeScript primitives used throughout Omni. Import small utilities directly; the separate process-identity entry is for Node.js host inspection.

## Capabilities

- Type predicates, object selection and typed entry helpers.
- Promise coordination, bounded concurrency, delays and retries.
- List buffers, expiring maps, decimal helpers and errors.

## Quick start

```sh
pnpm add @omnitron-dev/common
```

```ts
import { isString, omit } from '@omnitron-dev/common';

const value: unknown = 'hello';
if (isString(value)) console.log(value.toUpperCase());

const publicRecord = omit({ id: '42', password: 'private' }, ['password']);
```

`@omnitron-dev/common/process-identity` provides host boot and native process lifetime observations on supported operating systems. Keep that Node-only entry outside browser bundles.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
