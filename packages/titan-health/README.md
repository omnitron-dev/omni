# @omnitron-dev/titan-health

Compose health indicators and expose application liveness, readiness and operational reports.

## Capabilities

- Custom indicators for databases, Redis and external dependencies.
- Aggregated health status and configurable check timeouts.
- Optional Netron RPC with separate access to detailed reports.

## Quick start

```sh
pnpm add @omnitron-dev/titan-health
```

```ts
import { TitanHealthModule } from '@omnitron-dev/titan-health';

export const health = TitanHealthModule.forRoot({ detailRpcRoles: ['operator'] });
```

Add this dynamic module to the `imports` of an existing Titan application.

On `Health@1.0.0`, `live()` and `ready()` allow anonymous probes and return status and timestamp. With `detailRpcRoles`, detailed reports require an admitted matching role. Omitting that option leaves health RPCs public; set `enableRpcService: false` to disable RPC exposure.

The Redis indicator accepts a raw client such as `RedisManager.getClient()`. It requires the exact `PONG` reply. Reported latency covers the application’s round trip, including local scheduling. Optional memory diagnostics use the remaining check timeout.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
