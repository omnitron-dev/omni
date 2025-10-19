# Meridian Agent System

This directory contains specialized AI agents for meridian self-improvement. Each agent has unique expertise and responsibilities, but they all collaborate through meridian's MCP tools.

## Agent Roster

### 1. System Architect (`architect.md`)
**Agent ID**: `meridian-architect-001`

**Role**: System architecture design and evolution

**Expertise**:
- Distributed systems design
- Graph database architecture
- Cognitive architectures
- Performance optimization
- API design

**Primary Responsibilities**:
- Design and evolve system architecture
- Make informed architecture decisions
- Plan large-scale refactoring initiatives
- Manage system dependencies and module boundaries
- Ensure architectural consistency

**Key MCP Tools**:
- `code.get_dependencies` - Map dependency graphs
- `graph.find_circular_dependencies` - Detect architectural issues
- `analyze.complexity` - Assess architectural complexity
- `specs.validate` - Ensure specs are complete

---

### 2. Code Analyzer (`code-analyzer.md`)
**Agent ID**: `meridian-analyzer-001`

**Role**: Continuous code quality analysis

**Expertise**:
- Code quality assessment
- Anti-pattern detection
- Best practices enforcement
- Rust idioms
- Type safety and error handling

**Primary Responsibilities**:
- Detect code smells and anti-patterns
- Identify maintainability issues
- Suggest refactoring opportunities
- Enforce coding standards
- Monitor code complexity trends
- Identify security vulnerabilities

**Key MCP Tools**:
- `code.search_patterns` - AST-based pattern matching
- `analyze.complexity` - Measure code complexity
- `graph.find_similar_patterns` - Find duplicate logic
- `links.find_orphans` - Find undocumented code

---

### 3. Test Engineer (`test-engineer.md`)
**Agent ID**: `meridian-tester-001`

**Role**: Testing strategy and implementation

**Expertise**:
- Unit testing
- Integration testing
- Test coverage analysis
- Test generation
- TDD/BDD patterns

**Primary Responsibilities**:
- Generate comprehensive test suites
- Ensure test coverage meets standards (>80%)
- Create integration and E2E tests
- Validate test quality and effectiveness
- Identify untested code paths
- Maintain test documentation

**Key MCP Tools**:
- `tests.generate` - Generate unit/integration tests
- `tests.validate` - Validate test quality
- `examples.generate` - Create usage examples
- `links.find_tests` - Find existing tests

---

### 4. Performance Optimizer (`performance-optimizer.md`)
**Agent ID**: `meridian-optimizer-001`

**Role**: Performance analysis and optimization

**Expertise**:
- Algorithmic optimization
- Profiling and benchmarking
- Caching strategies
- Database optimization
- Async patterns and concurrency

**Primary Responsibilities**:
- Identify performance bottlenecks
- Optimize algorithm complexity
- Design caching strategies
- Optimize database queries
- Reduce memory allocations
- Improve async/concurrent code
- Monitor performance trends

**Key MCP Tools**:
- `analyze.complexity` - Measure algorithmic complexity
- `graph.get_call_graph` - Analyze hot paths
- `graph.impact_analysis` - Assess optimization impact
- `history.get_evolution` - Track performance changes

---

### 5. Memory Curator (`memory-curator.md`)
**Agent ID**: `meridian-curator-001`

**Role**: Knowledge base management and organization

**Expertise**:
- Knowledge organization
- Documentation quality
- Pattern extraction
- Semantic linking
- Information architecture

**Primary Responsibilities**:
- Organize and categorize episodes in memory system
- Extract patterns from historical data
- Maintain documentation quality and consistency
- Create semantic links between code, specs, docs, and tests
- Identify knowledge gaps
- Curate examples and best practices

**Key MCP Tools**:
- `memory.find_similar_episodes` - Find related knowledge
- `docs.validate` - Validate documentation quality
- `links.add_link` - Create semantic connections
- `links.find_orphans` - Find unlinked content

---

### 6. Task Orchestrator (`task-orchestrator.md`)
**Agent ID**: `meridian-orchestrator-001`

**Role**: Task coordination and workflow management

**Expertise**:
- Project management
- Workflow optimization
- Task prioritization
- Agent coordination
- Dependency management

**Primary Responsibilities**:
- Create and prioritize development tasks
- Coordinate work across specialized agents
- Manage task dependencies and blockers
- Track progress and deadlines
- Optimize workflow efficiency
- Ensure task completeness

**Key MCP Tools**:
- `task.create_task` - Create new tasks
- `task.get_dependencies` - Manage dependencies
- `task.get_progress` - Track progress metrics
- `task.can_start_task` - Check task readiness

---

## Agent Collaboration

### Communication Model

Agents **DO NOT** communicate directly with each other. Instead, they collaborate through meridian's MCP tools:

1. **Task System**: Agents create tasks tagged for other agents (e.g., `tags: ["for:architect"]`)
2. **Memory System**: Agents record episodes that others can learn from
3. **Link System**: Agents create semantic links that others can traverse
4. **Documentation**: Agents share findings through docs and specs

### Example Collaboration Flow

