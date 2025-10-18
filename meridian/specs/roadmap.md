# Meridian Implementation Roadmap
# Unified Plan for Global Architecture + Strong Tools + Core System

**Version**: 1.0.0
**Created**: October 18, 2025
**Status**: Active Development
**Target**: Production-Ready Multi-Monorepo Knowledge Management System

---

## Executive Summary

This roadmap unifies three specifications into a coherent implementation plan:

1. **spec.md** (Meridian Core) - ✅ **Production-Ready** (431/431 tests passing)
2. **strong-tools-spec.md** (Documentation & Knowledge Management) - 🚧 **To Implement**
3. **global-architecture-spec.md** (Multi-Monorepo System) - 🚧 **To Implement**

**Goal**: Expand Meridian from a single-monorepo cognitive memory system into a **global multi-monorepo knowledge management platform** with automated documentation generation, cross-repository access, and agent-driven workflows.

**Total Implementation**: 7 Phases over 16 weeks
**Total MCP Tools**: 29 (existing) + 23 (strong tools) + 5 (global tools) = **57 tools**
**Testing Requirements**: 100% test coverage, 100% success rate, no compromises

---

## Current State Analysis

### ✅ Implemented (spec.md)

**Core System (Production-Ready)**:
- ✅ Cognitive Memory System (4-tier: Episodic, Working, Semantic, Procedural)
- ✅ Adaptive Context Management (LLM-aware)
- ✅ Code Indexing (Tree-sitter: TypeScript, Rust, JavaScript, Python, Go)
- ✅ Session Management (Copy-on-Write semantics)
- ✅ Git Integration (history, blame, evolution)
- ✅ Monorepo Support (basic)
- ✅ 29 MCP Tools (all production-ready)
- ✅ MCP Protocol 2025-03-26 compliance
- ✅ Comprehensive Testing (431 tests, 100% passing)

**MCP Server**:
- ✅ Custom MCP implementation (not SDK-based)
- ✅ STDIO + HTTP/SSE transports
- ✅ Claude CLI integration working

**Storage**:
- ✅ RocksDB backend
- ✅ In-memory caching
- ✅ Session isolation

### 🚧 To Implement (strong-tools-spec.md)

**Documentation System**:
- ❌ Global documentation catalog
- ❌ Automated documentation generation (TSDoc/JSDoc, rustdoc)
- ❌ Quality validation and scoring
- ❌ Documentation transformation

**Example & Test Generation**:
- ❌ Context-aware example generation
- ❌ Multi-framework test generation (Jest, Vitest, Bun, Cargo)
- ❌ Example/test validation and compilation

**Agent System**:
- ❌ Architect Agent (specification management)
- ❌ Developer Agent (implementation context)
- ❌ Tester Agent (comprehensive testing)

**Auto-Update**:
- ❌ File watching system
- ❌ Incremental re-indexing
- ❌ Cache invalidation

**MCP Tools**: 23 new tools across 6 categories

### 🚧 To Implement (global-architecture-spec.md)

**Global Architecture**:
- ❌ Global server (daemon)
- ❌ Project Registry (multi-monorepo)
- ❌ Identity-based project IDs (not path-based)
- ❌ Two-tier storage (global DB + local caches)

**Cross-Monorepo Features**:
- ❌ Cross-repository documentation access
- ❌ Dependency graph (cross-monorepo)
- ❌ Global search

**Synchronization**:
- ❌ Push/pull sync (local ↔ global)
- ❌ Offline mode support
- ❌ Cache management

**MCP Tools**: 5 new tools for global operations

---

## Gap Analysis

### Critical Gaps

1. **No Global Server** - All current functionality is single-monorepo
2. **No Documentation Generation** - Only indexing, no content creation
3. **No Cross-Monorepo Access** - Cannot access docs from other repos
4. **No Auto-Update** - Manual re-indexing required
5. **No Agent System** - No specification-driven workflows

### Architecture Gaps

