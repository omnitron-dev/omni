# Meridian MCP Tool Usage Analysis
## Post-Restart Analysis (October 19, 2025)

### Executive Summary

**Analysis Period**: All-time metrics (188 snapshots, 121 with data)
**Total Registered Tools**: 101 tools across 15 categories
**Tools with Usage Data**: 24 tools (23.8% usage rate)
**Total Tool Calls**: 2,169 calls
**Overall Success Rate**: 91.5% (1,985 successes / 2,169 total)

### Key Findings

1. **Tool Adoption**: Only 24 out of 101 tools have been used (~24% adoption)
2. **Concentration**: Top 6 tools account for 80% of all usage
3. **Critical Failures**: 4 tools have 100% failure rate
4. **High Error Rates**: 2 tools have 50%+ error rates

---

## 📊 Tool Usage Statistics

### Top 20 Most Used Tools

| Rank | Tool Name | Calls | Success | Errors | Success Rate |
|------|-----------|-------|---------|--------|--------------|
| 1 | `progress.create_task` | 549 | 549 | 0 | 100.0% ✅ |
| 2 | `code.search_symbols` | 426 | 426 | 0 | 100.0% ✅ |
| 3 | `progress.update_task` | 258 | 250 | 8 | 96.9% ✅ |
| 4 | `progress.add_dependency` | 169 | 169 | 0 | 100.0% ✅ |
| 5 | `system.health` | 125 | 125 | 0 | 100.0% ✅ |
| 6 | `progress.list_tasks` | 116 | 58 | 58 | 50.0% ⚠️ |
| 7 | `progress.mark_complete` | 93 | 93 | 0 | 100.0% ✅ |
| 8 | `memory.find_similar_episodes` | 60 | 60 | 0 | 100.0% ✅ |
| 9 | `code.get_definition` | 59 | 45 | 14 | 76.3% ⚠️ |
| 10 | `indexer.get_watch_status` | 50 | 10 | 40 | 20.0% 🔴 |
| 11 | `memory.get_statistics` | 43 | 43 | 0 | 100.0% ✅ |
| 12 | `indexer.index_project` | 41 | 41 | 0 | 100.0% ✅ |
| 13 | `specs.get_section` | 35 | 21 | 14 | 60.0% ⚠️ |
| 14 | `progress.get_progress` | 32 | 32 | 0 | 100.0% ✅ |
| 15 | `progress.can_start_task` | 31 | 31 | 0 | 100.0% ✅ |
| 16 | `specs.list` | 27 | 27 | 0 | 100.0% ✅ |
| 17 | `backup.get_stats` | 26 | 0 | 26 | 0.0% 🔴 |
| 18 | `indexer.enable_watching` | 20 | 0 | 20 | 0.0% 🔴 |
| 19 | `session.begin` | 3 | 3 | 0 | 100.0% ✅ |
| 20 | `session.update` | 2 | 2 | 0 | 100.0% ✅ |

---

## 🚨 Critical Issues: Tools with Errors

### 🔴 Completely Broken Tools (0% Success Rate)

1. **`backup.get_stats`** - 26 calls, 26 errors (100% failure)
   - **Impact**: HIGH - Prevents backup system monitoring
   - **Priority**: CRITICAL

2. **`indexer.enable_watching`** - 20 calls, 20 errors (100% failure)
   - **Impact**: HIGH - File watching doesn't work
   - **Priority**: CRITICAL

### ⚠️ High Error Rate Tools (>40% Errors)

3. **`progress.list_tasks`** - 58 errors / 116 calls (50.0% failure)
   - **Impact**: CRITICAL - Core progress tracking functionality
   - **Priority**: CRITICAL
   - **Note**: Fixed in recent commit (e5f24b14), may need verification

4. **`indexer.get_watch_status`** - 40 errors / 50 calls (80.0% failure)
   - **Impact**: MEDIUM - Status monitoring broken
   - **Priority**: HIGH

5. **`specs.get_section`** - 14 errors / 35 calls (40.0% failure)
   - **Impact**: MEDIUM - Specification access unreliable
   - **Priority**: HIGH

