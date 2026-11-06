# @omnitron-dev/kb

> Knowledge base framework — code intelligence, semantic search, and documentation

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/kb
```

## Overview

Provides tooling for extracting, indexing, and querying knowledge from codebases. Used by the Omnitron CLI to build searchable documentation from Titan ecosystem packages.

The published archive includes the `ts-morph` extraction toolchain and its resolved
dependencies from the workspace lockfile. This preserves the corrected `minimatch`
version when installing with npm or pnpm, without requiring consumer overrides.
The public `./extractors` API and `kb-extract` command use that same toolchain.
Publication checks install the actual archives in an independent consumer, audit
its production dependency tree and extract a real TypeScript project.

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
