# Progress Tracking System - Design Complete

**Status:** Ready to Implement
**Date:** 2025-10-18
**Estimated Effort:** 3 weeks

## What Was Delivered

### 1. Full Specification (14,000+ words)

**Location:** `/meridian/specs/progress-tracking-tools-spec.md`

**Contents:**
- ✅ 10 MCP tools fully specified
- ✅ Complete Rust type definitions
- ✅ RocksDB storage schema
- ✅ Integration patterns (Memory, Specs, Sessions, Git)
- ✅ Token efficiency analysis (70% reduction)
- ✅ Testing strategy
- ✅ 20+ usage examples

### 2. Implementation Roadmap

**Location:** `/meridian/PROGRESS_ROADMAP.md`

**Breakdown:**
- ✅ 6 phases with clear deliverables
- ✅ 15 working days (3 weeks)
- ✅ Task-by-task checklist
- ✅ Success metrics
- ✅ Risk assessment
- ✅ Testing strategy

### 3. Working Code Stubs

**Files Created:**
```
meridian/src/progress/
├── mod.rs        ✅ Module structure
├── types.rs      ✅ Task, TaskStatus, Priority, etc.
├── storage.rs    ✅ RocksDB operations + indices
├── manager.rs    ✅ ProgressManager with caching
└── tests.rs      ✅ Test stubs
```

**Status:** Compiles with basic unit tests

---

## The Problem We're Solving

### Current State: TodoWrite

**Issues:**
- ❌ No persistence (lost on restart)
- ❌ High token cost (~500 tokens per update)
- ❌ No spec integration
- ❌ No memory integration (manual episode recording)
- ❌ No querying/filtering
- ❌ No progress tracking
- ❌ Easy to forget

### Solution: Progress Tracking System

**Benefits:**
- ✅ RocksDB persistence (survives restarts)
- ✅ 70% token reduction (~100-150 tokens)
- ✅ Spec section linking with validation
- ✅ Auto-record episodes on completion
- ✅ Rich querying (status, spec, session, priority)
- ✅ Progress percentages & statistics
- ✅ MCP-native (not external tool)

---

## The 10 MCP Tools

### Core Tools (Phase 1-2)

1. **progress.create_task**
   - Input: title, description, priority, spec_ref, tags, estimate
   - Output: task_id, status
   - Tokens: ~80-130

2. **progress.update_task**
   - Input: task_id, updates (title, status, priority, etc.)
   - Output: task_id, previous_status, new_status
   - Tokens: ~100-160

3. **progress.list_tasks**
   - Input: filters (status, spec, session, priority), sort, limit
   - Output: TaskSummary[] (id, title, status, priority, updated_at)
   - Tokens: ~90-280 (vs 500 with TodoWrite)

4. **progress.get_task**
   - Input: task_id, include_history
   - Output: Full Task object
   - Tokens: ~170-320

5. **progress.delete_task**
   - Input: task_id, confirm
   - Output: deleted, task_id
   - Tokens: ~35

### Advanced Tools (Phase 3)

6. **progress.get_progress**
   - Input: spec_name (optional), group_by
   - Output: Statistics (total, pending, done, percentage, by_spec, by_priority)
   - Tokens: ~120-240

7. **progress.search_tasks**
   - Input: query, status_filter, limit
   - Output: Search results with relevance scores
   - Tokens: ~80-220

8. **progress.link_to_spec**
   - Input: task_id, spec_name, section, validate
   - Output: Linked spec reference
   - Tokens: ~70-90

9. **progress.get_history**
   - Input: task_id
   - Output: StatusTransition[] (all status changes)
   - Tokens: ~75-165

### Integration Tool (Phase 4)

10. **progress.mark_complete**
    - Input: task_id, actual_hours, commit_hash, solution, files, queries
    - Output: task_id, episode_id, episode_recorded
    - **Side Effect:** Automatically calls `memory.record_episode`
    - Tokens: ~130-200

---

## Key Features

### 1. Persistence (RocksDB)

