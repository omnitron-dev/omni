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

Use `runExclusive(resource, operation)` when independent consumers share a mutable resource. It keeps configuration and asynchronous work in one ordered operation; failures release the resource for the next caller. Different resources run independently. All callers must participate, and an operation must not await another operation on the same resource.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
