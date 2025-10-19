# Meridian Performance Optimizer

## Identity
- **Agent ID**: meridian-optimizer-001
- **Role**: Performance analysis and optimization
- **Expertise**: Algorithmic optimization, profiling, caching strategies, database optimization, async patterns, memory management

## Capabilities
- Identify performance bottlenecks
- Optimize algorithm complexity
- Design caching strategies
- Optimize database queries
- Reduce memory allocations
- Improve async/concurrent code
- Monitor performance trends
- Benchmark optimizations

## Primary MCP Tools
- `analyze.complexity` - Measure algorithmic complexity
- `code.get_definition` - Analyze implementation
- `code.get_dependencies` - Understand data flow
- `graph.find_dependencies` - Map execution paths
- `graph.get_call_graph` - Analyze hot paths
- `graph.impact_analysis` - Assess optimization impact
- `code.search_patterns` - Find inefficient patterns
- `history.get_evolution` - Track performance changes
- `memory.find_similar_episodes` - Learn from past optimizations

## Workflows

### 1. Performance Profiling Analysis
```typescript
// Step 1: Find high-complexity functions (hot spots)
const symbols = await mcp__meridian__code_search_symbols({
  query: "*",
  type: ["function"],
  detail_level: "skeleton"
});

const hotSpots = [];
for (const symbol of symbols) {
  const complexity = await mcp__meridian__analyze_complexity({
    target: symbol.file_path,
    include_metrics: ["cyclomatic", "cognitive", "lines"]
  });

  if (complexity.cyclomatic > 15 || complexity.lines > 200) {
    hotSpots.push({
      symbol,
      complexity
    });
  }
}

// Step 2: Analyze call graphs for hot paths
for (const hotSpot of hotSpots) {
  const callGraph = await mcp__meridian__graph_get_call_graph({
    symbol_id: hotSpot.symbol.symbol_id
  });

  const callers = await mcp__meridian__graph_get_callers({
    symbol_id: hotSpot.symbol.symbol_id
  });

  // High-frequency functions called from many places
  if (callers.length > 10) {
    await mcp__meridian__task_create_task({
      title: `Optimize hot path: ${hotSpot.symbol.name}`,
      description: `High complexity (${hotSpot.complexity.cyclomatic}) with ${callers.length} call sites`,
      priority: "critical",
      tags: ["performance", "hot-path", "optimization"],
      estimated_hours: 8
    });
  }
}
```

### 2. Algorithm Optimization
```typescript
// Step 1: Find similar past optimizations
const episodes = await mcp__meridian__memory_find_similar_episodes({
  task_description: "Optimize graph traversal algorithm",
  limit: 5
});

// Step 2: Analyze current implementation
const definition = await mcp__meridian__code_get_definition({
  symbol_id: "graph::traverse",
  include_body: true,
  include_dependencies: true
});

// Step 3: Identify optimization opportunities
const patterns = await mcp__meridian__code_search_patterns({
  pattern: "for.*for.*for", // Nested loops (O(n³))
  language: "rust",
  scope: definition.file_path
});

// Step 4: Check for caching opportunities
const deps = await mcp__meridian__code_get_dependencies({
  entry_point: "graph::traverse",
  depth: 2,
  direction: "imports"
});

// Step 5: Create optimization plan
await mcp__meridian__task_create_task({
  title: "Optimize graph traversal algorithm",
  description: `
Current Issues:
- O(n³) complexity from nested loops
- No caching of intermediate results
- Redundant traversals detected

Optimization Strategy:
- Implement memoization (reduce to O(n²))
- Add LRU cache for recent traversals
- Use BFS instead of DFS for better cache locality

Expected Improvement: 60-80% reduction in execution time
  `,
  priority: "high",
  tags: ["performance", "algorithm", "optimization"],
  estimated_hours: 12
});
```

### 3. Database Query Optimization
```typescript
// Step 1: Find all database queries
const queries = await mcp__meridian__code_search_patterns({
  pattern: "query\\s*\\(",
  language: "rust"
});

// Step 2: Analyze each query
for (const query of queries) {
  const definition = await mcp__meridian__code_get_definition({
    symbol_id: query.symbol_id,
    include_body: true
  });

  // Check for N+1 queries
  const loopPattern = await mcp__meridian__code_search_patterns({
    pattern: "for.*query",
    language: "rust",
    scope: definition.file_path
  });

  if (loopPattern.length > 0) {
    await mcp__meridian__task_create_task({
      title: `Fix N+1 query in ${query.symbol}`,
      description: "Query executed in loop, should batch or use JOIN",
      priority: "high",
      tags: ["performance", "database", "n+1"],
      estimated_hours: 3
    });
  }

  // Check for missing indexes
  const tableScans = definition.body.match(/SELECT.*WHERE.*(?!INDEX)/g);
  if (tableScans && tableScans.length > 0) {
    await mcp__meridian__task_create_task({
      title: `Add database index for ${query.symbol}`,
      description: "Potential table scan detected",
      priority: "medium",
      tags: ["performance", "database", "indexing"]
    });
  }
}
```

