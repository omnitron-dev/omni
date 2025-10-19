# Agent Coordination & Multi-Agent Patterns

**Version**: 1.0.0
**Status**: Active
**Last Updated**: 2025-10-19

This specification documents patterns for multi-agent collaboration, delegation, and coordination in the Omnitron development environment.

---

## Table of Contents

1. [Overview](#overview)
2. [Agent Types & Roles](#agent-types-roles)
3. [Coordination Patterns](#coordination-patterns)
4. [Communication Protocols](#communication-protocols)
5. [Task Delegation](#task-delegation)
6. [Conflict Resolution](#conflict-resolution)
7. [Knowledge Sharing](#knowledge-sharing)

---

## Overview

The Omnitron development environment supports multiple specialized agents that collaborate on complex tasks. Each agent has specific expertise and can be invoked for specialized work.

### Core Principles

1. **Specialization**: Each agent has a specific domain of expertise
2. **Autonomy**: Agents make independent decisions within their domain
3. **Collaboration**: Agents share knowledge through the memory system
4. **Traceability**: All agent actions are recorded in the task/episode system

### Agent Location

Specialized agents are defined in `.claude/agents/` directory.

---

## Agent Types & Roles

### Primary Agent (You)

**Role**: General-purpose development agent
**Responsibilities**:
- Task coordination
- Code implementation
- Testing
- Documentation
- Memory management

**Key Characteristics**:
- Broad knowledge across the codebase
- Delegates to specialists when needed
- Records episodes for all work

### Specialized Agents (Examples)

#### Refactoring Agent

**Role**: Code refactoring and quality improvement
**Expertise**:
- Complexity analysis
- Pattern extraction
- Dependency management
- Test generation

**When to Invoke**:
- High complexity code (cyclomatic > 15)
- Circular dependencies detected
- Code duplication found

#### Testing Agent

**Role**: Comprehensive test generation and validation
**Expertise**:
- Unit test generation
- Integration test design
- Coverage analysis
- Test framework selection

**When to Invoke**:
- Coverage below target (< 80%)
- New feature requiring comprehensive tests
- Test validation needed

#### Documentation Agent

**Role**: Documentation generation and validation
**Expertise**:
- API documentation
- Code comments
- Specification writing
- Example generation

**When to Invoke**:
- Undocumented code found
- API changes requiring doc updates
- Spec creation needed

---

## Coordination Patterns

### Pattern 1: Task Delegation

**Scenario**: Primary agent encounters specialized work.

```typescript
// Primary agent creates task and delegates

// 1. Create main task
const mainTask = await mcp__meridian__task_create_task({
  title: "Implement authentication system",
  priority: "high",
  estimated_hours: 20
});

// 2. Create specialized subtask
const refactorSubtask = await mcp__meridian__task_create_task({
  title: "Refactor existing auth code (complexity too high)",
  description: "Delegate to refactoring agent",
  priority: "high",
  tags: ["refactoring", "delegated"]
});

// 3. Set dependency
await mcp__meridian__task_add_dependency({
  task_id: mainTask.task_id,
  depends_on: refactorSubtask.task_id
});

// 4. Record delegation in episode
await mcp__meridian__task_update_task({
  task_id: refactorSubtask.task_id,
  status_note: "Delegated to refactoring agent - complexity analysis required"
});

// Refactoring agent picks up the task
// ... specialized work happens ...

// 5. Refactoring agent completes and records
await mcp__meridian__task_mark_complete({
  task_id: refactorSubtask.task_id,
  solution_summary: "Reduced complexity from 28 to 8 by extracting validators",
  files_touched: ["src/auth/validator.rs", "src/auth/processor.rs"]
});

// 6. Primary agent resumes main task
```

### Pattern 2: Collaborative Analysis

**Scenario**: Multiple agents analyze different aspects of the same code.

```typescript
// Agent 1: Complexity analysis
const complexity = await mcp__meridian__analyze_complexity({
  target: "src/api/handler.rs",
  include_metrics: ["cyclomatic", "cognitive"]
});

// Record findings
await mcp__meridian__task_update_task({
  task_id: taskId,
  status_note: `Complexity analysis: cyclomatic=${complexity.cyclomatic}, cognitive=${complexity.cognitive}`
});

// Agent 2: Dependency analysis
const deps = await mcp__meridian__graph_find_dependencies({
  symbol_id: "ApiHandler",
  depth: 3
});

// Agent 3: Test coverage analysis
const coverage = await mcp__meridian__tests_validate({
  test: existingTests
});

// All findings are recorded and accessible to all agents
```

### Pattern 3: Sequential Handoff

**Scenario**: Work passes through multiple agents in sequence.

```typescript
// 1. Analysis Agent
const analysisTask = await mcp__meridian__task_create_task({
  title: "Analyze codebase for refactoring opportunities"
});

await mcp__meridian__task_mark_complete({
  task_id: analysisTask.task_id,
  solution_summary: "Found 12 high-complexity modules, 3 circular deps",
  queries_made: ["graph.find_hubs", "analyze.complexity", "graph.find_circular_dependencies"]
});

// 2. Planning Agent (uses analysis results)
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "plan refactoring based on analysis"
});

const planTask = await mcp__meridian__task_create_task({
  title: "Create refactoring plan",
  description: `Based on analysis task ${analysisTask.task_id}`
});

// 3. Implementation Agent (uses plan)
// ... and so on
```

### Pattern 4: Parallel Execution

**Scenario**: Multiple independent tasks executed concurrently.

```typescript
// Create multiple independent tasks
const tasks = await Promise.all([
  mcp__meridian__task_create_task({
    title: "Implement user endpoints",
    tags: ["api", "parallel-1"]
  }),
  mcp__meridian__task_create_task({
    title: "Implement auth endpoints",
    tags: ["api", "parallel-2"]
  }),
  mcp__meridian__task_create_task({
    title: "Implement admin endpoints",
    tags: ["api", "parallel-3"]
  })
]);

// Different agents can work on these concurrently
// No dependencies between them

// All complete independently
// Episodes are recorded for each
```

---

## Communication Protocols

### Via Memory System

**Primary communication mechanism**: Episodes recorded in memory system.

```typescript
// Agent 1 completes work
await mcp__meridian__task_mark_complete({
  task_id: task1.task_id,
  solution_summary: "Detailed explanation of approach and findings",
  files_touched: ["..."],
  queries_made: ["..."]
});

// Agent 2 queries for context
const context = await mcp__meridian__memory_find_similar_episodes({
  task_description: "related work"
});

// Agent 2 learns from Agent 1's episode
context.forEach(ep => {
  console.log(`Previous approach: ${ep.solution}`);
  console.log(`Outcome: ${ep.outcome}`);
});
```

### Via Task System

**Coordination mechanism**: Task dependencies and status updates.

```typescript
// Agent 1 creates task and blocks on dependency
const task = await mcp__meridian__task_create_task({
  title: "Integration tests"
});

await mcp__meridian__task_add_dependency({
  task_id: task.task_id,
  depends_on: prerequisiteTaskId
});

// Agent 2 can check if ready
const canStart = await mcp__meridian__task_can_start_task({
  task_id: task.task_id
});

if (!canStart.can_start) {
  console.log("Waiting for:", canStart.blockers);
}
```

### Via Semantic Links

**Knowledge graph**: Link related code, docs, tests, specs.

```typescript
// Agent 1 creates implementation
await mcp__meridian__links_add_link({
  link_type: "implements",
  source_level: "code",
  source_id: "AuthService::login",
  target_level: "spec",
  target_id: "auth-spec#login"
});

// Agent 2 can discover related items
const links = await mcp__meridian__links_get_links({
  entity_level: "code",
  entity_id: "AuthService::login",
  direction: "both"
});
```

---

## Task Delegation

### When to Delegate

Delegate to specialized agents when:

1. **Complexity exceeds threshold**
   - Cyclomatic complexity > 15
   - Cognitive complexity > 20
   - File size > 500 lines

2. **Specialized expertise required**
   - Performance optimization
   - Security analysis
   - Complex refactoring

3. **Large scope**
   - Multiple interrelated changes
   - Cross-cutting concerns
   - Architectural changes

4. **Quality gates**
   - Test coverage below target
   - Documentation missing
   - Code review findings

### Delegation Protocol

```typescript
// 1. Identify need for specialization
const complexity = await mcp__meridian__analyze_complexity({
  target: "src/module.rs"
});

if (complexity.cyclomatic > 15) {
  // 2. Create delegation task
  const delegatedTask = await mcp__meridian__task_create_task({
    title: "Refactor high-complexity module",
    description: `Complexity: ${complexity.cyclomatic}. Needs specialist attention.`,
    priority: "high",
    tags: ["delegated", "refactoring", "specialist-required"]
  });

  // 3. Record delegation context
  await mcp__meridian__task_update_task({
    task_id: delegatedTask.task_id,
    status_note: "Delegated to refactoring specialist. See complexity analysis in episode."
  });

  // 4. Create episode with context
  await mcp__meridian__memory_record_episode({
    task: "Complexity analysis for delegation",
    outcome: "success",
    solution: `Found complexity ${complexity.cyclomatic}, delegating to specialist`,
    queries_made: ["analyze.complexity"]
  });
}
```

### Handoff Checklist

Before delegating:
- [ ] Create clear, specific task description
- [ ] Include relevant context (complexity, dependencies, etc.)
- [ ] Set appropriate priority and tags
- [ ] Record delegation in episode
- [ ] Link to related specs/docs
- [ ] Set dependencies if needed

---

## Conflict Resolution

### Preventing Conflicts

```typescript
// Use sessions for isolated work
const session = await mcp__meridian__session_begin({
  task_description: "Refactor module X",
  scope: ["src/module_x/"]
});

// Work happens in isolation
// No conflicts with other agents working on different modules

await mcp__meridian__session_complete({
  session_id: session.session_id,
  action: "commit"
});
```

### Detecting Conflicts

```typescript
// Before making changes, check impact
const impact = await mcp__meridian__graph_impact_analysis({
  changed_symbols: ["ModuleX::function"]
});

if (impact.risk_level === "high") {
  // Create coordination task
  const coordTask = await mcp__meridian__task_create_task({
    title: "Coordinate high-impact change",
    description: `Affects ${impact.directly_affected.length} symbols`,
    priority: "critical",
    tags: ["coordination", "high-impact"]
  });
}
```

### Resolving Conflicts

1. **Check task dependencies**
   ```typescript
   const deps = await mcp__meridian__task_get_dependencies({
     task_id: myTaskId
   });

   const dependents = await mcp__meridian__task_get_dependents({
     task_id: myTaskId
   });
   ```

2. **Query memory for similar situations**
   ```typescript
   const episodes = await mcp__meridian__memory_find_similar_episodes({
     task_description: "resolve conflicting changes",
     limit: 5
   });
   ```

3. **Create coordination task if needed**
   ```typescript
   const coordTask = await mcp__meridian__task_create_task({
     title: "Resolve conflict between tasks",
     description: "Conflicting changes to ModuleX",
     priority: "critical",
     tags: ["conflict", "coordination"]
   });
   ```

---

## Knowledge Sharing

### Recording Knowledge for Others

```typescript
// Be detailed in solution summaries
await mcp__meridian__task_mark_complete({
  task_id: task.task_id,
  solution_summary: `
    Approach: Used strategy pattern to reduce complexity
    Why it worked: Separated concerns into distinct validators
    Challenges: Had to refactor 3 dependent modules
    Lessons learned: Always check impact analysis before refactoring
  `,
  files_touched: ["..."],
  queries_made: ["..."]
});
```

### Discovering Knowledge from Others

```typescript
// Query for related work
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "implement authentication"
});

// Review approaches
episodes.forEach(ep => {
  if (ep.outcome === "success") {
    console.log("Successful approach:", ep.solution);
    console.log("Queries used:", ep.queries_made);
  } else {
    console.log("Failed approach (avoid):", ep.solution);
  }
});
```

### Creating Semantic Links

```typescript
// Link your work to specs, tests, docs
await mcp__meridian__links_add_link({
  link_type: "implements",
  source_level: "code",
  source_id: "MyService::method",
  target_level: "spec",
  target_id: "my-spec#section",
  confidence: 0.95
});

// Others can discover your work
const relatedWork = await mcp__meridian__links_find_implementation({
  spec_id: "my-spec#section"
});
```

---

## Best Practices

### For All Agents

1. **Always query memory first**
   - Learn from past work
   - Avoid repeating mistakes
   - Leverage successful patterns

2. **Record detailed episodes**
   - Explain WHY, not just WHAT
   - Include challenges and solutions
   - List all queries used

3. **Create clear task descriptions**
   - Specific, actionable titles
   - Detailed descriptions
   - Appropriate tags

4. **Use semantic links**
   - Link code to specs
   - Link code to tests
   - Link code to docs

5. **Check dependencies**
   - Before starting work
   - Before completing work
   - Understand impact

### For Coordinating Agents

1. **Plan with dependencies**
   - Break large tasks into subtasks
   - Set clear dependencies
   - Monitor progress

2. **Delegate appropriately**
   - Recognize when specialized expertise needed
   - Provide clear context
   - Track delegation

3. **Monitor system health**
   - Check for circular dependencies
   - Verify link health
   - Review task progress

---

**Note:** For specific tool usage, see `mcp-tools-reference.md`. For workflows, see `workflows-and-patterns.md`.
