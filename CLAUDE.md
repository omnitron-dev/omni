# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript monorepo for the Omnitron ecosystem - a collection of minimalist, high-performance libraries for building distributed systems. At its core is **Titan**, a lightweight framework designed for distributed, runtime-agnostic applications with enterprise reliability. The monorepo uses Turborepo for build orchestration and pnpm 9.15.0 for package management.

**Runtime Support**: Node.js >=22.0.0 (primary), Bun >=1.2.0 (fully supported), Deno (experimental)

## ⚡ Meridian MCP Integration - CRITICAL WORKFLOW

**The `/meridian` subdirectory contains a production-ready Rust MCP server with 103 tools for code analysis, progress tracking, and memory management. This is the PRIMARY and ONLY workflow for all development tasks.**

### 🚫 ABSOLUTE RULES

**NEVER USE TodoWrite** - Use `progress.*` MCP tools instead
**NEVER CREATE .md REPORTS** - All data goes into Progress System (SQLite DB)
**NEVER USE grep/Read FOR CODE SEARCH** - Use `code.search_symbols`, `code.get_definition`
**ALWAYS START WITH**: `memory.find_similar_episodes` for past solutions

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

**1. Always Use MCP Tools First - Complete Catalog (91 tools)**

**Code Analysis** (10 tools):
- `code.search_symbols` - Semantic search with type filtering (NOT grep!)
- `code.get_definition` - Get symbol definition with body (NOT Read!)
- `code.find_references` - Find all references to symbol
- `code.get_dependencies` - Dependency graph analysis
- `code.search_patterns` - AST-based pattern search
- `analyze.complexity` - Code complexity metrics
- `analyze.token_cost` - Estimate token usage

**Progress & Tasks** (10 tools):
- `progress.create_task`, `progress.update_task`, `progress.mark_complete`
- `progress.list_tasks`, `progress.get_task`, `progress.delete_task`
- `progress.search_tasks`, `progress.get_progress`, `progress.get_history`
- `progress.add_dependency`, `progress.remove_dependency`, `progress.can_start_task`

**Memory System** (3 tools):
- `memory.find_similar_episodes` - Find past solutions (START HERE!)
- `memory.record_episode` - Auto-called by progress.mark_complete
- `memory.get_statistics` - Memory usage stats

**Specs** (5 tools):
- `specs.list`, `specs.get_structure`, `specs.get_section`, `specs.search`, `specs.validate`

**Session** (4 tools):
- `session.begin`, `session.update`, `session.query`, `session.complete`

**Context** (3 tools):
- `context.prepare_adaptive`, `context.defragment`, `context.compress`

**Documentation** (6 tools):
- `docs.search`, `docs.get_for_symbol`, `docs.generate`, `docs.validate`, `docs.transform`
- `catalog.search_documentation`

**Examples & Tests** (4 tools):
- `examples.generate`, `examples.validate`
- `tests.generate`, `tests.validate`

**Links** (12 tools):
- `links.find_implementation`, `links.find_documentation`, `links.find_examples`, `links.find_tests`
- `links.add_link`, `links.remove_link`, `links.get_links`, `links.validate`
- `links.trace_path`, `links.get_health`, `links.find_orphans`, `links.extract_from_file`

**Monorepo** (8 tools):
- `monorepo.list_projects`, `monorepo.set_context`, `monorepo.find_cross_references`
- `global.list_monorepos`, `global.search_all_projects`, `global.get_dependency_graph`
- `external.get_documentation`, `external.find_usages`

**Attention & Learning** (4 tools):
- `attention.retrieve`, `attention.analyze_patterns`
- `learning.train_on_success`, `predict.next_action`

**History** (2 tools):
- `history.get_evolution`, `history.blame`

**Backup** (7 tools):
- `backup.create`, `backup.list`, `backup.restore`, `backup.verify`, `backup.delete`, `backup.get_stats`

**Anti-Patterns** (NEVER DO):
- ❌ `Read` entire file → Use `code.get_definition`
- ❌ `Grep` for code → Use `code.search_symbols`
- ❌ `TodoWrite` → Use `progress.*` tools
- ❌ Manual search → Use `specs.search` or `docs.search`

**2. Complete Progress Tracking Workflow**

Every development task follows this workflow:

