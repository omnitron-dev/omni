# Progress Tracking System - Implementation Roadmap

**Status:** Ready to Implement
**Timeline:** 3 weeks
**Priority:** High

## Overview

This roadmap breaks down the implementation of the Progress Tracking System into actionable tasks with clear deliverables and acceptance criteria.

## Phase Breakdown

### Phase 1: Core Infrastructure (Week 1, Days 1-3)

**Goal:** Basic task CRUD operations with RocksDB storage

#### Tasks

1. **Create Module Structure** (2 hours)
   - [ ] Create `src/progress/mod.rs`
   - [ ] Create `src/progress/types.rs`
   - [ ] Create `src/progress/manager.rs`
   - [ ] Create `src/progress/storage.rs`
   - [ ] Create `src/progress/tests.rs`
   - [ ] Add module exports in `src/lib.rs`

2. **Implement Core Types** (3 hours)
   - [ ] `TaskId` with UUID generation
   - [ ] `TaskStatus` enum with transition validation
   - [ ] `Priority` enum
   - [ ] `SpecReference` struct
   - [ ] `StatusTransition` for history
   - [ ] `Task` struct with all fields
   - [ ] `TaskSummary` for lists
   - [ ] Unit tests for type validation

3. **Implement Storage Layer** (4 hours)
   - [ ] Key format functions (task:{id}, idx_status:{status}:{id}, etc.)
   - [ ] `save_task()` - Write task + update indices
   - [ ] `load_task()` - Read task by ID
   - [ ] `delete_task()` - Remove task + clean indices
   - [ ] `list_by_status()` - Use status index
   - [ ] `list_by_spec()` - Use spec index
   - [ ] `list_all()` - Scan all tasks
   - [ ] Unit tests for storage operations

4. **Implement ProgressManager** (6 hours)
   - [ ] Constructor with RocksDB storage
   - [ ] `create_task()` - Create with validation
   - [ ] `update_task()` - Update with status transition validation
   - [ ] `get_task()` - Fetch by ID with caching
   - [ ] `delete_task()` - Delete with confirmation
   - [ ] `list_tasks()` - Filter, sort, limit
   - [ ] In-memory LRU cache for frequently accessed tasks
   - [ ] Unit tests for all operations

5. **Integration Testing** (3 hours)
   - [ ] Test create → update → delete flow
   - [ ] Test status transitions (valid + invalid)
   - [ ] Test filtering by status
   - [ ] Test concurrent operations
   - [ ] Test persistence (restart test)
   - [ ] Measure performance (1000+ tasks)

**Acceptance Criteria:**
- ✅ Can create, read, update, delete tasks
- ✅ Status transitions validated
- ✅ Tasks persist in RocksDB
- ✅ 80%+ test coverage
- ✅ Performance: < 10ms per operation

**Deliverables:**
- Working ProgressManager with CRUD
- Comprehensive unit tests
- No MCP integration yet

---

### Phase 2: MCP Handler Integration (Week 1, Days 4-5)

**Goal:** Expose tasks via MCP tools

#### Tasks

1. **Add Tool Definitions** (2 hours)
   - [ ] Define `progress.create_task` in `src/mcp/tools.rs`
   - [ ] Define `progress.update_task`
   - [ ] Define `progress.list_tasks`
   - [ ] Define `progress.get_task`
   - [ ] Define `progress.delete_task`
   - [ ] Add JSON schema for parameters

2. **Implement MCP Handlers** (4 hours)
   - [ ] Add `ProgressManager` to `ToolHandlers` struct
   - [ ] Implement `handle_create_task()`
   - [ ] Implement `handle_update_task()`
   - [ ] Implement `handle_list_tasks()`
   - [ ] Implement `handle_get_task()`
   - [ ] Implement `handle_delete_task()`
   - [ ] Add error handling and validation

3. **Add to MCP Server** (2 hours)
   - [ ] Initialize `ProgressManager` in MCP server startup
   - [ ] Wire up handlers in `handle_tool_call()`
   - [ ] Add to tool list in server info
   - [ ] Test tool discovery

4. **Integration Testing** (3 hours)
   - [ ] Test each tool via MCP protocol
   - [ ] Test error cases (invalid task ID, etc.)
   - [ ] Measure token costs for each operation
   - [ ] Test with Claude Code
   - [ ] Verify JSON schema validation

5. **Documentation** (2 hours)
   - [ ] Add examples to spec
   - [ ] Document token costs
   - [ ] Add troubleshooting guide

**Acceptance Criteria:**
- ✅ All 5 tools callable via MCP
- ✅ Error handling works correctly
- ✅ Token costs meet targets (< 150 tokens avg)
- ✅ Works in Claude Code

**Deliverables:**
- 5 working MCP tools
- Integration tests
- Token cost benchmarks

