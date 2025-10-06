# 02. Reactivity System

> **Status**: Complete Specification
> **Last Updated**: 2025-10-06
> **Part of**: Vibrancy Frontend Framework Specification

---

## Table of Contents

1. [Overview](#overview)
2. [Philosophy](#philosophy)
3. [Core Primitives](#core-primitives)
   - [signal()](#signal)
   - [computed()](#computed)
   - [effect()](#effect)
4. [Dependency Tracking](#dependency-tracking)
5. [Batching & Performance](#batching--performance)
6. [Advanced Concepts](#advanced-concepts)
7. [Comparison with Other Frameworks](#comparison-with-other-frameworks)
8. [Best Practices](#best-practices)
9. [Examples](#examples)

---

## Overview

Vibrancy implements **fine-grained reactivity** - a reactive programming model where updates propagate directly to affected computations and DOM nodes without virtual DOM diffing or whole-component re-renders.

### What is Fine-Grained Reactivity?

Unlike React's VDOM or Vue's proxy-based reactivity, Vibrancy tracks dependencies at the **expression level**:

```typescript
// React - entire component re-runs on state change
function Counter() {
  const [count, setCount] = useState(0);
  console.log('Component rendered'); // Logs on EVERY update!
  return <div>Count: {count}</div>;
}

// Vibrancy - only the text node updates
const count = signal(0);
effect(() => {
  console.log('Effect ran'); // Logs ONCE on mount!
  textNode.data = `Count: ${count()}`;
});
```

### Key Benefits

- **Surgical Updates**: Only changed values trigger updates
- **Automatic Dependency Tracking**: No manual dependency arrays
- **Predictable Performance**: O(1) update complexity
- **No Virtual DOM**: Direct DOM manipulation
- **Tiny Runtime**: ~2KB gzipped for core reactivity

---

## Philosophy

### The Problem with Virtual DOM

Virtual DOM was revolutionary in 2013, but comes with inherent trade-offs:

**React's Approach (VDOM)**:
```typescript
function TodoList({ todos }) {
  const [filter, setFilter] = useState('all');

  // Entire component re-runs when filter changes
  const filtered = todos.filter(t =>
    filter === 'all' || t.status === filter
  );

  return (
    <>
      <FilterButtons filter={filter} setFilter={setFilter} />
      {filtered.map(todo => <TodoItem key={todo.id} todo={todo} />)}
    </>
  );
  // Virtual DOM diffing happens here:
  // 1. Create new virtual tree
  // 2. Compare with old tree
  // 3. Calculate minimal DOM updates
  // 4. Apply updates
}
```

**Problems**:
1. **Wasted Work**: Recreates entire component tree on every change
2. **Diffing Overhead**: O(n) comparison of virtual trees
3. **Memory Overhead**: Keeps entire virtual tree in memory
4. **Unpredictable Performance**: Depends on tree size
5. **Large Bundle**: ~45KB for React runtime

### The Vibrancy Approach: Fine-Grained Reactivity

Vibrancy tracks dependencies at the **granular level** - only expressions that read reactive values are re-executed:

```typescript
const todos = signal([...]);
const filter = signal('all');

// Computed automatically tracks both todos and filter
const filtered = computed(() =>
  todos().filter(t =>
    filter() === 'all' || t.status === filter()
  )
);

// Effect only re-runs when filtered changes
effect(() => {
  renderTodoList(filtered());
});
```

**How it works**:
1. `filtered()` reads `todos()` and `filter()` → automatically tracked
2. When `filter` changes → `filtered` is marked stale
3. When `filtered()` is read → recomputes only if stale
4. Effect re-runs with new value → updates DOM directly

**Benefits**:
- Setup runs **once**
- No component re-renders
- No VDOM diffing
- Direct DOM updates
- Automatic memoization

---

## Core Primitives

### signal()

A **signal** is a reactive container for a single value.

#### Creating Signals

```typescript
import { signal } from 'vibrancy';

// Primitive value
const count = signal(0);

// Object value
const user = signal({ name: 'Alice', age: 30 });

// Array value
const items = signal([1, 2, 3]);

// With type annotation
const message = signal<string | null>(null);
```

#### Reading Signals

Signals are **callable** - call them to read their value:

```typescript
const count = signal(0);

// Read value
console.log(count()); // 0

// In computed
const doubled = computed(() => count() * 2);

// In effect
effect(() => {
  console.log(`Count: ${count()}`);
});
```

**Why function calls?**
- **Automatic tracking**: Vibrancy knows which computations depend on this signal
- **Explicit**: You can see where reactive reads happen
- **Performance**: No proxy traps, direct property access

#### Writing Signals

Use `.set()` to update:

```typescript
const count = signal(0);

// Set value directly
count.set(1);
console.log(count()); // 1

// Set with updater function
count.set(prev => prev + 1);
console.log(count()); // 2
```

#### Updating Signals

Use `.update()` for cleaner updater syntax:

```typescript
const count = signal(0);

// Update with function
count.update(n => n + 1);
console.log(count()); // 1

// Equivalent to:
count.set(prev => prev + 1);
```

#### Mutating Objects/Arrays

Use `.mutate()` for in-place mutations:

```typescript
const user = signal({ name: 'Alice', age: 30 });

// Mutate in place
user.mutate(u => {
  u.age = 31; // Mutates directly
});

const items = signal([1, 2, 3]);

// Mutate array
items.mutate(arr => {
  arr.push(4);
});
```

**⚠️ Warning**: `.mutate()` bypasses equality checks and always triggers updates!

#### Peeking Without Tracking

Use `.peek()` to read without creating dependencies:

```typescript
const count = signal(0);

effect(() => {
  // This creates a dependency
  console.log(count());

  // This does NOT create a dependency
  console.log(count.peek());
});

count.set(1); // Effect runs (because of tracked read)
```

#### Subscribing to Changes

Use `.subscribe()` for imperative subscriptions:

```typescript
const count = signal(0);

const unsubscribe = count.subscribe(value => {
  console.log(`Count changed to ${value}`);
});

count.set(1); // Logs: "Count changed to 1"
count.set(2); // Logs: "Count changed to 2"

unsubscribe(); // Stop listening
count.set(3); // Doesn't log
```

#### Custom Equality

Customize when signals trigger updates:

```typescript
// Custom equality for objects
const point = signal(
  { x: 0, y: 0 },
  { equals: (a, b) => a.x === b.x && a.y === b.y }
);

point.set({ x: 1, y: 2 }); // Triggers update
point.set({ x: 1, y: 2 }); // Doesn't trigger (same value)
```

#### Complete Signal API

```typescript
const count = signal(0);

count();              // Read value (tracked)
count.peek();         // Read value (untracked)
count.set(5);         // Set value
count.update(n => n + 1);  // Update with function
count.mutate(val => {}); // Mutate in place (always triggers)
count.subscribe(fn);  // Subscribe to changes (returns unsubscribe)
```

---

### computed()

A **computed** is a derived value that automatically updates when its dependencies change.

#### Creating Computed Values

```typescript
import { signal, computed } from 'vibrancy';

const firstName = signal('John');
const lastName = signal('Doe');

// Computed automatically tracks dependencies
const fullName = computed(() => {
  return `${firstName()} ${lastName()}`;
});

console.log(fullName()); // "John Doe"

firstName.set('Jane');
console.log(fullName()); // "Jane Doe"
```

#### Computed is Lazy & Cached

Computeds only recalculate when:
1. **Dependencies change** AND
2. **Value is read**

```typescript
let computeCount = 0;

const count = signal(0);
const doubled = computed(() => {
  computeCount++;
  return count() * 2;
});

console.log(computeCount); // 0 (not computed yet!)

console.log(doubled()); // 0
console.log(computeCount); // 1 (computed on first read)

console.log(doubled()); // 0
console.log(computeCount); // 1 (still 1 - cached!)

count.set(5); // Marks computed as stale
console.log(computeCount); // 1 (still not recomputed)

console.log(doubled()); // 10
console.log(computeCount); // 2 (recomputed on read)
```

#### Chaining Computeds

```typescript
const celsius = signal(0);

const fahrenheit = computed(() =>
  (celsius() * 9/5) + 32
);

const kelvin = computed(() =>
  celsius() + 273.15
);

const displayTemp = computed(() =>
  `${celsius()}°C = ${fahrenheit()}°F = ${kelvin()}K`
);

console.log(displayTemp());
// "0°C = 32°F = 273.15K"

celsius.set(100);
console.log(displayTemp());
// "100°C = 212°F = 373.15K"
```

Vibrancy automatically resolves the dependency graph:
- `displayTemp` depends on `celsius`, `fahrenheit`, `kelvin`
- `fahrenheit` depends on `celsius`
- `kelvin` depends on `celsius`
- Changing `celsius` updates all three computeds in correct order

#### Diamond Dependencies

Vibrancy automatically handles diamond dependencies:

```typescript
const a = signal(1);
const b = computed(() => a() * 2);
const c = computed(() => a() * 3);
const d = computed(() => b() + c());

//     a
//    / \
//   b   c
//    \ /
//     d

a.set(2);
// Vibrancy ensures d is only recomputed ONCE
// even though it depends on both b and c,
// which both depend on a
```

#### Computed API

```typescript
const doubled = computed(() => count() * 2);

doubled();           // Read value (tracked)
doubled.peek();      // Read value (untracked)
doubled.subscribe(fn); // Subscribe to changes
```

**Note**: Computeds are **read-only**. You cannot set their value directly.

---

### effect()

An **effect** is a side effect that runs when its dependencies change.

#### Creating Effects

```typescript
import { signal, effect } from 'vibrancy';

const count = signal(0);

// Effect runs immediately and on every count change
effect(() => {
  console.log(`Count is ${count()}`);
});
// Logs: "Count is 0"

count.set(1);
// Logs: "Count is 1"

count.set(2);
// Logs: "Count is 2"
```

#### Effects vs Computed

| Feature | Effect | Computed |
|---------|--------|----------|
| Purpose | Side effects | Derived values |
| Returns | Cleanup function or void | Value |
| When runs | Immediately + on dependency change | Lazy (when read) |
| Can read | Yes (tracked) | Yes (tracked) |
| Can write | Yes | No |

#### Effect Cleanup

Effects can return a cleanup function:

```typescript
const url = signal('/api/users');

effect(() => {
  const controller = new AbortController();

  fetch(url(), { signal: controller.signal })
    .then(res => res.json())
    .then(data => console.log(data));

  // Cleanup runs before next effect run or on disposal
  return () => controller.abort();
});

url.set('/api/posts'); // Previous fetch is aborted
```

**Cleanup with `onCleanup`**:

```typescript
import { effect, onCleanup } from 'vibrancy';

effect(() => {
  const timer = setInterval(() => {
    console.log('tick');
  }, 1000);

  onCleanup(() => {
    clearInterval(timer);
  });
});
```

**When cleanup runs**:
1. Before effect re-runs
2. When effect is disposed
3. When root is disposed

#### Stopping Effects

Effects return a dispose function:

```typescript
const count = signal(0);

const dispose = effect(() => {
  console.log(count());
});

count.set(1); // Logs: 1
count.set(2); // Logs: 2

dispose(); // Stop effect

count.set(3); // Doesn't log
```

#### Defer Option

By default, effects run immediately. Use `defer: true` to skip initial run:

```typescript
const count = signal(0);

effect(() => {
  console.log(count());
}, { defer: true });
// Doesn't log initially

count.set(1);
// Logs: 1
```

---

## Dependency Tracking

### How Dependency Tracking Works

Vibrancy uses **automatic dependency tracking** - when you read a signal inside a computation, Vibrancy automatically creates a subscription.

#### The Tracking Context

```typescript
// When you call signal() inside effect/computed:
effect(() => {
  const value = count(); // 👈 Vibrancy tracks this read
  console.log(value);
});

// Internally, Vibrancy:
// 1. Marks effect as "current computation"
// 2. When count() is called, it sees there's a current computation
// 3. Adds effect to count's subscribers
// 4. Clears "current computation"
// 5. When count changes, notifies all subscribers (including effect)
```

#### Tracked vs Untracked Reads

```typescript
const count = signal(0);
const multiplier = signal(2);

effect(() => {
  // Tracked - effect depends on count
  const c = count();

  // Untracked - effect does NOT depend on multiplier
  const m = multiplier.peek();

  console.log(c * m);
});

count.set(5); // Effect runs (tracked)
multiplier.set(3); // Effect does NOT run (untracked)
```

#### Dynamic Dependency Tracking

Dependencies are recalculated on every run:

```typescript
const showDetails = signal(false);
const name = signal('Alice');
const age = signal(30);

effect(() => {
  console.log(name()); // Always depends on name

  if (showDetails()) {
    console.log(age()); // Only depends on age when showDetails is true
  }
});

// Initially:
// - Depends on: name, showDetails
// - Does NOT depend on: age

showDetails.set(true);
// Now depends on: name, showDetails, age

age.set(31); // Effect runs!

showDetails.set(false);
// Now depends on: name, showDetails
// No longer depends on: age

age.set(32); // Effect does NOT run
```

---

## Batching & Performance

### batch()

Batch multiple updates to trigger dependents only once:

```typescript
import { batch, signal, effect } from 'vibrancy';

const firstName = signal('John');
const lastName = signal('Doe');

let effectRuns = 0;

effect(() => {
  console.log(`${firstName()} ${lastName()}`);
  effectRuns++;
});
// Logs: "John Doe"
// effectRuns = 1

// Without batching - effect runs twice
firstName.set('Jane');
lastName.set('Smith');
// Logs: "Jane Doe"
// Logs: "Jane Smith"
// effectRuns = 3

// With batching - effect runs once
batch(() => {
  firstName.set('Alice');
  lastName.set('Johnson');
});
// Logs: "Alice Johnson"
// effectRuns = 4
```

**When to use batch**:
- Form submissions (updating multiple fields)
- API responses (updating many signals)
- Animations (updating positions/colors)
- Bulk operations

### untrack()

Read signals without creating dependencies:

```typescript
import { signal, effect, untrack } from 'vibrancy';

const count = signal(0);
const multiplier = signal(2);

effect(() => {
  // Tracked - creates dependency
  const c = count();

  // Untracked - NO dependency
  const m = untrack(() => multiplier());

  console.log(c * m);
});

count.set(5); // Effect runs
multiplier.set(3); // Effect does NOT run
```

**Use cases**:
- Reading config that shouldn't trigger updates
- Logging/debugging
- Breaking infinite loops

---

## Advanced Concepts

### Ownership & Disposal

#### createRoot()

Create a reactive scope with manual disposal:

```typescript
import { createRoot, signal, effect } from 'vibrancy';

const count = signal(0);

const dispose = createRoot((dispose) => {
  effect(() => console.log(count()));
  effect(() => console.log(count() * 2));

  return dispose; // Return dispose function
});

count.set(1);
// Logs: 1
// Logs: 2

dispose(); // Cleanup all effects in this root

count.set(2);
// Doesn't log (effects disposed)
```

#### onCleanup()

Register cleanup for current computation:

```typescript
import { effect, onCleanup } from 'vibrancy';

effect(() => {
  const timer = setInterval(() => console.log('tick'), 1000);

  onCleanup(() => {
    clearInterval(timer);
  });
});
```

#### getOwner()

Get current owner for advanced use cases:

```typescript
import { getOwner, createRoot } from 'vibrancy';

const owner = getOwner();

// Run computation under specific owner
createRoot(() => {
  // This computation belongs to the root
  effect(() => {
    console.log('Effect in root');
  });
});
```

### Store (Nested Reactivity)

For complex nested objects, use `store()`:

```typescript
import { store } from 'vibrancy';

const state = store({
  user: {
    name: 'Alice',
    age: 30
  },
  todos: [
    { id: 1, text: 'Learn Vibrancy', done: false },
    { id: 2, text: 'Build app', done: false }
  ]
});

// Granular reactivity - only subscribes to specific path
effect(() => {
  console.log(state.user.name); // Only reruns when name changes
});

// Update nested property
state.user.age = 31; // Effect doesn't run (only subscribed to name)

// Update subscribed property
state.user.name = 'Bob'; // Effect runs!

// Array mutations are tracked
state.todos.push({ id: 3, text: 'Deploy', done: false });
```

**Store vs Signal**:
- **Signal**: Single value, immutable updates
- **Store**: Nested object, granular subscriptions

### Circular Dependency Detection

Vibrancy automatically detects and recovers from circular dependencies:

```typescript
import { signal, computed } from 'vibrancy';

const a = signal(0);
const b = computed(() => c() + 1); // Depends on c
const c = computed(() => b() + 1); // Depends on b → CIRCULAR!

// Vibrancy detects the cycle and:
// 1. Logs warning
// 2. Returns default value (if provided)
// 3. Prevents infinite loop

// With default value:
const safe = computed(() => {
  // ...
}, {
  isOptional: true,
  defaultValue: 0
});
```

### Diamond Dependency Resolution

Vibrancy uses **topological sorting** to ensure correct update order:

```typescript
const a = signal(1);
const b = computed(() => a() * 2);
const c = computed(() => a() * 3);
const d = computed(() => b() + c());

//     a (1)
//    / \
//   b   c
//  (2) (3)
//    \ /
//     d (5)

a.set(2);

// Vibrancy ensures:
// 1. a updates to 2
// 2. b updates to 4 (waits for a)
// 3. c updates to 6 (waits for a)
// 4. d updates to 10 (waits for BOTH b and c)
//
// d is only recomputed ONCE, not twice!
```

### Resource (Async Data)

Handle async data with loading/error states:

```typescript
import { signal, resource } from 'vibrancy';

const userId = signal(1);

const user = resource(
  () => userId(), // Source signal
  async (id) => {  // Fetcher
    const res = await fetch(`/api/users/${id}`);
    return res.json();
  }
);

// Check states
if (user.loading) {
  console.log('Loading...');
} else if (user.error) {
  console.log('Error:', user.error);
} else {
  console.log('User:', user());
}

// Change source - triggers refetch
userId.set(2);
```

---

## Comparison with Other Frameworks

### React

| Aspect | React | Vibrancy |
|--------|-------|----------|
| **Paradigm** | Virtual DOM | Fine-grained Reactivity |
| **Updates** | Re-render component tree | Update specific subscriptions |
| **Tracking** | Manual (`useEffect` deps) | Automatic |
| **Performance** | O(n) diffing | O(1) updates |
| **Bundle** | ~45KB | ~2KB |
| **Memoization** | `useMemo`, `useCallback` | Automatic |

**Example - Derived State**:

```typescript
// React - Manual dependencies
const fullName = useMemo(() => {
  return `${firstName} ${lastName}`;
}, [firstName, lastName]); // Easy to forget!

// Vibrancy - Automatic
const fullName = computed(() =>
  `${firstName()} ${lastName()}`
);
```

### Vue 3

| Aspect | Vue 3 | Vibrancy |
|--------|-------|----------|
| **Reactivity** | Proxy-based | Signal-based |
| **Overhead** | Proxy traps | Direct calls |
| **Mental Model** | "Magic" | Explicit |
| **Debugging** | Proxy stack traces | Clear traces |
| **Bundle** | ~16KB | ~2KB |

**Example - Reactivity**:

```typescript
// Vue - Proxy magic
const count = ref(0);
count.value++; // Proxy intercepts

// Vibrancy - Explicit
const count = signal(0);
count.set(count() + 1); // Clear function call
```

### SolidJS

| Aspect | SolidJS | Vibrancy |
|--------|---------|----------|
| **Reactivity** | Signals | Signals |
| **API** | Very similar | Nearly identical |
| **Philosophy** | React-like syntax | Backend integration |

Vibrancy is heavily inspired by SolidJS. Key differences:
- Vibrancy integrates with Titan backend
- Vibrancy has different compilation strategy
- SolidJS has larger ecosystem

### Svelte

| Aspect | Svelte | Vibrancy |
|--------|--------|----------|
| **Compilation** | Compile-time | Runtime + AOT |
| **Updates** | Fine-grained | Fine-grained |
| **Debugging** | Harder (compiled away) | Easier (runtime) |

Both use fine-grained reactivity. Differences:
- **Svelte**: More compile-time magic
- **Vibrancy**: More runtime flexibility

---

## Best Practices

### 1. Prefer Computed for Derived State

```typescript
// ❌ Bad - Manual synchronization
const count = signal(0);
const doubled = signal(0);

const increment = () => {
  count.set(count() + 1);
  doubled.set(count() * 2); // Easy to forget!
};

// ✅ Good - Automatic synchronization
const count = signal(0);
const doubled = computed(() => count() * 2);

const increment = () => {
  count.set(count() + 1);
};
```

### 2. Use batch() for Multiple Updates

```typescript
// ❌ Bad - Triggers effect 3 times
setFirstName('Alice');
setLastName('Johnson');
setAge(30);

// ✅ Good - Triggers effect once
batch(() => {
  setFirstName('Alice');
  setLastName('Johnson');
  setAge(30);
});
```

### 3. Cleanup Effects Properly

```typescript
// ❌ Bad - Memory leak
effect(() => {
  window.addEventListener('resize', handler);
});

// ✅ Good - Cleanup
effect(() => {
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
});
```

### 4. Avoid Infinite Loops

```typescript
// ❌ Bad - Infinite loop!
const count = signal(0);
effect(() => {
  count.set(count() + 1); // Triggers itself!
});

// ✅ Good - Use untrack or event handlers
effect(() => {
  const current = untrack(() => count());
  if (current < 10) {
    count.set(current + 1);
  }
});
```

### 5. Use peek() for Logging

```typescript
// ❌ Bad - Creates unnecessary dependency
effect(() => {
  console.log('Count changed to', count()); // Runs on every count change
  doSomethingExpensive();
});

// ✅ Good - Peek for logging only
effect(() => {
  doSomethingExpensive();
  console.log('After expensive operation, count is', count.peek());
});
```

---

## Examples

### Counter

```typescript
import { signal, effect } from 'vibrancy';

const count = signal(0);

// Bind to DOM
const counterEl = document.getElementById('counter');
effect(() => {
  counterEl.textContent = `Count: ${count()}`;
});

// Button handlers
document.getElementById('increment').onclick = () => {
  count.update(n => n + 1);
};

document.getElementById('decrement').onclick = () => {
  count.update(n => n - 1);
};
```

### Todo List with Store

```typescript
import { store, computed } from 'vibrancy';

const state = store({
  todos: [],
  filter: 'all'
});

const filteredTodos = computed(() => {
  const { todos, filter } = state;
  if (filter === 'all') return todos;
  return todos.filter(t => t.status === filter);
});

// Add todo
function addTodo(text) {
  state.todos.push({
    id: Date.now(),
    text,
    done: false
  });
}

// Toggle todo
function toggleTodo(id) {
  const todo = state.todos.find(t => t.id === id);
  if (todo) {
    todo.done = !todo.done;
  }
}
```

### Form Validation

```typescript
import { signal, computed } from 'vibrancy';

const email = signal('');
const password = signal('');

const emailError = computed(() => {
  if (!email()) return 'Email is required';
  if (!email().includes('@')) return 'Invalid email';
  return null;
});

const passwordError = computed(() => {
  if (!password()) return 'Password is required';
  if (password().length < 8) return 'Min 8 characters';
  return null;
});

const isValid = computed(() =>
  !emailError() && !passwordError()
);

// Bind to form
effect(() => {
  submitButton.disabled = !isValid();
});
```

### Async Data Fetching

```typescript
import { signal, resource } from 'vibrancy';

const userId = signal(1);

const user = resource(
  () => userId(),
  async (id) => {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  }
);

// Render
effect(() => {
  if (user.loading) {
    userEl.innerHTML = '<p>Loading...</p>';
  } else if (user.error) {
    userEl.innerHTML = `<p>Error: ${user.error.message}</p>`;
  } else {
    userEl.innerHTML = `
      <h2>${user().name}</h2>
      <p>${user().email}</p>
    `;
  }
});
```

### Complex Dependency Graph

```typescript
import { signal, computed } from 'vibrancy';

// Celsius temperature
const celsius = signal(0);

// Derived temperatures
const fahrenheit = computed(() =>
  (celsius() * 9/5) + 32
);

const kelvin = computed(() =>
  celsius() + 273.15
);

// Status indicator
const status = computed(() => {
  const c = celsius();
  if (c < 0) return 'Freezing';
  if (c < 20) return 'Cold';
  if (c < 30) return 'Comfortable';
  return 'Hot';
});

// Display string
const display = computed(() =>
  `${celsius()}°C = ${fahrenheit()}°F = ${kelvin()}K (${status()})`
);

celsius.set(25);
console.log(display());
// "25°C = 77°F = 298.15K (Comfortable)"
```

---

**End of Reactivity Specification**
