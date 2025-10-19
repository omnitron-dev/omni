# Meridian Agent System Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Meridian MCP Server                          │
│  (91+ Tools: code, tasks, memory, specs, docs, links, graph)   │
└─────────────────────────────────────────────────────────────────┘
                            ▲  ▲  ▲  ▲  ▲  ▲
                            │  │  │  │  │  │
                All agents communicate through MCP tools
                            │  │  │  │  │  │
        ┌───────────────────┴──┴──┴──┴──┴──┴────────────────────┐
        │                                                         │
        ▼                                                         ▼
┌───────────────┐  ┌────────────────┐  ┌──────────────────┐  ┌──────────────┐
│   Architect   │  │ Code Analyzer  │  │ Test Engineer    │  │  Optimizer   │
│  (architect)  │  │   (analyzer)   │  │    (tester)      │  │  (optimizer) │
│               │  │                │  │                  │  │              │
│ Architecture  │  │ Code Quality   │  │ Testing Strategy │  │ Performance  │
│ Design        │  │ Anti-patterns  │  │ Coverage         │  │ Benchmarking │
│ Dependencies  │  │ Security       │  │ Test Generation  │  │ Optimization │
└───────┬───────┘  └────────┬───────┘  └────────┬─────────┘  └──────┬───────┘
        │                   │                    │                   │
        │                   │                    │                   │
        └───────────────────┴────────────────────┴───────────────────┘
                            │                           │
                            ▼                           ▼
                    ┌───────────────┐         ┌──────────────────┐
                    │ Memory Curator│         │ Task Orchestrator│
                    │   (curator)   │         │  (orchestrator)  │
                    │               │         │                  │
                    │ Knowledge Org │         │ Workflow Mgmt    │
                    │ Documentation │         │ Coordination     │
                    │ Semantic Links│         │ Prioritization   │
                    └───────────────┘         └──────────────────┘
```

## Data Flow

### 1. Task Creation and Assignment Flow

```
User Request
    │
    ▼
┌─────────────────┐
│  Orchestrator   │ ──────┐
│                 │       │
│ • Analyzes req  │       │ Creates tasks with agent tags
│ • Breaks down   │       │
│ • Assigns       │       │
└─────────────────┘       │
                          ▼
                   ┌─────────────────────────┐
                   │   Task System (MCP)     │
                   │   tasks.create_task     │
                   │                         │
                   │ Tags: for:architect     │
                   │       for:analyzer      │
                   │       for:tester        │
                   │       for:optimizer     │
                   │       for:curator       │
                   └─────────────────────────┘
                          │
                          │ Agents query for their tasks
                          │
            ┌─────────────┼─────────────┬────────────────┐
            ▼             ▼             ▼                ▼
       Architect      Analyzer      Tester         Optimizer
            │             │             │                │
            │             │             │                │
            └─────────────┴─────────────┴────────────────┘
                          │
                          ▼
                   Work Completion
                          │
                          ▼
                   tasks.mark_complete
                          │
                          ▼
                   Auto Episode Recording
```

### 2. Knowledge Sharing Flow

```
Agent Completes Work
        │
        ▼
tasks.mark_complete
        │
        │ Automatically triggers
        ▼
memory.record_episode
        │
        │ Stores in SQLite DB
        ▼
┌─────────────────────┐
│  Episode Database   │
│                     │
│ • Task description  │
│ • Solution approach │
│ • Files touched     │
│ • Queries made      │
│ • Outcome           │
│ • Timing            │
└─────────────────────┘
        │
        │ Other agents discover
        ▼
memory.find_similar_episodes
        │
        ▼
┌─────────────────────┐
│   Agent Learning    │
│                     │
│ "Similar work was   │
│  done 3 months ago  │
│  using approach X"  │
└─────────────────────┘
```

### 3. Semantic Link Network

```
┌─────────┐         ┌──────────┐         ┌────────┐
│  Spec   │────────▶│   Code   │────────▶│ Tests  │
│         │implements│          │tested_by│        │
└────┬────┘         └─────┬────┘         └────────┘
     │                    │
     │ verified_by        │ documented_by
     │                    │
     ▼                    ▼
