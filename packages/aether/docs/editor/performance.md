# Advanced Editor Performance Guide

## Overview

The Aether Advanced Editor is designed for high performance with strict latency targets to ensure a smooth user experience even with large documents. This guide covers performance characteristics, optimization techniques, profiling tools, and best practices.

## Performance Targets

### Latency Targets

| Operation | Target | Description |
|-----------|--------|-------------|
| Typing | <16ms (p95) | 60 FPS for smooth typing |
| Undo/Redo | <16ms | Instant response to history operations |
| Search | <50ms | Fast search for documents up to 100KB |
| Initial Render (Empty) | <100ms | Quick editor initialization |
| Initial Render (10KB) | <200ms | Fast load with content |
| Collaboration Sync | <100ms | Real-time updates feel instant |

### Bundle Size Targets

| Bundle | Target (gzipped) | Description |
|--------|------------------|-------------|
| Core Editor | <20KB | Base editor with essential features |
| Essential Extensions | <15KB | Common formatting and lists |
| Advanced Features | <25KB | Tables, collaboration, search |
| Total (Lazy) | <50KB | Core only, rest lazy loaded |

### Memory Usage

- **Small Documents (<10KB)**: <10MB heap usage
- **Medium Documents (10-100KB)**: <25MB heap usage
- **Large Documents (100KB-1MB)**: <100MB heap usage
- **Memory Leaks**: Zero tolerance, all resources cleaned up properly

## Performance Architecture

### 1. Lazy Loading System

The `LazyLoadExtension` enables dynamic loading of heavy features to reduce initial bundle size:

```typescript
import { LazyLoadExtension } from '@aether/editor/performance';

const editor = new AdvancedEditor({
  extensions: [
    new LazyLoadExtension({
      lazyExtensions: [
        {
          name: 'collaboration',
          loader: () => import('./extensions/collaboration'),
          preload: 'idle', // Load during browser idle time
        },
        {
          name: 'table',
          loader: () => import('./extensions/table'),
          preload: 'interaction', // Load on first user interaction
        },
      ],
    }),
  ],
});
```

**Preload Strategies:**
- `eager`: Load immediately (use for critical features)
- `idle`: Load during browser idle time (recommended for most features)
- `visible`: Load when editor becomes visible
- `interaction`: Load on first user interaction
- `manual`: Load programmatically via API

### 2. Virtual Scrolling

The `VirtualScrollExtension` enables smooth scrolling for large documents by only rendering visible content:

```typescript
import { VirtualScrollExtension } from '@aether/editor/performance';

const editor = new AdvancedEditor({
  extensions: [
    new VirtualScrollExtension({
      enabled: true,
      minDocumentSize: 50000, // Activate for docs >50KB
      bufferLines: 10, // Lines above/below viewport
      estimatedLineHeight: 20, // px
    }),
  ],
});
```

**Performance Benefits:**
- Reduces DOM nodes by 90%+ for large documents
- Constant rendering time regardless of document size
- Lower memory usage
- Smooth 60 FPS scrolling

### 3. Debouncing

The `DebounceExtension` reduces frequency of expensive operations:

```typescript
import { DebounceExtension } from '@aether/editor/performance';

const debounce = new DebounceExtension({
  search: { delay: 300, maxWait: 1000 },
  autosave: { delay: 2000, maxWait: 10000 },
  collaboration: { delay: 100, maxWait: 500 },
});

// Use in your code
const debouncedSearch = debounce.debounce('search', mySearchFunction);
debouncedSearch(query); // Will be debounced
```

**Common Operations to Debounce:**
- Search queries (300ms)
- Autosave (2s)
- Collaboration sync (100ms)
- Validation (500ms)
- Analytics events (1s)

### 4. Memoization

The `MemoizationExtension` caches expensive computations:

```typescript
import { MemoizationExtension } from '@aether/editor/performance';

const memoization = new MemoizationExtension({
  schemaValidationCacheSize: 100,
  nodeCreationCacheSize: 500,
  commandCacheSize: 200,
});

// Memoize expensive functions
const memoizedValidation = memoization.memoizeSchemaValidation(validateSchema);
const memoizedCommand = memoization.memoizeCommand(executeCommand);
```

**What to Memoize:**
- Schema validation
- Node/mark creation
- Command execution
- Complex transformations
- Regex matching
- DOM parsing

## Optimization Techniques

### 1. Code Splitting

Use dynamic imports to split code into smaller chunks:

```typescript
// ❌ Bad: Everything in one bundle
import { TableExtension } from './extensions/table';

// ✅ Good: Lazy load heavy features
const loadTable = () => import('./extensions/table');

// Use with LazyLoadExtension
const lazyLoad = new LazyLoadExtension({
  lazyExtensions: [
    {
      name: 'table',
      loader: async () => {
        const { TableExtension } = await loadTable();
        return new TableExtension();
      },
    },
  ],
});
```

