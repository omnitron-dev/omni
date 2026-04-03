# @omnitron-dev/titan-pm

> Process manager module for the Titan framework

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-pm
```

## Overview

Process supervision, worker pools, and lifecycle management for Titan applications. Handles forking child processes, IPC communication, graceful shutdown (SIGTERM/SIGKILL), and configurable startup timeouts.

### Key Features

- Process supervisor with restart policies
- Worker pool management with configurable concurrency
- IPC-based control plane between parent and children
- Health monitoring and automatic recovery
- Configurable startup timeouts per process

## License

MIT
