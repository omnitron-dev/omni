# MCP Tools for Specification Management - Summary

**Full Specification**: [MCP_TOOLS_SPEC_MANAGEMENT.md](./MCP_TOOLS_SPEC_MANAGEMENT.md)
**Version**: 1.0.0
**Date**: October 18, 2025

---

## Quick Overview

This specification defines **20+ MCP tools** for specification management in Meridian, enabling LLM agents to efficiently work with software specifications.

### Tool Categories (20 Tools)

| Category | Count | Purpose | Example Tool |
|----------|-------|---------|--------------|
| **Task Management** | 6 | Extract, track, update tasks | `specs.task.list_all` |
| **Progress Tracking** | 5 | Monitor implementation progress | `specs.progress.get_overall` |
| **Spec Modification** | 5 | Update specs programmatically | `specs.modify.update_section` |
| **Querying** | 4 | Advanced search and navigation | `specs.query.find_by_topic` |

---

## Tool Catalog

### Task Management Tools (6)

1. **`specs.task.list_all`**
   - Extract all tasks from specifications
   - Filter by spec, phase, status, priority
   - Token efficiency: ~20-60 tokens/task (configurable detail level)

2. **`specs.task.get_unimplemented`**
   - Get unimplemented tasks sorted by priority
   - Includes readiness scores and effort estimates
   - Returns recommended implementation order

3. **`specs.task.update_status`**
   - Update task status (not_started → in_progress → complete)
   - Auto-updates spec files (optional)
   - Records in episodic memory for learning

4. **`specs.task.get_blocked`**
   - Get tasks blocked by dependencies
   - Includes resolution suggestions
   - Shows blocking task details

5. **`specs.task.create`**
   - Create new task programmatically
   - Auto-links to requirements
   - Validates dependencies

6. **`specs.task.get_dependencies`**
   - Get full dependency graph for tasks
   - Detect circular dependencies
   - Find critical path
   - Generate Mermaid visualizations

### Progress Tracking Tools (5)

7. **`specs.progress.get_overall`**
   - Overall progress across all specs
   - Group by spec, phase, priority, or tag
   - Includes trend analysis and forecasts

8. **`specs.progress.get_by_spec`**
   - Detailed progress for specific spec
   - Phase-by-phase breakdown
   - Milestone tracking
   - Recent activity summary

9. **`specs.progress.get_by_phase`**
   - Cross-spec phase progress
   - Phase dependencies
   - Critical path identification

10. **`specs.progress.calculate_completion_percentage`**
    - Accurate completion % with multiple weighting strategies
    - Equal, priority, effort, or blocking-based weighting
    - Includes calculation breakdown

11. **`specs.progress.get_velocity`**
    - Implementation velocity metrics
    - Historical trends
    - Burnout risk detection
    - Forecasts with confidence intervals

### Specification Modification Tools (5)

12. **`specs.modify.update_section`**
    - Update section content safely
    - Modes: replace, append, prepend, merge
    - Auto-backup and validation
    - Git integration

13. **`specs.modify.add_requirement`**
    - Add new requirement to spec
    - Auto-create linked task
    - Structured requirement format
    - ID generation

14. **`specs.modify.deprecate_requirement`**
    - Mark requirement as deprecated
    - Provide migration path
    - Update related tasks
    - Generate migration guide

15. **`specs.modify.create_spec`**
    - Create new specification from template
    - Templates: core, feature, architecture, user guide
    - Auto-indexing in INDEX.md

16. **`specs.modify.merge_sections`**
    - Merge multiple sections intelligently
    - De-duplicate content
    - Conflict detection and resolution
    - Preserve unique information

### Querying Tools (4)

17. **`specs.query.find_by_topic`**
    - Find all mentions of a topic
    - Semantic and fuzzy search
    - Context snippets
    - Related topics

18. **`specs.query.find_requirements`**
    - Find requirements by criteria
    - Filter by type, priority, status, tags
    - Include implementation status
    - Link to tasks

19. **`specs.query.get_cross_references`**
    - Get all cross-references for a section/requirement/task
    - Build reference graph
    - Detect broken links
    - Validate external URLs

20. **`specs.query.find_duplicates`**
    - Find duplicate/similar content
    - Configurable similarity threshold
    - Consolidation suggestions
    - Estimate savings