---

### Phase 3: Advanced Features (Week 2, Days 1-3)

**Goal:** Progress stats, search, spec linking, history

#### Tasks

1. **Implement Progress Statistics** (3 hours)
   - [ ] `calculate_progress()` - Overall stats
   - [ ] `calculate_by_spec()` - Per-spec breakdown
   - [ ] `calculate_by_priority()` - Per-priority breakdown
   - [ ] `ProgressStats` type
   - [ ] Unit tests for calculations

2. **Implement Search** (3 hours)
   - [ ] Full-text search in title + description
   - [ ] Relevance scoring
   - [ ] `search_tasks()` method
   - [ ] Search index (optional, for performance)
   - [ ] Unit tests

3. **Implement Spec Linking** (3 hours)
   - [ ] `link_to_spec()` - Link task to spec section
   - [ ] Spec validation (check section exists)
   - [ ] Integration with `SpecificationManager`
   - [ ] `get_spec_coverage()` - Coverage analysis
   - [ ] Unit tests

4. **Implement History** (2 hours)
   - [ ] `get_history()` - Return status transitions
   - [ ] Format history for readability
   - [ ] Unit tests

5. **Add MCP Handlers** (3 hours)
   - [ ] `handle_get_progress()`
   - [ ] `handle_search_tasks()`
   - [ ] `handle_link_to_spec()`
   - [ ] `handle_get_history()`
   - [ ] Integration tests

**Acceptance Criteria:**
- ✅ Progress calculation accurate
- ✅ Search works with relevance scoring
- ✅ Spec linking validates sections
- ✅ History shows all transitions

**Deliverables:**
- 4 new MCP tools
- Spec coverage analysis
- Search functionality

---

### Phase 4: Memory Integration (Week 2, Days 4-5)

**Goal:** Auto-record episodes on task completion

#### Tasks

1. **Design Episode Integration** (1 hour)
   - [ ] Define mapping: Task → TaskEpisode
   - [ ] Plan episode data collection
   - [ ] Review memory system API

2. **Implement mark_complete** (3 hours)
   - [ ] Create `MarkCompleteParams` type
   - [ ] Build `TaskEpisode` from task data
   - [ ] Call `memory_system.record_episode()`
   - [ ] Link episode ID back to task
   - [ ] Handle errors gracefully

3. **Add MCP Handler** (2 hours)
   - [ ] `handle_mark_complete()`
   - [ ] Validate input parameters
   - [ ] Return episode ID in response
   - [ ] Integration test

4. **Testing** (3 hours)
   - [ ] Test episode creation flow
   - [ ] Verify episode data accuracy
   - [ ] Test error handling (memory system down)
   - [ ] Test episode retrieval via memory tools
   - [ ] Verify pattern extraction works

**Acceptance Criteria:**
- ✅ Completed tasks auto-create episodes
- ✅ Episode data matches task data
- ✅ Episode ID stored in task
- ✅ Memory system learns from tasks

**Deliverables:**
- `progress.mark_complete` tool
- Automatic episode recording
- Integration with memory system

---

### Phase 5: Session & Git Integration (Week 3, Days 1-2)

**Goal:** Track active tasks per session, link commits

#### Tasks

1. **Session Integration** (3 hours)
   - [ ] Add `active_task_id` to `Session` type
   - [ ] Update session when task goes to InProgress
   - [ ] Add `get_active_task()` to SessionManager
   - [ ] Unit tests

2. **Git Integration** (3 hours)
   - [ ] Add `commit_hash` field to Task (already in spec)
   - [ ] Implement `link_commit()` method
   - [ ] Implement `find_tasks_by_commit()`
   - [ ] Optional: Validate commit exists
   - [ ] Unit tests

3. **MCP Handlers** (2 hours)
   - [ ] Update `handle_update_task()` to support commit linking
   - [ ] Update `handle_mark_complete()` to accept commit hash
   - [ ] Add query parameter for filtering by commit
   - [ ] Integration tests

**Acceptance Criteria:**
- ✅ Sessions track active task
- ✅ Commits linked to tasks
- ✅ Can query tasks by commit

**Deliverables:**
- Session integration
- Commit linking
- Query by commit

---

### Phase 6: Polish & Documentation (Week 3, Days 3-5)

**Goal:** Production-ready with comprehensive docs

#### Tasks

1. **Error Handling** (3 hours)
   - [ ] Review all error paths
   - [ ] Add descriptive error messages
   - [ ] Add error codes for common cases
   - [ ] Test error scenarios
   - [ ] Document error handling

2. **Performance Optimization** (4 hours)
   - [ ] Profile with 1000+ tasks
   - [ ] Optimize index queries
   - [ ] Tune cache size
   - [ ] Add performance benchmarks
   - [ ] Document performance characteristics

