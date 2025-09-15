# Vibrancy

High-performance, fine-grained reactive state management system.

[![npm version](https://img.shields.io/npm/v/vibrancy.svg)](https://www.npmjs.com/package/vibrancy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-green.svg)](package.json)

## Features

- 🚀 **Zero Dependencies** - Lightweight and standalone
- ⚡ **Fine-Grained Reactivity** - Only update what changes
- 💎 **Diamond Dependency Resolution** - Handles complex dependency graphs efficiently
- 🔄 **Batched Updates** - Automatic batching for optimal performance
- 🧹 **Automatic Cleanup** - Memory-safe with automatic resource disposal
- 📦 **Deep Reactive Stores** - Proxy-based reactivity for nested objects
- 🔍 **TypeScript First** - Full TypeScript support with excellent type inference
- 🎯 **Predictable** - Synchronous and glitch-free updates
- 🏎️ **High Performance** - Optimized with caching, pooling, and smart invalidation

## Installation

```bash
npm install vibrancy
# or
yarn add vibrancy
# or
pnpm add vibrancy
```

## Quick Start

```typescript
import { signal, computed, effect, batch } from '@omnitron-dev/vibra';

// Create reactive signals
const count = signal(0);
const multiplier = signal(2);

// Create computed values that auto-update
const doubled = computed(() => count() * 2);
const result = computed(() => count() * multiplier());

// Create side effects that run when dependencies change
effect(() => {
  console.log(`Count: ${count()}, Result: ${result()}`);
});

// Update signals
count.set(5); // Logs: Count: 5, Result: 10

// Batch updates for efficiency
batch(() => {
  count.set(10);
  multiplier.set(3);
}); // Logs once: Count: 10, Result: 30
```

## Core Concepts

### Signals

Signals are the basic reactive primitive. They hold a value and notify dependents when it changes.

```typescript
const value = signal(initialValue);

// Read the value
console.log(value()); // current value

// Update the value
value.set(newValue);

// Update with a function
value.update(prev => prev + 1);

// Subscribe to changes
const unsubscribe = value.subscribe(newValue => {
  console.log('Value changed:', newValue);
});

// Peek at value without tracking dependencies
const currentValue = value.peek();
```

### Computed

Computed values derive from other reactive values and update automatically.

```typescript
const computed = computed(() => signal1() + signal2());
```

### Effects

Effects run side effects when their dependencies change.

```typescript
const dispose = effect(() => {
  console.log('Value changed:', signal());
});

// Clean up when done
dispose();
```

### Stores

Stores provide reactive objects with nested reactivity.

```typescript
const store = store({
  user: { name: 'John', age: 30 },
  settings: { theme: 'dark' }
});

// Access nested properties reactively
effect(() => {
  console.log(`${store.user.name} uses ${store.settings.theme} theme`);
});

// Update nested values
store.user.name = 'Jane';
store.settings.theme = 'light';
```

### Resources

Resources handle async data fetching with loading states.

```typescript
const userId = signal(1);

const user = resource(async () => {
  const response = await fetch(`/api/user/${userId()}`);
  return response.json();
});

// Access loading state, error, and data
effect(() => {
  if (user.loading()) {
    console.log('Loading user...');
  } else if (user.error()) {
    console.log('Error:', user.error().message);
  } else {
    console.log('User:', user());
  }
});

// Change userId triggers automatic refetch
userId.set(2);
```

## API Reference

### Reactivity
- `signal<T>(value: T, options?: SignalOptions)` - Create a reactive signal
- `computed<T>(fn: () => T, options?: ComputedOptions)` - Create a computed value
- `effect(fn: () => void, options?: EffectOptions)` - Create a side effect
- `batch(fn: () => void)` - Batch multiple updates
- `untrack(fn: () => T)` - Read without tracking

### Stores
- `store<T>(initial: T, options?: StoreOptions)` - Create a reactive store
- `selector<T, R>(store: Store<T>, fn: (value: T) => R)` - Create a store selector
- `transaction<T>(fn: () => T)` - Batch store updates

### Resources
- `resource<T>(fetcher: () => Promise<T>, options?: ResourceOptions)` - Create an async resource
- `asyncComputed<T>(fn: () => Promise<T>, options?: AsyncComputedOptions)` - Create async computed values

### Context
- `getOwner()` - Get current reactive owner
- `onCleanup(fn: () => void)` - Register cleanup function

### Advanced Features
- `asyncComputed<T>(fn: () => Promise<T>)` - Async computed values
- `resolveDiamondDependencies()` - Handle diamond dependency patterns
- `StoreSubscriptionManager` - Manage store subscriptions
- `StoreMiddlewareManager` - Add middleware to stores

## Examples

### Todo List

```typescript
import { store, computed, effect } from '@omnitron-dev/vibra';

const todos = store({
  items: [],
  filter: 'all'
});

const activeTodos = computed(() => 
  todos.items.filter(todo => !todo.completed)
);

const visibleTodos = computed(() => {
  switch (todos.filter) {
    case 'active': return activeTodos();
    case 'completed': return todos.items.filter(todo => todo.completed);
    default: return todos.items;
  }
});

effect(() => {
  console.log(`You have ${activeTodos().length} active todos`);
});

// Add a todo
todos.items.push({ text: 'Learn Vibrancy', completed: false });
```

### Shopping Cart

```typescript
import { signal, computed, effect } from '@omnitron-dev/vibra';

const items = signal([
  { price: 10, quantity: 2 },
  { price: 5, quantity: 3 }
]);

const total = computed(() => 
  items().reduce((sum, item) => sum + item.price * item.quantity, 0)
);

effect(() => {
  console.log(`Total: $${total()}`);
});

// Update items
items.update(list => [...list, { price: 20, quantity: 1 }]);
```

## License

MIT