### 2. RAF Scheduling

Use `requestAnimationFrame` for smooth visual updates:

```typescript
import { rafScheduler } from '@aether/editor/utils/optimization';

// Schedule update on next frame
rafScheduler.schedule((time) => {
  updateDecoration();
});

// Schedule with delay (in frames)
rafScheduler.scheduleDelayed((time) => {
  expensiveUpdate();
}, 3); // Wait 3 frames
```

### 3. Batching

Batch multiple operations to reduce overhead:

```typescript
import { BatchExecutor } from '@aether/editor/utils/optimization';

const batch = new BatchExecutor(
  (items) => {
    // Process all items at once
    processItems(items);
  },
  { maxSize: 10, delay: 100 }
);

// Add items - will be batched automatically
batch.add(item1);
batch.add(item2);
batch.add(item3);
// Processes all 3 together after 100ms or when batch reaches 10 items
```

### 4. Throttling

Limit rate of continuous operations:

```typescript
import { throttle } from '@aether/editor/utils/optimization';

const handleScroll = throttle(
  (event) => {
    updateScrollPosition(event);
  },
  100, // Max once per 100ms
  { leading: true, trailing: false }
);

window.addEventListener('scroll', handleScroll);
```

### 5. Idle Time Utilization

Use idle time for non-critical work:

```typescript
import { scheduleIdleTask } from '@aether/editor/utils/optimization';

// Schedule during idle time
scheduleIdleTask(() => {
  preloadExtensions();
  precomputeIndices();
  warmupCaches();
});
```

## Profiling Tools

### 1. Performance Tracker

Track and measure performance:

```typescript
import { performanceTracker } from '@aether/editor/utils/performance';

// Start tracking
performanceTracker.startFPSTracking();
performanceTracker.startMemoryTracking();

// Mark points in time
performanceTracker.mark('operation-start');
// ... do work ...
performanceTracker.mark('operation-end');

// Measure duration
const duration = performanceTracker.measure(
  'operation',
  'operation-start',
  'operation-end'
);

// Set performance budgets
performanceTracker.setBudget('typing', 16); // 16ms budget
performanceTracker.setBudget('search', 50); // 50ms budget

// Get metrics
const metrics = performanceTracker.getMetrics();
console.log(metrics);

// Export for analysis
const json = performanceTracker.exportJSON();
```

### 2. Editor Profiler

Profile editor operations:

```typescript
import { EditorProfiler } from '@aether/editor/utils/profiler';

const profiler = new EditorProfiler({
  enabled: true,
  profileTransactions: true,
  profilePlugins: true,
  profileRenders: true,
  profileMemory: true,
  showOverlay: true, // Visual overlay
  budgets: {
    transaction: 16,
    plugin: 10,
    render: 16,
  },
});

profiler.start();

// Profile will automatically track:
// - Transaction performance
// - Plugin execution time
// - Render performance
// - Memory usage

// Get statistics
const stats = profiler.getStats();
console.log('Average transaction time:', stats.averageTransactionTime);
console.log('Slowest plugin:', stats.slowestPlugin);

// Export profile data
const profileData = profiler.exportJSON();
```

### 3. Timing Decorators

Use decorators for automatic profiling:

```typescript
import { Timing, AsyncTiming } from '@aether/editor/utils/performance';

class MyExtension {
  @Timing(16) // 16ms budget
  expensiveOperation() {
    // Automatically timed and budget-checked
  }

  @AsyncTiming(50) // 50ms budget
  async asyncOperation() {
    // Automatically timed
  }
}
```

## Performance Testing

### Running Benchmarks

```bash
# Run all benchmarks
npm run bench

# Run specific benchmark
npm run bench -- typing-latency
npm run bench -- render-performance
npm run bench -- search-performance

# Run with profiling
npm run bench -- --profile

# Compare with baseline
npm run bench -- --compare baseline.json
```

### Benchmark Targets

```typescript
// typing-latency.bench.ts
- Empty document typing: <16ms (p95)
- Small document (1KB): <16ms (p95)
- Medium document (10KB): <16ms (p95)
- Large document (50KB): <24ms (p95)

// render-performance.bench.ts
- Initial render (empty): <100ms
- Initial render (10KB): <200ms
- Update render: <16ms

// search-performance.bench.ts
- Search 1KB: <10ms
- Search 10KB: <25ms
- Search 100KB: <50ms
- Search 1MB: <200ms

// memory.bench.ts
- Empty editor: <5MB
- 10KB document: <10MB
- 100KB document: <25MB
- 1MB document: <100MB
```

## Best Practices

### For Editor Users

