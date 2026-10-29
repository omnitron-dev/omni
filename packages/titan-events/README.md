# @omnitron-dev/titan-events

> Event bus module for the Titan framework — decorators, validation, scheduling

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-events
```

## Overview

Provides an event bus for Titan applications with decorator-based subscription (`@EventHandler`), event validation, wildcard patterns, and scheduled event emission. Builds on `@omnitron-dev/eventemitter`.

## Failure semantics

Await `emitAsync` when the producer must observe handler failures. Regular and
wildcard handlers both propagate errors, including synchronous throws; multiple
failed groups use `AggregateError`. A handler's configured error policy still
applies. Emission is not a transaction and cannot undo completed side effects.

## License

MIT