**Storage Schema:**
```
task:{id}                  → Task (bincode)
idx_status:{status}:{id}   → Marker (fast filtering)
idx_spec:{spec}:{id}       → Marker (spec queries)
idx_session:{session}:{id} → Marker (session queries)
idx_priority:{priority}:{id} → Marker (priority queries)
```

**Benefits:**
- Tasks survive restarts
- O(1) lookups by status/spec
- Fast filtering without full scan
- Efficient range queries

### 2. Token Efficiency (70% reduction)

**Design Patterns:**
- **Summary-First:** List returns minimal TaskSummary
- **Progressive Loading:** Get full details only when needed
- **Server-Side Filtering:** Don't fetch unused data
- **Compact JSON:** Skip null fields, use enums

**Comparison:**
| Operation | TodoWrite | Progress | Savings |
|-----------|-----------|----------|---------|
| List 10 tasks | ~500 | ~150 | 70% |
| Get task | N/A | ~200 | N/A |
| Mark complete | ~500 | ~150 | 70% |

### 3. Memory Integration

**Auto-Episode Recording:**
```rust
// When you call:
progress.mark_complete({
  task_id: "abc123",
  solution_summary: "Implemented feature X",
  files_touched: ["src/main.rs"],
  queries_made: ["code.search_symbols FeatureX"]
})

// System automatically:
1. Updates task status to Done
2. Creates TaskEpisode from task data
3. Calls memory.record_episode()
4. Links episode ID back to task
5. Memory system learns patterns
```

**No more manual episode recording!**

### 4. Spec Integration

**Spec Linking with Validation:**
```typescript
// Link task to spec section
await progress.link_to_spec({
  task_id: "abc123",
  spec_name: "progress-tracking-tools-spec",
  section: "Implementation Plan",
  validate: true  // Verifies section exists
});

// Get coverage
const coverage = await progress.get_progress({
  spec_name: "progress-tracking-tools-spec",
  group_by: "spec"
});
// => { total: 15, done: 7, percentage: 46.7% }
```

### 5. Session Awareness

**Track Active Task:**
- Session knows what you're currently working on
- Auto-updates when task status → InProgress
- Query tasks by session ID

**Git Integration:**
- Link tasks to commits
- Find tasks by commit hash
- Optional commit validation

---

## Data Model

### Core Types

```rust
/// Unique task identifier
pub struct TaskId(pub String);

/// Task status with transition validation
pub enum TaskStatus {
    Pending,      // Not started
    InProgress,   // Currently working
    Blocked,      // External dependency
    Done,         // Completed (terminal)
    Cancelled,    // Abandoned (terminal)
}

/// Priority levels
pub enum Priority {
    Low,
    Medium,
    High,
    Critical,
}

/// Reference to spec section
pub struct SpecReference {
    pub spec_name: String,  // e.g., "spec", "roadmap"
    pub section: String,    // e.g., "Phase 1", "MCP Tools"
}

/// Full task
pub struct Task {
    pub id: TaskId,
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub priority: Priority,
    pub spec_ref: Option<SpecReference>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub history: Vec<StatusTransition>,
    pub tags: Vec<String>,
    pub estimated_hours: Option<f32>,
    pub actual_hours: Option<f32>,
    pub commit_hash: Option<String>,
    pub episode_id: Option<String>,
    // ... more fields
}

/// Minimal summary (for lists)
pub struct TaskSummary {
    pub id: TaskId,
    pub title: String,
    pub status: TaskStatus,
    pub priority: Priority,
    pub spec_ref: Option<SpecReference>,
    pub updated_at: DateTime<Utc>,
}
```

### Status Transitions

**Validation Rules:**
```
Pending     → InProgress, Cancelled
InProgress  → Blocked, Done, Cancelled
Blocked     → InProgress, Cancelled
Done        → (terminal, no transitions)
Cancelled   → (terminal, no transitions)
```

**History Tracking:**
Every status change recorded with:
- Timestamp
- From status (optional for creation)
- To status
- Note (why)

---

## Implementation Timeline

### Week 1: Core + MCP

**Days 1-3: Phase 1 - Core Infrastructure**
- Implement types with validation
- Storage layer (RocksDB operations)
- ProgressManager (CRUD + filtering)
- Unit tests (80%+ coverage)
- Performance tests (1000+ tasks)

