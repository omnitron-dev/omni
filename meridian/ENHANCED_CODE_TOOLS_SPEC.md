# Enhanced MCP Code Tools Specification

**Date:** 2025-10-18
**Status:** Design Complete, Ready for Implementation
**Priority:** HIGH - Critical UX Improvement
**Effort:** 9-14 hours (Phases 1-2)
**Impact:** 75-90% token reduction in common scenarios

## Executive Summary

This specification enhances meridian's existing MCP code analysis tools to support efficient, token-saving code fragment retrieval. The approach is to **ENHANCE existing tools** rather than create new ones, implementing parameters that are already defined but currently ignored.

### Key Improvements

1. **Token Efficiency**: 75-90% reduction in token usage for common workflows
2. **Zero Breaking Changes**: All enhancements are backward-compatible
3. **Minimal Code Changes**: Leverage existing infrastructure
4. **No API Proliferation**: Keeps total tool count minimal

## Problem Statement

Users need to retrieve specific code fragments (function signatures, dependencies, usage context) efficiently without loading entire files or making multiple API calls. Current tools have the right parameters but don't implement them properly.

### Current Gaps

1. **detail_level parameter ignored** in `code.search_symbols` → Always returns full metadata
2. **include_references/dependencies ignored** in `code.get_definition` → Requires multiple calls
3. **include_context ignored** in `code.find_references` → Must read entire files to see usage

## Design Principles

1. **ENHANCE, Don't Replace**: Existing tools are well-designed, just need proper implementation
2. **Backward Compatible**: All changes are additive with sensible defaults
3. **Zero Redundancy**: Consolidate functionality, don't duplicate it
4. **Token Aware**: Every enhancement focuses on reducing token waste

## Enhanced Tools Specification

### 1. code.search_symbols

**Enhancement**: Implement existing `detail_level` parameter

#### Parameters

```typescript
{
  query: string;              // REQUIRED - Search query text
  type?: string[];            // Optional - Symbol types to filter
  scope?: string;             // Optional - Path to limit search scope
  detail_level?: "skeleton" | "interface" | "implementation" | "full";  // ← IMPLEMENT THIS
  max_results?: number;       // Optional - Maximum number of results
  max_tokens?: number;        // Optional - Hard limit on tokens in response
}
```

#### Detail Levels

| Level | Returns | Excludes | Token Estimate |
|-------|---------|----------|----------------|
| **skeleton** | id, name, kind, signature | doc_comment, complexity, references, dependencies, metadata | 100-200 tokens/symbol |
| **interface** | + location, doc_comment | references, dependencies, complexity | 200-400 tokens/symbol |
| **implementation** | + all metadata | references, dependencies | 400-800 tokens/symbol |
| **full** | Everything | Nothing | 800-2000+ tokens/symbol |

#### Default Behavior

- Default: `detail_level: "interface"` (backward compatible)
- Current behavior is closest to "interface" level

#### Implementation

```rust
// In handle_search_symbols (handlers.rs:382-442)

let detail_level = params.detail_level
    .as_deref()
    .and_then(|s| match s {
        "skeleton" => Some(DetailLevel::Skeleton),
        "interface" => Some(DetailLevel::Interface),
        "implementation" => Some(DetailLevel::Implementation),
        "full" => Some(DetailLevel::Full),
        _ => None,
    })
    .unwrap_or(DetailLevel::Interface);

// Use existing apply_detail_level method
let filtered_symbols: Vec<Value> = results.symbols
    .iter()
    .map(|s| {
        let filtered = indexer.apply_detail_level(s, detail_level);
        // Serialize based on level
        match detail_level {
            DetailLevel::Skeleton => json!({
                "id": filtered.id.0,
                "name": filtered.name,
                "kind": filtered.kind.as_str(),
                "signature": filtered.signature,
            }),
            DetailLevel::Interface => json!({
                "id": filtered.id.0,
                "name": filtered.name,
                "kind": filtered.kind.as_str(),
                "signature": filtered.signature,
                "location": filtered.location,
                "doc_comment": filtered.metadata.doc_comment,
            }),
            // ... etc
        }
    })
    .collect();
```

