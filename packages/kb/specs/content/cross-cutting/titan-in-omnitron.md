---
module: cross-cutting
title: "How Titan Modules Are Used in Omnitron"
tags: [titan, omnitron, integration, architecture, daemon]
summary: "Mapping of Titan framework modules to their Omnitron daemon roles"
---

## Architecture

Omnitron IS a Titan Application that manages other Titan Applications.

```
omnitron daemon = Application.create() + DaemonModule
  ├── ConfigModule (titan)         → ecosystem config loading
  ├── LoggerModule (titan)         → pino structured logging + rotation
  ├── TitanAuthModule (titan-auth) → JWT validation for RPC
  ├── ProcessManagerModule (titan-pm) → child process supervision
  ├── SchedulerModule (titan-scheduler) → cron jobs
  ├── TitanMetricsModule (titan-metrics) → prometheus-style metrics
  ├── TitanHealthModule (titan-health)   → health indicators
  └── DaemonModule providers:
      ├── OrchestratorService   → app lifecycle management
      ├── LogManager            → log routing, rotation, persistence
      ├── StateStore            → daemon state persistence
      └── ... (fleet, deploy, cluster, etc.)
```

## Two Netron Instances Per Child Process
- **Management plane**: Unix socket for PM control messages (ready/error/shutdown)
- **Data plane**: HTTP/WS for actual RPC traffic between services

## Process Lifecycle
1. `omnitron up` → daemon starts as Titan Application
2. Reads `omnitron.config.ts` → discovers app definitions
3. For each app: ProcessManager.fork() with `--import tsx/esm`
4. Child runs its own Application.create() with its own DI container
5. Parent ↔ child communicate via IPC (control) + Netron RPC (data)

## Key Integration Points
- `invocationWrapper` bridges authContext → RLS AsyncLocalStorage for every RPC call
- JWT cross-service: Main issues JWT → storage/messaging validate via AuthenticationManager
- Titan LoggerService `destinations` option enables multistream (stdout + file)
- All DI tokens use `Symbol.for('titan:...')` — dual-package hazard prevention
