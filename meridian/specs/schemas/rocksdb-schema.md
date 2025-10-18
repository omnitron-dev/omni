# Meridian RocksDB Schema Specification

**Version**: 2.0.0
**Created**: October 18, 2025
**Last Updated**: October 18, 2025
**Status**: Production

---

## Overview

This document provides the **single source of truth** for all RocksDB schemas used in Meridian. It consolidates and reconciles schema definitions from:

- Core specification (spec.md, lines 514-531) - v1.0 schema
- Global architecture specification (global-architecture-spec.md, lines 1188-1277) - v2.0 schema

---

## Schema Versions

### Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| v1.0 | Oct 2025 | Initial single-monorepo schema | Superseded |
| v2.0 | Oct 2025 | Global multi-monorepo schema | **Current** |

### Migration Path

- **v1.0 → v2.0**: Automatic migration via `meridian migrate --to-global`
- **Backward compatibility**: v2.0 can read v1.0 databases

---

## v2.0 Global Schema (Current)

### Storage Locations

**Global Database**: `~/.meridian/data/` (RocksDB)
**Local Cache**: `[monorepo-path]/.meridian/cache.db/` (RocksDB)

---

## Global Database Schema

### Project Registry

**Purpose**: Track all projects and monorepos across the system

```
# Project Registry
registry:projects:{fullId}                    → ProjectRegistry (JSON)
registry:index:name:{projectName}             → fullId[]
registry:index:monorepo:{monorepoId}          → fullId[]
registry:index:path:{pathHash}                → fullId
```

**Key Format Examples**:
```
registry:projects:@omnitron-dev/titan@1.0.0   → {...}
registry:index:name:titan                      → ["@omnitron-dev/titan@1.0.0"]
registry:index:monorepo:omnitron-dev          → ["@omnitron-dev/titan@1.0.0", ...]
registry:index:path:a1b2c3d4                  → "@omnitron-dev/titan@1.0.0"
```

**Value Schema** (`ProjectRegistry`):
```typescript
interface ProjectRegistry {
  identity: {
    id: string;                          // "@omnitron-dev/titan"
    version: string;                     // "1.0.0"
    fullId: string;                      // "@omnitron-dev/titan@1.0.0"
    contentHash: string;                 // SHA256 of manifest
    type: "npm" | "cargo" | "generic";
  };
  currentPath: string;                   // Current absolute path
  pathHistory: {
    path: string;
    timestamp: Date;
    reason: "discovered" | "relocated" | "auto-detected";
  }[];
  monorepo?: {
    id: string;                          // Monorepo ID
    path: string;                        // Path to monorepo root
    relativePath: string;                // Relative path within monorepo
  };
  metadata: ProjectMetadata;
  indexing: {
    lastIndexed: Date;
    indexVersion: string;
    status: "indexed" | "indexing" | "error" | "pending";
    errorMessage?: string;
  };
  status: "active" | "moved" | "deleted" | "stale";
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}
```

---

### Monorepo Registry

**Purpose**: Track all monorepos and their metadata

```
# Monorepo Registry
registry:monorepos:{monorepoId}               → MonorepoInfo (JSON)
registry:monorepos:index:path:{pathHash}      → monorepoId
```

**Key Format Examples**:
```
registry:monorepos:omnitron-dev               → {...}
registry:monorepos:index:path:e5f6g7h8        → "omnitron-dev"
```

**Value Schema** (`MonorepoInfo`):
```typescript
interface MonorepoInfo {
  id: string;                            // "omnitron-dev"
  name?: string;                         // "Omnitron Development"
  contentHash: string;                   // SHA256 of root manifest
  type: "pnpm" | "npm" | "yarn" | "cargo" | "mixed";
  currentPath: string;
  pathHistory: PathHistoryEntry[];
  projectCount: number;
  lastIndexed: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

---

### Symbols Index

**Purpose**: Store all code symbols from all projects

```
# Symbols (all symbols from all projects)
symbols:{projectFullId}:{symbolId}            → ExtractedSymbol (JSON)
symbols:index:name:{symbolName}               → {projectFullId:symbolId}[]
symbols:index:kind:{kind}:{projectFullId}     → symbolId[]
```

**Key Format Examples**:
```
symbols:@omnitron-dev/titan@1.0.0:Application → {...}
symbols:index:name:Application                → ["@omnitron-dev/titan@1.0.0:Application", ...]
symbols:index:kind:class:@omnitron-dev/titan@1.0.0 → ["Application", "Module", ...]
```

**Value Schema** (`ExtractedSymbol`):
```typescript
interface ExtractedSymbol {
  id: string;                            // Unique symbol ID
  name: string;                          // Symbol name
  kind: SymbolKind;                      // function, class, interface, etc.
  signature: string;                     // Only signature without body
  bodyHash: string;                      // Hash of implementation
  location: {
    file: string;
    line: number;
    column: number;
  };
  references: Reference[];
  dependencies: string[];                // Other symbol IDs
  metadata: {
    complexity: number;                  // Cyclomatic complexity
    tokenCost: number;                   // Cost in tokens
    lastModified: GitCommit;
    authors: string[];
    docComment?: string;
    testCoverage?: number;
    usageFrequency: number;
  };
}