1. **Storage** - Single RocksDB per monorepo, need global + local
2. **Identity** - Path-based, need content-based IDs
3. **Caching** - Basic, need multi-level with TTL
4. **File Watching** - None, need global watcher
5. **IPC** - None, need global server ↔ MCP server communication

### Testing Gaps

1. **Unit Tests** - Need tests for all new components
2. **Integration Tests** - Need cross-monorepo scenarios
3. **E2E Tests** - Need full workflow tests
4. **Performance Tests** - Need benchmarks for large codebases
5. **Migration Tests** - Need v1→v2 migration tests

---

## Implementation Strategy

### Approach: Incremental, Non-Breaking

**Principles**:
1. ✅ **No Breaking Changes** - Existing 29 tools continue working
2. ✅ **Backward Compatible** - Support both single-monorepo and global modes
3. ✅ **Incremental Deployment** - Each phase independently deployable
4. ✅ **Test-Driven** - Write tests before/during implementation
5. ✅ **Production-Ready** - No compromises, enterprise-grade from day one

**Parallel Work Streams**:
- **Stream A**: Global Architecture (Weeks 1-8)
- **Stream B**: Strong Tools (Weeks 3-10)
- **Stream C**: Testing & Integration (Weeks 1-16, continuous)

### Technology Stack (No Compromises)

**Backend (Rust)**:
- Tokio async runtime (production-grade)
- RocksDB (Facebook-proven storage)
- Tree-sitter (GitHub-proven parsing)
- Serde (serialization)
- Anyhow/Thiserror (error handling)

**Testing**:
- Rust: Native test framework + criterion (benchmarks)
- Coverage: tarpaulin or llvm-cov
- CI/CD: GitHub Actions

**Quality**:
- Clippy (lints)
- Rustfmt (formatting)
- Cargo audit (security)
- Comprehensive docs

---

## Phased Implementation Plan

### Phase 0: Foundation & Planning (Week 1)

**Status**: ⏳ In Progress

**Objectives**:
- Create unified roadmap ✅
- Set up project structure
- Configure CI/CD pipeline
- Establish testing strategy

**Tasks**:

1. **Project Structure** ✅
   ```
   meridian/
   ├── src/
   │   ├── global/          # Global server components (NEW)
   │   ├── strong/          # Strong tools (NEW)
   │   ├── memory/          # Existing
   │   ├── indexer/         # Existing
   │   └── mcp/             # Existing
   ├── specs/
   │   ├── spec.md          # Core spec
   │   ├── strong-tools-spec.md
   │   ├── global-architecture-spec.md
   │   └── roadmap.md       # This file ✅
   └── tests/
       ├── unit/
       ├── integration/
       └── e2e/
   ```

2. **CI/CD Setup**:
   - [ ] GitHub Actions workflow
   - [ ] Automated testing on PR
   - [ ] Code coverage reporting
   - [ ] Performance regression detection

3. **Development Environment**:
   - [ ] Docker setup for testing
   - [ ] Local development scripts
   - [ ] Debug configurations

**Deliverables**:
- ✅ Unified roadmap (this document)
- [ ] CI/CD pipeline
- [ ] Development guidelines

**Success Criteria**:
- All developers can run tests locally
- CI pipeline green
- Clear contribution process

---

### Phase 1: Global Architecture Foundation (Weeks 2-3)

**Status**: ⏳ Pending

**Objectives**:
- Implement global server daemon
- Create project registry system
- Establish identity-based project IDs
- Set up global RocksDB

**Tasks**:

#### 1.1 Project Identity System

**Files to Create**:
- `src/global/identity.rs` - Project ID generation
- `src/global/monorepo.rs` - Monorepo detection

**Implementation**:
```rust
// src/global/identity.rs
pub struct ProjectIdentity {
    id: String,              // @scope/name
    version: String,         // semver
    full_id: String,         // @scope/name@version
    content_hash: String,    // SHA256 of manifest
    project_type: ProjectType,
}

impl ProjectIdentity {
    pub fn from_npm(path: &Path) -> Result<Self>;
    pub fn from_cargo(path: &Path) -> Result<Self>;
    pub fn from_generic(path: &Path) -> Result<Self>;
}
```

