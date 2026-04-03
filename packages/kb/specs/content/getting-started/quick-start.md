---
module: getting-started
title: "Quick Start Guide"
tags: [getting-started, setup, commands, basics]
summary: "Essential commands and first steps for working with the Omnitron monorepo"
---

## Setup

```bash
# Install dependencies
pnpm install

# Build all packages (respects dependency order via turbo)
pnpm build

# Development mode (watch)
pnpm dev

# Run all tests
pnpm test

# Fix linting and formatting (ALWAYS before commits)
pnpm fix:all
```

## Runtime Requirements
- **Node.js** >=22.0.0 (primary)
- **Bun** >=1.2.0 (fully supported)
- **Deno** (experimental)
- **PostgreSQL** (for apps with DB)
- **Redis** (for caching, messaging, discovery)

## Import Rules

```typescript
// CORRECT — use package.json exports
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { Container } from '@omnitron-dev/titan/nexus';

// WRONG — breaks tree-shaking
import { ConfigModule } from '@omnitron-dev/titan';
```

## Omnitron CLI

```bash
# Start daemon + all apps
omnitron up

# Infrastructure (Docker)
omnitron infra up
omnitron infra status

# App management
omnitron start [app]
omnitron stop [app]
omnitron logs [app] -f

# Knowledge base (AI assistants)
omnitron kb index
omnitron kb mcp
```

## Versioning
```bash
pnpm changeset    # Create changeset for version management
```
