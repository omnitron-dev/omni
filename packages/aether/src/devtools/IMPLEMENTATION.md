# Aether DevTools Implementation Guide

This document provides an overview of the DevTools implementation and integration points.

## Implementation Status

✅ **Core Infrastructure** (Complete)
- Types and interfaces defined
- Inspector for state tracking
- Time-travel recorder
- Performance profiler
- Network inspector
- Bridge for extension communication
- Custom formatters for Chrome DevTools
- React-style hooks for easy integration

✅ **Browser Extension** (Complete)
- Manifest V3 structure
- Background service worker
- Content script injection
- DevTools panel UI
- Message passing architecture

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Aether Application                      │
│                                                              │
│  ┌────────────┐  ┌──────────┐  ┌─────────┐  ┌────────────┐│
│  │  Signals   │  │ Computed │  │ Effects │  │ Components ││
│  └─────┬──────┘  └────┬─────┘  └────┬────┘  └─────┬──────┘│
│        │              │              │             │        │
│        └──────────────┴──────────────┴─────────────┘        │
│                           │                                 │
│                  ┌────────▼────────┐                        │
│                  │    DevTools     │                        │
│                  │   (if enabled)  │                        │
│                  └────────┬────────┘                        │
│                           │                                 │
│         ┌─────────────────┼─────────────────┐              │
│         │                 │                 │              │
│    ┌────▼────┐      ┌────▼─────┐     ┌────▼────┐         │
│    │Inspector│      │ Profiler │     │ Recorder│         │
│    └────┬────┘      └────┬─────┘     └────┬────┘         │
│         │                │                 │              │
│         └────────────────┼─────────────────┘              │
│                          │                                │
│                    ┌─────▼──────┐                        │
│                    │   Bridge   │                        │
│                    └─────┬──────┘                        │
└──────────────────────────┼────────────────────────────────┘
                           │ (window.postMessage)
                           │
┌──────────────────────────▼────────────────────────────────┐
│                  Browser Extension                         │
│                                                            │
│  ┌──────────────┐    ┌─────────────┐   ┌──────────────┐ │
│  │   Content    │◄──►│ Background  │◄──►│  DevTools    │ │
│  │   Script     │    │   Script    │   │    Panel     │ │
│  └──────────────┘    └─────────────┘   └──────────────┘ │
└────────────────────────────────────────────────────────────┘
```

## Module Details

### 1. types.ts (13.7 KB)

Defines all TypeScript interfaces:
- `DevToolsOptions` - Configuration
- `SignalMetadata`, `ComputedMetadata`, `EffectMetadata` - Tracking metadata
- `ComponentMetadata`, `StoreMetadata` - Component and store tracking
- `HistoryEntry`, `StateDiff` - Time-travel debugging
- `PerformanceMeasurement`, `PerformanceProfile` - Profiling
- `NetworkEvent`, `WebSocketConnection` - Network inspection
- `DevToolsMessage` - Bridge communication

### 2. inspector.ts (12.7 KB)

State inspection implementation:
- `InspectorImpl` class - Main inspector
- `trackSignal()` - Track signal creation/updates
- `trackComputed()` - Track computed dependencies
- `trackEffect()` - Track effect executions
- `trackComponent()` - Track component lifecycle
- `getStateTree()` - Build hierarchical state tree
- `getComponentTree()` - Build component hierarchy

**Integration Points:**
- Hook into signal creation in `signal.ts`
- Hook into computed creation in `computed.ts`
- Hook into effect creation in `effect.ts`
- Hook into component lifecycle in component system

### 3. recorder.ts (8.4 KB)

Time-travel debugging:
- `RecorderImpl` class - History recorder
- `record()` - Record state mutation
- `jumpToState()` - Jump to specific point in history
- `undo()` / `redo()` - Navigate history
- `diff()` - Compare two states
- `exportSession()` / `importSession()` - Save/load sessions

**Integration Points:**
- Hook into signal `set()` method to record changes
- Hook into store updates
- Register restore callbacks for time-travel

### 4. profiler.ts (9.9 KB)

Performance profiling:
- `ProfilerImpl` class - Performance profiler
- `startProfiling()` / `stopProfiling()` - Session management
- `measureComponent()` - Measure component renders
- `measureEffect()` - Measure effect execution
- `identifyBottlenecks()` - Find slow operations

**Integration Points:**
- Wrap component render function
- Wrap effect execution
- Wrap computed re-evaluation

### 5. network.ts (9.4 KB)

Network inspection:
- `NetworkInspectorImpl` class - Network tracker
- `interceptRequest()` - Track RPC requests
- `logResponse()` - Track responses
- `trackWebSocket()` - Monitor WebSocket connections
- `getCacheStats()` - Cache performance

**Integration Points:**
- Hook into netron-browser client
- Intercept WebSocket creation
- Monitor cache hits/misses

### 6. bridge.ts (6.0 KB)

Extension communication:
- `BridgeImpl` class - Communication bridge
- `connect()` - Establish connection with extension
- `send()` / `receive()` - Bidirectional messaging
- Message serialization with circular reference handling
- Heartbeat to keep connection alive

**Integration Points:**
- Called by `enableDevTools()`
- Sends state updates to extension
- Receives commands from extension

### 7. hooks.ts (7.6 KB)

React-style hooks:
- `useDevTools()` - Main hook for components
- `useInspector()` - Access inspector
- `useProfiler()` - Component profiling
- `useTimeTravel()` - Time-travel access
- `withDevTools()` - HOC wrapper
- `debugSignal()` - Create tracked signal

**Usage:**
```typescript
const MyComponent = defineComponent(() => {
  const devtools = useDevTools();
  const count = signal(0);
  devtools.inspect(count, 'Counter');
  return () => <div>{count()}</div>;
});
```

### 8. formatter.ts (8.9 KB)

Chrome DevTools formatters:
- `installFormatters()` - Register custom formatters
- `signalFormatter` - Format signals in console
- `storeFormatter` - Format stores
- `componentFormatter` - Format components
- `formatValue()` - Pretty-print values

**Usage:**
```typescript
if (import.meta.env.DEV) {
  installFormatters();
}
```

### 9. index.ts (6.2 KB)

Main entry point:
- `enableDevTools()` - Initialize DevTools
- `disableDevTools()` - Cleanup
- `getDevTools()` - Get instance
- Re-exports all public APIs

**Usage:**
```typescript
import { enableDevTools } from '@omnitron-dev/aether/devtools';

