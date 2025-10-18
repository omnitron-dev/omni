# Progress Tracking - Quick Reference

**One-page cheat sheet for rapid development**

---

## 🚀 5-Minute Quickstart

```typescript
// 1. CREATE
const task = await mcp__meridian__progress_create_task({
  title: "Implement feature X",
  priority: "high",
  estimated_hours: 4
});

// 2. START
await mcp__meridian__progress_update_task({
  task_id: task.task_id,
  status: "in_progress"
});

// 3. COMPLETE (auto-creates episode!)
await mcp__meridian__progress_mark_complete({
  task_id: task.task_id,
  actual_hours: 3.5,
  commit_hash: "abc123",
  solution_summary: "Used pattern X with library Y"
});
```

---

## 📋 All 10 MCP Tools

| Tool | Purpose | Token Cost |
|------|---------|------------|
| `progress_create_task` | Create new task | 90 |
| `progress_update_task` | Update fields/status | 45 |
| `progress_list_tasks` | List with filters | 165 |
| `progress_get_task` | Get full details | 210 |
| `progress_delete_task` | Delete permanently | 30 |
| `progress_search_tasks` | Full-text search | 125 |
| `progress_get_progress` | Statistics | 185 |
| `progress_link_to_spec` | Link to spec | 60 |
| `progress_get_history` | Status history | 95 |
| `progress_mark_complete` ⭐ | Complete + episode | 180 |

**Average**: 169 tokens vs 820 for TodoWrite (**79% savings**)

---

## 🔄 Task Lifecycle

```
pending → in_progress → done ✓
    ↓         ↓
  done    blocked → in_progress
    ↓         ↓
cancelled  cancelled
```

**Rules**:
- `done` and `cancelled` are **terminal** (no changes after)
- Must go through `in_progress` before `blocked`

---

## 🎯 Priority Levels

- **critical** - Drop everything, fix now
- **high** - This sprint
- **medium** - Next sprint (default)
- **low** - Backlog

---

## 🔍 Common Queries

### List In-Progress
```typescript
await progress_list_tasks({ status: "in_progress" });
```

### Search by Keyword
```typescript
await progress_search_tasks({ query: "authentication" });
```

### Get Progress for Spec
```typescript
await progress_get_progress({ spec_name: "api-spec" });
```

### Find by Commit
```typescript
const tasks = await find_tasks_by_commit({ commit_hash: "abc123" });
```

---

## 📊 Response Types

### TaskSummary (List)
```typescript
{
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  spec_ref?: SpecReference;
  updated_at: DateTime;
}
```

### Task (Get)
```typescript
{
  ...TaskSummary,
  description?: string;
  created_at: DateTime;
  completed_at?: DateTime;
  history: StatusTransition[];
  tags: string[];
  estimated_hours?: number;
  actual_hours?: number;
  commit_hash?: string;
  episode_id?: string;
}
```

### ProgressStats
```typescript
{
  total_tasks: number;
  pending: number;
  in_progress: number;
  blocked: number;
  done: number;
  cancelled: number;
  completion_percentage: number;
  by_spec: SpecProgress[];
  by_priority: PriorityProgress[];
}
```

---

## ✅ Best Practices

### 1. Always Link to Specs
```typescript
spec_ref: {
  spec_name: "authentication-spec",
  section: "JWT Implementation"
}
```

### 2. Use Status Notes
```typescript
status: "blocked",
status_note: "Waiting for API review from @john"
```

### 3. Track Actual Hours
```typescript
estimated_hours: 8,
actual_hours: 7.5  // Track variance
```

### 4. Record Rich Episodes
```typescript
solution_summary: "Used Redis with 1h TTL",
files_touched: ["src/cache.rs"],
queries_made: ["code.search cache"]
```

### 5. Consistent Tags
```typescript
tags: ["backend", "feature", "performance"]
```

---

## 🔗 Integrations

### With Memory
```typescript
// Before starting
const similar = await memory_find_similar_episodes({
  task_description: "implement caching"
});

// After completing
await progress_mark_complete({
  // ... auto-creates episode
});
```

### With Specs
```typescript
const spec = await specs_get_section({
  spec_name: "api-spec",
  section_name: "Caching"
});

const task = await progress_create_task({
  description: spec.content,
  spec_ref: { spec_name: "api-spec", section: "Caching" }
});
```

### With Code Search
```typescript
const patterns = await code_search_symbols({
  query: "cache implementation"
});

await progress_mark_complete({
  queries_made: ["code.search_symbols cache implementation"]
});
```

---

## 🐛 Troubleshooting

### Invalid Transition
```
Error: Invalid transition: done -> in_progress
```
**Fix**: Create new task instead

### Task Not Found
```
Error: Task not found: abc-123
```
**Fix**: Search first: `progress_search_tasks({ query: "..." })`

### Spec Not Found
```
Error: Section 'Auth' not found in spec 'api-spec'
```
**Fix**: Check sections: `specs_get_structure({ spec_name: "api-spec" })`

---

## 📈 Performance

| Operation | Time | Dataset |
|-----------|------|---------|
| Create | 4ms | - |
| Get (cached) | <1ms | 1,000 tasks |
| List 100 | 45ms | 1,000 tasks |
| Search | 68ms | 1,000 tasks |
| Progress stats | 145ms | 1,000 tasks |

**All operations < 200ms at 1,000+ tasks**

---

## 💰 Cost Savings

**TodoWrite** (100 ops/day):
- Tokens: 82,000/day
- Cost: **$44/month**

**Progress Tracking** (100 ops/day):
- Tokens: 16,900/day
- Cost: **$9/month**

**Savings: $35/month (79%)**

---

## 🎯 Workflow Examples

### Daily Standup
```typescript
// What's in progress?
const active = await progress_list_tasks({ status: "in_progress" });

// What's blocked?
const blocked = await progress_list_tasks({ status: "blocked" });

// Sprint progress?
const stats = await progress_get_progress({ spec_name: "sprint-12" });
```

### Feature Implementation
```typescript
// 1. Check past work
const episodes = await memory_find_similar_episodes({ task_description: "..." });

// 2. Create task
const task = await progress_create_task({ ... });

// 3. Start
await progress_update_task({ task_id, status: "in_progress" });

// 4. Complete
await progress_mark_complete({ task_id, ... });
```

### Bug Triage
```typescript
// Find bugs
const bugs = await progress_search_tasks({ query: "bug" });

// Update priorities
for (const bug of criticalBugs) {
  await progress_update_task({
    task_id: bug.id,
    priority: "critical"
  });
}
```

---

## 🔑 Key Takeaways

✅ **79% fewer tokens** than TodoWrite
✅ **Persistent** across sessions
✅ **Auto-episode recording** on completion
✅ **Fast queries** with indexing
✅ **Production-ready** performance
✅ **10 specialized tools** for all workflows

**Use instead of TodoWrite for:**
- Multi-session work
- Team collaboration
- Long-term projects
- Token efficiency
- Progress analytics

---

**Full docs**: `/meridian/docs/progress-guide.md`
**Benchmarks**: `/meridian/docs/progress-benchmarks.md`
