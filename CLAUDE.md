# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**Omnitron** - TypeScript monorepo for minimalist, high-performance distributed systems.
**Titan** - Core backend framework with Nexus DI, Netron RPC, Rotif messaging.
**Runtime Support**: Node.js >=22.0.0 (primary), Bun >=1.2.0 (fully supported), Deno (experimental)

## ⚡ Core Philosophy: Memory-First Development

**The `/meridian` subdirectory contains a production-ready Rust MCP server with 103 tools.**
**This is the PRIMARY and ONLY workflow for all development tasks.**

### 🚫 ABSOLUTE RULES

1. **NEVER USE TodoWrite** - Use `task.*` MCP tools instead
2. **NEVER CREATE .md REPORTS** - All data goes into Progress System (SQLite DB)
3. **NEVER USE grep/Read FOR CODE SEARCH** - Use `code.search_symbols`, `code.get_definition`
4. **ALWAYS START WITH**: `memory.find_similar_episodes` for past solutions
5. **QUERY SPECS FOR DETAILS** - Don't memorize, query on-demand

### 📚 Documentation Architecture

**This file is intentionally minimal.** All detailed documentation lives in queryable specs:

```typescript
// Instead of reading 500+ lines of tool docs here:
const toolDocs = await mcp__meridian__specs_get_section({
  spec_name: "mcp-tools-reference",
  section_name: "Code Analysis Tools"  // or any category
});

// Instead of memorizing workflows:
const workflow = await mcp__meridian__specs_get_section({
  spec_name: "workflows-and-patterns",
  section_name: "Complete Task Workflow"
});

// For Omnitron-specific guidelines:
const guidelines = await mcp__meridian__specs_get_section({
  spec_name: "omnitron-development-guide",
  section_name: "Titan Development Patterns"
});
```

**Available Specs:**
- `mcp-tools-reference.md` - Complete tool documentation (103 tools)
- `workflows-and-patterns.md` - Detailed workflows and best practices
- `omnitron-development-guide.md` - Omnitron/Titan-specific guidelines
- `agent-coordination.md` - Multi-agent collaboration patterns

## 🔄 Critical 4-Step Workflow

Every development task follows this cycle:

### Step 1: Query Memory (ALWAYS START HERE)

```typescript
// Find similar past work to learn from
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "Implement authentication endpoints",
  limit: 5
});
// Review: What worked? What failed? What patterns emerged?
```

### Step 2: Extract Knowledge from Specs

```typescript
// Get requirements from specifications
const requirements = await mcp__meridian__specs_get_section({
  spec_name: "auth-spec",
  section_name: "API Endpoints"
});

// Search for related patterns
const patterns = await mcp__meridian__specs_search({
  query: "authentication best practices",
  max_results: 10
});
```

### Step 3: Create Task & Track Progress

```typescript
// Create trackable task
const task = await mcp__meridian__task_create_task({
  title: "Implement JWT authentication endpoints",
  description: "GET/POST endpoints with refresh token support",
  spec_ref: { spec_name: "auth-spec", section: "API Endpoints" },
  priority: "high",
  estimated_hours: 6,
  tags: ["auth", "api", "backend"]
});

// Start work
await mcp__meridian__task_update_task({
  task_id: task.task_id,
  status: "in_progress"
});

// Use code analysis tools (NOT grep/Read!)
const symbols = await mcp__meridian__code_search_symbols({
  query: "authentication handler",
  type: ["function", "class"],
  detail_level: "interface"
});
```

### Step 4: Complete & Record Episode

```typescript
// Mark complete with rich context
await mcp__meridian__task_mark_complete({
  task_id: task.task_id,
  actual_hours: 5.5,
  commit_hash: "abc123...",
  solution_summary: "Used JWT with RS256, refresh tokens in Redis, middleware for auth",
  files_touched: ["src/auth/jwt.rs", "src/auth/middleware.rs", "tests/auth_test.rs"],
  queries_made: [
    "memory.find_similar_episodes authentication",
    "code.search_symbols jwt handler",
    "graph.impact_analysis TokenManager",
    "specs.get_section API Endpoints"
  ]
});
// Episode automatically recorded for future agents!
```

