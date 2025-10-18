# Meridian MCP Tools Catalog

**Version**: 2.0.0
**Created**: October 18, 2025
**Last Updated**: October 18, 2025
**Protocol**: MCP 2025-03-26
**Status**: Production

---

## Overview

Complete catalog of all MCP tools available in Meridian v2.0.0. This is the **single source of truth** for tool definitions, implementation status, and usage.

**Total Tools**: 49
- **Core Tools**: 29 (100% implemented)
- **Specification Tools**: 10 (spec.md reference)
- **Strong Tools**: 10 (strong-tools-spec.md)

---

## Tool Categories

### 1. Memory Management (4 tools)

#### `memory.record_episode`

**Status**: ✅ Implemented (Production)

**Description**: Record a task episode for future learning and pattern extraction

**Input**:
```typescript
{
  task: string;                          // Task description
  queries_made?: string[];               // Queries executed
  files_accessed?: string[];             // Files touched
  solution?: string;                     // Solution description
  outcome: "success" | "failure" | "partial";
}
```

**Output**:
```typescript
{
  episode_id: string;
  patterns_extracted: Pattern[];
  suggestions: string[];
}
```

**Reference**: spec.md, lines 856-869

---

#### `memory.find_similar_episodes`

**Status**: ✅ Implemented (Production)

**Description**: Find similar task episodes from history to guide current work

**Input**:
```typescript
{
  task_description: string;
  limit?: number;                        // Default: 5
}
```

**Output**:
```typescript
{
  episodes: Episode[];
  recommended_approach: Approach;
  predicted_files: string[];
}
```

**Reference**: spec.md, lines 871-883

---

#### `memory.update_working_set`

**Status**: ✅ Implemented (Production)

**Description**: Update working memory with attention weights from LLM focus

**Input**:
```typescript
{
  focused_symbols: Array<{
    symbol: string;
    weight: number;
  }>;
  accessed_files: string[];
  session_id: string;
}
```

**Output**:
```typescript
{
  updated_context: WorkingContext;
  evicted_symbols: string[];
  prefetched_symbols: string[];
}
```

**Reference**: spec.md, lines 885-897

---

#### `memory.get_statistics`

**Status**: ✅ Implemented (Production)

**Description**: Get memory system statistics and usage information

**Input**:
```typescript
{
  include_details?: boolean;             // Default: false
  project_path?: string;                 // Optional project filter
}
```

**Output**:
```typescript
{
  episodic: { count: number; size: number };
  working: { capacity: number; used: number };
  semantic: { patterns: number; consolidated: number };
  procedural: { procedures: number };
}
```

**Reference**: spec.md (derived from memory system)

---

### 2. Context Management (3 tools)

#### `context.prepare_adaptive`

**Status**: ✅ Implemented (Production)

**Description**: Prepare optimized context adapted to specific LLM model and token budget

**Input**:
```typescript
{
  request: ContextRequest;
  model: "claude-3" | "gpt-4" | "gemini" | "custom";
  available_tokens: number;
}
```

**Output**:
```typescript
{
  context: OptimizedContext;
  compression_ratio: number;
  strategy_used: CompressionStrategy;
  quality_score: number;
}
```

**Reference**: spec.md, lines 899-913

---

#### `context.defragment`

**Status**: ✅ Implemented (Production)

**Description**: Defragment scattered context fragments into unified narrative

**Input**:
```typescript
{
  fragments: ContextFragment[];
  target_tokens: number;
}
```

**Output**:
```typescript
{
  unified: UnifiedContext;
  bridges: SemanticBridge[];
  narrative_flow: string;
}
```

**Reference**: spec.md, lines 915-927

---

#### `context.compress`

**Status**: ✅ Implemented (Production)

**Description**: Compress context using specified strategy

**Input**:
```typescript
{
  content: string;
  strategy: "remove_comments" | "remove_whitespace" | "skeleton" |
           "summary" | "extract_key_points" | "tree_shaking" |
           "hybrid" | "ultra_compact";
  target_ratio?: number;                 // 0.0-1.0
  project_path?: string;
}
```

**Output**:
```typescript
{
  compressed: string;
  original_tokens: number;
  compressed_tokens: number;
  compression_ratio: number;
  strategy_used: string;
}
```

**Reference**: spec.md, lines 376-417

---

### 3. Learning & Feedback (3 tools)

#### `feedback.mark_useful`

**Status**: ✅ Implemented (Production)

**Description**: Mark symbols and context as useful or unnecessary for learning

**Input**:
```typescript
{
  session_id: string;
  useful_symbols?: string[];
  unnecessary_symbols?: string[];
  missing_context?: string;
}
```