```typescript
// STEP 1: Create task at the start
const task = await mcp__meridian__task_create_task({
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
await mcp__meridian__task_update_task({
  task_id: task.task_id,
  status: "in_progress",
  status_note: "Starting implementation"
});

// STEP 3: During work - update as needed
await mcp__meridian__task_update_task({
  task_id: task.task_id,
  status_note: "Completed API endpoints, working on tests"
});

// STEP 4: Complete the task (auto-creates episode in memory system)
await mcp__meridian__task_mark_complete({
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
await mcp__meridian__task_list_tasks({
  spec_name: "progress-tracking-spec",
  status: "in_progress",
  limit: 20
});

// Search tasks by title or content
await mcp__meridian__task_search_tasks({
  query: "API implementation",
  limit: 10
});

// Get progress statistics
await mcp__meridian__task_get_progress({
  spec_name: "progress-tracking-spec"  // or omit for all specs
});

// Link task to spec section (if not done at creation)
await mcp__meridian__task_link_to_spec({
  task_id: "abc123",
  spec_name: "progress-tracking-spec",
  section: "Section 3.2"
});

// View complete history of a task
await mcp__meridian__task_get_history({
  task_id: "abc123"
});
```

### Complete MCP Tools Catalog (103 Tools)

All tool names use dot notation (e.g., `memory.find_similar_episodes`, `code.search_symbols`).

**Memory Management (3 tools)**
- `memory.record_episode` - Record completed work for future learning
- `memory.find_similar_episodes` - Find similar past tasks to guide current work
- `memory.update_working_set` - Update working memory with attention weights
- `memory.get_statistics` - Get memory system statistics and usage info

**Code Analysis (5 tools)**
- `code.search_symbols` - Search for functions, classes, interfaces with filters
  - Params: `query`, `type` (array), `scope`, `detail_level`, `max_tokens`, `max_results`
- `code.search_patterns` - AST-based pattern search using tree-sitter
  - Params: `pattern`, `language`, `scope`, `max_results`, `offset`
- `code.get_definition` - Get full definition of a specific symbol
  - Params: `symbol_id`, `include_body`, `include_dependencies`, `include_references`
- `code.find_references` - Find all references to a symbol
  - Params: `symbol_id`, `group_by_file`, `include_context`
- `code.get_dependencies` - Get dependency graph for symbol or file
  - Params: `entry_point`, `depth` (default: 3), `direction` (imports|exports|both)

**Progress Tracking (15 tools)**
- `task.create_task` - Create new task
- `task.update_task` - Update task status, priority, estimates
- `task.list_tasks` - List tasks with filters (status, spec, limit)
- `task.get_task` - Get detailed task information
- `task.delete_task` - Delete a task
- `task.search_tasks` - Search tasks by title/content
- `task.link_to_spec` - Link task to specification section
- `task.get_history` - Get complete status change history
- `task.get_progress` - Get statistics and progress metrics
- `task.mark_complete` - Mark complete with auto-episode creation ⭐
- `task.add_dependency` - Add dependency between tasks (prevents circular deps)
- `task.remove_dependency` - Remove dependency relationship
- `task.get_dependencies` - Get all tasks this task depends on
- `task.get_dependents` - Get all tasks that depend on this task
- `task.can_start_task` - Check if task can start (validates dependencies)

**Specifications (5 tools)**
- `specs.list` - List all available specifications
- `specs.get_structure` - Get TOC and metadata for a spec
- `specs.get_section` - Get content of specific section
- `specs.search` - Search across all specifications
- `specs.validate` - Validate spec completeness and quality

**Session Management (4 tools)**
- `session.begin` - Start isolated work session with copy-on-write
- `session.update` - Update files in session with reindexing
- `session.query` - Query within session context
- `session.complete` - Complete session (commit|discard|stash)

**Context Optimization (3 tools)**
- `context.prepare_adaptive` - Prepare context for specific LLM and token budget
- `context.defragment` - Unify scattered context fragments
- `context.compress` - Compress using strategies (remove_comments|remove_whitespace|skeleton|summary|extract_key_points|tree_shaking|hybrid|ultra_compact)

**Documentation (6 tools)**
- `docs.search` - Search through documentation and markdown files
- `docs.get_for_symbol` - Get documentation for specific symbol
- `docs.generate` - Generate high-quality docs with examples (tsdoc|jsdoc|rustdoc)
- `docs.validate` - Validate documentation quality with scoring
- `docs.transform` - Transform docs to standardized format
- `catalog.list_projects`, `catalog.get_project`, `catalog.search_documentation` - Global catalog tools

