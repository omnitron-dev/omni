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

## Output capture

Subscribe to `process:output` **before** spawning applications to receive output during startup, after readiness, and from replacement pool workers:

```ts
const manager = new ProcessManager(logger, { forwardChildLogs: false });
manager.on('process:output', (name, line, stream, capture) => {
  journal.append({ name, line, ...capture });
});
```

The callback is synchronous. Persist the input before returning; throwing pauses that pipe and retries the same frame with the same ID. An asynchronous callback is not a persistence acknowledgment. The consumer owns durable storage, capacity monitoring and final database acknowledgment; Titan PM owns process output capture.

`capture` carries `id`, `processId`, `stream`, `sequence` and `capturedAt`. Capture time is the parent's wall-clock time when it reads the first bytes, not proof of when an unstructured message was generated inside the child. Structured source timestamps can be retained separately. UTF-8 characters split across chunks, blank lines and an unterminated final line survive framing. Stdout and stderr retain distinct identities; their order reflects reads by the parent, not a universal clock across processes.

Forks and worker threads use the same reader from startup through termination. `WorkerHandle.onLog` accepts the same context as an optional third argument. Its optional pre-listener replay is bounded; use `process:output` for a durable consumer. Set `forwardChildLogs: false` when routing records yourself to avoid also forwarding them through the parent's logger. Physical lines above 256 KiB are delivered in fragments with explicit fragment metadata; consumers must preserve these boundaries rather than treating them as independent application events.

## License

MIT