┌─────────┐         ┌──────────┐         ┌──────────┐
│  Tests  │         │   Docs   │◀────────│ Examples │
│         │         │          │demonstrates        │
└─────────┘         └──────────┘         └──────────┘

Links created by: Curator Agent
Links validated by: All agents
Links used by: All agents for context
```

## Agent Interaction Patterns

### Pattern 1: Sequential Handoff

```
Architect designs
    │
    │ Creates task: for:analyzer
    │
    ▼
Analyzer reviews quality
    │
    │ Creates task: for:tester
    │
    ▼
Tester creates tests
    │
    │ Creates task: for:optimizer
    │
    ▼
Optimizer benchmarks
    │
    │ Creates task: for:curator
    │
    ▼
Curator documents
```

### Pattern 2: Parallel Collaboration

```
Orchestrator creates feature tasks
    │
    └───────────┬──────────┬──────────┬──────────┐
                │          │          │          │
                ▼          ▼          ▼          ▼
           Architect  Analyzer   Tester    Optimizer
                │          │          │          │
                │ All work independently        │
                │ on different aspects          │
                │                                │
                └────────────┬───────────────────┘
                             │
                             ▼
                      Curator integrates
                      all documentation
```

### Pattern 3: Feedback Loop

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  Optimizer: "This code is slow"                 │
│      │                                          │
│      │ Creates: for:architect                   │
│      ▼                                          │
│  Architect: "Need to refactor algorithm"        │
│      │                                          │
│      │ Creates: for:analyzer                    │
│      ▼                                          │
│  Analyzer: "Code quality is good, can refactor" │
│      │                                          │
│      │ Creates: for:tester                      │
│      ▼                                          │
│  Tester: "Created regression tests"             │
│      │                                          │
│      │ Creates: for:optimizer                   │
│      ▼                                          │
│  Optimizer: "Refactoring complete, 50% faster"  │
│      │                                          │
│      └─────────────────────────────────────────►│
│                                                 │
│  Loop continues until metrics met               │
└─────────────────────────────────────────────────┘
```

## Database Schema (Simplified)

