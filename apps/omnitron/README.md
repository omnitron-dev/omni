# @omnitron-dev/omnitron

> Production-grade application supervisor and CLI

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Overview

Omnitron is the main entry point for running and managing Titan-based applications. It provides a CLI (`omnitron dev`, `omnitron logs`, etc.) and a process management pipeline that forks child processes, captures structured logs, and exposes both management and data plane Netron RPC interfaces.

Key responsibilities:

- Application lifecycle — start, stop, restart, health monitoring
- Process supervision with configurable startup timeouts and worker pools
- Structured logging with pino, per-app log files, and size-based rotation
- Dual Netron planes — Unix socket management + HTTP data plane per child
- Configuration via `omnitron.config.ts` at the monorepo root

## Usage

```bash
# Link globally
pnpm link:global

# Run in dev mode
omnitron dev

# View logs
omnitron logs
omnitron logs --level warn --grep "error"
```

## License

MIT