**Tests Required**:
- [ ] Test npm package.json parsing
- [ ] Test Cargo.toml parsing
- [ ] Test content hash stability
- [ ] Test ID uniqueness
- [ ] Test path changes don't affect ID

#### 1.2 Project Registry

**Files to Create**:
- `src/global/registry.rs` - Registry manager
- `src/global/storage.rs` - Global RocksDB wrapper

**Implementation**:
```rust
// src/global/registry.rs
pub struct ProjectRegistry {
    identity: ProjectIdentity,
    current_path: PathBuf,
    path_history: Vec<PathHistoryEntry>,
    monorepo: Option<MonorepoContext>,
    metadata: ProjectMetadata,
    indexing: IndexingState,
    status: ProjectStatus,
}

pub struct ProjectRegistryManager {
    db: Arc<RocksDB>,

    pub async fn register(&self, path: &Path) -> Result<ProjectRegistry>;
    pub async fn get(&self, project_id: &str) -> Result<Option<ProjectRegistry>>;
    pub async fn update(&self, registry: ProjectRegistry) -> Result<()>;
    pub async fn find_by_path(&self, path: &Path) -> Result<Option<ProjectRegistry>>;
    pub async fn list_all(&self) -> Result<Vec<ProjectRegistry>>;
}
```

**Tests Required**:
- [ ] Test project registration
- [ ] Test duplicate detection
- [ ] Test path relocation
- [ ] Test monorepo detection
- [ ] Test registry persistence
- [ ] Test concurrent access

#### 1.3 Global Server Daemon

**Files to Create**:
- `src/global/server.rs` - Main server
- `src/global/ipc.rs` - IPC server (HTTP)
- `src/global/cli.rs` - CLI commands

**Implementation**:
```rust
// src/global/server.rs
pub struct GlobalServer {
    registry: Arc<ProjectRegistryManager>,
    index_manager: Arc<GlobalIndexManager>,
    file_watcher: Arc<GlobalFileWatcher>,
    ipc_server: Arc<IpcServer>,
}

impl GlobalServer {
    pub async fn start(&self) -> Result<()>;
    pub async fn stop(&self) -> Result<()>;
    pub async fn status(&self) -> ServerStatus;
}
```

**Tests Required**:
- [ ] Test server startup/shutdown
- [ ] Test IPC communication
- [ ] Test project registration via server
- [ ] Test concurrent client connections
- [ ] Test graceful shutdown

#### 1.4 CLI Commands

**Commands to Implement**:
```bash
meridian server start [--daemon]
meridian server stop
meridian server status
meridian projects add <path>
meridian projects list
meridian projects info <id>
meridian projects relocate <id> <new-path>
```

**Tests Required**:
- [ ] Test all CLI commands
- [ ] Test error handling
- [ ] Test help text
- [ ] Test daemon mode

**Deliverables**:
- Global server can start/stop
- Projects can be registered
- CLI commands working
- 100% test coverage for Phase 1

**Success Criteria**:
- [ ] Global server runs as daemon
- [ ] Can register multiple monorepos
- [ ] Projects survive path changes
- [ ] All Phase 1 tests passing (100%)

---

### Phase 2: Local MCP Server Integration (Weeks 4-5)

**Status**: ⏳ Pending

**Objectives**:
- Update MCP server to connect to global server
- Implement local cache (RocksDB)
- Enable offline mode
- Maintain backward compatibility

**Tasks**:

#### 2.1 Global Server Client

**Files to Create**:
- `src/mcp/global_client.rs` - Client to global server

**Implementation**:
```rust
// src/mcp/global_client.rs
pub struct GlobalServerClient {
    base_url: String,
    http_client: reqwest::Client,
}

impl GlobalServerClient {
    pub async fn get_project(&self, id: &str) -> Result<ProjectRegistry>;
    pub async fn search_symbols(&self, query: SymbolQuery) -> Result<Vec<Symbol>>;
    pub async fn get_documentation(&self, project_id: &str, symbol_id: &str) -> Result<Doc>;
    pub async fn update_symbols(&self, project_id: &str, symbols: Vec<Symbol>) -> Result<()>;
}
```