### ⚠️ Moderate Error Rate Tools (>20% Errors)

6. **`code.get_definition`** - 14 errors / 59 calls (23.7% failure)
   - **Impact**: MEDIUM - Code navigation degraded
   - **Priority**: MEDIUM

7. **`progress.update_task`** - 8 errors / 258 calls (3.1% failure)
   - **Impact**: LOW - Rare failures, mostly works
   - **Priority**: LOW

---

## 📉 Unused Tools (77 tools, 76.2% of total)

### Category Breakdown of Unused Tools

#### Memory & Learning (5 tools)
- `memory.record_episode` - Never used (auto-called by progress.mark_complete?)
- `memory.update_working_set`
- `feedback.mark_useful`
- `learning.train_on_success`
- `predict.next_action`

#### Context Management (3 tools)
- `context.prepare_adaptive`
- `context.defragment`
- All context optimization tools unused

#### Code Analysis (2 tools)
- `code.search_patterns`
- `code.find_references`

#### Session Management (2 tools)
- `session.query`
- `session.complete`

#### Attention & Prediction (2 tools)
- `attention.retrieve`
- `attention.analyze_patterns`

#### Documentation (6 tools)
- `docs.search`
- `docs.get_for_symbol`
- `docs.generate`
- `docs.validate`
- `docs.transform`
- All documentation generation tools

#### Examples & Tests (4 tools)
- `examples.generate`
- `examples.validate`
- `tests.generate`
- `tests.validate`

#### Catalog (3 tools)
- `catalog.list_projects`
- `catalog.get_project`
- `catalog.search_documentation`

#### Global Registry (5 tools)
- `global.list_monorepos`
- `global.search_all_projects`
- `global.get_dependency_graph`
- `external.get_documentation`
- `external.find_usages`

#### Monorepo (2 tools)
- `monorepo.set_context`
- `monorepo.find_cross_references`
- Note: `monorepo.list_projects` is used (not shown in top 20)

#### Links (12 tools) - ALL UNUSED
- `links.find_implementation`
- `links.find_documentation`
- `links.find_examples`
- `links.find_tests`
- `links.add_link`
- `links.remove_link`
- `links.get_links`
- `links.validate`
- `links.trace_path`
- `links.get_health`
- `links.find_orphans`
- `links.extract_from_file`

#### History (2 tools)
- `history.get_evolution`
- `history.blame`

#### Analysis (2 tools)
- `analyze.complexity`
- `analyze.token_cost`

#### Specifications (2 tools)
- `specs.get_structure`
- `specs.search`
- `specs.validate`

#### Progress (7 tools)
- `progress.get_task`
- `progress.delete_task`
- `progress.search_tasks`
- `progress.link_to_spec`
- `progress.get_history`
- `progress.check_timeouts`
- `progress.recover_orphaned`
- `progress.remove_dependency`
- `progress.get_dependencies`
- `progress.get_dependents`

#### Indexer (2 tools)
- `indexer.disable_watching`
- `indexer.poll_changes`

#### Metrics (8 tools) - ALL UNUSED
- `metrics.get_summary`
- `metrics.get_tool_stats` ⚠️ (Should be used for this analysis!)
- `metrics.get_time_range`
- `metrics.list_slow_tools` ⚠️
- `metrics.get_token_efficiency`
- `metrics.export_prometheus`
- `metrics.analyze_trends`
- `metrics.get_health`

#### Backup (6 tools)
- `backup.create`
- `backup.list`
- `backup.restore`
- `backup.verify`
- `backup.delete`
- `backup.create_scheduled`
- `backup.create_pre_migration`

---

## 🎯 Optimization Opportunities

### Immediate Actions (Critical)

1. **Fix `backup.get_stats`** (100% failure rate)
   - Investigate error logs
   - Check if BackupManager is properly initialized
   - Verify database schema for backup metadata

2. **Fix `indexer.enable_watching`** (100% failure rate)
   - Check file system permissions
   - Verify file watcher initialization
   - Test on actual file changes

