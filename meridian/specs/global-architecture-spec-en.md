# Meridian Global Architecture Specification
# Multi-Monorepo Knowledge Management System

**Version**: 2.0.0
**Created**: October 18, 2025
**Status**: Design Specification
**Compatibility**: Meridian MCP Server v1.0.0+, Strong Tools v1.0.0+

**Language**: 🇬🇧 English | [🇷🇺 Русский](./global-architecture-spec.md)

---

## Table of Contents

1. [Overview and Motivation](#overview-and-motivation)
2. [Architectural Principles](#architectural-principles)
3. [Storage Structure](#storage-structure)
4. [Unique ID System](#unique-id-system)
5. [Project Registry](#project-registry)
6. [Two-Tier Architecture](#two-tier-architecture)
7. [Global Server](#global-server)
8. [Local MCP Server](#local-mcp-server)
9. [Cross-Monorepo Documentation](#cross-monorepo-documentation)
10. [Synchronization and Caching](#synchronization-and-caching)
11. [RocksDB Schema](#rocksdb-schema)
12. [Configuration](#configuration)
13. [CLI Commands](#cli-commands)
14. [MCP Tools](#mcp-tools)
15. [Workflows and Use Cases](#workflows-and-use-cases)
16. [Migration and Compatibility](#migration-and-compatibility)
17. [Implementation Plan](#implementation-plan)

---

## Overview and Motivation

### Related Specifications

- **[Core Specification](./spec-en.md)**: Meridian base system (v2.0.0)
- **[Strong Tools](./strong-tools-spec-en.md)**: Documentation, example, and test generation (v1.0.0)
- **[Roadmap](./roadmap.md)**: Implementation status and planning
- **[INDEX](./INDEX.md)**: Complete specification index

### Problem

**Current architecture** of Meridian operates at the single monorepo level:
- Local RocksDB database in the monorepo root
- Data isolation between different monorepos
- Unable to access documentation from dependencies in other monorepos
- Data loss when moving a project
- No global overview of all developer projects

### Real-World Scenario

A developer works across multiple monorepos:

```
/Users/dev/
  ├── work/
  │   ├── frontend-monorepo/         # Monorepo A
  │   │   └── packages/
  │   │       └── ui-kit/            # Depends on auth-lib
  │   └── backend-monorepo/          # Monorepo B
  │       └── packages/
  │           └── auth-lib/          # Used in ui-kit
  └── personal/
      └── side-project-monorepo/     # Monorepo C
          └── packages/
              └── analytics/         # Depends on ui-kit
```

**Current problem:**
- When working on `ui-kit` in monorepo A, Claude Code cannot access documentation for `auth-lib` from monorepo B
- When moving `backend-monorepo` from `/Users/dev/work` to `/Users/dev/projects`, the index is lost
- No unified place to search documentation across all projects

### Solution: Global Architecture

**Meridian Global Architecture** solves these problems:

1. ✅ **Global project registry** - unified database of all projects on the developer's machine
2. ✅ **Move-resistant IDs** - projects can be relocated without data loss
3. ✅ **Cross-monorepo documentation** - access documentation from any project
4. ✅ **Two-tier storage** - global DB + local caches
5. ✅ **Client-server architecture** - global server + local MCP servers
6. ✅ **Global search** - search documentation across all projects
7. ✅ **Dependency tracking** - dependency graph between projects from different monorepos

---

## Architectural Principles

### 1. Global-First, Local-Cache

**Global storage priority:**
```
Source Code → Tree-sitter AST → Analysis → Global DB (~/.meridian/data/)
                                                ↓
                                         Local Cache ([monorepo]/.meridian/)
```

**Local cache** is used for:
- Fast access to frequently used data
- Offline work (when global server is unavailable)
- Minimizing latency when working with local monorepo

### 2. Identity-Based, Not Path-Based

**Stable identifiers:**
- Project is identified by `@scope/name`, not by path
- Path is **mutable metadata**, not an identifier
- Relocation history is preserved for audit

### 3. Layered Architecture

**Three layers:**

```
┌─────────────────────────────────────────┐
│  MCP Layer (Claude Code Integration)   │
│  meridian serve --stdio                 │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Global Server (Daemon)                 │
│  meridian server                        │
│  - Project Registry                     │
│  - Global Index                         │
│  - File Watching                        │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Storage Layer                          │
│  - Global DB: ~/.meridian/data/         │
│  - Local Cache: [monorepo]/.meridian/   │
└─────────────────────────────────────────┘
```

### 4. Eventual Consistency

**Synchronization:**
- Code changes → global DB (automatically)
- Global DB → local cache (on request)
- Eventual consistency model for cross-monorepo references

### 5. Security and Isolation

**Security:**
- MCP server runs in the context of a specific monorepo
- Access to other projects - read-only (documentation, examples)
- Write access only to current monorepo
- Role-based access control (future extension)

---

## Storage Structure

### Global Storage

```
~/.meridian/                           # Global Meridian directory
  ├── meridian.toml                    # Global config
  ├── data/                            # Global RocksDB
  │   ├── registry/                    # Project and monorepo registry
  │   ├── symbols/                     # All symbols from all projects
  │   ├── docs/                        # Documentation
  │   ├── examples/                    # Code examples
  │   ├── tests/                       # Tests
  │   └── xref/                        # Cross-project references
  ├── cache/                           # Global cache
  │   └── compiled/                    # Compiled examples
  ├── logs/                            # Server logs
  │   ├── server.log                   # Main log
  │   ├── indexing.log                 # Indexing logs
  │   └── errors.log                   # Errors
  ├── server.pid                       # Global server PID
  └── state.json                       # Global state

# Additional (optional)
~/.meridian/plugins/                   # Plugins for extended functionality
~/.meridian/backups/                   # DB backups
```

### Local Storage (Monorepo)

```
[monorepo-path]/.meridian/             # Local monorepo directory
  ├── meridian.toml                    # Local config
  ├── cache.db/                        # Local RocksDB cache
  │   ├── symbols/                     # Symbol cache for this monorepo
  │   ├── docs/                        # Documentation cache
  │   └── external/                    # External dependency cache
  ├── state.json                       # Local state
  │                                    # - last sync
  │                                    # - pending changes
  ├── .gitignore                       # Ignore cache.db/
  └── README.md                        # Developer documentation

# .gitignore content:
cache.db/
state.json
*.log
```

### Data Placement

**What's stored in global DB:**
- ✅ Registry of all projects
- ✅ Complete symbol index
- ✅ Documentation for all projects
- ✅ Cross-project references
- ✅ Dependency graph
- ✅ Indexing history

**What's stored in local cache:**
- ✅ Fast access to current monorepo symbols
- ✅ Cache of frequently used external dependencies
- ✅ Pending changes (not synchronized)
- ✅ Local configuration

---

## Unique ID System

**See type definitions in [schemas/type-definitions.md](./schemas/type-definitions.md).**

### Problem

Project path can change (rename, move), but project identity should persist.

### Solution: Content-Based Identity

**Identification basis** - manifest content, not path:

```typescript
interface ProjectIdentity {
  // Primary ID (without version)
  id: string;                          // "@omnitron-dev/titan"

  // Version (for multiple versions of same project)
  version: string;                     // "1.0.0"

  // Full unique ID
  fullId: string;                      // "@omnitron-dev/titan@1.0.0"

  // Content hash (for verification)
  contentHash: string;                 // SHA256 of package.json/Cargo.toml

  // Project type
  type: "npm" | "cargo" | "generic";
}
```

### ID Generation

**TypeScript/JavaScript (npm packages):**
```typescript
// From package.json
{
  "name": "@omnitron-dev/titan",  // → id
  "version": "1.0.0"              // → version
}

// Full ID: "@omnitron-dev/titan@1.0.0"
```

**Rust (Cargo crates):**
```toml
# From Cargo.toml
[package]
name = "meridian-core"  # → id
version = "1.0.0"       # → version

# Full ID: "meridian-core@1.0.0"
```

**Generic Projects (without package manager):**
```typescript
// ID generation from content
const contentHash = sha256(manifestContent);
const id = `generic-${contentHash.slice(0, 12)}`;

// Full ID: "generic-a1b2c3d4e5f6@0.0.1"
```

### Monorepo ID

**Monorepo** also has a unique ID:

```typescript
interface MonorepoIdentity {
  // Monorepo ID
  id: string;                          // "omnitron-dev" or auto-generated

  // Name (optional)
  name?: string;                       // "Omnitron Development"

  // Content hash (root package.json or workspace manifest)
  contentHash: string;

  // Workspace type
  type: "pnpm" | "npm" | "yarn" | "cargo" | "mixed";
}
```

**Determining Monorepo ID:**
1. Check `[monorepo]/.meridian/meridian.toml` → `monorepo.id`
2. If not found, extract from root `package.json` → `name`
3. If not found, generate from hash of root manifest
4. Save to `[monorepo]/.meridian/meridian.toml`

---

## Project Registry

**See type definitions in [schemas/type-definitions.md](./schemas/type-definitions.md).**

### Concept

**Project Registry** - global registry of all projects on the developer's machine.

### Structure

```typescript
interface ProjectRegistry {
  // Identity
  identity: ProjectIdentity;

  // Location tracking
  currentPath: string;                 // Current absolute path
  pathHistory: ProjectPathHistory[];   // Relocation history

  // Monorepo context
  monorepo?: {
    id: string;                        // Monorepo ID
    path: string;                      // Path to monorepo root
    relativePath: string;              // Relative path inside monorepo
  };

  // Project metadata
  metadata: ProjectMetadata;           // From strong-tools-spec.md

  // Indexing state
  indexing: {
    lastIndexed: Date;
    indexVersion: string;              // Indexer version
    status: "indexed" | "indexing" | "error" | "pending";
    errorMessage?: string;
  };

  // Status
  status: "active" | "moved" | "deleted" | "stale";

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}

interface ProjectPathHistory {
  path: string;                        // Previous path
  timestamp: Date;
  reason: "discovered" | "relocated" | "auto-detected";
  initiatedBy?: string;                // "user" | "auto-scan" | "migration"
}
```

### Registry Operations

**1. Register project:**
```typescript
async function registerProject(path: string): Promise<ProjectRegistry> {
  // 1. Parse manifest (package.json / Cargo.toml)
  const manifest = await parseManifest(path);

  // 2. Generate identity
  const identity = generateIdentity(manifest);

  // 3. Check if already exists
  const existing = await findByIdentity(identity);

  if (existing) {
    // Update path if changed
    if (existing.currentPath !== path) {
      return await relocateProject(existing, path);
    }
    return existing;
  }

  // 4. Create new entry
  const registry: ProjectRegistry = {
    identity,
    currentPath: path,
    pathHistory: [{
      path,
      timestamp: new Date(),
      reason: "discovered"
    }],
    monorepo: await detectMonorepo(path),
    metadata: await extractMetadata(path),
    indexing: {
      status: "pending",
      indexVersion: CURRENT_INDEX_VERSION
    },
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date()
  };

  // 5. Save to global DB
  await saveToRegistry(registry);

  // 6. Queue indexing
  await enqueueIndexing(registry.identity.fullId);

  return registry;
}
```

**2. Relocate project:**
```typescript
async function relocateProject(
  projectId: string,
  newPath: string,
  reason: string = "relocated"
): Promise<void> {
  const registry = await getFromRegistry(projectId);

  // Update history
  registry.pathHistory.push({
    path: registry.currentPath,
    timestamp: new Date(),
    reason
  });

  // Update current path
  registry.currentPath = newPath;
  registry.updatedAt = new Date();

  // Re-indexing not required (ID remains the same)
  // Only if content changes, which is determined by contentHash

  await updateRegistry(registry);
}
```

**3. Find project:**
```typescript
// By ID
async function findByIdentity(identity: ProjectIdentity): Promise<ProjectRegistry | null>

// By path
async function findByPath(path: string): Promise<ProjectRegistry | null>

// By name
async function findByName(name: string): Promise<ProjectRegistry[]>

// All projects in monorepo
async function findByMonorepo(monorepoId: string): Promise<ProjectRegistry[]>
```

### Auto-Discovery

**Automatic project discovery:**

```typescript
async function discoverProjects(rootPath: string): Promise<ProjectRegistry[]> {
  const discovered: ProjectRegistry[] = [];

  // 1. Determine workspace type
  const workspaceType = await detectWorkspace(rootPath);

  // 2. Find projects
  const projectPaths = await findProjectsInWorkspace(rootPath, workspaceType);

  // 3. Register each project
  for (const projectPath of projectPaths) {
    const registry = await registerProject(projectPath);
    discovered.push(registry);
  }

  return discovered;
}

async function detectWorkspace(rootPath: string): Promise<WorkspaceType> {
  // pnpm
  if (await exists(join(rootPath, "pnpm-workspace.yaml"))) {
    return "pnpm";
  }

  // npm/yarn workspaces
  const pkgJson = await readPackageJson(rootPath);
  if (pkgJson.workspaces) {
    return "npm";
  }

  // Cargo workspace
  const cargoToml = await readCargoToml(rootPath);
  if (cargoToml.workspace) {
    return "cargo";
  }

  return "none";
}
```

---

## Two-Tier Architecture

### Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       Claude Code                            │
│                    (MCP Client)                              │
└────────────────────────┬─────────────────────────────────────┘
                         │ STDIO
                         │
┌────────────────────────▼─────────────────────────────────────┐
│               Meridian MCP Server                            │
│               (meridian serve --stdio)                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Context: /Users/dev/work/frontend-monorepo        │     │
│  │  Monorepo ID: frontend-app                         │     │
│  │  Local Cache: .meridian/cache.db/                  │     │
│  └────────────────────────────────────────────────────┘     │
└────────────────────────┬─────────────────────────────────────┘
                         │ IPC / HTTP
                         │
┌────────────────────────▼─────────────────────────────────────┐
│               Meridian Global Server                         │
│               (meridian server --daemon)                     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Project Registry                                  │     │
│  │  - All projects across all monorepos              │     │
│  │  - Location tracking                              │     │
│  │  - Dependency graph                               │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Global Index                                      │     │
│  │  - Symbols, Docs, Examples, Tests                 │     │
│  │  - Cross-monorepo references                      │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  File Watcher                                      │     │
│  │  - Watches all registered monorepos               │     │
│  │  - Incremental re-indexing                        │     │
│  └────────────────────────────────────────────────────┘     │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│                   Storage Layer                              │
│                                                              │
│  Global DB: ~/.meridian/data/                                │
│  Local Caches: [monorepo]/.meridian/cache.db/               │
└──────────────────────────────────────────────────────────────┘
```

### Layers

**1. MCP Layer**
- Claude Code integration
- STDIO transport
- MCP Protocol 2025-03-26

**2. Global Server Layer**
- Daemon process
- Management of all projects
- Global indexing
- File watching

**3. Storage Layer**
- Global RocksDB
- Local caches
- Synchronization

---

## Global Server

### Architecture

```typescript
class MeridianGlobalServer {
  private globalDB: RocksDB;
  private projectRegistry: ProjectRegistryManager;
  private indexManager: GlobalIndexManager;
  private fileWatcher: GlobalFileWatcher;
  private mcpClients: Map<string, MCPClient>;  // Connected MCP servers

  // IPC/HTTP server for communication with local MCP servers
  private ipcServer: IPCServer;

  async start(): Promise<void> {
    // 1. Load global DB
    await this.loadGlobalDB();

    // 2. Load project registry
    await this.projectRegistry.load();

    // 3. Start file watcher for all monorepos
    await this.startFileWatcher();

    // 4. Start IPC server
    await this.startIPCServer();

    console.log('Meridian Global Server started');
  }

  async stop(): Promise<void> {
    // Graceful shutdown
    await this.fileWatcher.stop();
    await this.ipcServer.stop();
    await this.globalDB.close();
  }
}
```

### Components

#### 1. Project Registry Manager

```typescript
class ProjectRegistryManager {
  private db: RocksDB;

  // CRUD operations
  async register(path: string): Promise<ProjectRegistry>
  async get(projectId: string): Promise<ProjectRegistry | null>
  async update(registry: ProjectRegistry): Promise<void>
  async delete(projectId: string): Promise<void>

  // Search
  async findByPath(path: string): Promise<ProjectRegistry | null>
  async findByName(name: string): Promise<ProjectRegistry[]>
  async findByMonorepo(monorepoId: string): Promise<ProjectRegistry[]>
  async listAll(): Promise<ProjectRegistry[]>

  // Monorepo operations
  async addMonorepo(path: string): Promise<MonorepoInfo>
  async relocateMonorepo(monorepoId: string, newPath: string): Promise<void>
  async removeMonorepo(monorepoId: string): Promise<void>
}
```

#### 2. Global Index Manager

```typescript
class GlobalIndexManager {
  private symbolIndex: SymbolIndex;
  private docIndex: DocumentationIndex;
  private xrefIndex: CrossReferenceIndex;

  async indexProject(projectId: string): Promise<IndexResult>
  async reindexProject(projectId: string): Promise<IndexResult>
  async removeProjectIndex(projectId: string): Promise<void>

  // Query
  async searchSymbols(query: SearchQuery): Promise<SymbolSearchResult[]>
  async getDocumentation(projectId: string, symbolId: string): Promise<Documentation>
  async findCrossReferences(symbolId: string): Promise<CrossReference[]>
}
```

#### 3. Global File Watcher

```typescript
class GlobalFileWatcher {
  private watchers: Map<string, FileWatcher>;  // monorepoId → watcher

  async watchMonorepo(monorepoId: string, path: string): Promise<void> {
    const watcher = new FileWatcher(path, {
      ignore: ['node_modules', 'target', 'dist', '.git'],
      debounce: 500
    });

    watcher.on('change', async (event) => {
      await this.handleFileChange(monorepoId, event);
    });

    this.watchers.set(monorepoId, watcher);
  }

  private async handleFileChange(monorepoId: string, event: FileChangeEvent) {
    // 1. Determine which project is affected
    const project = await this.findProjectByFile(event.path);

    // 2. Start incremental re-indexing
    await this.indexManager.reindexFile(project.identity.fullId, event.path);

    // 3. Notify connected MCP servers
    await this.notifyMCPClients(project.identity.fullId, event);
  }
}
```

#### 4. IPC Server

```typescript
class IPCServer {
  private server: HTTPServer;  // or Unix socket

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    await this.server.listen(MERIDIAN_IPC_PORT);
  }

  private async handleRequest(req: Request, res: Response) {
    const { method, params } = await req.json();

    switch (method) {
      case 'getProject':
        return await this.projectRegistry.get(params.projectId);

      case 'searchSymbols':
        return await this.indexManager.searchSymbols(params.query);

      case 'getDocumentation':
        return await this.indexManager.getDocumentation(params.projectId, params.symbolId);

      // ... other methods
    }
  }
}
```

### Startup and Management

**Starting server:**
```bash
# Start in daemon mode
meridian server --daemon

# Start in foreground (for debugging)
meridian server

# Check status
meridian server status

# Stop
meridian server stop
```

**Managing projects:**
```bash
# Add monorepo
meridian projects add /path/to/monorepo

# List all projects
meridian projects list

# Search for project
meridian projects search "@omnitron-dev/titan"

# Relocate monorepo
meridian projects relocate frontend-app /new/path

# Remove project
meridian projects remove "@omnitron-dev/old-project"

# Re-index
meridian index --all
meridian index --project "@omnitron-dev/titan"
```

---

## Local MCP Server

### Architecture

```typescript
class MeridianMCPServer {
  private globalClient: GlobalServerClient;   // Client to global server
  private localCache: LocalCache;             // Local RocksDB cache
  private monorepoContext: MonorepoContext;   // Current monorepo context

  constructor(monorepoPath: string) {
    this.monorepoContext = {
      path: monorepoPath,
      monorepoId: await this.detectMonorepoId(monorepoPath),
      projects: await this.loadLocalProjects(monorepoPath)
    };
  }

  async handleToolCall(tool: string, args: any): Promise<any> {
    // Two-tier strategy:
    // 1. Check local cache
    // 2. If not found - request from global server
    // 3. Cache result locally

    switch (tool) {
      case 'code.search_symbols':
        return await this.searchSymbols(args);

      case 'strong.catalog.search_documentation':
        return await this.searchDocumentation(args);

      case 'strong.docs.generate':
        return await this.generateDocumentation(args);

      // ... other tools
    }
  }

  private async searchSymbols(args: any): Promise<any> {
    // 1. Check local cache
    const cached = await this.localCache.get(`symbols:search:${args.query}`);
    if (cached && !cached.isStale) {
      return cached.value;
    }

    // 2. Request from global server
    const result = await this.globalClient.request('searchSymbols', {
      query: args.query,
      monorepoId: this.monorepoContext.monorepoId,  // Context
      includeExternal: args.includeExternal ?? false
    });

    // 3. Cache
    await this.localCache.set(`symbols:search:${args.query}`, result, {
      ttl: 3600  // 1 hour
    });

    return result;
  }

  private async searchDocumentation(args: any): Promise<any> {
    // Search can be:
    // - Local (only this monorepo)
    // - Global (all monorepos)
    // - Dependencies (only projects we depend on)

    const scope = args.scope ?? 'dependencies';  // 'local' | 'dependencies' | 'global'

    if (scope === 'local') {
      // Local cache only
      return await this.localCache.searchDocs(args.query);
    }

    // Request to global server
    return await this.globalClient.request('searchDocumentation', {
      query: args.query,
      scope,
      monorepoId: this.monorepoContext.monorepoId
    });
  }
}
```

### Local Cache

```typescript
class LocalCache {
  private db: RocksDB;
  private syncState: SyncState;

  constructor(monorepoPath: string) {
    const cachePath = join(monorepoPath, '.meridian', 'cache.db');
    this.db = new RocksDB(cachePath);
  }

  // Cache operations
  async get(key: string): Promise<CachedItem | null>
  async set(key: string, value: any, options?: CacheOptions): Promise<void>
  async invalidate(key: string): Promise<void>
  async invalidatePattern(pattern: string): Promise<void>

  // Sync with global DB
  async sync(): Promise<void> {
    const lastSync = await this.syncState.getLastSync();
    const changes = await this.globalClient.getChanges(lastSync);

    for (const change of changes) {
      await this.applyChange(change);
    }

    await this.syncState.setLastSync(new Date());
  }
}

interface CachedItem {
  value: any;
  timestamp: Date;
  ttl?: number;
  isStale: boolean;
}

interface SyncState {
  lastSync: Date;
  pendingChanges: PendingChange[];
}
```

### Starting MCP Server

**For Claude Code** (in `.claude.json`):
```json
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"],
      "cwd": "/path/to/monorepo",
      "env": {
        "MERIDIAN_GLOBAL_SERVER": "http://localhost:7878"
      }
    }
  }
}
```

**Startup process:**
```bash
cd /path/to/monorepo
meridian serve --stdio

# This:
# 1. Determines monorepoId
# 2. Connects to global server
# 3. Loads local cache
# 4. Starts MCP server
# 5. Ready for requests from Claude Code
```

---

## Cross-Monorepo Documentation

### Use Case

**Scenario:**
```
Monorepo A: frontend-app
  └── packages/ui-kit
      └── depends on: @company/auth-lib

Monorepo B: backend-services
  └── packages/auth-lib
```

**Task:** When working on `ui-kit`, get documentation for `auth-lib` from another monorepo.

### Solution

**1. Dependency Resolution:**

```typescript
// In packages/ui-kit/package.json
{
  "dependencies": {
    "@company/auth-lib": "^1.0.0"
  }
}

// Meridian:
// 1. Determines that ui-kit depends on auth-lib
// 2. Searches for auth-lib in global registry
// 3. Finds that auth-lib is in monorepo B
// 4. Loads documentation from global DB
```

**2. MCP Tool Usage:**

```typescript
// In Claude Code, when working on ui-kit

// Request documentation for external dependency
const docs = await mcp.request('strong.catalog.get_project', {
  projectId: '@company/auth-lib'
});

// Result contains:
// - Documentation for all exported symbols
// - Usage examples
// - Cross-references
// - Source code location (for analysis)
```

**3. Source Code Analysis:**

```typescript
// Optional: analyze dependency source code
const sourceCode = await mcp.request('code.get_definition', {
  projectId: '@company/auth-lib',
  symbolName: 'authenticate'
});

// Returns:
// - Full function source code
// - Type signature
// - JSDoc documentation
// - Location in filesystem
```

### Security and Isolation

**Restrictions:**
- ✅ Reading documentation from other monorepos - allowed
- ✅ Reading source code - allowed (read-only)
- ❌ Modifying code in other monorepos - prohibited
- ❌ Generating documentation for other projects - prohibited (only for current monorepo)

**Implementation:**
```typescript
class SecurityContext {
  currentMonorepoId: string;

  canRead(projectId: string): boolean {
    // Can read any project
    return true;
  }

  canWrite(projectId: string): boolean {
    // Can write only to projects in current monorepo
    const project = await this.registry.get(projectId);
    return project.monorepo?.id === this.currentMonorepoId;
  }
}
```

### Caching External Dependencies

**Strategy:**
```typescript
// On first access to external dependency
const docs = await this.globalClient.getDocumentation('@company/auth-lib');

// Cache locally
await this.localCache.set('external:@company/auth-lib:docs', docs, {
  ttl: 86400  // 24 hours
});

// Subsequent accesses - from local cache
const cached = await this.localCache.get('external:@company/auth-lib:docs');
```

---

## Synchronization and Caching

### Synchronization Strategy

**Synchronization directions:**

```
Local Changes (Monorepo)
        ↓
  [File watching]
        ↓
  Global Server
        ↓
  [Indexing]
        ↓
  Global DB
        ↓
  [Push to other MCP servers]
        ↓
  Other Local Caches (on request)
```

### Synchronization Types

**1. Push Sync (local to global):**
```typescript
// On file change in monorepo
async function onFileChange(filePath: string) {
  // 1. Local re-indexing
  const symbols = await parseFile(filePath);

  // 2. Send to global server
  await globalClient.updateSymbols(projectId, symbols);

  // 3. Global server updates DB
  await globalDB.put(`symbols:${projectId}:${symbolId}`, symbols);

  // 4. Notify other MCP servers (if they use this project)
  await notifyDependents(projectId, symbolId);
}
```

**2. Pull Sync (global to local):**
```typescript
// When requesting documentation for external project
async function getExternalDocs(projectId: string) {
  // 1. Check local cache
  const cached = await localCache.get(`external:${projectId}:docs`);
  if (cached && !cached.isStale) {
    return cached.value;
  }

  // 2. Request from global server
  const docs = await globalClient.getDocumentation(projectId);

  // 3. Cache locally
  await localCache.set(`external:${projectId}:docs`, docs, { ttl: 86400 });

  return docs;
}
```

**3. Periodic Sync:**
```typescript
// Periodic synchronization (every 5 minutes)
setInterval(async () => {
  await localCache.sync();
}, 5 * 60 * 1000);
```

### Cache Invalidation

**Invalidation triggers:**

**1. File Change:**
```typescript
// File changed
onFileChange('packages/titan/src/application.ts') →
  invalidate('symbols:@omnitron-dev/titan:Application')
```

**2. Project Re-index:**
```typescript
// Project re-indexed
onProjectReindex('@omnitron-dev/titan') →
  invalidatePattern('symbols:@omnitron-dev/titan:*')
```

**3. TTL Expiration:**
```typescript
// TTL expired for cache
onTTLExpire('external:@company/auth-lib:docs') →
  markStale('external:@company/auth-lib:docs')
```

**4. Manual Invalidation:**
```bash
# Clear local cache
meridian cache clear

# Clear for specific project
meridian cache clear --project "@omnitron-dev/titan"
```

### Offline Mode

**Working without global server:**

```typescript
class MeridianMCPServer {
  private offlineMode: boolean = false;

  async handleToolCall(tool: string, args: any) {
    try {
      // Attempt to access global server
      return await this.handleWithGlobalServer(tool, args);
    } catch (error) {
      if (isConnectionError(error)) {
        // Switch to offline mode
        this.offlineMode = true;
        console.warn('Global server unavailable, switching to offline mode');

        // Work only with local cache
        return await this.handleWithLocalCache(tool, args);
      }
      throw error;
    }
  }

  private async handleWithLocalCache(tool: string, args: any) {
    // Limited functionality:
    // - Only current monorepo projects
    // - Only cached external dependencies
    // - Documentation generation works

    const result = await this.localCache.query(tool, args);

    if (!result) {
      throw new Error(
        'Data not available in offline mode. ' +
        'Please reconnect to global server or work with local projects only.'
      );
    }

    return result;
  }
}
```

---

## RocksDB Schema

**See detailed RocksDB schema in [schemas/rocksdb-schema.md](./schemas/rocksdb-schema.md). This document is the single source of truth for all RocksDB schemas.**

### Brief Overview

**Global DB** (`~/.meridian/data/`):
- `registry:*` - Project and monorepo registry
- `symbols:*` - All symbols from all projects
- `docs:*` - Documentation for all symbols
- `examples:*` - Generated code examples
- `tests:*` - Generated tests
- `xref:*` - Cross-project references
- `deps:*` - Dependency graph
- `meta:*` - Global metadata

**Local cache** (`[monorepo-path]/.meridian/cache.db/`):
- `cache:symbols:*` - Symbol cache for current monorepo
- `cache:external:*` - External dependency cache
- `cache:query:*` - Query result cache
- `sync:*` - Synchronization state
- `meta:*` - Local metadata

**See complete schema descriptions, key formats, data types, and examples in [schemas/rocksdb-schema.md](./schemas/rocksdb-schema.md).**

---

## Configuration

### Global Config

**Location:** `~/.meridian/meridian.toml`

```toml
[server]
# Global server
host = "localhost"
port = 7878
daemon = true
auto_start = true  # Auto-start on first access

[storage]
# Storage
data_dir = "~/.meridian/data"
cache_size_mb = 1024
max_db_size_mb = 10240
compression = "zstd"

[indexing]
# Indexing
auto_index_on_add = true
watch_enabled = true
debounce_ms = 500
max_concurrent_indexes = 4

[cross_monorepo]
# Cross-monorepo functionality
enable = true
cache_external_docs = true
max_dependency_depth = 3
auto_discover_dependencies = true

[cache]
# Global cache
default_ttl_hours = 24
max_cache_size_mb = 2048
eviction_policy = "lru"

[file_watching]
# File watching
enabled = true
ignore_patterns = [
  "node_modules",
  "target",
  "dist",
  ".git",
  "*.log"
]
batch_delay_ms = 500

[logging]
# Logging
level = "info"
file = "~/.meridian/logs/server.log"
max_size_mb = 100
max_backups = 5

[security]
# Security (future)
enable_access_control = false
allowed_monorepos = []  # Empty = all allowed
```

### Local Config

**Location:** `[monorepo-path]/.meridian/meridian.toml`

```toml
[monorepo]
# Monorepo identification
id = "omnitron-dev"
name = "Omnitron Development"
type = "pnpm"  # pnpm | npm | yarn | cargo | mixed

[projects]
# Projects (auto-discovery if not specified)
auto_discover = true
# Explicit specification (optional):
# explicit = [
#   "packages/titan",
#   "packages/common"
# ]

[sync]
# Synchronization with global DB
auto_sync = true
sync_interval_minutes = 5
sync_on_file_change = true
push_immediately = false  # or buffering

[cache]
# Local cache
enabled = true
max_size_mb = 512
ttl_hours = 24
cache_external_deps = true

[mcp]
# MCP-specific settings
enable_cross_monorepo_docs = true
include_external_sources = true
scope = "dependencies"  # local | dependencies | global

[indexing]
# Local indexing
include_tests = true
include_examples = true
exclude_patterns = []
```

---

## CLI Commands

### Global Commands

**Server Management:**
```bash
# Start global server
meridian server start [--daemon]

# Stop
meridian server stop

# Status
meridian server status

# Logs
meridian server logs [--follow]

# Restart
meridian server restart
```

**Project Management:**
```bash
# Add monorepo
meridian projects add <path>

# List all projects
meridian projects list [--monorepo <id>]

# Search for project
meridian projects search <query>

# Project details
meridian projects info <project-id>

# Remove project
meridian projects remove <project-id>

# Relocate monorepo
meridian projects relocate <monorepo-id> <new-path>
```

**Indexing:**
```bash
# Index all projects
meridian index --all

# Index specific project
meridian index --project <project-id>

# Index monorepo
meridian index --monorepo <monorepo-id>

# Re-index (force)
meridian index --force --project <project-id>
```

**Cache Management:**
```bash
# Cache statistics
meridian cache stats

# Clear global cache
meridian cache clear --global

# Clear for project
meridian cache clear --project <project-id>

# Clear all local caches
meridian cache clear --all-local
```

**Diagnostics:**
```bash
# Check DB integrity
meridian doctor

# Statistics
meridian stats

# Dependency graph
meridian deps graph <project-id>

# Dependency tree
meridian deps tree <project-id> [--depth <n>]
```

### Local Commands (in monorepo context)

**MCP Server:**
```bash
# Start MCP server for Claude Code
meridian serve --stdio

# Start with additional options
meridian serve --stdio --verbose --offline
```

**Local Operations:**
```bash
# Initialize .meridian in monorepo
meridian init

# Local indexing
meridian index

# Sync with global DB
meridian sync

# Local cache status
meridian cache status

# Clear local cache
meridian cache clear
```

---

## MCP Tools

**See complete MCP tools catalog in [schemas/mcp-tools-catalog.md](./schemas/mcp-tools-catalog.md).**

### Updated Tools for Cross-Monorepo Work

**New categories:**
1. **Global Catalog Tools** - working with global registry
2. **Cross-Monorepo Tools** - cross-monorepo functionality

### Global Catalog Tools

#### `strong.global.list_monorepos`

**Description**: List all registered monorepos.

**Input**: None

**Output**:
```typescript
{
  monorepos: {
    id: string;
    name: string;
    path: string;
    type: "pnpm" | "npm" | "cargo" | "mixed";
    projectCount: number;
    lastIndexed: Date;
  }[];
  totalProjects: number;
}
```

---

#### `strong.global.search_all_projects`

**Description**: Search projects across all monorepos.

**Input**:
```typescript
{
  query: string;                        // Search query
  monorepoId?: string;                  // Filter by monorepo
  type?: "typescript" | "rust";
}
```

**Output**:
```typescript
{
  results: {
    projectId: string;
    name: string;
    monorepo: {
      id: string;
      name: string;
      path: string;
    };
    documentationCoverage: number;
    lastIndexed: Date;
  }[];
  totalResults: number;
}
```

---

#### `strong.global.get_dependency_graph`

**Description**: Dependency graph (cross-monorepo).

**Input**:
```typescript
{
  projectId: string;
  depth?: number;                       // Default: 3
  direction: "incoming" | "outgoing" | "both";
  includeExternal?: boolean;            // Include npm registry deps
}
```

**Output**:
```typescript
{
  graph: {
    nodes: {
      id: string;
      type: "project" | "external";
      monorepo?: {
        id: string;
        path: string;
      };
    }[];
    edges: {
      from: string;
      to: string;
      type: "dependency" | "devDependency";
      version: string;
    }[];
  };
  visualization: string;                // Mermaid diagram
}
```

---

### Cross-Monorepo Documentation Tools

#### `strong.external.get_documentation`

**Description**: Get documentation for external project (from another monorepo).

**Input**:
```typescript
{
  projectId: string;                    // "@company/auth-lib"
  symbolName?: string;                  // Specific symbol
  includeExamples?: boolean;
  includeSource?: boolean;              // Include source code
}
```

**Output**:
```typescript
{
  project: {
    id: string;
    monorepo: {
      id: string;
      path: string;
    };
    version: string;
  };
  documentation: {
    symbols: {
      name: string;
      documentation: string;
      examples?: GeneratedExample[];
      source?: string;
    }[];
  };
  fromCache: boolean;                   // From local cache or global DB
}
```

---

#### `strong.external.find_usages`

**Description**: Find symbol usage across all monorepos.

**Input**:
```typescript
{
  projectId: string;
  symbolName: string;
  includeTests?: boolean;
}
```

**Output**:
```typescript
{
  usages: {
    projectId: string;
    monorepo: {
      id: string;
      name: string;
    };
    location: SourceLocation;
    context: string;                    // Surrounding code
    usageType: "import" | "call" | "extend" | "implement";
  }[];
  totalUsages: number;
}
```

---

### Updated Existing Tools

**`strong.catalog.search_documentation`** - now supports scope:

**Input** (updated):
```typescript
{
  query: string;
  scope?: "local" | "dependencies" | "global";  // NEW
  minQuality?: number;
  limit?: number;
}
```

- `scope: "local"` - current monorepo only
- `scope: "dependencies"` - current monorepo + its dependencies
- `scope: "global"` - all monorepos on machine

---

## Workflows and Use Cases

### Workflow 1: Adding New Monorepo

```bash
# 1. Start global server (if not running)
meridian server start --daemon

# 2. Add monorepo
meridian projects add /Users/dev/work/frontend-monorepo

# What happens:
# - Workspace scanning
# - Discovery of all projects (packages/*)
# - Registration in global registry
# - Indexing all projects
# - Start file watching

# 3. Check status
meridian projects list

# Output:
# Monorepo: frontend-app (pnpm)
#   Path: /Users/dev/work/frontend-monorepo
#   Projects: 5
#     - @company/ui-kit (TypeScript)
#     - @company/components (TypeScript)
#     - @company/utils (TypeScript)
#     - ...
#   Last indexed: 2 minutes ago
```

### Workflow 2: Working with Claude Code (Cross-Monorepo Documentation)

```typescript
// User working on @company/ui-kit in frontend-monorepo
// ui-kit depends on @company/auth-lib from backend-monorepo

// 1. Claude Code starts meridian serve --stdio
//    in frontend-monorepo context

// 2. When working on code that uses auth-lib:
import { authenticate } from '@company/auth-lib';

// 3. Claude Code requests documentation via MCP:
const docs = await mcp.request('strong.external.get_documentation', {
  projectId: '@company/auth-lib',
  symbolName: 'authenticate',
  includeExamples: true
});

// 4. Meridian MCP Server:
//    - Checks local cache
//    - If not found - requests from global server
//    - Global server finds auth-lib in backend-monorepo
//    - Returns documentation
//    - MCP Server caches locally

// 5. Claude Code receives:
//    - Full documentation for authenticate function
//    - Usage examples
//    - Type information
//    - Optional: source code

// 6. Claude Code can use this information for:
//    - Correct API usage
//    - Generating correct code
//    - Providing hints to user
```

### Workflow 3: Relocating Monorepo

```bash
# Initial situation
/Users/dev/work/frontend-monorepo  # Old path

# 1. Move directory
mv /Users/dev/work/frontend-monorepo /Users/dev/projects/frontend-monorepo

# 2. Update registry
meridian projects relocate frontend-app /Users/dev/projects/frontend-monorepo

# What happens:
# - Update paths in project registry
# - Save relocation history
# - Re-indexing NOT required (ID stays the same)
# - File watcher updates watched paths
# - Local caches of other monorepos not affected

# 3. Verify
meridian projects info frontend-app

# Output:
# Project: frontend-app
#   Current Path: /Users/dev/projects/frontend-monorepo
#   History:
#     - /Users/dev/work/frontend-monorepo (2025-10-15, relocated)
#     - /Users/dev/projects/frontend-monorepo (2025-10-18, current)
```

### Workflow 4: Offline Work

```bash
# Global server unavailable (stopped or error)

# 1. Start MCP server
cd /Users/dev/work/frontend-monorepo
meridian serve --stdio

# Output:
# Warning: Global server unavailable, running in offline mode
# Limited functionality:
#   - Local projects: full access
#   - External deps: cached only
#   - Doc generation: available

# 2. Work with local projects - fully functional
const localDocs = await mcp.request('strong.docs.generate', {
  targetPath: 'packages/ui-kit/src/button.ts'
});
// ✅ Works (local project)

# 3. Attempt to get documentation for external project
const externalDocs = await mcp.request('strong.external.get_documentation', {
  projectId: '@company/auth-lib'
});
// ✅ Works if in local cache
// ❌ Error if not cached and global server unavailable

# 4. When global server becomes available again
# - Automatic synchronization of pending changes
# - Cache update
# - Full functionality restored
```

---

## Migration and Compatibility

### Migration from Single-Monorepo to Global Architecture

**Phase 1: Preparation**

```bash
# 1. Install updated Meridian version
npm install -g meridian@2.0.0

# 2. Initialize global directory
meridian init --global

# Creates:
# - ~/.meridian/
# - ~/.meridian/meridian.toml (with default settings)
# - ~/.meridian/data/ (empty global DB)
```

**Phase 2: Migrating Existing Data**

```bash
# 3. Migrate existing monorepo
cd /path/to/existing/monorepo
meridian migrate --to-global

# What happens:
# - Read data from .meridian/local.db (old format)
# - Convert to new format
# - Load into ~/.meridian/data/ (global DB)
# - Create .meridian/cache.db (new local cache)
# - Register monorepo in project registry
# - Save old DB as backup (.meridian/local.db.backup)

# 4. Verify migration
meridian projects list

# Output should show migrated monorepo
```

**Phase 3: Update Configuration**

```bash
# 5. Update .claude.json for Claude Code
# Old format:
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["mcp"]  # Old command
    }
  }
}

# New format:
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"]  # New command
    }
  }
}
```

### Backward Compatibility

**Support for Old Commands:**
```bash
# Old command
meridian mcp

# Automatically redirected to:
meridian serve --stdio --legacy-mode

# With warning:
# Warning: 'meridian mcp' is deprecated. Use 'meridian serve --stdio' instead.
```

**Support for Old DB Format:**
- Meridian 2.0 can read old DBs (v1.x)
- Automatic migration on first run
- Backup of old DB saved

### Versioning

**Semantic Versioning:**
- `v1.x.x` - Single-monorepo architecture
- `v2.x.x` - Global architecture (current specification)

**Compatibility Matrix:**
```
Meridian v1.x → v2.x: ✅ Automatic migration
Meridian v2.x → v1.x: ❌ Not supported (breaking changes)

MCP Protocol:
  v2024-11-05: ✅ Supported (legacy)
  v2025-03-26: ✅ Supported (current)
```

---

## Implementation Plan

### Phase 1: Infrastructure (Weeks 1-2)

**Tasks:**
1. ✅ **Global Architecture Spec** (this document)
2. **Global Server Implementation**:
   - Project registry manager
   - Global RocksDB setup
   - IPC server (HTTP-based)
   - CLI commands (server, projects, index)
3. **Project Identity System**:
   - ID generation (npm, cargo, generic)
   - Content hashing
   - Path tracking
4. **Migration Tools**:
   - v1.x → v2.x migration script
   - Data converter

**Deliverables:**
- Global server functional
- Can register and manage monorepos
- Migration from v1.x works

---

### Phase 2: Local MCP Server (Weeks 3-4)

**Tasks:**
1. **MCP Server Implementation**:
   - Client to global server
   - Local cache (RocksDB)
   - STDIO transport for Claude Code
2. **Sync Mechanism**:
   - Push sync (local → global)
   - Pull sync (global → local)
   - Cache invalidation
3. **Offline Mode**:
   - Graceful degradation when global server unavailable
   - Local-only functionality

**Deliverables:**
- MCP server works with Claude Code
- Can access both local and external docs
- Offline mode functional

---

### Phase 3: Cross-Monorepo Features (Weeks 5-6)

**Tasks:**
1. **Dependency Resolution**:
   - Parse package.json/Cargo.toml dependencies
   - Build dependency graph (cross-monorepo)
   - Auto-discovery of external dependencies
2. **Cross-Monorepo Documentation**:
   - Fetch docs from external projects
   - Cache external docs locally
   - Security & isolation
3. **MCP Tools**:
   - `strong.global.*` tools
   - `strong.external.*` tools
   - Updated `strong.catalog.*` tools with scope

**Deliverables:**
- Cross-monorepo documentation works
- Dependency graph visualization
- Complete MCP tools for global features

---

### Phase 4: File Watching & Sync (Weeks 7-8)

**Tasks:**
1. **Global File Watcher**:
   - Watch all registered monorepos
   - Debouncing and batching
   - Incremental re-indexing
2. **Sync Optimization**:
   - Efficient change propagation
   - Minimize re-indexing
   - Smart cache updates
3. **Notifications**:
   - Notify dependent MCP servers of changes
   - Push updates to local caches

**Deliverables:**
- Auto-update works across monorepos
- Low-latency change propagation
- Efficient resource usage

---

### Phase 5: Integration with Strong Tools (Weeks 9-10)

**Tasks:**
1. **Documentation Generation** (from strong-tools-spec.md):
   - Integrate with global architecture
   - Generate docs for any project
   - Cross-project doc generation
2. **Example & Test Generation**:
   - Generate examples for external deps
   - Validate examples across monorepos
3. **Agent Integration**:
   - Architect, Developer, Tester agents
   - Work with global project registry

**Deliverables:**
- Strong Tools fully integrated
- Can generate docs for any project
- Agent workflows functional

---

### Phase 6: Testing & Polish (Weeks 11-12)

**Tasks:**
1. **Comprehensive Testing**:
   - Unit tests for all components
   - Integration tests (cross-monorepo scenarios)
   - MCP tool tests
   - Migration tests (v1 → v2)
2. **Performance Optimization**:
   - Cache tuning
   - Query optimization
   - Indexing performance
3. **Documentation**:
   - User guide
   - Migration guide
   - API documentation
   - Best practices

**Deliverables:**
- Production-ready v2.0.0
- Complete documentation
- Clear migration path

---

### Phase 7: Launch & Support (Week 13+)

**Tasks:**
1. **Release v2.0.0**:
   - Publish to npm
   - Release notes
   - Migration guide
2. **Community Support**:
   - GitHub issues
   - Discord/Slack
   - Documentation updates
3. **Post-Launch Features**:
   - Plugin system
   - Remote server support (multi-machine)
   - Role-based access control

---

## Conclusion

**Meridian Global Architecture v2.0** transforms Meridian into a **complete global knowledge management system** for developers working with multiple monorepos:

✅ **Global project registry** - unified database of all projects on machine
✅ **Move-resistant IDs** - projects can be relocated without data loss
✅ **Cross-monorepo documentation** - access documentation from any project
✅ **Two-tier storage** - global DB + local caches
✅ **Client-server architecture** - scalability and efficiency
✅ **Automatic synchronization** - changes propagate automatically
✅ **Offline mode** - work without global server
✅ **Full compatibility** with existing specifications (spec.md, strong-tools-spec.md)

**Architecture Highlights:**
- **Local-First, Global-Enhanced** - fast local access + global capabilities
- **Identity-Based, Not Path-Based** - resilient to relocations
- **Layered & Modular** - clean architecture, easily extensible
- **Secure & Isolated** - security through read-only access to external projects

**Total MCP Tools:** 29 (existing) + 23 (strong tools) + 5 (global tools) = **57 tools**

**Ready for Implementation** → [Plan](#implementation-plan)

---

**Next Steps:**
1. Approve this specification
2. Start Phase 1 implementation
3. Create GitHub project for tracking
4. Set up CI/CD for v2.0.0

**Questions/Feedback:** [GitHub Issues](https://github.com/yourusername/meridian/issues)
