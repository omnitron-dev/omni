# Semantic Links System - Executive Summary

**Version**: 1.0.0
**Date**: October 18, 2025
**Status**: Design Specification
**Full Spec**: [semantic-links-spec.md](./schemas/semantic-links-spec.md)

---

## Overview

The **Semantic Links System** creates a comprehensive, bidirectional knowledge graph connecting all five levels of Meridian's knowledge base:

```
┌─────────────────┐
│ Specifications  │  WHAT to build
│   (specs/)      │
└────────┬────────┘
         │ implemented_by / realizes
         ▼
┌─────────────────┐
│      Code       │  HOW it's built
│    (src/)       │
└────────┬────────┘
         │ documented_in / documents
         ▼
┌─────────────────┐
│ Documentation   │  HOW to use it
│    (docs/)      │
└────────┬────────┘
         │ demonstrated_in / demonstrates
         ▼
┌─────────────────┐
│    Examples     │  Usage patterns
│  (generated)    │
└────────┬────────┘
         │ illustrated_in / shows_example
         ▼
┌─────────────────┐
│      Tests      │  Verification
│   (tests/)      │
└─────────────────┘
```

---

## Key Features

### 1. Typed Semantic Links

**12 Primary Link Types**:
- `implemented_by` / `realizes` - Spec ↔ Code
- `documented_in` / `documents` - Code ↔ Docs
- `demonstrated_in` / `demonstrates` - Code ↔ Examples
- `tested_by` / `tests` - Code ↔ Tests
- `user_guide_for` / `specifies` - Spec ↔ Docs
- `shows_example` / `illustrated_in` - Docs ↔ Examples

**5 Secondary Link Types**:
- `depends_on`, `derived_from`, `relates_to`, `supersedes`, `referenced_by`

### 2. RocksDB Storage

**Efficient Multi-Index Storage**:
```
links:{linkId}                                  → SemanticLink (JSON)
links:forward:{sourceLevel}:{sourceId}          → linkId[]
links:reverse:{targetLevel}:{targetId}          → linkId[]
links:cross:{sourceLevel}:{targetLevel}         → linkId[]
links:validation:broken                         → linkId[]
links:entity:{level}:{entityId}                 → {outgoing, incoming}
links:type:{linkType}                           → linkId[]
```

### 3. Three Extraction Methods

1. **Annotation-Based** (Confidence: 0.9-1.0)
   - Explicit annotations in specs/code/docs
   - Highest priority and confidence

2. **Inference-Based** (Confidence: 0.5-0.8)
   - Import analysis
   - Naming conventions
   - Reference detection

3. **Manual** (Confidence: 1.0)
   - Created via MCP tools
   - Full control

### 4. Annotation Syntax

**Specifications (Markdown)**:
```markdown
<!-- @meridian:implemented_by code:Application -->
<!-- @meridian:documented_in docs:api.md#application -->
```

**Code (JSDoc/Rustdoc)**:
```typescript
/**
 * @meridian:realizes spec:spec.md#application-lifecycle
 * @meridian:documented_in docs:api.md#application-class
 * @meridian:tested_by test:application.spec.ts:lifecycle
 */
export class Application {
  // ...
}
```

**Documentation (Frontmatter)**:
```yaml
---
meridian:
  documents: code:Application
  shows_example:
    - example:Application:basic-usage
---
```

### 5. Twelve MCP Tools

**Link Discovery (4)**:
1. `links.find_implementation` - Find code implementing spec
2. `links.find_documentation` - Find docs for code
3. `links.find_examples` - Find usage examples
4. `links.find_tests` - Find verification tests

**Link Management (4)**:
5. `links.create` - Create new link
6. `links.update` - Update existing link
7. `links.delete` - Delete link
8. `links.validate` - Validate links

**Link Analysis (4)**:
9. `links.get_trace` - Trace full path spec→code→docs→examples→tests
10. `links.find_orphans` - Find unlinked entities
11. `links.search` - Search for links
12. `links.get_statistics` - Link health metrics

---

## Token Efficiency Benefits

### Average Token Reduction: ~92%

| Scenario | Without Links | With Links | Savings |
|----------|--------------|------------|---------|
| Find implementation | 5,000 tokens (full file) | 200 tokens (symbol) | 96% |
| Understand feature | 11,000 tokens (all docs) | 1,150 tokens (linked) | 89.5% |
| Debug test | 10,000 tokens (all tests) | 650 tokens (trace) | 93.5% |
| Review change | 8,000 tokens (affected) | 800 tokens (links) | 90% |
| Write new code | 15,000 tokens (examples) | 1,200 tokens (relevant) | 92% |

### How It Works

**Traditional Approach** (Finding implementation):
```typescript
// 1. Read entire spec file (1000 tokens)
const spec = await readFile("spec.md");

// 2. Manually search code (5000 tokens)
const code = await readFile("src/memory/system.rs");

// 3. Search docs (3000 tokens)
const docs = await readFile("docs/memory.md");

// Total: 9,000 tokens
```

