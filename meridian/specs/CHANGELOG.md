# Meridian Specifications Changelog

All notable changes to the Meridian specifications will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2025-10-18

### Added

#### New Specifications
- **Global Architecture Specification** (global-architecture-spec.md) - v2.0.0
  - Multi-monorepo support architecture
  - Global server with daemon mode
  - Two-tier storage system (global DB + local caches)
  - Identity-based project IDs (path-independent)
  - Cross-repository documentation access
  - Project registry for multiple monorepos

- **Documentation Tools Specification** (documentation-tools-spec.md) - v1.0.0
  - Global documentation catalog system
  - Automated documentation generation (TSDoc/JSDoc, rustdoc)
  - Code example generation with validation
  - Test generation (Jest, Vitest, Bun, Cargo)
  - Documentation quality validation and scoring
  - Agent system integration (Architect, Developer, Tester)

#### English Translations
- **spec-en.md** - English translation of core specification
- **documentation-tools-spec-en.md** - English translation of Documentation Tools spec
- **global-architecture-spec-en.md** - English translation of Global Architecture spec

#### User Guides
- **guides/getting-started.md** - Quick start guide for new users (646 lines)
- **guides/multi-monorepo-setup.md** - Multi-monorepo configuration guide (832 lines)
- **guides/mcp-integration.md** - MCP integration and tool usage guide (1,148 lines)
- **guides/testing-guide.md** - Complete testing documentation (1,030 lines)
- **guides/README.md** - Navigation hub for all guides

#### Schema Documentation
- **schemas/rocksdb-schema.md** - Single source of truth for RocksDB schemas (775 lines)
  - v1.0 schema (legacy, single-monorepo)
  - v2.0 schema (current, multi-monorepo)
  - Migration procedures
  - Performance considerations

- **schemas/mcp-tools-catalog.md** - Complete MCP tools catalog (1,179 lines)
  - 29 core tools (100% implemented)
  - 10 Strong Tools (specified)
  - 10 Specification tools (specified)
  - Total: 49 tools

- **schemas/type-definitions.md** - TypeScript/Rust type definitions

#### Documentation Improvements
- **INDEX.md** - Master index for all specifications
- **SPEC_ANALYSIS.md** - Quality analysis of all specs (94/100 score)
- **RESTRUCTURING_PLAN.md** - Specification ecosystem organization plan
- **CHANGELOG.md** - This file

#### MCP Tools (28 new tools)

**Documentation Tools (10 tools)**:
- `catalog.list_projects` - List all projects in global catalog
- `catalog.get_project` - Get detailed project information
- `catalog.search_documentation` - Search docs across all projects
- `docs.generate` - Generate high-quality documentation
- `docs.validate` - Validate documentation quality
- `docs.transform` - Transform docs to standard formats
- `examples.generate` - Generate code examples
- `examples.validate` - Validate code examples
- `tests.generate` - Generate unit/integration tests
- `tests.validate` - Validate generated tests

**Global Tools (5 tools)**:
- `global.list_monorepos` - List all registered monorepos
- `global.search_all_projects` - Search across all monorepos
- `global.get_dependency_graph` - Get cross-monorepo dependency graph
- `external.get_documentation` - Get docs from external projects
- `external.find_usages` - Find symbol usages across monorepos

**Specification Tools (10 tools)**:
- `specs.list` - List all specifications
- `specs.get_structure` - Get spec structure (TOC, sections)
- `specs.get_section` - Get specific section content
- `specs.search` - Search across all specs
- `specs.validate` - Validate spec completeness
- `specs.compare` - Compare spec versions
- `specs.generate_index` - Generate spec index
- `specs.check_references` - Validate cross-references
- `specs.analyze_coverage` - Analyze implementation coverage
- `specs.sync_status` - Sync spec status with implementation

**Context Management Tool (1 tool)**:
- `context.compress` - Compress context with multiple strategies

**Memory Tool (1 tool)**:
- `memory.get_statistics` - Get memory system statistics

**Documentation Tool (1 tool)**:
- `docs.search` - Enhanced documentation search

### Changed

#### Core Specification (spec.md)
- Added cross-references section to Strong Tools and Global Architecture specs
- Added language switcher for English/Russian versions
- Updated with v2.0.0 version number
- Enhanced MCP tools documentation with new tools

#### MCP Protocol
- Upgraded to MCP Protocol 2025-03-26 (from 2024-11-05)
- Custom MCP implementation (not SDK-based)
- Added HTTP/SSE transport (in addition to STDIO)
- Enhanced JSON-RPC 2.0 compliance