3. **Fix `progress.list_tasks`** (50% failure rate)
   - Recent fix in commit e5f24b14 mentions deserialization error
   - Verify fix is working
   - Add integration tests

### High Priority Fixes

4. **Improve `indexer.get_watch_status`** (80% failure rate)
   - Returns error when no watcher is active
   - Should return meaningful status instead of error

5. **Improve `specs.get_section`** (40% failure rate)
   - Section name matching too strict?
   - Better fuzzy matching needed

6. **Improve `code.get_definition`** (24% failure rate)
   - Symbol not found errors?
   - Index coverage issues?

### Feature Adoption

7. **Promote underutilized features**:
   - **Metrics tools** (8 tools, 0% usage) - Ironically unused!
   - **Links system** (12 tools, 0% usage) - Semantic linking
   - **Documentation generation** (6 tools, 0% usage)
   - **Test generation** (4 tools, 0% usage)

8. **Document usage patterns**:
   - Create examples for unused tools
   - Add to CLAUDE.md
   - Tutorial/walkthrough docs

---

## 📈 Success Stories

### Excellent Performance (100% Success Rate)

- **Progress System** (6/9 core tools working perfectly)
  - `progress.create_task` (549 calls)
  - `progress.add_dependency` (169 calls)
  - `progress.mark_complete` (93 calls)
  - `progress.get_progress` (32 calls)
  - `progress.can_start_task` (31 calls)

- **Code Search** (426 calls, 100% success)
  - Most used analysis tool
  - Rock-solid reliability

- **Memory System** (103 calls, 100% success)
  - `memory.find_similar_episodes` (60 calls)
  - `memory.get_statistics` (43 calls)

- **System Health** (125 calls, 100% success)
  - Reliable system monitoring

### High Adoption Tools

1. **Progress Tracking** - 1,308 calls (60.3% of all usage)
2. **Code Analysis** - 485 calls (22.4% of all usage)
3. **Memory** - 103 calls (4.7% of all usage)
4. **System** - 125 calls (5.8% of all usage)
5. **Indexer** - 111 calls (5.1% of all usage)

---

## 🔍 Data-Driven Insights

### Usage Patterns

1. **Progress tracking dominates** (60% of usage)
   - Users heavily rely on task management
   - Dependency tracking is actively used
   - Task completion tracking is working

2. **Code analysis is second priority** (22% of usage)
   - Symbol search is most used code tool
   - Definition lookup has quality issues

3. **Session management underutilized** (5 calls total)
   - Only `begin` and `update` used
   - `query` and `complete` never used
   - Feature awareness issue?

4. **Zero adoption of advanced features**:
   - Semantic links (0 calls)
   - Documentation generation (0 calls)
   - Test generation (0 calls)
   - Metrics analysis (0 calls)

### Error Rate Distribution

- **0-5% errors**: 15 tools (62.5% of used tools) ✅
- **5-25% errors**: 2 tools (8.3%) ⚠️
- **25-50% errors**: 2 tools (8.3%) 🔴
- **50-100% errors**: 3 tools (12.5%) 🔴
- **100% errors**: 2 tools (8.3%) 💀

### Recommendations

1. **Focus on reliability first**:
   - Fix the 7 tools with >20% error rate
   - Target 95% success rate minimum

2. **Improve discoverability**:
   - 77 unused tools need examples
   - Update CLAUDE.md with usage patterns
   - Add interactive help/discovery

3. **Monitor metrics usage**:
   - Make metrics tools accessible
   - Regular health checks
   - Automated alerting for degraded tools

4. **Invest in testing**:
   - Integration tests for all tools
   - Regression tests for fixed issues
   - Automated error tracking

---

## 📝 Next Steps

1. Create tasks for each critical fix
2. Investigate root causes of failures
3. Add comprehensive integration tests
4. Document successful usage patterns
5. Create discovery/onboarding guide for unused tools

---

**Generated**: October 19, 2025
**Analysis Tool**: Custom Rust analyzer (analyze_all_metrics)
**Data Source**: RocksDB metrics database (~/.meridian/db/current/index/metrics)
**Snapshot Count**: 188 total, 121 with tool data
