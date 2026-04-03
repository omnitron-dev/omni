---
module: common
title: "Common Utilities"
tags: [utilities, predicates, promises, primitives]
summary: "Essential zero-dependency utilities: type predicates, promise helpers, timed maps, decimal math"
---

## What This Package Provides

Foundational utilities used by every other package. Zero dependencies, cross-runtime.

## Key Exports

- **predicates** — Type guards: `isString()`, `isObject()`, `isFunction()`, `isNil()`, `isPromise()`, etc.
- **primitives** — Primitive type utilities
- **promise** — Promise helpers (deferred, timeout, retry)
- **p-limit** — Concurrency control: `pLimit(concurrency)` → limits parallel async operations
- **timed-map** — Map with TTL: entries auto-expire after specified timeout
- **list-buffer** — Circular buffer implementation for fixed-size collections
- **decimal** — Safe decimal arithmetic (avoids floating-point issues)
- **omit** — Object property omission (like lodash.omit but lightweight)
- **entries** — Object key/value manipulation utilities

## Usage Pattern
```typescript
import { isString, isNil } from '@omnitron-dev/common';
import { pLimit } from '@omnitron-dev/common';

// Type guards
if (isString(value)) { /* value is string */ }

// Concurrency limiting
const limit = pLimit(5);
const results = await Promise.all(urls.map(url => limit(() => fetch(url))));
```