**Code Generation (4 tools)**
- `examples.generate` - Generate code examples (basic|intermediate|advanced)
- `examples.validate` - Validate examples for syntax/compilation
- `tests.generate` - Generate unit/integration/e2e tests (jest|vitest|bun|rust)
- `tests.validate` - Validate generated tests and estimate coverage

**Semantic Links (16 tools)**
- `links.find_implementation` - Find code implementing a spec
- `links.find_documentation` - Find docs for code
- `links.find_examples` - Find examples demonstrating usage
- `links.find_tests` - Find tests verifying code
- `links.add_link` - Add semantic link between entities
- `links.remove_link` - Remove a link
- `links.get_links` - Get all links for an entity
- `links.validate` - Validate and update link status
- `links.trace_path` - Find path between entities through links
- `links.get_health` - Get health metrics for links system
- `links.find_orphans` - Find entities with no links
- `links.extract_from_file` - Extract semantic links from file
- `indexer.enable_watching`, `indexer.disable_watching`, `indexer.get_watch_status`, `indexer.poll_changes` - Watch control

**Global Registry (8 tools)**
- `global.list_monorepos` - List all registered monorepos
- `global.search_all_projects` - Search across all monorepos
- `global.get_dependency_graph` - Get project dependencies
- `external.get_documentation` - Get docs from external project
- `external.find_usages` - Find symbol usages across monorepos
- `monorepo.list_projects` - List projects in current monorepo
- `monorepo.set_context` - Set working context to specific project
- `monorepo.find_cross_references` - Find cross-project references

**Graph Analysis (12 tools)**
- `graph.find_dependencies` - Find all dependencies (transitive, depth 1-10)
- `graph.find_dependents` - Find reverse dependencies
- `graph.semantic_search` - Semantic similarity search (embedding-based)
- `graph.find_similar_patterns` - Find symbols with similar structure
- `graph.impact_analysis` - Analyze impact of changes to symbols
- `graph.code_lineage` - Trace evolution through historical episodes
- `graph.get_call_graph` - Get what a symbol calls
- `graph.get_callers` - Get what calls a symbol
- `graph.get_stats` - Overall graph statistics
- `graph.find_hubs` - Find most connected symbols
- `graph.find_circular_dependencies` - Detect circular dependencies
- `graph.get_symbol_full` - Get complete symbol info with all relationships

**Analysis & Statistics (6 tools)**
- `analyze.complexity` - Code complexity metrics (cyclomatic|cognitive|lines|dependencies)
- `analyze.token_cost` - Estimate token costs for context items
- `attention.retrieve` - Retrieve based on attention patterns
- `attention.analyze_patterns` - Analyze attention and drift
- `learning.train_on_success` - Train system on successful completion
- `predict.next_action` - Predict next likely action from context

**History Tools (2 tools)**
- `history.get_evolution` - Get git evolution history of file/symbol
- `history.blame` - Get git blame information

**Backup & Recovery (8 tools)**
- `backup.create` - Create manual backup with description/tags
- `backup.list` - List all backups with filters
- `backup.restore` - Restore from backup (creates safety backup first)
- `backup.verify` - Verify backup integrity
- `backup.delete` - Delete a backup
- `backup.get_stats` - Get backup system statistics
- `backup.create_scheduled` - Create scheduled backup (internal)
- `backup.create_pre_migration` - Pre-migration backup (internal)

**System Tools (2 tools)**
- `system.health` - Get system health, uptime, memory, metrics
- `indexer.index_project` - Manually index project directory

## Meridian MCP Tools - Complete Reference

This section provides exact tool names, parameters, return values, and usage examples based on the actual Meridian implementation.

### 🔧 Critical Workflow Rules

**ALWAYS DO FIRST:**
1. **Index project**: `mcp__meridian__indexer_index_project({ path: "/absolute/path/to/project" })`
2. **Search similar episodes**: `mcp__meridian__memory_find_similar_episodes({ task_description: "..." })`
3. **Create task**: `mcp__meridian__task_create_task({ title: "...", ... })`
4. **Use code search**: `mcp__meridian__code_search_symbols({ query: "...", ... })`

