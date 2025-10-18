# Meridian MCP Tools - Quick Reference Inventory

**Last Updated**: October 18, 2025
**Total Tools**: 49 implemented, 32 in design (81 total)

---

## Implemented Tools (49)

### ✅ PRODUCTION READY (34 tools)

#### Memory Management (4)
- `memory.record_episode` - Record task patterns for learning
- `memory.find_similar_episodes` - Find similar past tasks
- `memory.update_working_set` - Update attention weights
- `memory.get_statistics` - Memory system statistics

#### Context Management (3)
- `context.prepare_adaptive` - LLM-specific context preparation
- `context.defragment` - Unify scattered context
- `context.compress` - Compress with 8 strategies

#### Code Navigation (4)
- `code.search_symbols` - Search symbols with filters
- `code.get_definition` - Get symbol definition
- `code.find_references` - Find references to symbol
- `code.get_dependencies` - Dependency graph

#### Session Management (4)
- `session.begin` - Start isolated work session
- `session.update` - Update session with changes
- `session.query` - Query within session
- `session.complete` - Complete session (commit/discard/stash)

#### Feedback & Learning (3)
- `feedback.mark_useful` - Mark symbols useful/unnecessary
- `learning.train_on_success` - Train on successful tasks
- `predict.next_action` - Predict next action

#### Attention-Based Retrieval (2)
- `attention.retrieve` - Retrieve by attention patterns
- `attention.analyze_patterns` - Analyze focus and drift

#### Documentation (2)
- `docs.search` - Search docs/markdown
- `docs.get_for_symbol` - Get docs for symbol

#### History (2)
- `history.get_evolution` - File/symbol evolution
- `history.blame` - Git blame information

#### Analysis (2)
- `analyze.complexity` - Code complexity metrics
- `analyze.token_cost` - Token cost estimation

#### Monorepo (3)
- `monorepo.list_projects` - List projects
- `monorepo.set_context` - Set project context
- `monorepo.find_cross_references` - Find cross-refs

#### Specifications (5)
- `specs.list` - List all specs
- `specs.get_structure` - Get spec TOC
- `specs.get_section` - Get specific section
- `specs.search` - Search across specs
- `specs.validate` - Validate spec quality

---

### ⚠️ STUB IMPLEMENTATIONS (15 tools)

These tools exist in handlers but return placeholder data:

#### Catalog (3)
- `catalog.list_projects` - List global catalog
- `catalog.get_project` - Get project details
- `catalog.search_documentation` - Search global docs

#### Documentation Generation (3)
- `docs.generate` - Generate documentation
- `docs.validate` - Validate doc quality
- `docs.transform` - Transform doc format

#### Examples (2)
- `examples.generate` - Generate code examples
- `examples.validate` - Validate examples

#### Tests (2)
- `tests.generate` - Generate unit/integration tests
- `tests.validate` - Validate generated tests

#### Global (3)
- `global.list_monorepos` - List all monorepos
- `global.search_all_projects` - Search all projects
- `global.get_dependency_graph` - Cross-project dependencies

#### External (2)
- `external.get_documentation` - Get external project docs
- `external.find_usages` - Find global symbol usages

---

## Not Implemented - Design Phase (32)

### 📋 Spec Management Tools (20)

#### Task Management (6)
- `specs.tasks.list_all` - Extract all tasks from specs
- `specs.tasks.get_unimplemented` - Get unimplemented tasks
- `specs.tasks.update_status` - Update task status
- `specs.tasks.get_blocked` - Find blocked tasks
- `specs.tasks.create` - Create new task
- `specs.tasks.get_dependencies` - Get task dependency graph

#### Progress Tracking (5)
- `specs.progress.overall` - Overall implementation progress
- `specs.progress.by_phase` - Progress by phase
- `specs.progress.by_spec` - Progress by spec file
- `specs.progress.velocity` - Completion velocity
- `specs.progress.forecast` - Forecast completion dates

#### Specification Modification (5)
- `specs.modify.update_section` - Update spec section
- `specs.modify.insert_task` - Insert task into spec
- `specs.modify.update_metadata` - Update spec metadata
- `specs.modify.add_cross_reference` - Add cross-reference
- `specs.modify.apply_template` - Apply template

#### Querying (4)
- `specs.query.find_requirements` - Find requirements
- `specs.query.get_related_tasks` - Get tasks related to code
- `specs.query.search_by_phase` - Search within phase
- `specs.query.get_critical_path` - Get critical path

---

### 📋 Semantic Links Tools (12)

#### Link Discovery (4)
- `links.find_implementation` - Find code implementing spec
- `links.find_documentation` - Find docs for code
- `links.find_examples` - Find usage examples
- `links.find_tests` - Find tests for symbol

#### Link Management (4)
- `links.create` - Create semantic link
- `links.update` - Update link metadata
- `links.delete` - Delete link
- `links.validate` - Validate link still valid

#### Link Analysis (4)
- `links.trace_path` - Trace spec→code→docs→tests
- `links.find_orphans` - Find unlinked entities
- `links.search` - Search links
- `links.get_health` - Link health metrics

---

## Quick Stats

| Category | Implemented | Stubs | Not Impl | Total |
|----------|-------------|-------|----------|-------|
| Core Tools | 34 | 0 | 0 | 34 |
| Strong Tools | 0 | 15 | 0 | 15 |
| Spec Mgmt | 0 | 0 | 20 | 20 |
| Semantic Links | 0 | 0 | 12 | 12 |
| **TOTAL** | **34** | **15** | **32** | **81** |

---

## Token Efficiency by Tool Type

| Tool Type | Avg Tokens (Standard) | Avg Tokens (MCP) | Reduction |
|-----------|----------------------|------------------|-----------|
| Spec Reading | 9,000 | 500 | 94.4% |
| Symbol Search | 3,500 | 200 | 94.3% |
| Doc Lookup | 8,000 | 300 | 96.3% |
| Session Context | 5,000/turn | 300/turn | 94.0% |
| Dependency Graph | 5,000 | 400 | 92.0% |
| History Lookup | 7,000 | 500 | 92.9% |
| **Average** | **6,250** | **367** | **94.1%** |

---

## Implementation Priority

### High Priority (Do First)
1. Semantic Links Discovery (4 tools) - 95% token reduction
2. Spec Task Management (6 tools) - 70% token reduction
3. Progress Tracking (5 tools) - 90% token reduction

### Medium Priority (Do Later)
4. Semantic Links Analysis (4 tools) - Health monitoring
5. Spec Modification (5 tools) - Automated updates
6. Strong Tools (15 stubs) - Complete implementations

### Low Priority (Nice to Have)
7. Link Management (4 tools) - Manual link editing
8. Spec Querying (4 tools) - Advanced search
9. Advanced Progress (2 tools) - Velocity/forecast

---

## Related Documents

- **Full Analysis**: `MCP_TOOLS_EFFICIENCY_ANALYSIS.md`
- **Spec Management Spec**: `specs/MCP_TOOLS_SPEC_MANAGEMENT.md`
- **Semantic Links Spec**: `specs/schemas/semantic-links-spec.md`
- **Implementation Roadmap**: `specs/roadmap.md`
- **Core Spec**: `specs/spec.md`

---

**Status Legend**:
- ✅ Production Ready - Fully implemented and tested
- ⚠️ Stub - Registered but returns placeholder data
- 📋 Design Phase - Specification complete, not yet coded
