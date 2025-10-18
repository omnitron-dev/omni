# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript monorepo for the Omnitron ecosystem - a collection of minimalist, high-performance libraries for building distributed systems. At its core is **Titan**, a lightweight framework designed for distributed, runtime-agnostic applications with enterprise reliability. The monorepo uses Turborepo for build orchestration and pnpm 9.15.0 for package management.

**Runtime Support**: Node.js >=22.0.0 (primary), Bun >=1.2.0 (fully supported), Deno (experimental)

## ⚡ Meridian MCP Integration - CRITICAL WORKFLOW

**The `/meridian` subdirectory contains a production-ready Rust MCP server with 72+ tools for code analysis, progress tracking, and memory management. This is the PRIMARY workflow for all development tasks.**

### 🚫 NEVER CREATE REPORT FILES

**ABSOLUTE RULE**: Do NOT create .md files for summaries, implementation reports, session reports, or progress tracking.

❌ **PROHIBITED**:
- Creating `IMPLEMENTATION_REPORT.md`
- Creating `SESSION_SUMMARY.md`
- Creating `PROGRESS.md` or similar tracking files
- Writing manual TODO lists to markdown files
- Any form of manual documentation of progress

✅ **REQUIRED INSTEAD**:
- Use `progress.*` MCP tools for ALL task tracking
- Use `memory.record_episode` to capture completed work
- Use `specs.*` tools to reference specifications
- All reports live in the progress tracking system (SQLite database)

### Core Principles

**1. Always Use MCP Tools First**

Before using traditional tools, check if an MCP tool exists:

| Traditional Tool | MCP Alternative | Why Better |
|-----------------|-----------------|------------|
| `Read` file | `code.get_definition` | Returns only relevant symbol, not entire file |
| `Grep` search | `code.search_symbols` | Semantic search with type filtering |
| Manual search | `specs.search` | Spec-aware search with context |
| `TodoWrite` | `progress.list_tasks` | Persistent, queryable, linkable to specs |
| File browsing | `code.get_dependencies` | Shows actual code relationships |

**2. Complete Progress Tracking Workflow**

Every development task follows this workflow:

```typescript
// STEP 1: Create task at the start
const task = await mcp__meridian__progress_create_task({
  title: "Implement feature X",
  description: "Detailed description of what needs to be done",
  spec_ref: {
    spec_name: "progress-tracking-spec",  // Reference to spec
    section: "Section 3.2"                // Specific section
  },
  priority: "high",                       // low | medium | high | critical
  estimated_hours: 4,
  tags: ["backend", "api", "rust"]
});

// STEP 2: Start working (updates status to in_progress)
await mcp__meridian__progress_update_task({
  task_id: task.task_id,
  status: "in_progress",
  status_note: "Starting implementation"
});

// STEP 3: During work - update as needed
await mcp__meridian__progress_update_task({
  task_id: task.task_id,
  status_note: "Completed API endpoints, working on tests"
});

// STEP 4: Complete the task (auto-creates episode in memory system)
await mcp__meridian__progress_mark_complete({
  task_id: task.task_id,
  actual_hours: 3.5,
  commit_hash: "abc123...",  // Current git commit
  note: "Implementation complete with full test coverage",
  // Optional but recommended:
  solution_summary: "Used dependency injection pattern with async handlers",
  files_touched: ["src/api/handler.rs", "tests/api_test.rs"],
  queries_made: ["code.search_symbols handler", "specs.get_section API"]
});
// This automatically records an episode in the memory system!
```

**3. Task Status Lifecycle**

Tasks flow through these states:
- `pending` → Just created, not started
- `in_progress` → Currently being worked on
- `blocked` → Waiting on external dependency (add status_note explaining blocker)
- `done` → Completed successfully
- `cancelled` → No longer needed

**4. Querying and Linking**

```typescript
// List all tasks for a spec
await mcp__meridian__progress_list_tasks({
  spec_name: "progress-tracking-spec",
  status: "in_progress",
  limit: 20
});

// Search tasks by title or content
await mcp__meridian__progress_search_tasks({
  query: "API implementation",
  limit: 10
});

// Get progress statistics
await mcp__meridian__progress_get_progress({
  spec_name: "progress-tracking-spec"  // or omit for all specs
});

// Link task to spec section (if not done at creation)
await mcp__meridian__progress_link_to_spec({
  task_id: "abc123",
  spec_name: "progress-tracking-spec",
  section: "Section 3.2"
});

// View complete history of a task
await mcp__meridian__progress_get_history({
  task_id: "abc123"
});
```