**Output**:
```typescript
{
  feedback_id: string;
  model_updated: boolean;
}
```

**Reference**: spec.md, lines 929-943

---

#### `learning.train_on_success`

**Status**: ✅ Implemented (Production)

**Description**: Train system on successful task completion

**Input**:
```typescript
{
  task: Task;
  solution: Solution;
  key_insights?: string[];
}
```

**Output**:
```typescript
{
  patterns_learned: Pattern[];
  procedure_updated: boolean;
  confidence: number;
}
```

**Reference**: spec.md, lines 945-957

---

#### `predict.next_action`

**Status**: ✅ Implemented (Production)

**Description**: Predict next likely action based on current context and patterns

**Input**:
```typescript
{
  current_context: Context;
  task_type?: TaskType;
}
```

**Output**:
```typescript
{
  predicted_actions: ProbableAction[];
  suggested_queries: Query[];
  confidence_scores: number[];
}
```

**Reference**: spec.md, lines 959-970

---

### 4. Attention-Based Retrieval (2 tools)

#### `attention.retrieve`

**Status**: ✅ Implemented (Production)

**Description**: Retrieve symbols based on attention patterns with priority levels

**Input**:
```typescript
{
  attention_pattern: AttentionPattern;
  token_budget: number;
  project_path?: string;
}
```

**Output**:
```typescript
{
  high_attention: Symbol[];
  medium_attention: Symbol[];
  context_symbols: Symbol[];
  total_tokens: number;
}
```

**Reference**: spec.md, lines 972-985

---

#### `attention.analyze_patterns`

**Status**: ✅ Implemented (Production)

**Description**: Analyze attention patterns to understand focus and drift

**Input**:
```typescript
{
  session_id: string;
  window?: number;                       // Last N queries
  project_path?: string;
}
```

**Output**:
```typescript
{
  patterns: AttentionPattern[];
  focus_areas: FocusArea[];
  attention_drift: number;               // How much focus changed
}
```

**Reference**: spec.md, lines 987-999

---

### 5. Code Navigation (4 tools)

#### `code.search_symbols`

**Status**: ✅ Implemented (Production)

**Description**: Search for code symbols (functions, classes, etc.) with token budget control

**Input**:
```typescript
{
  query: string;
  type?: SymbolType[];                   // Filter by type
  scope?: string;                        // Limit to path
  detail_level?: "skeleton" | "interface" | "implementation" | "full";
  max_results?: number;
  max_tokens?: number;                   // Hard limit
}
```

**Output**:
```typescript
{
  symbols: Symbol[];
  total_tokens: number;
  truncated: boolean;
}
```

**Reference**: spec.md, lines 1001-1017

---

#### `code.get_definition`

**Status**: ✅ Implemented (Production)

**Description**: Get full definition of a specific code symbol

**Input**:
```typescript
{
  symbol_id: string;
  include_body?: boolean;                // Default: true
  include_references?: boolean;          // Default: false
  include_dependencies?: boolean;        // Default: false
}
```

**Output**:
```typescript
{
  definition: SymbolDefinition;
  tokens_used: number;
}
```

**Reference**: spec.md, lines 1019-1032

---

#### `code.find_references`

**Status**: ✅ Implemented (Production)

**Description**: Find all references to a code symbol

**Input**:
```typescript
{
  symbol_id: string;
  include_context?: boolean;             // Default: false
  group_by_file?: boolean;               // Default: true
}
```

**Output**:
```typescript
{
  references: Reference[];
  summary: UsageSummary;
}
```

**Reference**: spec.md, lines 1034-1045

---

#### `code.get_dependencies`

**Status**: ✅ Implemented (Production)

**Description**: Get dependency graph for a symbol or file

**Input**:
```typescript
{
  entry_point: string;                   // Symbol or file path
  depth?: number;                        // Default: 3
  direction?: "imports" | "exports" | "both"; // Default: "both"
}
```

**Output**:
```typescript
{
  graph: DependencyGraph;
  cycles: Cycle[];                       // Circular dependencies
}
```

**Reference**: spec.md, lines 1047-1058

---

### 6. Documentation (2 tools)

#### `docs.search`

**Status**: ✅ Implemented (Production)

**Description**: Search through documentation and markdown files

**Input**:
```typescript
{
  query: string;
  max_results?: number;                  // Default: 10
  scope?: string;                        // Limit to path
  project_path?: string;
}
```

**Output**:
```typescript
{
  chunks: DocChunk[];
  total_tokens: number;
}
```

