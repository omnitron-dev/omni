# Semantic Links Specification

**Version**: 1.0.0
**Created**: October 18, 2025
**Status**: Design Specification
**Related**: [RocksDB Schema](./rocksdb-schema.md), [MCP Tools Catalog](./mcp-tools-catalog.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Link Types](#link-types)
3. [RocksDB Storage Schema](#rocksdb-storage-schema)
4. [Link Extraction](#link-extraction)
5. [Annotation Syntax](#annotation-syntax)
6. [MCP Tools](#mcp-tools)
7. [Token Efficiency](#token-efficiency)
8. [Implementation Guide](#implementation-guide)

---

## Overview

### Concept

The **Semantic Links System** creates bidirectional, typed connections between Meridian's five knowledge levels:

1. **Specifications** (`specs/`) - WHAT to build
2. **Code** (`src/`) - HOW it's built (implementation with structure)
3. **Documentation** (`docs/`) - HOW to use it
4. **Examples** (generated) - Concrete usage patterns
5. **Tests** (`tests/`) - Verification and validation

### Goals

- **Traceability**: Navigate from spec → code → docs → examples → tests
- **Consistency**: Ensure all levels remain synchronized
- **Discovery**: Find related artifacts across knowledge levels
- **Validation**: Detect broken links and orphaned entities
- **Token Efficiency**: Reduce context by following specific link paths

### Key Principles

1. **Bidirectional**: Every link has a reverse link
2. **Typed**: Links have semantic meaning (not just references)
3. **Versioned**: Links track when they were created/validated
4. **Confidence-Scored**: Links have confidence levels (auto-extracted vs manual)
5. **Context-Aware**: Links carry metadata about their purpose

---

## Link Types

### Primary Link Types

| Link Type | Direction | Description | Example |
|-----------|-----------|-------------|---------|
| `implemented_by` | Spec → Code | Code that implements a spec section | Spec section → Symbol |
| `realizes` | Code → Spec | Spec that describes this code | Symbol → Spec section |
| `documented_in` | Code → Docs | Documentation for code | Symbol → Doc chunk |
| `documents` | Docs → Code | Code documented by this | Doc chunk → Symbol |
| `demonstrated_in` | Code → Examples | Examples showing usage | Symbol → Example |
| `demonstrates` | Examples → Code | Code being demonstrated | Example → Symbol |
| `tested_by` | Code → Tests | Tests verifying code | Symbol → Test |
| `tests` | Tests → Code | Code being tested | Test → Symbol |
| `user_guide_for` | Spec → Docs | User docs for spec | Spec → Doc |
| `specifies` | Docs → Spec | Spec documented | Doc → Spec |
| `shows_example` | Docs → Examples | Examples in docs | Doc → Example |
| `illustrated_in` | Examples → Docs | Docs with example | Example → Doc |

### Secondary Link Types

| Link Type | Direction | Description |
|-----------|-----------|-------------|
| `depends_on` | Any → Any | Dependency relationship |
| `derived_from` | Any → Any | Evolution relationship |
| `relates_to` | Any → Any | Generic semantic relation |
| `supersedes` | Any → Any | Replacement relationship |
| `referenced_by` | Any → Any | Citation/mention |

### Link Metadata

```typescript
interface SemanticLink {
  // Identity
  id: string;                           // Unique link ID
  type: LinkType;                       // Link semantic type

  // Endpoints
  source: {
    level: KnowledgeLevel;              // spec | code | docs | examples | tests
    id: string;                         // Entity ID
    location?: SourceLocation;          // Specific location (optional)
  };
  target: {
    level: KnowledgeLevel;
    id: string;
    location?: SourceLocation;
  };

  // Metadata
  confidence: number;                   // 0.0-1.0 (auto-extracted vs manual)
  extractionMethod: ExtractionMethod;   // annotation | inference | manual
  context?: string;                     // Why this link exists

  // Lifecycle
  createdAt: Date;
  createdBy: string;                    // "meridian-auto" | "user:{name}"
  lastValidated?: Date;
  validationStatus: "valid" | "broken" | "stale" | "unchecked";

  // Provenance
  evidence?: string;                    // Supporting evidence for the link
  confidence_reason?: string;           // Why confidence score is what it is
}

type LinkType =
  | "implemented_by" | "realizes"
  | "documented_in" | "documents"
  | "demonstrated_in" | "demonstrates"
  | "tested_by" | "tests"
  | "user_guide_for" | "specifies"
  | "shows_example" | "illustrated_in"
  | "depends_on" | "derived_from"
  | "relates_to" | "supersedes"
  | "referenced_by";

type KnowledgeLevel = "spec" | "code" | "docs" | "examples" | "tests";

type ExtractionMethod = "annotation" | "inference" | "manual";
```

---

## RocksDB Storage Schema

### Link Storage Keys

```
# Primary Links (by link ID)
links:{linkId}                                  → SemanticLink (JSON)

# Forward Links (from source)
links:forward:{sourceLevel}:{sourceId}          → linkId[]
links:forward:type:{linkType}:{sourceLevel}:{sourceId} → linkId[]

# Reverse Links (to target)
links:reverse:{targetLevel}:{targetId}          → linkId[]
links:reverse:type:{linkType}:{targetLevel}:{targetId} → linkId[]

# Cross-Level Links (level-to-level mapping)
links:cross:{sourceLevel}:{targetLevel}         → linkId[]

# Validation Index
links:validation:broken                         → linkId[]
links:validation:stale:{days}                   → linkId[]
links:validation:unchecked                      → linkId[]

# Entity Index (all links for an entity)
links:entity:{level}:{entityId}                 → {
  outgoing: linkId[],
  incoming: linkId[]
}

# Type Index (all links of a type)
links:type:{linkType}                           → linkId[]

# Metadata
links:meta:statistics                           → LinkStatistics (JSON)
links:meta:last_validation                      → timestamp
```

### Key Examples

```
# Link storage
links:550e8400-e29b-41d4-a716-446655440000      → {...}

# Forward links from code symbol "Application"
links:forward:code:Application                  → [linkId1, linkId2, ...]
links:forward:type:tested_by:code:Application   → [linkId1, linkId2]

# Reverse links to test "application.spec.ts"
links:reverse:tests:application.spec.ts         → [linkId1, linkId2, ...]

# All code → tests links
links:cross:code:tests                          → [linkId1, linkId2, ...]

# Broken links
links:validation:broken                         → [linkId1, linkId2]

# All links for spec section "memory-model"
links:entity:spec:memory-model                  → {
  outgoing: [linkId1, linkId2],
  incoming: [linkId3]
}

# All "implemented_by" links
links:type:implemented_by                       → [linkId1, linkId2, ...]
```

### Entity ID Format

**Specifications**: `spec:{file}#{section}`
- Example: `spec:spec.md#model-memory`

**Code**: `code:{projectId}:{symbolId}`
- Example: `code:@omnitron-dev/titan@1.0.0:Application`

**Documentation**: `docs:{file}#{section}`
- Example: `docs:api.md#application-class`

**Examples**: `example:{symbolId}:{exampleId}`
- Example: `example:Application:basic-usage`

**Tests**: `test:{file}:{testName}`
- Example: `test:application.spec.ts:creates_application`

---

## Link Extraction

### Extraction Methods

#### 1. Annotation-Based (Primary)

**Priority**: Highest confidence (0.9-1.0)

Links are explicitly marked in:
- Specification annotations
- Code comments
- Documentation frontmatter

#### 2. Inference-Based (Secondary)

**Priority**: Medium confidence (0.5-0.8)

Links are inferred from:
- Import statements
- Test file naming conventions
- Documentation cross-references
- Symbol mentions in docs

#### 3. Manual (Explicit)

**Priority**: Highest confidence (1.0)

Links manually created via MCP tools.

### Extraction Pipeline

```rust
/// Link extraction pipeline
pub struct LinkExtractor {
    annotation_parser: AnnotationParser,
    inference_engine: InferenceEngine,
    storage: Arc<RwLock<GlobalStorage>>,
}

impl LinkExtractor {
    /// Extract all links from a file
    pub async fn extract_from_file(&self, path: &Path) -> Result<Vec<SemanticLink>> {
        let mut links = Vec::new();

        // 1. Parse annotations
        let annotated = self.annotation_parser.parse(path).await?;
        links.extend(annotated);

        // 2. Infer links
        let inferred = self.inference_engine.infer(path).await?;
        links.extend(inferred);

        // 3. Deduplicate
        let unique = self.deduplicate(links);

        // 4. Validate
        let validated = self.validate(unique).await?;

        Ok(validated)
    }

    /// Deduplicate links (prefer annotation over inference)
    fn deduplicate(&self, links: Vec<SemanticLink>) -> Vec<SemanticLink> {
        let mut seen = HashMap::new();

        for link in links {
            let key = (link.source.id.clone(), link.target.id.clone(), link.type);

            if let Some(existing) = seen.get(&key) {
                // Prefer higher confidence
                if link.confidence > existing.confidence {
                    seen.insert(key, link);
                }
            } else {
                seen.insert(key, link);
            }
        }

        seen.into_values().collect()
    }
}
```

### Annotation Parser

```rust
/// Parse semantic link annotations
pub struct AnnotationParser {
    spec_parser: SpecAnnotationParser,
    code_parser: CodeAnnotationParser,
    docs_parser: DocsAnnotationParser,
}

impl AnnotationParser {
    pub async fn parse(&self, path: &Path) -> Result<Vec<SemanticLink>> {
        match self.detect_type(path) {
            FileType::Specification => self.spec_parser.parse(path).await,
            FileType::Code => self.code_parser.parse(path).await,
            FileType::Documentation => self.docs_parser.parse(path).await,
            FileType::Test => self.code_parser.parse(path).await,
            _ => Ok(vec![]),
        }
    }
}
```

### Inference Engine

```rust
/// Infer semantic links from code structure
pub struct InferenceEngine {
    import_analyzer: ImportAnalyzer,
    naming_analyzer: NamingAnalyzer,
    reference_finder: ReferenceFinder,
}

impl InferenceEngine {
    pub async fn infer(&self, path: &Path) -> Result<Vec<SemanticLink>> {
        let mut links = Vec::new();

        // Infer from imports
        links.extend(self.import_analyzer.analyze(path).await?);

        // Infer from naming conventions
        links.extend(self.naming_analyzer.analyze(path).await?);

        // Infer from references
        links.extend(self.reference_finder.find(path).await?);

        Ok(links)
    }
}

/// Analyze imports to create links
pub struct ImportAnalyzer;

impl ImportAnalyzer {
    pub async fn analyze(&self, path: &Path) -> Result<Vec<SemanticLink>> {
        // Example: import { Application } from '@omnitron-dev/titan'
        // Creates: code:test:symbol → depends_on → code:@omnitron-dev/titan:Application
        todo!()
    }
}

/// Analyze naming conventions
pub struct NamingAnalyzer;

impl NamingAnalyzer {
    pub async fn analyze(&self, path: &Path) -> Result<Vec<SemanticLink>> {
        // Example: application.spec.ts → tests → Application class
        // Creates: test:application.spec.ts:* → tests → code:Application

        if path.ends_with(".spec.ts") || path.ends_with(".test.ts") {
            let stem = path.file_stem().unwrap().to_str().unwrap();
            let class_name = self.to_class_name(stem);

            // Create link to code
            // ...
        }

        Ok(vec![])
    }
}
```

---

## Annotation Syntax

### Specification Annotations (Markdown)

```markdown
# Memory Model

<!-- @meridian:implemented_by code:@omnitron-dev/meridian:MemorySystem -->
<!-- @meridian:documented_in docs:api.md#memory-system -->

The four-level memory model consists of:
- Episodic Memory
- Working Memory
- Semantic Memory
- Procedural Memory

## Episodic Memory

<!-- @meridian:implemented_by code:@omnitron-dev/meridian:EpisodicMemory -->
<!-- @meridian:tested_by test:memory/episodic.spec.ts:episodic_memory -->

Description of episodic memory...
```

**Syntax**:
```
<!-- @meridian:{link_type} {target_entity_id} [confidence={0.0-1.0}] [context="..."] -->
```

**Examples**:
```markdown
<!-- @meridian:implemented_by code:Application -->
<!-- @meridian:implemented_by code:Application confidence=1.0 -->
<!-- @meridian:documented_in docs:api.md#application context="Main application class" -->
```

### Code Annotations (Comments)

**TypeScript/JavaScript**:
```typescript
/**
 * Application class manages the lifecycle of Titan modules.
 *
 * @meridian:realizes spec:spec.md#application-lifecycle
 * @meridian:documented_in docs:api.md#application-class
 * @meridian:tested_by test:application.spec.ts:application_lifecycle
 */
export class Application {
  /**
   * Creates a new application instance.
   *
   * @meridian:demonstrated_in example:Application:basic-usage
   * @meridian:demonstrated_in example:Application:advanced-usage
   */
  static async create(rootModule: IModule): Promise<Application> {
    // ...
  }
}
```

**Rust**:
```rust
/// Memory system implementing the four-level cognitive model.
///
/// @meridian:realizes spec:spec.md#model-memory
/// @meridian:documented_in docs:memory-system.md
/// @meridian:tested_by test:memory/system.rs:memory_system_tests
pub struct MemorySystem {
    /// @meridian:implements spec:spec.md#episodic-memory
    episodic: EpisodicMemory,

    /// @meridian:implements spec:spec.md#working-memory
    working: WorkingMemory,
}
```

**Python**:
```python
class PredictionModel:
    """
    ML model for predicting next actions.

    @meridian:realizes spec:spec.md#prediction-system
    @meridian:documented_in docs:ml-models.md#prediction
    @meridian:tested_by test:test_prediction.py:TestPredictionModel
    """

    def predict(self, context):
        """
        Predict next action based on context.

        @meridian:demonstrated_in example:PredictionModel:basic-prediction
        """
        pass
```

### Documentation Annotations (Frontmatter)

**Markdown Frontmatter**:
```markdown
---
title: Application API
meridian:
  documents: code:@omnitron-dev/titan:Application
  specifies: spec:spec.md#application-class
  shows_example:
    - example:Application:basic-usage
    - example:Application:advanced-usage
---

# Application Class

The `Application` class is the main entry point...
```

**Inline Annotations**:
```markdown
## Creating an Application

<!-- @meridian:demonstrates code:Application.create -->

To create a new application:

```typescript
const app = await Application.create(RootModule);
```
<!-- @meridian:end -->

**JSON Sidecar** (optional):
```json
// api.md.links.json
{
  "file": "api.md",
  "links": [
    {
      "section": "#application-class",
      "documents": "code:@omnitron-dev/titan:Application",
      "confidence": 1.0
    }
  ]
}
```

### Test Annotations

**Test File**:
```typescript
/**
 * @meridian:tests code:@omnitron-dev/titan:Application
 */
describe('Application', () => {
  /**
   * @meridian:tests code:Application.create
   */
  it('creates application instance', async () => {
    // ...
  });

  /**
   * @meridian:tests code:Application.start
   * @meridian:relates_to spec:spec.md#application-lifecycle
   */
  it('starts application and modules', async () => {
    // ...
  });
});
```

### Example Annotations

**Example Metadata**:
```typescript
// examples/basic-usage.ts
/**
 * @meridian:demonstrates code:Application.create
 * @meridian:demonstrates code:Application.start
 * @meridian:illustrated_in docs:getting-started.md#basic-example
 */

import { Application } from '@omnitron-dev/titan';

// Example code...
```

---

## MCP Tools

### Tool 1: `links.find_implementation`

**Purpose**: Find code implementing a specification section

**Input**:
```typescript
{
  spec_id: string;              // e.g., "spec:spec.md#memory-model"
  include_tests?: boolean;      // Include links to tests (default: false)
  max_depth?: number;           // Follow links recursively (default: 1)
}
```

**Output**:
```typescript
{
  implementations: {
    symbol_id: string;
    location: SourceLocation;
    confidence: number;
    link_id: string;
  }[];
  tests?: {
    test_id: string;
    test_name: string;
    link_id: string;
  }[];
  trace?: LinkTrace[];          // If max_depth > 1
}
```

**Example**:
```typescript
// Find what implements the memory model spec
const result = await tools["links.find_implementation"]({
  spec_id: "spec:spec.md#memory-model",
  include_tests: true,
  max_depth: 2
});

// Returns:
// {
//   implementations: [
//     {
//       symbol_id: "code:@omnitron-dev/meridian:MemorySystem",
//       location: { file: "src/memory/system.rs", line: 42 },
//       confidence: 1.0,
//       link_id: "..."
//     }
//   ],
//   tests: [
//     {
//       test_id: "test:memory/system.spec.ts:memory_system",
//       test_name: "MemorySystem manages all memory types",
//       link_id: "..."
//     }
//   ]
// }
```

---

### Tool 2: `links.find_documentation`

**Purpose**: Find documentation for a code symbol

**Input**:
```typescript
{
  symbol_id: string;            // e.g., "code:Application"
  include_examples?: boolean;   // Include example links (default: true)
  format?: "markdown" | "json"; // Output format (default: "markdown")
}
```

**Output**:
```typescript
{
  documentation: {
    doc_id: string;
    title: string;
    summary: string;
    link_id: string;
    confidence: number;
  }[];
  examples?: {
    example_id: string;
    complexity: "basic" | "intermediate" | "advanced";
    description: string;
    link_id: string;
  }[];
  content?: string;             // If format=markdown
}
```

---

### Tool 3: `links.find_examples`

**Purpose**: Find examples demonstrating a feature

**Input**:
```typescript
{
  entity_id: string;            // Any entity ID
  complexity?: "basic" | "intermediate" | "advanced" | "all";
  language?: string;            // Filter by language
  max_results?: number;         // Limit results (default: 10)
}
```

**Output**:
```typescript
{
  examples: {
    example_id: string;
    code: string;
    language: string;
    complexity: string;
    description: string;
    confidence: number;
    link_id: string;
  }[];
  related_docs?: {
    doc_id: string;
    section: string;
  }[];
}
```

---

### Tool 4: `links.find_tests`

**Purpose**: Find tests verifying code

**Input**:
```typescript
{
  symbol_id: string;            // Code symbol ID
  test_type?: "unit" | "integration" | "e2e" | "all";
  include_coverage?: boolean;   // Include coverage data (default: false)
}
```

**Output**:
```typescript
{
  tests: {
    test_id: string;
    test_name: string;
    test_type: string;
    file: string;
    confidence: number;
    link_id: string;
  }[];
  coverage?: {
    line_coverage: number;
    branch_coverage: number;
    tested_methods: string[];
  };
}
```

---

### Tool 5: `links.create`

**Purpose**: Create a new semantic link

**Input**:
```typescript
{
  type: LinkType;
  source: {
    level: KnowledgeLevel;
    id: string;
    location?: SourceLocation;
  };
  target: {
    level: KnowledgeLevel;
    id: string;
    location?: SourceLocation;
  };
  confidence?: number;          // 0.0-1.0 (default: 1.0)
  context?: string;             // Why this link exists
  bidirectional?: boolean;      // Create reverse link (default: true)
}
```

**Output**:
```typescript
{
  link_id: string;
  reverse_link_id?: string;     // If bidirectional=true
  created_at: Date;
  validation_status: "valid";
}
```

---

### Tool 6: `links.validate`

**Purpose**: Validate links are not broken

**Input**:
```typescript
{
  link_ids?: string[];          // Specific links (or all if empty)
  entity_id?: string;           // Validate all links for entity
  level?: KnowledgeLevel;       // Validate all links at level
  fix_broken?: boolean;         // Attempt to fix broken links (default: false)
}
```

**Output**:
```typescript
{
  validated: number;
  valid: number;
  broken: number;
  stale: number;
  broken_links: {
    link_id: string;
    reason: string;
    fix_suggestion?: string;
  }[];
  stale_links: {
    link_id: string;
    days_since_validation: number;
  }[];
  fixed?: number;               // If fix_broken=true
}
```

---

### Tool 7: `links.get_trace`

**Purpose**: Trace spec → code → docs → examples → tests

**Input**:
```typescript
{
  start_id: string;             // Starting entity ID
  trace_path?: LinkType[];      // Specific path (or auto if empty)
  max_depth?: number;           // Maximum depth (default: 5)
  include_metadata?: boolean;   // Include full metadata (default: false)
}
```

**Output**:
```typescript
{
  trace: {
    level: number;              // 0-based depth
    entity_id: string;
    entity_type: KnowledgeLevel;
    link_type: LinkType;
    link_id: string;
    confidence: number;
  }[];
  visualization?: string;       // ASCII art graph
  summary: {
    total_hops: number;
    levels_covered: KnowledgeLevel[];
    confidence_average: number;
  };
}
```

**Example**:
```typescript
const trace = await tools["links.get_trace"]({
  start_id: "spec:spec.md#memory-model",
  max_depth: 5
});

// Returns visualization:
// spec:spec.md#memory-model
//   ├─[implemented_by]→ code:MemorySystem
//   │  ├─[documented_in]→ docs:memory-system.md
//   │  ├─[tested_by]→ test:memory/system.spec.ts
//   │  └─[demonstrated_in]→ example:MemorySystem:basic
//   └─[user_guide_for]→ docs:user-guide.md#memory
```

---

### Tool 8: `links.find_orphans`

**Purpose**: Find unlinked entities

**Input**:
```typescript
{
  level?: KnowledgeLevel;       // Specific level (or all if empty)
  link_type?: LinkType;         // Missing specific link type
  project_id?: string;          // Limit to project
  severity?: "warning" | "error"; // Classification (default: "warning")
}
```

**Output**:
```typescript
{
  orphans: {
    entity_id: string;
    entity_type: KnowledgeLevel;
    missing_links: LinkType[];
    severity: "warning" | "error";
    suggestion?: string;
  }[];
  summary: {
    total_orphans: number;
    by_level: Record<KnowledgeLevel, number>;
    by_severity: {
      warnings: number;
      errors: number;
    };
  };
}
```

---

### Tool 9: `links.search`

**Purpose**: Search for links matching criteria

**Input**:
```typescript
{
  query?: string;               // Text search in context/evidence
  type?: LinkType[];            // Filter by link types
  source_level?: KnowledgeLevel;
  target_level?: KnowledgeLevel;
  min_confidence?: number;      // Minimum confidence (0.0-1.0)
  validation_status?: ("valid" | "broken" | "stale" | "unchecked")[];
  limit?: number;               // Max results (default: 50)
}
```

**Output**:
```typescript
{
  links: SemanticLink[];
  total: number;
  filtered: number;
}
```

---

### Tool 10: `links.update`

**Purpose**: Update an existing link

**Input**:
```typescript
{
  link_id: string;
  updates: {
    confidence?: number;
    context?: string;
    validation_status?: "valid" | "broken" | "stale" | "unchecked";
  };
  validate?: boolean;           // Re-validate after update (default: true)
}
```

**Output**:
```typescript
{
  updated: SemanticLink;
  validation_result?: {
    status: "valid" | "broken";
    checked_at: Date;
  };
}
```

---

### Tool 11: `links.delete`

**Purpose**: Delete a semantic link

**Input**:
```typescript
{
  link_id: string;
  delete_reverse?: boolean;     // Also delete reverse link (default: true)
  reason?: string;              // Reason for deletion
}
```

**Output**:
```typescript
{
  deleted: number;              // 1 or 2 (if reverse deleted)
  deleted_ids: string[];
}
```

---

### Tool 12: `links.get_statistics`

**Purpose**: Get semantic link statistics

**Input**:
```typescript
{
  project_id?: string;          // Limit to project
  level?: KnowledgeLevel;       // Limit to level
  include_health?: boolean;     // Include health metrics (default: true)
}
```

**Output**:
```typescript
{
  total_links: number;
  by_type: Record<LinkType, number>;
  by_level: {
    source: Record<KnowledgeLevel, number>;
    target: Record<KnowledgeLevel, number>;
  };
  health?: {
    average_confidence: number;
    broken_percentage: number;
    stale_percentage: number;
    coverage: {
      code_with_docs: number;
      code_with_tests: number;
      specs_implemented: number;
    };
  };
}
```

---

## Token Efficiency

### How Semantic Links Reduce Token Usage

#### 1. Precise Context Loading

**Without Links** (Naive Approach):
```typescript
// Load entire file to find relevant code
const entireFile = await readFile("src/memory/system.rs");
// ~5000 tokens for full file
```

**With Links** (Targeted Approach):
```typescript
// Follow link directly to implementation
const impl = await tools["links.find_implementation"]({
  spec_id: "spec:spec.md#episodic-memory"
});
// Load only relevant symbol: ~200 tokens
```

**Savings**: 96% reduction (5000 → 200 tokens)

---

#### 2. Layered Information Retrieval

**Scenario**: Understanding a feature

**Traditional Approach**:
1. Read spec (1000 tokens)
2. Read entire code file (5000 tokens)
3. Read entire docs (3000 tokens)
4. Search for examples (2000 tokens)
5. **Total**: 11,000 tokens

**Semantic Links Approach**:
1. Read spec section (500 tokens)
2. Follow link to code symbol signature (150 tokens)
3. Follow link to relevant doc section (300 tokens)
4. Follow link to specific example (200 tokens)
5. **Total**: 1,150 tokens

**Savings**: 89.5% reduction (11,000 → 1,150 tokens)

---

#### 3. Progressive Disclosure

```rust
/// Progressive context loading with semantic links
pub struct ProgressiveLoader {
    links: Arc<LinkManager>,
    context: Arc<RwLock<ContextManager>>,
}

impl ProgressiveLoader {
    /// Load context progressively following links
    pub async fn load_progressive(
        &self,
        start_id: &str,
        token_budget: usize,
    ) -> Result<LoadedContext> {
        let mut loaded = Vec::new();
        let mut tokens_used = 0;

        // Level 1: Start entity (minimal)
        let start = self.load_minimal(start_id).await?;
        tokens_used += start.token_count;
        loaded.push(start);

        if tokens_used >= token_budget {
            return Ok(LoadedContext { loaded, tokens_used });
        }

        // Level 2: Direct links (summaries)
        let direct_links = self.links.get_forward_links(start_id).await?;
        for link in direct_links {
            let summary = self.load_summary(&link.target.id).await?;
            if tokens_used + summary.token_count <= token_budget {
                tokens_used += summary.token_count;
                loaded.push(summary);
            }
        }

        if tokens_used >= token_budget {
            return Ok(LoadedContext { loaded, tokens_used });
        }

        // Level 3: Expand based on importance
        // Only load full details for high-priority links
        for item in &loaded {
            if item.priority > 0.8 {
                let full = self.load_full(&item.id).await?;
                if tokens_used + full.token_count <= token_budget {
                    tokens_used += full.token_count;
                    // Replace summary with full
                }
            }
        }

        Ok(LoadedContext { loaded, tokens_used })
    }
}
```

---

#### 4. Link-Based Caching

**Concept**: Cache linked entities together

```rust
pub struct LinkCache {
    cache: Arc<RwLock<LruCache<String, CachedCluster>>>,
}

/// Cluster of linked entities cached together
struct CachedCluster {
    primary: Entity,
    linked: Vec<LinkedEntity>,
    total_tokens: usize,
    last_accessed: Instant,
}

impl LinkCache {
    /// Fetch with automatic prefetch of linked entities
    pub async fn fetch_with_links(
        &self,
        entity_id: &str,
        link_types: &[LinkType],
    ) -> Result<CachedCluster> {
        if let Some(cached) = self.cache.read().await.get(entity_id) {
            return Ok(cached.clone());
        }

        // Not cached - load and prefetch links
        let primary = self.load_entity(entity_id).await?;
        let mut linked = Vec::new();

        for link_type in link_types {
            let targets = self.follow_links(entity_id, *link_type).await?;
            linked.extend(targets);
        }

        let cluster = CachedCluster {
            primary,
            linked,
            total_tokens: self.count_tokens(&primary, &linked),
            last_accessed: Instant::now(),
        };

        self.cache.write().await.put(entity_id.to_string(), cluster.clone());

        Ok(cluster)
    }
}
```

**Benefit**: Single cache hit loads entire context (spec + code + docs + examples)

---

#### 5. Smart Context Selection

**Example**: Debugging a test failure

```typescript
// Traditional: Load everything related to "Application"
const context = await loadAll("Application");
// 10,000 tokens (class + all methods + all tests + all docs)

// Semantic Links: Follow failure trace
const failedTest = "test:application.spec.ts:starts_application";

// 1. Get tested code
const testedCode = await tools["links.find"]({
  source_id: failedTest,
  type: "tests"
});
// 200 tokens (just Application.start method)

// 2. Get relevant spec
const spec = await tools["links.find"]({
  source_id: testedCode.target_id,
  type: "realizes"
});
// 300 tokens (spec section on lifecycle)

// 3. Get working example
const example = await tools["links.find"]({
  source_id: testedCode.target_id,
  type: "demonstrated_in"
});
// 150 tokens (basic usage example)

// Total: 650 tokens vs 10,000 tokens (93.5% savings)
```

---

#### 6. Incremental Context Building

```rust
/// Build context incrementally based on conversation
pub struct IncrementalContextBuilder {
    conversation_history: Vec<Message>,
    loaded_entities: HashSet<String>,
    semantic_links: Arc<LinkManager>,
}

impl IncrementalContextBuilder {
    /// Add only what's needed for next response
    pub async fn add_for_message(
        &mut self,
        message: &str,
        token_budget: usize,
    ) -> Result<Context> {
        // Analyze what entities are mentioned
        let mentioned = self.extract_entity_mentions(message);

        // Find entities NOT yet loaded
        let new_entities: Vec<_> = mentioned
            .into_iter()
            .filter(|e| !self.loaded_entities.contains(e))
            .collect();

        let mut context = Context::new();
        let mut tokens_used = 0;

        for entity_id in new_entities {
            // Load entity + immediate links
            let cluster = self.semantic_links
                .fetch_cluster(&entity_id, &[
                    LinkType::ImplementedBy,
                    LinkType::DocumentedIn,
                    LinkType::TestedBy,
                ])
                .await?;

            if tokens_used + cluster.token_count <= token_budget {
                context.add_cluster(cluster);
                tokens_used += cluster.token_count;
                self.loaded_entities.insert(entity_id);
            }
        }

        Ok(context)
    }
}
```

**Benefit**: Only load new information each turn

---

### Token Efficiency Metrics

| Scenario | Without Links | With Links | Savings |
|----------|--------------|------------|---------|
| Find implementation | 5,000 tokens (full file) | 200 tokens (symbol) | 96% |
| Understand feature | 11,000 tokens (all docs) | 1,150 tokens (linked) | 89.5% |
| Debug test | 10,000 tokens (all tests) | 650 tokens (trace) | 93.5% |
| Review change | 8,000 tokens (all affected) | 800 tokens (links) | 90% |
| Write new code | 15,000 tokens (examples) | 1,200 tokens (relevant) | 92% |

**Average Token Reduction**: ~92%

---

## Implementation Guide

### Phase 1: Storage Layer

**Tasks**:
1. Add link storage schema to RocksDB
2. Implement `LinkManager` with CRUD operations
3. Add indexing for forward/reverse/type lookups
4. Implement link validation logic

**Deliverables**:
- `src/links/storage.rs` - Link storage backend
- `src/links/manager.rs` - Link management API
- `src/links/validator.rs` - Link validation

---

### Phase 2: Extraction

**Tasks**:
1. Implement annotation parsers (spec/code/docs)
2. Build inference engine
3. Create extraction pipeline
4. Add deduplication logic

**Deliverables**:
- `src/links/extraction/annotation_parser.rs`
- `src/links/extraction/inference_engine.rs`
- `src/links/extraction/pipeline.rs`

---

### Phase 3: MCP Tools

**Tasks**:
1. Implement all 12 MCP tools
2. Add tool tests
3. Integrate with MCP server
4. Document tool usage

**Deliverables**:
- `src/mcp/handlers/links.rs` - All link tools
- `tests/mcp/links_tools.rs` - Tool tests
- Updated `mcp-tools-catalog.md`

---

### Phase 4: Validation & Maintenance

**Tasks**:
1. Implement background validation
2. Add link health monitoring
3. Create auto-fix for common issues
4. Build link analytics

**Deliverables**:
- `src/links/validation/background.rs`
- `src/links/analytics.rs`
- Validation scheduled task

---

### Phase 5: UI & Visualization

**Tasks**:
1. Add link visualization (ASCII/GraphViz)
2. Create link explorer UI
3. Build impact analysis tools
4. Add link diff for changes

**Deliverables**:
- `src/links/visualization.rs`
- ASCII art link graphs
- Link change reports

---

## Testing Strategy

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_link() {
        let manager = LinkManager::new(storage).await.unwrap();

        let link = manager.create(CreateLinkParams {
            type_: LinkType::ImplementedBy,
            source: LinkEndpoint {
                level: KnowledgeLevel::Spec,
                id: "spec:spec.md#memory-model".to_string(),
                location: None,
            },
            target: LinkEndpoint {
                level: KnowledgeLevel::Code,
                id: "code:MemorySystem".to_string(),
                location: None,
            },
            confidence: Some(1.0),
            context: Some("Core memory system implementation".to_string()),
            bidirectional: true,
        }).await.unwrap();

        assert_eq!(link.type_, LinkType::ImplementedBy);
        assert!(link.reverse_link_id.is_some());
    }

    #[tokio::test]
    async fn test_find_orphans() {
        let manager = LinkManager::new(storage).await.unwrap();

        // Create code symbol without links
        storage.put("symbols:Orphan", symbol).await.unwrap();

        let orphans = manager.find_orphans(FindOrphansParams {
            level: Some(KnowledgeLevel::Code),
            link_type: Some(LinkType::DocumentedIn),
            ..Default::default()
        }).await.unwrap();

        assert_eq!(orphans.orphans.len(), 1);
        assert_eq!(orphans.orphans[0].entity_id, "code:Orphan");
    }
}
```

---

### Integration Tests

```rust
#[cfg(test)]
mod integration_tests {
    #[tokio::test]
    async fn test_full_extraction_pipeline() {
        let extractor = LinkExtractor::new(config).await.unwrap();

        // Extract from spec file with annotations
        let links = extractor.extract_from_file(
            Path::new("specs/spec.md")
        ).await.unwrap();

        // Should find annotated links
        assert!(links.len() > 0);

        // Should have high confidence (annotated)
        let annotated = links.iter()
            .filter(|l| l.extraction_method == ExtractionMethod::Annotation)
            .count();
        assert!(annotated > 0);
    }

    #[tokio::test]
    async fn test_trace_full_path() {
        let manager = LinkManager::new(storage).await.unwrap();

        // Trace from spec to tests
        let trace = manager.get_trace(GetTraceParams {
            start_id: "spec:spec.md#application-class".to_string(),
            max_depth: Some(5),
            ..Default::default()
        }).await.unwrap();

        // Should reach all levels
        assert!(trace.summary.levels_covered.contains(&KnowledgeLevel::Code));
        assert!(trace.summary.levels_covered.contains(&KnowledgeLevel::Docs));
        assert!(trace.summary.levels_covered.contains(&KnowledgeLevel::Tests));
    }
}
```

---

## Appendix A: Complete Type Definitions

```typescript
// See type-definitions.md for full details

interface SemanticLink {
  id: string;
  type: LinkType;
  source: LinkEndpoint;
  target: LinkEndpoint;
  confidence: number;
  extraction_method: ExtractionMethod;
  context?: string;
  created_at: Date;
  created_by: string;
  last_validated?: Date;
  validation_status: ValidationStatus;
  evidence?: string;
  confidence_reason?: string;
}

interface LinkEndpoint {
  level: KnowledgeLevel;
  id: string;
  location?: SourceLocation;
}

type LinkType =
  | "implemented_by" | "realizes"
  | "documented_in" | "documents"
  | "demonstrated_in" | "demonstrates"
  | "tested_by" | "tests"
  | "user_guide_for" | "specifies"
  | "shows_example" | "illustrated_in"
  | "depends_on" | "derived_from"
  | "relates_to" | "supersedes"
  | "referenced_by";

type KnowledgeLevel = "spec" | "code" | "docs" | "examples" | "tests";
type ExtractionMethod = "annotation" | "inference" | "manual";
type ValidationStatus = "valid" | "broken" | "stale" | "unchecked";
```

---

## Appendix B: Performance Considerations

### Indexing Strategy

1. **Denormalized Storage**: Store links in multiple indexes for fast lookup
2. **Batch Operations**: Group link creation/updates for efficiency
3. **Lazy Validation**: Validate on-demand, not on every read
4. **Bloom Filters**: Fast negative lookups for missing links

### Caching Strategy

1. **Hot Links**: Cache frequently accessed link clusters
2. **Prefetch**: Automatically load linked entities
3. **Invalidation**: Update cache when links change
4. **TTL**: Expire stale cache entries

### Scalability

1. **Partitioning**: Partition links by project for large monorepos
2. **Async Extraction**: Extract links in background
3. **Incremental Updates**: Only re-extract changed files
4. **Parallel Validation**: Validate links in parallel

---

## Appendix C: Migration Path

### Existing Codebases

1. **Bootstrap**: Initial extraction with annotations
2. **Inference**: Automatic link inference
3. **Manual Review**: Review and confirm inferred links
4. **Continuous**: Extract links on file changes

### Annotation Guidelines

1. **Start with specs**: Annotate specifications first
2. **Core code**: Annotate public API and core modules
3. **Critical tests**: Link important test suites
4. **Documentation**: Add links in docs
5. **Examples**: Link examples last

---

**Document Version**: 1.0.0
**Created**: October 18, 2025
**Last Updated**: October 18, 2025
**Status**: Design Specification
**Maintained by**: Meridian Core Team
