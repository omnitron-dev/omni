---
title: "DI Singleton Hazard in Factory Providers"
severity: critical
tags: [di, singleton, scope, nexus, gotcha]
---

## Problem
Factory providers in `daemon.module.ts` default to transient scope,
creating new instances on each resolution. Services like OrchestratorService,
LogManager must be singletons — multiple instances cause state divergence and resource leaks.

## Fix
All daemon factory providers MUST use `scope: Scope.Singleton`:

```typescript
@Module({
  providers: [
    {
      provide: ORCHESTRATOR_TOKEN,
      useFactory: (pm, logger) => new OrchestratorService(pm, logger),
      inject: [PM_TOKEN, LOGGER_TOKEN],
      scope: Scope.Singleton,  // MANDATORY
    },
  ],
})
export class DaemonModule {}
```

## Affected Services
OrchestratorService, MetricsService, HealthService, LogManager, StateStore —
all MUST be singletons in the daemon.
