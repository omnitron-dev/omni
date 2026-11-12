# State-store fault injection

This directory checks state-store writes when filesystem operations fail partway through. The tests exercise the production store with isolated temporary files.

[State-store torn-write tests](state-store-torn-write.spec.ts) cover incomplete writes and failed renames. [The fault helper](flaky-fs.ts) can truncate a write before throwing, throw a supplied filesystem error, or reject a rename with `EPERM`.

These are in-process fault simulations. They do not establish recovery from an actual process kill, power loss, or storage-device failure. Native process and runtime checks live in [the runtime fixtures](../runtime/).

Always restore patched filesystem methods in teardown or `finally`:

```ts
import { installFlakyFs } from './flaky-fs.js';

const faults = installFlakyFs([{ kind: 'rename-eperm' }]);
try {
  // Exercise a store operation and check both the error and persisted state.
} finally {
  faults.restore();
}
```

From the repository root:

```sh
pnpm --filter @omnitron-dev/omnitron exec vitest run test/adversarial/state-store-torn-write.spec.ts
```