if (import.meta.env.DEV) {
  enableDevTools({
    trackSignals: true,
    enableTimeTravel: true,
    enableProfiler: true
  });
}
```

## Browser Extension

### Structure

```
aether-devtools/
├── manifest.json          # Manifest V3
├── devtools.html         # Entry point
├── panel.html            # UI
├── src/
│   ├── background.js     # Service worker
│   ├── content.js        # Injected script
│   ├── devtools.js       # Panel creation
│   └── panel.js          # UI logic
└── public/
    └── icons/            # Extension icons
```

### Communication Flow

1. **App → Content Script**
   - App posts messages via `window.postMessage()`
   - Content script listens for messages
   - Bridge marker: `__AETHER_DEVTOOLS_EXTENSION__`

2. **Content Script → Background**
   - Chrome runtime connection
   - Port-based communication
   - Forwards messages bidirectionally

3. **Background → Panel**
   - Chrome runtime connection
   - Panel receives state updates
   - Panel sends commands to app

### Message Types

```typescript
// State update from app
{
  type: 'state-update',
  payload: {
    signals: [...],
    computed: [...],
    effects: [...]
  }
}

// Time-travel command from panel
{
  type: 'time-travel',
  payload: {
    action: 'undo' | 'redo' | 'jump',
    index?: number
  }
}