#### Storage System
- Two-tier architecture: Global DB (~/.meridian/data/) + Local caches
- Identity-based project IDs (not path-based)
- Enhanced RocksDB schema with new column families
- Project registry for multi-monorepo support

#### Documentation
- README.md enhanced with quick links and navigation
- All Russian specs now have cross-references and schema links
- Standardized formatting across all specs

### Completed

#### Implementation Phases
- ✅ Phase 0: Foundation & Planning (Week 1)
- ✅ Phase 1: Global Architecture Foundation (Weeks 2-3)
- ✅ Phase 2: Local MCP Server Integration (Weeks 4-5)
- ✅ Phase 3: Strong Tools - Documentation Generation (Weeks 6-8)
- ✅ Phase 4: Strong Tools - Example & Test Generation (Weeks 9-10)
- ✅ Phase 5: Cross-Monorepo Features (Weeks 11-12)
- ✅ Phase 8: Testing & Production Hardening (Week 16)

#### Test Coverage
- **Total Tests**: 431 (100% passing)
- **Coverage**: 96.4% line, 93.2% branch, 100% function
- **Test Categories**:
  - Unit Tests: 44 (10%)
  - Integration Tests: 123 (29%)
  - End-to-End Tests: 109 (25%)
  - MCP Protocol Tests: 24 (6%)
  - Memory System Tests: 78 (18%)
  - Phase-Specific Tests: 53 (12%)

### Deferred

#### Future Phases (v2.1)
- Phase 6: Agent System Integration (Weeks 13-14)
  - Architect Agent (specification management)
  - Developer Agent (implementation context)
  - Tester Agent (comprehensive testing)

- Phase 7: Auto-Update & File Watching (Week 15)
  - File watching system
  - Incremental re-indexing
  - Cache invalidation
  - Auto-documentation updates

### Fixed
- Schema duplication issues resolved with single source of truth in schemas/
- Cross-reference inconsistencies standardized across all specs
- Version numbering now consistent across all documents

### Removed
- Duplicate RocksDB schema definitions from global-architecture-spec.md
- Redundant tool definitions (now in schemas/mcp-tools-catalog.md)

---

## [1.0.0] - 2025-10-01 (Estimated)

### Added

#### Initial Release
- **Core Specification** (spec.md) - v1.0.0
  - Cognitive memory system (4-tier: Episodic, Working, Semantic, Procedural)
  - Adaptive context management (LLM-aware)
  - Code indexing (Tree-sitter: TypeScript, Rust, JavaScript, Python, Go)
  - Session management with Copy-on-Write semantics
  - Git integration (history, blame, evolution)
  - Basic monorepo support

#### MCP Tools (29 core tools)

**Memory Management (4 tools)**:
- `memory.record_episode` - Record task episodes
- `memory.find_similar_episodes` - Find similar past tasks
- `memory.update_working_set` - Update working memory
- `memory.get_statistics` - Get memory stats

**Context Management (2 tools)**:
- `context.prepare_adaptive` - Prepare adaptive context
- `context.defragment` - Defragment scattered context

**Learning & Feedback (3 tools)**:
- `feedback.mark_useful` - Mark symbols useful/unnecessary
- `learning.train_on_success` - Train on successful tasks
- `predict.next_action` - Predict next actions

**Attention Retrieval (2 tools)**:
- `attention.retrieve` - Retrieve based on attention
- `attention.analyze_patterns` - Analyze attention patterns

**Code Navigation (4 tools)**:
- `code.search_symbols` - Search code symbols
- `code.get_definition` - Get symbol definition
- `code.find_references` - Find symbol references
- `code.get_dependencies` - Get dependency graph

**Documentation (1 tool)**:
- `docs.get_for_symbol` - Get symbol documentation

**History & Evolution (2 tools)**:
- `history.get_evolution` - Get file/symbol evolution
- `history.blame` - Get git blame info

**Session Management (4 tools)**:
- `session.begin` - Start isolated session
- `session.update` - Update session files
- `session.query` - Query session context
- `session.complete` - Complete session

**Analytics (2 tools)**:
- `analyze.complexity` - Analyze code complexity
- `analyze.token_cost` - Estimate token costs

**Monorepo (3 tools)**:
- `monorepo.list_projects` - List monorepo projects
- `monorepo.set_context` - Set working context
- `monorepo.find_cross_references` - Find cross-references

#### Storage
- RocksDB backend with efficient key-value storage
- In-memory caching for frequently accessed data
- Session isolation with copy-on-write semantics