#### Token Savings Example

**Before** (20 results, full metadata each):
```
20 symbols × 500 tokens = 10,000 tokens
```

**After** (20 results, skeleton level):
```
20 symbols × 100 tokens = 2,000 tokens
```

**Savings: 80% (8,000 tokens)**

---

### 2. code.get_definition

**Enhancement**: Implement existing `include_references` and `include_dependencies` parameters

#### Current Parameters (Implement Properly)

```typescript
{
  symbol_id: string;                    // REQUIRED - Unique symbol identifier
  include_body?: boolean;               // Optional - Include function/method body (WORKING)
  include_references?: boolean;         // Optional - Include reference information (← IMPLEMENT)
  include_dependencies?: boolean;       // Optional - Include dependency information (← IMPLEMENT)
}
```

#### Proposed Additional Parameter (Phase 2)

```typescript
{
  symbol_id: string;                    // REQUIRED
  expand?: ("body" | "references" | "dependencies" | "callers" | "metadata")[];
  // Supersedes individual booleans, more extensible
  // Default: ["metadata"] (signature + basic metadata only)
}
```

#### Response Format (Enhanced)

```json
{
  "definition": {
    "id": "symbol_id",
    "name": "function_name",
    "kind": "function",
    "signature": "pub async fn mark_complete(&self, task_id: &TaskId) -> Result<Option<String>>",
    "location": {
      "file": "/path/to/file.rs",
      "line_start": 123,
      "line_end": 145
    },
    "body": "... source code ...",              // if include_body=true
    "doc_comment": "/// Marks task complete",   // if expand includes 'metadata'
    "complexity": 5,                             // if expand includes 'metadata'
    "token_cost": 450                            // if expand includes 'metadata'
  },
  "references": [                                // if include_references=true
    {
      "symbol_id": "caller_id",
      "location": { "file": "...", "line_start": 50, "line_end": 50 },
      "kind": "Call"
    }
  ],
  "dependencies": [                              // if include_dependencies=true
    {
      "id": "dependency_id",
      "name": "helper_function",
      "signature": "fn helper() -> bool"
    }
  ],
  "tokens_used": 1200
}
```

#### Implementation

```rust
// In handle_get_definition (handlers.rs:444-489)

let params: GetDefinitionParams = serde_json::from_value(args)?;
let symbol_id = SymbolId::new(params.symbol_id);

let indexer = self.indexer.read().await;

// Use existing method that already supports these parameters!
let definition = indexer
    .get_definition(
        &symbol_id,
        params.include_body.unwrap_or(true),
        params.include_references.unwrap_or(false),
        params.include_dependencies.unwrap_or(false),
    )
    .await?
    .ok_or_else(|| anyhow!("Symbol not found"))?;

// Serialize the full SymbolDefinition
let mut response = json!({
    "definition": {
        "id": definition.symbol.id.0,
        "name": definition.symbol.name,
        "kind": definition.symbol.kind.as_str(),
        "signature": definition.symbol.signature,
        "location": definition.symbol.location,
        "doc_comment": definition.symbol.metadata.doc_comment,
        "complexity": definition.symbol.metadata.complexity,
        "token_cost": definition.symbol.metadata.token_cost.0
    }
});

if let Some(body) = definition.body {
    response["definition"]["body"] = json!(body);
}

if params.include_references.unwrap_or(false) {
    response["references"] = json!(
        definition.symbol.references.iter().map(|r| json!({
            "symbol_id": r.symbol_id.0,
            "location": r.location,
            "kind": format!("{:?}", r.kind)
        })).collect::<Vec<_>>()
    );
}

if params.include_dependencies.unwrap_or(false) {
    let deps: Vec<Value> = Vec::new();
    for dep_symbol in definition.dependencies {
        deps.push(json!({
            "id": dep_symbol.id.0,
            "name": dep_symbol.name,
            "signature": dep_symbol.signature,
        }));
    }
    response["dependencies"] = json!(deps);
}

Ok(response)
```