// Profile update from app
{
  type: 'profile-update',
  payload: {
    profile: {...},
    measurements: [...]
  }
}
```

## Integration Checklist

To fully integrate DevTools with Aether, implement these hooks:

### Signal Integration

```typescript
// In signal.ts
export function signal<T>(initial: T, options?: SignalOptions): WritableSignal<T> {
  const s = new SignalImpl(initial, options);

  // DevTools hook
  if (isDevToolsEnabled()) {
    const devtools = getDevTools();
    devtools.inspector.trackSignal(s, { name: options?.name });
  }

  return s;
}
```

### Computed Integration

```typescript
// In computed.ts
export function computed<T>(fn: () => T, options?: ComputedOptions): Computed<T> {
  const c = new ComputedImpl(fn, options);

  // DevTools hook
  if (isDevToolsEnabled()) {
    const devtools = getDevTools();
    const deps = c.getDependencies(); // Need to implement
    devtools.inspector.trackComputed(c, deps, { name: options?.name });
  }

  return c;
}
```

### Effect Integration

```typescript
// In effect.ts
export function effect(fn: () => void, options?: EffectOptions): Disposable {
  const e = new EffectImpl(fn, options);

  // DevTools hook
  if (isDevToolsEnabled()) {
    const devtools = getDevTools();
    const deps = e.getDependencies(); // Need to implement
    devtools.inspector.trackEffect(fn, deps, { name: options?.name });
  }

  return e;
}
```

### Component Integration

```typescript
// In component.ts
export function defineComponent<P>(fn: (props: P) => () => any) {
  return (props: P) => {
    // DevTools hook
    if (isDevToolsEnabled()) {
      const devtools = getDevTools();
      devtools.inspector.trackComponent(fn, props);
    }

    return fn(props);
  };
}
```

### Store Integration

```typescript
// In store.ts
export function createStore<T>(initial: T, options?: StoreOptions): Store<T> {
  const store = new StoreImpl(initial, options);

  // DevTools hook
  if (isDevToolsEnabled()) {
    const devtools = getDevTools();
    devtools.inspector.trackStore(store, options?.name || 'Store', initial);
  }

  return store;
}
```

### Netron Integration

```typescript
// In netron-browser client
export function createClient(options: ClientOptions) {
  const client = new NetronClient(options);

  // DevTools hook
  if (isDevToolsEnabled()) {
    const devtools = getDevTools();

    client.on('request', (req) => {
      devtools.networkInspector.interceptRequest(req);
    });

    client.on('response', (res) => {
      devtools.networkInspector.logResponse(res);
    });
  }

  return client;
}
```

## Testing Strategy

### Unit Tests

Test each module independently:

```typescript
// inspector.test.ts
test('tracks signal creation', () => {
  const inspector = createInspector();
  const sig = signal(0);
  inspector.trackSignal(sig, { name: 'test' });

  const state = inspector.getState();
  expect(state.signals.size).toBe(1);
});

// recorder.test.ts
test('records and replays mutations', () => {
  const recorder = createRecorder();
  recorder.startRecording();

  // Record changes
  recorder.record('signal', 'sig-1', 0, 1, 'increment');
  recorder.record('signal', 'sig-1', 1, 2, 'increment');

  // Navigate
  recorder.undo();
  expect(currentValue).toBe(1);
});
```

### Integration Tests

Test with actual Aether components:

```typescript
test('tracks component signals', () => {
  enableDevTools();

  const App = defineComponent(() => {
    const count = signal(0);
    return () => <div>{count()}</div>;
  });

  render(<App />);

  const devtools = getDevTools();
  const state = devtools.inspector.getState();
  expect(state.signals.size).toBeGreaterThan(0);
});
```

### Extension Tests

Test extension communication:

```typescript
test('extension receives state updates', async () => {
  // Load extension
  await loadExtension();

  // Enable DevTools in app
  enableDevTools();

  // Wait for connection
  await waitForConnection();

  // Make changes
  count.set(5);

  // Check extension received update
  const state = await getExtensionState();
  expect(state.signals).toBeDefined();
});
```

## Performance Considerations

### Minimal Overhead

- Only track when DevTools is enabled
- Use WeakMaps for signal-to-ID mapping
- Lazy serialize values only when needed
- Batch state updates to extension

### Memory Management

- Limit history size (default 1000 entries)
- Clear old snapshots automatically
- Dispose properly on unmount

### Tree-Shaking

- Entire DevTools module tree-shakes in production
- Use dynamic imports for conditional loading
- No runtime overhead if not imported

## Future Enhancements

1. **Visual Timeline**: Graphical timeline of state mutations
2. **Dependency Graph**: Interactive graph of signal dependencies
3. **Hot Reloading**: Preserve DevTools state across reloads
4. **Remote Debugging**: Debug apps on other devices
5. **Plugins**: Allow custom DevTools extensions
6. **Performance Budgets**: Alert on slow operations
7. **State Snapshots**: Quick save/restore states
8. **Diff View**: Visual diff between states

## Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Manifest V3 Migration](https://developer.chrome.com/docs/extensions/mv3/intro/)

## Conclusion

The DevTools implementation provides a solid foundation for debugging Aether applications. The modular architecture allows for easy extension and customization, while maintaining zero production overhead through tree-shaking.

Next steps:
1. Add integration hooks to core Aether modules
2. Test browser extension in real applications
3. Create comprehensive examples
4. Add missing features (component tree visualization, etc.)
5. Publish extension to Chrome Web Store
