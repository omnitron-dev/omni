# Monitoring Tests

This directory contains comprehensive tests for Aether's performance monitoring and debugging features.

## Test Files

### ✅ component-tracking.spec.ts (27 tests)
Tests for component lifecycle tracking, render duration measurement, re-render counting, props change detection, and effect timing.

**Key Features Tested:**
- Component mount/unmount tracking
- Component hierarchy tracking
- Render duration measurement
- Re-render counting and frequency analysis
- Props change detection with complex types
- Effect execution timing
- Performance bottleneck detection
- Signal and effect integration
- Component tree visualization
- Memory management

**Run:**
```bash
npm test -- test/monitoring/component-tracking.spec.ts
```

### ✅ signal-tracking.spec.ts (23 tests)
Tests for signal read/write tracking, subscription counting, update frequency monitoring, dependency graph building, and circular dependency detection.

**Key Features Tested:**
- Signal read/write operation tracking
- Writable vs read-only signal differentiation
- Subscription and dependent counting
- Update frequency monitoring
- High-frequency update identification
- Simple and complex dependency graphs
- Diamond dependencies
- Circular reference detection
- State tree visualization
- Performance optimization
- Metadata tracking

**Run:**
```bash
npm test -- test/monitoring/signal-tracking.spec.ts
```

### ✅ memory-profiler.spec.ts (21 tests)
Tests for memory footprint calculation, DOM node counting, event listener tracking, memory leak detection, and cleanup verification.

**Key Features Tested:**
- Memory usage tracking
- Memory increase detection
- DOM node creation and leak detection
- Event listener registration and leak detection
- Retained reference detection
- Circular reference leaks
- Closure memory leaks
- Signal subscription leaks
- Inspector and profiler cleanup
- Performance impact measurement
- Memory measurement accuracy

**Run:**
```bash
npm test -- test/monitoring/memory-profiler.spec.ts
```

### 📋 performance.spec.ts (8 tests - existing)
Basic performance monitoring tests covering marks, measures, web vitals, and cleanup.

**Run:**
```bash
npm test -- test/monitoring/performance.spec.ts
```

### 📋 error-tracking.spec.ts (existing)
Error tracking tests covering error capture, breadcrumbs, and context.

**Run:**
```bash
npm test -- test/monitoring/error-tracking.spec.ts
```

### 📋 analytics.spec.ts (existing)
Analytics tests covering event tracking, user tracking, and sessions.

**Run:**
```bash
npm test -- test/monitoring/analytics.spec.ts
```

## Running Tests

### Run all monitoring tests:
```bash
npm test -- test/monitoring/
```

### Run with coverage:
```bash
npm run test:coverage -- test/monitoring/
```

### Run in watch mode:
```bash
npm test -- test/monitoring/ --watch
```

### Run in UI mode:
```bash
npm run test:ui
```

## Test Statistics

**Total Tests**: 71+ tests
**Pass Rate**: 100%
**Coverage**: High coverage across monitoring features

### Breakdown:
- Component Tracking: 27 tests ✅
- Signal Tracking: 23 tests ✅
- Memory Profiler: 21 tests ✅
- Performance: 8 tests ✅
- Error Tracking: Multiple tests ✅
- Analytics: Multiple tests ✅

## Key Testing Patterns

### Mock Signal Creation
```typescript
const mockSignal = {
  peek: vi.fn(() => value),
  subscribe: vi.fn(),
};
```

### Inspector Setup
```typescript
let inspector: Inspector;

beforeEach(() => {
  inspector = createInspector();
});

afterEach(() => {
  inspector.dispose();
});
```

### Profiler Setup
```typescript
let profiler: Profiler;

beforeEach(() => {
  profiler = createProfiler();
});

afterEach(() => {
  profiler.clear();
});
```

### Performance Testing
```typescript
const startTime = performance.now();
// ... perform operations ...
const duration = performance.now() - startTime;
expect(duration).toBeLessThan(threshold);
```

### Memory Leak Testing
```typescript
// Create many instances
for (let i = 0; i < 1000; i++) {
  inspector.trackSignal(signal, { name: `Signal${i}` });
}

// Verify
expect(inspector.getState().signals.size).toBe(1000);

// Cleanup
inspector.clear();

// Verify cleanup
expect(inspector.getState().signals.size).toBe(0);
```

## Coverage Goals

- **Overall**: 90%+
- **Component Tracking**: 95%+
- **Signal Tracking**: 95%+
- **Memory Profiling**: 90%+

## Next Steps

See `../TESTING-SUMMARY.md` for:
- Complete test suite overview
- TODO test files
- Testing best practices
- Coverage targets
- Integration test plans

## Contributing

When adding new tests:

1. Follow existing test patterns
2. Use descriptive test names
3. Test both happy paths and edge cases
4. Include performance tests
5. Test memory cleanup
6. Verify browser compatibility
7. Add to this README