#### MCP Protocol
- MCP Protocol 2024-11-05 compliance
- STDIO transport for Claude Code integration
- JSON-RPC 2.0 message format
- Custom MCP implementation (not SDK-based)

#### Documentation
- **roadmap.md** - Implementation roadmap
- Basic README structure

---

## Version Comparison

| Version | Date | Specs | MCP Tools | Tests | Status |
|---------|------|-------|-----------|-------|--------|
| v2.0.0 | 2025-10-18 | 3 core + 3 EN | 49 (29 impl + 20 spec) | 431 | ✅ Production |
| v1.0.0 | 2025-10-01 | 1 core | 29 | 300+ | ✅ Production |

---

## Migration Guide

### From v1.0.0 to v2.0.0

#### Database Migration

```bash
# Automatic migration to global schema
meridian migrate --to-global

# This will:
# 1. Read v1.0 local.db
# 2. Generate project IDs
# 3. Register in global registry
# 4. Copy symbols to global DB with new keys
# 5. Create local cache from global DB
# 6. Backup v1.0 DB to .meridian/backup/
```

#### Configuration Updates

**Old (v1.0.0)**:
```toml
[indexer]
root_path = "/path/to/monorepo"
```

**New (v2.0.0)**:
```toml
[global]
server_mode = "daemon"  # or "embedded"
data_dir = "~/.meridian/data"

[[monorepos]]
path = "/path/to/monorepo1"
id = "my-monorepo"

[[monorepos]]
path = "/path/to/monorepo2"
id = "other-monorepo"
```

#### MCP Client Configuration

**Old (v1.0.0)**:
```json
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"]
    }
  }
}
```

**New (v2.0.0)** - Local mode (same as v1.0):
```json
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"]
    }
  }
}
```

**New (v2.0.0)** - Global mode:
```json
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio", "--global"]
    }
  }
}
```

---

## Specification Statistics

### v2.0.0 Statistics

| Metric | Count | Details |
|--------|-------|---------|
| **Specifications** | 6 | 3 Russian + 3 English |
| **User Guides** | 4 | Getting Started, Multi-Monorepo, MCP, Testing |
| **Schema Docs** | 3 | RocksDB, MCP Tools, Type Definitions |
| **Total Lines** | 15,000+ | Across all documentation |
| **MCP Tools** | 49 | 29 implemented + 20 specified |
| **Test Coverage** | 96.4% | Line coverage |
| **Tests Passing** | 431/431 | 100% pass rate |

### Documentation Quality Score

Based on SPEC_ANALYSIS.md:

| Specification | Score | Status |
|---------------|-------|--------|
| **spec.md** | 95/100 | ✅ Excellent |
| **roadmap.md** | 98/100 | ✅ Excellent |
| **strong-tools-spec.md** | 92/100 | ✅ Very Good |
| **global-architecture-spec.md** | 90/100 | ✅ Very Good |
| **Overall** | 94/100 | ✅ Excellent |

---

## Links

- **Master Index**: [INDEX.md](./INDEX.md)
- **README**: [README.md](./README.md)
- **Roadmap**: [roadmap.md](./roadmap.md)
- **Quality Analysis**: [SPEC_ANALYSIS.md](./SPEC_ANALYSIS.md)
- **Restructuring Plan**: [RESTRUCTURING_PLAN.md](./RESTRUCTURING_PLAN.md)

### Core Specifications
- **Core System**: [spec.md](./spec.md) | [spec-en.md](./spec-en.md)
- **Strong Tools**: [strong-tools-spec.md](./strong-tools-spec.md) | [strong-tools-spec-en.md](./strong-tools-spec-en.md)
- **Global Architecture**: [global-architecture-spec.md](./global-architecture-spec.md) | [global-architecture-spec-en.md](./global-architecture-spec-en.md)

### Schemas
- [RocksDB Schema](./schemas/rocksdb-schema.md)
- [MCP Tools Catalog](./schemas/mcp-tools-catalog.md)
- [Type Definitions](./schemas/type-definitions.md)

### User Guides
- [Getting Started](./guides/getting-started.md)
- [Multi-Monorepo Setup](./guides/multi-monorepo-setup.md)
- [MCP Integration](./guides/mcp-integration.md)
- [Testing Guide](./guides/testing-guide.md)

---

**Maintained by**: Meridian Development Team
**Last Updated**: October 18, 2025
**Next Release**: v2.1 (Agent System + Auto-Update)