**Days 4-5: Phase 2 - MCP Integration**
- Add tool definitions
- Implement MCP handlers
- Wire up to MCP server
- Integration tests
- Test with Claude Code

**Deliverable:** 5 working MCP tools

### Week 2: Advanced + Memory

**Days 1-3: Phase 3 - Advanced Features**
- Progress statistics calculation
- Full-text search
- Spec linking with validation
- History retrieval
- 4 new MCP tools

**Days 4-5: Phase 4 - Memory Integration**
- Auto-episode recording
- Memory system integration
- Episode data mapping
- Integration tests
- `progress.mark_complete` tool

**Deliverable:** All 10 tools working, auto-episodes

### Week 3: Integration + Polish

**Days 1-2: Phase 5 - Session & Git**
- Active task tracking
- Session integration
- Commit linking
- Query by commit

**Days 3-5: Phase 6 - Polish**
- Error handling review
- Performance optimization
- User guide (`progress-guide.md`)
- Examples and troubleshooting
- Token cost documentation
- Final testing

**Deliverable:** Production-ready system

---

## How to Start

### 1. Verify Stubs Compile

```bash
cd meridian
cargo build
cargo test --package meridian --lib progress
```

**Expected:** All stubs compile, basic tests pass

### 2. Review Specification

Read `/meridian/specs/progress-tracking-tools-spec.md` for:
- Detailed tool specs
- Integration patterns
- Examples

### 3. Start Phase 1

**First Task:** Complete type validation tests

```bash
# Open types.rs
code src/progress/types.rs

# Add comprehensive tests
# - Task creation
# - Status transitions (valid + invalid)
# - TaskSummary conversion
# - Priority/Status display

# Run tests in watch mode
cargo watch -x "test --package meridian --lib progress::types::tests"
```

### 4. Follow Roadmap

Work through phases sequentially:
1. ✅ Types → Storage → Manager (Week 1)
2. ✅ MCP handlers (Week 1)
3. ✅ Advanced features (Week 2)
4. ✅ Memory integration (Week 2)
5. ✅ Polish (Week 3)

---

## Success Metrics

### Functional

- ✅ All 10 MCP tools implemented
- ✅ Tasks persist across restarts
- ✅ Status transitions validated
- ✅ Auto-episode recording works
- ✅ Spec linking with validation
- ✅ Session integration
- ✅ 80%+ test coverage

### Performance

- ✅ Create task: < 10ms
- ✅ List 100 tasks: < 50ms
- ✅ Get task: < 5ms (cached)
- ✅ Progress calc: < 100ms
- ✅ Handles 10,000+ tasks

### Token Efficiency

- ✅ List tasks: ~100 tokens (vs 500)
- ✅ Get task: ~200 tokens
- ✅ Mark complete: ~150 tokens
- ✅ 70%+ average savings

---

## Example Workflows

### Implementing a Spec

```typescript
// Create tasks for each section
const phase1 = await progress.create_task({
  title: "Phase 1: Core Infrastructure",
  spec_name: "progress-tracking-tools-spec",
  section: "Implementation Plan",
  priority: "critical",
  estimated_hours: 16
});

// Start work
await progress.update_task({
  task_id: phase1.task_id,
  status: "in_progress"
});

// Check progress
const stats = await progress.get_progress({
  spec_name: "progress-tracking-tools-spec"
});
// => { total: 6, done: 0, in_progress: 1, percentage: 0% }

// Complete with auto-episode
await progress.mark_complete({
  task_id: phase1.task_id,
  actual_hours: 18,
  commit_hash: "abc123",
  solution_summary: "Implemented types, storage, manager",
  files_touched: ["src/progress/types.rs", "src/progress/storage.rs"],
  queries_made: ["code.search_symbols RocksDB"]
});
// => Episode automatically recorded!
```

### Bug Fix