**Tests Required**:
- [ ] Test HTTP communication
- [ ] Test error handling (server down)
- [ ] Test timeout handling
- [ ] Test retry logic
- [ ] Test request/response serialization

#### 2.2 Local Cache

**Files to Create**:
- `src/mcp/local_cache.rs` - Local RocksDB cache

**Implementation**:
```rust
// src/mcp/local_cache.rs
pub struct LocalCache {
    db: RocksDB,
    sync_state: SyncState,
}

impl LocalCache {
    pub async fn get(&self, key: &str) -> Result<Option<CachedItem>>;
    pub async fn set(&self, key: &str, value: &[u8], ttl: Option<Duration>) -> Result<()>;
    pub async fn invalidate(&self, key: &str) -> Result<()>;
    pub async fn sync(&self, global_client: &GlobalServerClient) -> Result<()>;
}
```

**Tests Required**:
- [ ] Test cache get/set/invalidate
- [ ] Test TTL expiration
- [ ] Test sync with global server
- [ ] Test offline fallback
- [ ] Test cache eviction (LRU)

#### 2.3 Updated MCP Server

**Files to Modify**:
- `src/mcp/server.rs` - Add global client, local cache

**Implementation**:
```rust
// src/mcp/server.rs
pub struct MeridianMCPServer {
    // Existing
    memory_system: Arc<RwLock<MemorySystem>>,
    context_manager: Arc<RwLock<ContextManager>>,

    // NEW
    global_client: Option<Arc<GlobalServerClient>>,
    local_cache: Arc<LocalCache>,
    monorepo_context: MonorepoContext,
    offline_mode: AtomicBool,
}

impl MeridianMCPServer {
    async fn handle_tool_with_global(&self, tool: &str, args: Value) -> Result<CallToolResult> {
        // Try global server first
        // Fallback to local cache if offline
    }
}
```

**Tests Required**:
- [ ] Test MCP tools with global server
- [ ] Test offline mode
- [ ] Test cache hit/miss
- [ ] Test sync behavior
- [ ] Test backward compatibility (single-monorepo mode)

**Deliverables**:
- MCP server connects to global server
- Local cache working
- Offline mode functional
- Existing 29 tools still working

**Success Criteria**:
- [ ] All existing tests still pass
- [ ] Can access data from global server
- [ ] Works offline with cached data
- [ ] No performance regression

---

### Phase 3: Strong Tools - Documentation Generation (Weeks 6-8)

**Status**: ✅ Completed

**Objectives**:
- ✅ Implement documentation generation engine
- ✅ Add quality validation
- ✅ Create MCP tools for doc generation

**Tasks**:

#### 3.1 Documentation Generator

**Files to Create**:
- `src/strong/doc_generator.rs` - Main generator
- `src/strong/doc_quality.rs` - Quality validator
- `src/strong/templates/` - Doc templates (TSDoc, rustdoc)

**Implementation**:
```rust
// src/strong/doc_generator.rs
pub struct DocumentationGenerator {
    language: Language,
    format: DocFormat,
}

impl DocumentationGenerator {
    pub async fn generate(&self, symbol: &ExtractedSymbol) -> Result<GeneratedDoc>;
    pub async fn enhance(&self, existing: &str, symbol: &ExtractedSymbol) -> Result<GeneratedDoc>;
    pub async fn transform(&self, doc: &str, target_format: DocFormat) -> Result<String>;
}

pub struct DocumentationQuality {
    pub fn assess(&self, doc: &str, symbol: &ExtractedSymbol) -> QualityScore;
    pub fn suggest_improvements(&self, doc: &str) -> Vec<Suggestion>;
}
```

**Tests Required**:
- ✅ Test TSDoc generation from TypeScript
- ✅ Test rustdoc generation from Rust
- ✅ Test quality scoring
- ✅ Test enhancement of existing docs
- ✅ Test transformation between formats