type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "enum"
  | "module";
```

---

### Documentation Index

**Purpose**: Store generated documentation for all symbols

```
# Documentation
docs:{projectFullId}:{symbolId}               → GeneratedDocumentation (JSON)
docs:quality:{projectFullId}:{symbolId}       → DocumentationQuality (JSON)
```

**Key Format Examples**:
```
docs:@omnitron-dev/titan@1.0.0:Application    → {...}
docs:quality:@omnitron-dev/titan@1.0.0:Application → {...}
```

**Value Schema** (`GeneratedDocumentation`):
```typescript
interface GeneratedDocumentation {
  symbolId: string;
  projectId: string;
  format: "tsdoc" | "jsdoc" | "rustdoc";
  content: string;                       // Markdown documentation
  summary: string;                       // One-line summary
  description: string;                   // Detailed description
  parameters?: ParameterDoc[];
  returns?: ReturnDoc;
  examples?: CodeExample[];
  seeAlso?: string[];                    // Related symbols
  generatedAt: Date;
  generator: string;                     // "meridian-strong-v1.0.0"
}
```

---

### Examples Index

**Purpose**: Store generated code examples

```
# Examples
examples:{projectFullId}:{symbolId}           → GeneratedExample[] (JSON)
examples:validation:{projectFullId}:{symbolId}→ ExampleValidation (JSON)
```

**Key Format Examples**:
```
examples:@omnitron-dev/titan@1.0.0:Application → [...]
examples:validation:@omnitron-dev/titan@1.0.0:Application → {...}
```

**Value Schema** (`GeneratedExample`):
```typescript
interface GeneratedExample {
  id: string;
  symbolId: string;
  projectId: string;
  complexity: "basic" | "intermediate" | "advanced";
  language: "typescript" | "javascript" | "rust" | "python";
  code: string;
  description: string;
  setup?: string;                        // Setup code
  teardown?: string;                     // Cleanup code
  dependencies?: string[];
  validation: {
    syntax: boolean;
    compiles: boolean;
    errors?: string[];
  };
  generatedAt: Date;
}
```

---

### Tests Index

**Purpose**: Store generated tests

```
# Tests
tests:{projectFullId}:{symbolId}              → GeneratedTest[] (JSON)
tests:validation:{projectFullId}:{symbolId}   → TestValidation (JSON)
```

**Key Format Examples**:
```
tests:@omnitron-dev/titan@1.0.0:Application   → [...]
tests:validation:@omnitron-dev/titan@1.0.0:Application → {...}
```

**Value Schema** (`GeneratedTest`):
```typescript
interface GeneratedTest {
  id: string;
  symbolId: string;
  projectId: string;
  testType: "unit" | "integration" | "e2e";
  framework: "jest" | "vitest" | "bun" | "rust";
  name: string;
  code: string;
  description: string;
  setup?: string;
  teardown?: string;
  expectedCoverage?: number;
  validation: {
    syntax: boolean;
    compiles: boolean;
    runs?: boolean;
    passes?: boolean;
    errors?: string[];
  };
  generatedAt: Date;
}
```

---

### Cross-References Index

**Purpose**: Track references between projects across monorepos

```
# Cross-References (cross-monorepo links)
xref:{sourceFullId}:{targetFullId}            → CrossReference[] (JSON)
xref:incoming:{targetFullId}                  → IncomingReference[] (JSON)
xref:outgoing:{sourceFullId}                  → OutgoingReference[] (JSON)
```

**Key Format Examples**:
```
xref:@company/ui-kit@1.0.0:@company/auth-lib@1.0.0 → [...]
xref:incoming:@company/auth-lib@1.0.0         → [...]
xref:outgoing:@company/ui-kit@1.0.0           → [...]
```

**Value Schema** (`CrossReference`):
```typescript
interface CrossReference {
  id: string;
  sourceProject: string;                 // Full project ID
  targetProject: string;                 // Full project ID
  sourceSymbol: string;
  targetSymbol: string;
  referenceType: "import" | "call" | "extend" | "implement" | "type";
  location: SourceLocation;
  context?: string;                      // Surrounding code
  monorepo: {
    source: string;                      // Source monorepo ID
    target: string;                      // Target monorepo ID
  };
}
```

---

### Dependencies Index

**Purpose**: Global dependency graph across all projects

```
# Dependencies (dependency graph)
deps:incoming:{projectFullId}                 → DependentProject[] (JSON)
deps:outgoing:{projectFullId}                 → DependencyProject[] (JSON)
deps:graph                                    → GlobalDependencyGraph (JSON)
```

**Key Format Examples**:
```
deps:incoming:@company/auth-lib@1.0.0         → [...]
deps:outgoing:@company/ui-kit@1.0.0           → [...]
deps:graph                                    → {...}
```

**Value Schema**:
```typescript
interface DependentProject {
  projectId: string;                     // Who depends on this project
  version: string;
  type: "dependency" | "devDependency" | "peerDependency";
}