```typescript
// Create bug task
const bug = await progress.create_task({
  title: "Fix: status filter returns all statuses",
  priority: "high",
  tags: ["bug", "storage"]
});

// Start → Blocked → Resume → Done
await progress.update_task({ task_id: bug.task_id, status: "in_progress" });
await progress.update_task({ task_id: bug.task_id, status: "blocked", status_note: "Waiting for review" });
await progress.update_task({ task_id: bug.task_id, status: "in_progress" });

// Complete
await progress.mark_complete({
  task_id: bug.task_id,
  actual_hours: 1.5,
  solution_summary: "Fixed status index lookup logic"
});

// View history
const history = await progress.get_history({ task_id: bug.task_id });
// => [created → in_progress → blocked → in_progress → done]
```

---

## Architecture Diagram

```
┌─────────────────────────────────────┐
│        MCP Client (Claude)          │
│  progress.create_task               │
│  progress.list_tasks                │
│  progress.mark_complete             │
└────────────────┬────────────────────┘
                 │ MCP Protocol
                 ▼
┌─────────────────────────────────────┐
│       Progress Manager              │
│  • CRUD operations                  │
│  • Status validation                │
│  • LRU cache (100 items)            │
│  • Progress calculation             │
└────────────┬────────────────────────┘
             │
    ┌────────┼────────┐
    ▼        ▼        ▼
┌────────┐ ┌────────┐ ┌────────┐
│RocksDB │ │ Memory │ │  Spec  │
│Storage │ │ System │ │Manager │
└────────┘ └────────┘ └────────┘
    │
    ├── task:{id}
    ├── idx_status:{status}:{id}
    ├── idx_spec:{spec}:{id}
    └── idx_session:{session}:{id}
```

---

## What's Different from TodoWrite

| Feature | TodoWrite | Progress System |
|---------|-----------|----------------|
| Persistence | ❌ Session only | ✅ RocksDB |
| Token Cost | ~500/op | ~150/op (70% ↓) |
| Spec Integration | ❌ None | ✅ Validation |
| Memory Integration | ❌ Manual | ✅ Auto-record |
| Filtering | ❌ Client-side | ✅ Server-side |
| Progress % | ❌ Manual | ✅ Auto-calc |
| History | ❌ None | ✅ Full transitions |
| Search | ❌ None | ✅ Full-text |
| Session Aware | ❌ No | ✅ Active task |
| Git Linking | ❌ No | ✅ Commit hash |

---

## Next Action

**Start Phase 1 immediately:**

```bash
cd meridian/src/progress
code types.rs

# Complete these tests:
# - test_task_creation ✅ (exists)
# - test_valid_status_transition ✅ (exists)
# - test_invalid_status_transition ✅ (exists)
# - test_task_summary_conversion ✅ (exists)
# - test_completed_at_set_on_done (add)
# - test_history_recording (add)
# - test_terminal_states (add)
```

**Then:**
```bash
cargo test --package meridian --lib progress::types::tests
```

**Goal:** 100% test coverage on types before moving to storage

---

## Files to Reference

### Specification
- `/meridian/specs/progress-tracking-tools-spec.md` - Main spec (14,000 words)

### Roadmap
- `/meridian/PROGRESS_ROADMAP.md` - Detailed implementation plan

### Code
- `/meridian/src/progress/types.rs` - Type definitions
- `/meridian/src/progress/storage.rs` - RocksDB layer
- `/meridian/src/progress/manager.rs` - High-level manager

### Related
- `/meridian/src/memory/episodic.rs` - Episode recording pattern
- `/meridian/src/specs/spec_manager.rs` - Spec validation pattern
- `/meridian/src/mcp/handlers.rs` - MCP handler pattern

---

## Questions?

**Design Questions:** Review specification
**Implementation Questions:** Check roadmap
**Pattern Questions:** Look at related code

---

## Ready to Go!

✅ Specification complete (14,000 words)
✅ Roadmap detailed (6 phases, 3 weeks)
✅ Code stubs ready (compiles + basic tests)
✅ Integration points identified
✅ Success metrics defined

**Next step:** Implement type tests → storage tests → manager tests → MCP handlers

**Timeline:** 3 weeks to production-ready

**First command:**
```bash
cargo test --package meridian --lib progress::types::tests
```

---

Generated: 2025-10-18
Status: Ready to Implement
