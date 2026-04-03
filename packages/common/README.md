# @omnitron-dev/common

> Shared utilities — type predicates, promise helpers, object tools, data structures

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/common
```

## Overview

A comprehensive utility library providing type-safe primitives for everyday TypeScript development. Works in both Node.js and Bun.

### What's Inside

- **Type predicates** — `isString`, `isNumber`, `isPlainObject`, `isNil`, `isPromise`, 50+ more with proper type narrowing
- **Promise utilities** — `defer`, `delay`, `timeout`, `retry` (with backoff), `props`, `promisify`/`callbackify`
- **Object utilities** — `omit` (deep, path-based, predicate), `entries`/`keys`/`values` with options
- **Data structures** — `ListBuffer` (O(1) queue), `TimedMap` (auto-expiring cache)
- **Primitives** — `noop`, `identity`, `truly`, `falsely`, `arrify`
- **Platform detection** — `isWindows`, `darwin`, `linux`, `isNodejs`

## Quick Start

```typescript
import { isString, delay, omit, retry } from '@omnitron-dev/common';

if (isString(value)) {
  console.log(value.toUpperCase()); // narrowed to string
}

await delay(1000);

const safe = omit(user, ['password', 'ssn']);

const data = await retry(() => fetch('/api'), { max: 3, backoffBase: 1000 });
```

## License

MIT
