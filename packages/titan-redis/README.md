# @omnitron-dev/titan-redis

> Redis connection management for the Titan framework

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-redis
```

## Overview

Provides Redis connectivity for Titan applications with connection management, clustering support, health checks, and DB index separation. Used as the foundation for cache, lock, discovery, rate-limit, and scheduler modules.

### DB Index Convention

| App/Module | DB Index |
|-----------|----------|
| Main | 0 |
| Storage | 1 |
| Messaging | 2 |
| Priceverse | 3 |
| PaySys | 4 |

## License

MIT
