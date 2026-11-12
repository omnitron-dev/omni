# @omnitron-dev/netron-http-core

Shared HTTP request composition for Titan transports and Netron browser clients. Applications normally use the client API; transport authors implement `IHttpRequestExecutor`.

## Capabilities

- Fluent request builders with input, deadlines and execution options.
- Reusable cache and retry managers.
- Configurable service proxies.

## Quick start

```sh
pnpm add @omnitron-dev/netron-http-core
```

```ts
import { QueryBuilder, type IHttpRequestExecutor } from '@omnitron-dev/netron-http-core';

export function readDevice(transport: IHttpRequestExecutor, id: string) {
  return new QueryBuilder(transport, 'Devices')
    .method('get')
    .input({ id })
    .timeout(5_000)
    .execute();
}
```

Scope shared cache entries to the caller's authority. Enable retries only for operations whose service contract permits repetition; a transport failure can leave the outcome unknown.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