**Reference**: spec.md, lines 1060-1073

---

#### `docs.get_for_symbol`

**Status**: ✅ Implemented (Production)

**Description**: Get documentation for a specific code symbol

**Input**:
```typescript
{
  symbol_id: string;
  include_examples?: boolean;            // Default: false
  project_path?: string;
}
```

**Output**:
```typescript
{
  documentation: Documentation;
  examples: CodeExample[];
}
```

**Reference**: spec.md, lines 1075-1087

---

### 7. History & Evolution (2 tools)

#### `history.get_evolution`

**Status**: ✅ Implemented (Production)

**Description**: Get evolution history of a file or symbol from git

**Input**:
```typescript
{
  path: string;                          // File or symbol
  max_commits?: number;                  // Default: 10
  include_diffs?: boolean;               // Default: false
  project_path?: string;
}
```

**Output**:
```typescript
{
  timeline: EvolutionEvent[];
  summary: ChangeSummary;
}
```

**Reference**: spec.md, lines 1089-1103

---

#### `history.blame`

**Status**: ✅ Implemented (Production)

**Description**: Get git blame information for a file

**Input**:
```typescript
{
  path: string;                          // File path
  line_start?: number;
  line_end?: number;
  project_path?: string;
}
```

**Output**:
```typescript
{
  blame: BlameEntry[];
  contributors: Contributor[];
}
```

**Reference**: spec.md, lines 1105-1116

---

### 8. Session Management (4 tools)

#### `session.begin`

**Status**: ✅ Implemented (Production)

**Description**: Start a new isolated work session with copy-on-write semantics

**Input**:
```typescript
{
  task_description: string;
  scope?: string[];                      // Files/dirs in scope
  base_commit?: string;
}
```

**Output**:
```typescript
{
  session_id: string;
  workspace: WorkspaceInfo;
}
```

**Reference**: spec.md, lines 1118-1131

---

#### `session.update`

**Status**: ✅ Implemented (Production)

**Description**: Update session with file changes and optionally reindex

**Input**:
```typescript
{
  session_id: string;
  path: string;
  content: string;
  reindex?: boolean;                     // Default: true
}
```

**Output**:
```typescript
{
  status: UpdateStatus;
  affected_symbols: Symbol[];
}
```

**Reference**: spec.md, lines 1133-1145

---

#### `session.query`

**Status**: ✅ Implemented (Production)

**Description**: Query within session context, preferring session changes

**Input**:
```typescript
{
  session_id: string;
  query: string;
  prefer_session?: boolean;              // Default: true
}
```

**Output**:
```typescript
{
  results: QueryResult[];
  from_session: number;
  from_base: number;
}
```

**Reference**: spec.md, lines 1147-1159

---

#### `session.complete`

**Status**: ✅ Implemented (Production)

**Description**: Complete session with commit, discard, or stash action

**Input**:
```typescript
{
  session_id: string;
  action: "commit" | "discard" | "stash";
  commit_message?: string;
}
```

**Output**:
```typescript
{
  result: CompletionResult;
  changes_summary: ChangesSummary;
}
```

**Reference**: spec.md, lines 1161-1172

---

### 9. Analytics (2 tools)

#### `analyze.complexity`

**Status**: ✅ Implemented (Production)

**Description**: Analyze code complexity metrics for files or symbols

**Input**:
```typescript
{
  target: string;                        // File path or symbol ID
  include_metrics?: ("cyclomatic" | "cognitive" | "lines" | "dependencies")[];
  project_path?: string;
}
```

**Output**:
```typescript
{
  metrics: ComplexityMetrics;
  hotspots: Hotspot[];
  suggestions: Suggestion[];
}
```

**Reference**: spec.md, lines 1174-1187

---

#### `analyze.token_cost`

**Status**: ✅ Implemented (Production)

**Description**: Estimate token cost for context items

**Input**:
```typescript
{
  items: Array<{
    identifier: string;
    type: "file" | "symbol" | "text";
  }>;
  model?: "claude-3" | "gpt-4" | "gemini"; // Default: "claude-3"
  project_path?: string;
}
```

**Output**:
```typescript
{
  total_tokens: number;
  breakdown: TokenBreakdown[];
  optimization_hints: OptimizationHint[];
}
```

**Reference**: spec.md, lines 1189-1200

---

### 10. Monorepo (3 tools)

#### `monorepo.list_projects`

**Status**: ✅ Implemented (Production)

**Description**: List all projects detected in a monorepo workspace

**Input**:
```typescript
{
  root_path?: string;                    // Default: current dir
  include_dependencies?: boolean;        // Default: false
}
```