#### 3.2 Global Documentation Catalog

**Files to Create**:
- `src/strong/catalog.rs` - Documentation catalog
- `src/strong/cross_ref.rs` - Cross-reference tracking

**Implementation**:
```rust
// src/strong/catalog.rs
pub struct GlobalCatalog {
    projects: HashMap<String, ProjectMetadata>,
    cross_references: Vec<CrossReference>,
}

impl GlobalCatalog {
    pub async fn index_project(&mut self, project: &ProjectRegistry) -> Result<()>;
    pub async fn search(&self, query: &str, scope: SearchScope) -> Result<Vec<DocResult>>;
    pub async fn get_project_docs(&self, project_id: &str) -> Result<ProjectDocs>;
}
```

**Tests Required**:
- ✅ Test project indexing
- ✅ Test search (local, dependencies, global)
- ✅ Test cross-reference resolution
- ✅ Test metadata extraction

#### 3.3 MCP Tools (Documentation)

**Tools to Implement**:
1. ✅ `strong.catalog.list_projects`
2. ✅ `strong.catalog.get_project`
3. ✅ `strong.catalog.search_documentation`
4. ✅ `strong.docs.generate`
5. ✅ `strong.docs.validate`
6. ✅ `strong.docs.transform`

**Files to Create**:
- ✅ `src/mcp/tools.rs` (added strong tools inline)

**Tests Required**:
- ✅ Test each MCP tool
- ✅ Test error cases
- ✅ Test parameter validation
- ✅ Test output format

**Deliverables**:
- ✅ Documentation generation working
- ✅ Quality validation functional
- ✅ 6 new MCP tools operational

**Success Criteria**:
- ✅ Can generate docs for TypeScript
- ✅ Can generate docs for Rust
- ✅ Quality scores accurate
- ✅ All 6 tools tested (100%)

---

### Phase 4: Strong Tools - Example & Test Generation (Weeks 9-10)

**Status**: ⏳ Pending

**Objectives**:
- Implement example generation
- Implement test generation (multi-framework)
- Add validation and compilation

**Tasks**:

#### 4.1 Example Generator

**Files to Create**:
- `src/strong/example_generator.rs`
- `src/strong/example_validator.rs`

**Implementation**:
```rust
// src/strong/example_generator.rs
pub struct ExampleGenerator {
    language: Language,
    runtime: Option<Runtime>,
}

impl ExampleGenerator {
    pub async fn generate_basic(&self, symbol: &ExtractedSymbol) -> Result<Example>;
    pub async fn generate_advanced(&self, symbol: &ExtractedSymbol) -> Result<Vec<Example>>;
    pub async fn validate(&self, example: &Example) -> Result<ValidationResult>;
}
```

**Tests Required**:
- [ ] Test basic example generation
- [ ] Test advanced scenarios
- [ ] Test compilation validation
- [ ] Test runtime-specific examples
- [ ] Test type safety

#### 4.2 Test Generator

**Files to Create**:
- `src/strong/test_generator.rs`
- `src/strong/test_frameworks/` - Framework adapters

**Implementation**:
```rust
// src/strong/test_generator.rs
pub struct TestGenerator {
    framework: TestFramework,
    test_type: TestType,
}

impl TestGenerator {
    pub async fn generate_unit_tests(&self, symbol: &ExtractedSymbol) -> Result<Vec<Test>>;
    pub async fn generate_integration_tests(&self, module: &Module) -> Result<Vec<Test>>;
    pub async fn estimate_coverage(&self, tests: &[Test]) -> f32;
}
```

**Frameworks to Support**:
- TypeScript: Jest, Vitest, Bun Test
- Rust: Native tests, integration tests

**Tests Required**:
- [ ] Test unit test generation
- [ ] Test integration test generation
- [ ] Test for each framework
- [ ] Test compilation
- [ ] Test execution

#### 4.3 MCP Tools (Examples & Tests)