**NEVER DO:**
- ❌ Use `TodoWrite` → Use `task.*` tools
- ❌ Create `.md` reports → Use `task.*` and `memory.*` tools
- ❌ Use `Grep`/`Read` for code → Use `code.search_symbols` / `code.get_definition`
- ❌ Manual tracking → Everything goes in SQLite database

### Memory System

**`memory.find_similar_episodes`** - Find past solutions to similar tasks
```typescript
mcp__meridian__memory_find_similar_episodes({
  task_description: "Implement REST API endpoints",  // Required
  limit: 5                                            // Optional, default: 5
})
// Returns: Array of episodes with task, solution, outcome, queries, files
```

**`memory.record_episode`** - Record completed work (usually auto-called)
```typescript
mcp__meridian__memory_record_episode({
  task: "Task description",                          // Required
  outcome: "success",                                // Required: success|failure|partial
  solution: "Approach taken",                        // Optional
  queries_made: ["code.search...", "specs.get..."],  // Optional
  files_accessed: ["src/api/handler.rs"]             // Optional
})
```

**`memory.update_working_set`** - Update working memory with attention
```typescript
mcp__meridian__memory_update_working_set({
  session_id: "sess_abc123",                         // Required
  focused_symbols: [                                  // Required
    { symbol: "UserHandler::get", weight: 0.9 },
    { symbol: "authenticate", weight: 0.7 }
  ],
  accessed_files: ["src/api/handler.rs"]             // Required
})
```

**`memory.get_statistics`** - Get memory system stats
```typescript
mcp__meridian__memory_get_statistics({
  include_details: true,                             // Optional, default: false
  project_path: "/path/to/project"                   // Optional
})
```

### Code Analysis

**`code.search_symbols`** - Semantic symbol search (PRIMARY CODE SEARCH)
```typescript
mcp__meridian__code_search_symbols({
  query: "authentication handler",                   // Required
  type: ["function", "class"],                       // Optional: array of types
  scope: "src/api",                                  // Optional: path to limit scope
  detail_level: "interface",                         // Optional: skeleton|interface|implementation|full
  max_results: 20,                                   // Optional
  max_tokens: 5000                                   // Optional: hard token limit
})
// Returns: Array of symbols with name, type, location, signature
```

**`code.search_patterns`** - AST-based pattern matching
```typescript
mcp__meridian__code_search_patterns({
  pattern: "async fn.*handler",                      // Required: regex or AST pattern
  language: "rust",                                  // Optional: rust|typescript|javascript|python|go
  scope: "src/",                                     // Optional: limit to path
  max_results: 100,                                  // Optional, max: 1000
  offset: 0                                          // Optional: for pagination
})
```

**`code.get_definition`** - Get full symbol definition (NOT Read!)
```typescript
mcp__meridian__code_get_definition({
  symbol_id: "UserHandler::authenticate",            // Required
  include_body: true,                                // Optional, default: true
  include_references: false,                         // Optional, default: false
  include_dependencies: false                        // Optional, default: false
})
// Returns: Complete definition with body, docs, location
```

**`code.find_references`** - Find all references to symbol
```typescript
mcp__meridian__code_find_references({
  symbol_id: "UserHandler::authenticate",            // Required
  group_by_file: true,                               // Optional, default: true
  include_context: false                             // Optional, default: false (adds surrounding lines)
})
```

**`code.get_dependencies`** - Get dependency graph
```typescript
mcp__meridian__code_get_dependencies({
  entry_point: "src/api/mod.rs",                     // Required: file path or symbol_id
  depth: 3,                                          // Optional, default: 3
  direction: "both"                                  // Optional: imports|exports|both, default: both
})
```

### Task/Progress Tracking

**`task.create_task`** - Create new task
```typescript
mcp__meridian__task_create_task({
  title: "Implement user authentication",            // Required
  description: "Add JWT-based auth with refresh",    // Optional
  priority: "high",                                  // Optional: low|medium|high|critical
  spec_ref: {                                        // Optional
    spec_name: "auth-spec",
    section: "Section 3.1"
  },
  tags: ["backend", "security", "auth"],             // Optional
  estimated_hours: 8                                 // Optional
})
// Returns: { task_id, created_at, status: "pending" }
```

