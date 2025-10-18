# Meridian Type Definitions

**Version**: 2.0.0
**Created**: October 18, 2025
**Last Updated**: October 18, 2025
**Status**: Production

---

## Overview

This document is the **single source of truth** for all type definitions used in Meridian. It includes:

- TypeScript interfaces (MCP, Core)
- Rust structs (Implementation)
- JSON schemas (Storage)
- Common data structures

---

## Table of Contents

1. [Core System Types](#core-system-types)
2. [Memory System Types](#memory-system-types)
3. [Context Management Types](#context-management-types)
4. [Code Analysis Types](#code-analysis-types)
5. [Documentation Types](#documentation-types)
6. [Session Types](#session-types)
7. [Storage Types](#storage-types)
8. [MCP Protocol Types](#mcp-protocol-types)
9. [Common Utilities](#common-utilities)

---

## Core System Types

### Project Identity

**TypeScript**:
```typescript
interface ProjectIdentity {
  id: string;                            // "@omnitron-dev/titan"
  version: string;                       // "1.0.0"
  fullId: string;                        // "@omnitron-dev/titan@1.0.0"
  contentHash: string;                   // SHA256 of manifest
  type: "npm" | "cargo" | "generic";
}
```

**Rust**:
```rust
pub struct ProjectIdentity {
    pub id: String,
    pub version: String,
    pub full_id: String,
    pub content_hash: String,
    pub project_type: ProjectType,
}

pub enum ProjectType {
    Npm,
    Cargo,
    Generic,
}
```

---

### Project Registry

**TypeScript**:
```typescript
interface ProjectRegistry {
  identity: ProjectIdentity;
  currentPath: string;
  pathHistory: PathHistoryEntry[];
  monorepo?: MonorepoContext;
  metadata: ProjectMetadata;
  indexing: IndexingState;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}

interface PathHistoryEntry {
  path: string;
  timestamp: Date;
  reason: "discovered" | "relocated" | "auto-detected";
  initiatedBy?: string;
}

type ProjectStatus = "active" | "moved" | "deleted" | "stale";

interface MonorepoContext {
  id: string;
  path: string;
  relativePath: string;
}

interface IndexingState {
  lastIndexed: Date;
  indexVersion: string;
  status: "indexed" | "indexing" | "error" | "pending";
  errorMessage?: string;
}
```

**Rust**:
```rust
pub struct ProjectRegistry {
    pub identity: ProjectIdentity,
    pub current_path: PathBuf,
    pub path_history: Vec<PathHistoryEntry>,
    pub monorepo: Option<MonorepoContext>,
    pub metadata: ProjectMetadata,
    pub indexing: IndexingState,
    pub status: ProjectStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_accessed_at: DateTime<Utc>,
}

pub struct PathHistoryEntry {
    pub path: PathBuf,
    pub timestamp: DateTime<Utc>,
    pub reason: PathChangeReason,
    pub initiated_by: Option<String>,
}

pub enum PathChangeReason {
    Discovered,
    Relocated,
    AutoDetected,
}
```

---

### Project Metadata

**TypeScript**:
```typescript
interface ProjectMetadata {
  name: string;
  description?: string;
  language: "typescript" | "rust" | "python" | "go" | "javascript" | "mixed";
  framework?: string;
  dependencies?: DependencyInfo[];
  maintainers?: string[];
  repository?: RepositoryInfo;
  tags?: string[];
}

interface DependencyInfo {
  name: string;
  version: string;
  type: "dependency" | "devDependency" | "peerDependency";
  isLocal: boolean;
}

interface RepositoryInfo {
  type: "git";
  url: string;
  directory?: string;
}
```

---

## Memory System Types

### Task Episode

**TypeScript**:
```typescript
interface TaskEpisode {
  id: string;
  timestamp: Date;
  taskDescription: string;
  initialContext: ContextSnapshot;
  queriesMade: Query[];
  filesTouched: string[];
  solutionPath: SolutionTrace;
  outcome: "success" | "failure" | "partial";
  tokensUsed: number;
  duration?: number;                     // Milliseconds
  tags?: string[];
}

interface ContextSnapshot {
  workingDirectory: string;
  activeFiles: string[];
  symbols: SymbolSnapshot[];
  timestamp: Date;
}

interface SolutionTrace {
  steps: SolutionStep[];
  finalCode?: string;
  learnings?: string[];
}

interface SolutionStep {
  action: string;
  reasoning: string;
  files?: string[];
  timestamp: Date;
}
```

**Rust**:
```rust
pub struct TaskEpisode {
    pub id: EpisodeId,
    pub timestamp: DateTime<Utc>,
    pub task_description: String,
    pub initial_context: ContextSnapshot,
    pub queries_made: Vec<Query>,
    pub files_touched: Vec<PathBuf>,
    pub solution_path: SolutionTrace,
    pub outcome: Outcome,
    pub tokens_used: usize,
    pub duration: Option<Duration>,
    pub tags: Vec<String>,
}

pub enum Outcome {
    Success,
    Failure,
    Partial,
}
```

---

### Pattern

**TypeScript**:
```typescript
interface Pattern {
  id: string;
  type: "architectural" | "coding" | "query" | "workflow";
  name: string;
  description: string;
  occurrences: number;
  confidence: number;                    // 0.0-1.0
  context: PatternContext;
  actions: PatternAction[];
  examples: string[];                    // Episode IDs
  lastSeen: Date;
}

interface PatternContext {
  taskTypes: string[];
  filePatterns: string[];
  technologies: string[];
}

interface PatternAction {
  description: string;
  priority: number;
  confidence: number;
}
```

---

### Working Memory

**TypeScript**:
```typescript
interface WorkingMemory {
  capacity: TokenBudget;
  activeSymbols: Set<string>;
  attentionWeights: Map<string, number>;
  prefetchQueue: PriorityQueue<string>;
  lastUpdate: Date;
}

interface TokenBudget {
  total: number;
  used: number;
  reserved: number;
  available: number;
}
```

**Rust**:
```rust
pub struct WorkingMemory {
    pub capacity: TokenBudget,
    pub active_symbols: BTreeSet<SymbolId>,
    pub attention_weights: HashMap<SymbolId, f32>,
    pub prefetch_queue: PriorityQueue<SymbolId>,
    pub last_update: DateTime<Utc>,
}

pub struct TokenBudget {
    pub total: usize,
    pub used: usize,
    pub reserved: usize,
}

impl TokenBudget {
    pub fn available(&self) -> usize {
        self.total.saturating_sub(self.used + self.reserved)
    }
}
```

---

## Context Management Types

### Context Request

**TypeScript**:
```typescript
interface ContextRequest {
  files?: string[];
  symbols?: SymbolReference[];
  query?: string;
  focus?: string[];                      // Primary focus areas
  includeTests?: boolean;
  includeExamples?: boolean;
}

interface SymbolReference {
  id: string;
  projectId?: string;
  detail?: "skeleton" | "interface" | "implementation" | "full";
}
```

---

### Optimized Context

**TypeScript**:
```typescript
interface OptimizedContext {
  content: string;
  symbols: SymbolContext[];
  compressionRatio: number;
  strategy: CompressionStrategy;
  quality: number;                       // 0.0-1.0
  tokenCount: number;
  metadata: ContextMetadata;
}

interface SymbolContext {
  id: string;
  name: string;
  kind: SymbolKind;
  signature: string;
  body?: string;
  documentation?: string;
  detailLevel: DetailLevel;
}

type DetailLevel = "skeleton" | "interface" | "implementation" | "full";

type CompressionStrategy =
  | "none"
  | "remove_comments"
  | "remove_whitespace"
  | "skeleton"
  | "summary"
  | "extract_key_points"
  | "tree_shaking"
  | "hybrid"
  | "ultra_compact";

interface ContextMetadata {
  originalSize: number;
  compressedSize: number;
  symbolsIncluded: number;
  filesIncluded: number;
  generatedAt: Date;
}
```

---

### Context Fragment

**TypeScript**:
```typescript
interface ContextFragment {
  id: string;
  content: string;
  type: "symbol" | "file" | "documentation" | "example";
  relevance: number;                     // 0.0-1.0
  tokens: number;
  source: SourceLocation;
  semanticCluster?: string;              // For defragmentation
}

interface UnifiedContext {
  mainNarrative: string;
  supportFragments: ContextFragment[];
  bridges: SemanticBridge[];
  totalTokens: number;
  coherence: number;                     // 0.0-1.0
}

interface SemanticBridge {
  from: string;                          // Fragment ID
  to: string;                            // Fragment ID
  connection: string;                    // Description of connection
  transitionText: string;                // Bridging text
  strength: number;                      // 0.0-1.0
}
```

---

## Code Analysis Types

### Symbol

**TypeScript**:
```typescript
interface ExtractedSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  signature: string;
  bodyHash: string;
  location: SourceLocation;
  references: Reference[];
  dependencies: string[];                // Symbol IDs
  metadata: SymbolMetadata;
}

type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "enum"
  | "module"
  | "method"
  | "property";

interface SourceLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

interface Reference {
  location: SourceLocation;
  kind: ReferenceKind;
  context?: string;
}

type ReferenceKind = "import" | "call" | "type" | "extend" | "implement" | "read" | "write";

interface SymbolMetadata {
  complexity: number;                    // Cyclomatic complexity
  tokenCost: number;
  lastModified: GitCommit;
  authors: string[];
  docComment?: string;
  testCoverage?: number;
  usageFrequency: number;
  isPublic: boolean;
  isDeprecated: boolean;
}

interface GitCommit {
  hash: string;
  author: string;
  date: Date;
  message: string;
}
```

**Rust**:
```rust
pub struct ExtractedSymbol {
    pub id: SymbolId,
    pub name: String,
    pub kind: SymbolKind,
    pub signature: String,
    pub body_hash: Hash,
    pub location: SourceLocation,
    pub references: Vec<Reference>,
    pub dependencies: Vec<SymbolId>,
    pub metadata: SymbolMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymbolKind {
    Function,
    Class,
    Interface,
    Type,
    Variable,
    Constant,
    Enum,
    Module,
    Method,
    Property,
}

pub struct SourceLocation {
    pub file: PathBuf,
    pub line: usize,
    pub column: usize,
    pub end_line: Option<usize>,
    pub end_column: Option<usize>,
}
```

---

### Dependency Graph

**TypeScript**:
```typescript
interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  cycles: Cycle[];
}

interface DependencyNode {
  id: string;
  type: "symbol" | "file" | "project";
  name: string;
  metadata?: Record<string, any>;
}

interface DependencyEdge {
  from: string;                          // Node ID
  to: string;                            // Node ID
  type: "imports" | "exports" | "calls" | "extends" | "implements";
  weight?: number;
}

interface Cycle {
  nodes: string[];                       // Node IDs forming cycle
  severity: "warning" | "error";
  description: string;
}
```

---

## Documentation Types

### Generated Documentation

**TypeScript**:
```typescript
interface GeneratedDocumentation {
  symbolId: string;
  projectId: string;
  format: "tsdoc" | "jsdoc" | "rustdoc" | "markdown";
  content: string;
  summary: string;
  description: string;
  parameters?: ParameterDoc[];
  returns?: ReturnDoc;
  throws?: ThrowsDoc[];
  examples?: CodeExample[];
  seeAlso?: string[];
  tags?: string[];
  generatedAt: Date;
  generator: string;
  quality: DocumentationQuality;
}

interface ParameterDoc {
  name: string;
  type: string;
  description: string;
  optional: boolean;
  defaultValue?: string;
}

interface ReturnDoc {
  type: string;
  description: string;
}

interface ThrowsDoc {
  type: string;
  description: string;
}

interface CodeExample {
  id: string;
  language: string;
  code: string;
  description: string;
  output?: string;
  setup?: string;
  teardown?: string;
}

interface DocumentationQuality {
  score: number;                         // 0-100
  completeness: number;                  // 0-100
  clarity: number;                       // 0-100
  accuracy: number;                      // 0-100
  issues: QualityIssue[];
  suggestions: string[];
}

interface QualityIssue {
  type: "missing_param" | "unclear_description" | "missing_example" | "type_mismatch";
  severity: "error" | "warning" | "info";
  message: string;
  location?: string;
}
```

---

### Generated Example

**TypeScript**:
```typescript
interface GeneratedExample {
  id: string;
  symbolId: string;
  projectId: string;
  complexity: "basic" | "intermediate" | "advanced";
  language: "typescript" | "javascript" | "rust" | "python";
  code: string;
  description: string;
  setup?: string;
  teardown?: string;
  dependencies?: string[];
  validation: ExampleValidation;
  generatedAt: Date;
}

interface ExampleValidation {
  syntax: boolean;
  compiles: boolean;
  runs?: boolean;
  output?: string;
  errors?: ValidationError[];
}

interface ValidationError {
  type: "syntax" | "compilation" | "runtime";
  message: string;
  line?: number;
  column?: number;
}
```

---

### Generated Test

**TypeScript**:
```typescript
interface GeneratedTest {
  id: string;
  symbolId: string;
  projectId: string;
  testType: "unit" | "integration" | "e2e";
  framework: "jest" | "vitest" | "bun" | "rust";
  name: string;
  code: string;
  description: string;
  setup?: string;
  teardown?: string;
  expectedCoverage?: number;
  validation: TestValidation;
  generatedAt: Date;
}

interface TestValidation {
  syntax: boolean;
  compiles: boolean;
  runs?: boolean;
  passes?: boolean;
  coverage?: number;
  errors?: ValidationError[];
}
```

---

## Session Types

### Session

**TypeScript**:
```typescript
interface Session {
  id: string;
  taskDescription: string;
  baseSnapshot: Snapshot;
  deltas: Delta[];
  indexOverlay: IndexOverlay;
  scope?: string[];
  baseCommit?: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

type SessionStatus = "active" | "completed" | "discarded" | "stashed";

interface Snapshot {
  timestamp: Date;
  symbols: Map<string, ExtractedSymbol>;
  files: Map<string, FileSnapshot>;
  metadata: SnapshotMetadata;
}

interface FileSnapshot {
  path: string;
  content: string;
  hash: string;
  lastModified: Date;
}

interface Delta {
  type: "create" | "update" | "delete";
  entity: "symbol" | "file";
  entityId: string;
  before?: any;
  after?: any;
  timestamp: Date;
}

interface IndexOverlay {
  symbols: Map<string, ExtractedSymbol>;
  modifications: Set<string>;
  deletions: Set<string>;
}

interface SnapshotMetadata {
  version: string;
  projectId: string;
  symbolCount: number;
  fileCount: number;
}
```

---

## Storage Types

### Cached Item

**TypeScript**:
```typescript
interface CachedItem<T = any> {
  key: string;
  value: T;
  timestamp: Date;
  ttl?: number;                          // Seconds
  size?: number;                         // Bytes
  accessCount: number;
  lastAccess: Date;
}

interface CacheOptions {
  ttl?: number;                          // Time to live (seconds)
  priority?: "high" | "normal" | "low";
  compress?: boolean;
}

interface SyncState {
  lastSync: Date;
  pendingChanges: PendingChange[];
  syncVersion: string;
}

interface PendingChange {
  type: "create" | "update" | "delete";
  entity: "symbol" | "doc" | "example" | "test";
  projectId: string;
  entityId: string;
  timestamp: Date;
  data?: any;
}
```

---

## MCP Protocol Types

### MCP Tool

**TypeScript**:
```typescript
interface MCPTool {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
}

interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

interface JSONSchemaProperty {
  type: string | string[];
  description?: string;
  enum?: any[];
  items?: JSONSchema;
  properties?: Record<string, JSONSchemaProperty>;
  default?: any;
}
```

---

### MCP Request/Response

**TypeScript**:
```typescript
interface MCPRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, any>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: MCPError;
}

interface MCPError {
  code: number;
  message: string;
  data?: any;
}

interface CallToolResult {
  content: any[];
  isError?: boolean;
}
```

---

## Common Utilities

### Priority Queue

**TypeScript**:
```typescript
interface PriorityQueue<T> {
  push(item: T, priority: number): void;
  pop(): T | undefined;
  peek(): T | undefined;
  size(): number;
  isEmpty(): boolean;
}
```

**Rust**:
```rust
use std::collections::BinaryHeap;
use std::cmp::Ordering;

#[derive(Eq, PartialEq)]
pub struct PriorityItem<T> {
    pub item: T,
    pub priority: i32,
}

impl<T> Ord for PriorityItem<T> {
    fn cmp(&self, other: &Self) -> Ordering {
        self.priority.cmp(&other.priority)
    }
}

impl<T> PartialOrd for PriorityItem<T> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub type PriorityQueue<T> = BinaryHeap<PriorityItem<T>>;
```

---

### Attention Pattern

**TypeScript**:
```typescript
interface AttentionPattern {
  focusedSymbols: Array<{
    symbol: string;
    weight: number;
  }>;
  accessedFiles: string[];
  querySequence: string[];
  timestamp: Date;
  sessionId?: string;
}

interface AttentionPredictor {
  highProbability: string[];             // Likely to be accessed
  mediumProbability: string[];           // Possibly needed
  context: string[];                     // Related context
}
```

---

### Query Types

**TypeScript**:
```typescript
interface Query {
  id: string;
  type: "search" | "get" | "find" | "analyze";
  query: string;
  filters?: QueryFilter[];
  timestamp: Date;
  result?: QueryResult;
}

interface QueryFilter {
  field: string;
  operator: "eq" | "ne" | "gt" | "lt" | "contains" | "regex";
  value: any;
}

interface QueryResult {
  items: any[];
  totalCount: number;
  truncated: boolean;
  tokens: number;
  executionTime: number;                 // Milliseconds
}
```

---

## Cross-Monorepo Types

### Cross Reference

**TypeScript**:
```typescript
interface CrossReference {
  id: string;
  sourceProject: string;                 // Full project ID
  targetProject: string;                 // Full project ID
  sourceSymbol: string;
  targetSymbol: string;
  referenceType: ReferenceKind;
  location: SourceLocation;
  context?: string;
  monorepo: {
    source: string;                      // Source monorepo ID
    target: string;                      // Target monorepo ID
  };
}

interface DependentProject {
  projectId: string;
  version: string;
  type: "dependency" | "devDependency" | "peerDependency";
}

interface DependencyProject {
  projectId: string;
  version: string;
  type: "dependency" | "devDependency" | "peerDependency";
  isExternal: boolean;
}
```

---

## Evolution Types

**TypeScript**:
```typescript
interface Evolution {
  symbolId: string;
  timeline: VersionSnapshot[];
  renames: RenameEvent[];
  refactorings: RefactoringEvent[];
  semanticChanges: SemanticChange[];
}

interface VersionSnapshot {
  commit: GitCommit;
  code: string;
  complexity: number;
  changes: CodeChange[];
}

interface RenameEvent {
  from: string;
  to: string;
  commit: GitCommit;
  reason?: string;
}

interface RefactoringEvent {
  type: "extract" | "inline" | "move" | "rename" | "optimize";
  description: string;
  commit: GitCommit;
  impact: ImpactAnalysis;
}

interface SemanticChange {
  commit: GitCommit;
  changeType: "bugfix" | "feature" | "refactor" | "optimization";
  impact: ImpactAnalysis;
  description: string;
  breaking: boolean;
}

interface ImpactAnalysis {
  filesAffected: number;
  symbolsAffected: number;
  testsAffected: number;
  severity: "low" | "medium" | "high";
}

interface CodeChange {
  type: "addition" | "deletion" | "modification";
  lines: number;
  description: string;
}
```

---

## Statistics Types

**TypeScript**:
```typescript
interface GlobalStatistics {
  totalProjects: number;
  totalMonorepos: number;
  totalSymbols: number;
  totalDocumentation: number;
  totalExamples: number;
  totalTests: number;
  indexVersion: string;
  lastUpdate: Date;
  storageSize: StorageSize;
}

interface StorageSize {
  total: number;                         // Bytes
  symbols: number;
  docs: number;
  examples: number;
  tests: number;
  cache: number;
}

interface ComplexityMetrics {
  cyclomatic: number;
  cognitive: number;
  lines: {
    total: number;
    code: number;
    comments: number;
    blank: number;
  };
  dependencies: number;
  maintainability: number;               // 0-100
}

interface Hotspot {
  location: SourceLocation;
  type: "complexity" | "duplication" | "coupling" | "size";
  severity: "low" | "medium" | "high" | "critical";
  metric: number;
  description: string;
}
```

---

## Version Information

**Document Version**: 1.0.0
**Type System Version**: 2.0.0
**Last Updated**: October 18, 2025

---

## References

- **Core Spec**: [spec.md](../spec.md)
- **Strong Tools Spec**: [strong-tools-spec.md](../strong-tools-spec.md)
- **Global Arch Spec**: [global-architecture-spec.md](../global-architecture-spec.md)
- **RocksDB Schema**: [rocksdb-schema.md](./rocksdb-schema.md)

---

**Maintained by**: Meridian Core Team