**Tools to Implement**:
7. `strong.examples.generate`
8. `strong.examples.validate`
9. `strong.tests.generate`
10. `strong.tests.validate`

**Tests Required**:
- [ ] Test each tool
- [ ] Test validation results
- [ ] Test error handling

**Deliverables**:
- Example generation working
- Test generation for multiple frameworks
- 4 new MCP tools

**Success Criteria**:
- [ ] Examples compile successfully
- [ ] Tests pass when executed
- [ ] Multiple frameworks supported

---

### Phase 5: Cross-Monorepo Features (Weeks 11-12)

**Status**: ⏳ Pending

**Objectives**:
- Implement dependency resolution
- Enable cross-monorepo documentation access
- Create global search

**Tasks**:

#### 5.1 Dependency Resolution

**Files to Create**:
- `src/global/dependencies.rs` - Dependency graph
- `src/global/dep_resolver.rs` - Resolution logic

**Implementation**:
```rust
// src/global/dependencies.rs
pub struct DependencyGraph {
    nodes: HashMap<String, ProjectNode>,
    edges: Vec<DependencyEdge>,
}

impl DependencyGraph {
    pub async fn build(&mut self, registry: &ProjectRegistryManager) -> Result<()>;
    pub fn find_dependencies(&self, project_id: &str, depth: usize) -> Vec<Dependency>;
    pub fn find_dependents(&self, project_id: &str) -> Vec<ProjectId>;
    pub fn detect_cycles(&self) -> Vec<Cycle>;
}
```

**Tests Required**:
- [ ] Test dependency detection
- [ ] Test transitive dependencies
- [ ] Test cycle detection
- [ ] Test graph visualization

#### 5.2 Cross-Monorepo Documentation

**Files to Create**:
- `src/strong/cross_monorepo.rs` - Cross-repo access

**Implementation**:
```rust
// src/strong/cross_monorepo.rs
pub struct CrossMonorepoAccess {
    registry: Arc<ProjectRegistryManager>,
    security: SecurityContext,
}

impl CrossMonorepoAccess {
    pub async fn get_external_docs(&self, project_id: &str) -> Result<ExternalDocs>;
    pub async fn find_usages(&self, symbol: &Symbol) -> Result<Vec<Usage>>;
    pub fn can_access(&self, target_project: &str) -> bool;
}
```

**Tests Required**:
- [ ] Test cross-repo doc access
- [ ] Test security isolation
- [ ] Test caching
- [ ] Test offline mode

#### 5.3 MCP Tools (Global & Cross-Monorepo)

**Tools to Implement**:
11. `strong.global.list_monorepos`
12. `strong.global.search_all_projects`
13. `strong.global.get_dependency_graph`
14. `strong.external.get_documentation`
15. `strong.external.find_usages`

**Tests Required**:
- [ ] Test each tool
- [ ] Test scope parameters
- [ ] Test access control

**Deliverables**:
- Cross-monorepo access working
- Dependency graph complete
- 5 new MCP tools

**Success Criteria**:
- [ ] Can access docs from other monorepos
- [ ] Dependency graph accurate
- [ ] Security isolation enforced

---

### Phase 6: Agent System Integration (Weeks 13-14)

**Status**: ⏳ Pending

**Objectives**:
- Implement Architect Agent
- Implement Developer Agent
- Implement Tester Agent

**Tasks**:

#### 6.1 Architect Agent

**Files to Create**:
- `src/strong/agents/architect.rs`
- `src/strong/specifications.rs`

**Implementation**:
```rust
// src/strong/agents/architect.rs
pub struct ArchitectAgent {
    spec_store: Arc<SpecificationStore>,
}

impl ArchitectAgent {
    pub async fn create_specification(&self, req: SpecRequest) -> Result<Specification>;
    pub async fn validate_implementation(&self, spec_id: &str, impl_path: &Path) -> Result<ValidationReport>;
}
```

**Tests Required**:
- [ ] Test spec creation
- [ ] Test validation
- [ ] Test compliance checking

#### 6.2 Developer & Tester Agents