**`task.update_task`** - Update task
```typescript
mcp__meridian__task_update_task({
  task_id: "task_abc123",                            // Required
  status: "in_progress",                             // Optional: pending|in_progress|blocked|done|cancelled
  status_note: "Completed JWT impl, working on refresh", // Optional
  priority: "critical",                              // Optional
  estimated_hours: 10,                               // Optional
  actual_hours: 6,                                   // Optional
  commit_hash: "a1b2c3d4"                            // Optional
})
```

**`task.mark_complete`** - Complete task (auto-records episode!)
```typescript
mcp__meridian__task_mark_complete({
  task_id: "task_abc123",                            // Required
  actual_hours: 7.5,                                 // Optional
  commit_hash: "a1b2c3d4...",                        // Optional
  note: "Completed with full test coverage",         // Optional
  solution_summary: "Used JWT with refresh tokens",  // Recommended
  files_touched: ["src/auth/*.rs", "tests/auth_test.rs"], // Recommended
  queries_made: ["code.search_symbols jwt", "specs.get_section Auth"] // Recommended
})
// Automatically creates episode in memory system!
```

**`task.list_tasks`** - List tasks with filters
```typescript
mcp__meridian__task_list_tasks({
  status: "in_progress",                             // Optional
  spec_name: "auth-spec",                            // Optional
  limit: 20                                          // Optional
})
```

**`task.add_dependency`** - Add task dependency (prevents circular)
```typescript
mcp__meridian__task_add_dependency({
  task_id: "task_frontend",                          // Required
  depends_on: "task_backend_api"                     // Required
})
// Error if circular dependency detected
```

**`task.can_start_task`** - Check if task can start
```typescript
mcp__meridian__task_can_start_task({
  task_id: "task_abc123"                             // Required
})
// Returns: { can_start: boolean, blockers: [...], unmet_dependencies: [...] }
```

### Specifications

**`specs.list`** - List all specifications
```typescript
mcp__meridian__specs_list({})
// Returns: Array of specs with name, path, version, status, sections
```

**`specs.get_section`** - Get spec section content
```typescript
mcp__meridian__specs_get_section({
  spec_name: "auth-spec",                            // Required (without .md)
  section_name: "JWT Implementation"                 // Required (or partial name)
})
// Returns: { content: "...", section_title: "..." }
```

**`specs.search`** - Search across all specs
```typescript
mcp__meridian__specs_search({
  query: "authentication flow",                      // Required
  max_results: 20                                    // Optional, default: 20
})
// Returns: Array with spec_name, section_title, snippet, line_start, line_end
```

### Graph Analysis (NEW - 12 powerful tools)

**`graph.semantic_search`** - Natural language code search
```typescript
mcp__meridian__graph_semantic_search({
  query: "functions that handle user login",         // Required
  limit: 10                                          // Optional, default: 10, max: 100
})
// Returns: Semantically similar symbols based on embeddings
```

**`graph.find_dependencies`** - Transitive dependency analysis
```typescript
mcp__meridian__graph_find_dependencies({
  symbol_id: "UserService::login",                   // Required
  depth: 5                                           // Optional, default: 3, range: 1-10
})
// Returns: Full dependency tree up to specified depth
```

**`graph.impact_analysis`** - Find all code affected by changes
```typescript
mcp__meridian__graph_impact_analysis({
  changed_symbols: [                                 // Required: array of symbol IDs
    "AuthService::verify",
    "TokenManager::refresh"
  ]
})
// Returns: All symbols that depend on these (directly or transitively)
```

**`graph.find_circular_dependencies`** - Detect circular deps
```typescript
mcp__meridian__graph_find_circular_dependencies({})
// Returns: Array of circular dependency chains
```

**`graph.find_hubs`** - Find most connected symbols (architectural hubs)
```typescript
mcp__meridian__graph_find_hubs({
  limit: 20                                          // Optional, default: 20, max: 100
})
// Returns: Symbols with highest in/out degree (potential refactoring targets)
```

**`graph.get_symbol_full`** - Complete symbol info with relationships
```typescript
mcp__meridian__graph_get_symbol_full({
  symbol_id: "UserService"                           // Required
})
// Returns: Definition, dependencies, dependents, callers, calls, documentation
```

### Session Management