## 🔧 MCP Tools Overview (103 Tools)

**Query `mcp-tools-reference` spec for complete documentation.**

**Categories:**
- **Memory** (4 tools): find_similar_episodes, record_episode, update_working_set, get_statistics
- **Code Analysis** (5 tools): search_symbols, search_patterns, get_definition, find_references, get_dependencies
- **Tasks** (15 tools): create, update, list, get, delete, search, link_to_spec, get_history, mark_complete, etc.
- **Specs** (5 tools): list, get_structure, get_section, search, validate
- **Graph** (12 tools): semantic_search, find_dependencies, impact_analysis, find_hubs, find_circular_dependencies, etc.
- **Session** (4 tools): begin, update, query, complete
- **Context** (3 tools): prepare_adaptive, defragment, compress
- **Documentation** (6 tools): search, get_for_symbol, generate, validate, transform, catalog.*
- **Examples & Tests** (4 tools): examples.*, tests.*
- **Links** (16 tools): find_implementation, find_documentation, add_link, trace_path, extract_from_file, etc.
- **Monorepo** (8 tools): list_projects, set_context, global.*, external.*
- **Analysis** (6 tools): complexity, token_cost, attention.*, learning.*, predict_next_action
- **History** (2 tools): get_evolution, blame
- **Backup** (8 tools): create, list, restore, verify, delete, get_stats, etc.
- **System** (2 tools): health, indexer.index_project

**Tool Naming**: All use dot notation (e.g., `memory.find_similar_episodes`, `code.search_symbols`)

## 🤝 Multi-Agent System

**Specialized agents live in `.claude/agents/`** (query `agent-coordination` spec for details)

```typescript
// Example: Invoke specialized agent for complex refactoring
// Agent coordination patterns documented in specs
```

## 📈 Self-Improvement Cycle

**Query `workflows-and-patterns` spec for detailed workflows.**

**Quick Reference:**
1. **Analyze**: Use `graph.find_hubs`, `analyze.complexity`, `graph.find_circular_dependencies`
2. **Plan**: Create tasks with dependencies via `task.add_dependency`
3. **Execute**: Use `session.*` tools for isolated work
4. **Validate**: Re-analyze complexity, generate tests, create semantic links
5. **Learn**: Mark complete with rich context, episode auto-recorded

## 🎯 Memory Query Patterns

**Core Pattern**: Don't memorize details, query on-demand.

### Finding Past Solutions

```typescript
// Similar tasks
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "refactor high-complexity module",
  limit: 5
});

// Extract patterns from episodes
episodes.forEach(ep => {
  console.log(`Task: ${ep.task}`);
  console.log(`Solution: ${ep.solution}`);
  console.log(`Outcome: ${ep.outcome}`);
});
```

### Querying for Workflows

```typescript
// Get specific workflow details
const workflow = await mcp__meridian__specs_get_section({
  spec_name: "workflows-and-patterns",
  section_name: "Code Quality Improvement"  // or "Starting New Task", etc.
});
```

### Querying for Tool Details

```typescript
// Get detailed tool parameters and examples
const toolDoc = await mcp__meridian__specs_get_section({
  spec_name: "mcp-tools-reference",
  section_name: "Graph Analysis Tools"  // Returns all 12 graph tools with examples
});
```

### Searching Across All Knowledge

```typescript
// Find all references to a concept
const results = await mcp__meridian__specs_search({
  query: "dependency injection patterns",
  max_results: 20
});
```

## 🏗️ Omnitron Project Structure

**Query `omnitron-development-guide` spec for complete details.**

### Core Packages (Quick Reference)