**Files to Create**:
- `src/strong/agents/developer.rs`
- `src/strong/agents/tester.rs`

**Implementation**:
```rust
// Similar structure to ArchitectAgent
```

**Tests Required**:
- [ ] Test each agent
- [ ] Test agent workflows
- [ ] Test integration

#### 6.3 MCP Tools (Agents)

**Tools to Implement**:
16. `strong.architect.create_specification`
17. `strong.architect.validate_implementation`
18. `strong.developer.get_implementation_context`
19. `strong.developer.generate_boilerplate`
20. `strong.tester.generate_comprehensive_tests`
21. `strong.tester.validate_examples`
22. `strong.tester.enhance_documentation`

**Tests Required**:
- [ ] Test each tool
- [ ] Test full workflows

**Deliverables**:
- 3 agents operational
- 7 new MCP tools

**Success Criteria**:
- [ ] Agents can work together
- [ ] Spec-driven development functional

---

### Phase 7: Auto-Update & File Watching (Week 15)

**Status**: ⏳ Pending

**Objectives**:
- Implement file watching
- Enable auto-reindexing
- Add cache invalidation

**Tasks**:

#### 7.1 File Watcher

**Files to Create**:
- `src/global/file_watcher.rs`
- `src/global/reindex.rs`

**Implementation**:
```rust
// src/global/file_watcher.rs
pub struct GlobalFileWatcher {
    watchers: HashMap<String, Watcher>,
}

impl GlobalFileWatcher {
    pub async fn watch_monorepo(&mut self, monorepo_id: &str, path: &Path) -> Result<()>;
    pub async fn handle_change(&self, event: FileChangeEvent) -> Result<()>;
}
```

**Tests Required**:
- [ ] Test file watching
- [ ] Test change detection
- [ ] Test debouncing
- [ ] Test incremental reindex

#### 7.2 MCP Tools (Auto-Update)

**Tools to Implement**:
23. `strong.watch.start`
24. `strong.watch.stop`
25. `strong.watch.status`
26. `strong.xref.find_usages`
27. `strong.xref.get_dependency_graph`

**Tests Required**:
- [ ] Test each tool
- [ ] Test watch lifecycle

**Deliverables**:
- File watching operational
- 5 new MCP tools

**Success Criteria**:
- [ ] Changes auto-detected
- [ ] Reindexing fast (<100ms)

---

### Phase 8: Testing & Production Hardening (Week 16)

**Status**: ⏳ Pending

**Objectives**:
- Achieve 100% test coverage
- Performance optimization
- Production readiness

**Tasks**:

#### 8.1 Comprehensive Testing

**Test Categories**:
1. **Unit Tests** - All components (target: 500+ tests)
2. **Integration Tests** - Cross-component (target: 100+ tests)
3. **E2E Tests** - Full workflows (target: 50+ tests)
4. **Performance Tests** - Benchmarks (target: 20+ tests)
5. **Migration Tests** - v1→v2 (target: 10+ tests)

**Files to Create**:
- `tests/integration/cross_monorepo.rs`
- `tests/e2e/full_workflow.rs`
- `benches/indexing.rs`
- `benches/search.rs`

**Success Criteria**:
- [ ] 100% code coverage
- [ ] 100% test pass rate
- [ ] No flaky tests
- [ ] All benchmarks pass

#### 8.2 Performance Optimization

**Tasks**:
- [ ] Profile hot paths
- [ ] Optimize RocksDB queries
- [ ] Reduce memory allocations
- [ ] Parallelize where possible

**Performance Targets**:
- Indexing: <10ms per file
- Search: <50ms per query
- Memory: <100MB per 10K files

#### 8.3 Production Readiness

**Tasks**:
- [ ] Error handling review
- [ ] Logging audit
- [ ] Security review
- [ ] Documentation complete

**Deliverables**:
- Production-ready system
- Complete test suite
- Performance benchmarks
- Security audit passed

**Success Criteria**:
- [ ] All tests pass (100%)
- [ ] Performance targets met
- [ ] Security audit clean
- [ ] Documentation complete