### Tasks Table
```sql
tasks {
  task_id: TEXT PRIMARY KEY
  title: TEXT
  description: TEXT
  status: TEXT  -- pending | in_progress | blocked | done | cancelled
  priority: TEXT  -- low | medium | high | critical
  tags: JSON  -- ['for:architect', 'architecture', 'refactoring']
  spec_ref: JSON  -- {spec_name, section}
  estimated_hours: REAL
  actual_hours: REAL
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Episodes Table
```sql
episodes {
  episode_id: TEXT PRIMARY KEY
  task: TEXT
  solution: TEXT
  outcome: TEXT  -- success | failure | partial
  files_accessed: JSON
  queries_made: JSON
  agent_id: TEXT  -- meridian-architect-001, etc.
  created_at: TIMESTAMP
}
```

### Links Table
```sql
semantic_links {
  link_id: TEXT PRIMARY KEY
  link_type: TEXT  -- implements | documents | tests | demonstrates
  source_level: TEXT  -- spec | code | docs | examples | tests
  source_id: TEXT
  target_level: TEXT
  target_id: TEXT
  confidence: REAL
  context: TEXT
  status: TEXT  -- valid | broken | stale | unchecked
}
```

## Agent Decision Matrix

### When to Activate Each Agent

| Situation | Primary Agent | Why |
|-----------|---------------|-----|
| New feature request | Orchestrator | Breaks down into tasks |
| Architecture question | Architect | Expertise in system design |
| Code smells detected | Analyzer | Quality and anti-pattern expert |
| Low test coverage | Tester | Testing specialist |
| Slow performance | Optimizer | Performance expert |
| Missing documentation | Curator | Knowledge organization |
| Unclear priorities | Orchestrator | Workflow management |
| Circular dependencies | Architect | System structure expert |
| Security vulnerability | Analyzer | Security pattern detection |
| Flaky tests | Tester | Test quality specialist |
| Memory leaks | Optimizer | Resource management expert |
| Knowledge gaps | Curator | Information architecture |

### Multi-Agent Scenarios

| Scenario | Agent Team | Sequence |
|----------|------------|----------|
| Implement new feature | Orchestrator → Architect → Tester → Curator | Sequential |
| Performance optimization | Optimizer → Architect → Tester | Sequential |
| Code quality improvement | Analyzer → Architect → Tester | Sequential |
| Documentation overhaul | Curator → Tester (examples) | Parallel |
| Major refactoring | Orchestrator → Architect → Analyzer → Tester → Optimizer | Sequential |
| Bug investigation | Analyzer → Tester → Curator | Sequential |

## Tool Usage by Agent

### High-Frequency Tools

**Architect**:
1. `code.get_dependencies` (20+ uses/day)
2. `graph.find_circular_dependencies` (10+ uses/day)
3. `analyze.complexity` (15+ uses/day)

**Analyzer**:
1. `code.search_patterns` (30+ uses/day)
2. `analyze.complexity` (25+ uses/day)
3. `links.find_orphans` (5+ uses/day)

**Tester**:
1. `tests.generate` (20+ uses/day)
2. `links.find_tests` (15+ uses/day)
3. `code.get_definition` (25+ uses/day)

**Optimizer**:
1. `analyze.complexity` (20+ uses/day)
2. `graph.get_call_graph` (15+ uses/day)
3. `graph.impact_analysis` (10+ uses/day)

**Curator**:
1. `links.find_orphans` (10+ uses/day)
2. `docs.validate` (15+ uses/day)
3. `memory.find_similar_episodes` (20+ uses/day)

**Orchestrator**:
1. `task.list_tasks` (50+ uses/day)
2. `task.get_dependencies` (30+ uses/day)
3. `task.update_task` (40+ uses/day)

## Success Monitoring

### Daily Health Check

```typescript
// Orchestrator runs daily
const health = {
  tasks: {
    total: await task.list_tasks({}).length,
    completed_today: ...,
    overdue: ...,
    blocked: ...
  },
  agents: {
    architect: { active_tasks: ..., pending: ... },
    analyzer: { active_tasks: ..., pending: ... },
    tester: { active_tasks: ..., pending: ... },
    optimizer: { active_tasks: ..., pending: ... },
    curator: { active_tasks: ..., pending: ... }
  },
  quality: {
    code_complexity: await analyze.complexity({...}),
    test_coverage: ...,
    documentation_score: ...,
    link_health: await links.get_health()
  }
};
```

### Weekly Performance Review

```typescript
// Orchestrator runs weekly
const performance = {
  completion_rate: ...,
  avg_time_to_complete: ...,
  blocker_resolution_time: ...,
  agent_efficiency: {
    architect: { tasks_completed: ..., avg_hours: ... },
    analyzer: { tasks_completed: ..., avg_hours: ... },
    // ... etc
  },
  quality_trends: {
    complexity_delta: ...,
    coverage_delta: ...,
    docs_delta: ...
  }
};
```

## Future Architecture

### Planned Enhancements

1. **Agent Learning Loop**
   - Agents track their own success metrics
   - Auto-adjust strategies based on outcomes
   - Share learnings through episode system

2. **Auto-Assignment**
   - Orchestrator uses ML to assign tasks
   - Based on agent capacity and expertise
   - Considers historical performance

3. **Conflict Resolution**
   - When agents disagree (e.g., "optimize now" vs "refactor first")
   - Decision tree based on priorities
   - Human-in-the-loop for critical decisions

4. **Predictive Planning**
   - Orchestrator predicts task duration
   - Based on similar past episodes
   - Warns about potential blockers

5. **Cross-Project Learning**
   - Agents learn from other meridian instances
   - Shared episode database (opt-in)
   - Best practices propagation