interface DependencyProject {
  projectId: string;                     // What this project depends on
  version: string;
  type: "dependency" | "devDependency" | "peerDependency";
  isExternal: boolean;                   // From npm registry vs local
}

interface GlobalDependencyGraph {
  nodes: {
    id: string;                          // Full project ID
    type: "project" | "external";
    monorepo?: string;
  }[];
  edges: {
    from: string;
    to: string;
    type: "dependency" | "devDependency";
    version: string;
  }[];
  lastUpdated: Date;
}
```

---

### Metadata

**Purpose**: Global system metadata

```
# Metadata
meta:index_version                            → string
meta:last_global_sync                         → timestamp
meta:statistics                               → GlobalStatistics (JSON)
```

**Value Schema**:
```typescript
interface GlobalStatistics {
  totalProjects: number;
  totalMonorepos: number;
  totalSymbols: number;
  totalDocumentation: number;
  totalExamples: number;
  totalTests: number;
  indexVersion: string;
  lastUpdate: Date;
  storageSize: {
    total: number;                       // Bytes
    symbols: number;
    docs: number;
    examples: number;
    tests: number;
  };
}
```

---

## Local Cache Schema

**Location**: `[monorepo-path]/.meridian/cache.db/`

### Local Symbol Cache

```
# Local Cache (symbols from current monorepo)
cache:symbols:{projectId}:{symbolId}          → CachedSymbol (JSON)
cache:docs:{projectId}:{symbolId}             → CachedDocumentation (JSON)
```

**Key Format Examples**:
```
cache:symbols:titan:Application               → {...}
cache:docs:titan:Application                  → {...}
```

---

### External Dependency Cache

```
# External Cache (cached external dependencies)
cache:external:{externalProjectId}:docs       → ExternalDocs (JSON)
cache:external:{externalProjectId}:symbols    → ExternalSymbols (JSON)
```

**Key Format Examples**:
```
cache:external:@company/auth-lib@1.0.0:docs   → {...}
cache:external:@company/auth-lib@1.0.0:symbols → {...}
```

---

### Query Result Cache

```
# Query Cache (cached search results)
cache:query:search:{queryHash}                → SearchResult (JSON)
cache:query:xref:{symbolId}                   → CrossReference[] (JSON)
```

**Key Format Examples**:
```
cache:query:search:a1b2c3d4e5f6              → {...}
cache:query:xref:Application                  → [...]
```

---

### Sync State

```
# Sync State
sync:last_sync                                → timestamp
sync:pending_changes                          → PendingChange[] (JSON)
```

**Value Schema**:
```typescript
interface PendingChange {
  type: "create" | "update" | "delete";
  entity: "symbol" | "doc" | "example" | "test";
  projectId: string;
  entityId: string;
  timestamp: Date;
  data?: any;                            // Entity data if create/update
}
```

---

### Local Metadata

```
# Metadata
meta:monorepo_id                              → string
meta:cache_version                            → string
```

---

## v1.0 Schema (Legacy)

**Location**: `[monorepo-path]/.meridian/local.db/`

### Symbols

```
# v1.0 Schema (single-monorepo)
symbols:{symbolId}                            → Symbol (JSON)
symbols:index:name:{name}                     → symbolId[]
symbols:index:kind:{kind}                     → symbolId[]
```

### Documentation

```
docs:{symbolId}                               → Documentation (JSON)
```

### History

```
history:{symbolId}                            → Evolution (JSON)
```

### Session Data

```
session:{sessionId}                           → Session (JSON)
session:deltas:{sessionId}                    → Delta[] (JSON)
```

---

## Key Naming Conventions

### Prefixes

| Prefix | Purpose | Example |
|--------|---------|---------|
| `registry:` | Project and monorepo registry | `registry:projects:{id}` |
| `symbols:` | Code symbols | `symbols:{project}:{symbol}` |
| `docs:` | Documentation | `docs:{project}:{symbol}` |
| `examples:` | Code examples | `examples:{project}:{symbol}` |
| `tests:` | Generated tests | `tests:{project}:{symbol}` |
| `xref:` | Cross-references | `xref:{source}:{target}` |
| `deps:` | Dependencies | `deps:incoming:{project}` |
| `cache:` | Local cache | `cache:symbols:{project}:{symbol}` |
| `sync:` | Sync state | `sync:last_sync` |
| `meta:` | Metadata | `meta:index_version` |

### ID Formats

**Project Full ID**: `{scope}/{name}@{version}`
- Example: `@omnitron-dev/titan@1.0.0`

**Monorepo ID**: `{name}` or auto-generated
- Example: `omnitron-dev`

**Symbol ID**: `{symbolName}` (unique within project)
- Example: `Application`

**Path Hash**: SHA256 hash truncated to 8 chars
- Example: `a1b2c3d4`

---

## Index Patterns

### By Name

```
symbols:index:name:{symbolName}               → [{project}:{symbol}, ...]
```

Enables: Fast lookup by symbol name across all projects

### By Kind

```
symbols:index:kind:{kind}:{projectFullId}     → [symbolId, ...]
```

Enables: Filter symbols by type (class, function, etc.)

### By Project

```
registry:index:monorepo:{monorepoId}          → [fullId, ...]
```

Enables: List all projects in a monorepo

### By Path

```
registry:index:path:{pathHash}                → fullId
```

Enables: Resolve project by file path

---

## Data Types

### Common Types

```typescript
type Timestamp = string;                       // ISO 8601 format
type Hash = string;                            // SHA256 hex string
type Path = string;                            // Absolute file path

interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

interface GitCommit {
  hash: string;
  author: string;
  date: Date;
  message: string;
}

interface Reference {
  location: SourceLocation;
  kind: "import" | "call" | "type" | "extend" | "implement";
}
```

---

## Compression and Serialization

### JSON Serialization

All values are stored as JSON with the following settings:

```typescript
const serializeOptions = {
  indent: 0,                                   // Compact format
  sortKeys: true,                              // Consistent ordering
  replacer: dateReplacer,                      // ISO 8601 dates
};
```

### Compression

**Global DB**: Optional zstd compression (configurable)
**Local Cache**: No compression (fast access)

---

## Performance Considerations

### Write Patterns

**Batch Writes**: Group related updates
```typescript
const batch = db.batch();
batch.put('symbols:...', data1);
batch.put('symbols:index:...', data2);
await batch.write();
```

**Async Writes**: Non-blocking updates
```typescript
await db.put('symbols:...', data, { sync: false });
```

### Read Patterns

**Prefix Scan**: Efficient range queries
```typescript
for await (const [key, value] of db.iterator({
  gte: 'symbols:@omnitron-dev/',
  lt: 'symbols:@omnitron-dev/~'
})) {
  // Process
}
```

**Bloom Filters**: Fast negative lookups (RocksDB default)

### Cache Strategy

**Global DB**: Write-through cache
**Local Cache**: LRU eviction with TTL

---

## Migration Procedures

### v1.0 → v2.0

```bash
# Automatic migration
meridian migrate --to-global

# Steps:
# 1. Read v1.0 local.db
# 2. Generate project IDs
# 3. Register in global registry
# 4. Copy symbols to global DB with new keys
# 5. Create local cache from global DB
# 6. Backup v1.0 DB
```

**Data Transformation**:
```typescript
// v1.0 key
"symbols:Application"

// v2.0 global key
"symbols:@omnitron-dev/titan@1.0.0:Application"

// v2.0 local cache key
"cache:symbols:titan:Application"
```

---

## Schema Versioning

### Version Detection

```
meta:index_version → "v2.0.0"
```

### Compatibility Matrix

| DB Version | Meridian Version | Support |
|------------|------------------|---------|
| v1.0 | v1.x | ✅ Read/Write |
| v1.0 | v2.x | ✅ Read-only, auto-migrate |
| v2.0 | v1.x | ❌ Not supported |
| v2.0 | v2.x | ✅ Read/Write |

---

## References

- **Core Spec**: [spec.md](../spec.md) - Lines 514-531 (v1.0 schema)
- **Global Arch Spec**: [global-architecture-spec.md](../global-architecture-spec.md) - Lines 1188-1277 (v2.0 schema)
- **Strong Tools Spec**: [strong-tools-spec.md](../strong-tools-spec.md) - Documentation data structures

---

**Document Version**: 1.0.0
**Schema Version**: v2.0.0
**Last Updated**: October 18, 2025
**Maintained by**: Meridian Core Team