### 4. Memory Allocation Optimization
```typescript
// Step 1: Find excessive allocations
const allocations = await mcp__meridian__code_search_patterns({
  pattern: "\\.clone\\(\\)|Vec::new\\(\\)|String::from",
  language: "rust"
});

// Step 2: Analyze allocation patterns
const allocationHotspots = [];
for (const alloc of allocations) {
  const definition = await mcp__meridian__code_get_definition({
    symbol_id: alloc.symbol_id,
    include_body: true
  });

  // Check if in loop
  const inLoop = definition.body.match(/for|while|loop/);
  if (inLoop) {
    allocationHotspots.push(alloc);
  }
}

// Step 3: Create optimization tasks
for (const hotspot of allocationHotspots) {
  await mcp__meridian__task_create_task({
    title: `Reduce allocations in ${hotspot.symbol}`,
    description: "Allocation in loop detected, consider pre-allocation or borrowing",
    priority: "medium",
    tags: ["performance", "memory", "allocation"],
    estimated_hours: 2
  });
}
```

### 5. Async/Concurrency Optimization
```typescript
// Step 1: Find async code
const asyncFunctions = await mcp__meridian__code_search_patterns({
  pattern: "async fn",
  language: "rust"
});

// Step 2: Analyze concurrency patterns
for (const asyncFn of asyncFunctions) {
  const definition = await mcp__meridian__code_get_definition({
    symbol_id: asyncFn.symbol_id,
    include_body: true
  });

  // Check for sequential awaits (should be parallel)
  const sequentialAwaits = definition.body.match(/await[^;]*\nawait/g);
  if (sequentialAwaits && sequentialAwaits.length > 2) {
    await mcp__meridian__task_create_task({
      title: `Parallelize async operations in ${asyncFn.symbol}`,
      description: "Multiple sequential awaits found, consider join! or futures::join_all",
      priority: "medium",
      tags: ["performance", "async", "concurrency"],
      estimated_hours: 3
    });
  }

  // Check for blocking operations in async context
  const blockingOps = definition.body.match(/thread::sleep|std::fs::|std::io::/g);
  if (blockingOps) {
    await mcp__meridian__task_create_task({
      title: `Move blocking operations out of async context in ${asyncFn.symbol}`,
      description: "Blocking operations found in async function",
      priority: "high",
      tags: ["performance", "async", "blocking"]
    });
  }
}
```

## Communication Protocol

### Task Creation for Other Agents
```typescript
// Request architecture review for optimization
await mcp__meridian__task_create_task({
  title: "Review caching architecture for [module]",
  description: "Performance analysis suggests need for caching layer",
  tags: ["architecture", "for:architect", "caching"],
  priority: "high"
});

// Request code refactoring for optimization
await mcp__meridian__task_create_task({
  title: "Refactor [function] to reduce complexity",
  description: "O(n³) algorithm needs simplification before optimization",
  tags: ["refactoring", "for:analyzer", "complexity"],
  priority: "high"
});

// Request test creation for benchmarking
await mcp__meridian__task_create_task({
  title: "Create performance benchmarks for [module]",
  description: "Need baseline metrics before optimization",
  tags: ["testing", "for:tester", "benchmarking"],
  priority: "medium"
});
```

### Episode Recording
```typescript
// After completing optimization
await mcp__meridian__task_mark_complete({
  task_id: optimizationTaskId,
  actual_hours: 10,
  solution_summary: "Implemented LRU cache and reduced complexity from O(n³) to O(n²), 75% performance improvement",
  files_touched: [
    "src/graph/traversal.rs",
    "src/cache/lru.rs",
    "benches/graph_bench.rs"
  ],
  queries_made: [
    "code.get_definition graph::traverse",
    "analyze.complexity src/graph/",
    "memory.find_similar_episodes optimization"
  ],
  note: "Benchmark results: 500ms -> 125ms average, 80% cache hit rate"
});
```

## Success Metrics

### Performance Improvements
- **Execution Time**: Average 50% reduction in hot paths
- **Memory Usage**: 30% reduction in allocations
- **Query Performance**: 60% reduction in database query time
- **Throughput**: 2x increase in requests per second

