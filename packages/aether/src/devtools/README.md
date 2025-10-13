# Aether DevTools

Comprehensive debugging and inspection tools for Aether framework applications.

## Overview

Aether DevTools provides a complete suite of debugging capabilities:

- **State Inspector**: Track all reactive primitives (signals, computed, effects, stores)
- **Time-Travel Debugging**: Record and replay state mutations with undo/redo
- **Performance Profiler**: Measure render times and identify bottlenecks
- **Network Inspector**: Monitor netron-browser requests and WebSocket connections
- **Custom Formatters**: Enhanced Chrome DevTools console output
- **Browser Extension**: Full-featured DevTools panel in Chrome/Edge

## Quick Start

### 1. Enable DevTools in Your App

```typescript
import { enableDevTools } from '@omnitron-dev/aether/devtools';

if (import.meta.env.DEV) {
  enableDevTools({
    trackSignals: true,
    trackComponents: true,
    enableTimeTravel: true,
    enableProfiler: true,
    enableNetwork: true
  });
}
```

### 2. Use DevTools Hooks in Components

```typescript
import { defineComponent } from '@omnitron-dev/aether';
import { useDevTools } from '@omnitron-dev/aether/devtools';

const MyComponent = defineComponent(() => {
  const devtools = useDevTools();

  const count = signal(0);
  devtools.inspect(count, 'Counter Signal');

  return () => <div>{count()}</div>;
});
```

### 3. Install Browser Extension

See [aether-devtools package](../../../aether-devtools/README.md) for extension installation.

## Features

### State Inspector

Tracks all reactive primitives in your application:

```typescript
import { createInspector } from '@omnitron-dev/aether/devtools';

const inspector = createInspector();

// Track signal
const count = signal(0);
inspector.trackSignal(count, { name: 'Count' });

// Track computed
const doubled = computed(() => count() * 2);
inspector.trackComputed(doubled, [count], { name: 'Doubled' });

// Get state tree
const tree = inspector.getStateTree();
console.log(tree);
```

### Time-Travel Debugging

Record state changes and navigate through history:

```typescript
import { createRecorder } from '@omnitron-dev/aether/devtools';

const recorder = createRecorder();

// Start recording
recorder.startRecording();

// Make changes
count.set(5);
count.set(10);

// Navigate history
recorder.undo(); // Back to 5
recorder.redo(); // Forward to 10
recorder.jumpToState(0); // Jump to initial state

// Export session
const session = recorder.exportSession();
localStorage.setItem('debug-session', session);
```

### Performance Profiler

Measure and analyze performance:

```typescript
import { createProfiler } from '@omnitron-dev/aether/devtools';

const profiler = createProfiler();

// Start profiling
profiler.startProfiling();

// Your app code runs here...

// Stop and get results
const profile = profiler.stopProfiling();
console.log('Total components:', profile.summary.totalComponents);
console.log('Slowest component:', profile.summary.slowestComponent);

// Identify bottlenecks
const bottlenecks = profiler.identifyBottlenecks(16); // > 16ms
console.log('Bottlenecks:', bottlenecks);
```

### Network Inspector

Monitor netron-browser RPC calls:

```typescript
import { createNetworkInspector } from '@omnitron-dev/aether/devtools';

const networkInspector = createNetworkInspector();

// Track requests automatically
const client = createClient({
  onRequest: (req) => networkInspector.interceptRequest(req),
  onResponse: (res) => networkInspector.logResponse(res)
});

// Get timeline
const events = networkInspector.getNetworkTimeline();

// Get cache stats
const stats = networkInspector.getCacheStats();
console.log('Cache hit rate:', stats.hitRate);
```

### Custom Formatters

Enhanced console output for reactive primitives:

```typescript
import { installFormatters } from '@omnitron-dev/aether/devtools';

// Install once at app start
if (import.meta.env.DEV) {
  installFormatters();
}

// Now signals display beautifully in console
const count = signal(0);
console.log(count); // Shows: Signal { value: 0, writable: true, dependents: 0 }
```

## DevTools Hooks

### useDevTools()

Access DevTools utilities in components:

```typescript
const MyComponent = defineComponent(() => {
  const devtools = useDevTools();

  // Inspect signal
  const count = signal(0);
  devtools.inspect(count, 'Count');

  // Measure execution
  devtools.measure('Heavy computation', () => {
    // expensive operation
  });

  // Start profiling
  devtools.startProfiling();

  return () => <div>{count()}</div>;
});
```

### useInspector()

Direct access to inspector:

```typescript
const MyComponent = defineComponent(() => {
  const inspector = useInspector();

  if (inspector) {
    const state = inspector.getState();
    console.log('Signals:', state.signals.size);
  }

  return () => <div>Hello</div>;
});
```

### useProfiler()

Component-level profiling:

```typescript
const MyComponent = defineComponent(() => {
  const profiler = useProfiler('MyComponent');

  return () => <div>Hello</div>;
});
```

### useTimeTravel()

Access time-travel debugging:

```typescript
const DebugPanel = defineComponent(() => {
  const timeTravel = useTimeTravel();

  return () => (
    <div>
      <button onClick={() => timeTravel?.undo()}>Undo</button>
      <button onClick={() => timeTravel?.redo()}>Redo</button>
    </div>
  );
});
```

### withDevTools()

Higher-order component for automatic tracking:

```typescript
import { withDevTools } from '@omnitron-dev/aether/devtools';

const MyComponent = withDevTools(
  defineComponent(() => {
    return () => <div>Hello</div>;
  }),
  { name: 'MyComponent', profile: true }
);
```

### debugSignal()

Create signal with automatic tracking:

```typescript
import { debugSignal } from '@omnitron-dev/aether/devtools';

const count = debugSignal(0, 'Counter');
// Automatically tracked in DevTools
```

## Configuration Options

```typescript
interface DevToolsOptions {
  /** Enable signal tracking (default: true) */
  trackSignals?: boolean;

  /** Enable computed tracking (default: true) */
  trackComputed?: boolean;

  /** Enable effect tracking (default: true) */
  trackEffects?: boolean;

  /** Enable component tracking (default: true) */
  trackComponents?: boolean;

  /** Enable time-travel debugging (default: false) */
  enableTimeTravel?: boolean;

  /** Enable performance profiling (default: false) */
  enableProfiler?: boolean;

  /** Enable network inspection (default: true) */
  enableNetwork?: boolean;

  /** Maximum history entries (default: 1000) */
  maxHistorySize?: number;

  /** Bridge URL for custom extension */
  bridgeUrl?: string;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}
```

## Architecture

### Core Modules

1. **Inspector** (`inspector.ts`)
   - Tracks all reactive primitives
   - Builds state and component trees
   - Provides metadata for debugging

2. **Recorder** (`recorder.ts`)
   - Records state mutations
   - Implements time-travel debugging
   - Supports undo/redo operations
   - Export/import sessions

3. **Profiler** (`profiler.ts`)
   - Measures execution times
   - Identifies bottlenecks
   - Tracks memory usage
   - Generates performance reports

4. **Network Inspector** (`network.ts`)
   - Intercepts netron requests
   - Tracks WebSocket connections
   - Monitors cache performance
   - Provides network timeline

5. **Bridge** (`bridge.ts`)
   - Communication with browser extension
   - Serializes/deserializes messages
   - Handles connection lifecycle

6. **Formatter** (`formatter.ts`)
   - Custom Chrome DevTools formatters
   - Enhanced console output
   - Pretty-prints reactive primitives

7. **Hooks** (`hooks.ts`)
   - React-style hooks for components
   - Global DevTools access
   - Convenience utilities

### Message Flow

```
App → Inspector/Profiler/Recorder → Bridge → Extension
                                       ↓
                                   Panel UI
```

### Tree-Shaking

DevTools is designed to be completely tree-shakeable:

```typescript
// Development build - includes DevTools
if (import.meta.env.DEV) {
  const { enableDevTools } = await import('@omnitron-dev/aether/devtools');
  enableDevTools();
}

// Production build - DevTools code is removed
```

## Best Practices

### 1. Only Enable in Development

```typescript
if (import.meta.env.DEV) {
  enableDevTools();
}
```

### 2. Use Meaningful Names

```typescript
const count = signal(0);
inspector.trackSignal(count, { name: 'User Counter' });
```

### 3. Profile Selectively

```typescript
// Only profile specific operations
if (heavyComputation) {
  profiler.startProfiling();
  doHeavyWork();
  const profile = profiler.stopProfiling();
}
```

### 4. Export Debug Sessions

```typescript
// Save problematic state for later analysis
const session = recorder.exportSession();
localStorage.setItem('bug-session', session);
```

### 5. Use Custom Formatters

```typescript
// Install formatters for better console output
if (import.meta.env.DEV) {
  installFormatters();
}
```

## Performance Impact

DevTools is designed for minimal performance impact:

- **Tracking overhead**: < 1% in development
- **Memory overhead**: ~100KB for typical app
- **Tree-shakeable**: 0 bytes in production build
- **Lazy loading**: Import only when needed

## Browser Support

- **Chrome/Edge**: Full support (Manifest V3 extension)
- **Firefox**: Coming soon
- **Safari**: Console features only (no extension)

## API Reference

See [types.ts](./types.ts) for complete TypeScript definitions.

### Main Exports

- `enableDevTools(options)` - Enable DevTools
- `disableDevTools()` - Disable DevTools
- `getDevTools()` - Get DevTools instance
- `isEnabled()` - Check if enabled

### Creators

- `createInspector()` - Create inspector instance
- `createRecorder(maxSize)` - Create recorder instance
- `createProfiler()` - Create profiler instance
- `createNetworkInspector()` - Create network inspector
- `createBridge()` - Create bridge instance

### Hooks

- `useDevTools()` - Main DevTools hook
- `useInspector()` - Inspector hook
- `useProfiler(name)` - Profiler hook
- `useTimeTravel()` - Time-travel hook
- `withDevTools(component, options)` - HOC
- `debugSignal(value, name)` - Create tracked signal

### Utilities

- `installFormatters()` - Install custom formatters
- `uninstallFormatters()` - Uninstall formatters
- `formatSignal(signal)` - Format signal for console
- `formatStore(store)` - Format store for console
- `formatComponent(component)` - Format component
- `isDevToolsAvailable()` - Check if extension installed

## Examples

See [examples](../../../../examples/devtools/) for complete examples.

## Contributing

1. Core DevTools functionality goes in this directory
2. Browser extension code goes in [aether-devtools](../../../aether-devtools/)
3. Follow existing patterns for consistency
4. Add tests for new features
5. Update documentation

## License

MIT
