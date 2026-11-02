# @omnitron-dev/netron-http-core

Use these primitives when implementing an HTTP transport for Netron. Titan and the Netron browser client already expose the fluent query API to applications.

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

Implement `IHttpRequestExecutor` to send requests over your transport. Pass an `HttpCacheManager` and a `RetryManager` to the builder when queries need caching or retries. Scope shared cached results to the caller's access and mark a request idempotent only when the service guarantees that repeating it is safe. Use `ConfigurableProxy` to apply query options across calls to a service.

[HTTP protocol reference](https://omnitron.dev/docs/reference/protocol)