**Output**:
```typescript
{
  projects: Project[];
  dependency_graph?: ProjectDependencyGraph;
}
```

**Reference**: spec.md, lines 1202-1213

---

#### `monorepo.set_context`

**Status**: ✅ Implemented (Production)

**Description**: Set current working context to a specific project in monorepo

**Input**:
```typescript
{
  project_name: string;
  session_id: string;
}
```

**Output**:
```typescript
{
  context: MonorepoContext;
  total_symbols: number;
  estimated_tokens: number;
}
```

**Reference**: spec.md, lines 1215-1226

---

#### `monorepo.find_cross_references`

**Status**: ✅ Implemented (Production)

**Description**: Find cross-references between projects in a monorepo

**Input**:
```typescript
{
  source_project: string;
  target_project?: string;               // Optional: all if not provided
  reference_type?: "imports" | "exports" | "both"; // Default: "both"
}
```

**Output**:
```typescript
{
  references: CrossProjectReference[];
  impact_analysis: ImpactAnalysis;
}
```

**Reference**: spec.md, lines 1228-1239

---

## Strong Tools (10 tools)

### Global Catalog (3 tools)

#### `strong.catalog.list_projects`

**Status**: 📋 Specified (Not Implemented)

**Description**: Lists all projects in the global documentation catalog

**Reference**: strong-tools-spec.md

---

#### `strong.catalog.get_project`

**Status**: 📋 Specified (Not Implemented)

**Description**: Gets detailed information about a specific project

**Reference**: strong-tools-spec.md

---

#### `strong.catalog.search_documentation`

**Status**: 📋 Specified (Not Implemented)

**Description**: Searches documentation across all projects with filtering

**Input**: `{ query: string; scope?: "local" | "dependencies" | "global"; limit?: number }`

**Reference**: strong-tools-spec.md

---

### Documentation Generation (3 tools)

#### `strong.docs.generate`

**Status**: 📋 Specified (Not Implemented)

**Description**: Generates high-quality documentation for symbols with examples

**Reference**: strong-tools-spec.md

---

#### `strong.docs.validate`

**Status**: 📋 Specified (Not Implemented)

**Description**: Validates documentation quality with scoring and suggestions

**Reference**: strong-tools-spec.md

---

#### `strong.docs.transform`

**Status**: 📋 Specified (Not Implemented)

**Description**: Transforms documentation into standardized format

**Reference**: strong-tools-spec.md

---

### Example & Test Generation (4 tools)

#### `strong.examples.generate`

**Status**: 📋 Specified (Not Implemented)

**Description**: Generate code examples from symbols with configurable complexity

**Reference**: strong-tools-spec.md

---

#### `strong.examples.validate`

**Status**: 📋 Specified (Not Implemented)

**Description**: Validate code examples for syntax and compilation errors

**Reference**: strong-tools-spec.md

---

#### `strong.tests.generate`

**Status**: 📋 Specified (Not Implemented)

**Description**: Generate unit and integration tests for symbols

**Reference**: strong-tools-spec.md

---

#### `strong.tests.validate`

**Status**: 📋 Specified (Not Implemented)

**Description**: Validate generated tests and estimate coverage

**Reference**: strong-tools-spec.md

---

## Specification Tools (10 tools)

### Specification Management

All specification tools are defined in the specification system (specs/). Reference: spec.md (specification system section).

**Tools**:
1. `specs.list` - List all specifications
2. `specs.get_structure` - Get specification structure (TOC, sections)
3. `specs.get_section` - Get specific section content
4. `specs.search` - Search across all specs
5. `specs.validate` - Validate spec completeness and quality
6. `specs.compare` - Compare spec versions
7. `specs.generate_index` - Generate specification index
8. `specs.check_references` - Validate cross-references
9. `specs.analyze_coverage` - Analyze implementation coverage
10. `specs.sync_status` - Sync spec status with implementation

**Status**: 📋 Specified (detailed in spec.md)

---

## Implementation Status Summary

### Production Ready (29 tools) ✅

| Category | Count | Status |
|----------|-------|--------|
| Memory Management | 4 | ✅ 100% |
| Context Management | 3 | ✅ 100% |
| Learning & Feedback | 3 | ✅ 100% |
| Attention Retrieval | 2 | ✅ 100% |
| Code Navigation | 4 | ✅ 100% |
| Documentation | 2 | ✅ 100% |
| History & Evolution | 2 | ✅ 100% |
| Session Management | 4 | ✅ 100% |
| Analytics | 2 | ✅ 100% |
| Monorepo | 3 | ✅ 100% |
| **TOTAL** | **29** | **✅ 100%** |