3. **Documentation** (6 hours)
   - [ ] Write `meridian/docs/progress-guide.md`
     - [ ] Quick start guide
     - [ ] Tool reference
     - [ ] Examples for common workflows
     - [ ] Troubleshooting
     - [ ] Best practices
   - [ ] Add examples to specification
   - [ ] Update main README
   - [ ] Add inline code documentation

4. **Testing** (4 hours)
   - [ ] Achieve 80%+ test coverage
   - [ ] Add edge case tests
   - [ ] Load testing (10,000 tasks)
   - [ ] Concurrency testing
   - [ ] End-to-end workflow tests

5. **Token Cost Analysis** (2 hours)
   - [ ] Measure all tool token costs
   - [ ] Compare with TodoWrite
   - [ ] Document savings
   - [ ] Add to specification

**Acceptance Criteria:**
- ✅ All tests passing
- ✅ 80%+ test coverage
- ✅ User guide complete
- ✅ Performance validated
- ✅ Token costs documented

**Deliverables:**
- Production-ready code
- Comprehensive user guide
- Performance benchmarks
- Token cost analysis

---

## Timeline Summary

| Week | Days | Phase | Focus |
|------|------|-------|-------|
| 1 | Mon-Wed | Phase 1 | Core CRUD + Storage |
| 1 | Thu-Fri | Phase 2 | MCP Integration |
| 2 | Mon-Wed | Phase 3 | Advanced Features |
| 2 | Thu-Fri | Phase 4 | Memory Integration |
| 3 | Mon-Tue | Phase 5 | Session + Git |
| 3 | Wed-Fri | Phase 6 | Polish + Docs |

**Total:** 15 working days (3 weeks)

---

## Dependencies

### External Dependencies

1. **RocksDB** - Already integrated in Meridian
2. **Memory System** - Already implemented
3. **Specification Manager** - Already implemented
4. **Session Manager** - Already implemented
5. **MCP Server** - Already implemented

### No Blocking Dependencies

All required systems are already in place. Implementation can start immediately.

---

## Risk Assessment

### Low Risks ✅

- RocksDB integration (already used)
- MCP tool pattern (well-established)
- Memory system API (stable)

### Medium Risks 🟡

- **Performance with 10,000+ tasks** - Mitigation: Use indices, caching
- **Token cost validation** - Mitigation: Measure early, optimize
- **Spec validation edge cases** - Mitigation: Comprehensive testing

### Mitigation Strategies

1. **Early Performance Testing** - Test with large datasets in Phase 1
2. **Token Cost Monitoring** - Measure after each phase
3. **Incremental Integration** - Test each integration point thoroughly
4. **Comprehensive Testing** - 80%+ coverage from start

---

## Success Metrics

### Functional Metrics

- [ ] All 10 MCP tools implemented
- [ ] All tools work correctly via Claude Code
- [ ] Tasks persist across restarts
- [ ] Auto-episode recording works
- [ ] Session integration works
- [ ] Spec linking validates sections

### Performance Metrics

- [ ] Create task: < 10ms
- [ ] List 100 tasks: < 50ms
- [ ] Get task: < 5ms (cached)
- [ ] Progress calculation: < 100ms
- [ ] Handles 10,000+ tasks smoothly

### Token Efficiency Metrics

- [ ] List tasks: ~100 tokens (70% reduction vs TodoWrite)
- [ ] Get task: ~200 tokens
- [ ] Mark complete: ~150 tokens
- [ ] Get progress: ~150 tokens

### Quality Metrics

- [ ] 80%+ test coverage
- [ ] No panics in production
- [ ] Clear error messages
- [ ] Comprehensive logging
- [ ] User guide complete

---

## Verification Checklist

After each phase, verify:

- [ ] All tasks in phase completed
- [ ] Tests passing (80%+ coverage)
- [ ] No regressions in existing functionality
- [ ] Performance meets targets
- [ ] Token costs documented
- [ ] Code reviewed
- [ ] Documentation updated

---

## Next Steps

1. **Review** - Get feedback on specification and roadmap
2. **Setup** - Create branch for progress tracking implementation
3. **Phase 1** - Start with core infrastructure
4. **Iterate** - Test early, get feedback, adjust

---

## Resources

- **Specification:** `/meridian/specs/progress-tracking-tools-spec.md`
- **Related Specs:**
  - `/meridian/specs/spec.md` - Core architecture
  - `/meridian/specs/MCP_TOOLS_SPEC_MANAGEMENT.md` - Spec management
- **Reference Code:**
  - `src/memory/episodic.rs` - Episode recording pattern
  - `src/specs/spec_manager.rs` - Spec validation pattern
  - `src/mcp/handlers.rs` - MCP handler pattern

---

**Ready to Start:** Phase 1, Task 1 - Create Module Structure
