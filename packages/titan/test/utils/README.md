# Titan test utilities

These helpers belong to Titan's repository tests. They are not a published `@omnitron-dev/titan/test/utils` entry point. Reusable package-level fixtures are available from [`@omnitron-dev/testing`](../../../testing/README.md).

[The local barrel](index.ts) exports three groups:

- [Transport helpers](transport-test-utils.ts): test servers, port selection, and transport coordination.
- [Error assertions](error-test-utils.ts): checks for Titan error codes, details, and asynchronous failures.
- [Timing helpers](timing-test-utils.ts): bounds scaled against a reference workload.

A returned free port is not reserved until the server binds it. Prefer fixture-owned listeners and close them in teardown. Timing ratios can catch large regressions but cannot prove that work was skipped; count operations when that is the property under test.

Use the shared testing package's Docker fixtures for infrastructure ownership. Helpers outside this barrel must be imported explicitly and should not pull unrelated services into transport tests.

Run the relevant Titan test file through the package runner, for example:

```sh
pnpm --filter @omnitron-dev/titan exec vitest run test/utils/free-port.spec.ts
```
