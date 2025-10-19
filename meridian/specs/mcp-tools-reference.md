# Meridian MCP Tools - Complete Reference

**Version**: 1.0.0
**Status**: Active
**Last Updated**: 2025-10-19

This specification provides comprehensive documentation for all 103 Meridian MCP tools, including parameters, return values, and usage examples.

---

## Table of Contents

1. [Memory Management Tools](#memory-management-tools) (4 tools)
2. [Code Analysis Tools](#code-analysis-tools) (5 tools)
3. [Task & Progress Tracking](#task-progress-tracking) (15 tools)
4. [Specifications Tools](#specifications-tools) (5 tools)
5. [Graph Analysis Tools](#graph-analysis-tools) (12 tools)
6. [Session Management](#session-management) (4 tools)
7. [Context Optimization](#context-optimization) (3 tools)
8. [Documentation Tools](#documentation-tools) (6 tools)
9. [Code Generation](#code-generation) (4 tools)
10. [Semantic Links](#semantic-links) (16 tools)
11. [Global Registry](#global-registry) (8 tools)
12. [Analysis & Statistics](#analysis-statistics) (6 tools)
13. [History Tools](#history-tools) (2 tools)
14. [Backup & Recovery](#backup-recovery) (8 tools)
15. [System Tools](#system-tools) (5 tools)

---

## Memory Management Tools

### memory.find_similar_episodes

Find past solutions to similar tasks for learning and guidance.

**Parameters:**
```typescript
{
  task_description: string;  // Required: Description of current task
  limit?: number;            // Optional: Max results (default: 5)
}
```

**Returns:**
```typescript
Array<{
  task: string;
  solution: string;
  outcome: "success" | "failure" | "partial";
  queries_made: string[];
  files_accessed: string[];
  created_at: string;
}>
```

**Example:**
```typescript
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "Implement REST API endpoints",
  limit: 5
});

episodes.forEach(ep => {
  console.log(`Task: ${ep.task}`);
  console.log(`Solution: ${ep.solution}`);
  console.log(`Outcome: ${ep.outcome}`);
});
```

### memory.record_episode

Record completed work for future learning (usually auto-called by `task.mark_complete`).

**Parameters:**
```typescript
{
  task: string;                    // Required: Task description
  outcome: "success" | "failure" | "partial";  // Required
  solution?: string;               // Optional: Approach taken
  queries_made?: string[];         // Optional: Queries executed
  files_accessed?: string[];       // Optional: Files modified
}
```

**Example:**
```typescript
await mcp__meridian__memory_record_episode({
  task: "Implement JWT authentication",
  outcome: "success",
  solution: "Used RS256 algorithm with refresh tokens stored in Redis",
  queries_made: ["code.search_symbols jwt", "specs.get_section Auth"],
  files_accessed: ["src/auth/jwt.rs", "tests/auth_test.rs"]
});
```

### memory.update_working_set

Update working memory with attention weights from LLM focus.

**Parameters:**
```typescript
{
  session_id: string;              // Required
  focused_symbols: Array<{         // Required
    symbol: string;
    weight: number;                // 0.0-1.0
  }>;
  accessed_files: string[];        // Required
}
```

**Example:**
```typescript
await mcp__meridian__memory_update_working_set({
  session_id: "sess_abc123",
  focused_symbols: [
    { symbol: "UserHandler::get", weight: 0.9 },
    { symbol: "authenticate", weight: 0.7 }
  ],
  accessed_files: ["src/api/handler.rs"]
});
```

### memory.get_statistics

Get memory system statistics and usage information.

**Parameters:**
```typescript
{
  include_details?: boolean;       // Optional: Include component breakdown (default: false)
  project_path?: string;           // Optional: Filter by project
}
```

**Returns:**
```typescript
{
  total_episodes: number;
  success_rate: number;
  avg_queries_per_task: number;
  most_common_patterns: string[];
  memory_usage_mb: number;
}
```

---

## Code Analysis Tools

### code.search_symbols

**PRIMARY CODE SEARCH TOOL** - Semantic symbol search with type filtering.

**Parameters:**
```typescript
{
  query: string;                   // Required: Search query
  type?: string[];                 // Optional: ["function", "class", "interface", etc.]
  scope?: string;                  // Optional: Path to limit scope
  detail_level?: "skeleton" | "interface" | "implementation" | "full";
  max_results?: number;            // Optional
  max_tokens?: number;             // Optional: Hard token limit
}
```

**Returns:**
```typescript
Array<{
  id: string;
  name: string;
  type: string;
  location: { file: string; line: number; };
  signature?: string;
  documentation?: string;
}>
```

**Example:**
```typescript
const symbols = await mcp__meridian__code_search_symbols({
  query: "authentication handler",
  type: ["function", "class"],
  scope: "src/api",
  detail_level: "interface",
  max_results: 20
});
```

### code.search_patterns

AST-based pattern matching using tree-sitter (more precise than text search).

**Parameters:**
```typescript
{
  pattern: string;                 // Required: Regex or AST pattern
  language?: "rust" | "typescript" | "javascript" | "python" | "go";
  scope?: string;                  // Optional: Limit to path
  max_results?: number;            // Optional (max: 1000)
  offset?: number;                 // Optional: For pagination
}
```

**Example:**
```typescript
const patterns = await mcp__meridian__code_search_patterns({
  pattern: "async fn.*handler",
  language: "rust",
  scope: "src/",
  max_results: 100
});
```

### code.get_definition

Get full definition of a specific symbol (NOT Read!).

**Parameters:**
```typescript
{
  symbol_id: string;               // Required
  include_body?: boolean;          // Optional (default: true)
  include_references?: boolean;    // Optional (default: false)
  include_dependencies?: boolean;  // Optional (default: false)
}
```

**Returns:**
```typescript
{
  symbol_id: string;
  name: string;
  type: string;
  body: string;
  documentation: string;
  location: { file: string; line: number; };
  dependencies?: string[];
  references?: Array<{ file: string; line: number; }>;
}
```

**Example:**
```typescript
const def = await mcp__meridian__code_get_definition({
  symbol_id: "UserHandler::authenticate",
  include_body: true,
  include_dependencies: true
});
```

### code.find_references

Find all references to a symbol.

**Parameters:**
```typescript
{
  symbol_id: string;               // Required
  group_by_file?: boolean;         // Optional (default: true)
  include_context?: boolean;       // Optional: Adds surrounding lines
}
```

**Example:**
```typescript
const refs = await mcp__meridian__code_find_references({
  symbol_id: "UserHandler::authenticate",
  group_by_file: true,
  include_context: true
});
```

### code.get_dependencies

Get dependency graph for symbol or file.

**Parameters:**
```typescript
{
  entry_point: string;             // Required: File path or symbol_id
  depth?: number;                  // Optional (default: 3)
  direction?: "imports" | "exports" | "both";  // Optional (default: "both")
}
```

**Returns:**
```typescript
{
  entry_point: string;
  dependencies: Array<{
    symbol: string;
    type: "import" | "export";
    depth: number;
  }>;
  graph: Record<string, string[]>;
}
```

**Example:**
```typescript
const deps = await mcp__meridian__code_get_dependencies({
  entry_point: "src/api/mod.rs",
  depth: 3,
  direction: "both"
});
```

---

## Task & Progress Tracking

### task.create_task

Create new trackable task.

**Parameters:**
```typescript
{
  title: string;                   // Required
  description?: string;            // Optional
  priority?: "low" | "medium" | "high" | "critical";
  spec_ref?: {                     // Optional: Link to spec
    spec_name: string;
    section: string;
  };
  tags?: string[];                 // Optional
  estimated_hours?: number;        // Optional
}
```

**Returns:**
```typescript
{
  task_id: string;
  created_at: string;
  status: "pending";
}
```

**Example:**
```typescript
const task = await mcp__meridian__task_create_task({
  title: "Implement user authentication",
  description: "Add JWT-based auth with refresh tokens",
  priority: "high",
  spec_ref: { spec_name: "auth-spec", section: "Section 3.1" },
  tags: ["backend", "security", "auth"],
  estimated_hours: 8
});
```

### task.update_task

Update task status, priority, or other fields.

**Parameters:**
```typescript
{
  task_id: string;                 // Required
  status?: "pending" | "in_progress" | "blocked" | "done" | "cancelled";
  status_note?: string;            // Optional: Explain status change
  priority?: "low" | "medium" | "high" | "critical";
  estimated_hours?: number;
  actual_hours?: number;
  commit_hash?: string;
}
```

**Example:**
```typescript
await mcp__meridian__task_update_task({
  task_id: "task_abc123",
  status: "in_progress",
  status_note: "Completed JWT impl, working on refresh tokens"
});
```

### task.mark_complete

Mark task complete with auto-episode creation (⭐ RECOMMENDED).

**Parameters:**
```typescript
{
  task_id: string;                 // Required
  actual_hours?: number;           // Optional
  commit_hash?: string;            // Optional
  note?: string;                   // Optional
  solution_summary?: string;       // Recommended: How you solved it
  files_touched?: string[];        // Recommended: Files modified
  queries_made?: string[];         // Recommended: Queries used
}
```

**Side Effect:** Automatically calls `memory.record_episode` with full context.

**Example:**
```typescript
await mcp__meridian__task_mark_complete({
  task_id: task.task_id,
  actual_hours: 7.5,
  commit_hash: "a1b2c3d4...",
  note: "Completed with full test coverage",
  solution_summary: "Used JWT with RS256, refresh tokens in Redis",
  files_touched: ["src/auth/*.rs", "tests/auth_test.rs"],
  queries_made: ["code.search_symbols jwt", "specs.get_section Auth"]
});
```

### task.list_tasks

List tasks with filters.

**Parameters:**
```typescript
{
  status?: "pending" | "in_progress" | "blocked" | "done" | "cancelled";
  spec_name?: string;              // Optional: Filter by spec
  limit?: number;                  // Optional
}
```

**Example:**
```typescript
const tasks = await mcp__meridian__task_list_tasks({
  status: "in_progress",
  spec_name: "auth-spec",
  limit: 20
});
```

### task.add_dependency

Add dependency between tasks (prevents circular dependencies).

**Parameters:**
```typescript
{
  task_id: string;                 // Required: Task that depends
  depends_on: string;              // Required: Task that must complete first
}
```

**Error:** Returns error if circular dependency detected.

**Example:**
```typescript
await mcp__meridian__task_add_dependency({
  task_id: "task_frontend",
  depends_on: "task_backend_api"
});
```

### task.can_start_task

Check if task can start based on dependencies.

**Parameters:**
```typescript
{
  task_id: string;                 // Required
}
```

**Returns:**
```typescript
{
  can_start: boolean;
  blockers: string[];              // Task IDs blocking this task
  unmet_dependencies: Array<{
    task_id: string;
    title: string;
    status: string;
  }>;
}
```

**Example:**
```typescript
const canStart = await mcp__meridian__task_can_start_task({
  task_id: "task_abc123"
});

if (!canStart.can_start) {
  console.log("Blocked by:", canStart.blockers);
}
```

### Additional Task Tools

- **task.get_task** - Get detailed task information
- **task.delete_task** - Delete a task
- **task.search_tasks** - Search tasks by title/content
- **task.link_to_spec** - Link task to spec section
- **task.get_history** - Get complete status change history
- **task.get_progress** - Get statistics and progress metrics
- **task.remove_dependency** - Remove dependency relationship
- **task.get_dependencies** - Get all tasks this task depends on
- **task.get_dependents** - Get all tasks that depend on this task

---

## Graph Analysis Tools

### graph.semantic_search

Natural language code search using embeddings.

**Parameters:**
```typescript
{
  query: string;                   // Required: Natural language query
  limit?: number;                  // Optional (default: 10, max: 100)
}
```

**Returns:**
```typescript
Array<{
  symbol_id: string;
  name: string;
  similarity_score: number;        // 0.0-1.0
  location: { file: string; line: number; };
}>
```

**Example:**
```typescript
const similar = await mcp__meridian__graph_semantic_search({
  query: "functions that handle user login",
  limit: 10
});
```

### graph.find_dependencies

Find all dependencies (transitive, up to specified depth).

**Parameters:**
```typescript
{
  symbol_id: string;               // Required
  depth?: number;                  // Optional (default: 3, range: 1-10)
}
```

**Returns:**
```typescript
{
  symbol_id: string;
  dependencies: Array<{
    symbol: string;
    depth: number;
    path: string[];                // Dependency chain
  }>;
}
```

**Example:**
```typescript
const deps = await mcp__meridian__graph_find_dependencies({
  symbol_id: "UserService::login",
  depth: 5
});
```

### graph.impact_analysis

Find all code affected by changes to specified symbols.

**Parameters:**
```typescript
{
  changed_symbols: string[];       // Required: Array of symbol IDs
}
```

**Returns:**
```typescript
{
  directly_affected: string[];
  transitively_affected: string[];
  risk_level: "low" | "medium" | "high" | "critical";
  affected_files: string[];
}
```

**Example:**
```typescript
const impact = await mcp__meridian__graph_impact_analysis({
  changed_symbols: [
    "AuthService::verify",
    "TokenManager::refresh"
  ]
});

console.log(`Risk Level: ${impact.risk_level}`);
console.log(`Affected Files: ${impact.affected_files.length}`);
```

### graph.find_circular_dependencies

Detect circular dependencies in codebase.

**Parameters:** None

**Returns:**
```typescript
{
  circular_chains: Array<{
    symbols: string[];
    severity: "low" | "medium" | "high";
  }>;
}
```

**Example:**
```typescript
const circular = await mcp__meridian__graph_find_circular_dependencies({});

if (circular.circular_chains.length > 0) {
  console.log("Found circular dependencies:");
  circular.circular_chains.forEach(chain => {
    console.log(`- ${chain.symbols.join(" → ")} → ${chain.symbols[0]}`);
  });
}
```

### graph.find_hubs

Find most connected symbols (architectural hubs).

**Parameters:**
```typescript
{
  limit?: number;                  // Optional (default: 20, max: 100)
}
```

**Returns:**
```typescript
Array<{
  symbol_id: string;
  name: string;
  in_degree: number;               // How many depend on this
  out_degree: number;              // How many this depends on
  total_degree: number;
  location: { file: string; line: number; };
}>
```

**Example:**
```typescript
const hubs = await mcp__meridian__graph_find_hubs({ limit: 20 });

// High-degree nodes may need decomposition
hubs.forEach(hub => {
  if (hub.total_degree > 50) {
    console.log(`${hub.name} has ${hub.total_degree} connections - refactor candidate`);
  }
});
```

### graph.get_symbol_full

Get complete symbol info with all relationships.

**Parameters:**
```typescript
{
  symbol_id: string;               // Required
}
```

**Returns:**
```typescript
{
  symbol_id: string;
  name: string;
  type: string;
  definition: string;
  documentation: string;
  dependencies: string[];
  dependents: string[];
  callers: string[];
  calls: string[];
  location: { file: string; line: number; };
}
```

**Example:**
```typescript
const fullInfo = await mcp__meridian__graph_get_symbol_full({
  symbol_id: "UserService"
});
```

### Additional Graph Tools

- **graph.find_dependents** - Find reverse dependencies
- **graph.find_similar_patterns** - Find symbols with similar structure
- **graph.code_lineage** - Trace evolution through historical episodes
- **graph.get_call_graph** - Get what a symbol calls
- **graph.get_callers** - Get what calls a symbol
- **graph.get_stats** - Overall graph statistics

---

## Specifications Tools

### specs.list

List all available specifications.

**Parameters:** None

**Returns:**
```typescript
Array<{
  name: string;
  path: string;
  version: string;
  status: string;
  sections: Array<{ title: string; line: number; }>;
}>
```

**Example:**
```typescript
const specs = await mcp__meridian__specs_list({});
```

### specs.get_section

Get content of specific spec section.

**Parameters:**
```typescript
{
  spec_name: string;               // Required (without .md extension)
  section_name: string;            // Required (or partial name)
}
```

**Returns:**
```typescript
{
  spec_name: string;
  section_title: string;
  content: string;
  line_start: number;
  line_end: number;
}
```

**Example:**
```typescript
const section = await mcp__meridian__specs_get_section({
  spec_name: "auth-spec",
  section_name: "JWT Implementation"
});

console.log(section.content);
```

### specs.search

Search across all specifications.

**Parameters:**
```typescript
{
  query: string;                   // Required
  max_results?: number;            // Optional (default: 20)
}
```

**Returns:**
```typescript
Array<{
  spec_name: string;
  section_title: string;
  snippet: string;
  line_start: number;
  line_end: number;
  relevance_score: number;         // 0.0-1.0
}>
```

**Example:**
```typescript
const results = await mcp__meridian__specs_search({
  query: "authentication flow",
  max_results: 20
});
```

### Additional Spec Tools

- **specs.get_structure** - Get TOC and metadata for a spec
- **specs.validate** - Validate spec completeness and quality

---

## Session Management

### session.begin

Start isolated work session with copy-on-write semantics.

**Parameters:**
```typescript
{
  task_description: string;        // Required
  scope?: string[];                // Optional: Files/dirs in scope
  base_commit?: string;            // Optional: Git commit base
}
```

**Returns:**
```typescript
{
  session_id: string;
  created_at: string;
  base_commit: string;
}
```

**Example:**
```typescript
const session = await mcp__meridian__session_begin({
  task_description: "Refactor auth module",
  scope: ["src/auth/", "tests/auth/"],
  base_commit: "main"
});
```

### session.update

Update file in session (with automatic reindexing).

**Parameters:**
```typescript
{
  session_id: string;              // Required
  path: string;                    // Required: File path
  content: string;                 // Required: New content
  reindex?: boolean;               // Optional (default: true)
}
```

**Example:**
```typescript
await mcp__meridian__session_update({
  session_id: session.session_id,
  path: "src/auth/handler.rs",
  content: "new content...",
  reindex: true
});
```

### session.complete

Finish session (commit, discard, or stash changes).

**Parameters:**
```typescript
{
  session_id: string;              // Required
  action: "commit" | "discard" | "stash";  // Required
  commit_message?: string;         // Required if action=commit
}
```

**Example:**
```typescript
await mcp__meridian__session_complete({
  session_id: session.session_id,
  action: "commit",
  commit_message: "refactor: split AuthHandler into validator and processor"
});
```

### Additional Session Tools

- **session.query** - Query within session context

---

## Backup & Recovery

### backup.create

Create manual backup with description and tags.

**Parameters:**
```typescript
{
  description?: string;            // Optional
  tags?: string[];                 // Optional
}
```

**Returns:**
```typescript
{
  backup_id: string;
  created_at: string;
  size_bytes: number;
  verified: boolean;
}
```

**Example:**
```typescript
await mcp__meridian__backup_create({
  description: "Before auth refactor",
  tags: ["pre-refactor", "auth"]
});
```

### backup.restore

Restore from backup (creates safety backup first).

**Parameters:**
```typescript
{
  backup_id: string;               // Required
  target_path?: string;            // Optional
}
```

**Example:**
```typescript
await mcp__meridian__backup_restore({
  backup_id: "backup_abc123"
});
```

### Additional Backup Tools

- **backup.list** - List all backups with filters
- **backup.verify** - Verify backup integrity
- **backup.delete** - Delete a backup
- **backup.get_stats** - Get backup system statistics
- **backup.create_scheduled** - Create scheduled backup (internal)
- **backup.create_pre_migration** - Pre-migration backup (internal)

---

## System Tools

### indexer.index_project

Index project directory (ALWAYS DO FIRST!).

**Parameters:**
```typescript
{
  path: string;                    // Required: Absolute path
  force?: boolean;                 // Optional: Re-index even if unchanged
}
```

**Returns:**
```typescript
{
  indexed_files: number;
  symbols_extracted: number;
  time_taken_ms: number;
}
```

**Example:**
```typescript
const result = await mcp__meridian__indexer_index_project({
  path: "/Users/taaliman/projects/omnitron-dev/omni",
  force: false
});

console.log(`Indexed ${result.indexed_files} files with ${result.symbols_extracted} symbols`);
```

### system.health

Get system health status.

**Parameters:** None

**Returns:**
```typescript
{
  status: "healthy" | "degraded" | "unhealthy";
  uptime_seconds: number;
  memory_usage_mb: number;
  component_stats: Record<string, {
    status: string;
    metrics: Record<string, number>;
  }>;
}
```

**Example:**
```typescript
const health = await mcp__meridian__system_health({});
console.log(`Status: ${health.status}`);
```

### Additional System Tools

- **indexer.enable_watching** - Enable real-time file watching
- **indexer.disable_watching** - Disable file watching
- **indexer.get_watch_status** - Get watch status
- **indexer.poll_changes** - Poll for file changes

---

## Common Error Handling

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

---

## Performance & Token Efficiency

**Code Tools vs Read/Grep:**
- **90% reduction** - Get single symbol vs entire file
- **Semantic awareness** - Type-aware searches
- **Relationship mapping** - See dependencies without reading files
- **Context-aware** - Prioritized results based on usage

**Progress System vs TodoWrite:**
- **70% fewer tokens** - Structured data vs markdown parsing
- **Progressive loading** - Fetch summaries first, details on demand
- **Server-side filtering** - Only relevant data returned
- **Detail level control** - skeleton|interface|implementation|full

---

**Note:** This is a comprehensive reference. For workflow patterns and best practices, see `workflows-and-patterns.md`.