---

## Testing Strategy

### Test Pyramid

```
        /\
       /E2\    E2E Tests (50+)
      /----\
     / INT \   Integration Tests (100+)
    /------\
   / UNIT  \  Unit Tests (500+)
  /________\
```

### Coverage Requirements

- **Line Coverage**: 100% (no exceptions)
- **Branch Coverage**: 95%+
- **Function Coverage**: 100%

### Test Types

1. **Unit Tests**: Every public function
2. **Integration Tests**: Component interactions
3. **E2E Tests**: Full user workflows
4. **Performance Tests**: Benchmarks
5. **Migration Tests**: Data migration
6. **Regression Tests**: Bug fixes

### Continuous Testing

- Run tests on every commit
- Block merges if tests fail
- Track coverage trends
- Alert on performance regression

---

## Deployment Strategy

### Incremental Rollout

**Stage 1: Internal Testing** (Weeks 1-8)
- Development team only
- Frequent iterations
- Breaking changes allowed

**Stage 2: Beta Testing** (Weeks 9-14)
- Select users
- Feature-complete
- Bug fixes only

**Stage 3: Production** (Week 16+)
- General availability
- Stable API
- Only critical fixes

### Backward Compatibility

- **v1.x users**: Can upgrade to v2.x seamlessly
- **Migration tool**: Automatic data migration
- **Fallback**: Can revert to v1.x if needed

### Configuration

```toml
# ~/.meridian/meridian.toml
[compatibility]
mode = "global"  # or "single-monorepo" for v1.x behavior
auto_migrate = true
```

---

## Success Metrics

### Functional Metrics

- ✅ All 57 MCP tools implemented
- ✅ 100% test coverage
- ✅ 100% test pass rate
- ✅ Zero critical bugs

### Performance Metrics

- ✅ Indexing: <10ms/file
- ✅ Search: <50ms
- ✅ Memory: <100MB per 10K files
- ✅ Global server: <10ms latency

### Quality Metrics

- ✅ Security audit passed
- ✅ Documentation complete
- ✅ Code review approved
- ✅ Performance benchmarks met

---

## Risk Management

### High Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes to existing tools | High | Extensive testing, backward compat |
| Performance degradation | High | Benchmarks, profiling |
| Data corruption during migration | Critical | Backups, reversible migration |
| Global server SPOF | High | Offline mode, graceful degradation |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Test coverage gaps | Medium | Mandatory coverage checks |
| Documentation lag | Medium | Docs in same PR as code |
| Dependency conflicts | Medium | Lock file, version pinning |

---

## Progress Tracking

### Phase Status

- [ ] Phase 0: Foundation (Week 1)
- [ ] Phase 1: Global Architecture (Weeks 2-3)
- [ ] Phase 2: MCP Integration (Weeks 4-5)
- [ ] Phase 3: Doc Generation (Weeks 6-8)
- [ ] Phase 4: Example/Test Gen (Weeks 9-10)
- [ ] Phase 5: Cross-Monorepo (Weeks 11-12)
- [ ] Phase 6: Agents (Weeks 13-14)
- [ ] Phase 7: Auto-Update (Week 15)
- [ ] Phase 8: Production (Week 16)

### Weekly Checkpoints

Every Friday:
- Review completed tasks
- Update roadmap status
- Address blockers
- Plan next week

---

## Conclusion

This roadmap provides a comprehensive, phased approach to transforming Meridian from a single-monorepo cognitive memory system into a global multi-monorepo knowledge management platform.

**Key Principles**:
- ✅ No compromises on quality
- ✅ Test-driven development
- ✅ Incremental, non-breaking changes
- ✅ Production-ready from day one
- ✅ 100% test coverage, 100% pass rate

**Expected Outcome**:
A production-ready system with 57 MCP tools, supporting multiple monorepos, automated documentation generation, cross-repository access, and agent-driven workflows.

**Timeline**: 16 weeks to production-ready v2.0.0

**Next Step**: Begin Phase 0 - Foundation & Planning ✅