```typescript
// 1. Architect identifies need for optimization
await mcp__meridian__task_create_task({
  title: "Optimize graph traversal algorithm",
  description: "Performance bottleneck identified in hot path",
  tags: ["performance", "for:optimizer"],
  priority: "high"
});

// 2. Optimizer completes the work
await mcp__meridian__task_mark_complete({
  task_id: taskId,
  solution_summary: "Reduced complexity from O(n³) to O(n²)",
  // Auto-records episode
});

// 3. Tester finds the episode and creates tests
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "Optimize graph traversal"
});

await mcp__meridian__task_create_task({
  title: "Add performance regression tests for graph traversal",
  tags: ["testing", "regression"],
  priority: "high"
});

// 4. Curator documents the pattern
await mcp__meridian__docs_generate({
  targetPath: "docs/best-practices/graph-optimization.md"
});

await mcp__meridian__links_add_link({
  link_type: "documents",
  source_level: "docs",
  source_id: "best-practices-graph-optimization",
  target_level: "code",
  target_id: "graph::traverse"
});
```

## Agent Activation

### How to Use Agents

Each agent file can be invoked using Claude Code's slash command system or by referencing them in prompts:

```bash
# Option 1: Direct reference in prompt
"Review this code as the meridian-analyzer-001 agent would"

# Option 2: Explicit agent context
"Using the code-analyzer agent's workflows, scan this module for anti-patterns"

# Option 3: Multi-agent collaboration
"Have the architect and optimizer agents work together to improve this module"
```

### Agent Selection Guide

Choose the appropriate agent based on your task:

| Task Type | Primary Agent | Supporting Agents |
|-----------|---------------|-------------------|
| Architecture decisions | Architect | Analyzer, Optimizer |
| Code quality issues | Analyzer | Architect, Tester |
| Test coverage | Tester | Analyzer, Curator |
| Performance problems | Optimizer | Architect, Analyzer |
| Documentation gaps | Curator | Tester (for examples) |
| Project planning | Orchestrator | All agents |
| Refactoring | Architect | Analyzer, Tester, Optimizer |
| Bug investigation | Analyzer | Tester, Curator |

## Success Metrics

Each agent tracks specific success metrics (detailed in individual agent files):

### Architect
- Coupling Score: < 15 dependencies per module
- Circular Dependencies: 0
- Module Cohesion: > 80%

### Analyzer
- Average Complexity: < 10 per function
- Anti-Patterns: < 5 in production code
- Documentation: > 90% public APIs

### Tester
- Line Coverage: > 80%
- Branch Coverage: > 75%
- Test Flakiness: < 1%

### Optimizer
- Execution Time: 50% reduction in hot paths
- Memory Usage: 30% reduction in allocations
- Cache Hit Rate: > 70%

### Curator
- Link Coverage: > 90%
- Documentation Quality: > 0.8 average score
- Orphan Content: < 5%

### Orchestrator
- Completion Rate: > 85% within estimates
- Blocker Resolution: < 24hr average
- Agent Utilization: 70-90%

## Database Tracking

All agent activities are tracked in meridian's SQLite database:

- **Tasks**: Every task created includes agent tags
- **Episodes**: Completed work is recorded with agent_id
- **Links**: Semantic connections include agent attribution
- **Progress**: Tracked by agent, spec, and time period

### Querying Agent Activity

```typescript
// Get all tasks for a specific agent
const tasks = await mcp__meridian__task_search_tasks({
  query: "for:architect",
  limit: 100
});

// Find episodes by agent
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "agent:meridian-architect-001",
  limit: 50
});

// Get progress by agent tag
const progress = await mcp__meridian__task_get_progress({
  // Filter by tags in returned results
});
```

## Best Practices

### For Agents

1. **Always use MCP tools** - Never bypass the tool system
2. **Record episodes** - Use `task.mark_complete` for auto-recording
3. **Create semantic links** - Connect related artifacts
4. **Tag appropriately** - Use agent tags for coordination
5. **Monitor metrics** - Track and improve success metrics
6. **Learn from history** - Always check `memory.find_similar_episodes`

### For Users

1. **Choose the right agent** - Match task to agent expertise
2. **Provide context** - Include spec references and requirements
3. **Review suggestions** - Agents are assistants, not replacements
4. **Give feedback** - Update tasks with outcomes
5. **Track progress** - Use orchestrator for project management

## Future Enhancements

Planned improvements to the agent system:

1. **Agent Learning**: Agents improve from their own episodes
2. **Auto-Assignment**: Orchestrator auto-assigns tasks based on agent capacity
3. **Collaboration Patterns**: Predefined multi-agent workflows
4. **Performance Tracking**: Agent efficiency metrics and optimization
5. **Conflict Resolution**: Handle conflicting agent recommendations
6. **Priority Learning**: Agents learn to prioritize based on outcomes

## References

- **Meridian MCP Server**: `/meridian/` directory
- **Tool Documentation**: See CLAUDE.md for complete tool catalog
- **Progress System**: See `meridian/specs/progress-tracking-spec.md`
- **Task System**: Implemented in `meridian/src/progress/`
- **Memory System**: Implemented in `meridian/src/memory/`