### Complete MCP Tools Catalog (72+ Tools)

**Memory Management (3 tools)**
- `memory_record_episode` - Record completed work for future learning
- `memory_find_similar_episodes` - Find similar past tasks to guide current work
- `memory_update_working_set` - Update working memory with attention weights

**Code Analysis (4 tools)**
- `code_search_symbols` - Search for functions, classes, interfaces with filters
  - Params: `query`, `type` (function|class|interface), `scope`, `detail_level`, `max_tokens`
- `code_get_definition` - Get full definition of a specific symbol
  - Params: `symbol_id`, `include_body`, `include_dependencies`, `include_references`
- `code_find_references` - Find all references to a symbol
  - Params: `symbol_id`, `group_by_file`, `include_context`
- `code_get_dependencies` - Get dependency graph for symbol or file
  - Params: `entry_point`, `depth` (1-5), `direction` (imports|exports|both)

**Progress Tracking (10 tools)**
- `progress_create_task` - Create new task
- `progress_update_task` - Update task status, priority, estimates
- `progress_list_tasks` - List tasks with filters (status, spec, limit)
- `progress_get_task` - Get detailed task information
- `progress_delete_task` - Delete a task
- `progress_search_tasks` - Search tasks by title/content
- `progress_link_to_spec` - Link task to specification section
- `progress_get_history` - Get complete status change history
- `progress_get_progress` - Get statistics and progress metrics
- `progress_mark_complete` - Mark complete with auto-episode creation ⭐

**Specifications (5 tools)**
- `specs_list` - List all available specifications
- `specs_get_structure` - Get TOC and metadata for a spec
- `specs_get_section` - Get content of specific section
- `specs_search` - Search across all specifications
- `specs_validate` - Validate spec completeness and quality

**Session Management (4 tools)**
- `session_begin` - Start isolated work session with copy-on-write
- `session_update` - Update files in session with reindexing
- `session_query` - Query within session context
- `session_complete` - Complete session (commit|discard|stash)

**Context Optimization (4 tools)**
- `context_prepare_adaptive` - Prepare context for specific LLM and token budget
- `context_defragment` - Unify scattered context fragments
- `context_compress` - Compress using strategies (skeleton|summary|tree_shaking|ultra_compact)
- `analyze_token_cost` - Estimate token cost for context items

**Documentation (6 tools)**
- `docs_search` - Search through documentation and markdown files
- `docs_get_for_symbol` - Get documentation for specific symbol
- `docs_generate` - Generate high-quality docs with examples
- `docs_validate` - Validate documentation quality with scoring
- `docs_transform` - Transform docs to standardized format
- `catalog_*` - Catalog search and project listing (3 tools)

**Code Generation (4 tools)**
- `examples_generate` - Generate code examples (basic|intermediate|advanced)
- `examples_validate` - Validate examples for syntax/compilation
- `tests_generate` - Generate unit/integration/e2e tests
- `tests_validate` - Validate generated tests and estimate coverage

**Semantic Links (12 tools)**
- `links_find_implementation` - Find code implementing a spec
- `links_find_documentation` - Find docs for code
- `links_find_examples` - Find examples demonstrating usage
- `links_find_tests` - Find tests verifying code
- `links_add_link` - Add semantic link between entities
- `links_remove_link` - Remove a link
- `links_get_links` - Get all links for an entity
- `links_validate` - Validate and update link status
- `links_trace_path` - Find path between entities through links
- `links_get_health` - Get health metrics for links system
- `links_find_orphans` - Find entities with no links
- `links_extract_from_file` - Extract semantic links from file

**Global Registry (8 tools)**
- `global_list_monorepos` - List all registered monorepos
- `global_search_all_projects` - Search across all monorepos
- `global_get_dependency_graph` - Get project dependencies
- `external_get_documentation` - Get docs from external project
- `external_find_usages` - Find symbol usages across monorepos
- `monorepo_list_projects` - List projects in current monorepo
- `monorepo_set_context` - Set working context to specific project
- `monorepo_find_cross_references` - Find cross-project references