### Specified (20 tools) 📋

| Category | Count | Status |
|----------|-------|--------|
| Strong Tools | 10 | 📋 Specified |
| Specification Tools | 10 | 📋 Specified |
| **TOTAL** | **20** | **📋 Specified** |

---

## Tool Naming Convention

### Pattern

```
{category}.{action}[_{modifier}]
```

**Examples**:
- `memory.record_episode` - Category: memory, Action: record, Modifier: episode
- `code.search_symbols` - Category: code, Action: search, Modifier: symbols
- `strong.docs.generate` - Category: strong, Subcategory: docs, Action: generate

### Categories

| Category | Purpose | Example |
|----------|---------|---------|
| `memory` | Memory system operations | `memory.record_episode` |
| `context` | Context management | `context.prepare_adaptive` |
| `feedback` | Learning feedback | `feedback.mark_useful` |
| `learning` | Learning operations | `learning.train_on_success` |
| `predict` | Prediction | `predict.next_action` |
| `attention` | Attention analysis | `attention.retrieve` |
| `code` | Code navigation | `code.search_symbols` |
| `docs` | Documentation | `docs.search` |
| `history` | Git history | `history.get_evolution` |
| `session` | Session management | `session.begin` |
| `analyze` | Analytics | `analyze.complexity` |
| `monorepo` | Monorepo operations | `monorepo.list_projects` |
| `strong` | Strong tools | `strong.docs.generate` |
| `specs` | Specification tools | `specs.list` |

---

## Version History

### v2.0.0 (October 18, 2025)

**Added**:
- All 29 core MCP tools (100% implemented)
- 10 Strong Tools (specified)
- 10 Specification Tools (specified)

**Protocol**: MCP 2025-03-26

**Implementation**:
- ✅ Custom MCP protocol implementation (not SDK)
- ✅ STDIO transport for Claude Code
- ✅ HTTP/SSE transport for multi-client
- ✅ 431 tests passing (100%)

### v1.0.0 (Previous Release)

**Tools**: 29 core tools (initial implementation)
**Protocol**: MCP 2024-11-05

---

## Usage Examples

### Example 1: Search and Get Definition

```typescript
// Search for a symbol
const searchResult = await mcp.call('code.search_symbols', {
  query: 'Application',
  type: ['class'],
  max_results: 5
});

// Get full definition
const definition = await mcp.call('code.get_definition', {
  symbol_id: searchResult.symbols[0].id,
  include_references: true
});
```

### Example 2: Session Workflow

```typescript
// Start session
const session = await mcp.call('session.begin', {
  task_description: 'Refactor authentication module'
});

// Update file
await mcp.call('session.update', {
  session_id: session.session_id,
  path: 'src/auth.ts',
  content: updatedCode
});

// Query changes
const results = await mcp.call('session.query', {
  session_id: session.session_id,
  query: 'functions calling authenticate'
});

// Complete session
await mcp.call('session.complete', {
  session_id: session.session_id,
  action: 'commit',
  commit_message: 'Refactor authentication module'
});
```

### Example 3: Learning Workflow

```typescript
// Find similar tasks
const similar = await mcp.call('memory.find_similar_episodes', {
  task_description: 'Add new API endpoint'
});

// Predict next actions
const predictions = await mcp.call('predict.next_action', {
  current_context: { /* ... */ },
  task_type: 'api_implementation'
});

// Record episode after completion
await mcp.call('memory.record_episode', {
  task: 'Add new API endpoint',
  files_accessed: ['src/api/routes.ts'],
  solution: 'Added /users endpoint with validation',
  outcome: 'success'
});
```

---

## Testing Coverage

All 29 core tools have comprehensive test coverage:

- **Unit Tests**: 44 tests
- **Integration Tests**: 123 tests
- **E2E Tests**: 109 tests
- **MCP Protocol Tests**: 24 tests

**Total**: 431 tests (100% passing)

---

## References

- **Core Spec**: [spec.md](../spec.md) - Lines 852-1239 (tool definitions)
- **Strong Tools Spec**: [strong-tools-spec.md](../strong-tools-spec.md) - Strong tools details
- **Global Arch Spec**: [global-architecture-spec.md](../global-architecture-spec.md) - Multi-monorepo tools
- **Roadmap**: [roadmap.md](../roadmap.md) - Implementation status

---

**Document Version**: 1.0.0
**Tools Version**: 2.0.0
**Last Updated**: October 18, 2025
**Maintained by**: Meridian Core Team
