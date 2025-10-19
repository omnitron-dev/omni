# Meridian Workflows & Patterns

**Version**: 1.0.0
**Status**: Active
**Last Updated**: 2025-10-19

This specification documents detailed workflows, best practices, and common patterns for working with Meridian MCP tools.

---

## Table of Contents

1. [Complete Task Workflow](#complete-task-workflow)
2. [Self-Improvement & Code Quality Workflow](#self-improvement-code-quality-workflow)
3. [Common Patterns & Best Practices](#common-patterns-best-practices)
4. [Git Commit Message Format](#git-commit-message-format)
5. [Environment Setup](#environment-setup)
6. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

---

## Complete Task Workflow

This is the recommended end-to-end workflow for any development task.

### Step 1: Search for Similar Past Work

**Always start by querying memory for similar episodes.**

```typescript
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "Implement REST API endpoints",
  limit: 5
});

// Review episodes to see what approaches worked before
episodes.forEach(ep => {
  console.log(`Task: ${ep.task}`);
  console.log(`Solution: ${ep.solution}`);
  console.log(`Outcome: ${ep.outcome}`);
  console.log(`Queries: ${ep.queries_made.join(", ")}`);
  console.log("---");
});
```

### Step 2: Check Spec for Requirements

```typescript
// Get requirements from specification
const specSection = await mcp__meridian__specs_get_section({
  spec_name: "api-spec",
  section_name: "REST Endpoints"
});

console.log("Requirements:", specSection.content);
```

### Step 3: Index Project (if not already done)

```typescript
await mcp__meridian__indexer_index_project({
  path: "/absolute/path/to/project"
});
```

### Step 4: Create Trackable Task

```typescript
const task = await mcp__meridian__task_create_task({
  title: "Implement REST API endpoints",
  description: "Create GET/POST/PUT/DELETE endpoints for user resource",
  spec_ref: { spec_name: "api-spec", section: "REST Endpoints" },
  priority: "high",
  estimated_hours: 6,
  tags: ["api", "backend", "rest"]
});

console.log(`Created task: ${task.task_id}`);
```

### Step 5: Start Work

```typescript
await mcp__meridian__task_update_task({
  task_id: task.task_id,
  status: "in_progress"
});
```

### Step 6: Search for Existing Patterns

**Use code analysis tools (NOT grep/Read!)**

```typescript
// Semantic search for similar code
const symbols = await mcp__meridian__code_search_symbols({
  query: "api handler",
  type: ["function", "class"],
  detail_level: "interface"
});

// Get full definition of relevant symbol
const def = await mcp__meridian__code_get_definition({
  symbol_id: symbols[0].id,
  include_body: true,
  include_dependencies: true
});

console.log("Found pattern:", def.name);
```

### Step 7: Understand Dependencies and Integration Points

```typescript
// Get dependency graph
const deps = await mcp__meridian__code_get_dependencies({
  entry_point: "src/api/mod.rs",
  depth: 2,
  direction: "both"
});

console.log("Dependencies:", deps.dependencies.length);
```

### Step 8: During Implementation - Update Status

```typescript
await mcp__meridian__task_update_task({
  task_id: task.task_id,
  status_note: "Completed GET/POST endpoints, working on PUT/DELETE"
});
```

### Step 9: Generate Tests

```typescript
const tests = await mcp__meridian__tests_generate({
  symbol_id: "api::UserHandler::get",
  test_type: "integration",
  framework: "jest"
});

console.log("Generated tests:", tests.tests.length);
```

### Step 10: Complete Task (Auto-Creates Episode)

```typescript
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

---

## Self-Improvement & Code Quality Workflow

Use Meridian's graph and analysis tools to continuously improve codebase quality.

### Phase 1: Analysis - Identify Issues

#### Find Complexity Hotspots

```typescript
// Analyze specific files or symbols
const complexity = await mcp__meridian__analyze_complexity({
  target: "src/auth/handler.rs",
  include_metrics: ["cyclomatic", "cognitive", "lines", "dependencies"]
});

// High cyclomatic/cognitive complexity = refactoring candidates
if (complexity.cyclomatic > 15 || complexity.cognitive > 20) {
  console.log(`⚠️ ${complexity.target} needs refactoring`);
  console.log(`Cyclomatic: ${complexity.cyclomatic}`);
  console.log(`Cognitive: ${complexity.cognitive}`);
}
```

#### Find Circular Dependencies

```typescript
const circular = await mcp__meridian__graph_find_circular_dependencies({});

if (circular.circular_chains.length > 0) {
  console.log("Found circular dependencies to break:");
  circular.circular_chains.forEach(chain => {
    console.log(`- ${chain.symbols.join(" → ")} (severity: ${chain.severity})`);
  });
}
```

#### Find Architectural Hubs (Over-Connected Code)

```typescript
const hubs = await mcp__meridian__graph_find_hubs({ limit: 20 });

// High-degree nodes may need decomposition
hubs.forEach(hub => {
  if (hub.total_degree > 50) {
    console.log(`${hub.name} has ${hub.total_degree} connections - refactor candidate`);
  }
});
```

#### Find Orphaned Code

```typescript
const orphans = await mcp__meridian__links_find_orphans({
  level: "code"  // code|docs|tests|examples
});

console.log(`Found ${orphans.length} orphaned code elements (no tests/docs/specs)`);
```

### Phase 2: Planning - Create Improvement Tasks

#### Create Dependency-Linked Tasks

```typescript
// Create main refactoring task
const refactorTask = await mcp__meridian__task_create_task({
  title: "Refactor AuthHandler to reduce complexity",
  description: "Split into AuthValidator and AuthProcessor",
  priority: "medium",
  tags: ["refactor", "code-quality", "auth"]
});

// Create follow-up test task
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

#### Check if Ready to Start

```typescript
const canStart = await mcp__meridian__task_can_start_task({
  task_id: testTask.task_id
});

if (!canStart.can_start) {
  console.log("Task blocked by:", canStart.blockers);
  console.log("Unmet dependencies:");
  canStart.unmet_dependencies.forEach(dep => {
    console.log(`- ${dep.title} (${dep.status})`);
  });
}
```

### Phase 3: Implementation - Use Sessions

#### Isolated Refactoring with Sessions

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

console.log(`Impact analysis: ${impact.directly_affected.length} directly affected`);
console.log(`Risk level: ${impact.risk_level}`);

// Commit or discard based on impact
if (impact.risk_level === "low" || impact.risk_level === "medium") {
  await mcp__meridian__session_complete({
    session_id: session.session_id,
    action: "commit",
    commit_message: "refactor: split AuthHandler into validator and processor"
  });
} else {
  console.log("High risk - review changes before committing");
}
```

### Phase 4: Validation - Verify Improvements

#### Re-analyze Complexity

```typescript
const newComplexity = await mcp__meridian__analyze_complexity({
  target: "src/auth/validator.rs",
  include_metrics: ["cyclomatic", "cognitive"]
});

// Compare with baseline
console.log(`Old cyclomatic: 18 → New: ${newComplexity.cyclomatic}`);
console.log(`Old cognitive: 24 → New: ${newComplexity.cognitive}`);
```

#### Generate and Validate Tests

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

console.log(`Valid: ${validation.valid}`);
console.log(`Coverage estimate: ${validation.coverage_estimate * 100}%`);
```

#### Create Semantic Links

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

### Phase 5: Reflection - Learn and Document

#### Complete with Rich Context

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

#### Extract Patterns for Future Use

```typescript
// Find similar patterns in codebase for future refactoring
const similar = await mcp__meridian__graph_find_similar_patterns({
  symbol_id: "AuthValidator",
  limit: 10
});

console.log(`Found ${similar.length} similar patterns for future refactoring`);
```

### Phase 6: Continuous Monitoring

#### Regular Health Checks

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

#### Create Regular Backups

```typescript
// Before major refactoring
await mcp__meridian__backup_create({
  description: "Before auth module refactor",
  tags: ["pre-refactor", "auth", "milestone"]
});
```

---

## Common Patterns & Best Practices

### Pattern 1: Starting a New Task

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

### Pattern 2: Code Search & Analysis

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

### Pattern 3: Completing Work

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

### Pattern 4: Progressive Task Breakdown

```typescript
// Large task → Create subtasks with dependencies

const mainTask = await mcp__meridian__task_create_task({
  title: "Implement complete authentication system",
  priority: "high",
  estimated_hours: 20
});

const subtask1 = await mcp__meridian__task_create_task({
  title: "Implement JWT generation and validation",
  priority: "high",
  estimated_hours: 6
});

const subtask2 = await mcp__meridian__task_create_task({
  title: "Implement refresh token mechanism",
  priority: "high",
  estimated_hours: 6
});

const subtask3 = await mcp__meridian__task_create_task({
  title: "Add authentication middleware",
  priority: "medium",
  estimated_hours: 4
});

// Set dependencies
await mcp__meridian__task_add_dependency({
  task_id: subtask2.task_id,
  depends_on: subtask1.task_id
});

await mcp__meridian__task_add_dependency({
  task_id: subtask3.task_id,
  depends_on: subtask1.task_id
});
```

---

## Self-Improvement Checklist

### Before Each Session

- [ ] `indexer.index_project` - Ensure index is current
- [ ] `memory.find_similar_episodes` - Learn from past work
- [ ] `task.create_task` - Create trackable task
- [ ] `backup.create` - Safety backup before major changes

### During Development

- [ ] `code.search_symbols` - Find existing patterns (NOT grep/Read)
- [ ] `graph.impact_analysis` - Understand change impact
- [ ] `analyze.complexity` - Monitor complexity metrics
- [ ] `session.begin` - Use sessions for risky changes

### After Completion

- [ ] `task.mark_complete` - Record episode with full context
- [ ] `links.add_link` - Create semantic links to specs/tests/docs
- [ ] `graph.find_circular_dependencies` - Verify no new circular deps
- [ ] `backup.create` - Milestone backup

### Weekly Maintenance

- [ ] `graph.find_hubs` - Identify over-connected code
- [ ] `links.find_orphans` - Find untested/undocumented code
- [ ] `analyze.complexity` - Find refactoring targets
- [ ] `task.get_progress` - Review completed vs pending tasks

---

## Git Commit Message Format

When committing, reference tasks and specs for full traceability.

### Format

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

### Commit Types

- **feat** - New feature
- **fix** - Bug fix
- **refactor** - Code refactoring
- **docs** - Documentation changes
- **test** - Adding/updating tests
- **chore** - Maintenance tasks
- **perf** - Performance improvements
- **style** - Code style changes
- **ci** - CI/CD changes

---

## Environment Setup

**CRITICAL**: Run this at the start of EVERY session to ensure all tools are available.

### Setting PATH

```bash
# Set complete PATH with all required binaries
export PATH="/Users/taaliman/.cargo/bin:/Users/taaliman/.bun/bin:/Users/taaliman/.deno/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/bin:$PATH"

# Verify tools are available
which cargo  # Should output: /Users/taaliman/.cargo/bin/cargo
which bun    # Should output: /Users/taaliman/.bun/bin/bun
which deno   # Should output: /Users/taaliman/.deno/bin/deno
```

### Building Meridian MCP Server

```bash
# Build Meridian MCP server (if not already built)
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian
cargo build --release

# MCP server auto-starts via Claude Code configuration
# Server location: meridian/target/release/meridian-mcp
# Config location: ~/.config/claude-code/mcp.json
```

---

## Anti-Patterns to Avoid

### ❌ NEVER DO

**1. Use TodoWrite**
```typescript
// ❌ WRONG
await TodoWrite({ todos: [...] });

// ✅ CORRECT
await mcp__meridian__task_create_task({
  title: "...",
  ...
});
```

**2. Create .md Report Files**
```typescript
// ❌ WRONG
await Write({
  file_path: "IMPLEMENTATION_REPORT.md",
  content: "..."
});

// ✅ CORRECT
await mcp__meridian__task_mark_complete({
  task_id: "...",
  solution_summary: "...",
  ...
});
```

**3. Use grep/Read for Code Search**
```typescript
// ❌ WRONG
await Grep({ pattern: "function authenticate" });
await Read({ file_path: "src/auth.ts" });

// ✅ CORRECT
await mcp__meridian__code_search_symbols({
  query: "authenticate",
  type: ["function"]
});
```

**4. Manual Tracking**
```bash
# ❌ WRONG - Creating manual TODO.md
echo "- [ ] Implement auth" >> TODO.md

# ✅ CORRECT - Use task system
# Use mcp__meridian__task_create_task
```

**5. Skip Memory Query**
```typescript
// ❌ WRONG - Start coding immediately

// ✅ CORRECT - Always query memory first
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "...",
  limit: 5
});
```

---

**Note:** For complete tool documentation, see `mcp-tools-reference.md`. For Omnitron-specific patterns, see `omnitron-development-guide.md`.