**Analysis & Statistics (6+ tools)**
- `analyze_complexity` - Analyze code complexity metrics
- `analyze_token_cost` - Estimate token costs
- `memory_get_statistics` - Memory system statistics
- `attention_retrieve` - Retrieve based on attention patterns
- `attention_analyze_patterns` - Analyze attention and drift
- `predict_next_action` - Predict next likely action from context

### Token Efficiency Benefits

**Progress System vs TodoWrite:**
- **70% fewer tokens** - Structured data vs markdown parsing
- **Progressive loading** - Fetch summaries first, details on demand
- **Server-side filtering** - Only relevant data returned
- **Detail level control** - skeleton|interface|implementation|full

**Code Tools vs Read/Grep:**
- **90% reduction** - Get single symbol vs entire file
- **Semantic awareness** - Type-aware searches
- **Relationship mapping** - See dependencies without reading files
- **Context-aware** - Prioritized results based on usage

### Git Commit Message Format

When committing, reference tasks and specs:

```bash
# Format: <type>: <description> (task:<task_id>)
feat: implement progress tracking API (task:550e8400-e29b-41d4-a716-446655440000)

- Implemented complete CRUD operations for tasks
- Added auto-episode creation on task completion
- Created 12 integration tests (all passing)
- Added SQLite indexes for query performance

Closes: task:550e8400-e29b-41d4-a716-446655440000
Episode: ep_20251018_142530_abc123
Spec: progress-tracking-spec#3.2
Files: src/progress/api.rs, src/progress/db.rs, tests/progress_test.rs
```

**Commit types**: feat, fix, refactor, docs, test, chore, perf, style, ci

### Environment Setup

**CRITICAL**: Run this at the start of EVERY session to ensure all tools are available:

```bash
# Set complete PATH with all required binaries
export PATH="/Users/taaliman/.cargo/bin:/Users/taaliman/.bun/bin:/Users/taaliman/.deno/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/bin:$PATH"

# Verify tools are available
which cargo  # Should output: /Users/taaliman/.cargo/bin/cargo
which bun    # Should output: /Users/taaliman/.bun/bin/bun
which deno   # Should output: /Users/taaliman/.deno/bin/deno

# Build Meridian MCP server (if not already built)
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian
cargo build --release

# MCP server auto-starts via Claude Code configuration
# Server location: meridian/target/release/meridian-mcp
# Config location: ~/.config/claude-code/mcp.json
```

### Example: Complete Task Workflow

```typescript
// 1. Search for similar past work
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "Implement REST API endpoints",
  limit: 5
});
// Review episodes to see what approaches worked before

// 2. Check spec for requirements
const specSection = await mcp__meridian__specs_get_section({
  spec_name: "api-spec",
  section_name: "REST Endpoints"
});

// 3. Create task
const task = await mcp__meridian__progress_create_task({
  title: "Implement REST API endpoints",
  description: "Create GET/POST/PUT/DELETE endpoints for user resource",
  spec_ref: { spec_name: "api-spec", section: "REST Endpoints" },
  priority: "high",
  estimated_hours: 6,
  tags: ["api", "backend", "rest"]
});

// 4. Start work
await mcp__meridian__progress_update_task({
  task_id: task.task_id,
  status: "in_progress"
});

// 5. Search for existing patterns
const symbols = await mcp__meridian__code_search_symbols({
  query: "api handler",
  type: ["function", "class"],
  detail_level: "interface"
});

// 6. Get dependencies to understand integration points
const deps = await mcp__meridian__code_get_dependencies({
  entry_point: "src/api/mod.rs",
  depth: 2,
  direction: "both"
});

// 7. During implementation - update status
await mcp__meridian__progress_update_task({
  task_id: task.task_id,
  status_note: "Completed GET/POST endpoints, working on PUT/DELETE"
});

// 8. Generate tests
const tests = await mcp__meridian__tests_generate({
  symbol_id: "api::UserHandler::get",
  test_type: "integration",
  framework: "jest"
});

// 9. Complete task (auto-creates episode)
await mcp__meridian__progress_mark_complete({
  task_id: task.task_id,
  actual_hours: 5.5,
  commit_hash: "a1b2c3d4...",
  note: "All endpoints implemented with full test coverage",
  solution_summary: "Used dependency injection for database access, implemented middleware for auth",
  files_touched: [
    "src/api/user_handler.rs",
    "src/api/middleware.rs",
    "tests/api_integration_test.rs"
  ],
  queries_made: [
    "code.search_symbols handler",
    "code.get_dependencies src/api/mod.rs",
    "specs.get_section REST Endpoints"
  ]
});

// Episode is automatically recorded with all context!
```