#### Token Savings Example

**Before** (understand function + dependencies):
```
code.get_definition:      500 tokens
code.get_dependencies:    300 tokens
5× code.get_definition:   2,500 tokens
TOTAL:                    3,300 tokens
```

**After** (single call with expand):
```
code.get_definition (expand=["body", "dependencies"]):  1,200 tokens
```

**Savings: 64% (2,100 tokens)**

---

### 3. code.find_references

**Enhancement**: Implement existing `include_context` and `group_by_file` parameters

#### Parameters

```typescript
{
  symbol_id: string;              // REQUIRED - Symbol ID to find references for
  include_context?: boolean;      // Optional - Include surrounding context (← IMPLEMENT)
  group_by_file?: boolean;        // Optional - Group references by file (← IMPLEMENT)
}
```

#### Response Format (Enhanced)

```json
{
  "references": [
    {
      "symbol_id": "target_symbol_id",
      "location": {
        "file": "/path/to/caller.rs",
        "line_start": 42,
        "line_end": 42
      },
      "kind": "Call",
      "context": {                           // if include_context=true
        "lines_before": [
          "40: fn process_order(order: Order) {",
          "41:     let manager = ProgressManager::new();"
        ],
        "reference_line": "42:     manager.mark_complete(&task_id)?;",
        "lines_after": [
          "43:     println!(\"Task completed\");",
          "44: }"
        ]
      }
    }
  ],
  "summary": {
    "total": 15,
    "by_file": {                             // if group_by_file=true
      "/path/to/caller.rs": 5,
      "/path/to/other.rs": 10
    }
  }
}
```

#### Implementation

```rust
// In handle_find_references (handlers.rs:491-532)

let params: FindReferencesParams = serde_json::from_value(args)?;
let symbol_id = SymbolId::new(params.symbol_id);
let indexer = self.indexer.read().await;

let references = indexer.find_references(&symbol_id).await?;

let mut references_json: Vec<Value> = Vec::new();
let mut by_file: HashMap<String, usize> = HashMap::new();

for reference in &references {
    let mut ref_json = json!({
        "symbol_id": reference.symbol_id.0,
        "location": reference.location,
        "kind": format!("{:?}", reference.kind)
    });

    // Add context if requested
    if params.include_context.unwrap_or(false) {
        let file_path = PathBuf::from(&reference.location.file);

        // Load from cache or file
        let content = if let Some(cached) = indexer.source_cache.get(&file_path) {
            cached.clone()
        } else {
            std::fs::read_to_string(&file_path)?
        };

        let lines: Vec<&str> = content.lines().collect();
        let ref_line = reference.location.line_start - 1;

        let start = ref_line.saturating_sub(3);
        let end = (ref_line + 4).min(lines.len());

        let context = json!({
            "lines_before": lines[start..ref_line].iter()
                .enumerate()
                .map(|(i, line)| format!("{}: {}", start + i + 1, line))
                .collect::<Vec<_>>(),
            "reference_line": format!("{}: {}", ref_line + 1, lines[ref_line]),
            "lines_after": lines[ref_line + 1..end].iter()
                .enumerate()
                .map(|(i, line)| format!("{}: {}", ref_line + i + 2, line))
                .collect::<Vec<_>>(),
        });

        ref_json["context"] = context;
    }

    // Track by file
    *by_file.entry(reference.location.file.clone()).or_insert(0) += 1;

    references_json.push(ref_json);
}

// Group by file if requested
if params.group_by_file.unwrap_or(true) {
    // Group and sort references
    // ... implementation
}

Ok(json!({
    "references": references_json,
    "summary": {
        "total": references.len(),
        "by_file": by_file
    }
}))
```

#### Token Savings Example