- **@omnitron-dev/titan** - Backend framework (Nexus DI, Netron RPC, Rotif messaging)
- **@omnitron-dev/rotif** - Redis-based reliable messaging
- **@omnitron-dev/common** - Essential utilities
- **@omnitron-dev/eventemitter** - Universal event emitter
- **@omnitron-dev/messagepack** - MessagePack serialization
- **Aether** - Frontend framework (in development, see `specs/frontend/`)

### Key Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm dev              # Development mode
pnpm test             # Run all tests
pnpm fix:all          # Fix linting and formatting
pnpm changeset        # Version management
```

### Critical Import Rules

```typescript
// ✅ CORRECT - Use package.json exports
import { ConfigModule } from '@omnitron-dev/titan/module/config';

// ❌ WRONG - Don't import modules from root (breaks tree-shaking)
import { ConfigModule } from '@omnitron-dev/titan';
```

## 🚀 Quick Start Checklist

**Every Session:**
```bash
# 1. Set PATH
export PATH="/Users/taaliman/.cargo/bin:/Users/taaliman/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/bin:$PATH"

# 2. Index project (first time or after major changes)
# Use: mcp__meridian__indexer_index_project({ path: "/absolute/path" })
```

**Every Task:**
- [ ] Query memory for similar episodes
- [ ] Search specs for requirements and patterns
- [ ] Create task with spec reference
- [ ] Use code analysis tools (NOT grep/Read)
- [ ] Mark complete with rich context (auto-records episode)

**Before Commits:**
```bash
pnpm fix:all  # Linting and formatting
```

## 💾 Token Efficiency

**This optimized CLAUDE.md saves ~75% tokens (4,152 tokens) per session.**

**How?**
- Minimal core principles (350 lines vs 1388)
- On-demand spec queries for details
- Progressive loading (fetch only what's needed)
- Server-side filtering and compression

**Example Savings:**
```typescript
// Old: Load entire CLAUDE.md (5,552 tokens)
// New: Load minimal CLAUDE.md (1,400 tokens) + query specific section (200 tokens)
// Savings: 3,952 tokens (71%)
```

## 📖 Spec Reference

**Query these specs for detailed documentation:**

1. **mcp-tools-reference.md** - All 103 tools with parameters, examples, return values
2. **workflows-and-patterns.md** - Complete workflows, best practices, common patterns
3. **omnitron-development-guide.md** - Titan patterns, testing, package structure, breaking changes
4. **agent-coordination.md** - Multi-agent collaboration, delegation patterns

**Query Pattern:**
```typescript
// List all specs
const specs = await mcp__meridian__specs_list({});

// Get spec structure
const structure = await mcp__meridian__specs_get_structure({
  spec_name: "mcp-tools-reference"
});

// Get specific section
const section = await mcp__meridian__specs_get_section({
  spec_name: "workflows-and-patterns",
  section_name: "Self-Improvement Cycle"
});

// Search across all specs
const results = await mcp__meridian__specs_search({
  query: "session management",
  max_results: 10
});
```

## 🎓 Learning from Memory

**The memory system learns from every completed task.**

**Pattern Recognition:**
- Similar tasks → Similar solutions
- Failed approaches → Avoid patterns
- Successful patterns → Recommend patterns

**Query for Guidance:**
```typescript
// Before starting any task
const guidance = await mcp__meridian__memory_find_similar_episodes({
  task_description: "your task here",
  limit: 5
});
// Review outcomes, solutions, and queries used
```

**Contribute to Knowledge:**
```typescript
// After completing task
await mcp__meridian__task_mark_complete({
  task_id: "...",
  solution_summary: "DETAILED explanation of approach and why it worked",
  queries_made: ["all", "queries", "you", "used"],
  files_touched: ["all", "files", "modified"]
});
// Future agents learn from your success!
```

---

**Remember:** This file is a roadmap, not a manual. Query specs for details. Use memory for guidance. Record episodes for learning.

**Token Budget:** ~1,400 tokens (vs 5,552 in old version) = **75% savings**