## Key Commands

### Development Workflow
```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm dev              # Development mode
pnpm test             # Run all tests
pnpm fix:all          # Fix linting and formatting before committing
pnpm changeset        # Create changesets for version management
pnpm cleanup          # Clean up all node_modules
```

### Testing Commands
```bash
pnpm test                                              # Run all tests
pnpm --filter @omnitron-dev/[package] test             # Test specific package
pnpm --filter @omnitron-dev/[package] test:bun         # Run Bun tests
```

## Omnitron Packages

### Core Packages

**@omnitron-dev/titan** - Minimalist framework for distributed, runtime-agnostic applications
- Integrated: Nexus DI, Netron RPC, Rotif messaging
- Modules: Config, Events, Scheduler, Redis, Logger
- Decorator-based API with lifecycle management
- ✅ Node.js 22+, Bun 1.2+, 🚧 Deno (experimental)

**@omnitron-dev/rotif** - Redis-based reliable messaging
- Exactly-once processing with deduplication
- Retry with exponential backoff, DLQ for failures
- Consumer groups for horizontal scaling

**@omnitron-dev/common** - Essential utilities
- Promise utilities (defer, delay, retry, timeout)
- Data structures (ListBuffer, TimedMap)
- Type predicates and guards

**@omnitron-dev/eventemitter** - Universal event emitter
- Sync/async patterns, parallel/sequential execution
- Works in Node.js, Bun, browsers

**@omnitron-dev/smartbuffer** - Enhanced binary data manipulation
**@omnitron-dev/messagepack** - High-performance MessagePack serialization
**@omnitron-dev/cuid** - Collision-resistant unique identifiers
**@omnitron-dev/testing** - Testing utilities and helpers

### Frontend Framework (In Development)

**Aether** - Minimalist, high-performance frontend framework
- Fine-grained reactivity with signals (inspired by SolidJS)
- File-based routing, Islands architecture, SSR/SSG
- Contract-based Titan integration via Netron RPC
- Separate DI system (lightweight, tree-shakeable)
- ~6KB gzipped core runtime
- 📋 Specs complete in `specs/frontend/`

**Key Decision**: Aether and Titan use **separate DI systems** connected via TypeScript interface contracts for security and optimization.

## Development Guidelines

### Technology Stack
- **Language**: TypeScript 5.8.3-5.9.2 with strict mode
- **Runtime**: Node.js 22+, Bun 1.2+ (both fully supported)
- **Build**: Turborepo + TSC
- **Package Manager**: pnpm 9.15.0
- **Testing**: Jest 30.x (Node.js), Bun test (Bun)
- **Linting**: ESLint v9 flat config
- **Serialization**: MessagePack
- **Messaging**: Redis

### Titan Development Patterns

**Application Structure**:
```typescript
import { Application, Module, Injectable } from '@omnitron-dev/titan';

@Injectable()
class MyService {
  doSomething() { /* ... */ }
}

@Module({
  providers: [MyService],
  exports: [MyService]
})
class MyModule {}

const app = await Application.create(MyModule);
await app.start();
```

**Service with Decorators**:
```typescript
@Service('calculator@1.0.0')
export class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }
}
```

**Event Handling**:
```typescript
@OnEvent('user.created')
async handleUserCreated(data: any) {
  // Handle event
}
```

**Message Handler**:
```typescript
@Injectable()
export class OrderService {
  @RotifSubscribe('orders.created')
  async handleOrderCreated(message: RotifMessage) {
    await this.processOrder(message.payload);
    await message.ack();
  }
}
```