**`session.begin`** - Start isolated work session
```typescript
mcp__meridian__session_begin({
  task_description: "Refactor auth module",          // Required
  scope: ["src/auth/", "tests/auth/"],               // Optional: files/dirs in scope
  base_commit: "main"                                // Optional: git commit base
})
// Returns: { session_id, created_at }
```

**`session.update`** - Update file in session (with reindexing)
```typescript
mcp__meridian__session_update({
  session_id: "sess_abc123",                         // Required
  path: "src/auth/handler.rs",                       // Required
  content: "new content...",                         // Required
  reindex: true                                      // Optional, default: true
})
```

**`session.complete`** - Finish session
```typescript
mcp__meridian__session_complete({
  session_id: "sess_abc123",                         // Required
  action: "commit",                                  // Required: commit|discard|stash
  commit_message: "Refactored auth module"           // Required if action=commit
})
```

### Indexer & System

**`indexer.index_project`** - Index codebase (ALWAYS DO FIRST!)
```typescript
mcp__meridian__indexer_index_project({
  path: "/Users/taaliman/projects/omnitron-dev/omni", // Required: absolute path
  force: false                                       // Optional: re-index even if unchanged
})
// Returns: { indexed_files, symbols_extracted, time_taken_ms }
```

**`system.health`** - Get system health
```typescript
mcp__meridian__system_health({})
// Returns: { uptime, memory_usage, component_stats, metrics }
```

### Backup & Recovery

**`backup.create`** - Create manual backup
```typescript
mcp__meridian__backup_create({
  description: "Before auth refactor",               // Optional
  tags: ["pre-refactor", "auth"]                     // Optional
})
// Returns: { backup_id, created_at, size_bytes, verified }
```

**`backup.restore`** - Restore from backup
```typescript
mcp__meridian__backup_restore({
  backup_id: "backup_abc123",                        // Required
  target_path: "/custom/path"                        // Optional
})
// Creates safety backup before restore!
```

### Common Patterns & Best Practices

**1. Starting a New Task**
```typescript
// Step 1: Find similar past work
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "Implement authentication",
  limit: 5
});

// Step 2: Index project (if not already done)
await mcp__meridian__indexer_index_project({
  path: "/absolute/path/to/project"
});

// Step 3: Create task
const task = await mcp__meridian__task_create_task({
  title: "Implement JWT authentication",
  description: "Add JWT with refresh tokens",
  priority: "high",
  tags: ["auth", "security"]
});

// Step 4: Start work
await mcp__meridian__task_update_task({
  task_id: task.task_id,
  status: "in_progress"
});
```

**2. Code Search & Analysis**
```typescript
// Search by semantic meaning (NOT grep!)
const symbols = await mcp__meridian__code_search_symbols({
  query: "authentication handler",
  type: ["function", "class"],
  detail_level: "interface"
});

// Get full definition (NOT Read!)
const def = await mcp__meridian__code_get_definition({
  symbol_id: symbols[0].id,
  include_body: true,
  include_dependencies: true
});

// Find impact of changes
const impact = await mcp__meridian__graph_impact_analysis({
  changed_symbols: [symbols[0].id]
});
```

**3. Completing Work**
```typescript
// Mark complete with full context
await mcp__meridian__task_mark_complete({
  task_id: task.task_id,
  actual_hours: 6.5,
  commit_hash: "a1b2c3d4",
  solution_summary: "Implemented JWT with RS256, refresh tokens in Redis",
  files_touched: [
    "src/auth/jwt.rs",
    "src/auth/refresh.rs",
    "tests/auth_test.rs"
  ],
  queries_made: [
    "code.search_symbols jwt",
    "graph.find_dependencies TokenManager",
    "specs.get_section Authentication"
  ]
});
// Episode automatically recorded!
```

### Error Handling

**Common Errors:**
- `"Symbol not found"` → Run `indexer.index_project` first
- `"Circular dependency detected"` → Check `task.add_dependency` parameters
- `"Session not found"` → Session may have expired or been completed
- `"Spec not found"` → Check spec name (without .md extension)

**Troubleshooting:**
```typescript
// Check if Meridian is healthy
const health = await mcp__meridian__system_health({});
console.log(health.status); // Should be "healthy"

// Check indexing status
const stats = await mcp__meridian__graph_get_stats({});
console.log(stats.symbol_count); // Should be > 0 if indexed

// Verify backup system
const backupStats = await mcp__meridian__backup_get_stats({});
console.log(backupStats.total_backups);
```

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
const task = await mcp__meridian__task_create_task({
  title: "Implement REST API endpoints",
  description: "Create GET/POST/PUT/DELETE endpoints for user resource",
  spec_ref: { spec_name: "api-spec", section: "REST Endpoints" },
  priority: "high",
  estimated_hours: 6,
  tags: ["api", "backend", "rest"]
});

