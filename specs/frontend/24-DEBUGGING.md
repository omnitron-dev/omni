# 24. Debugging and DevTools

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Browser DevTools](#browser-devtools)
- [Nexus DevTools](#nexus-devtools)
- [Source Maps](#source-maps)
- [Error Tracking](#error-tracking)
- [Performance Profiling](#performance-profiling)
- [Network Debugging](#network-debugging)
- [State Inspection](#state-inspection)
- [Hot Module Replacement](#hot-module-replacement)
- [Debug Utilities](#debug-utilities)
- [Production Debugging](#production-debugging)
- [Best Practices](#best-practices)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Nexus provides **comprehensive debugging tools** for development and production:

- 🔍 **Browser DevTools integration** - Works seamlessly with Chrome/Firefox DevTools
- 🎯 **Nexus DevTools Extension** - Inspect components, signals, stores
- 🗺️ **Source Maps** - Debug original TypeScript code
- 🐛 **Error boundaries** - Graceful error handling
- 📊 **Performance profiling** - Identify bottlenecks
- 🌐 **Network inspection** - Debug RPC calls
- 💾 **State time-travel** - Replay state changes
- 🔥 **HMR debugging** - Debug module updates

### Debugging Experience

```
Development:
  Code → TypeScript → Source Maps → Browser DevTools
                    ↓
                  Nexus DevTools
                    ↓
               State Inspector
```

### Quick Start

```typescript
// Enable DevTools in development
if (import.meta.env.DEV) {
  enableDevTools();
}

// Error boundary for production
<ErrorBoundary
  fallback={(error) => <ErrorPage error={error} />}
>
  <App />
</ErrorBoundary>

// Debug specific component
<Component
  ref={(el) => {
    console.log('Component mounted:', el);
    debugComponent(el);
  }}
/>
```

## Philosophy

### Developer Experience First

**Make debugging easy and intuitive**:

```typescript
// ✅ Clear error messages
Error: Cannot read property 'name' of undefined
  at UserProfile (UserProfile.tsx:15)
  at ComponentTree (App.tsx:42)

Hint: Check if 'user' is loaded before accessing 'user.name'

// ❌ Cryptic errors (other frameworks)
TypeError: Cannot read property 'name' of undefined
  at anonymous (bundle.js:1234)
```

### Debuggable in Production

**Production builds remain debuggable**:

```typescript
// Source maps included (optional)
// Original stack traces preserved
// Minimal performance impact
```

### State Transparency

**Inspect state at any time**:

```typescript
// Access state from DevTools
window.__NEXUS_STATE__

// Time-travel debugging
window.__NEXUS_DEVTOOLS__.timeTravel(-5); // Go back 5 states
```

### Performance Visibility

**See performance metrics in real-time**:

```typescript
// Component render times
// Signal update frequency
// Effect execution count
// Memory usage
```

## Browser DevTools

### Console Debugging

```typescript
// Basic logging
console.log('User:', user());

// Formatted logging
console.table(users());

// Group logging
console.group('Component Lifecycle');
console.log('Mounting...');
console.log('Mounted');
console.groupEnd();

// Conditional logging
console.assert(value > 0, 'Value must be positive');

// Timing
console.time('fetch-users');
await fetchUsers();
console.timeEnd('fetch-users');
```

### Breakpoints

```typescript
// Debugger statement
export default defineComponent(() => {
  const count = signal(0);

  const increment = () => {
    debugger; // Execution pauses here
    count.set(count() + 1);
  };

  return () => <button onClick={increment}>{count()}</button>;
});

// Conditional breakpoint (in DevTools)
// count() > 5
```

### Element Inspection

```typescript
// Inspect element
<div
  ref={(el) => {
    // Available as $0 in console
    console.log('Element:', el);
  }}
>
  Content
</div>

// Then in console:
// $0.textContent
// $0.classList
// $0.style
```

### Network Tab

```typescript
// Monitor RPC calls
const userService = useRPC(UserService);

// Shows in Network tab:
// Name: rpc/UserService.findById
// Method: POST
// Status: 200
// Size: 1.2 KB
// Time: 45ms
```

### Performance Tab

```typescript
// Profile component performance
const start = performance.now();

render(() => <HeavyComponent />);

const end = performance.now();
console.log(`Render took ${end - start}ms`);

// Use Performance tab for detailed analysis
```

## Nexus DevTools

### Installation

```bash
# Chrome extension
https://chrome.google.com/webstore/nexus-devtools

# Firefox extension
https://addons.mozilla.org/firefox/nexus-devtools
```

### Component Tree

View component hierarchy:

```
App
├─ Header
│  ├─ Logo
│  └─ Nav
├─ Main
│  ├─ Sidebar
│  │  ├─ SearchBar
│  │  └─ Menu
│  └─ Content
│     └─ Article
└─ Footer
```

**Features**:
- Click component to inspect
- View props, signals, effects
- Edit values in real-time
- Track re-renders
- Highlight updates

### Signal Inspector

Inspect signals:

```typescript
const count = signal(0);

// DevTools shows:
// Signal: count
// Value: 0
// Dependencies: [doubled, effect#1]
// Update count: 5
```

Edit signal values:

```typescript
// In DevTools console:
__NEXUS_DEVTOOLS__.setSignal('count', 10);

// Component updates automatically
```

### Store Inspector

Inspect stores:

```typescript
const [state, setState] = createStore({
  user: { name: 'Alice', age: 30 },
  settings: { theme: 'light' }
});

// DevTools shows:
// Store: userStore
// State:
//   user:
//     name: "Alice"
//     age: 30
//   settings:
//     theme: "light"
```

**Features**:
- View store state
- Edit values
- Export/import state
- Track mutations
- Time-travel debugging

### Time Travel

Travel through state history:

```typescript
// DevTools timeline:
// 1. Initial state
// 2. User logged in
// 3. Profile updated
// 4. Settings changed
// 5. Theme toggled

// Click state #2 → App reverts to that state
// Click "Forward" → Replay to current state
```

### Performance Profiler

Profile component performance:

```typescript
// Start profiling
__NEXUS_DEVTOOLS__.startProfiling();

// Interact with app
// ...

// Stop profiling
__NEXUS_DEVTOOLS__.stopProfiling();

// DevTools shows:
// Component render times
// Signal update frequency
// Effect execution count
// Wasted renders
```

### Network Monitor

Monitor RPC calls:

```typescript
// DevTools Network tab shows:
// Method: UserService.findById
// Arguments: ["123"]
// Result: { id: "123", name: "Alice" }
// Duration: 45ms
// Cache: HIT/MISS
```

## Source Maps

### Enable Source Maps

```typescript
// nexus.config.ts
export default {
  build: {
    // Development: inline source maps
    sourcemap: import.meta.env.DEV ? 'inline' : false,

    // Production: external source maps (optional)
    sourcemap: import.meta.env.PROD ? true : 'inline'
  }
};
```

### Debug Original Code

```typescript
// Original TypeScript:
// src/components/Counter.tsx:15
export default defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      {count()}
    </button>
  );
});

// Error shows original location:
// Error at Counter.tsx:15
// Not: bundle.js:12345
```

### Source Map Upload

Upload source maps to error tracking:

```bash
# Upload to Sentry
sentry-cli sourcemaps upload \
  --org my-org \
  --project my-project \
  dist/

# Upload to Rollbar
rollbar deploy --sourcemap dist/
```

## Error Tracking

### Error Boundaries

Catch component errors:

```typescript
import { ErrorBoundary } from 'nexus/error';

export default defineComponent(() => {
  return () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div>
          <h1>Error: {error.message}</h1>
          <pre>{error.stack}</pre>
          <button onClick={reset}>Try Again</button>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  );
});
```

### Global Error Handler

Handle all errors:

```typescript
// Set up global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);

  // Send to error tracking service
  errorTracker.captureError(event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);

  errorTracker.captureError(event.reason);
});
```

### Error Tracking Services

Integrate with error tracking:

```typescript
// Sentry
import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: 'https://...',
  environment: import.meta.env.MODE,
  integrations: [
    new Sentry.BrowserTracing(),
    new Sentry.Replay()
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1
});

// Capture error
try {
  await riskyOperation();
} catch (error) {
  Sentry.captureException(error);
}

// Add context
Sentry.user.set({ id: user.id, email: user.email });
Sentry.Tag.set('feature', 'checkout');
Sentry.addBreadcrumb({
  message: 'User clicked checkout',
  category: 'user-action'
});
```

### Custom Error Pages

```typescript
// routes/+error.tsx
export default defineComponent<{ error: Error }>((props) => {
  return () => (
    <div class="error-page">
      <h1>Oops! Something went wrong</h1>
      <p>{props.error.message}</p>

      {import.meta.env.DEV && (
        <pre>{props.error.stack}</pre>
      )}

      <a href="/">Go Home</a>
    </div>
  );
});
```

## Performance Profiling

### Component Profiling

Profile component renders:

```typescript
import { profile } from 'nexus/profiler';

const ProfiledComponent = profile(defineComponent(() => {
  // Component code
}), {
  id: 'MyComponent',
  onRender: (id, phase, duration) => {
    console.log(`${id} ${phase} took ${duration}ms`);
  }
});
```

### Performance Marks

Add performance marks:

```typescript
export default defineComponent(() => {
  onMount(() => {
    performance.mark('component-mounted');
  });

  const handleClick = async () => {
    performance.mark('fetch-start');

    await fetchData();

    performance.mark('fetch-end');
    performance.measure('fetch-duration', 'fetch-start', 'fetch-end');

    const measure = performance.getEntriesByName('fetch-duration')[0];
    console.log(`Fetch took ${measure.duration}ms`);
  };

  return () => <button onClick={handleClick}>Fetch</button>;
});
```

### Memory Profiling

Monitor memory usage:

```typescript
// Take heap snapshot
if (performance.memory) {
  console.log('Used JS heap:', performance.memory.usedJSHeapSize);
  console.log('Total JS heap:', performance.memory.totalJSHeapSize);
  console.log('Heap limit:', performance.memory.jsHeapSizeLimit);
}

// Detect memory leaks
const snapshots: any[] = [];

setInterval(() => {
  if (performance.memory) {
    snapshots.push({
      time: Date.now(),
      used: performance.memory.usedJSHeapSize
    });

    // Alert if memory growing
    if (snapshots.length > 10) {
      const trend = calculateTrend(snapshots);
      if (trend > 1000000) { // Growing by 1MB/snapshot
        console.warn('Possible memory leak detected');
      }
    }
  }
}, 5000);
```

### Render Profiling

Track render performance:

```typescript
import { createRenderProfiler } from 'nexus/profiler';

const profiler = createRenderProfiler();

profiler.start();

// Interact with app
// ...

profiler.stop();

// Get results
const results = profiler.getResults();

console.table(results.components.map(c => ({
  name: c.name,
  renders: c.renderCount,
  avgTime: c.averageRenderTime,
  totalTime: c.totalRenderTime
})));
```

## Network Debugging

### RPC Debugging

Debug RPC calls:

```typescript
// Enable RPC logging
import { configureRPC } from 'nexus/titan';

configureRPC({
  debug: true,

  beforeRequest: (request) => {
    console.log('RPC Request:', {
      service: request.service,
      method: request.method,
      args: request.args
    });
  },

  afterResponse: (response) => {
    console.log('RPC Response:', {
      duration: response.duration,
      result: response.result
    });
  },

  onError: (error) => {
    console.error('RPC Error:', error);
  }
});
```

### Request Logging

Log all requests:

```typescript
// Intercept fetch
const originalFetch = window.fetch;

window.fetch = async (...args) => {
  const start = performance.now();

  console.log('Fetch:', args[0]);

  const response = await originalFetch(...args);

  const duration = performance.now() - start;

  console.log(`Fetch complete (${duration}ms):`, {
    url: args[0],
    status: response.status,
    duration
  });

  return response;
};
```

### Network Throttling

Simulate slow network:

```typescript
// Use Chrome DevTools Network throttling
// Or simulate programmatically:

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const slowFetch = async (url: string, options?: RequestInit) => {
  await delay(1000); // Simulate 1s latency

  return fetch(url, options);
};
```

## State Inspection

### Inspect Signals

```typescript
// Make signals inspectable
const count = signal(0, {
  name: 'counter', // Named signal
  debug: true // Enable debugging
});

// Access in console
window.__NEXUS_SIGNALS__.get('counter'); // 0

// Subscribe to changes
window.__NEXUS_SIGNALS__.subscribe('counter', (value) => {
  console.log('Counter changed:', value);
});
```

### Inspect Stores

```typescript
// Named store
const [state, setState] = createStore(
  { count: 0 },
  { name: 'counterStore' }
);

// Access in console
window.__NEXUS_STORES__.get('counterStore');

// Watch mutations
window.__NEXUS_STORES__.watch('counterStore', (mutation) => {
  console.log('Store mutation:', mutation);
});
```

### State Snapshots

Export/import state:

```typescript
// Export state
const snapshot = {
  signals: window.__NEXUS_SIGNALS__.exportAll(),
  stores: window.__NEXUS_STORES__.exportAll()
};

localStorage.setItem('state-snapshot', JSON.stringify(snapshot));

// Import state
const snapshot = JSON.parse(localStorage.getItem('state-snapshot')!);

window.__NEXUS_SIGNALS__.importAll(snapshot.signals);
window.__NEXUS_STORES__.importAll(snapshot.stores);
```

## Hot Module Replacement

### HMR Debugging

Debug HMR updates:

```typescript
// vite.config.ts
export default {
  server: {
    hmr: {
      overlay: true // Show HMR errors
    }
  }
};

// In component
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    console.log('Module updated:', newModule);
  });

  import.meta.hot.dispose(() => {
    console.log('Module disposing');
  });
}
```

### Preserve State

Preserve state during HMR:

```typescript
// Mark state to preserve
const count = signal(0);

if (import.meta.hot) {
  import.meta.hot.data.count = count();

  import.meta.hot.accept(() => {
    if (import.meta.hot?.data.count !== undefined) {
      count.set(import.meta.hot.data.count);
    }
  });
}
```

## Debug Utilities

### Debug Component

Inspect component:

```typescript
import { debugComponent } from 'nexus/debug';

export default defineComponent(() => {
  let ref: HTMLElement;

  onMount(() => {
    debugComponent(ref, {
      logProps: true,
      logSignals: true,
      logRenders: true
    });
  });

  return () => <div ref={ref}>Content</div>;
});

// Console output:
// Component props: {...}
// Component signals: [count, user]
// Component rendered (12ms)
```

### Assert Utilities

Add assertions:

```typescript
import { assert, assertDefined, assertType } from 'nexus/debug';

const value = computeValue();

assert(value > 0, 'Value must be positive');
assertDefined(user, 'User must be defined');
assertType<User>(user, 'user');
```

### Debug Mode

Enable debug mode:

```typescript
// Set debug mode
localStorage.setItem('NEXUS_DEBUG', 'true');

// Check debug mode
if (isDebugMode()) {
  console.log('Debug mode enabled');
  enableVerboseLogging();
}
```

## Production Debugging

### Source Maps in Production

Include source maps (optional):

```typescript
export default {
  build: {
    sourcemap: 'hidden' // Source maps not referenced in bundle
  }
};

// Upload source maps to error tracking
// But don't serve them to users
```

### Feature Flags

Use feature flags for debugging:

```typescript
const DEBUG_FEATURE = import.meta.env.VITE_DEBUG_FEATURE === 'true';

if (DEBUG_FEATURE) {
  console.log('Debug feature enabled');
  enableExperimentalFeature();
}
```

### Remote Debugging

Enable remote debugging:

```typescript
// Eruda (mobile debugging)
if (import.meta.env.VITE_ENABLE_ERUDA) {
  import('eruda').then(eruda => eruda.default.init());
}

// vConsole (mobile debugging)
if (import.meta.env.VITE_ENABLE_VCONSOLE) {
  import('vconsole').then(VConsole => new VConsole.default());
}
```

## Best Practices

### 1. Use Meaningful Names

```typescript
// ✅ Descriptive names
const isLoading = signal(false, { name: 'isLoading' }

// ❌ Generic names
const s1 = signal(false);
```

### 2. Add Error Context

```typescript
// ✅ Contextual errors
try {
  await fetchUser(id);
} catch (error) {
  throw new Error(`Failed to fetch user ${id}: ${error.message}`);
}

// ❌ Generic errors
try {
  await fetchUser(id);
} catch (error) {
  throw error;
}
```

### 3. Log Important Events

```typescript
// ✅ Log key events
console.log('User logged in:', user.id);
console.log('Payment processed:', payment.id);

// ❌ Log everything
console.log('Function called');
console.log('Variable set');
```

### 4. Remove Debug Code

```typescript
// ✅ Conditional logging
if (import.meta.env.DEV) {
  console.log('Debug info');
}

// ❌ Always log
console.log('Debug info');
```

## Advanced Patterns

### Custom DevTools Panel

Create custom DevTools panel:

```typescript
// devtools-panel.tsx
export const DevToolsPanel = defineComponent(() => {
  const signals = signal([])
  const stores = signal([])

  onMount(() => {
    // Subscribe to state changes
    window.__NEXUS_SIGNALS__.subscribe('*', (name, value) => {
      signals.set(s => [...s, { name, value }]);
    });
  });

  return () => (
    <div class="devtools-panel">
      <h2>Signals</h2>
      <ul>
        {#each signals() as signal}
          <li>{signal.name}: {signal.value}</li>
        {/each}
      </ul>

      <h2>Stores</h2>
      <ul>
        {#each stores() as store}
          <li>{store.name}: {JSON.stringify(store.state)}</li>
        {/each}
      </ul>
    </div>
  );
});
```

### Performance Monitor

Real-time performance monitoring:

```typescript
// performance-monitor.tsx
export const PerformanceMonitor = defineComponent(() => {
  const fps = signal(0);
  const memory = signal(0);

  onMount(() => {
    let frameCount = 0;
    let lastTime = performance.now();

    const measure = () => {
      frameCount++;

      const now = performance.now();
      if (now - lastTime >= 1000) {
        fps.set(frameCount);
        frameCount = 0;
        lastTime = now;

        if (performance.memory) {
          memory.set(performance.memory.usedJSHeapSize / 1024 / 1024);
        }
      }

      requestAnimationFrame(measure);
    };

    measure();
  });

  return () => (
    <div class="perf-monitor">
      <div>FPS: {fps()}</div>
      <div>Memory: {memory().toFixed(2)} MB</div>
    </div>
  );
});
```

## API Reference

### debugComponent

```typescript
function debugComponent(
  element: HTMLElement,
  options?: {
    logProps?: boolean;
    logSignals?: boolean;
    logRenders?: boolean;
  }
): void;
```

### enableDevTools

```typescript
function enableDevTools(options?: {
  name?: string;
  maxHistory?: number;
  logUpdates?: boolean;
}): void;
```

### profile

```typescript
function profile<T>(
  component: Component<T>,
  options?: {
    id?: string;
    onRender?: (id: string, phase: string, duration: number) => void;
  }
): Component<T>;
```

## Examples

### Complete Debug Setup

```typescript
// main.ts
import { enableDevTools } from 'nexus/devtools';
import * as Sentry from '@sentry/browser';

// Enable DevTools in development
if (import.meta.env.DEV) {
  enableDevTools({
    name: 'My App',
    maxHistory: 50,
    logUpdates: true
  });
}

// Error tracking in production
if (import.meta.env.PROD) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      new Sentry.BrowserTracing(),
      new Sentry.Replay()
    ]
  });
}

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  Sentry.captureException(event.error);
});

// App with error boundary
render(
  () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <ErrorPage error={error} onReset={reset} />
      )}
    >
      <App />
    </ErrorBoundary>
  ),
  document.getElementById('root')!
);
```

---

**Nexus debugging tools provide comprehensive visibility** into your application's behavior during development and production. From browser DevTools integration to custom profiling, you have everything needed to debug effectively.

**Next**: [25. Performance Optimization →](./25-PERFORMANCE.md)