**Semantic Links Approach**:
```typescript
// 1. Follow link directly to implementation
const impl = await tools["links.find_implementation"]({
  spec_id: "spec:spec.md#memory-model"
});
// Returns: code:MemorySystem (200 tokens)

// 2. Optionally expand to docs
const docs = await tools["links.find_documentation"]({
  symbol_id: impl.symbol_id
});
// Returns: relevant doc section (300 tokens)

// Total: 500 tokens (94.4% savings)
```

### Progressive Context Loading

```rust
/// Load context progressively following links
pub async fn load_progressive(
    start_id: &str,
    token_budget: usize,
) -> Result<LoadedContext> {
    // Level 1: Start entity (minimal)
    let start = self.load_minimal(start_id).await?;

    // Level 2: Direct links (summaries)
    let links = self.get_forward_links(start_id).await?;

    // Level 3: Expand high-priority links (full details)
    for link in links {
        if link.priority > 0.8 && within_budget() {
            load_full(&link.target.id).await?;
        }
    }
}
```

**Benefit**: Only load what's needed, when it's needed.

---

## Link Metadata

```typescript
interface SemanticLink {
  // Identity
  id: string;
  type: LinkType;

  // Endpoints
  source: {
    level: KnowledgeLevel;          // spec | code | docs | examples | tests
    id: string;
    location?: SourceLocation;
  };
  target: {
    level: KnowledgeLevel;
    id: string;
    location?: SourceLocation;
  };

  // Quality
  confidence: number;                // 0.0-1.0
  extraction_method: ExtractionMethod; // annotation | inference | manual
  context?: string;                  // Why this link exists

  // Lifecycle
  created_at: Date;
  created_by: string;
  last_validated?: Date;
  validation_status: "valid" | "broken" | "stale" | "unchecked";
}
```

---

## Example: Full Trace

```typescript
// Start from a spec section
const trace = await tools["links.get_trace"]({
  start_id: "spec:spec.md#memory-model",
  max_depth: 5
});

// Returns visualization:
// spec:spec.md#memory-model
//   ├─[implemented_by]→ code:MemorySystem (confidence: 1.0)
//   │  ├─[documented_in]→ docs:memory-system.md (confidence: 1.0)
//   │  ├─[tested_by]→ test:memory/system.spec.ts (confidence: 1.0)
//   │  │  └─[relates_to]→ spec:spec.md#memory-model (confidence: 0.9)
//   │  └─[demonstrated_in]→ example:MemorySystem:basic (confidence: 0.95)
//   │     └─[illustrated_in]→ docs:examples.md#memory (confidence: 0.9)
//   └─[user_guide_for]→ docs:user-guide.md#memory (confidence: 1.0)
//
// Summary:
// - Total hops: 7
// - Levels covered: [spec, code, docs, tests, examples]
// - Average confidence: 0.95
// - All links valid
```

---

## Use Cases

### 1. Spec → Implementation Tracing

**Question**: "What code implements the episodic memory spec?"

```typescript
const impl = await tools["links.find_implementation"]({
  spec_id: "spec:spec.md#episodic-memory",
  include_tests: true
});

// Returns:
// {
//   implementations: [
//     { symbol_id: "code:EpisodicMemory", confidence: 1.0 }
//   ],
//   tests: [
//     { test_id: "test:memory/episodic.spec.ts", confidence: 1.0 }
//   ]
// }
```

### 2. Code → Documentation

**Question**: "Where is the Application class documented?"

```typescript
const docs = await tools["links.find_documentation"]({
  symbol_id: "code:Application",
  include_examples: true
});

// Returns:
// {
//   documentation: [
//     {
//       doc_id: "docs:api.md#application-class",
//       title: "Application Class",
//       summary: "Main entry point for Titan applications"
//     }
//   ],
//   examples: [
//     {
//       example_id: "example:Application:basic-usage",
//       complexity: "basic",
//       description: "Creating and starting an application"
//     }
//   ]
// }
```

### 3. Finding Orphans

**Question**: "What code lacks documentation?"

```typescript
const orphans = await tools["links.find_orphans"]({
  level: "code",
  link_type: "documented_in",
  severity: "warning"
});

// Returns:
// {
//   orphans: [
//     {
//       entity_id: "code:InternalHelper",
//       missing_links: ["documented_in"],
//       severity: "warning",
//       suggestion: "Add documentation for public API"
//     }
//   ],
//   summary: {
//     total_orphans: 12,
//     by_level: { code: 12 }
//   }
// }
```

### 4. Impact Analysis

**Question**: "If I change this spec, what's affected?"

```typescript
// Get all implementations
const impl = await tools["links.find"]({
  source_id: "spec:spec.md#application-lifecycle",
  type: "implemented_by"
});

// For each implementation, find tests
const tests = await Promise.all(
  impl.map(i => tools["links.find_tests"]({
    symbol_id: i.target_id
  }))
);

// Returns full impact tree
```

---

## Validation & Health

### Link Validation

```typescript
const validation = await tools["links.validate"]({
  entity_id: "code:Application",
  fix_broken: false
});

// Returns:
// {
//   validated: 15,
//   valid: 12,
//   broken: 2,
//   stale: 1,
//   broken_links: [
//     {
//       link_id: "...",
//       reason: "Target file moved",
//       fix_suggestion: "Update to new location: docs/api/application.md"
//     }
//   ]
// }
```

