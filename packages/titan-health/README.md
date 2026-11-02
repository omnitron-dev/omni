# @omnitron-dev/titan-health

> Health check module for the Titan framework

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-health
```

## Overview

Extensible health check system for Titan applications. Register custom health indicators (database, Redis, external APIs) and expose aggregated health status via RPC or HTTP endpoints.

## RPC access

Set `detailRpcRoles` in `TitanHealthModule.forRoot` or in the options returned by a `forRootAsync` factory. Use roles issued by the application's Netron authentication provider.

```ts
TitanHealthModule.forRoot({ detailRpcRoles: ['operator', 'observer'] })
```

On `Health@1.0.0`, `live()` and `ready()` accept anonymous probes and return status and timestamp. Reading the full report, indicator details, indicator list, uptime or aggregate health requires one of the configured roles. Omitting the option preserves public health RPCs. To disable RPC exposure entirely, set `enableRpcService: false` at module registration.

## License

MIT
