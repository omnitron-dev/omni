# Progress Tracking Tools Specification

**MCP-Native Progress System for Meridian**

Version: 1.0.0
Status: Design
Date: 2025-10-18

## Table of Contents

- [Overview](#overview)
- [Design Philosophy](#design-philosophy)
- [Problem Statement](#problem-statement)
- [Solution Architecture](#solution-architecture)
- [Data Structures](#data-structures)
- [MCP Tools Specification](#mcp-tools-specification)
- [Storage Schema](#storage-schema)
- [Integration Points](#integration-points)
- [Token Efficiency](#token-efficiency)
- [Implementation Plan](#implementation-plan)
- [Testing Strategy](#testing-strategy)
- [Examples](#examples)

---

## Overview

The Progress Tracking System provides **MCP-native task management** that persists across sessions, integrates with Meridian's memory system, and tracks specification implementation progress with minimal token overhead.

### Key Innovations

1. **RocksDB Persistence** - Tasks survive restarts and session changes
2. **Memory Integration** - Completed tasks auto-record as episodes
3. **Spec Linking** - Tasks reference specific specification sections
4. **Token Efficient** - Compact output, progressive detail loading
5. **Session-Aware** - Tracks what you're working on right now

### Comparison: TodoWrite vs Progress System

| Feature | TodoWrite | Progress System |
|---------|-----------|----------------|
| Persistence | ❌ Session only | ✅ RocksDB |
| Token Cost | ~500 tokens/update | ~100 tokens/update |
| Spec Integration | ❌ None | ✅ Native |
| Memory Integration | ❌ Manual | ✅ Automatic |
| Cross-Session | ❌ Lost on restart | ✅ Persistent |
| Query by Status | ❌ Manual | ✅ Built-in |
| Progress % | ❌ Manual calc | ✅ Auto-computed |

---

## Design Philosophy

### 1. Token-First Design

**Every operation minimizes token usage:**
- Summary-first approach (list gives IDs + titles only)
- Progressive detail loading (get full task only when needed)
- Compact JSON format (no bloat)
- Smart filtering (only show what matters)

### 2. Persistence Over Convenience

**Tasks are durable, not ephemeral:**
- RocksDB storage survives restarts
- Tasks have unique IDs (not array indices)
- History is preserved (status transitions tracked)
- Cross-session continuity

### 3. Integration, Not Isolation

**Connect with existing systems:**
- Memory: Auto-record completed tasks as episodes
- Specs: Link tasks to specification sections
- Sessions: Track active task per session
- Git: Optional commit linking

### 4. Progressive Disclosure

**Information is revealed gradually:**
- Lists show minimal info (ID, title, status, spec)
- Get shows full details (all fields)
- Stats show aggregates (progress %, counts)
- History shows transitions (when status changed)

---

## Problem Statement

### Current Issues with TodoWrite

1. **No Persistence** - Tasks vanish when session ends
2. **High Token Cost** - Full list sent on every update (~500 tokens)
3. **No Spec Integration** - Can't link to specification sections
4. **Manual Memory** - Must manually call `memory.record_episode`
5. **No Querying** - Can't filter by status, spec, or session
6. **No Progress Tracking** - Can't see % complete
7. **Fragile** - Easy to forget to update

### What We Need

1. **Persistent Storage** - Tasks in RocksDB
2. **Token Efficient** - Summary views, progressive loading
3. **Spec-Aware** - Reference spec sections directly
4. **Auto-Memory** - Completed tasks → automatic episodes
5. **Rich Querying** - Filter, search, aggregate
6. **Progress Metrics** - % complete, estimates
7. **Session Integration** - Know what you're working on

---

## Solution Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Client (Claude)                   │
├─────────────────────────────────────────────────────────┤
│  progress.create_task    progress.update_task           │
│  progress.list_tasks     progress.get_task              │
│  progress.mark_complete  progress.get_progress          │
│  progress.link_to_spec   progress.get_history           │
└────────────────────┬────────────────────────────────────┘
                     │ MCP Protocol
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Progress Manager (Rust)                     │
├─────────────────────────────────────────────────────────┤
│  • Create/Update/Delete Tasks                            │
│  • Status Transitions (Pending → InProgress → Done)     │
│  • Spec Section Linking                                  │
│  • Session Tracking                                      │
│  • History Recording                                     │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    ┌────────┐  ┌────────┐  ┌────────────┐
    │RocksDB │  │ Memory │  │   Spec     │
    │Storage │  │ System │  │  Manager   │
    └────────┘  └────────┘  └────────────┘
```

### Component Responsibilities

**Progress Manager**
- Task CRUD operations
- Status transition validation
- Progress calculation
- History tracking
- Spec section resolution

**Storage Layer (RocksDB)**
- Persist tasks by ID
- Index by status, spec, session
- Store status history
- Handle concurrent access

**Memory Integration**
- Auto-record completed tasks
- Extract patterns from task history
- Link tasks to episodes

**Spec Integration**
- Resolve spec section references
- Validate spec links
- Track implementation coverage

---

## Data Structures

### Core Types (Rust)

```rust
// src/progress/types.rs

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Unique identifier for tasks
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TaskId(pub String);

impl TaskId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn from_str(s: &str) -> Self {
        Self(s.to_string())
    }
}

/// Task status with clear transitions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    /// Not started yet
    Pending,
    /// Currently being worked on
    InProgress,
    /// Blocked by external dependency
    Blocked,
    /// Successfully completed
    Done,
    /// Cancelled or abandoned
    Cancelled,
}

impl TaskStatus {
    /// Can transition to the given status
    pub fn can_transition_to(&self, target: TaskStatus) -> bool {
        use TaskStatus::*;
        match (self, target) {
            (Pending, InProgress | Cancelled) => true,
            (InProgress, Blocked | Done | Cancelled) => true,
            (Blocked, InProgress | Cancelled) => true,
            (Done, _) => false, // Done is terminal
            (Cancelled, _) => false, // Cancelled is terminal
            _ => false,
        }
    }
}

/// Priority levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Priority {
    Low,
    Medium,
    High,
    Critical,
}

/// Reference to a specification section
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpecReference {
    /// Spec name (e.g., "spec", "documentation-tools-spec")
    pub spec_name: String,
    /// Section name or path (e.g., "Phase 1", "MCP Tools")
    pub section: String,
}

/// Status transition history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusTransition {
    /// When the transition occurred
    pub timestamp: DateTime<Utc>,
    /// Previous status
    pub from: TaskStatus,
    /// New status
    pub to: TaskStatus,
    /// Optional note about why
    pub note: Option<String>,
}

/// Task metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Unique identifier
    pub id: TaskId,

    /// Human-readable title
    pub title: String,

    /// Detailed description (optional)
    pub description: Option<String>,

    /// Current status
    pub status: TaskStatus,

    /// Priority level
    pub priority: Priority,

    /// Reference to specification section (if applicable)
    pub spec_ref: Option<SpecReference>,

    /// Session ID when created
    pub session_id: Option<String>,

    /// Session ID when last worked on
    pub active_session_id: Option<String>,

    /// When task was created
    pub created_at: DateTime<Utc>,

    /// When task was last updated
    pub updated_at: DateTime<Utc>,

    /// When task was completed (if done)
    pub completed_at: Option<DateTime<Utc>>,

    /// History of status changes
    pub history: Vec<StatusTransition>,

    /// Tags for categorization
    pub tags: Vec<String>,

    /// Estimated effort (in hours, optional)
    pub estimated_hours: Option<f32>,

    /// Actual effort (in hours, tracked when done)
    pub actual_hours: Option<f32>,

    /// Related task IDs (dependencies, blockers)
    pub related_tasks: Vec<TaskId>,

    /// Git commit hash (if committed)
    pub commit_hash: Option<String>,

    /// Episode ID (if completed and recorded)
    pub episode_id: Option<String>,
}

impl Task {
    /// Create a new task
    pub fn new(title: String) -> Self {
        Self {
            id: TaskId::new(),
            title,
            description: None,
            status: TaskStatus::Pending,
            priority: Priority::Medium,
            spec_ref: None,
            session_id: None,
            active_session_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            completed_at: None,
            history: Vec::new(),
            tags: Vec::new(),
            estimated_hours: None,
            actual_hours: None,
            related_tasks: Vec::new(),
            commit_hash: None,
            episode_id: None,
        }
    }

    /// Update status with validation
    pub fn update_status(&mut self, new_status: TaskStatus, note: Option<String>) -> Result<(), String> {
        if !self.status.can_transition_to(new_status) {
            return Err(format!(
                "Invalid transition: {:?} -> {:?}",
                self.status, new_status
            ));
        }

        // Record transition
        self.history.push(StatusTransition {
            timestamp: Utc::now(),
            from: self.status,
            to: new_status,
            note,
        });

        self.status = new_status;
        self.updated_at = Utc::now();

        // Set completed_at if transitioning to Done
        if new_status == TaskStatus::Done {
            self.completed_at = Some(Utc::now());
        }

        Ok(())
    }
}

/// Task summary (for lists)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSummary {
    pub id: TaskId,
    pub title: String,
    pub status: TaskStatus,
    pub priority: Priority,
    pub spec_ref: Option<SpecReference>,
    pub updated_at: DateTime<Utc>,
}

impl From<&Task> for TaskSummary {
    fn from(task: &Task) -> Self {
        Self {
            id: task.id.clone(),
            title: task.title.clone(),
            status: task.status,
            priority: task.priority,
            spec_ref: task.spec_ref.clone(),
            updated_at: task.updated_at,
        }
    }
}

/// Progress statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressStats {
    pub total_tasks: usize,
    pub pending: usize,
    pub in_progress: usize,
    pub blocked: usize,
    pub done: usize,
    pub cancelled: usize,
    pub completion_percentage: f32,
    pub by_spec: Vec<SpecProgress>,
    pub by_priority: Vec<PriorityProgress>,
}

/// Progress for a specific spec
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecProgress {
    pub spec_name: String,
    pub total: usize,
    pub done: usize,
    pub percentage: f32,
}

/// Progress by priority
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriorityProgress {
    pub priority: Priority,
    pub total: usize,
    pub done: usize,
}
```

---

## MCP Tools Specification

### 1. `progress.create_task`

**Create a new task**

#### Input Parameters

```typescript
{
  title: string;              // Required: Task title
  description?: string;       // Optional: Detailed description
  priority?: "low" | "medium" | "high" | "critical"; // Default: medium
  spec_name?: string;         // Optional: Spec to link to
  section?: string;           // Optional: Spec section
  tags?: string[];           // Optional: Tags
  estimated_hours?: number;  // Optional: Estimate
  related_tasks?: string[];  // Optional: Related task IDs
}
```

#### Output Format

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "created_at": "2025-10-18T14:30:00Z",
  "message": "Task created successfully"
}
```

#### Token Efficiency

- **Input:** ~50-100 tokens
- **Output:** ~30 tokens
- **Total:** ~80-130 tokens

#### Example Usage

```typescript
// Create task linked to spec
await progress.create_task({
  title: "Implement progress.list_tasks MCP handler",
  description: "Add handler in src/mcp/handlers.rs for listing tasks with filtering",
  priority: "high",
  spec_name: "progress-tracking-tools-spec",
  section: "MCP Tools Specification",
  tags: ["mcp", "rust", "phase-1"],
  estimated_hours: 2
});
```

---

### 2. `progress.update_task`

**Update an existing task**

#### Input Parameters

```typescript
{
  task_id: string;           // Required: Task to update
  title?: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
  status?: "pending" | "in_progress" | "blocked" | "done" | "cancelled";
  status_note?: string;      // Optional: Reason for status change
  tags?: string[];           // Replaces existing tags
  estimated_hours?: number;
  actual_hours?: number;
  add_related?: string[];    // Add related task IDs
  remove_related?: string[]; // Remove related task IDs
  commit_hash?: string;      // Link to git commit
}
```

#### Output Format

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "previous_status": "pending",
  "new_status": "in_progress",
  "updated_at": "2025-10-18T14:35:00Z"
}
```

#### Token Efficiency

- **Input:** ~60-120 tokens
- **Output:** ~40 tokens
- **Total:** ~100-160 tokens

#### Example Usage

```typescript
// Start working on task
await progress.update_task({
  task_id: "550e8400-e29b-41d4-a716-446655440000",
  status: "in_progress",
  status_note: "Starting implementation"
});

// Complete task
await progress.update_task({
  task_id: "550e8400-e29b-41d4-a716-446655440000",
  status: "done",
  actual_hours: 2.5,
  commit_hash: "abc123def456"
});
```

---

### 3. `progress.list_tasks`

**List tasks with filtering**

#### Input Parameters

```typescript
{
  status?: "pending" | "in_progress" | "blocked" | "done" | "cancelled" | "all";
  spec_name?: string;        // Filter by spec
  session_id?: string;       // Filter by session
  priority?: "low" | "medium" | "high" | "critical";
  tags?: string[];           // Must have ALL tags
  sort_by?: "created" | "updated" | "priority" | "status";
  order?: "asc" | "desc";
  limit?: number;            // Max results (default: 50)
  include_done?: boolean;    // Include completed (default: false)
}
```

#### Output Format

```json
{
  "tasks": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Implement progress.list_tasks",
      "status": "in_progress",
      "priority": "high",
      "spec_ref": {
        "spec_name": "progress-tracking-tools-spec",
        "section": "MCP Tools"
      },
      "updated_at": "2025-10-18T14:35:00Z"
    }
  ],
  "total": 15,
  "shown": 1,
  "filtered_by": ["status=in_progress"]
}
```

#### Token Efficiency

- **Input:** ~40-80 tokens
- **Output:** ~50-200 tokens (depends on task count)
- **Total:** ~90-280 tokens

**Key Optimization:** Only returns `TaskSummary` (not full `Task`), saving ~200 tokens per task

#### Example Usage

```typescript
// List active tasks
await progress.list_tasks({
  status: "in_progress"
});

// List high-priority pending tasks for a spec
await progress.list_tasks({
  status: "pending",
  priority: "high",
  spec_name: "progress-tracking-tools-spec",
  sort_by: "priority",
  order: "desc"
});
```

---

### 4. `progress.get_task`

**Get full task details**

#### Input Parameters

```typescript
{
  task_id: string;           // Required
  include_history?: boolean; // Include status transitions (default: false)
}
```

#### Output Format

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Implement progress.list_tasks",
  "description": "Add MCP handler for listing tasks...",
  "status": "in_progress",
  "priority": "high",
  "spec_ref": {
    "spec_name": "progress-tracking-tools-spec",
    "section": "MCP Tools"
  },
  "created_at": "2025-10-18T14:30:00Z",
  "updated_at": "2025-10-18T14:35:00Z",
  "tags": ["mcp", "rust"],
  "estimated_hours": 2,
  "history": [
    {
      "timestamp": "2025-10-18T14:35:00Z",
      "from": "pending",
      "to": "in_progress",
      "note": "Starting implementation"
    }
  ]
}
```

#### Token Efficiency

- **Input:** ~20 tokens
- **Output:** ~150-300 tokens (full task)
- **Total:** ~170-320 tokens

#### Example Usage

```typescript
// Get task with history
await progress.get_task({
  task_id: "550e8400-e29b-41d4-a716-446655440000",
  include_history: true
});
```

---

### 5. `progress.mark_complete`

**Mark task as complete and auto-record episode**

#### Input Parameters

```typescript
{
  task_id: string;              // Required
  actual_hours?: number;        // Actual time spent
  commit_hash?: string;         // Git commit
  solution_summary?: string;    // What was done
  files_touched?: string[];     // Files modified
  queries_made?: string[];      // Queries used
}
```

#### Output Format

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "done",
  "completed_at": "2025-10-18T16:45:00Z",
  "episode_id": "ep_7890abcd",
  "episode_recorded": true
}
```

#### Token Efficiency

- **Input:** ~80-150 tokens
- **Output:** ~50 tokens
- **Total:** ~130-200 tokens

#### Side Effects

1. Updates task status to `Done`
2. Sets `completed_at` timestamp
3. **Automatically calls `memory.record_episode`** with:
   - Task description as episode description
   - Files touched
   - Queries made
   - Solution summary
   - Outcome: Success
4. Links episode ID back to task

#### Example Usage

```typescript
await progress.mark_complete({
  task_id: "550e8400-e29b-41d4-a716-446655440000",
  actual_hours: 2.5,
  commit_hash: "abc123",
  solution_summary: "Implemented list_tasks with filtering",
  files_touched: ["src/mcp/handlers.rs", "src/progress/manager.rs"],
  queries_made: ["code.search_symbols filter", "code.get_definition TaskManager"]
});
```

---

### 6. `progress.get_progress`

**Get overall progress statistics**

#### Input Parameters

```typescript
{
  spec_name?: string;        // Overall or per-spec
  group_by?: "spec" | "priority" | "status";
}
```

#### Output Format

```json
{
  "total_tasks": 42,
  "pending": 15,
  "in_progress": 3,
  "blocked": 1,
  "done": 20,
  "cancelled": 3,
  "completion_percentage": 47.6,
  "by_spec": [
    {
      "spec_name": "progress-tracking-tools-spec",
      "total": 15,
      "done": 7,
      "percentage": 46.7
    }
  ],
  "by_priority": [
    {
      "priority": "critical",
      "total": 5,
      "done": 3
    }
  ]
}
```

#### Token Efficiency

- **Input:** ~20-40 tokens
- **Output:** ~100-200 tokens
- **Total:** ~120-240 tokens

#### Example Usage

```typescript
// Overall progress
await progress.get_progress();

// Progress for specific spec
await progress.get_progress({
  spec_name: "progress-tracking-tools-spec",
  group_by: "priority"
});
```

---

### 7. `progress.link_to_spec`

**Link task to a specification section**

#### Input Parameters

```typescript
{
  task_id: string;
  spec_name: string;
  section: string;
  validate?: boolean;        // Verify section exists (default: true)
}
```

#### Output Format

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "spec_ref": {
    "spec_name": "progress-tracking-tools-spec",
    "section": "MCP Tools Specification"
  },
  "validated": true
}
```

#### Token Efficiency

- **Input:** ~30-50 tokens
- **Output:** ~40 tokens
- **Total:** ~70-90 tokens

#### Example Usage

```typescript
await progress.link_to_spec({
  task_id: "550e8400-e29b-41d4-a716-446655440000",
  spec_name: "progress-tracking-tools-spec",
  section: "Implementation Plan"
});
```

---

### 8. `progress.get_history`

**Get status transition history for a task**

#### Input Parameters

```typescript
{
  task_id: string;
}
```

#### Output Format

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "transitions": [
    {
      "timestamp": "2025-10-18T14:30:00Z",
      "from": null,
      "to": "pending",
      "note": "Task created"
    },
    {
      "timestamp": "2025-10-18T14:35:00Z",
      "from": "pending",
      "to": "in_progress",
      "note": "Starting implementation"
    }
  ]
}
```

#### Token Efficiency

- **Input:** ~15 tokens
- **Output:** ~60-150 tokens
- **Total:** ~75-165 tokens

---

### 9. `progress.delete_task`

**Delete a task (with confirmation)**

#### Input Parameters

```typescript
{
  task_id: string;
  confirm?: boolean;         // Must be true to delete
}
```

#### Output Format

```json
{
  "deleted": true,
  "task_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Token Efficiency

- **Input:** ~15 tokens
- **Output:** ~20 tokens
- **Total:** ~35 tokens

---

### 10. `progress.search_tasks`

**Full-text search across tasks**

#### Input Parameters

```typescript
{
  query: string;             // Search in title, description
  status_filter?: string[];  // Filter by status
  limit?: number;
}
```

#### Output Format

```json
{
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Implement progress.list_tasks",
      "status": "in_progress",
      "match": "list_tasks MCP handler",
      "relevance": 0.95
    }
  ],
  "total_matches": 1
}
```

#### Token Efficiency

- **Input:** ~20-40 tokens
- **Output:** ~60-180 tokens
- **Total:** ~80-220 tokens

---

## Storage Schema

### RocksDB Key-Value Layout

```
Prefix System:
  task:          Task metadata
  idx_status:    Index by status
  idx_spec:      Index by spec
  idx_session:   Index by session
  idx_priority:  Index by priority
  meta:          System metadata
```

### Key Formats

```rust
// Task storage
Key:   b"task:{task_id}"
Value: bincode::serialize(Task)

// Status index (for fast filtering)
Key:   b"idx_status:{status}:{task_id}"
Value: b"1" (marker)

// Spec index
Key:   b"idx_spec:{spec_name}:{task_id}"
Value: b"1"

// Session index
Key:   b"idx_session:{session_id}:{task_id}"
Value: b"1"

// Priority index
Key:   b"idx_priority:{priority}:{task_id}"
Value: b"1"

// System metadata
Key:   b"meta:task_count"
Value: bincode::serialize(u64)

Key:   b"meta:last_updated"
Value: bincode::serialize(DateTime<Utc>)
```

### Index Management

When task status changes:
1. Remove old index entry: `idx_status:{old_status}:{task_id}`
2. Add new index entry: `idx_status:{new_status}:{task_id}`

**Benefits:**
- O(1) lookups by status
- Fast filtering without scanning all tasks
- Efficient range queries

---

## Integration Points

### 1. Memory System Integration

**Automatic Episode Recording**

When `progress.mark_complete` is called:

```rust
// src/progress/manager.rs

pub async fn mark_complete(&mut self, params: MarkCompleteParams) -> Result<MarkCompleteResponse> {
    let task = self.get_task(&params.task_id)?;

    // Update task status
    task.update_status(TaskStatus::Done, Some("Completed".to_string()))?;
    task.actual_hours = params.actual_hours;
    task.commit_hash = params.commit_hash;

    // Auto-record episode
    let episode = TaskEpisode {
        id: EpisodeId::new(),
        timestamp: Utc::now(),
        task_description: task.title.clone(),
        queries_made: params.queries_made.unwrap_or_default(),
        files_touched: params.files_touched.unwrap_or_default(),
        solution_path: params.solution_summary.unwrap_or_default(),
        outcome: Outcome::Success,
        tokens_used: TokenCount::zero(), // Could track if available
        initial_context: ContextSnapshot::default(),
        access_count: 0,
        pattern_value: 0.0,
    };

    // Record in memory system
    let episode_id = self.memory_system.record_episode(episode).await?;

    // Link back to task
    task.episode_id = Some(episode_id.0.clone());
    self.save_task(task)?;

    Ok(MarkCompleteResponse {
        task_id: params.task_id,
        status: TaskStatus::Done,
        completed_at: task.completed_at.unwrap(),
        episode_id: Some(episode_id.0),
        episode_recorded: true,
    })
}
```

**Benefits:**
- No manual episode recording
- Task history → procedural memory
- Pattern extraction from task completion

---

### 2. Specification Manager Integration

**Spec Section Validation**

```rust
// src/progress/manager.rs

pub async fn link_to_spec(&mut self, params: LinkToSpecParams) -> Result<LinkToSpecResponse> {
    let task = self.get_task(&params.task_id)?;

    // Validate spec section exists (if requested)
    if params.validate.unwrap_or(true) {
        let spec_manager = self.spec_manager.lock().await;

        // Check if spec exists
        spec_manager.get_spec(&params.spec_name)?;

        // Check if section exists
        let sections = spec_manager.list_sections(&params.spec_name)?;
        let section_exists = sections.iter().any(|s| {
            s.to_lowercase().contains(&params.section.to_lowercase())
        });

        if !section_exists {
            return Err(anyhow::anyhow!(
                "Section '{}' not found in spec '{}'",
                params.section,
                params.spec_name
            ));
        }
    }

    // Link task to spec
    task.spec_ref = Some(SpecReference {
        spec_name: params.spec_name.clone(),
        section: params.section.clone(),
    });

    self.save_task(task)?;

    Ok(LinkToSpecResponse { /* ... */ })
}
```

**Spec Coverage Analysis**

```rust
pub async fn get_spec_coverage(&self, spec_name: &str) -> Result<SpecCoverageReport> {
    // Get all sections from spec
    let spec_manager = self.spec_manager.lock().await;
    let sections = spec_manager.list_sections(spec_name)?;

    // Get all tasks for this spec
    let tasks = self.list_tasks_by_spec(spec_name)?;

    // Calculate coverage
    let mut section_coverage = HashMap::new();
    for task in &tasks {
        if let Some(ref_) = &task.spec_ref {
            let count = section_coverage.entry(ref_.section.clone()).or_insert(0);
            *count += 1;
        }
    }

    Ok(SpecCoverageReport {
        spec_name: spec_name.to_string(),
        total_sections: sections.len(),
        covered_sections: section_coverage.len(),
        coverage_percentage: (section_coverage.len() as f32 / sections.len() as f32) * 100.0,
        section_details: section_coverage,
    })
}
```

---

### 3. Session Manager Integration

**Track Active Task per Session**

```rust
// In SessionManager

pub struct Session {
    pub id: SessionId,
    pub active_task_id: Option<TaskId>,
    // ... other fields
}

impl Session {
    pub fn set_active_task(&mut self, task_id: TaskId) {
        self.active_task_id = Some(task_id);
    }
}
```

**Auto-update session when task status changes:**

```rust
// In ProgressManager

pub async fn update_task(&mut self, params: UpdateTaskParams) -> Result<UpdateTaskResponse> {
    let task = self.get_task(&params.task_id)?;

    // If transitioning to InProgress, set as active task for current session
    if let Some(new_status) = params.status {
        if new_status == TaskStatus::InProgress {
            if let Some(session_id) = &self.current_session_id {
                self.session_manager.set_active_task(session_id, task.id.clone()).await?;
                task.active_session_id = Some(session_id.clone());
            }
        }
    }

    // ... rest of update logic
}
```

---

### 4. Git Integration (Optional)

**Link Commits to Tasks**

```rust
pub async fn link_commit(&mut self, task_id: TaskId, commit_hash: String) -> Result<()> {
    let task = self.get_task(&task_id)?;
    task.commit_hash = Some(commit_hash.clone());

    // Optionally: verify commit exists
    if let Ok(git_history) = self.git_history.lock().await {
        // Could validate commit hash
    }

    self.save_task(task)?;
    Ok(())
}
```

**Find Tasks for Commit**

```rust
pub async fn find_tasks_by_commit(&self, commit_hash: &str) -> Result<Vec<Task>> {
    let all_tasks = self.list_all_tasks()?;
    Ok(all_tasks.into_iter()
        .filter(|t| t.commit_hash.as_deref() == Some(commit_hash))
        .collect())
}
```

---

## Token Efficiency

### Comparison: Before vs After

**Scenario:** List 10 in-progress tasks

**TodoWrite Approach:**
```json
{
  "todos": [
    {
      "content": "Implement progress.create_task",
      "status": "in_progress",
      "activeForm": "Implementing progress.create_task"
    },
    // ... 9 more (full objects)
  ]
}
```
**Token Cost:** ~500 tokens

**Progress System Approach:**
```json
{
  "tasks": [
    {
      "id": "550e8400",
      "title": "Implement progress.create_task",
      "status": "in_progress",
      "priority": "high",
      "updated_at": "2025-10-18T14:35:00Z"
    },
    // ... 9 more (summaries only)
  ],
  "total": 10
}
```
**Token Cost:** ~150 tokens

**Savings:** 70% reduction

---

### Progressive Detail Loading

**Level 1: List (Minimal)**
```typescript
progress.list_tasks({ status: "in_progress" })
// Returns: TaskSummary[] (id, title, status, priority, updated_at)
// Cost: ~100 tokens
```

**Level 2: Get (Full)**
```typescript
progress.get_task({ task_id: "550e8400" })
// Returns: Task (all fields)
// Cost: ~200 tokens
```

**Level 3: History (Detailed)**
```typescript
progress.get_task({ task_id: "550e8400", include_history: true })
// Returns: Task + StatusTransition[]
// Cost: ~300 tokens
```

**Strategy:** Only load what you need, when you need it

---

### Smart Filtering

**Bad (Fetch All, Filter Client-Side):**
```typescript
const all = await progress.list_tasks({ status: "all" });
const mine = all.tasks.filter(t => t.spec_ref?.spec_name === "my-spec");
// Cost: 500+ tokens (all tasks)
```

**Good (Filter Server-Side):**
```typescript
const mine = await progress.list_tasks({
  spec_name: "my-spec",
  status: "in_progress"
});
// Cost: ~100 tokens (filtered results)
```

---

### Caching Strategy

**In-Memory Cache (Rust)**
```rust
pub struct ProgressManager {
    storage: Arc<RocksDBStorage>,
    cache: Arc<RwLock<LruCache<TaskId, Task>>>,
}

impl ProgressManager {
    pub fn get_task(&self, task_id: &TaskId) -> Result<Task> {
        // Check cache first
        if let Some(task) = self.cache.read().unwrap().get(task_id) {
            return Ok(task.clone());
        }

        // Load from storage
        let task = self.load_from_storage(task_id)?;

        // Cache for next time
        self.cache.write().unwrap().put(task_id.clone(), task.clone());

        Ok(task)
    }
}
```

**Benefits:**
- Repeat calls to `get_task` are instant
- No repeated serialization/deserialization
- Bounded memory usage (LRU eviction)

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

**Goal:** Basic task CRUD in RocksDB

**Tasks:**
1. Create `src/progress/mod.rs` module structure
2. Implement data types in `src/progress/types.rs`
3. Implement `ProgressManager` in `src/progress/manager.rs`
   - `create_task`
   - `update_task`
   - `get_task`
   - `delete_task`
4. Implement storage layer in `src/progress/storage.rs`
   - RocksDB operations
   - Index management
5. Add unit tests

**Deliverables:**
- [ ] Task CRUD works locally
- [ ] 80%+ test coverage
- [ ] No MCP integration yet

**Estimated Time:** 2-3 days

---

### Phase 2: MCP Handler Integration (Week 1)

**Goal:** Expose via MCP tools

**Tasks:**
1. Add tool definitions in `src/mcp/tools.rs`
2. Implement handlers in `src/mcp/handlers.rs`
   - `handle_create_task`
   - `handle_update_task`
   - `handle_list_tasks`
   - `handle_get_task`
   - `handle_delete_task`
3. Add `ProgressManager` to `ToolHandlers` struct
4. Test via Claude Code

**Deliverables:**
- [ ] All 5 basic tools work in Claude Code
- [ ] Integration tests pass
- [ ] Token costs measured

**Estimated Time:** 2 days

---

### Phase 3: Advanced Features (Week 2)

**Goal:** Progress stats, search, spec linking

**Tasks:**
1. Implement `get_progress` with stats calculation
2. Implement `search_tasks` with full-text search
3. Implement `link_to_spec` with validation
4. Implement `get_history`
5. Add MCP handlers for new tools

**Deliverables:**
- [ ] All 10 tools implemented
- [ ] Spec validation works
- [ ] Progress percentages accurate

**Estimated Time:** 3 days

---

### Phase 4: Memory Integration (Week 2)

**Goal:** Auto-record episodes on task completion

**Tasks:**
1. Implement `mark_complete` handler
2. Integrate with `MemorySystem::record_episode`
3. Link episode ID back to task
4. Test episode recording flow
5. Verify patterns extracted from tasks

**Deliverables:**
- [ ] Completed tasks → automatic episodes
- [ ] Episode IDs stored in tasks
- [ ] Memory system learns from task history

**Estimated Time:** 2 days

---

### Phase 5: Session & Git Integration (Week 3)

**Goal:** Track active tasks per session, link commits

**Tasks:**
1. Add `active_task_id` to `Session` type
2. Auto-update active task on status change
3. Implement commit linking
4. Add `find_tasks_by_commit` query
5. Test session continuity

**Deliverables:**
- [ ] Sessions know active task
- [ ] Commits linked to tasks
- [ ] Can query by commit hash

**Estimated Time:** 2 days

---

### Phase 6: Polish & Documentation (Week 3)

**Goal:** Production-ready, documented

**Tasks:**
1. Add comprehensive error messages
2. Write user guide in `meridian/docs/progress-guide.md`
3. Add examples to specification
4. Performance testing (1000+ tasks)
5. Token cost benchmarks
6. Fix any bugs found

**Deliverables:**
- [ ] User guide complete
- [ ] Performance validated
- [ ] Token costs documented
- [ ] All tests passing

**Estimated Time:** 2-3 days

---

### Total Timeline

**3 weeks** for full implementation, including:
- Core functionality: 1 week
- Advanced features: 1 week
- Integration & polish: 1 week

---

## Testing Strategy

### Unit Tests

**Test Coverage Requirements:** 80%+

```rust
// src/progress/manager.rs tests

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_task() {
        let manager = ProgressManager::new_test();

        let task_id = manager.create_task(CreateTaskParams {
            title: "Test task".to_string(),
            description: None,
            priority: Some(Priority::High),
            spec_name: None,
            section: None,
            tags: vec![],
            estimated_hours: None,
            related_tasks: vec![],
        }).await.unwrap();

        let task = manager.get_task(&task_id).unwrap();
        assert_eq!(task.title, "Test task");
        assert_eq!(task.priority, Priority::High);
        assert_eq!(task.status, TaskStatus::Pending);
    }

    #[tokio::test]
    async fn test_status_transition() {
        let manager = ProgressManager::new_test();
        let task_id = manager.create_task(/* ... */).await.unwrap();

        // Valid transition
        manager.update_task(UpdateTaskParams {
            task_id: task_id.clone(),
            status: Some(TaskStatus::InProgress),
            status_note: None,
            ..Default::default()
        }).await.unwrap();

        let task = manager.get_task(&task_id).unwrap();
        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.history.len(), 1);
    }

    #[tokio::test]
    async fn test_invalid_transition() {
        let manager = ProgressManager::new_test();
        let task_id = manager.create_task(/* ... */).await.unwrap();

        // Mark as done
        manager.update_task(UpdateTaskParams {
            task_id: task_id.clone(),
            status: Some(TaskStatus::Done),
            ..Default::default()
        }).await.unwrap();

        // Try to change from done (should fail)
        let result = manager.update_task(UpdateTaskParams {
            task_id: task_id.clone(),
            status: Some(TaskStatus::InProgress),
            ..Default::default()
        }).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_list_tasks_with_filter() {
        let manager = ProgressManager::new_test();

        // Create tasks
        let id1 = manager.create_task(/* status: Pending */).await.unwrap();
        let id2 = manager.create_task(/* status: InProgress */).await.unwrap();
        let id3 = manager.create_task(/* status: Pending */).await.unwrap();

        // Filter by status
        let result = manager.list_tasks(ListTasksParams {
            status: Some(TaskStatus::Pending),
            ..Default::default()
        }).await.unwrap();

        assert_eq!(result.tasks.len(), 2);
    }

    #[tokio::test]
    async fn test_progress_calculation() {
        let manager = ProgressManager::new_test();

        // Create 10 tasks (mix of statuses)
        for i in 0..10 {
            let id = manager.create_task(/* ... */).await.unwrap();
            if i < 5 {
                manager.update_task(UpdateTaskParams {
                    task_id: id,
                    status: Some(TaskStatus::Done),
                    ..Default::default()
                }).await.unwrap();
            }
        }

        let stats = manager.get_progress(GetProgressParams {
            spec_name: None,
            group_by: None,
        }).await.unwrap();

        assert_eq!(stats.total_tasks, 10);
        assert_eq!(stats.done, 5);
        assert_eq!(stats.completion_percentage, 50.0);
    }
}
```

---

### Integration Tests

**Test MCP Tool Flow**

```rust
// tests/progress_integration.rs

#[tokio::test]
async fn test_mcp_create_and_list() {
    let server = start_test_mcp_server().await;

    // Create task via MCP
    let create_response = server.call_tool("progress.create_task", json!({
        "title": "Test integration",
        "priority": "high"
    })).await.unwrap();

    let task_id = create_response["task_id"].as_str().unwrap();

    // List tasks via MCP
    let list_response = server.call_tool("progress.list_tasks", json!({
        "status": "pending"
    })).await.unwrap();

    let tasks = list_response["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["id"].as_str().unwrap(), task_id);
}

#[tokio::test]
async fn test_mark_complete_creates_episode() {
    let server = start_test_mcp_server().await;

    // Create and complete task
    let task_id = create_test_task(&server).await;

    let complete_response = server.call_tool("progress.mark_complete", json!({
        "task_id": task_id,
        "actual_hours": 2.5,
        "solution_summary": "Implemented feature X",
        "files_touched": ["src/main.rs"]
    })).await.unwrap();

    assert_eq!(complete_response["episode_recorded"].as_bool().unwrap(), true);

    let episode_id = complete_response["episode_id"].as_str().unwrap();

    // Verify episode exists
    let episodes = server.call_tool("memory.find_similar_episodes", json!({
        "task_description": "feature X"
    })).await.unwrap();

    assert!(episodes["episodes"].as_array().unwrap().len() > 0);
}
```

---

### Performance Tests

**Test with 1000+ tasks**

```rust
#[tokio::test]
async fn test_performance_large_dataset() {
    let manager = ProgressManager::new_test();

    // Create 1000 tasks
    let start = Instant::now();
    for i in 0..1000 {
        manager.create_task(CreateTaskParams {
            title: format!("Task {}", i),
            ..Default::default()
        }).await.unwrap();
    }
    let create_duration = start.elapsed();

    // List tasks (should use index)
    let start = Instant::now();
    let result = manager.list_tasks(ListTasksParams {
        status: Some(TaskStatus::Pending),
        limit: Some(50),
        ..Default::default()
    }).await.unwrap();
    let list_duration = start.elapsed();

    println!("Created 1000 tasks in {:?}", create_duration);
    println!("Listed 50 tasks in {:?}", list_duration);

    assert!(create_duration < Duration::from_secs(5));
    assert!(list_duration < Duration::from_millis(100));
    assert_eq!(result.tasks.len(), 50);
}
```

---

## Examples

### Example 1: Implementing a Specification

**Scenario:** You're implementing the progress tracking system itself

```typescript
// Step 1: Create tasks for each phase
const phase1 = await progress.create_task({
  title: "Phase 1: Core Infrastructure",
  description: "Implement basic task CRUD in RocksDB",
  priority: "critical",
  spec_name: "progress-tracking-tools-spec",
  section: "Implementation Plan",
  tags: ["phase-1", "rust"],
  estimated_hours: 16
});

const phase2 = await progress.create_task({
  title: "Phase 2: MCP Handler Integration",
  description: "Expose tasks via MCP tools",
  priority: "critical",
  spec_name: "progress-tracking-tools-spec",
  section: "Implementation Plan",
  tags: ["phase-2", "mcp"],
  estimated_hours: 12
});

// Step 2: Start working on Phase 1
await progress.update_task({
  task_id: phase1.task_id,
  status: "in_progress",
  status_note: "Starting with type definitions"
});

// Step 3: Check progress
const stats = await progress.get_progress({
  spec_name: "progress-tracking-tools-spec"
});
// => { total: 2, done: 0, in_progress: 1, percentage: 0% }

// Step 4: Complete Phase 1
await progress.mark_complete({
  task_id: phase1.task_id,
  actual_hours: 18,
  commit_hash: "abc123def",
  solution_summary: "Implemented Task, TaskStatus, ProgressManager with RocksDB storage",
  files_touched: [
    "src/progress/types.rs",
    "src/progress/manager.rs",
    "src/progress/storage.rs"
  ]
});

// Step 5: Verify episode recorded
const episodes = await memory.find_similar_episodes({
  task_description: "Core Infrastructure"
});
// => Episode found with solution_path, files_touched, etc.
```

---

### Example 2: Bug Fix Workflow

```typescript
// Create bug task
const bug = await progress.create_task({
  title: "Fix: list_tasks returns wrong status filter",
  description: "When filtering by 'in_progress', it returns all statuses",
  priority: "high",
  tags: ["bug", "mcp"],
  estimated_hours: 1
});

// Start debugging
await progress.update_task({
  task_id: bug.task_id,
  status: "in_progress"
});

// Found root cause, mark as blocked (waiting for review)
await progress.update_task({
  task_id: bug.task_id,
  status: "blocked",
  status_note: "Waiting for code review before merging fix"
});

// Review done, resume work
await progress.update_task({
  task_id: bug.task_id,
  status: "in_progress",
  status_note: "Review approved, merging fix"
});

// Complete with commit
await progress.mark_complete({
  task_id: bug.task_id,
  actual_hours: 1.5,
  commit_hash: "xyz789",
  solution_summary: "Fixed status filter logic in list_tasks_by_status()",
  files_touched: ["src/progress/manager.rs"],
  queries_made: ["code.search_symbols list_tasks"]
});
```

---

### Example 3: Daily Workflow

```typescript
// Morning: See what's in progress
const active = await progress.list_tasks({
  status: "in_progress",
  sort_by: "updated",
  order: "desc"
});
// => [task1, task2, task3]

// Check details on most recent
const details = await progress.get_task({
  task_id: active.tasks[0].id,
  include_history: true
});
// => Full task with history

// Check overall progress
const stats = await progress.get_progress();
// => { total: 42, done: 20, in_progress: 3, percentage: 47.6% }

// Afternoon: Search for old task
const found = await progress.search_tasks({
  query: "authentication",
  status_filter: ["done"]
});
// => Tasks related to auth

// Get task history to see how it was solved
const history = await progress.get_history({
  task_id: found.results[0].id
});
// => [created → in_progress → blocked → in_progress → done]
```

---

## Appendix: File Structure

### New Files to Create

```
meridian/
├── src/
│   ├── progress/
│   │   ├── mod.rs              # Module exports
│   │   ├── types.rs            # Task, TaskStatus, etc.
│   │   ├── manager.rs          # ProgressManager
│   │   ├── storage.rs          # RocksDB operations
│   │   └── tests.rs            # Unit tests
│   ├── mcp/
│   │   ├── handlers.rs         # Add progress tool handlers
│   │   └── tools.rs            # Add progress tool definitions
│   └── lib.rs                  # Export progress module
├── tests/
│   └── progress_integration.rs # Integration tests
└── docs/
    └── progress-guide.md       # User guide
```

---

## Success Metrics

### Functional Metrics

- [ ] All 10 MCP tools work correctly
- [ ] Tasks persist across restarts
- [ ] Status transitions validated
- [ ] Spec linking works with validation
- [ ] Auto-episode recording works
- [ ] Session integration works

### Performance Metrics

- [ ] Create task: < 10ms
- [ ] List 100 tasks: < 50ms
- [ ] Get task: < 5ms (cached)
- [ ] Update task: < 10ms
- [ ] Progress calculation: < 100ms

### Token Efficiency Metrics

- [ ] List tasks: ~100 tokens (vs 500 with TodoWrite)
- [ ] Get task: ~200 tokens
- [ ] Mark complete: ~150 tokens
- [ ] Get progress: ~150 tokens

### Quality Metrics

- [ ] 80%+ test coverage
- [ ] No panics in production
- [ ] Graceful error messages
- [ ] Comprehensive logging

---

## Conclusion

The Progress Tracking System provides a **production-ready, token-efficient, MCP-native** solution for task management in Meridian. By integrating with the memory system, specification manager, and session manager, it creates a **seamless workflow** for LLM-assisted development.

**Key Benefits:**

1. **Persistent** - Tasks survive restarts
2. **Efficient** - 70% token reduction vs TodoWrite
3. **Integrated** - Auto-records episodes, validates specs
4. **Queryable** - Filter by status, spec, session, priority
5. **Trackable** - Progress %, history, estimates
6. **Professional** - Production-grade error handling, testing

**Next Steps:**

1. Review this specification
2. Begin Phase 1 implementation
3. Test with real use cases
4. Iterate based on feedback

---

**Related Specifications:**
- `spec.md` - Core Meridian architecture
- `MCP_TOOLS_SPEC_MANAGEMENT.md` - Spec management tools
- `roadmap.md` - Implementation roadmap

**Version History:**
- 1.0.0 (2025-10-18): Initial design
