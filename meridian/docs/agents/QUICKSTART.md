# Agent System Quick Start Guide

## Getting Started in 5 Minutes

### Step 1: Understand the Agent Roster

You have 6 specialized agents at your disposal:

- **Architect** - System design and architecture
- **Analyzer** - Code quality and anti-patterns
- **Tester** - Testing strategy and coverage
- **Optimizer** - Performance optimization
- **Curator** - Knowledge and documentation
- **Orchestrator** - Task coordination and workflow

### Step 2: Choose Your Agent

**Quick Decision Tree:**

```
Need to...
├─ Design a new system? → Architect
├─ Find code issues? → Analyzer
├─ Improve tests? → Tester
├─ Speed things up? → Optimizer
├─ Organize knowledge? → Curator
└─ Manage project? → Orchestrator
```

### Step 3: Invoke the Agent

**Method 1: Direct Invocation**
```bash
# In your Claude Code prompt:
"Using the code-analyzer agent, scan src/memory/ for anti-patterns"
```

**Method 2: Read the Agent File**
```bash
# View the agent's workflows:
cat .claude/agents/code-analyzer.md
```

**Method 3: Let Orchestrator Decide**
```bash
# For complex tasks:
"Have the orchestrator create a plan to implement feature X"
```

## Common Workflows

### Workflow 1: New Feature Implementation

```typescript
// 1. Orchestrator breaks down the work
"I need to implement [feature]. Create a task breakdown."

// Expected result:
// - Architecture task (for:architect)
// - Implementation task
// - Testing task (for:tester)
// - Documentation task (for:curator)
// - Performance validation (for:optimizer)

// 2. Work through tasks sequentially
// Each agent completes their part and records an episode
```

### Workflow 2: Code Quality Improvement

```typescript
// 1. Analyzer scans for issues
"Run code-analyzer daily scan on src/"

// Expected result:
// - List of complexity issues
// - Anti-patterns found
// - Security concerns
// - Tasks created for fixes

// 2. Address high-priority issues first
// 3. Curator documents improvements
```

### Workflow 3: Performance Optimization

```typescript
// 1. Optimizer profiles the code
"Analyze performance of graph traversal module"

// Expected result:
// - Hot spots identified
// - Algorithm complexity analysis
// - Optimization suggestions
// - Benchmark creation task

// 2. Architect reviews design if needed
// 3. Tester creates regression tests
// 4. Optimizer implements and validates
```

## Example Sessions

### Example 1: "I want to add a new cognitive feature"

**Your prompt:**
```
"I want to add attention-based retrieval to the memory system.
Use the orchestrator to plan this feature."
```

**Agent Response:**

```typescript
// Orchestrator creates task breakdown:

1. [Architect] Design attention scoring architecture
   - Review existing memory retrieval
   - Design attention weight system
   - Plan integration points
   Est: 8 hours

2. [Implementation] Implement attention module
   - Create attention.rs module
   - Integrate with retrieval.rs
   - Add configuration
   Est: 16 hours
   Depends on: Task 1

3. [Tester] Create comprehensive tests
   - Unit tests for attention scoring
   - Integration tests with memory system
   - Performance tests
   Est: 8 hours
   Depends on: Task 2

4. [Optimizer] Benchmark and optimize
   - Baseline performance
   - Identify bottlenecks
   - Optimize hot paths
   Est: 6 hours
   Depends on: Task 3

5. [Curator] Document feature
   - API documentation
   - Usage examples
   - Best practices guide
   Est: 4 hours
   Depends on: Task 2
```

### Example 2: "Find and fix performance issues"

**Your prompt:**
```
"Run performance-optimizer analysis on the entire codebase"
```

**Agent Response:**

```typescript
// Step 1: Find high-complexity functions
const hotSpots = [
  { function: "graph::traverse", complexity: 23 },
  { function: "memory::search", complexity: 18 },
  { function: "code::analyze", complexity: 15 }
];

// Step 2: Analyze each hot spot
graph::traverse:
  - Current: O(n³) nested loops
  - Issue: No caching of intermediate results
  - Recommendation: Implement memoization

memory::search:
  - Current: Sequential scan through episodes
  - Issue: No indexing on frequently queried fields
  - Recommendation: Add database indexes

code::analyze:
  - Current: Multiple passes over AST
  - Issue: Redundant tree traversals
  - Recommendation: Single-pass visitor pattern

// Step 3: Create optimization tasks
Tasks created:
  1. Optimize graph traversal (Critical, 12 hours)
  2. Add database indexes (High, 4 hours)
  3. Refactor code analyzer (Medium, 8 hours)
```

### Example 3: "Improve test coverage"

**Your prompt:**
```
"Using test-engineer agent, improve test coverage to >80%"
```

**Agent Response:**

```typescript
// Step 1: Analyze current coverage
Current Coverage: 65%
Untested modules:
  - src/graph/traversal.rs (0%)
  - src/memory/attention.rs (45%)
  - src/links/validator.rs (30%)

// Step 2: Prioritize by complexity
Priority Order:
  1. graph/traversal.rs (complexity: 20, coverage: 0%)
  2. memory/attention.rs (complexity: 15, coverage: 45%)
  3. links/validator.rs (complexity: 8, coverage: 30%)

// Step 3: Generate tests
Created:
  - tests/graph_traversal_test.rs (15 unit tests)
  - tests/memory_attention_test.rs (10 unit tests)
  - tests/links_validator_test.rs (8 unit tests)

// Step 4: Validation
New Coverage: 82%
All tests passing ✓
```