---

## Key Features

### Token Efficiency Strategies

1. **Progressive Detail Loading**: Minimal → Summary → Standard → Full
2. **Smart Filtering**: Return only relevant data
3. **Pagination**: Results in pages
4. **Result Caching**: Cache expensive queries
5. **Compression**: Compress large text fields
6. **Delta Updates**: Return only changes
7. **Summary-First**: Always provide summary before details

**Result**: 85-95% token reduction vs manual spec reading

### Integration with Existing Tools

The specification tools integrate seamlessly with Meridian's existing 29 MCP tools:

- **`memory.*`**: Task completion → episodic memory → learning
- **`session.*`**: Work sessions linked to tasks
- **`code.*`**: Navigate code related to tasks
- **`context.*`**: Prepare context for task implementation

### Example Workflows

#### 1. Task Implementation Workflow
```
1. specs.task.get_unimplemented → Find next task
2. memory.find_similar_episodes → Learn from past
3. session.begin → Start work
4. code.search_symbols → Find related code
5. [Implementation work]
6. specs.task.update_status → Mark complete
7. memory.record_episode → Record for learning
```
**Token cost**: ~3,000 tokens (vs ~15,000 without tools)

#### 2. Progress Reporting Workflow
```
1. specs.progress.get_overall → Overall metrics
2. specs.progress.get_velocity → Velocity trends
3. specs.task.get_blocked → Blockers
4. specs.progress.get_by_spec → Per-spec breakdown
```
**Token cost**: ~2,500 tokens (vs ~20,000 manual)

#### 3. Spec Maintenance Workflow
```
1. specs.query.find_by_topic → Find all mentions
2. specs.query.find_duplicates → Detect duplication
3. specs.modify.update_section → Update sections
4. specs.task.update_status → Update affected tasks
5. specs.validate → Ensure quality
```
**Token cost**: ~4,000 tokens (vs ~30,000 manual)

---

## Implementation Details

### Architecture

**New Modules** (to be created):
```rust
src/specs/
├── task_manager.rs       // Task extraction, tracking
├── task_registry.rs      // Central task registry
├── progress_tracker.rs   // Progress calculation
├── progress_calculator.rs // Velocity, forecasting
├── spec_modifier.rs      // Spec file modifications
├── requirement_manager.rs // Requirement CRUD
└── query_engine.rs       // Advanced querying
```

**Integration Points**:
- Extends existing `src/specs/spec_manager.rs`
- Uses existing `src/memory/` for learning
- Uses existing `src/session/` for work tracking
- Uses existing `src/git/` for version control

### Type System

**Core Types**:
- `Task`: All task metadata, dependencies, status
- `Requirement`: Requirements with acceptance criteria
- `ProgressSummary`: Progress metrics
- `VelocityMetrics`: Velocity and trends
- `DependencyGraph`: Task dependency graph

All types have both **TypeScript** (for spec) and **Rust** (for implementation) definitions.

### Testing Requirements

**Coverage**: 85% minimum (100% for critical paths)

**Test Categories**:
- Unit tests: 200+
- Integration tests: 50+
- MCP tool tests: 20 (one per tool)
- E2E tests: 10+
- Performance tests: 15+

---

## Implementation Effort

**Estimated Effort**:
- Implementation: ~1,500 LOC
- Testing: ~800 LOC
- **Total**: ~2,300 LOC

**Timeline**: 2-3 weeks

**Breakdown**:
1. Week 1: Core types, registries, task manager
2. Week 2: Progress tracker, spec modifier, query engine
3. Week 3: MCP handlers, testing, integration

---

## Token Efficiency Metrics

### Per-Tool Token Cost

| Tool | Minimal | Standard | Full |
|------|---------|----------|------|
| `specs.task.list_all` | 400 | 1,000 | 3,000 |
| `specs.task.get_unimplemented` | 300 | 600 | 1,200 |
| `specs.progress.get_overall` | 200 | 400 | 1,000 |
| `specs.progress.get_velocity` | 200 | 500 | 800 |
| `specs.modify.update_section` | 200 | 300 | 500 |
| `specs.query.find_by_topic` | 500 | 1,000 | 2,000 |

### Comparison: With vs Without Tools

