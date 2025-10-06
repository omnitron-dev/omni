# 38. API Reference

**Status**: Draft
**Version**: 1.0.0
**Last Updated**: 2025-10-06

## Overview

This document provides a complete API reference for Vibrancy - the reactive core of the Aether frontend framework. All APIs are fully typed with TypeScript and include detailed examples based on the actual implementation.

Vibrancy is a fine-grained reactive system inspired by Solid.js, providing signals, computed values, effects, stores, and resources with first-class TypeScript support.

## Table of Contents

1. [Core Reactivity](#core-reactivity)
2. [Lifecycle & Context](#lifecycle--context)
3. [Store API](#store-api)
4. [Resource API](#resource-api)
5. [Async Computed](#async-computed)
6. [Advanced Topics](#advanced-topics)
7. [Type Definitions](#type-definitions)

---

## Core Reactivity

### signal()

Creates a reactive signal that can be read and written. Signals are the primitive building blocks of reactivity in Vibrancy.

**Signature:**
```typescript
function signal<T>(): Signal<T | undefined>;
function signal<T>(initialValue: T, options?: SignalOptions<T>): Signal<T>;

interface Signal<T> {
  (): T;                                    // Read with tracking
  peek(): T;                                // Read without tracking
  set(value: T | ((prev: T) => T)): void;   // Set value
  update(fn: (prev: T) => T): void;         // Update with function
  mutate(fn: (value: T) => void): void;     // Mutate in place (for objects/arrays)
  subscribe(fn: (value: T) => void): () => void; // Subscribe to changes
}

interface SignalOptions<T> {
  equals?: false | ((prev: T, next: T) => boolean);
  name?: string; // For debugging
}
```

**Parameters:**
- `initialValue` (optional): Initial value for the signal
- `options.equals`: Custom equality function or `false` to always update (default: `Object.is`)
- `options.name`: Debug name for the signal

**Returns:**
- `Signal<T>` object with methods for reading and writing

**Examples:**

```typescript
// Basic usage
const count = signal(0);
console.log(count()); // 0
count.set(5);
console.log(count()); // 5

// Functional update
count.set(prev => prev + 1);
console.log(count()); // 6

// Using update method
count.update(prev => prev * 2);
console.log(count()); // 12

// Reading without tracking
const untracked = count.peek();
console.log(untracked); // 12

// Mutating objects in place
const user = signal({ name: 'John', age: 30 });
user.mutate(u => {
  u.age = 31;
}); // Triggers update

// Subscribing to changes
const unsub = count.subscribe(value => {
  console.log('Count changed to:', value);
});
count.set(20); // Logs: "Count changed to: 20"
unsub(); // Unsubscribe

// Custom equality
const coords = signal(
  { x: 0, y: 0 },
  {
    equals: (a, b) => a.x === b.x && a.y === b.y
  }
);

// Without initial value
const value = signal<string>();
console.log(value()); // undefined
value.set('hello');
console.log(value()); // 'hello'
```

**Notes:**
- `signal()` creates a mutable reactive value
- Reading via `()` tracks dependencies in effects and computed values
- Use `peek()` when you need to read without creating a dependency
- `mutate()` is optimized for in-place modifications of objects/arrays
- Signals use `Object.is` for equality by default
- Updates are synchronous and batched automatically within effects

---

### computed()

Creates a derived value that automatically updates when its dependencies change. Computed values are memoized and only recalculate when dependencies change.

**Signature:**
```typescript
function computed<T>(
  fn: () => T,
  options?: ComputedOptions<T>
): ComputedSignal<T>;

interface ComputedSignal<T> {
  (): T;                                    // Read with tracking
  peek(): T;                                // Read without tracking
  subscribe(fn: (value: T) => void): () => void; // Subscribe to changes
}

interface ComputedOptions<T> {
  equals?: false | ((prev: T, next: T) => boolean);
  name?: string; // For debugging
}
```

**Parameters:**
- `fn`: Function that computes the value (can read other signals)
- `options.equals`: Custom equality function or `false` to always update
- `options.name`: Debug name for the computed value

**Returns:**
- `ComputedSignal<T>` - read-only signal

**Examples:**

```typescript
// Basic computed
const count = signal(2);
const doubled = computed(() => count() * 2);
console.log(doubled()); // 4
count.set(5);
console.log(doubled()); // 10

// Multiple dependencies
const firstName = signal('John');
const lastName = signal('Doe');
const fullName = computed(() => `${firstName()} ${lastName()}`);
console.log(fullName()); // "John Doe"

// Chained computed values
const quadrupled = computed(() => doubled() * 2);
console.log(quadrupled()); // 20 (when count is 5)

// Custom equality
const items = signal([1, 2, 3]);
const total = computed(
  () => items().reduce((sum, n) => sum + n, 0),
  {
    equals: (a, b) => a === b
  }
);

// Reading without tracking
const peeked = quadrupled.peek();

// Subscribing to computed changes
const unsub = fullName.subscribe(value => {
  console.log('Full name changed:', value);
});
firstName.set('Jane'); // Logs: "Full name changed: Jane Doe"
unsub();

// Complex computation with conditional logic
const user = signal({ name: 'John', premium: false });
const greeting = computed(() => {
  const u = user();
  return u.premium ? `Welcome back, ${u.name}!` : `Hello, ${u.name}`;
});
```

**Notes:**
- Computed values are lazy - they only compute when read
- Results are cached until dependencies change
- Computed values cannot have circular dependencies (will throw error)
- Use `peek()` to read without creating dependencies
- Computed values automatically track all signals read during execution
- Diamond dependencies are handled correctly (computed runs only once)

---

### effect()

Creates a side effect that automatically re-runs when its dependencies change. Effects are the foundation for reactive updates in Vibrancy.

**Signature:**
```typescript
function effect(
  fn: (prev?: any) => any | (() => void),
  options?: EffectOptions
): () => void;

interface EffectOptions {
  defer?: boolean;                // If true, don't run immediately (default: false)
  scheduler?: (fn: () => void) => void; // Custom scheduler
  name?: string;                  // For debugging
  isOptional?: boolean;           // Allow circular dependencies (default: false)
  onCircularDependency?: 'skip' | 'warn' | 'error'; // Handle circular deps
}
```

**Parameters:**
- `fn`: Effect function that runs when dependencies change
  - Can return a cleanup function
  - Receives previous return value as argument
- `options.defer`: If `true`, don't run immediately (default: `false`)
- `options.scheduler`: Custom scheduler for batching updates
- `options.name`: Debug name for the effect
- `options.isOptional`: Allow circular dependencies
- `options.onCircularDependency`: How to handle circular dependencies

**Returns:**
- Cleanup function to dispose the effect

**Examples:**

```typescript
// Basic effect
const count = signal(0);
effect(() => {
  console.log('Count is:', count());
});
// Immediately logs: "Count is: 0"
count.set(5);
// Logs: "Count is: 5"

// Effect with cleanup (return function)
effect(() => {
  const timer = setInterval(() => {
    console.log('Tick');
  }, 1000);

  return () => {
    clearInterval(timer);
  };
});

// Effect with cleanup (using onCleanup)
import { onCleanup } from 'vibrancy';

effect(() => {
  const listener = () => console.log('clicked');
  document.addEventListener('click', listener);

  onCleanup(() => {
    document.removeEventListener('click', listener);
  });
});

// Accessing previous value
const log = signal<string[]>([]);
effect((prev) => {
  const current = count();
  console.log(`Changed from ${prev} to ${current}`);
  return current;
});

// Manual disposal
const dispose = effect(() => {
  console.log(count());
});
// Later...
dispose(); // Stop the effect

// Deferred effect
effect(() => {
  console.log('Deferred:', count());
}, { defer: true }); // Doesn't run immediately

// Custom scheduler for batching
const batch: (() => void)[] = [];
effect(() => {
  console.log('Scheduled:', count());
}, {
  scheduler: (fn) => {
    batch.push(fn);
  }
});
// Later: batch.forEach(fn => fn());

// Handling circular dependencies
const a = signal(1);
const b = signal(2);

effect(() => {
  if (a() > 10) return;
  b.set(a() + 1);
}, { isOptional: true, onCircularDependency: 'warn' });

effect(() => {
  if (b() > 10) return;
  a.set(b() + 1);
}, { isOptional: true, onCircularDependency: 'warn' });

// Multi-signal effect
const x = signal(1);
const y = signal(2);
effect(() => {
  console.log(`Sum: ${x() + y()}`);
});
```

**Notes:**
- Effects run immediately by default (unless `defer: true`)
- Effects automatically track all signals read during execution
- Cleanup functions run before the next effect execution and on disposal
- Use `onCleanup()` for multiple cleanup operations
- Effects can be nested (child effects are cleaned up with parent)
- Circular dependencies between effects will throw an error (unless `isOptional: true`)
- Use custom schedulers for advanced batching strategies

---

### batch()

Batches multiple signal updates into a single notification. All effects will run only once after the batch completes.

**Signature:**
```typescript
function batch<T>(fn: () => T): T;
```

**Parameters:**
- `fn`: Function containing multiple signal updates

**Returns:**
- Return value of the function

**Examples:**

```typescript
const count = signal(0);
const name = signal('John');

effect(() => {
  console.log(`${name()}: ${count()}`);
});
// Logs: "John: 0"

// Without batch - effect runs twice
count.set(1);
// Logs: "John: 1"
name.set('Jane');
// Logs: "Jane: 1"

// With batch - effect runs once
batch(() => {
  count.set(10);
  name.set('Alice');
});
// Logs only once: "Alice: 10"

// Nested batches
batch(() => {
  count.set(5);
  batch(() => {
    name.set('Bob');
    count.set(6);
  });
});
// Single update after all batches complete

// Returning values
const result = batch(() => {
  count.set(100);
  name.set('Final');
  return count() + name().length;
});
console.log(result); // 105
```

**Notes:**
- Batching is automatic within effects
- Nested batches are flattened
- Updates happen synchronously but notifications are deferred
- Useful for optimizing multiple related updates
- All effects run exactly once after the batch

---

### untrack()

Reads signals without creating dependencies. Useful when you need to access reactive values without subscribing to them.

**Signature:**
```typescript
function untrack<T>(fn: () => T): T;
```

**Parameters:**
- `fn`: Function to execute without tracking

**Returns:**
- Return value of the function

**Examples:**

```typescript
const count = signal(0);
const doubled = signal(0);

// Without untrack - creates dependency
effect(() => {
  doubled.set(count() * 2);
});

// With untrack - no dependency
effect(() => {
  const current = untrack(() => count());
  console.log('Initial count was:', current);
  // This effect won't re-run when count changes
});

// Conditional tracking
const enabled = signal(true);
const value = signal(0);

effect(() => {
  if (enabled()) {
    console.log('Tracked:', value());
  } else {
    console.log('Untracked:', untrack(() => value()));
  }
});

// Reading multiple signals without tracking
const a = signal(1);
const b = signal(2);
const c = signal(3);

const sum = untrack(() => a() + b() + c());
console.log(sum); // 6, no dependencies created

// Combining tracked and untracked
effect(() => {
  const tracked = count();
  const untracked = untrack(() => doubled());
  console.log(tracked, untracked);
  // Only re-runs when count changes, not doubled
});
```

**Notes:**
- `untrack()` is equivalent to using `signal.peek()`
- Useful for reading initial values without creating subscriptions
- Can be nested
- Commonly used in effects for one-time setup logic

---

### createRoot()

Creates an isolated reactive scope. All effects and computations created within the root can be disposed together.

**Signature:**
```typescript
function createRoot<T>(
  fn: (dispose: () => void) => T
): T;
```

**Parameters:**
- `fn`: Function that receives a dispose callback

**Returns:**
- Return value of the function

**Examples:**

```typescript
// Basic root
const cleanup = createRoot(dispose => {
  const count = signal(0);

  effect(() => {
    console.log('Count:', count());
  });

  return dispose;
});

// Later: cleanup all effects
cleanup();

// Multiple effects in a root
createRoot(dispose => {
  const timer = signal(0);

  effect(() => {
    console.log('Timer:', timer());
  });

  effect(() => {
    if (timer() > 10) {
      console.log('Time exceeded!');
      dispose(); // Self-cleanup
    }
  });

  setInterval(() => timer.set(t => t + 1), 1000);
});

// Nested roots
createRoot(outerDispose => {
  const outer = signal('outer');

  effect(() => console.log('Outer:', outer()));

  createRoot(innerDispose => {
    const inner = signal('inner');
    effect(() => console.log('Inner:', inner()));

    // innerDispose only cleans up inner scope
    // outerDispose cleans up both
  });
});

// Component-like pattern
function createComponent() {
  return createRoot(dispose => {
    const state = signal({ count: 0 });

    effect(() => {
      console.log('Component state:', state());
    });

    return {
      state,
      destroy: dispose
    };
  });
}

const component = createComponent();
// Later...
component.destroy();

// Managing subscriptions
createRoot(dispose => {
  const ws = new WebSocket('ws://example.com');

  ws.onmessage = (e) => {
    console.log('Message:', e.data);
  };

  // Clean up on dispose
  onCleanup(() => ws.close());

  return dispose;
});
```

**Notes:**
- Roots create ownership boundaries
- All reactive primitives created in a root are cleaned up together
- Nested roots are independent
- Useful for component lifecycle management
- Effects created outside any root are never automatically cleaned up

---

## Lifecycle & Context

### onCleanup()

Registers a cleanup function to run when the current reactive scope is disposed. Can be called multiple times to register multiple cleanup functions.

**Signature:**
```typescript
function onCleanup(fn: () => void): void;
```

**Parameters:**
- `fn`: Cleanup function to execute on disposal

**Examples:**

```typescript
// Basic cleanup in effect
effect(() => {
  const timer = setInterval(() => {
    console.log('Tick');
  }, 1000);

  onCleanup(() => {
    clearInterval(timer);
  });
});

// Multiple cleanup functions
effect(() => {
  const ws = new WebSocket('ws://example.com');
  const timer = setInterval(() => ws.send('ping'), 30000);

  onCleanup(() => clearInterval(timer));
  onCleanup(() => ws.close());
  // Both run when effect is disposed
});

// Cleanup in createRoot
createRoot(dispose => {
  const resource = acquireResource();

  onCleanup(() => {
    resource.release();
  });

  return dispose;
});

// Conditional cleanup
effect(() => {
  if (condition()) {
    const subscription = subscribe();
    onCleanup(() => subscription.unsubscribe());
  }
});

// Event listeners
effect(() => {
  const handler = () => console.log('clicked');
  document.addEventListener('click', handler);

  onCleanup(() => {
    document.removeEventListener('click', handler);
  });
});
```

**Notes:**
- Cleanup functions run in LIFO order (last registered, first executed)
- Called before effect re-runs and on disposal
- Can be called multiple times in the same scope
- More flexible than returning a cleanup function from effects

---

### getOwner()

Gets the current reactive owner (computation context). Used for advanced patterns like transferring reactive ownership.

**Signature:**
```typescript
function getOwner(): Owner | null;

interface Owner {
  context?: Map<symbol, any>;
  owner?: Owner;
  // Internal fields...
}
```

**Returns:**
- Current owner or `null` if outside reactive scope

**Examples:**

```typescript
// Capturing owner for later use
let owner: Owner | null;

effect(() => {
  owner = getOwner();
});

// Transferring ownership
function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prevOwner = getOwner();
  setOwner(owner); // Internal API
  try {
    return fn();
  } finally {
    setOwner(prevOwner);
  }
}

// Context pattern
const ThemeContext = Symbol('theme');

function createThemeProvider(theme: string) {
  const owner = getOwner();
  if (owner) {
    if (!owner.context) owner.context = new Map();
    owner.context.set(ThemeContext, theme);
  }
}

function useTheme(): string {
  const owner = getOwner();
  if (!owner?.context) return 'light';
  return owner.context.get(ThemeContext) ?? 'light';
}

// Using context
createRoot(() => {
  createThemeProvider('dark');

  effect(() => {
    console.log('Theme:', useTheme()); // 'dark'
  });
});
```

**Notes:**
- Advanced API - most users won't need this
- Used internally for context and ownership transfer
- Returns `null` outside reactive scopes
- Useful for building framework features

---

## Store API

### store()

Creates a reactive store - a deeply reactive object where all properties are tracked. More convenient than signals for complex state.

**Signature:**
```typescript
function store<T extends object>(
  initial: T,
  options?: StoreOptions
): Store<T>;

interface Store<T> {
  // Direct property access (reactive)
  [K in keyof T]: T[K];

  // Methods
  get(): T;
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  update(partial: Partial<T>): void;
  transaction(fn: (state: T) => void): void;
  subscribe(fn: (state: T) => void): () => void;
}

interface StoreOptions {
  shallow?: string[];  // Property paths to keep non-reactive
  lazy?: boolean;      // Lazy proxy creation (default: true)
  equals?: (a: any, b: any) => boolean; // Custom equality
}
```

**Parameters:**
- `initial`: Initial state object
- `options.shallow`: Array of paths to exclude from reactivity
- `options.lazy`: Create proxies lazily (default: `true`)
- `options.equals`: Custom equality function

**Returns:**
- Reactive store object

**Examples:**

```typescript
// Basic store
const state = store({
  count: 0,
  user: { name: 'John', age: 30 },
  items: [1, 2, 3]
});

// Direct property access (reactive)
effect(() => {
  console.log('Count:', state.count);
  console.log('User:', state.user.name);
});

state.count = 5;        // Triggers effect
state.user.name = 'Jane'; // Triggers effect
state.items.push(4);    // Triggers effect

// Using methods
const fullState = state.get();
const count = state.get('count');

state.set('count', 10);
state.update({ count: 20, items: [5, 6, 7] });

// Transaction (batched updates)
state.transaction(s => {
  s.count = 100;
  s.user.name = 'Alice';
  s.user.age = 25;
}); // Single notification

// Subscribe to changes
const unsub = state.subscribe(s => {
  console.log('State changed:', s);
});

// Shallow paths (non-reactive)
const config = store(
  {
    theme: 'dark',
    plugins: [{ name: 'plugin1' }],
    settings: { debug: true }
  },
  {
    shallow: ['plugins'] // plugins array is not reactive
  }
);

// Nested reactivity
const app = store({
  ui: {
    sidebar: { open: true, width: 250 },
    theme: 'light'
  },
  data: {
    users: [
      { id: 1, name: 'John' },
      { id: 2, name: 'Jane' }
    ]
  }
});

effect(() => {
  console.log('Sidebar:', app.ui.sidebar.open);
});

app.ui.sidebar.open = false; // Triggers effect
app.data.users[0].name = 'Johnny'; // Triggers if tracked

// Array operations
const todos = store({
  items: [
    { id: 1, text: 'Buy milk', done: false },
    { id: 2, text: 'Walk dog', done: true }
  ]
});

todos.items.push({ id: 3, text: 'Code', done: false });
todos.items[0].done = true;
todos.items.splice(1, 1);

// Complex state management
const appState = store({
  auth: {
    user: null as { name: string; email: string } | null,
    token: null as string | null,
    loading: false
  },
  notifications: [] as Array<{ id: string; message: string }>,
  settings: {
    theme: 'light' as 'light' | 'dark',
    language: 'en'
  }
});

// Login action
appState.transaction(s => {
  s.auth.loading = true;
  s.auth.user = { name: 'John', email: 'john@example.com' };
  s.auth.token = 'abc123';
  s.auth.loading = false;
});

// Custom equality
const vectors = store(
  { points: [{ x: 0, y: 0 }] },
  {
    equals: (a, b) => {
      if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length &&
               a.every((v, i) => v.x === b[i].x && v.y === b[i].y);
      }
      return a === b;
    }
  }
);
```

**Notes:**
- All nested objects and arrays are automatically reactive
- Property access creates fine-grained dependencies
- Use `transaction()` for multiple related updates
- Shallow paths are useful for large non-reactive data (plugins, configs)
- Store uses Proxies - not compatible with some legacy browsers
- Better DX than managing multiple signals for complex state
- Arrays are fully reactive including methods (push, splice, etc.)

---

### selector()

Creates a memoized selector that only notifies when the selected value changes. Useful for derived state from stores.

**Signature:**
```typescript
function selector<T, R>(
  source: () => T,
  fn: (value: T) => R,
  options?: {
    equals?: false | ((prev: R, next: R) => boolean);
  }
): () => R;
```

**Parameters:**
- `source`: Function that returns the source value
- `fn`: Transform function
- `options.equals`: Custom equality check

**Returns:**
- Memoized getter function

**Examples:**

```typescript
const state = store({
  users: [
    { id: 1, name: 'John', active: true },
    { id: 2, name: 'Jane', active: false },
    { id: 3, name: 'Bob', active: true }
  ]
});

// Select active users
const activeUsers = selector(
  () => state.users,
  users => users.filter(u => u.active)
);

effect(() => {
  console.log('Active:', activeUsers());
});

// Only triggers when active users actually change
state.users[0].name = 'Johnny'; // No trigger (active status unchanged)
state.users[1].active = true;   // Triggers (active users changed)

// Multiple selectors
const userCount = selector(
  () => state.users,
  users => users.length
);

const activeCount = selector(
  () => activeUsers(),
  users => users.length
);

// With custom equality
const sortedIds = selector(
  () => state.users,
  users => users.map(u => u.id).sort(),
  {
    equals: (a, b) => {
      if (a.length !== b.length) return false;
      return a.every((v, i) => v === b[i]);
    }
  }
);
```

**Notes:**
- More efficient than computed for array transformations
- Only notifies when the selected value actually changes
- Uses referential equality by default
- Great for filtering, mapping, sorting derived data

---

## Resource API

### resource()

Creates a resource that loads data asynchronously. Resources track loading state, errors, and provide refetch capabilities.

**Signature:**
```typescript
function resource<T>(
  fetcher: () => Promise<T>,
  options?: ResourceOptions<T>
): Resource<T>;

function resource<S, T>(
  source: () => S,
  fetcher: (source: S, prev?: T) => Promise<T>,
  options?: ResourceOptions<T>
): Resource<T>;

interface Resource<T> {
  (): T | undefined;           // Current data
  loading(): boolean;          // Loading state
  error(): Error | undefined;  // Error state
  refetch(): Promise<void>;    // Manual refetch
  mutate(value: T | undefined): void; // Update data
}

interface ResourceOptions<T> {
  initialValue?: T;
  onError?: (error: Error) => void;
  equals?: (prev: T, next: T) => boolean;
}
```

**Parameters:**
- `source`: Optional reactive source to trigger refetch
- `fetcher`: Async function to fetch data
- `options.initialValue`: Initial value while loading
- `options.onError`: Error handler
- `options.equals`: Custom equality check

**Returns:**
- Resource object

**Examples:**

```typescript
// Basic resource
const user = resource(async () => {
  const res = await fetch('/api/user');
  return res.json();
});

effect(() => {
  if (user.loading()) {
    console.log('Loading...');
  } else if (user.error()) {
    console.log('Error:', user.error());
  } else {
    console.log('User:', user());
  }
});

// Resource with source (reactive refetch)
const userId = signal(1);
const userData = resource(
  () => userId(),
  async (id) => {
    const res = await fetch(`/api/users/${id}`);
    return res.json();
  }
);

userId.set(2); // Automatically refetches

// With initial value
const posts = resource(
  async () => {
    const res = await fetch('/api/posts');
    return res.json();
  },
  { initialValue: [] }
);

console.log(posts()); // [] (not undefined)

// Manual refetch
const data = resource(async () => fetchData());
await data.refetch(); // Force reload

// Error handling
const riskyData = resource(
  async () => {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  },
  {
    onError: (err) => {
      console.error('Resource error:', err);
    }
  }
);

// Multiple sources
const query = signal('react');
const page = signal(1);

const results = resource(
  () => ({ query: query(), page: page() }),
  async ({ query, page }) => {
    const res = await fetch(`/api/search?q=${query}&page=${page}`);
    return res.json();
  }
);

// Mutating resource data
const todos = resource(async () => fetchTodos());
// Optimistic update
todos.mutate([...todos()!, newTodo]);
await saveTodo(newTodo);
todos.refetch(); // Sync with server

// Conditional fetching
const enabled = signal(true);
const conditionalData = resource(
  () => enabled(),
  async (enabled) => {
    if (!enabled) return null;
    return await fetchData();
  }
);

// Dependent resources
const user = resource(async () => fetchUser());
const posts = resource(
  () => user()?.id,
  async (userId) => {
    if (!userId) return [];
    return await fetchUserPosts(userId);
  }
);
```

**Notes:**
- Resources automatically track loading/error states
- Source changes trigger automatic refetch
- Use `mutate()` for optimistic updates
- Errors don't throw - check `error()` state instead
- Loading state is `true` during initial and subsequent fetches
- Data is `undefined` until first successful load (unless `initialValue` provided)

---

## Async Computed

### asyncComputed()

Creates a computed value that can be asynchronous. Similar to `resource()` but with more control over refresh behavior and retry logic.

**Signature:**
```typescript
function asyncComputed<T>(
  fn: () => Promise<T>,
  options?: AsyncComputedOptions<T>
): AsyncComputed<T>;

interface AsyncComputed<T> {
  value(): T | undefined;      // Current value
  loading(): boolean;          // Loading state
  error(): Error | undefined;  // Error state
  refresh(): Promise<void>;    // Manual refresh
  retry(): Promise<void>;      // Retry after error
  dispose(): void;             // Cleanup
}

interface AsyncComputedOptions<T> {
  initial?: T;                 // Initial value
  debounce?: number;           // Debounce refresh (ms)
  throttle?: number;           // Throttle refresh (ms)
  retry?: boolean | number;    // Retry on error (true = 3, or specify count)
  retryDelay?: number;         // Delay between retries (ms)
  equals?: (prev: T, next: T) => boolean; // Custom equality
  onError?: (error: Error) => void; // Error handler
}
```

**Parameters:**
- `fn`: Async function to compute value
- `options`: Various configuration options

**Returns:**
- AsyncComputed object

**Examples:**

```typescript
// Basic async computed
const search = signal('');
const results = asyncComputed(
  async () => {
    const query = search();
    if (!query) return [];
    const res = await fetch(`/api/search?q=${query}`);
    return res.json();
  },
  { initial: [] }
);

effect(() => {
  if (results.loading()) {
    console.log('Searching...');
  } else {
    console.log('Results:', results.value());
  }
});

// With debounce
const debouncedSearch = asyncComputed(
  async () => {
    const query = search();
    return await searchAPI(query);
  },
  {
    initial: [],
    debounce: 300 // Wait 300ms after last change
  }
);

// With retry
const flakeyData = asyncComputed(
  async () => {
    const res = await fetch('/api/flakey');
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },
  {
    retry: true,        // Retry up to 3 times
    retryDelay: 1000,   // Wait 1s between retries
    onError: (err) => {
      console.error('All retries failed:', err);
    }
  }
);

// Manual refresh
const data = asyncComputed(async () => fetchData());
await data.refresh(); // Force refresh

// Retry after error
if (data.error()) {
  await data.retry();
}

// Throttling
const liveData = asyncComputed(
  async () => {
    const timestamp = Date.now();
    return await fetchLiveData(timestamp);
  },
  {
    throttle: 1000 // Max once per second
  }
);

// Complex dependencies
const userId = signal(1);
const filters = signal({ status: 'active', role: 'admin' });

const userData = asyncComputed(async () => {
  const id = userId();
  const f = filters();
  return await fetchUserData(id, f);
}, {
  debounce: 500,
  initial: { user: null, permissions: [] }
});

// Cleanup on dispose
const subscription = asyncComputed(async () => {
  const ws = new WebSocket('ws://example.com');
  return new Promise((resolve) => {
    ws.onmessage = (e) => resolve(e.data);
  });
});

// Later...
subscription.dispose(); // Clean up
```

**Notes:**
- Automatically tracks dependencies like `computed()`
- Debounce/throttle are useful for expensive operations
- Retry logic with exponential backoff available
- Use `refresh()` to force recomputation regardless of dependencies
- Use `dispose()` to clean up when no longer needed
- Errors are captured in `error()` state, not thrown

---

### asyncResource()

Similar to `asyncComputed()` but designed for data fetching with source-based refetching.

**Signature:**
```typescript
function asyncResource<S, T>(
  source: () => S,
  fetcher: (source: S, info: { value: T | undefined; refetching: boolean }) => Promise<T>,
  options?: AsyncResourceOptions<T>
): AsyncResource<T>;

interface AsyncResource<T> {
  (): T | undefined;           // Current value
  loading(): boolean;          // Loading state
  error(): Error | undefined;  // Error state
  refetch(): Promise<void>;    // Force refetch
}

interface AsyncResourceOptions<T> {
  initialValue?: T;
  equals?: (prev: T, next: T) => boolean;
  onError?: (error: Error) => void;
}
```

**Parameters:**
- `source`: Reactive source that triggers refetch
- `fetcher`: Async fetch function
- `options`: Configuration options

**Examples:**

```typescript
// Basic async resource
const userId = signal(1);
const user = asyncResource(
  () => userId(),
  async (id) => {
    const res = await fetch(`/api/users/${id}`);
    return res.json();
  }
);

// With previous value awareness
const page = signal(1);
const posts = asyncResource(
  () => page(),
  async (pageNum, { value, refetching }) => {
    if (refetching) {
      console.log('Refetching page', pageNum);
    }
    return await fetchPosts(pageNum);
  },
  { initialValue: [] }
);

// Multiple sources
const searchParams = signal({ q: '', category: 'all' });
const results = asyncResource(
  () => searchParams(),
  async (params) => {
    return await searchAPI(params);
  }
);
```

**Notes:**
- Similar to `resource()` but with more control
- Fetcher receives info about refetch state
- Useful for optimistic UI updates
- Automatically refetches when source changes

---

### asyncComputedGroup()

Groups multiple async computations together and provides aggregate loading/error states.

**Signature:**
```typescript
function asyncComputedGroup<T extends Record<string, AsyncComputed<any>>>(
  computations: T
): AsyncComputedGroup<T>;

interface AsyncComputedGroup<T> {
  values: { [K in keyof T]: ReturnType<T[K]['value']> };
  loading(): boolean;          // True if ANY loading
  allLoading(): boolean;       // True if ALL loading
  error(): Error | undefined;  // First error found
  errors(): Array<Error>;      // All errors
  refresh(): Promise<void>;    // Refresh all
  dispose(): void;             // Dispose all
}
```

**Examples:**

```typescript
const user = asyncComputed(async () => fetchUser());
const posts = asyncComputed(async () => fetchPosts());
const comments = asyncComputed(async () => fetchComments());

const data = asyncComputedGroup({
  user,
  posts,
  comments
});

effect(() => {
  if (data.loading()) {
    console.log('Loading some data...');
  }

  if (!data.loading()) {
    console.log('All loaded:', data.values);
  }

  const errs = data.errors();
  if (errs.length > 0) {
    console.log('Errors:', errs);
  }
});

// Refresh all at once
await data.refresh();

// Cleanup all
data.dispose();
```

**Notes:**
- Convenient for managing multiple async operations
- `loading()` is true if ANY computation is loading
- `allLoading()` is true only if ALL are loading
- `errors()` returns all errors from all computations

---

## Advanced Topics

### Diamond Dependencies

Diamond dependencies occur when multiple computations depend on the same signal, and a higher-level computation depends on those. Vibrancy handles this correctly.

**Example:**

```typescript
const count = signal(1);

// Both depend on count
const doubled = computed(() => count() * 2);
const tripled = computed(() => count() * 3);

// Depends on both doubled and tripled
const sum = computed(() => doubled() + tripled());

// Diamond: count -> doubled -> sum
//          count -> tripled -> sum

effect(() => {
  console.log('Sum:', sum());
});
// Logs once: "Sum: 5"

count.set(2);
// Logs once: "Sum: 10" (NOT twice!)
```

**How it works:**
- Vibrancy uses a dependency graph
- Updates propagate in topological order
- Each computation runs exactly once per update cycle
- No glitches or intermediate states

---

### Circular Dependencies

Circular dependencies occur when effects or computations depend on each other. By default, Vibrancy throws an error.

**Handling:**

```typescript
const a = signal(1);
const b = signal(2);

// This will throw an error:
/*
effect(() => {
  if (a() < 10) b.set(a() + 1);
});

effect(() => {
  if (b() < 10) a.set(b() + 1);
});
*/

// Use isOptional to allow:
effect(() => {
  if (a() < 10) b.set(a() + 1);
}, {
  isOptional: true,
  onCircularDependency: 'warn'
});

effect(() => {
  if (b() < 10) a.set(b() + 1);
}, {
  isOptional: true,
  onCircularDependency: 'warn'
});

// Or use untrack to break the cycle:
effect(() => {
  const current = untrack(() => a());
  if (current < 10) b.set(current + 1);
});
```

**Notes:**
- Circular dependencies usually indicate design issues
- Use `isOptional: true` with caution
- `onCircularDependency` can be `'skip'`, `'warn'`, or `'error'`
- Consider refactoring to avoid circles

---

### Memory Management

**Automatic Cleanup:**
```typescript
// Effects clean up automatically
const dispose = effect(() => {
  const timer = setInterval(() => {}, 1000);

  return () => clearInterval(timer);
});

// Manual cleanup
dispose();
```

**Roots for Scoped Cleanup:**
```typescript
const cleanup = createRoot(dispose => {
  // Many effects here
  effect(() => {});
  effect(() => {});
  effect(() => {});

  return dispose;
});

// Clean up all at once
cleanup();
```

**Avoid Memory Leaks:**
```typescript
// BAD - creates effects in a loop without cleanup
for (let i = 0; i < 1000; i++) {
  effect(() => console.log(count()));
}

// GOOD - use a root
const cleanups: Array<() => void> = [];
for (let i = 0; i < 1000; i++) {
  const dispose = createRoot(dispose => {
    effect(() => console.log(count()));
    return dispose;
  });
  cleanups.push(dispose);
}

// Later: cleanup all
cleanups.forEach(c => c());
```

---

### Performance Tips

**1. Use `peek()` for non-reactive reads:**
```typescript
effect(() => {
  const tracked = count();
  const untracked = other.peek(); // No dependency
  console.log(tracked, untracked);
});
```

**2. Batch updates:**
```typescript
batch(() => {
  signal1.set(1);
  signal2.set(2);
  signal3.set(3);
}); // One update
```

**3. Use stores for complex state:**
```typescript
// Instead of many signals
const firstName = signal('John');
const lastName = signal('Doe');
const age = signal(30);

// Use a store
const user = store({
  firstName: 'John',
  lastName: 'Doe',
  age: 30
});
```

**4. Memoize expensive computations:**
```typescript
const expensive = computed(() => {
  // Heavy computation
  return heavyCalculation(source());
});
```

**5. Use shallow for large non-reactive data:**
```typescript
const config = store(
  {
    settings: { /* reactive */ },
    largeDataset: [ /* thousands of items */ ]
  },
  { shallow: ['largeDataset'] }
);
```

---

## Type Definitions

### Core Types

```typescript
// Signal
interface Signal<T> {
  (): T;
  peek(): T;
  set(value: T | ((prev: T) => T)): void;
  update(fn: (prev: T) => T): void;
  mutate(fn: (value: T) => void): void;
  subscribe(fn: (value: T) => void): () => void;
}

interface SignalOptions<T> {
  equals?: false | ((prev: T, next: T) => boolean);
  name?: string;
}

// Computed
interface ComputedSignal<T> {
  (): T;
  peek(): T;
  subscribe(fn: (value: T) => void): () => void;
}

interface ComputedOptions<T> {
  equals?: false | ((prev: T, next: T) => boolean);
  name?: string;
}

// Effect
interface EffectOptions {
  defer?: boolean;
  scheduler?: (fn: () => void) => void;
  name?: string;
  isOptional?: boolean;
  onCircularDependency?: 'skip' | 'warn' | 'error';
}

// Owner
interface Owner {
  context?: Map<symbol, any>;
  owner?: Owner;
}
```

### Store Types

```typescript
// Store
type Store<T extends object> = T & {
  get(): T;
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  update(partial: Partial<T>): void;
  transaction(fn: (state: T) => void): void;
  subscribe(fn: (state: T) => void): () => void;
};

interface StoreOptions {
  shallow?: string[];
  lazy?: boolean;
  equals?: (a: any, b: any) => boolean;
}
```

### Resource Types

```typescript
// Resource
interface Resource<T> {
  (): T | undefined;
  loading(): boolean;
  error(): Error | undefined;
  refetch(): Promise<void>;
  mutate(value: T | undefined): void;
}

interface ResourceOptions<T> {
  initialValue?: T;
  onError?: (error: Error) => void;
  equals?: (prev: T, next: T) => boolean;
}

// AsyncComputed
interface AsyncComputed<T> {
  value(): T | undefined;
  loading(): boolean;
  error(): Error | undefined;
  refresh(): Promise<void>;
  retry(): Promise<void>;
  dispose(): void;
}

interface AsyncComputedOptions<T> {
  initial?: T;
  debounce?: number;
  throttle?: number;
  retry?: boolean | number;
  retryDelay?: number;
  equals?: (prev: T, next: T) => boolean;
  onError?: (error: Error) => void;
}

// AsyncResource
interface AsyncResource<T> {
  (): T | undefined;
  loading(): boolean;
  error(): Error | undefined;
  refetch(): Promise<void>;
}

interface AsyncResourceOptions<T> {
  initialValue?: T;
  equals?: (prev: T, next: T) => boolean;
  onError?: (error: Error) => void;
}
```

### Utility Types

```typescript
// Cleanup function
type CleanupFn = () => void;

// Effect function
type EffectFn<T = any> = (prev?: T) => T | CleanupFn | void;

// Fetcher function
type Fetcher<S, T> = (
  source: S,
  info: { value: T | undefined; refetching: boolean }
) => Promise<T>;

// Scheduler function
type Scheduler = (fn: () => void) => void;

// Equality function
type EqualsFn<T> = (prev: T, next: T) => boolean;
```

---

## Summary

Vibrancy provides a complete reactive system with:

1. **Primitives**: `signal()`, `computed()`, `effect()`
2. **Control Flow**: `batch()`, `untrack()`, `createRoot()`
3. **Lifecycle**: `onCleanup()`, `getOwner()`
4. **Complex State**: `store()`, `selector()`
5. **Async Data**: `resource()`, `asyncComputed()`
6. **Performance**: Fine-grained reactivity, minimal re-renders
7. **Type Safety**: Full TypeScript support

All APIs are designed to work together seamlessly, providing maximum performance and developer experience.

---

**Next Steps:**
- See [02-REACTIVITY.md](./02-REACTIVITY.md) for reactivity concepts
- See [10-STATE-MANAGEMENT.md](./10-STATE-MANAGEMENT.md) for state patterns
- See [37-COOKBOOK.md](./37-COOKBOOK.md) for practical examples