## Tips and Best Practices

### DO ✅

1. **Start with Orchestrator for complex tasks**
   - Let it break down the work
   - It will assign to appropriate agents
   - Handles dependencies automatically

2. **Use memory.find_similar_episodes**
   - All agents check past work first
   - Learn from successful approaches
   - Avoid repeating mistakes

3. **Tag tasks properly**
   - Use `for:architect`, `for:tester`, etc.
   - Helps agents find their work
   - Enables proper coordination

4. **Record episodes on completion**
   - Use `task.mark_complete`
   - Captures solution for future use
   - Builds institutional knowledge

5. **Create semantic links**
   - Connect specs → code → tests → docs
   - Makes knowledge discoverable
   - Improves context retrieval

### DON'T ❌

1. **Don't skip the planning phase**
   - Jumping to implementation wastes time
   - Let architect/orchestrator plan first
   - Better designs = less rework

2. **Don't ignore dependencies**
   - Testing needs implementation first
   - Optimization needs tests first
   - Follow the dependency chain

3. **Don't forget documentation**
   - Code without docs is orphaned
   - Curator creates semantic links
   - Examples help future understanding

4. **Don't optimize prematurely**
   - Architect and implement first
   - Test to ensure correctness
   - Then optimize if needed

5. **Don't work in isolation**
   - Agents collaborate through tasks
   - Share findings via episodes
   - Link related artifacts

## Quick Reference

### Agent Invocation Templates

```bash
# Architecture review
"Have the architect agent review the dependency structure of [module]"

# Code quality scan
"Run analyzer agent anti-pattern detection on [files]"

# Test generation
"Use tester agent to generate tests for [symbol]"

# Performance analysis
"Have optimizer agent profile [function] and suggest improvements"

# Knowledge organization
"Ask curator agent to find orphaned documentation"

# Project planning
"Let orchestrator agent create a task breakdown for [feature]"
```

### Common MCP Tool Patterns

```typescript
// Find similar past work
await mcp__meridian__memory_find_similar_episodes({
  task_description: "your task here",
  limit: 5
});

// Create a task
await mcp__meridian__task_create_task({
  title: "Task title",
  description: "Detailed description",
  priority: "high",
  tags: ["for:architect", "architecture"],
  estimated_hours: 8
});

// Complete a task
await mcp__meridian__task_mark_complete({
  task_id: "task_id",
  actual_hours: 7,
  solution_summary: "What was done",
  files_touched: ["file1.rs", "file2.rs"],
  queries_made: ["code.search", "analyze.complexity"]
});

// Search for code
await mcp__meridian__code_search_symbols({
  query: "function name",
  type: ["function"],
  detail_level: "interface"
});

// Analyze complexity
await mcp__meridian__analyze_complexity({
  target: "src/module/",
  include_metrics: ["cyclomatic", "cognitive"]
});

// Create semantic link
await mcp__meridian__links_add_link({
  link_type: "implements",
  source_level: "code",
  source_id: "module::function",
  target_level: "spec",
  target_id: "spec-name#section",
  confidence: 0.9
});
```

## Troubleshooting

### "Agent is not responding"

**Problem**: Agent doesn't seem to be working

**Solution**:
1. Check if you referenced the correct agent name
2. Verify meridian MCP server is running
3. Try explicitly reading the agent file first
4. Use orchestrator to coordinate

### "Tasks not being found"

**Problem**: Agent says no tasks available

**Solution**:
1. Check task tags match agent (e.g., `for:architect`)
2. Verify task status (should be `pending` or `in_progress`)
3. Use `task.search_tasks` to debug
4. Check if orchestrator created the tasks

### "Too many tasks created"

**Problem**: Agents creating duplicate or redundant tasks

**Solution**:
1. Use orchestrator to centralize task creation
2. Search existing tasks before creating new ones
3. Consolidate similar tasks
4. Set up task dependencies properly

### "Performance is slow"

**Problem**: Agent operations taking too long

**Solution**:
1. Check database size (may need cleanup)
2. Limit result counts in queries
3. Use `detail_level: "skeleton"` for initial scans
4. Enable caching in meridian server

## Next Steps

1. **Read Individual Agent Files**
   - Each has detailed workflows
   - Specific examples and patterns
   - Success metrics and best practices

2. **Review ARCHITECTURE.md**
   - Understand agent collaboration
   - See data flow diagrams
   - Learn interaction patterns

3. **Try a Sample Workflow**
   - Start with code-analyzer scan
   - Or use orchestrator for planning
   - Record your first episode

4. **Monitor Progress**
   - Use `task.get_progress`
   - Check agent workload balance
   - Review completion metrics

5. **Contribute Improvements**
   - Record successful workflows as episodes
   - Suggest new agent capabilities
   - Share optimization patterns

## Support

For more information:
- **Main Documentation**: See `/meridian/README.md`
- **Tool Catalog**: See `CLAUDE.md` in project root
- **Agent Details**: Individual `.md` files in this directory
- **Architecture**: `ARCHITECTURE.md` in this directory

---

**Remember**: Agents are specialized assistants that collaborate through meridian's MCP tools. Start with orchestrator for complex tasks, use memory to learn from the past, and record episodes to help future work!
