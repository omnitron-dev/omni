# Specification and Documentation Separation: A Unified System

**Version**: 1.0.0
**Created**: October 18, 2025
**Status**: Design Specification
**Target**: Meridian v2.1.0

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Fundamental Concepts](#fundamental-concepts)
4. [Directory Structure and Organization](#directory-structure-and-organization)
5. [Specification Management Tools](#specification-management-tools)
6. [Semantic Linking System](#semantic-linking-system)
7. [Integration: How All Pieces Work Together](#integration-how-all-pieces-work-together)
8. [Self-Improvement Process](#self-improvement-process)
9. [Implementation Roadmap](#implementation-roadmap)
10. [Success Metrics](#success-metrics)
11. [Appendix: System Architecture](#appendix-system-architecture)

---

## Executive Summary

### The Problem

Software projects suffer from **documentation drift**: specifications become outdated, code diverges from design, examples break, tests lose coverage, and documentation becomes stale. This creates a cognitive burden that slows development and confuses both humans and LLM agents.

For LLM agents working with codebases, this problem is compounded by **token inefficiency**: loading entire files to find relevant code, reading duplicated documentation, and manually tracing relationships between specs, code, docs, examples, and tests wastes 90%+ of context window capacity.

### The Solution

A **three-part unified system** that:

1. **Separates specs from docs** with clear semantic roles
2. **Provides 20+ MCP tools** for specification management
3. **Creates semantic links** between all knowledge levels

This enables LLM agents to:
- Navigate from specification → code → docs → examples → tests in milliseconds
- Track implementation progress at granular task levels
- Maintain specifications programmatically
- Achieve **90-95% token efficiency** vs. manual approaches

### Key Benefits for LLM Agents

| Capability | Without System | With System | Improvement |
|------------|---------------|-------------|-------------|
| Find implementation of spec | Load 5,000+ tokens | Follow link: 200 tokens | **96% reduction** |
| Check project progress | Read 8,000+ tokens | Query tool: 400 tokens | **95% reduction** |
| Update spec after work | Manual edit, search 12,000 tokens | Update tool: 300 tokens | **97% reduction** |
| Find relevant examples | Search all files: 15,000 tokens | Follow links: 1,000 tokens | **93% reduction** |
| Debug test failure | Load all tests: 10,000 tokens | Trace links: 650 tokens | **93.5% reduction** |

**Average Token Reduction**: **92-94%**

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                      UNIFIED SYSTEM                             │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │   Specs/Docs     │  │  Spec Management │  │   Semantic   │ │
│  │   Separation     │  │      Tools       │  │    Links     │ │
│  │                  │  │                  │  │              │ │
│  │ • Clear roles    │  │ • 20+ MCP tools  │  │ • 12 tools   │ │
│  │ • meridian/specs │  │ • Task tracking  │  │ • 5 levels   │ │
│  │ • meridian/docs  │  │ • Progress       │  │ • Traceability│ │
│  │ • Migration plan │  │ • Modification   │  │ • Discovery  │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                 │
│                   Result: 90%+ Token Efficiency                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Problem Statement

### Current State: Confusion and Inefficiency

**For Humans**:
- "Is this a spec or documentation?"
- "Where do I update this information?"
- "How much of the spec is implemented?"
- "What broke when I changed this code?"

**For LLM Agents**:
- Load entire files to find relevant sections (massive token waste)
- No direct path from spec → implementation
- Manual tracking of progress
- Cannot validate spec-code alignment
- Duplicate reading of related content

### Root Causes

1. **Mixed Content**: Specifications and documentation often live in the same files
2. **No Links**: No formal connections between specs, code, docs, examples, tests
3. **Manual Tracking**: Progress tracked in ad-hoc ways (comments, TODOs, external tools)
4. **Static References**: File paths break when code moves; no semantic linking

### Impact

- **Development Velocity**: 30-50% slower due to context switching and information hunting
- **Code Quality**: Features implemented without spec awareness
- **Documentation Debt**: Docs fall behind implementation
- **Onboarding Time**: New developers struggle to understand system
- **LLM Agent Effectiveness**: 10x more tokens consumed for same tasks

---

## Fundamental Concepts

### 1. Specifications = Primary Documents (WHAT to Build)

**Definition**: Specifications define **what** the system should do, not **how** to use it.

**Characteristics**:
- Written **before** implementation
- Define requirements, architecture, data structures
- Include acceptance criteria and test requirements
- Version-controlled with explicit versioning
- Primary source of truth for implementation

**Examples**:
- `meridian/specs/spec-en.md` - Core Meridian specification
- `meridian/specs/strong-tools-spec.md` - Documentation generation system spec
- `meridian/specs/global-architecture-spec.md` - Multi-monorepo architecture spec
- `meridian/specs/schemas/semantic-links-spec.md` - This semantic linking system spec

**Location**: `meridian/specs/`

### 2. Documentation = Generated/Derived Content (HOW to Use)

**Definition**: Documentation explains **how** to use the system that was built according to specs.

**Characteristics**:
- Written **after** or **during** implementation
- User-focused (guides, tutorials, API docs)
- Often auto-generated from code
- Evolves with implementation
- May have examples, screenshots, FAQs

**Examples**:
- `meridian/docs/getting-started.md` - User guide
- `meridian/docs/api/` - Auto-generated API docs
- `meridian/docs/tutorials/` - Step-by-step guides
- `meridian/docs/troubleshooting.md` - Common issues and solutions

**Location**: `meridian/docs/`

### 3. Semantic Links = Connections Between All Levels

**Definition**: Typed, bidirectional relationships between five knowledge levels.

**Five Knowledge Levels**:

```
Level 1: SPECIFICATIONS  (what to build)
   ↓ [implemented_by]
Level 2: CODE           (how it's built)
   ↓ [documented_in]
Level 3: DOCUMENTATION  (how to use it)
   ↓ [shows_example]
Level 4: EXAMPLES       (concrete usage)
   ↓ [validated_by]
Level 5: TESTS          (verification)
```

**Link Types** (12 primary):
- `implemented_by` / `realizes` - Spec ↔ Code
- `documented_in` / `documents` - Code ↔ Docs
- `demonstrated_in` / `demonstrates` - Code ↔ Examples
- `tested_by` / `tests` - Code ↔ Tests
- `user_guide_for` / `specifies` - Spec ↔ Docs
- `shows_example` / `illustrated_in` - Docs ↔ Examples

**Full Specification**: [schemas/semantic-links-spec.md](./schemas/semantic-links-spec.md)

---

## Directory Structure and Organization

### Proposed Structure

```
meridian/
├── specs/                      # SPECIFICATIONS (primary)
│   ├── spec-en.md             # Core specification (English)
│   ├── spec.md                # Core specification (Russian, original)
│   ├── strong-tools-spec-en.md
│   ├── strong-tools-spec.md
│   ├── global-architecture-spec-en.md
│   ├── global-architecture-spec.md
│   ├── roadmap.md             # Implementation roadmap
│   ├── CHANGELOG.md           # Specification version history
│   ├── INDEX.md               # Master index of all specs
│   │
│   ├── schemas/               # Data schemas and technical specs
│   │   ├── semantic-links-spec.md
│   │   ├── rocksdb-schema.md
│   │   ├── mcp-tools-catalog.md
│   │   └── type-definitions.md
│   │
│   ├── guides/                # Implementation and design guides
│   │   ├── getting-started.md
│   │   ├── multi-monorepo-setup.md
│   │   ├── mcp-integration.md
│   │   └── testing-guide.md
│   │
│   └── MCP_TOOLS_SPEC_MANAGEMENT.md  # Spec management tools spec
│
├── docs/                       # DOCUMENTATION (generated/user-facing)
│   ├── README.md              # Documentation index
│   ├── getting-started.md     # User onboarding guide
│   ├── user-guide.md          # Comprehensive user guide
│   │
│   ├── api/                   # Auto-generated API docs
│   │   ├── memory/
│   │   ├── context/
│   │   ├── session/
│   │   └── mcp/
│   │
│   ├── tutorials/             # Step-by-step tutorials
│   │   ├── basic-usage.md
│   │   ├── advanced-features.md
│   │   └── custom-workflows.md
│   │
│   ├── examples/              # Code examples with explanations
│   │   ├── memory-usage.md
│   │   ├── session-management.md
│   │   └── mcp-tools.md
│   │
│   └── troubleshooting.md     # Common issues and solutions
│
├── src/                        # CODE (implementation)
│   ├── memory/
│   ├── context/
│   ├── session/
│   └── ...
│
├── tests/                      # TESTS (verification)
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
└── examples/                   # RUNNABLE EXAMPLES (demonstrations)
    ├── basic-usage.rs
    ├── advanced-session.rs
    └── custom-memory.rs
```

### File Categorization Table

| Current File | Type | New Location | Reason |
|-------------|------|--------------|---------|
| `spec-en.md` | Specification | `specs/` | ✅ Already correct - defines system architecture |
| `spec.md` | Specification | `specs/` | ✅ Already correct - original specification |
| `strong-tools-spec.md` | Specification | `specs/` | ✅ Already correct - defines doc generation system |
| `global-architecture-spec.md` | Specification | `specs/` | ✅ Already correct - defines multi-monorepo architecture |
| `roadmap.md` | Tracking | `specs/` | ✅ Already correct - tracks implementation against specs |
| `CHANGELOG.md` | Tracking | `specs/` | ✅ Already correct - spec version history |
| `INDEX.md` | Navigation | `specs/` | ✅ Already correct - indexes specifications |
| `schemas/semantic-links-spec.md` | Specification | `specs/schemas/` | ✅ Already correct - defines semantic linking system |
| `schemas/rocksdb-schema.md` | Specification | `specs/schemas/` | ✅ Already correct - defines storage schema |
| `guides/getting-started.md` | Mixed | **→ Split** | ⚠️ Contains both spec (architecture) and docs (usage) |
| `guides/multi-monorepo-setup.md` | Guide | `specs/guides/` | ✅ Setup guide references spec |
| `guides/mcp-integration.md` | Guide | `specs/guides/` | ✅ Implementation guide |
| `guides/testing-guide.md` | Guide | `specs/guides/` | ✅ Testing strategy |

**Analysis Result**: Current structure is **95% correct**. Only `guides/getting-started.md` needs splitting.

### Migration Plan

**Phase 1: Create `docs/` Directory** (Week 1)
1. Create `meridian/docs/` structure
2. Split `guides/getting-started.md`:
   - Keep architecture/design in `specs/guides/getting-started.md`
   - Move user guide to `docs/getting-started.md`
3. Create `docs/README.md` as documentation index

**Phase 2: Generate API Documentation** (Week 2)
1. Implement auto-doc generation (from Strong Tools spec)
2. Generate `docs/api/` from code comments
3. Link API docs to code via semantic links

**Phase 3: Create User Guides** (Week 3)
1. Write `docs/user-guide.md` (comprehensive usage guide)
2. Write `docs/tutorials/` (step-by-step tutorials)
3. Write `docs/troubleshooting.md`

**Phase 4: Link Everything** (Week 4)
1. Add semantic link annotations to all files
2. Extract links via annotation parser
3. Validate all links
4. Create cross-reference index

**Total Time**: 4 weeks (can overlap with other development)

---

## Specification Management Tools

### Overview

**20+ MCP tools** for specification management enable LLM agents to work efficiently with specifications without loading entire documents.

**Full Specification**: [MCP_TOOLS_SPEC_MANAGEMENT.md](./MCP_TOOLS_SPEC_MANAGEMENT.md)

### Tool Categories

#### 1. Task Management Tools (6 tools)

**Purpose**: Extract, track, and manage implementation tasks from specifications.

| Tool | Purpose | Token Efficiency |
|------|---------|------------------|
| `specs.task.list_all` | List all tasks (filter by spec/phase/status) | 20-60 tokens/task (vs 500+ manual) |
| `specs.task.get_unimplemented` | Get unimplemented tasks with priorities | 45 tokens/task (includes effort estimates) |
| `specs.task.update_status` | Update task status, record learning | 150-200 tokens (vs 12,000+ manual) |
| `specs.task.get_blocked` | Find blocked tasks with resolution hints | 80 tokens/task (includes dependency chain) |
| `specs.task.create` | Create new task programmatically | 100 tokens |
| `specs.task.get_dependencies` | Get dependency graph, find critical path | 200-500 tokens (vs 5,000+ manual) |

**Key Features**:
- Automatic task extraction from markdown (checkboxes, emojis, tables)
- Readiness scoring based on dependencies
- Effort estimation from historical data
- Integration with episodic memory for learning

**Example Usage**:
```typescript
// Find next task to implement
const result = await tools["specs.task.get_unimplemented"]({
  exclude_blocked: true,
  min_priority: "high",
  limit: 10
});

// Returns: 10 ready-to-implement tasks (~600 tokens)
// vs reading entire spec (5,000+ tokens)
```

#### 2. Progress Tracking Tools (5 tools)

**Purpose**: Monitor implementation progress at all levels.

| Tool | Purpose | Token Efficiency |
|------|---------|------------------|
| `specs.progress.get_overall` | Overall progress across all specs | 400-1,000 tokens (vs 8,000+ manual) |
| `specs.progress.get_by_spec` | Detailed progress for specific spec | 500-800 tokens |
| `specs.progress.get_by_phase` | Cross-spec phase progress | 300-600 tokens |
| `specs.progress.calculate_completion_percentage` | Accurate completion % | 200 tokens |
| `specs.progress.get_velocity` | Velocity metrics and forecasts | 500-800 tokens |

**Key Features**:
- Multiple weighting strategies (equal, priority, effort, blocking)
- Trend analysis and forecasting
- Burnout risk detection
- Milestone tracking

**Example Usage**:
```typescript
// Get comprehensive progress report
const progress = await tools["specs.progress.get_overall"]({
  group_by: "phase",
  include_trends: true
});

// Returns: Complete progress metrics (~850 tokens)
// vs manually reading all specs (20,000+ tokens)
```

#### 3. Specification Modification Tools (5 tools)

**Purpose**: Update specifications programmatically with safety and validation.

| Tool | Purpose | Token Efficiency |
|------|---------|------------------|
| `specs.modify.update_section` | Update section safely (replace/append/merge) | 200-500 tokens |
| `specs.modify.add_requirement` | Add new requirement, auto-create task | 150-300 tokens |
| `specs.modify.deprecate_requirement` | Mark requirement deprecated, provide migration | 200-400 tokens |
| `specs.modify.create_spec` | Create new spec from template | 300-500 tokens |
| `specs.modify.merge_sections` | Merge sections, detect conflicts | 400-800 tokens |

**Key Features**:
- Auto-backup before modifications
- Validation before/after changes
- Git integration (auto-commit)
- Conflict detection and resolution

**Example Usage**:
```typescript
// Update spec section after implementation
const result = await tools["specs.modify.update_section"]({
  spec_name: "spec-en",
  section_name: "Memory Model",
  new_content: "## Updated Memory Model\n...",
  mode: "replace",
  commit_message: "docs: update memory model spec",
  validate_before: true
});

// Returns: Update result with diff (~300 tokens)
// vs manual editing and validation (thousands of tokens)
```

#### 4. Querying Tools (4 tools)

**Purpose**: Advanced search and cross-reference analysis.

| Tool | Purpose | Token Efficiency |
|------|---------|------------------|
| `specs.query.find_by_topic` | Find all mentions of a topic | 500-2,000 tokens (vs 15,000+ manual) |
| `specs.query.find_requirements` | Find requirements by criteria | 400-1,000 tokens |
| `specs.query.get_cross_references` | Get all cross-references | 300-800 tokens |
| `specs.query.find_duplicates` | Find duplicate/similar content | 500-1,500 tokens |

**Key Features**:
- Semantic and fuzzy search
- Cross-reference graph building
- Broken link detection
- Duplication analysis with consolidation suggestions

### Token Efficiency: Before vs After

| Scenario | Without Tools | With Tools | Savings |
|----------|--------------|------------|---------|
| Find next task to implement | 5,000 tokens | 600 tokens | **88%** |
| Check project progress | 8,000 tokens | 400 tokens | **95%** |
| Update spec after work | 12,000 tokens | 300 tokens | **97%** |
| Find all mentions of topic | 15,000 tokens | 1,000 tokens | **93%** |
| Review task dependencies | 6,000 tokens | 500 tokens | **92%** |
| **Average** | **9,200 tokens** | **560 tokens** | **94%** |

---

## Semantic Linking System

### Overview

The semantic linking system creates **typed, bidirectional connections** between all five knowledge levels, enabling precise navigation and token-efficient context retrieval.

**Full Specification**: [schemas/semantic-links-spec.md](./schemas/semantic-links-spec.md)

### Five Knowledge Levels

```
┌─────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE LEVELS                         │
└─────────────────────────────────────────────────────────────┘

Level 1: SPECIFICATIONS
├─ What to build
├─ Requirements, architecture, design
├─ Location: meridian/specs/
└─ [implemented_by] ↓

Level 2: CODE
├─ How it's built
├─ Actual implementation with structure
├─ Location: src/
└─ [documented_in, tested_by, demonstrated_in] ↓

Level 3: DOCUMENTATION
├─ How to use it
├─ User guides, API docs
├─ Location: meridian/docs/
└─ [shows_example] ↓

Level 4: EXAMPLES
├─ Concrete usage patterns
├─ Runnable demonstrations
├─ Location: examples/
└─ [validated_by] ↓

Level 5: TESTS
├─ Verification and validation
├─ Unit, integration, E2E tests
└─ Location: tests/
```

### Link Types (12 Primary)

| Link Type | Direction | Example |
|-----------|-----------|---------|
| `implemented_by` / `realizes` | Spec ↔ Code | "Memory Model" spec → `MemorySystem` class |
| `documented_in` / `documents` | Code ↔ Docs | `MemorySystem` class → "Memory API" docs |
| `demonstrated_in` / `demonstrates` | Code ↔ Examples | `MemorySystem.create()` → basic-usage.rs |
| `tested_by` / `tests` | Code ↔ Tests | `MemorySystem` → memory_system.spec.ts |
| `user_guide_for` / `specifies` | Spec ↔ Docs | "Memory Model" spec → "Memory Guide" docs |
| `shows_example` / `illustrated_in` | Docs ↔ Examples | "Memory Guide" → basic-usage.rs |

**All links are bidirectional**: Every `implemented_by` link creates a reverse `realizes` link automatically.

### MCP Tools for Semantic Links (12 tools)

| Tool | Purpose | Token Cost |
|------|---------|------------|
| `links.find_implementation` | Spec → Code | 200-400 tokens (vs 5,000+) |
| `links.find_documentation` | Code → Docs | 300-600 tokens (vs 3,000+) |
| `links.find_examples` | Entity → Examples | 200-500 tokens (vs 2,000+) |
| `links.find_tests` | Code → Tests | 200-400 tokens (vs 2,000+) |
| `links.create` | Create new link | 100-150 tokens |
| `links.validate` | Validate links | 150-300 tokens |
| `links.get_trace` | Full traceability path | 300-800 tokens |
| `links.find_orphans` | Unlinked entities | 200-500 tokens |
| `links.search` | Search by criteria | 300-800 tokens |
| `links.update` | Update existing link | 100-200 tokens |
| `links.delete` | Delete link | 50-100 tokens |
| `links.get_statistics` | Link health metrics | 200-400 tokens |

### Annotation Syntax

#### In Specifications (Markdown)
```markdown
# Memory Model

<!-- @meridian:implemented_by code:@omnitron-dev/meridian:MemorySystem -->
<!-- @meridian:documented_in docs:api/memory-system.md -->

Description of memory model...
```

#### In Code (Comments)
```typescript
/**
 * Memory system implementing the four-level cognitive model.
 *
 * @meridian:realizes spec:spec.md#memory-model
 * @meridian:documented_in docs:api/memory-system.md
 * @meridian:tested_by test:memory/system.spec.ts
 */
export class MemorySystem {
  // ...
}
```

#### In Documentation (Frontmatter)
```markdown
---
title: Memory System API
meridian:
  documents: code:@omnitron-dev/meridian:MemorySystem
  specifies: spec:spec.md#memory-model
  shows_example:
    - example:MemorySystem:basic-usage
---

# Memory System API

The MemorySystem class...
```

### Token Efficiency Examples

#### Example 1: Find Implementation
```typescript
// WITHOUT LINKS (Manual)
// 1. Read entire spec: 2,000 tokens
// 2. Search codebase: 5,000 tokens
// 3. Read candidate files: 3,000 tokens
// Total: 10,000 tokens

// WITH LINKS (Automated)
const impl = await tools["links.find_implementation"]({
  spec_id: "spec:spec.md#memory-model"
});
// Returns: Direct symbol reference: 200 tokens
// Savings: 98% (10,000 → 200)
```

#### Example 2: Trace Spec → Tests
```typescript
// WITHOUT LINKS (Manual)
// 1. Read spec: 2,000 tokens
// 2. Find implementation: 5,000 tokens
// 3. Find tests: 3,000 tokens
// Total: 10,000 tokens

// WITH LINKS (Automated)
const trace = await tools["links.get_trace"]({
  start_id: "spec:spec.md#memory-model",
  max_depth: 5
});
// Returns: Complete trace with visualization: 800 tokens
// Savings: 92% (10,000 → 800)
```

#### Example 3: Debug Test Failure
```typescript
// WITHOUT LINKS (Manual)
// 1. Read test file: 1,000 tokens
// 2. Find tested code: 5,000 tokens
// 3. Find spec: 3,000 tokens
// 4. Find examples: 2,000 tokens
// Total: 11,000 tokens

// WITH LINKS (Automated)
const context = await tools["links.get_trace"]({
  start_id: "test:memory/system.spec.ts:creates_memory_system",
  trace_path: ["tests", "realizes", "demonstrated_in"]
});
// Returns: Test → Code → Spec → Example: 650 tokens
// Savings: 94% (11,000 → 650)
```

### Link Storage (RocksDB)

```
# Primary Links
links:{linkId} → SemanticLink (JSON)

# Forward Links (from source)
links:forward:code:MemorySystem → [linkId1, linkId2, ...]

# Reverse Links (to target)
links:reverse:test:memory_system.spec.ts → [linkId1, linkId2, ...]

# Cross-Level Index
links:cross:spec:code → [linkId1, linkId2, ...]
links:cross:code:tests → [linkId3, linkId4, ...]

# Validation Index
links:validation:broken → [linkId5]
links:validation:stale:30 → [linkId6]

# Entity Index
links:entity:code:MemorySystem → {
  outgoing: [linkId1, linkId2],
  incoming: [linkId3, linkId4]
}
```

---

## Integration: How All Pieces Work Together

### The Complete Workflow

```
┌───────────────────────────────────────────────────────────────┐
│                    UNIFIED WORKFLOW                           │
└───────────────────────────────────────────────────────────────┘

1. SPECIFICATIONS DEFINE TASKS
   ├─ Specs contain requirements and design
   ├─ Spec tools extract tasks automatically
   └─ Tasks have dependencies, priorities, estimates

2. SPEC TOOLS TRACK PROGRESS
   ├─ specs.task.get_unimplemented → Find next task
   ├─ specs.progress.get_overall → Check status
   └─ specs.task.update_status → Mark complete

3. CODE IMPLEMENTS SPECS
   ├─ Developers/agents implement features
   ├─ Code annotated with @meridian:realizes links
   └─ Semantic links created automatically

4. SEMANTIC LINKS CONNECT EVERYTHING
   ├─ links.find_implementation → Spec to Code
   ├─ links.find_tests → Code to Tests
   ├─ links.find_documentation → Code to Docs
   └─ links.get_trace → End-to-end traceability

5. DOCS EXPLAIN CODE
   ├─ Auto-generated from code annotations
   ├─ Linked to code via semantic links
   └─ Linked to examples via shows_example

6. EXAMPLES DEMONSTRATE USAGE
   ├─ Runnable code examples
   ├─ Linked to code via demonstrates
   └─ Linked to docs via illustrated_in

7. TESTS VERIFY IMPLEMENTATION
   ├─ Tests validate requirements
   ├─ Linked to code via tests
   └─ Linked to specs via relates_to
```

### ASCII Architecture Diagram

```
                    ┌─────────────────────┐
                    │   SPECIFICATIONS    │
                    │   meridian/specs/   │
                    └──────────┬──────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
       [Spec Management Tools]      [Semantic Links]
                │                             │
    ┌───────────┴────────┐         ┌─────────┴─────────┐
    │                    │         │                   │
    │  • Task extraction │         │  • Link creation  │
    │  • Progress track  │         │  • Validation     │
    │  • Modification    │         │  • Traceability   │
    │  • Querying        │         │  • Discovery      │
    │                    │         │                   │
    └───────────┬────────┘         └─────────┬─────────┘
                │                             │
                └──────────────┬──────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ▼                             ▼
        ┌───────────────┐            ┌───────────────┐
        │     CODE      │◄───────────┤  DOCUMENTATION│
        │     src/      │  documents │  meridian/docs│
        └───────┬───────┘            └───────────────┘
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
┌───────────────┐  ┌───────────────┐
│   EXAMPLES    │  │     TESTS     │
│   examples/   │  │    tests/     │
└───────────────┘  └───────────────┘

Legend:
  ─── : Structural relationship
  ◄── : Semantic link
  [  ] : Tool/System
```

### Concrete Example: Implementing a Feature

**Task**: Implement "Episodic Memory" feature

#### Step 1: Find Task
```typescript
const task = await tools["specs.task.get_unimplemented"]({
  min_priority: "high",
  limit: 1
});
// Returns: "Implement Episodic Memory" task (60 tokens)
```

#### Step 2: Get Specification
```typescript
const spec = await tools["specs.get_section"]({
  spec_name: "spec-en",
  section_name: "Episodic Memory"
});
// Returns: Spec section (500 tokens)
```

#### Step 3: Find Related Code
```typescript
const related = await tools["links.find_implementation"]({
  spec_id: "spec:spec-en.md#episodic-memory"
});
// Returns: Related symbols (200 tokens)
```

#### Step 4: Implement
```rust
/// Episodic memory stores task execution records.
///
/// @meridian:realizes spec:spec-en.md#episodic-memory
/// @meridian:tested_by test:memory/episodic.spec.ts
pub struct EpisodicMemory {
    // Implementation...
}
```

#### Step 5: Update Task Status
```typescript
await tools["specs.task.update_status"]({
  task_id: "task_spec_en_episodic_001",
  status: "complete",
  actual_effort: { lines_of_code: 250, time_hours: 4 },
  auto_update_spec: true
});
// Updates spec, records in memory (200 tokens)
```

#### Step 6: Verify Links
```typescript
const trace = await tools["links.get_trace"]({
  start_id: "spec:spec-en.md#episodic-memory"
});
// Returns: Spec → Code → Tests (300 tokens)
```

**Total Token Cost**: ~1,260 tokens
**Without System**: ~20,000+ tokens (read entire spec, search all code, find all tests)
**Savings**: 93.7%

---

## Self-Improvement Process

### Using Meridian on Itself

Meridian's specification and documentation system is **self-applicable**: we use Meridian's own tools to manage Meridian's development.

#### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│              MERIDIAN SELF-IMPROVEMENT LOOP                 │
└─────────────────────────────────────────────────────────────┘

1. MERIDIAN SPECS managed by MERIDIAN TOOLS
   ├─ specs.task.list_all → List Meridian implementation tasks
   ├─ specs.progress.get_overall → Track Meridian progress
   └─ specs.modify.update_section → Update Meridian specs

2. MERIDIAN CODE linked via SEMANTIC LINKS
   ├─ Meridian's code annotated with @meridian:realizes
   ├─ Links point to Meridian's own specs
   └─ Full traceability: Spec → Code → Tests

3. MERIDIAN LEARNS from its own development
   ├─ memory.record_episode → Record Meridian development episodes
   ├─ memory.find_similar_episodes → Learn patterns
   └─ predict.next_action → Predict next development steps

4. CONTINUOUS ITERATION
   ├─ Track what works (velocity, quality)
   ├─ Identify bottlenecks (blocked tasks)
   ├─ Optimize tools based on usage
   └─ Improve specifications based on implementation
```

### Example: This Specification

**This document** (`SPECS_DOCS_SEPARATION.md`) is managed by Meridian's own tools:

```typescript
// Create task for this spec
await tools["specs.task.create"]({
  spec_name: "SPECS_DOCS_SEPARATION",
  section: "Implementation Roadmap",
  title: "Implement specification management tools",
  phase: "Phase 2",
  priority: "high",
  dependencies: ["task_phase1_storage"]
});

// Track progress on writing this spec
await tools["specs.progress.get_by_spec"]({
  spec_name: "SPECS_DOCS_SEPARATION"
});

// Link this spec to its implementation
// (once spec management tools are implemented)
await tools["links.create"]({
  type: "implemented_by",
  source: {
    level: "spec",
    id: "spec:SPECS_DOCS_SEPARATION.md#specification-management-tools"
  },
  target: {
    level: "code",
    id: "code:@omnitron-dev/meridian:SpecTaskManager"
  }
});
```

### Metrics for Self-Improvement

| Metric | Target | Current | Notes |
|--------|--------|---------|-------|
| Spec completion % | 100% | 78% | Phases 1-5, 8 complete; 6-7 deferred |
| Spec-code alignment | 95%+ | TBD | Will measure with semantic links |
| Token efficiency | 90%+ | 94% (projected) | Based on tool design |
| Development velocity | Stable/growing | 2.4 tasks/day | From roadmap tracking |
| Link coverage | 80%+ | 0% (not yet implemented) | Will grow as we annotate |

---

## Implementation Roadmap

### Overview

**Total Duration**: 11-13 weeks
**Phased Approach**: Four main phases with dependencies

### Phase 1: Reorganize Specs/Docs (1 week)

**Goal**: Complete the specs/docs separation physically.

**Tasks**:
1. Create `meridian/docs/` directory structure
2. Split `guides/getting-started.md`:
   - Architecture → `specs/guides/getting-started.md`
   - User guide → `docs/getting-started.md`
3. Create `docs/README.md` as documentation index
4. Update cross-references between specs and docs
5. Validate all links still work

**Deliverables**:
- [ ] `meridian/docs/` structure created
- [ ] `getting-started.md` split and migrated
- [ ] `docs/README.md` written
- [ ] All cross-references updated
- [ ] Migration validated

**Success Criteria**: Clear separation, no broken links, 100% of files categorized correctly

---

### Phase 2: Implement Spec Management Tools (2-3 weeks)

**Goal**: Implement all 20 specification management tools.

#### Week 1: Core Infrastructure
**Tasks**:
1. Design and implement core data structures:
   - `Task`, `Requirement`, `ProgressSummary`, `VelocityMetrics`
2. Implement `TaskRegistry` (central task storage)
3. Implement `TaskManager` (task extraction from specs)
4. Implement `ProgressTracker` (progress calculation)
5. Write unit tests (50+ tests)

**Deliverables**:
- [ ] Core types defined in Rust
- [ ] `TaskRegistry` implemented with RocksDB storage
- [ ] `TaskManager` can extract tasks from markdown
- [ ] `ProgressTracker` can calculate completion %
- [ ] 50+ unit tests passing

#### Week 2: MCP Tools (Task & Progress)
**Tasks**:
1. Implement 6 Task Management tools:
   - `specs.task.list_all`
   - `specs.task.get_unimplemented`
   - `specs.task.update_status`
   - `specs.task.get_blocked`
   - `specs.task.create`
   - `specs.task.get_dependencies`
2. Implement 5 Progress Tracking tools:
   - `specs.progress.get_overall`
   - `specs.progress.get_by_spec`
   - `specs.progress.get_by_phase`
   - `specs.progress.calculate_completion_percentage`
   - `specs.progress.get_velocity`
3. Write integration tests (20+ tests)

**Deliverables**:
- [ ] 11 MCP tools implemented
- [ ] MCP handlers tested with live MCP server
- [ ] 20+ integration tests passing
- [ ] Tool documentation written

#### Week 3: MCP Tools (Modify & Query)
**Tasks**:
1. Implement `SpecModifier` (safe spec file updates)
2. Implement `RequirementManager` (requirement CRUD)
3. Implement `QueryEngine` (advanced search)
4. Implement 5 Modification tools:
   - `specs.modify.update_section`
   - `specs.modify.add_requirement`
   - `specs.modify.deprecate_requirement`
   - `specs.modify.create_spec`
   - `specs.modify.merge_sections`
5. Implement 4 Querying tools:
   - `specs.query.find_by_topic`
   - `specs.query.find_requirements`
   - `specs.query.get_cross_references`
   - `specs.query.find_duplicates`
6. Write E2E tests (10+ tests)

**Deliverables**:
- [ ] 9 more MCP tools (total: 20)
- [ ] Safe spec modification with validation
- [ ] Advanced querying with fuzzy search
- [ ] 10+ E2E tests passing
- [ ] Full tool documentation

**Phase 2 Completion Criteria**:
- All 20 spec management tools working
- 200+ tests passing (unit, integration, E2E)
- Token efficiency target met (90%+ reduction)
- Self-documentation: Meridian specs managed by Meridian tools

---

### Phase 3: Implement Semantic Linking (5 weeks)

**Goal**: Implement complete semantic linking system with 12 tools.

#### Week 1: Storage Layer
**Tasks**:
1. Design RocksDB schema for links (extend existing)
2. Implement `LinkManager` with CRUD operations
3. Implement forward/reverse/cross-level indexing
4. Implement link validation logic
5. Write storage tests (30+ tests)

**Deliverables**:
- [ ] Link storage schema in RocksDB
- [ ] `LinkManager` with full CRUD
- [ ] Multi-index support (forward, reverse, type, entity)
- [ ] Link validation (detect broken links)
- [ ] 30+ storage tests

#### Week 2: Extraction Pipeline
**Tasks**:
1. Implement `AnnotationParser` (parse @meridian annotations)
   - Spec annotation parser (markdown)
   - Code annotation parser (TypeScript/Rust/Python)
   - Docs annotation parser (frontmatter)
2. Implement `InferenceEngine` (infer links from structure)
   - Import analyzer (from import statements)
   - Naming analyzer (test file → code file)
   - Reference finder (cross-references)
3. Implement extraction pipeline with deduplication
4. Write extraction tests (40+ tests)

**Deliverables**:
- [ ] Annotation parsing for 3 file types
- [ ] Inference engine with 3 analyzers
- [ ] Extraction pipeline (annotate → infer → deduplicate → validate)
- [ ] 40+ extraction tests

#### Week 3: MCP Tools (Basic)
**Tasks**:
1. Implement 6 basic link tools:
   - `links.find_implementation`
   - `links.find_documentation`
   - `links.find_examples`
   - `links.find_tests`
   - `links.create`
   - `links.validate`
2. Write tool tests (15+ tests)

**Deliverables**:
- [ ] 6 link discovery/management tools
- [ ] 15+ tool tests
- [ ] MCP server integration

#### Week 4: MCP Tools (Advanced)
**Tasks**:
1. Implement 6 advanced link tools:
   - `links.get_trace` (full traceability)
   - `links.find_orphans` (unlinked entities)
   - `links.search` (advanced search)
   - `links.update` (modify links)
   - `links.delete` (remove links)
   - `links.get_statistics` (health metrics)
2. Implement visualization (ASCII art graphs)
3. Write advanced tests (20+ tests)

**Deliverables**:
- [ ] 6 advanced link tools (total: 12)
- [ ] ASCII visualization of link graphs
- [ ] Link health analytics
- [ ] 20+ advanced tests

#### Week 5: Annotation & Integration
**Tasks**:
1. Annotate Meridian's own codebase:
   - Add @meridian:realizes to all code
   - Add @meridian:tested_by to all classes
   - Add @meridian:documented_in where docs exist
2. Extract links from Meridian codebase
3. Validate link coverage (target: 80%+)
4. Write documentation and examples
5. Performance testing and optimization

**Deliverables**:
- [ ] Meridian codebase fully annotated
- [ ] 500+ semantic links extracted
- [ ] 80%+ link coverage achieved
- [ ] Documentation complete
- [ ] Performance benchmarks met

**Phase 3 Completion Criteria**:
- All 12 semantic link tools working
- 105+ tests passing
- 80%+ link coverage in Meridian codebase
- Token efficiency verified (92%+ reduction)
- Full traceability: Spec → Code → Tests

---

### Phase 4: Self-Test and Iterate (Ongoing)

**Goal**: Use Meridian on itself, measure effectiveness, iterate.

#### Initial Self-Test (2 weeks)
**Tasks**:
1. Use spec tools to manage Meridian development:
   - Track all remaining tasks via `specs.task.*`
   - Monitor progress via `specs.progress.*`
   - Update specs via `specs.modify.*`
2. Use semantic links for development:
   - Navigate codebase via `links.find_*`
   - Validate coverage via `links.find_orphans`
   - Trace features via `links.get_trace`
3. Measure effectiveness:
   - Token usage reduction
   - Development velocity change
   - Code quality metrics
4. Gather feedback from development experience
5. Identify pain points and improvement areas

**Deliverables**:
- [ ] 2 weeks of real usage on Meridian development
- [ ] Effectiveness metrics collected
- [ ] Feedback document written
- [ ] Improvement backlog created

#### Continuous Iteration
**Tasks**:
1. Weekly metric review:
   - Token efficiency
   - Tool usage patterns
   - Link coverage growth
   - Development velocity
2. Monthly improvements:
   - Optimize frequently-used tools
   - Add missing link types if needed
   - Improve extraction accuracy
   - Enhance visualizations
3. Quarterly retrospective:
   - Review overall system effectiveness
   - Plan major enhancements
   - Update specifications based on learnings

**Success Criteria** (Ongoing):
- Token efficiency maintains 90%+
- Development velocity stable or improving
- Link coverage growing toward 100%
- Developer/agent satisfaction high

---

### Timeline Summary

```
Week 1:     Phase 1 - Specs/Docs Separation
Weeks 2-4:  Phase 2 - Spec Management Tools
Weeks 5-9:  Phase 3 - Semantic Linking System
Weeks 10-11: Phase 4 - Self-Test
Week 12+:   Phase 4 - Continuous Iteration

Total: 11-13 weeks to full implementation
```

### Dependencies

```
Phase 1 (Separation)
    │
    ▼
Phase 2 (Spec Tools) ─────┐
    │                     │
    ▼                     ▼
Phase 3 (Semantic Links)  │
    │                     │
    └─────────────────────┘
    │
    ▼
Phase 4 (Self-Test & Iterate)
```

**Critical Path**: Phase 1 → Phase 2 → Phase 3 → Phase 4
**Parallel Opportunities**:
- Documentation can be written in parallel with implementation
- Testing can overlap with development
- Phase 4 iteration overlaps with future development

---

## Success Metrics

### Token Efficiency Metrics

**Target**: 90%+ reduction in token usage vs. manual approaches

| Metric | Target | How Measured |
|--------|--------|--------------|
| Task discovery efficiency | 90%+ reduction | Compare: manual spec reading vs. `specs.task.get_unimplemented` |
| Progress checking efficiency | 95%+ reduction | Compare: manual analysis vs. `specs.progress.get_overall` |
| Spec update efficiency | 95%+ reduction | Compare: manual editing vs. `specs.modify.update_section` |
| Code discovery efficiency | 95%+ reduction | Compare: manual search vs. `links.find_implementation` |
| Traceability efficiency | 93%+ reduction | Compare: manual tracing vs. `links.get_trace` |
| **Overall average** | **92%+ reduction** | Weighted average of all scenarios |

**Measurement Approach**:
1. Define 20 common scenarios (find task, check progress, update spec, etc.)
2. Measure token cost for manual approach (actual agent sessions)
3. Measure token cost for tool-based approach
4. Calculate reduction percentage
5. Report monthly and track trends

### Development Velocity Metrics

**Target**: Stable or increasing velocity

| Metric | Baseline | Target | How Measured |
|--------|----------|--------|--------------|
| Tasks completed/week | 2.4 tasks/day (current) | 2.5+ tasks/day | `specs.progress.get_velocity` |
| Time to find task | ~30 min (manual) | <2 min (tool) | Timed samples |
| Time to check progress | ~15 min (manual) | <1 min (tool) | Timed samples |
| Time to update spec | ~10 min (manual) | <1 min (tool) | Timed samples |
| **Overall velocity** | Baseline | +10% improvement | Weekly tracking |

### Code Quality Metrics

**Target**: Improved alignment and coverage

| Metric | Baseline | Target | How Measured |
|--------|----------|--------|--------------|
| Spec-code alignment | Unknown | 95%+ | % of specs with `implemented_by` links |
| Test coverage | Unknown | 80%+ | % of code with `tested_by` links |
| Documentation coverage | Unknown | 80%+ | % of code with `documented_in` links |
| Example coverage | Unknown | 50%+ | % of public APIs with `demonstrated_in` links |
| Link validity | N/A | 98%+ | % of links that validate successfully |

### System Health Metrics

**Target**: Robust and reliable system

| Metric | Target | How Measured |
|--------|--------|--------------|
| Link extraction accuracy | 95%+ | % of correctly extracted links (manual review) |
| Link inference precision | 80%+ | % of inferred links that are correct |
| Tool availability | 99.9%+ | Uptime of MCP server |
| Query performance | <100ms | p95 latency for tool calls |
| Storage efficiency | <50MB per 10K links | RocksDB size tracking |

### Adoption Metrics

**Target**: High usage and satisfaction

| Metric | Target | How Measured |
|--------|--------|--------------|
| Tool usage rate | 80%+ of dev sessions | Track tool invocations |
| User satisfaction | 4.5/5 stars | Developer feedback surveys |
| Bug reports | <1 per week | GitHub issues tracking |
| Feature requests | Growing list | Indicates engagement |
| External adoption | 5+ projects | Other teams using Meridian |

### Self-Improvement Metrics

**Target**: System improves over time

| Metric | Target | How Measured |
|--------|--------|--------------|
| Episodic memory growth | 100+ episodes | `memory.get_statistics` |
| Prediction accuracy | 70%+ | % of correct next-action predictions |
| Effort estimation error | <20% | Actual vs. estimated effort |
| Velocity trend | Stable/growing | Week-over-week comparison |
| System refinements | 5+ per quarter | Number of improvements shipped |

### Reporting Cadence

- **Daily**: Automated metrics collection (silent)
- **Weekly**: Development velocity report
- **Monthly**: Comprehensive metrics review with trends
- **Quarterly**: Full retrospective with improvement planning
- **Semi-annual**: External stakeholder report

---

## Appendix: System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MERIDIAN UNIFIED SYSTEM                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                   MCP INTERFACE LAYER                  │   │
│  │                                                        │   │
│  │  • 29 existing MCP tools (memory, context, session)   │   │
│  │  • 20 new spec management tools (Phase 2)             │   │
│  │  • 12 semantic link tools (Phase 3)                   │   │
│  │  • Total: 61 MCP tools                                │   │
│  └──────────────────────┬─────────────────────────────────┘   │
│                         │                                      │
│  ┌──────────────────────┴─────────────────────────────────┐   │
│  │              APPLICATION LOGIC LAYER                   │   │
│  │                                                        │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │   │
│  │  │   Spec      │  │   Semantic   │  │   Memory     │ │   │
│  │  │ Management  │  │    Links     │  │   System     │ │   │
│  │  │             │  │              │  │              │ │   │
│  │  │ • Tasks     │  │ • Manager    │  │ • Episodic   │ │   │
│  │  │ • Progress  │  │ • Extractor  │  │ • Working    │ │   │
│  │  │ • Modify    │  │ • Validator  │  │ • Semantic   │ │   │
│  │  │ • Query     │  │ • Visualizer │  │ • Procedural │ │   │
│  │  └─────────────┘  └──────────────┘  └──────────────┘ │   │
│  │                                                        │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │   │
│  │  │  Context    │  │   Session    │  │  Learning    │ │   │
│  │  │  Manager    │  │   Manager    │  │   System     │ │   │
│  │  └─────────────┘  └──────────────┘  └──────────────┘ │   │
│  └──────────────────────┬─────────────────────────────────┘   │
│                         │                                      │
│  ┌──────────────────────┴─────────────────────────────────┐   │
│  │                  STORAGE LAYER                         │   │
│  │                                                        │   │
│  │                     RocksDB                            │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  Column Families:                              │  │   │
│  │  │  • default: Core data                          │  │   │
│  │  │  • symbols: Code symbols + metadata            │  │   │
│  │  │  • specs: Specification sections + tasks       │  │   │
│  │  │  • links: Semantic links (NEW in Phase 3)      │  │   │
│  │  │  • memory: Episodic/working/semantic memory    │  │   │
│  │  │  • session: Session state                      │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Component Interactions

```
LLM Agent
    │
    ▼ (MCP call)
┌─────────────────────┐
│  MCP Server         │
│  (Meridian)         │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
Spec Tools    Link Tools
    │             │
    ▼             ▼
TaskManager   LinkManager
    │             │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │  RocksDB    │
    │  Storage    │
    └─────────────┘
```

### Data Flow: Task Implementation

```
1. Agent: "What should I work on next?"
   │
   ▼ specs.task.get_unimplemented
   │
TaskManager.get_unimplemented()
   │
   ├─ Load tasks from RocksDB (specs CF)
   ├─ Calculate readiness scores
   ├─ Sort by priority
   └─ Return top N tasks
   │
   ▼ (200-600 tokens)
Agent: Receives prioritized task list

2. Agent: "Show me the spec for this task"
   │
   ▼ specs.get_section
   │
SpecManager.get_section()
   │
   ├─ Load spec from RocksDB
   └─ Return section content
   │
   ▼ (500-1000 tokens)
Agent: Reads specification

3. Agent: "Find code related to this spec"
   │
   ▼ links.find_implementation
   │
LinkManager.find_forward_links(spec_id, "implemented_by")
   │
   ├─ Query links CF in RocksDB
   ├─ Resolve target symbol IDs
   └─ Load symbol metadata
   │
   ▼ (200-400 tokens)
Agent: Gets related code symbols

4. Agent: [Implements feature]

5. Agent: "Mark task complete"
   │
   ▼ specs.task.update_status
   │
TaskManager.update_status(task_id, "complete")
   │
   ├─ Update task in RocksDB
   ├─ Check for newly unblocked tasks
   ├─ Record episode in memory
   └─ Optionally update spec file
   │
   ▼ (150-200 tokens)
Agent: Task marked complete, progress updated
```

### File Organization After Implementation

```
meridian/
├── specs/                          # PRIMARY SPECIFICATIONS
│   ├── spec-en.md                 # Core spec (English)
│   ├── spec.md                    # Core spec (Russian)
│   ├── strong-tools-spec-en.md
│   ├── strong-tools-spec.md
│   ├── global-architecture-spec-en.md
│   ├── global-architecture-spec.md
│   ├── SPECS_DOCS_SEPARATION.md   # ← This document
│   ├── MCP_TOOLS_SPEC_MANAGEMENT.md
│   ├── roadmap.md
│   ├── CHANGELOG.md
│   ├── INDEX.md
│   │
│   ├── schemas/
│   │   ├── semantic-links-spec.md
│   │   ├── rocksdb-schema.md
│   │   ├── mcp-tools-catalog.md
│   │   └── type-definitions.md
│   │
│   └── guides/
│       ├── getting-started.md     # Architecture guide (for implementers)
│       ├── multi-monorepo-setup.md
│       ├── mcp-integration.md
│       └── testing-guide.md
│
├── docs/                           # USER DOCUMENTATION
│   ├── README.md                  # Documentation index
│   ├── getting-started.md         # User onboarding (for users)
│   ├── user-guide.md              # Comprehensive usage guide
│   │
│   ├── api/                       # Auto-generated API docs
│   │   ├── memory/
│   │   │   ├── episodic.md
│   │   │   ├── working.md
│   │   │   ├── semantic.md
│   │   │   └── procedural.md
│   │   ├── context/
│   │   │   ├── manager.md
│   │   │   └── adaptive.md
│   │   ├── session/
│   │   │   └── manager.md
│   │   └── mcp/
│   │       ├── tools.md
│   │       └── handlers.md
│   │
│   ├── tutorials/                 # Step-by-step guides
│   │   ├── basic-usage.md
│   │   ├── advanced-features.md
│   │   ├── custom-workflows.md
│   │   └── agent-integration.md
│   │
│   ├── examples/                  # Explained examples
│   │   ├── memory-usage.md
│   │   ├── session-management.md
│   │   ├── mcp-tools.md
│   │   └── semantic-links.md
│   │
│   └── troubleshooting.md         # FAQ and common issues
│
├── src/                            # IMPLEMENTATION
│   ├── memory/
│   ├── context/
│   ├── session/
│   ├── specs/                     # NEW in Phase 2
│   │   ├── task_manager.rs
│   │   ├── task_registry.rs
│   │   ├── progress_tracker.rs
│   │   ├── spec_modifier.rs
│   │   ├── requirement_manager.rs
│   │   └── query_engine.rs
│   ├── links/                     # NEW in Phase 3
│   │   ├── manager.rs
│   │   ├── storage.rs
│   │   ├── validator.rs
│   │   ├── extraction/
│   │   │   ├── annotation_parser.rs
│   │   │   ├── inference_engine.rs
│   │   │   └── pipeline.rs
│   │   └── visualization.rs
│   └── ...
│
├── tests/
├── examples/                       # RUNNABLE EXAMPLES
└── ...
```

---

## Conclusion

This unified specification defines a **three-part system** that fundamentally improves how LLM agents work with codebases:

1. **Specs/Docs Separation**: Clear roles prevent confusion
2. **Spec Management Tools**: 20+ tools for efficient specification work
3. **Semantic Links**: Typed connections enable precise navigation

**Result**: **90-95% token efficiency** improvement, faster development, better code quality, and a self-improving system that learns from its own development.

**Next Steps**:
1. ✅ Review and approve this specification
2. Begin Phase 1: Reorganize specs/docs (1 week)
3. Begin Phase 2: Implement spec management tools (2-3 weeks)
4. Begin Phase 3: Implement semantic linking (5 weeks)
5. Begin Phase 4: Self-test and iterate (ongoing)

**Target**: Meridian v2.1.0 with full unified system in 11-13 weeks

---

**Document Version**: 1.0.0
**Created**: October 18, 2025
**Last Updated**: October 18, 2025
**Authors**: Meridian Development Team
**Status**: Design Specification - Ready for Implementation