### Health Metrics

```typescript
const stats = await tools["links.get_statistics"]({
  project_id: "@omnitron-dev/titan",
  include_health: true
});

// Returns:
// {
//   total_links: 342,
//   by_type: {
//     implemented_by: 87,
//     documented_in: 102,
//     tested_by: 95,
//     demonstrated_in: 58
//   },
//   health: {
//     average_confidence: 0.91,
//     broken_percentage: 1.2,
//     stale_percentage: 3.5,
//     coverage: {
//       code_with_docs: 0.87,      // 87% of code has docs
//       code_with_tests: 0.94,     // 94% of code has tests
//       specs_implemented: 0.92    // 92% of specs implemented
//     }
//   }
// }
```

---

## Implementation Phases

### Phase 1: Storage Layer (Week 1)

**Tasks**:
- Add link storage schema to RocksDB
- Implement `LinkManager` with CRUD operations
- Add indexing for forward/reverse/type lookups
- Implement link validation logic

**Deliverables**:
- `src/links/storage.rs`
- `src/links/manager.rs`
- `src/links/validator.rs`

### Phase 2: Extraction (Week 2)

**Tasks**:
- Implement annotation parsers (spec/code/docs)
- Build inference engine
- Create extraction pipeline
- Add deduplication logic

**Deliverables**:
- `src/links/extraction/annotation_parser.rs`
- `src/links/extraction/inference_engine.rs`
- `src/links/extraction/pipeline.rs`

### Phase 3: MCP Tools (Week 3)

**Tasks**:
- Implement all 12 MCP tools
- Add tool tests
- Integrate with MCP server
- Document tool usage

**Deliverables**:
- `src/mcp/handlers/links.rs`
- `tests/mcp/links_tools.rs`
- Updated MCP tools catalog

### Phase 4: Validation & Maintenance (Week 4)

**Tasks**:
- Implement background validation
- Add link health monitoring
- Create auto-fix for common issues
- Build link analytics

**Deliverables**:
- `src/links/validation/background.rs`
- `src/links/analytics.rs`
- Scheduled validation tasks

### Phase 5: UI & Visualization (Week 5)

**Tasks**:
- Add link visualization (ASCII/GraphViz)
- Create link explorer UI
- Build impact analysis tools
- Add link diff for changes

**Deliverables**:
- `src/links/visualization.rs`
- ASCII art link graphs
- Link change reports

---

## Success Metrics

### Coverage Targets

- **Code with Docs**: ≥ 80%
- **Code with Tests**: ≥ 90%
- **Specs Implemented**: ≥ 85%
- **Examples per Public API**: ≥ 1
- **Broken Links**: < 5%
- **Stale Links**: < 10%

### Performance Targets

- **Link Creation**: < 10ms
- **Link Lookup**: < 5ms
- **Trace Generation**: < 100ms (5 levels deep)
- **Validation**: < 50ms per link
- **Extraction**: < 100ms per file

### Quality Targets

- **Average Confidence**: ≥ 0.85
- **Annotation Coverage**: ≥ 60% (manual annotations)
- **Inference Accuracy**: ≥ 75% (validated inferences)
- **False Positive Rate**: < 10%

---

## Benefits Summary

### For LLMs

1. **Precise Context**: Load only relevant entities (92% token savings)
2. **Traceability**: Navigate from spec to implementation instantly
3. **Completeness**: Ensure all related artifacts are found
4. **Freshness**: Validation ensures links stay current

### For Developers

1. **Impact Analysis**: Know what's affected by changes
2. **Orphan Detection**: Find undocumented/untested code
3. **Cross-Referencing**: Navigate codebase semantically
4. **Quality Metrics**: Track documentation/test coverage

### For Teams

1. **Knowledge Graph**: Visual representation of codebase
2. **Onboarding**: New developers follow links to learn
3. **Maintenance**: Automated detection of missing docs/tests
4. **Consistency**: Ensure specs match implementation

---

## Next Steps

1. **Review Full Spec**: [semantic-links-spec.md](./schemas/semantic-links-spec.md)
2. **Check RocksDB Schema**: [rocksdb-schema.md](./schemas/rocksdb-schema.md)
3. **See MCP Tools**: [mcp-tools-catalog.md](./schemas/mcp-tools-catalog.md)
4. **Implementation**: Follow Phase 1-5 plan

---

## Related Documents

- **Full Specification**: [semantic-links-spec.md](./schemas/semantic-links-spec.md)
- **RocksDB Schema**: [rocksdb-schema.md](./schemas/rocksdb-schema.md)
- **MCP Tools Catalog**: [mcp-tools-catalog.md](./schemas/mcp-tools-catalog.md)
- **Type Definitions**: [type-definitions.md](./schemas/type-definitions.md)
- **Core Spec**: [spec.md](./spec.md)
- **INDEX**: [INDEX.md](./INDEX.md)

---

**Document Version**: 1.0.0
**Created**: October 18, 2025
**Status**: Executive Summary
**Maintained by**: Meridian Core Team