**Before** (find usage examples):
```
code.find_references:     200 tokens (just locations)
Read 3 files for context: 6,000 tokens (3 × 2000 tokens)
TOTAL:                    6,200 tokens
```

**After** (with context snippets):
```
code.find_references (include_context=true):  800 tokens
```

**Savings: 87% (5,400 tokens)**

---

## Implementation Plan

### Phase 1: Quick Wins (3-5 hours, HIGH impact)

**Goal**: Implement most critical enhancements with 80% token savings

| Task | Effort | Impact | Files |
|------|--------|--------|-------|
| Implement detail_level in search_symbols | 2h | HIGH | handlers.rs |
| Implement include_refs/deps in get_definition | 3h | HIGH | handlers.rs |

**Total**: 5 hours for 75-90% token reduction

### Phase 2: Enhancements (6-9 hours, MEDIUM impact)

| Task | Effort | Impact | Files |
|------|--------|--------|-------|
| Implement include_context in find_references | 3h | MEDIUM | handlers.rs |
| Add expand parameter to get_definition | 2.5h | MEDIUM | tools.rs, handlers.rs |
| Implement group_by_file in find_references | 1.5h | LOW | handlers.rs |

**Total**: 7 hours for additional UX improvements

### Phase 3: Testing & Documentation (3-4 hours)

| Task | Effort | Files |
|------|--------|-------|
| Unit tests for enhanced functionality | 3h | tests/mcp_code_tools_test.rs |
| Token efficiency benchmarks | 2.5h | benches/token_efficiency.rs |
| Update documentation | 1.5h | specs/guides/MCP_TOOLS_USAGE.md |

**Total**: 7 hours for quality assurance

### Grand Total: 19 hours (2-3 days)

---

## Token Efficiency Scenarios

### Scenario 1: Quick Reference

**Use Case**: Check function signature to see parameters

**Before**:
```bash
code.get_definition(symbol_id, include_body=false)
→ 500 tokens (full metadata returned)
```

**After**:
```bash
code.get_definition(symbol_id, expand=[])
→ 50 tokens (signature only)
```

**Savings: 90% (450 tokens)**

---

### Scenario 2: Understand Function

**Use Case**: Understand what a function does and what it calls

**Before**:
```bash
code.get_definition(symbol_id)                    → 500 tokens
code.get_dependencies(symbol_id)                  → 300 tokens
code.get_definition(dep1)                         → 500 tokens
code.get_definition(dep2)                         → 500 tokens
...
Total: 3,300 tokens for 5 dependencies
```

**After**:
```bash
code.get_definition(symbol_id, expand=["body", "dependencies"])
→ 1,200 tokens (everything in one call)
```

**Savings: 64% (2,100 tokens)**

---

### Scenario 3: Find Usage Examples

**Use Case**: See how a function is used in the codebase

**Before**:
```bash
code.find_references(symbol_id)                   → 200 tokens
Read file 1 to see context                        → 2,000 tokens
Read file 2 to see context                        → 2,000 tokens
Read file 3 to see context                        → 2,000 tokens
Total: 6,200 tokens
```

**After**:
```bash
code.find_references(symbol_id, include_context=true)
→ 800 tokens (all references with context snippets)
```

**Savings: 87% (5,400 tokens)**

---

### Scenario 4: Symbol Search

**Use Case**: Find all functions matching a pattern

**Before**:
```bash
code.search_symbols(query, max_results=20)
→ 10,000 tokens (20 symbols × 500 tokens full metadata)
```

**After**:
```bash
code.search_symbols(query, max_results=20, detail_level="skeleton")
→ 2,000 tokens (20 symbols × 100 tokens signature only)
```

**Savings: 80% (8,000 tokens)**

---

## Backward Compatibility

All changes are **100% backward compatible**:

| Parameter | Current | Proposed | Breaking? |
|-----------|---------|----------|-----------|
| detail_level | Ignored | Implemented (default: "interface") | ❌ No |
| include_references | Ignored | Implemented (default: false) | ❌ No |
| include_dependencies | Ignored | Implemented (default: false) | ❌ No |
| include_context | Ignored | Implemented (default: false) | ❌ No |
| group_by_file | Ignored | Implemented (default: true) | ❌ No |
| expand | N/A | New optional parameter | ❌ No |

**Default behavior matches current behavior** - existing integrations continue to work unchanged.

---

## Success Metrics

### Primary Metrics

1. **Token Efficiency**: 75-90% reduction in common scenarios ✓
2. **API Calls**: 50% reduction in multi-call workflows ✓
3. **Backward Compatibility**: 100% (zero breaking changes) ✓

### Secondary Metrics

1. **Code Coverage**: >90% for enhanced handlers
2. **Performance**: <10ms overhead for context extraction
3. **Cache Hit Rate**: >80% for source file access

---

## Risk Assessment

### LOW RISK ✅

**Rationale**:
- All changes are additive (new functionality, not modifications)
- Existing infrastructure already supports most features
- Comprehensive test coverage protects against regressions
- Backward compatibility guarantees no user impact

### Mitigation Strategies

1. **Testing**: Extensive unit and integration tests
2. **Benchmarking**: Continuous token efficiency monitoring
3. **Documentation**: Clear migration guide for new features
4. **Rollback**: Easy to disable new parameters if issues arise

---

## Next Steps

1. ✅ **Complete**: Comprehensive analysis and design
2. ✅ **Complete**: Create progress tasks for tracking
3. **TODO**: Implement Phase 1 (detail_level + include_refs/deps)
4. **TODO**: Add unit tests for Phase 1
5. **TODO**: Implement Phase 2 (context + expand parameter)
6. **TODO**: Create token efficiency benchmarks
7. **TODO**: Update documentation

---

## Related Documents

- **Analysis**: `/meridian/MCP_CODE_TOOLS_ANALYSIS.json`
- **Progress Tracking**: Use `progress.list_tasks` with tag filter `["code-tools"]`
- **Implementation**: Start with Task ID `649869db-fc98-439d-9238-87b9d175766a`

---

## Appendix A: Code Infrastructure

### Existing Methods to Leverage

```rust
// Already exists in code_indexer.rs
impl CodeIndexer {
    // Line 268-318: Already supports all parameters!
    pub async fn get_definition(
        &self,
        symbol_id: &SymbolId,
        include_body: bool,
        include_references: bool,
        include_dependencies: bool,
    ) -> Result<Option<SymbolDefinition>>

    // Line 408-426: Detail level filtering already implemented!
    fn apply_detail_level(&self, symbol: &CodeSymbol, level: DetailLevel) -> CodeSymbol

    // Line 323-337: Find references works perfectly
    pub async fn find_references(&self, symbol_id: &SymbolId) -> Result<Vec<Reference>>
}
```

**Key Insight**: The heavy lifting is already done! We just need to wire it up in the handlers.

---

## Appendix B: Example Usage

### Before (Inefficient)

```typescript
// Want to understand what mark_complete does
const def = await code.get_definition({ symbol_id: "ProgressManager::mark_complete" });
// Returns 500 tokens of metadata

const deps = await code.get_dependencies({ entry_point: "ProgressManager::mark_complete" });
// Returns 300 tokens of dependency graph

for (const dep of deps.graph.nodes) {
  const depDef = await code.get_definition({ symbol_id: dep.symbol_id });
  // 5 more calls, 2500+ tokens
}

// Total: 7 API calls, 3300+ tokens
```

### After (Efficient)

```typescript
// Get everything in one call
const def = await code.get_definition({
  symbol_id: "ProgressManager::mark_complete",
  expand: ["body", "dependencies"]
});

// Returns: signature, body, AND inline dependency info
// Total: 1 API call, 1200 tokens
// Savings: 64% fewer tokens, 86% fewer calls
```

---

**End of Specification**