// 4. Start work
await mcp__meridian__task_update_task({
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
await mcp__meridian__task_update_task({
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
await mcp__meridian__task_mark_complete({
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

## Meridian Self-Improvement & Code Quality Workflow

Use Meridian's graph and analysis tools to continuously improve codebase quality.

### 1. Analysis Phase - Identify Issues

**Find Complexity Hotspots:**
```typescript
// Analyze specific files or symbols
const complexity = await mcp__meridian__analyze_complexity({
  target: "src/auth/handler.rs",
  include_metrics: ["cyclomatic", "cognitive", "lines", "dependencies"]
});
// High cyclomatic/cognitive complexity = refactoring candidates
```

**Find Circular Dependencies:**
```typescript
const circular = await mcp__meridian__graph_find_circular_dependencies({});
// Returns: Array of circular dependency chains to break
```

**Find Architectural Hubs (over-connected code):**
```typescript
const hubs = await mcp__meridian__graph_find_hubs({ limit: 20 });
// High-degree nodes may need decomposition
```

**Find Orphaned Code:**
```typescript
const orphans = await mcp__meridian__links_find_orphans({
  level: "code"  // code|docs|tests|examples
});
// Code with no tests, docs, or specs
```

### 2. Planning Phase - Create Improvement Tasks

**Create Dependency-Linked Tasks:**
```typescript
// Create tasks with dependencies for systematic improvement
const refactorTask = await mcp__meridian__task_create_task({
  title: "Refactor AuthHandler to reduce complexity",
  description: "Split into AuthValidator and AuthProcessor",
  priority: "medium",
  tags: ["refactor", "code-quality", "auth"]
});

const testTask = await mcp__meridian__task_create_task({
  title: "Add missing tests for auth module",
  description: "Coverage currently at 65%, target 90%",
  priority: "high",
  tags: ["testing", "auth"]
});

// Link tasks: tests depend on refactor completing
await mcp__meridian__task_add_dependency({
  task_id: testTask.task_id,
  depends_on: refactorTask.task_id
});
```

**Check if Ready to Start:**
```typescript
const canStart = await mcp__meridian__task_can_start_task({
  task_id: testTask.task_id
});
// Returns: { can_start: false, blockers: ["refactorTask"], ... }
```

### 3. Implementation Phase - Use Sessions

**Isolated Refactoring with Sessions:**
```typescript
// Begin isolated work session
const session = await mcp__meridian__session_begin({
  task_description: "Refactor AuthHandler",
  scope: ["src/auth/", "tests/auth/"],
  base_commit: "main"
});

// Make changes and track in session
await mcp__meridian__session_update({
  session_id: session.session_id,
  path: "src/auth/validator.rs",
  content: "new validator code...",
  reindex: true  // Re-index to update graph
});

// Query within session to verify changes
const impact = await mcp__meridian__graph_impact_analysis({
  changed_symbols: ["AuthValidator::validate"]
});

// Commit or discard based on impact
await mcp__meridian__session_complete({
  session_id: session.session_id,
  action: "commit",
  commit_message: "refactor: split AuthHandler into validator and processor"
});
```

### 4. Validation Phase - Verify Improvements

**Re-analyze Complexity:**
```typescript
const newComplexity = await mcp__meridian__analyze_complexity({
  target: "src/auth/validator.rs",
  include_metrics: ["cyclomatic", "cognitive"]
});
// Compare with baseline to verify reduction
```

**Generate and Validate Tests:**
```typescript
// Generate tests for new code
const tests = await mcp__meridian__tests_generate({
  symbol_id: "AuthValidator::validate",
  test_type: "unit",
  framework: "rust"
});

// Validate generated tests
const validation = await mcp__meridian__tests_validate({
  test: tests.tests[0]
});
// Returns: { valid: true, coverage_estimate: 0.85, ... }
```

**Create Semantic Links:**
```typescript
// Link new code to specs and tests
await mcp__meridian__links_add_link({
  link_type: "implements",
  source_level: "code",
  source_id: "AuthValidator::validate",
  target_level: "spec",
  target_id: "auth-spec#validation",
  confidence: 0.95
});

await mcp__meridian__links_add_link({
  link_type: "tested_by",
  source_level: "code",
  source_id: "AuthValidator::validate",
  target_level: "tests",
  target_id: "auth_validator_test.rs::test_validate_valid_token",
  confidence: 1.0
});
```

### 5. Reflection Phase - Learn and Document

**Complete with Rich Context:**
```typescript
await mcp__meridian__task_mark_complete({
  task_id: refactorTask.task_id,
  actual_hours: 4.5,
  commit_hash: "abc123",
  solution_summary: "Split into AuthValidator (complexity: 8→3) and AuthProcessor (complexity: 12→5). Improved testability and reduced coupling.",
  files_touched: [
    "src/auth/validator.rs",
    "src/auth/processor.rs",
    "tests/auth/validator_test.rs",
    "tests/auth/processor_test.rs"
  ],
  queries_made: [
    "analyze.complexity src/auth/handler.rs",
    "graph.find_dependencies AuthHandler",
    "graph.impact_analysis AuthHandler"
  ]
});
// Episode recorded with learnings for future refactoring tasks
```

**Extract Patterns for Future Use:**
```typescript
// Find similar patterns in codebase for future refactoring
const similar = await mcp__meridian__graph_find_similar_patterns({
  symbol_id: "AuthValidator",
  limit: 10
});
// Identify other high-complexity handlers to refactor
```

### 6. Continuous Monitoring

**Regular Health Checks:**
```typescript
// Check system health
const health = await mcp__meridian__system_health({});

// Get graph statistics
const graphStats = await mcp__meridian__graph_get_stats({});
console.log({
  total_symbols: graphStats.symbol_count,
  total_edges: graphStats.edge_count,
  avg_degree: graphStats.average_degree
});

// Check links health
const linksHealth = await mcp__meridian__links_get_health({});
console.log({
  total_links: linksHealth.total_links,
  valid_links: linksHealth.valid_count,
  broken_links: linksHealth.broken_count
});
```

**Create Regular Backups:**
```typescript
// Before major refactoring
await mcp__meridian__backup_create({
  description: "Before auth module refactor",
  tags: ["pre-refactor", "auth", "milestone"]
});
```

### Self-Improvement Checklist

**Before Each Session:**
- [ ] `indexer.index_project` - Ensure index is current
- [ ] `memory.find_similar_episodes` - Learn from past work
- [ ] `task.create_task` - Create trackable task
- [ ] `backup.create` - Safety backup before major changes

**During Development:**
- [ ] `code.search_symbols` - Find existing patterns (NOT grep/Read)
- [ ] `graph.impact_analysis` - Understand change impact
- [ ] `analyze.complexity` - Monitor complexity metrics
- [ ] `session.begin` - Use sessions for risky changes

**After Completion:**
- [ ] `task.mark_complete` - Record episode with full context
- [ ] `links.add_link` - Create semantic links to specs/tests/docs
- [ ] `graph.find_circular_dependencies` - Verify no new circular deps
- [ ] `backup.create` - Milestone backup

**Weekly Maintenance:**
- [ ] `graph.find_hubs` - Identify over-connected code
- [ ] `links.find_orphans` - Find untested/undocumented code
- [ ] `analyze.complexity` - Find refactoring targets
- [ ] `task.get_progress` - Review completed vs pending tasks

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
1. **NEVER create report files** - Use Meridian MCP task tracking
2. **Always use MCP tools first** - More efficient than traditional file operations
3. **Record episodes on completion** - Use `task.mark_complete` for auto-episode creation
4. **Reference specs and tasks in commits** - Include task IDs and spec sections
5. **Index first** - Always run `indexer.index_project` before code analysis

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
- **Meridian MCP server has 103 tools** - use them!
- All tool names use dot notation: `category.tool_name`
- Graph tools provide powerful dependency and impact analysis

## Planned Projects

**Tron** (apps/tron) - Process manager for Titan applications
- Deep Titan integration with multi-process orchestration
- Health monitoring, auto-restart, load balancing
- Configuration management, log aggregation
- Zero-downtime deployments
- Similar to PM2 but with native Titan integration
