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

## Recovery contract

A supervisor retries noncritical startup failures and failures during crash recovery with the same restart budget and backoff as runtime crashes. `maxRestarts: 0` disables automatic retries. Required critical children fail initial startup immediately; later recovery remains governed by the configured policy.

Recovery is serialized per supervisor, preserving declaration order for `ONE_FOR_ALL` and `REST_FOR_ONE`. `stop()` cancels backoff and waits for an in-flight spawn before collecting and stopping children. A failed child retains its declaration, so `restartChild(name)` can explicitly retry it.

Observe `child:start-failed` for the original exception, `child:restart` for each attempt, `child:started` for readiness, and `child:recovery-stopped` when policy declines further attempts. A critical budget exhaustion emits `escalate`. A successful sibling does not establish that the entire application is ready.

## License

MIT
