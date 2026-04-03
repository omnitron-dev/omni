# @omnitron-dev/eventemitter

> Async event emitter with parallel, serial, and reduce emission patterns

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/eventemitter
```

## Overview

Built on top of eventemitter3, this package adds async-first emission patterns with configurable concurrency control. Used internally throughout Titan and Netron for decoupled, event-driven communication.

### Key Features

- **Emission patterns** — `emitParallel`, `emitSerial`, `emitReduce`, `emitReduceRight`
- **Concurrency control** — limit concurrent listener executions
- **Subscription management** — `subscribe()` returns an unsubscribe function
- **Cross-platform** — works in Node.js and browsers

## Quick Start

```typescript
import { EventEmitter } from '@omnitron-dev/eventemitter';

const emitter = new EventEmitter();

emitter.on('user:login', async (user) => {
  await analytics.track('login', user);
});

await emitter.emitParallel('user:login', { id: 123 });
```

## License

MIT