### Module Import/Export Rules

**CRITICAL**: Never re-export modules from `packages/titan/src/index.ts` - causes circular dependencies and breaks tree-shaking.

```typescript
// ✅ CORRECT - Use package.json exports
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';
import { EventsModule } from '@omnitron-dev/titan/module/events';
import { SchedulerModule } from '@omnitron-dev/titan/module/scheduler';
import { TitanRedisModule } from '@omnitron-dev/titan/module/redis';

// ❌ WRONG - Don't import modules from root
import { ConfigModule } from '@omnitron-dev/titan';
```

**Module System**:
- All modules implement unified `IModule` interface from `nexus/types.ts`
- No wrappers or adapters needed
- Each module's exports defined ONLY in package.json

### Code Quality Standards

- ESLint enforces import sorting and unused import removal
- Prettier: 2 spaces, single quotes, semicolons
- All code must pass linting and formatting before committing
- Write tests for new functionality
- Use existing patterns from `@omnitron-dev/common`
- Ensure Bun compatibility

### Working with Monorepo

1. Add dependencies to specific packages: `pnpm --filter @omnitron-dev/[package] add [dep]`
2. Internal packages use workspace protocol: `"@omnitron-dev/common": "workspace:*"`
3. Follow existing package structure for new packages
4. Ensure all packages build successfully before committing
5. Use changesets for version management
6. Test with both Node.js and Bun when possible

### Recent Breaking Changes

**Pino Logger v9.9.x** - Object parameter comes first:
```typescript
// Old (v9.7.x)
logger.info('message', { data });

// New (v9.9.x)
logger.info({ data }, 'message');
```

## Testing

### Best Practices
1. **Runtime Testing**: Test with both Node.js and Bun
2. **State Management**: Use `disableGracefulShutdown: true` in tests
3. **Module Testing**: Use `disableCoreModules: true` for isolation
4. **Async Operations**: Properly await all promises
5. **Cleanup**: Ensure proper cleanup in afterEach blocks

### Docker Redis Testing

**Important Paths**:
- Docker binary: `/usr/local/bin/docker`
- Docker Compose: Use `docker compose` (v2)
- Test utilities: `packages/titan/test/utils/`
  - `redis-test-manager.ts` - Docker container management
  - `redis-fallback.ts` - Fallback to local Redis
- Compose file: `packages/titan/test/docker/docker-compose.test.yml`

**Running Redis Tests**:
```bash
cd packages/titan
npm test -- test/modules/redis/                        # Run Redis tests
npm test -- test/modules/redis/redis.service.spec.ts   # Specific test
USE_REAL_REDIS=true npm test -- test/modules/redis/    # Use real Redis

# Manual container management
npm run redis:start    # Start test container
npm run redis:stop     # Stop test container
npm run redis:cleanup  # Cleanup all containers
```

**Configuration**:
- Uses ioredis (not redis package)
- Dynamic port allocation for parallel runs
- Automatic cleanup after tests
- Fallback to local Redis if Docker unavailable

## Notes for AI Assistants

**Critical Workflows**:
1. **NEVER create report files** - Use Meridian MCP progress tracking
2. **Always use MCP tools first** - More efficient than traditional file operations
3. **Record episodes on completion** - Use `progress.mark_complete` for auto-episode creation
4. **Reference specs and tasks in commits** - Include task IDs and spec sections

**Architecture**:
- Namespace: @omnitron-dev (transitioned from @devgrid)
- **Nexus** = DI system inside Titan (backend)
- **Aether** = Frontend framework (separate from Titan)
- Nexus DI and Netron are integrated into Titan
- Titan = backend framework, Aether = frontend framework

**Key Points**:
- Focus on runtime compatibility (Node.js and Bun)
- State management quirks in Titan tests
- TypeScript versions vary: 5.8.3 - 5.9.2
- Watch for breaking changes (especially Pino logger)
- Meridian MCP server has 72+ tools - use them!

## Planned Projects

**Tron** (apps/tron) - Process manager for Titan applications
- Deep Titan integration with multi-process orchestration
- Health monitoring, auto-restart, load balancing
- Configuration management, log aggregation
- Zero-downtime deployments
- Similar to PM2 but with native Titan integration
