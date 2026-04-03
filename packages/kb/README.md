# @omnitron-dev/kb

> Knowledge base framework — code intelligence, semantic search, and documentation

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/kb
```

## Overview

Provides tooling for extracting, indexing, and querying knowledge from codebases. Used by the Omnitron CLI to build searchable documentation from Titan ecosystem packages.

### Key Features

- **Code extraction** — parse TypeScript sources into structured knowledge entries
- **Semantic indexing** — build searchable indexes from extracted knowledge
- **Configurable** — per-package `kb.config.ts` for extraction rules

## Usage

```bash
# Extract knowledge from all packages
pnpm kb:extract

# Build index
pnpm kb:index
```

## License

MIT
