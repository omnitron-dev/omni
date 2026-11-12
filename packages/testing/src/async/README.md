# Async test helpers

Import these helpers from `@omnitron-dev/testing/async`. They coordinate asynchronous tests, observe events, and bound how long an assertion waits.

```ts
import { createDeferred, withTimeout } from '@omnitron-dev/testing/async';

const ready = createDeferred<string>();
const result = withTimeout(ready.promise, 1_000, 'Service did not become ready');
ready.resolve('ready');
await result;
```

| Helper | Purpose |
| --- | --- |
| [`createDeferred`, `DeferredPromise`, `defer`](deferred.ts) | Explicitly resolve or reject a promise |
| [`waitFor`, `waitForCondition`, `delay`, `flushPromises`](wait.ts) | Poll a condition or advance asynchronous work |
| [`retry`, `withTimeout`](retry.ts) | Retry an operation or time out waiting for a promise |
| [Event trackers and collectors](events.ts) | Record calls and await event sequences |
| [Mock timer controller](mock-timer.ts) | Manage fake timers in a test |

`withTimeout` rejects the wait; it does not cancel the underlying operation. `waitFor` checks its deadline between condition evaluations, so the condition must itself settle. Always release resources owned by the operation in teardown.

The current `retry` option named `retries` is the total attempt count, including the first attempt. Its default is three attempts. Choose explicit bounds for tests that exercise failure paths.

[The export list](index.ts) defines the available functions and types.