| Task | Manual | With Tools | Savings |
|------|--------|------------|---------|
| Find next task to implement | 5,000 | 600 | 88% |
| Check project progress | 8,000 | 400 | 95% |
| Update spec after implementation | 12,000 | 300 | 97% |
| Find all mentions of a topic | 15,000 | 1,000 | 93% |
| **Average** | **10,000** | **575** | **94%** |

---

## Examples

### Example 1: List Unimplemented Tasks

**Request**:
```json
{
  "tool": "specs.task.get_unimplemented",
  "arguments": {
    "min_priority": "high",
    "limit": 10,
    "include_dependencies": true
  }
}
```

**Response** (~600 tokens):
```json
{
  "tasks": [
    {
      "id": "task_strong_tools_gen_001",
      "title": "Generate documentation with examples",
      "phase": "Phase 2",
      "status": "not_started",
      "priority": "high",
      "readiness_score": 85,
      "blocking_count": 3,
      "recommended_order": 1,
      "effort_estimate": {
        "tokens": 12000,
        "lines_of_code": 450,
        "complexity": "medium",
        "time_estimate_hours": 8
      }
    }
    // ... 9 more tasks
  ],
  "next_recommended": ["task_strong_tools_gen_001", ...],
  "blocking_count": 5,
  "total_unimplemented": 32,
  "estimated_total_tokens": 145000
}
```

### Example 2: Get Overall Progress

**Request**:
```json
{
  "tool": "specs.progress.get_overall",
  "arguments": {
    "group_by": "phase",
    "include_trends": true
  }
}
```

**Response** (~850 tokens):
```json
{
  "summary": {
    "total_tasks": 156,
    "completed": 98,
    "in_progress": 12,
    "not_started": 38,
    "blocked": 8,
    "completion_percentage": 67.3
  },
  "by_group": [
    {
      "group_name": "Phase 1",
      "tasks": { "completion_percentage": 100.0 },
      "estimated_tokens_remaining": 0
    },
    {
      "group_name": "Phase 2",
      "tasks": { "completion_percentage": 93.75 },
      "estimated_tokens_remaining": 18500
    }
  ],
  "trends": {
    "velocity": {
      "tasks_per_day": 2.4,
      "current_streak_days": 12,
      "trend": "stable"
    },
    "forecasts": [
      {
        "scenario": "realistic",
        "completion_date": "2025-11-18",
        "confidence": 85
      }
    ]
  }
}
```

### Example 3: Update Section

**Request**:
```json
{
  "tool": "specs.modify.update_section",
  "arguments": {
    "spec_name": "spec-en",
    "section_name": "Token Saving Strategy",
    "new_content": "## Updated Strategy\n...",
    "mode": "replace",
    "commit_message": "docs: update token saving strategy",
    "validate_before": true
  }
}
```

**Response**:
```json
{
  "success": true,
  "section_updated": "Token Saving Strategy",
  "line_range": [1318, 1342],
  "validation_result": { "valid": true, "score": 100 },
  "git_commit": "a7b8c9d",
  "diff_summary": {
    "lines_added": 8,
    "lines_removed": 5,
    "content_preview": "+ ## Updated Strategy..."
  },
  "affected_tasks": ["task_spec_en_phase1_context_004"]
}
```

---

## Status & Next Steps

**Current Status**: ✅ Design Complete - Ready for Implementation

**Next Steps**:
1. ✅ Review and approve specification
2. Create implementation tasks
3. Implement core modules (task registry, progress tracker)
4. Implement MCP handlers for 20 tools
5. Write comprehensive tests (300+ tests)
6. Integration testing
7. Documentation and examples
8. Production release

**Target Release**: Meridian v2.1.0

---

## Related Documentation

- **Full Specification**: [MCP_TOOLS_SPEC_MANAGEMENT.md](./MCP_TOOLS_SPEC_MANAGEMENT.md)
- **Current Spec Tools**: [SPECIFICATION_SYSTEM.md](../SPECIFICATION_SYSTEM.md)
- **MCP Protocol**: [spec-en.md](./spec-en.md#mcp-interface)
- **Implementation Roadmap**: [roadmap.md](./roadmap.md)

---

**Document Version**: 1.0.0
**Last Updated**: October 18, 2025
**Authors**: Meridian Development Team
