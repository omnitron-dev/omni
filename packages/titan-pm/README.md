# @omnitron-dev/titan-pm

Process supervision and worker pools for Titan applications.

## Capabilities

- Child-process and worker-thread execution with typed startup options.
- Restart strategies, bounded backoff and explicit stop precedence.
- Worker pools, runtime resizing and captured process output.

## Quick start

```sh
pnpm add @omnitron-dev/titan-pm
```

```ts
import { ProcessManagerModule } from '@omnitron-dev/titan-pm';

export const pm = ProcessManagerModule.forRoot({});
```

Add this dynamic module to the `imports` of an existing Titan application.

Use `ProcessManager.spawn` with an explicit `cwd` and lifecycle budgets. Child processes honor their directory; worker threads share the parent's directory and reject a different one. Keep mutable files outside sealed runtime directories.

`beforeSpawn` is an optional parent-only admission callback. The manager awaits it before native spawn or process registration and never sends it to the child. Supervisor and pool recovery retain it. Refusing a pool replacement leaves the old worker serving; failed initial pool creation cleans up admitted workers and reports any unconfirmed termination without losing manager ownership.

Supervisors retain failed declarations for explicit recovery. `stop()` cancels backoff and joins an in-flight spawn before collecting children. `maxRestarts: 0` disables automatic recovery.

`await pool.scale(size)` acknowledges the observed worker count after admitted membership changes settle. Zero preserves an empty pool. Partial failure rejects with the surviving state; inspect it before retrying. Retirement stops new admission before draining, and requests with unknown outcomes are never replayed automatically.

`pool:membership-settled` reports completion of a resize or replacement attempt, including rejection. Read `membershipChanging` and the current worker IDs: a queued successor or unconfirmed retirement can still be active. This event alone does not establish readiness or provenance.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