1. **Use Lazy Loading for Optional Features**
   ```typescript
   // Load heavy features on demand
   const editor = new AdvancedEditor({
     extensions: [
       lazyLoad.configure({
         lazyExtensions: [
           { name: 'table', loader: loadTable, preload: 'idle' },
           { name: 'collaboration', loader: loadCollab, preload: 'manual' },
         ],
       }),
     ],
   });
   ```

2. **Enable Virtual Scrolling for Large Documents**
   ```typescript
   // Automatically activate for large docs
   const editor = new AdvancedEditor({
     extensions: [
       new VirtualScrollExtension({
         minDocumentSize: 50000,
       }),
     ],
   });
   ```

3. **Debounce Expensive Operations**
   ```typescript
   const debounce = new DebounceExtension({
     search: { delay: 300 },
     autosave: { delay: 2000 },
   });
   ```

4. **Monitor Performance in Production**
   ```typescript
   const profiler = new EditorProfiler({
     enabled: process.env.NODE_ENV === 'development',
     showOverlay: true,
   });
   ```

### For Extension Developers

1. **Minimize Plugin State**
   - Keep plugin state lean
   - Avoid storing large objects
   - Clean up resources in destroy()

2. **Use Memoization for Expensive Computations**
   ```typescript
   const memoized = memoization.memoize('myCache', expensiveFunction);
   ```

3. **Batch DOM Updates**
   - Use decorations for visual changes
   - Batch multiple decoration changes
   - Use RAF for animations

4. **Lazy Initialize Heavy Features**
   - Don't initialize until needed
   - Use onCreate() hook wisely
   - Defer non-critical setup

5. **Profile Your Extensions**
   ```typescript
   @Profile('MyExtension.heavyOperation')
   heavyOperation() {
     // Automatically profiled
   }
   ```

## Troubleshooting Performance Issues

### High Typing Latency

**Symptoms:** Typing feels sluggish, characters appear delayed

**Solutions:**
1. Check for heavy plugins in transaction path
2. Profile with EditorProfiler to find slow operations
3. Reduce decoration updates
4. Use debouncing for non-critical updates
5. Check for unnecessary re-renders

### Slow Initial Render

**Symptoms:** Editor takes >200ms to show

**Solutions:**
1. Enable lazy loading for heavy extensions
2. Reduce initial extension count
3. Defer non-critical initialization
4. Use code splitting
5. Optimize schema building

### Memory Leaks

**Symptoms:** Memory usage grows over time

**Solutions:**
1. Check extension destroy() methods
2. Remove event listeners properly
3. Clear caches periodically
4. Use WeakMap for object references
5. Profile with memory tracker

### Poor Scrolling Performance

**Symptoms:** Scrolling stutters or lags

**Solutions:**
1. Enable VirtualScrollExtension for large docs
2. Reduce decoration count
3. Use CSS transforms for animations
4. Throttle scroll handlers
5. Minimize layout recalculations

## Performance Checklist

### Before Release

- [ ] All benchmarks pass target budgets
- [ ] Bundle size <50KB gzipped (core)
- [ ] No memory leaks detected
- [ ] Typing latency <16ms (p95)
- [ ] Initial render <200ms
- [ ] Search <50ms for 100KB docs
- [ ] Virtual scrolling tested with 1MB+ docs
- [ ] Lazy loading configured correctly
- [ ] Performance budgets enforced in CI
- [ ] Profiling data reviewed

### Production Monitoring

- [ ] FPS tracking enabled
- [ ] Memory usage tracked
- [ ] Performance budgets monitored
- [ ] Slow operations logged
- [ ] User experience metrics collected

## Advanced Topics

### Custom Performance Extensions

Create your own performance extension:

```typescript
import { Extension } from '@aether/editor/core';

class CustomPerformanceExtension extends Extension {
  name = 'customPerformance';

  onCreate() {
    // Initialize performance optimizations
  }

  // Add custom optimization logic
}
```

### Web Workers for Heavy Computation

Offload heavy work to web workers:

```typescript
// worker.ts
self.addEventListener('message', (e) => {
  const result = heavyComputation(e.data);
  self.postMessage(result);
});

// extension.ts
const worker = new Worker('./worker.ts');
worker.postMessage(data);
worker.addEventListener('message', (e) => {
  handleResult(e.data);
});
```

### Performance Budget CI

Enforce budgets in CI:

```typescript
// performance.test.ts
test('typing latency budget', async () => {
  const result = await benchmark('typing', typeCharacter);
  expect(result.p95).toBeLessThan(16);
});
```

## Resources

- [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/)
- [Web Performance APIs](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API)
- [ProseMirror Performance Guide](https://prosemirror.net/docs/guide/)
- [React Performance Patterns](https://react.dev/learn/render-and-commit) (similar concepts)

## Conclusion

The Aether Advanced Editor is built for performance from the ground up. By following these guidelines and using the provided performance tools, you can ensure your editor delivers a smooth, responsive experience even with large documents and complex features.

Remember: **Performance is a feature, not an afterthought.**