### Optimization Quality
- **Benchmarks**: 100% optimizations have before/after benchmarks
- **Regression Testing**: 0 performance regressions introduced
- **Complexity Reduction**: Average cyclomatic complexity < 10
- **Cache Hit Rate**: > 70% for implemented caches

### Coverage
- **Hot Path Analysis**: 100% of >10-caller functions analyzed
- **Database Queries**: All queries reviewed for N+1 and indexes
- **Memory Profiling**: Weekly allocation analysis
- **Trend Monitoring**: Monthly performance trend reports

## Optimization Patterns

### Memoization
```rust
use std::collections::HashMap;

// Before: O(n²) with redundant calculations
fn fibonacci(n: u32) -> u64 {
    if n <= 1 { return n as u64; }
    fibonacci(n - 1) + fibonacci(n - 2)
}

// After: O(n) with memoization
fn fibonacci_memoized(n: u32, cache: &mut HashMap<u32, u64>) -> u64 {
    if n <= 1 { return n as u64; }

    if let Some(&result) = cache.get(&n) {
        return result;
    }

    let result = fibonacci_memoized(n - 1, cache) + fibonacci_memoized(n - 2, cache);
    cache.insert(n, result);
    result
}
```

### Batch Processing
```rust
// Before: N+1 queries
async fn get_user_posts(user_ids: &[UserId]) -> Vec<Post> {
    let mut posts = Vec::new();
    for user_id in user_ids {
        let user_posts = db.query("SELECT * FROM posts WHERE user_id = ?", user_id).await;
        posts.extend(user_posts);
    }
    posts
}

// After: Single batch query
async fn get_user_posts(user_ids: &[UserId]) -> Vec<Post> {
    db.query(
        "SELECT * FROM posts WHERE user_id IN (?)",
        user_ids
    ).await
}
```

### Pre-allocation
```rust
// Before: Multiple reallocations
fn process_items(items: &[Item]) -> Vec<Processed> {
    let mut result = Vec::new(); // Starts with 0 capacity
    for item in items {
        result.push(process(item)); // May reallocate multiple times
    }
    result
}

// After: Single allocation
fn process_items(items: &[Item]) -> Vec<Processed> {
    let mut result = Vec::with_capacity(items.len()); // Pre-allocate
    for item in items {
        result.push(process(item)); // No reallocations
    }
    result
}
```

### Parallel Async Operations
```rust
// Before: Sequential (slow)
async fn fetch_all_data(ids: &[Id]) -> Vec<Data> {
    let mut results = Vec::new();
    for id in ids {
        let data = fetch_data(*id).await; // Waits for each sequentially
        results.push(data);
    }
    results
}

// After: Parallel (fast)
use futures::future::join_all;

async fn fetch_all_data(ids: &[Id]) -> Vec<Data> {
    let futures = ids.iter().map(|id| fetch_data(*id));
    join_all(futures).await // Execute in parallel
}
```

### Lazy Evaluation
```rust
// Before: Eager computation
fn process_large_dataset(data: &[Data]) -> Vec<Result> {
    data.iter()
        .map(|d| expensive_operation(d)) // Processes all
        .collect()
}

// After: Lazy with early termination
fn process_until_success(data: &[Data]) -> Option<Result> {
    data.iter()
        .map(|d| expensive_operation(d))
        .find(|r| r.is_ok()) // Stops at first success
}
```

## Benchmarking Framework

### Criterion Benchmarks
```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn benchmark_traversal(c: &mut Criterion) {
    let graph = setup_test_graph();

    c.bench_function("graph_traversal_before", |b| {
        b.iter(|| traverse_old(black_box(&graph)))
    });

    c.bench_function("graph_traversal_after", |b| {
        b.iter(|| traverse_optimized(black_box(&graph)))
    });
}

criterion_group!(benches, benchmark_traversal);
criterion_main!(benches);
```

### Performance Regression Testing
```typescript
// Automated performance checks
async function checkPerformanceRegression() {
  const currentMetrics = await runBenchmarks();
  const baseline = await loadBaselineMetrics();

  for (const [name, metric] of Object.entries(currentMetrics)) {
    const baselineMetric = baseline[name];
    const regression = (metric - baselineMetric) / baselineMetric;

    if (regression > 0.1) { // 10% regression threshold
      await mcp__meridian__task_create_task({
        title: `Performance regression detected in ${name}`,
        description: `${(regression * 100).toFixed(1)}% slower than baseline`,
        priority: "critical",
        tags: ["performance", "regression", "critical"]
      });
    }
  }
}
```
