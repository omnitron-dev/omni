# Adversarial test suite (T#78)

Tests in this directory exercise **failure-mode invariants** under
deliberately hostile conditions. They complement the per-fix
regression tests (which pin happy-path recipes) by pinning the
properties that must hold when things go wrong.

## When to add a test here

If your audit fix has the shape "we now do X to handle failure mode
Y," the regression test verifies the recipe runs. An adversarial
test in this directory should *force* Y and verify the invariant
the recipe is supposed to preserve.

Examples (from the seed):

| Fix             | Recipe (regression test pins)   | Invariant (adversarial test pins)            |
| --------------- | ------------------------------- | --------------------------------------------- |
| T#55 StateStore | tmp → fsync → rename works      | torn write leaves prior state intact          |
| T#55 StateStore | rename failure cleans up tmp    | repeated failures don't leak temp siblings    |

## Primitives (`./flaky-fs.ts`)

Programmable fault injection on Node's `fs` sync APIs. Each fault
mode is one entry on a queue:

- `truncate-write` — writes only the first N bytes then throws.
  Simulates SIGKILL caught mid-`write(2)` syscall.
- `fail-write` — throws a supplied `ErrnoException` without
  touching the FD. Simulates ENOSPC / EIO / EBUSY.
- `rename-eperm` — `renameSync` throws EPERM. Simulates the
  window between "tmp written" and "rename committed" under quota
  pressure.

```ts
import { installFlakyFs } from './flaky-fs.js';

const flaky = installFlakyFs([
  { kind: 'truncate-write', afterBytes: 8 },
  { kind: 'rename-eperm' },
]);
try {
  // ... drive the system under test, expect compound failure ...
} finally {
  flaky.restore();
}
```

## Conventions

- One test file per `<subsystem>-<failure>.spec.ts` (e.g.
  `state-store-torn-write.spec.ts`).
- Every test arms its faults in `beforeEach` and disarms them in
  `afterEach` via `flaky.restore()`. Leaking patches across tests
  poisons the runner.
- Where the production code path is the same as a regression test,
  cross-reference both in the file header so future maintainers can
  see the pair.

## Why not real chaos (real SIGKILL / real disk-full)?

Real failure injection at the syscall level can only happen with
elevated privileges or test-runner support that this codebase
doesn't yet have. Simulated failures via fs-method patching cover
~95% of the invariants we care about — the remaining 5% (true
power-loss, kernel-level reordering) need their own machinery and
aren't in T#78's scope.
