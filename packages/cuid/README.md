# @omnitron-dev/cuid

> Collision-resistant unique ID generation

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/cuid
```

## Overview

A fast, collision-resistant unique identifier generator. Produces URL-safe, monotonically sortable IDs suitable for distributed systems where coordination-free ID generation is required.

## Quick Start

```typescript
import { cuid } from '@omnitron-dev/cuid';

const id = cuid(); // e.g. "clh3k7v0a0000..."
```

## License

MIT
