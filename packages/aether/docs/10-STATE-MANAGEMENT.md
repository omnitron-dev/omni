# 10. State Management

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Local vs Global State](#local-vs-global-state)
- [Store Basics](#store-basics)
- [Creating Stores](#creating-stores)
- [Store Patterns](#store-patterns)
- [Persistence](#persistence)
- [Synchronization](#synchronization)
- [Integration with DI](#integration-with-di)
- [Integration with Resources](#integration-with-resources)
- [DevTools](#devtools)
- [Performance](#performance)
- [Best Practices](#best-practices)
- [Comparisons](#comparisons)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Aether provides a **fine-grained, signal-based state management system** that scales from simple local component state to complex global application state. Built on the same reactivity primitives as the rest of the framework, state management in Aether is:

- **Type-safe**: Full TypeScript support with inference
- **Fine-grained**: Surgical updates without unnecessary re-renders
- **Simple**: No boilerplate, no actions/reducers required
- **Flexible**: Multiple patterns for different needs
- **Persistent**: First-class persistence support
- **Synchronized**: Cross-tab/window synchronization
- **DevTools-friendly**: Time-travel debugging and inspection
- **DI-integrated**: Works seamlessly with dependency injection

### Key Concepts

```typescript
import { createStore, defineStore } from 'nexus/state';

// Simple store
const [state, setState] = createStore({
  count: 0,
  user: null
});

// Increment count
setState('count', c => c + 1);

// Set user
setState('user', { name: 'Alice', age: 30 });

// Use in component
const count = () => state.count;
return () => <div>{count()}</div>;
```

## Philosophy

### Simplicity Over Ceremony

Unlike Redux or MobX, Aether state management has **no boilerplate**:

```typescript
// ❌ Redux-style (verbose)
const INCREMENT = 'INCREMENT';
const increment = () => ({ type: INCREMENT });
const counterReducer = (state = 0, action) => {
  switch (action.type) {
    case INCREMENT: return state + 1;
    default: return state;
  }
};
const store = createStore(counterReducer);
store.dispatch(increment());

// ✅ Aether-style (simple)
const count = signal(0);
count.set(c => c + 1);
```

### Local State by Default

**Start with local state**, move to global only when needed:

```typescript
// Local state (component-scoped)
export default defineComponent(() => {
  const count = signal(0);

  return () => <button onClick={() => count.set(c => c + 1)}>{count()}</button>;
});

// Global state (when sharing is needed)
const counterStore = createStore({ count: 0 });

export default defineComponent(() => {
  return () => (
    <button onClick={() => counterStore.count++}>
      {counterStore.count}
    </button>
  );
});
```

### Fine-Grained Reactivity

**Only components that access changed properties re-render**:

```typescript
const [state] = createStore({
  user: { name: 'Alice', age: 30 },
  posts: []
});

// Component A - only re-renders when user.name changes
const ComponentA = () => <div>{state.user.name}</div>;

// Component B - only re-renders when posts changes
const ComponentB = () => <div>{state.posts.length} posts</div>;

// Changing user.age won't re-render either component
state.user.age = 31;

// Only ComponentA re-renders
state.user.name = 'Bob';

// Only ComponentB re-renders
state.posts.push({ title: 'New Post' });
```

### Predictable Updates

State updates are **synchronous and immediate**:

```typescript
const [state, setState] = createStore({ count: 0 });

console.log(state.count); // 0
setState('count', 1);
console.log(state.count); // 1 (immediate)
```

This makes debugging easier and behavior predictable.

## Local vs Global State

### When to Use Local State

Use **local state** when:
- State is only needed by one component
- State doesn't need to persist
- State is transient (form inputs, UI toggles)

```typescript
export default defineComponent(() => {
  // Local state
  const isOpen = signal(false);
  const inputValue = signal('');

  return () => (
    <div>
      <button onClick={() => isOpen.set(!isOpen())}>Toggle</button>
      {#if isOpen()}
        <input
          value={inputValue()}
          onInput={e => inputValue.set(e.target.value)}
        />
      {/if}
    </div>
  );
});
```

### When to Use Global State

Use **global state** when:
- State is shared across multiple components
- State needs to persist across navigation
- State represents application-level concerns

```typescript
// stores/auth.store.ts
export const [authState, setAuthState] = createStore({
  user: null as User | null,
  isAuthenticated: false,
  token: null as string | null
});

export const login = async (credentials: Credentials) => {
  const { user, token } = await api.login(credentials);
  setAuthState({
    user,
    token,
    isAuthenticated: true
  });
};

export const logout = () => {
  setAuthState({
    user: null,
    token: null,
    isAuthenticated: false
  });
};

// Usage in any component
import { authState, logout } from '@/stores/auth.store';

export default defineComponent(() => {
  return () => (
    <div>
      {#if authState.isAuthenticated}
        <p>Welcome, {authState.user?.name}</p>
        <button onClick={logout}>Logout</button>
      {:else}
        <LoginForm />
      {/if}
    </div>
  );
});
```

### Context for Scoped State

Use **Context** when state is scoped to a component tree:

```typescript
// Good for theme, i18n, feature flags within a section
const ThemeContext = createContext<ThemeStore>();

export const ThemeProvider = defineComponent((props: { children: any }) => {
  const theme = createStore({ mode: 'light', primaryColor: '#007bff' });

  return () => (
    <ThemeContext.Provider value={theme}>
      {props.children}
    </ThemeContext.Provider>
  );
});

// Usage
const theme = useContext(ThemeContext);
return () => <div class={theme.mode}>{/* ... */}</div>;
```

## Store Basics

### Creating a Store

```typescript
import { createStore } from 'nexus/state';

// Simple store
const [state, setState] = createStore({
  count: 0,
  name: 'Alice'
});

// Nested store
const [state, setState] = createStore({
  user: {
    name: 'Alice',
    profile: {
      age: 30,
      email: 'alice@example.com'
    }
  },
  settings: {
    theme: 'light',
    notifications: true
  }
});
```

### Reading State

State is accessed like a **regular object**:

```typescript
const [state] = createStore({ count: 0, user: { name: 'Alice' } });

// Direct access
console.log(state.count); // 0
console.log(state.user.name); // 'Alice'

// In computed
const doubled = computed(() => state.count * 2);

// In effects
effect(() => {
  console.log('Count changed:', state.count);
});

// In components
return () => <div>Count: {state.count}</div>;
```

### Updating State

Multiple ways to update state:

```typescript
const [state, setState] = createStore({
  count: 0,
  user: { name: 'Alice', age: 30 }
});

// 1. Direct mutation (recommended for simple cases)
state.count++;
state.user.name = 'Bob';

// 2. setState with path
setState('count', c => c + 1);
setState('user', 'name', 'Bob');

// 3. setState with object
setState({
  count: state.count + 1,
  user: { ...state.user, name: 'Bob' }
});

// 4. produce (immer-like)
import { produce } from 'nexus/state';

setState(produce(draft => {
  draft.count++;
  draft.user.name = 'Bob';
}));
```

### Immutability

Stores support both **mutable** and **immutable** patterns:

```typescript
// Mutable (default)
const [state] = createStore({ items: [1, 2, 3] });
state.items.push(4); // ✅ Tracked automatically

// Immutable (explicit)
const [state, setState] = createStore({ items: [1, 2, 3] });
setState('items', [...state.items, 4]); // ✅ Also works
```

Both patterns work because Aether tracks **property access**, not object identity.

## Creating Stores

### createStore

The **foundational API** for creating reactive stores:

```typescript
import { createStore } from 'nexus/state';

interface State {
  count: number;
  user: User | null;
}

const [state, setState] = createStore<State>({
  count: 0,
  user: null
});

// Type-safe updates
setState('count', 1); // ✅
setState('count', '1'); // ❌ Type error

// Nested updates
setState('user', { name: 'Alice', age: 30 });
setState('user', 'name', 'Bob');
```

**Options**:

```typescript
const [state, setState] = createStore(
  { count: 0 },
  {
    // Store name for DevTools
    name: 'counter',

    // Enable persistence
    persist: {
      key: 'counter-store',
      storage: localStorage
    },

    // Enable synchronization across tabs
    sync: true
  }
);
```

### defineStore

**Higher-level API** for creating named stores with methods:

```typescript
import { defineStore } from 'nexus/state';

export const useCounterStore = defineStore('counter', () => {
  const [state, setState] = createStore({
    count: 0,
    history: [] as number[]
  });

  const increment = () => {
    setState('count', c => c + 1);
    setState('history', h => [...h, state.count]);
  };

  const decrement = () => {
    setState('count', c => c - 1);
    setState('history', h => [...h, state.count]);
  };

  const reset = () => {
    setState({ count: 0, history: [] });
  };

  // Computed
  const doubled = computed(() => state.count * 2);

  return {
    // State
    state,

    // Computed
    doubled,

    // Actions
    increment,
    decrement,
    reset
  };
});

// Usage
const counter = useCounterStore();

counter.increment();
console.log(counter.state.count); // 1
console.log(counter.doubled()); // 2
```

**With options**:

```typescript
export const useAuthStore = defineStore('auth', () => {
  const [state, setState] = createStore({
    user: null as User | null,
    token: null as string | null
  });

  const login = async (credentials: Credentials) => {
    const { user, token } = await api.login(credentials);
    setState({ user, token });
  };

  const logout = () => {
    setState({ user: null, token: null });
  };

  return { state, login, logout };
}, {
  persist: {
    key: 'auth',
    storage: localStorage,
    paths: ['token'] // Only persist token
  }
});
```

### Singleton vs Instance Stores

**Singleton** (default): One instance shared across the application

```typescript
// stores/counter.ts
export const useCounterStore = defineStore('counter', () => {
  const [state, setState] = createStore({ count: 0 });
  return { state, increment: () => state.count++ };
});

// ComponentA.tsx
const counter = useCounterStore();
counter.increment(); // count = 1

// ComponentB.tsx
const counter = useCounterStore(); // Same instance
console.log(counter.state.count); // 1
```

**Instance**: New instance for each call (use Context to share)

```typescript
// stores/form.ts
export const createFormStore = () => {
  const [state, setState] = createStore({
    values: {},
    errors: {}
  });

  return { state, /* ... */ };
};

// Usage with Context
const FormContext = createContext<ReturnType<typeof createFormStore>>();

export const FormProvider = defineComponent((props) => {
  const form = createFormStore();

  return () => (
    <FormContext.Provider value={form}>
      {props.children}
    </FormContext.Provider>
  );
});
```

## Store Patterns

### Module Pattern

Encapsulate state and logic in a module:

```typescript
// stores/todos.store.ts
import { createStore } from 'nexus/state';

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

const [state, setState] = createStore({
  todos: [] as Todo[],
  filter: 'all' as 'all' | 'active' | 'completed'
});

export const todosStore = {
  // State
  get todos() { return state.todos; },
  get filter() { return state.filter; },

  // Computed
  filteredTodos: computed(() => {
    switch (state.filter) {
      case 'active': return state.todos.filter(t => !t.done);
      case 'completed': return state.todos.filter(t => t.done);
      default: return state.todos;
    }
  }),

  // Actions
  addTodo(text: string) {
    setState('todos', todos => [
      ...todos,
      { id: crypto.randomUUID(), text, done: false }
    ]);
  },

  toggleTodo(id: string) {
    setState('todos', todos =>
      todos.map(t => t.id === id ? { ...t, done: !t.done } : t)
    );
  },

  removeTodo(id: string) {
    setState('todos', todos => todos.filter(t => t.id !== id));
  },

  filter.set(filter: typeof state.filter) {
    setState('filter', filter);
  }
};

// Usage
import { todosStore } from '@/stores/todos.store';

todosStore.addTodo('Buy milk');
console.log(todosStore.filteredTodos());
```

### Class Pattern

Use classes for complex stores:

```typescript
import { createStore, computed } from 'nexus/state';

class TodoStore {
  private [state, setState] = createStore({
    todos: [] as Todo[],
    filter: 'all' as 'all' | 'active' | 'completed'
  });

  get todos() { return this.state.todos; }
  get filter() { return this.state.filter; }

  filteredTodos = computed(() => {
    switch (this.state.filter) {
      case 'active': return this.state.todos.filter(t => !t.done);
      case 'completed': return this.state.todos.filter(t => t.done);
      default: return this.state.todos;
    }
  });

  addTodo(text: string) {
    this.setState('todos', todos => [
      ...todos,
      { id: crypto.randomUUID(), text, done: false }
    ]);
  }

  toggleTodo(id: string) {
    this.setState('todos', todos =>
      todos.map(t => t.id === id ? { ...t, done: !t.done } : t)
    );
  }
}

// Export singleton instance
export const todoStore = new TodoStore();

// Or use with DI
@Injectable()
export class TodoService {
  private store = new TodoStore();

  getTodos() { return this.store.todos; }
  addTodo(text: string) { this.store.addTodo(text); }
}
```

### Slice Pattern

Split large stores into smaller slices:

```typescript
// stores/app.store.ts
import { createStore } from 'nexus/state';

// User slice
const createUserSlice = () => {
  const [state, setState] = createStore({
    user: null as User | null,
    isAuthenticated: false
  });

  return {
    state,
    login(user: User) {
      setState({ user, isAuthenticated: true });
    },
    logout() {
      setState({ user: null, isAuthenticated: false });
    }
  };
};

// Settings slice
const createSettingsSlice = () => {
  const [state, setState] = createStore({
    theme: 'light' as 'light' | 'dark',
    language: 'en'
  });

  return {
    state,
    theme.set(theme: typeof state.theme) {
      setState('theme', theme);
    },
    setLanguage(language: string) {
      setState('language', language);
    }
  };
};

// Combine slices
export const useAppStore = defineStore('app', () => {
  const user = createUserSlice();
  const settings = createSettingsSlice();

  return {
    user,
    settings
  };
});

// Usage
const app = useAppStore();
app.user.login({ name: 'Alice' });
app.settings.theme.set('dark');
```

### Async Actions

Handle async operations in actions:

```typescript
export const useProductStore = defineStore('products', () => {
  const [state, setState] = createStore({
    products: [] as Product[],
    loading: false,
    error: null as Error | null
  });

  const fetchProducts = async () => {
    setState({ loading: true, error: null });

    try {
      const products = await api.fetchProducts();
      setState({ products, loading: false });
    } catch (error) {
      setState({ error: error as Error, loading: false });
    }
  };

  const createProduct = async (data: ProductInput) => {
    try {
      const product = await api.createProduct(data);
      setState('products', products => [...products, product]);
      return product;
    } catch (error) {
      setState('error', error as Error);
      throw error;
    }
  };

  return {
    state,
    fetchProducts,
    createProduct
  };
});

// Usage
const products = useProductStore();

onMount(async () => {
  await products.fetchProducts();
});

const handleCreate = async (data: ProductInput) => {
  try {
    await products.createProduct(data);
    toast.success('Product created');
  } catch (error) {
    toast.error('Failed to create product');
  }
};
```

## Persistence

### Local Storage

Persist state to localStorage:

```typescript
import { createStore } from 'nexus/state';

const [state, setState] = createStore(
  { theme: 'light', language: 'en' },
  {
    persist: {
      key: 'app-settings',
      storage: localStorage
    }
  }
);

// State is automatically loaded from localStorage on init
// State is automatically saved to localStorage on change
```

### Session Storage

Use sessionStorage for session-only persistence:

```typescript
const [state, setState] = createStore(
  { tempData: null },
  {
    persist: {
      key: 'temp-data',
      storage: sessionStorage
    }
  }
);
```

### Custom Storage

Implement custom storage backend:

```typescript
import { StorageAdapter } from 'nexus/state';

class CookieStorage implements StorageAdapter {
  getItem(key: string): string | null {
    const match = document.cookie.match(new RegExp(`${key}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  setItem(key: string, value: string): void {
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000`;
  }

  removeItem(key: string): void {
    document.cookie = `${key}=; path=/; max-age=0`;
  }
}

const [state] = createStore(
  { userId: null },
  {
    persist: {
      key: 'user-id',
      storage: new CookieStorage()
    }
  }
);
```

### Partial Persistence

Persist only specific paths:

```typescript
const [state] = createStore(
  {
    user: { name: 'Alice', sessionId: 'abc123' },
    theme: 'light',
    tempData: null
  },
  {
    persist: {
      key: 'app-state',
      storage: localStorage,
      paths: ['user.name', 'theme'] // Only persist these
    }
  }
);

// user.name and theme are persisted
// user.sessionId and tempData are NOT persisted
```

### Serialization

Custom serialization/deserialization:

```typescript
const [state] = createStore(
  { user: null as User | null },
  {
    persist: {
      key: 'user',
      storage: localStorage,
      serializer: {
        serialize: (value) => JSON.stringify(value),
        deserialize: (str) => JSON.parse(str)
      }
    }
  }
);
```

### Versioning

Handle schema migrations:

```typescript
const [state] = createStore(
  { count: 0, newField: 'new' },
  {
    persist: {
      key: 'counter',
      storage: localStorage,
      version: 2,
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          // Migrate from v1 to v2
          return {
            ...persisted,
            newField: 'default'
          };
        }
        return persisted;
      }
    }
  }
);
```

### Encryption

Encrypt sensitive data:

```typescript
import { encrypt, decrypt } from '@/lib/crypto';

const [state] = createStore(
  { apiKey: null as string | null },
  {
    persist: {
      key: 'api-key',
      storage: localStorage,
      serializer: {
        serialize: (value) => encrypt(JSON.stringify(value)),
        deserialize: (encrypted) => JSON.parse(decrypt(encrypted))
      }
    }
  }
);
```

## Synchronization

### Cross-Tab Sync

Synchronize state across browser tabs:

```typescript
const [state] = createStore(
  { count: 0 },
  {
    persist: {
      key: 'counter',
      storage: localStorage
    },
    sync: true // Enable cross-tab sync
  }
);

// Changes in one tab are reflected in other tabs
state.count++; // All tabs see the update
```

**How it works**:
- Uses `storage` events to detect changes in other tabs
- Automatically updates local state when remote changes occur
- Conflicts are resolved using last-write-wins

### Manual Sync

Manually sync state:

```typescript
import { syncStore } from 'nexus/state';

const [state, setState] = createStore({ count: 0 });

// Subscribe to storage events
const unsubscribe = syncStore(state, {
  key: 'counter',
  storage: localStorage,
  onSync: (newState) => {
    console.log('Synced from another tab:', newState);
  }
});

// Stop syncing
unsubscribe();
```

### Broadcast Channel

Use BroadcastChannel for faster sync:

```typescript
const [state] = createStore(
  { notifications: [] },
  {
    sync: {
      channel: 'app-sync', // BroadcastChannel name
      debounce: 100 // Debounce updates
    }
  }
);
```

### Selective Sync

Sync only specific paths:

```typescript
const [state] = createStore(
  {
    user: { name: 'Alice' },
    ui: { sidebar: true }
  },
  {
    sync: {
      paths: ['user'] // Only sync user, not UI state
    }
  }
);
```

## Integration with DI

### Injectable Stores

Use stores as injectable services:

```typescript
// stores/auth.store.ts
import { Injectable } from 'nexus/di';
import { createStore } from 'nexus/state';

@Injectable()
export class AuthStore {
  private [state, setState] = createStore({
    user: null as User | null,
    token: null as string | null
  });

  get user() { return this.state.user; }
  get isAuthenticated() { return !!this.state.token; }

  async login(credentials: Credentials) {
    const { user, token } = await api.login(credentials);
    this.setState({ user, token });
  }

  logout() {
    this.setState({ user: null, token: null });
  }
}

// Usage in component
import { inject } from 'nexus/di';
import { AuthStore } from '@/stores/auth.store';

export default defineComponent(() => {
  const auth = inject(AuthStore);

  return () => (
    <div>
      {#if auth.isAuthenticated}
        <p>Welcome, {auth.user?.name}</p>
      {/if}
    </div>
  );
});
```

### Store Providers

Provide stores through DI:

```typescript
// app.module.ts
import { defineModule } from 'nexus/di';
import { AuthStore } from '@/stores/auth.store';
import { TodoStore } from '@/stores/todo.store';

export const AppModule = defineModule({
  providers: [
    AuthStore,
    TodoStore
  ]
});
```

### Scoped Stores

Create request-scoped stores:

```typescript
@Injectable({ scope: 'request' })
export class RequestStore {
  private [state, setState] = createStore({
    id: crypto.randomUUID(),
    startTime: Date.now()
  });

  get requestId() { return this.state.id; }
  get duration() { return Date.now() - this.state.startTime; }
}

// Each request gets a new instance
```

## Integration with Resources

### Store + Resource Pattern

Combine stores with resources:

```typescript
export const useProductStore = defineStore('products', () => {
  const [state, setState] = createStore({
    selectedId: null as string | null
  });

  // Resource fetches data
  const [products] = resource(() => api.fetchProducts());

  // Computed from resource + store
  const selectedProduct = computed(() => {
    const id = state.selectedId;
    const list = products();
    return list?.find(p => p.id === id);
  });

  const selectProduct = (id: string) => {
    setState('selectedId', id);
  };

  return {
    state,
    products,
    selectedProduct,
    selectProduct
  };
});
```

### Caching Resource Results

Cache resource results in store:

```typescript
export const useUserStore = defineStore('users', () => {
  const [state, setState] = createStore({
    cache: new Map<string, User>()
  });

  const fetchUser = async (id: string) => {
    // Check cache first
    if (state.cache.has(id)) {
      return state.cache.get(id)!;
    }

    // Fetch if not cached
    const user = await api.fetchUser(id);

    // Update cache
    setState('cache', cache => new Map(cache).set(id, user));

    return user;
  };

  return { fetchUser };
});
```

### Optimistic Updates

Combine with optimistic updates:

```typescript
export const useTodoStore = defineStore('todos', () => {
  const [state, setState] = createStore({
    todos: [] as Todo[]
  });

  const [, { mutate }] = resource(
    () => api.fetchTodos(),
    { initialValue: [] }
  );

  const addTodo = async (text: string) => {
    const temp: Todo = {
      id: crypto.randomUUID(),
      text,
      done: false
    };

    // Optimistic update
    setState('todos', todos => [...todos, temp]);

    try {
      const todo = await api.createTodo({ text });

      // Replace temp with real
      setState('todos', todos =>
        todos.map(t => t.id === temp.id ? todo : t)
      );
    } catch (error) {
      // Rollback on error
      setState('todos', todos => todos.filter(t => t.id !== temp.id));
      throw error;
    }
  };

  return { state, addTodo };
});
```

## DevTools

### Time Travel Debugging

Enable time travel debugging:

```typescript
import { createStore, enableDevTools } from 'nexus/state';

const [state, setState] = createStore(
  { count: 0 },
  { name: 'counter' }
);

// Enable DevTools in development
if (import.meta.env.DEV) {
  enableDevTools();
}
```

**DevTools features**:
- View all stores
- Inspect state changes
- Time-travel (undo/redo)
- Export/import snapshots
- Performance monitoring

### Action Tracking

Track actions for debugging:

```typescript
export const useCounterStore = defineStore('counter', () => {
  const [state, setState] = createStore({ count: 0 });

  const increment = action('increment', () => {
    setState('count', c => c + 1);
  });

  const decrement = action('decrement', () => {
    setState('count', c => c - 1);
  });

  return { state, increment, decrement };
});

// DevTools shows:
// counter/increment
// counter/decrement
```

### Snapshots

Export/import state snapshots:

```typescript
import { getSnapshot, loadSnapshot } from 'nexus/state';

// Export
const snapshot = getSnapshot('counter');
localStorage.setItem('snapshot', JSON.stringify(snapshot));

// Import
const snapshot = JSON.parse(localStorage.getItem('snapshot')!);
loadSnapshot('counter', snapshot);
```

### Middleware

Add middleware for logging, tracking:

```typescript
import { createStore, applyMiddleware } from 'nexus/state';

const logger = (store: any) => (next: any) => (action: any) => {
  console.log('Action:', action);
  const result = next(action);
  console.log('New State:', store.getState());
  return result;
};

const [state, setState] = createStore(
  { count: 0 },
  {
    middleware: [logger]
  }
);
```

## Performance

### Batching Updates

Updates are automatically batched:

```typescript
const [state, setState] = createStore({ a: 0, b: 0, c: 0 });

// All three updates batched into single render
setState('a', 1);
setState('b', 2);
setState('c', 3);

// Component re-renders ONCE, not three times
```

### Manual Batching

Explicitly batch updates:

```typescript
import { batch } from 'nexus/state';

const [state, setState] = createStore({ count: 0, doubled: 0 });

batch(() => {
  setState('count', 5);
  setState('doubled', state.count * 2);
});
// Single render
```

### Granular Subscriptions

Only subscribe to specific paths:

```typescript
const [state] = createStore({
  user: { name: 'Alice', age: 30 },
  settings: { theme: 'light' }
});

// Only re-renders when user.name changes
const UserName = () => <div>{state.user.name}</div>;

// Only re-renders when settings.theme changes
const Theme = () => <div>{state.settings.theme}</div>;

// Changing user.age won't re-render either component
state.user.age = 31;
```

### Memoization

Use computed for derived state:

```typescript
const [state] = createStore({
  todos: [] as Todo[]
});

// ❌ Recomputed on every access
const activeTodos = () => state.todos.filter(t => !t.done);

// ✅ Memoized, only recomputed when todos changes
const activeTodos = computed(() => state.todos.filter(t => !t.done));
```

### Lazy Computed

Compute values only when accessed:

```typescript
import { lazy } from 'nexus/state';

const [state] = createStore({ items: [] as Item[] });

// Only computed when accessed
const expensiveComputation = lazy(() => {
  console.log('Computing...');
  return state.items.reduce((sum, item) => sum + item.value, 0);
});

// First access triggers computation
console.log(expensiveComputation()); // "Computing..." then result

// Subsequent accesses use cached value (until items changes)
console.log(expensiveComputation()); // Just result
```

### Reconciliation

Efficiently update arrays:

```typescript
import { reconcile } from 'nexus/state';

const [state, setState] = createStore({
  users: [] as User[]
});

// Naive update (creates all new objects)
setState('users', newUsers);

// Reconcile (reuses unchanged objects)
setState('users', reconcile(newUsers, { key: 'id' }));
```

## Best Practices

### 1. Start Local, Go Global When Needed

```typescript
// ✅ Local state for component-specific concerns
const isOpen = signal(false);

// ✅ Global state for shared concerns
const authStore = useAuthStore();
```

### 2. Use Computed for Derived State

```typescript
// ❌ Manual updates (error-prone)
const count = signal(0);
const doubled = signal(0);

count.set(5);
doubled.set(10); // Easy to forget or mess up

// ✅ Computed (automatic)
const count = signal(0);
const doubled = computed(() => count() * 2);
```

### 3. Keep Stores Focused

```typescript
// ❌ One giant store
const appStore = createStore({
  user: {},
  todos: [],
  products: [],
  cart: [],
  // 100 more fields...
});

// ✅ Focused stores
const authStore = createStore({ user: null });
const todoStore = createStore({ todos: [] });
const productStore = createStore({ products: [] });
```

### 4. Co-locate Related Logic

```typescript
// ✅ Store with related actions
export const useTodoStore = defineStore('todos', () => {
  const [state, setState] = createStore({ todos: [] });

  const addTodo = (text: string) => {
    setState('todos', todos => [...todos, { id: uuid(), text, done: false }]);
  };

  const toggleTodo = (id: string) => {
    setState('todos', todos =>
      todos.map(t => t.id === id ? { ...t, done: !t.done } : t)
    );
  };

  return { state, addTodo, toggleTodo };
});
```

### 5. Use TypeScript

```typescript
// ✅ Type-safe store
interface User {
  id: string;
  name: string;
  email: string;
}

const [state, setState] = createStore<{ user: User | null }>({
  user: null
});

setState('user', { id: '1', name: 'Alice', email: 'alice@example.com' }); // ✅
setState('user', { id: '1', name: 'Alice' }); // ❌ Type error
```

### 6. Normalize Data

```typescript
// ❌ Nested arrays (hard to update)
const [state] = createStore({
  users: [
    { id: '1', name: 'Alice', posts: [{ id: 'a', title: 'Post 1' }] }
  ]
});

// ✅ Normalized (easy to update)
const [state] = createStore({
  users: {
    '1': { id: '1', name: 'Alice', postIds: ['a'] }
  },
  posts: {
    'a': { id: 'a', userId: '1', title: 'Post 1' }
  }
});
```

### 7. Avoid Over-Persistence

```typescript
// ❌ Persisting everything
const [state] = createStore(
  { user: {}, tempData: {}, cache: {} },
  { persist: true } // Don't persist everything!
);

// ✅ Persist only what's needed
const [state] = createStore(
  { user: {}, tempData: {}, cache: {} },
  {
    persist: {
      paths: ['user'] // Only persist user
    }
  }
);
```

### 8. Use Actions for Complex Logic

```typescript
// ✅ Encapsulate complex updates in actions
export const useCartStore = defineStore('cart', () => {
  const [state, setState] = createStore({
    items: [] as CartItem[],
    total: 0
  });

  const addItem = (product: Product) => {
    const existing = state.items.find(i => i.productId === product.id);

    if (existing) {
      setState('items', items =>
        items.map(i =>
          i.productId === product.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      );
    } else {
      setState('items', items => [
        ...items,
        { productId: product.id, quantity: 1, price: product.price }
      ]);
    }

    recalculateTotal();
  };

  const recalculateTotal = () => {
    const total = state.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    setState('total', total);
  };

  return { state, addItem };
});
```

## Comparisons

### vs Redux

**Redux**:
```typescript
// Actions
const INCREMENT = 'INCREMENT';
const increment = () => ({ type: INCREMENT });

// Reducer
const counterReducer = (state = 0, action) => {
  switch (action.type) {
    case INCREMENT: return state + 1;
    default: return state;
  }
};

// Store
const store = createStore(counterReducer);

// Dispatch
store.dispatch(increment());

// Subscribe
store.subscribe(() => console.log(store.getState()));
```

**Aether**:
```typescript
// Store
const [state, setState] = createStore({ count: 0 });

// Update
setState('count', c => c + 1);

// Reactive (automatic)
effect(() => console.log(state.count));
```

**Advantages**:
- ✅ No boilerplate (actions, reducers, dispatch)
- ✅ Fine-grained reactivity (no manual subscriptions)
- ✅ Simpler API
- ✅ Better TypeScript inference
- ✅ Smaller bundle size

### vs MobX

**MobX**:
```typescript
import { makeObservable, observable, action } from 'mobx';

class CounterStore {
  count = 0;

  constructor() {
    makeObservable(this, {
      count: observable,
      increment: action
    });
  }

  increment() {
    this.count++;
  }
}

const counter = new CounterStore();
```

**Aether**:
```typescript
export const useCounterStore = defineStore('counter', () => {
  const [state, setState] = createStore({ count: 0 });
  const increment = () => setState('count', c => c + 1);
  return { state, increment };
});
```

**Advantages**:
- ✅ No decorators required
- ✅ Simpler observable setup
- ✅ Function-based (more flexible)
- ✅ Better tree-shaking

### vs Zustand

**Zustand**:
```typescript
import create from 'zustand';

const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 }))
}));

// Usage
const count = useStore((state) => state.count);
const increment = useStore((state) => state.increment);
```

**Aether**:
```typescript
export const useCounterStore = defineStore('counter', () => {
  const [state, setState] = createStore({ count: 0 });
  const increment = () => setState('count', c => c + 1);
  return { state, increment };
});

// Usage
const counter = useCounterStore();
const count = () => counter.state.count;
const increment = counter.increment;
```

**Advantages**:
- ✅ Fine-grained reactivity (Zustand re-renders entire component)
- ✅ No manual selectors needed
- ✅ Built-in persistence and sync
- ✅ DevTools integration

### vs Pinia (Vue)

**Pinia**:
```typescript
import { defineStore } from 'pinia';

export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0 }),
  actions: {
    increment() {
      this.count++;
    }
  }
});
```

**Aether**:
```typescript
export const useCounterStore = defineStore('counter', () => {
  const [state, setState] = createStore({ count: 0 });
  const increment = () => setState('count', c => c + 1);
  return { state, increment };
});
```

**Advantages**:
- ✅ More flexible (function-based)
- ✅ Works outside components
- ✅ Better TypeScript inference
- ✅ Fine-grained reactivity

## Advanced Patterns

### Undo/Redo

Implement undo/redo:

```typescript
export const useHistoryStore = defineStore('history', () => {
  const [state, setState] = createStore({
    past: [] as any[],
    present: null as any,
    future: [] as any[]
  });

  const set = (value: any) => {
    setState({
      past: [...state.past, state.present],
      present: value,
      future: []
    });
  };

  const undo = () => {
    if (state.past.length === 0) return;

    const previous = state.past[state.past.length - 1];
    const newPast = state.past.slice(0, -1);

    setState({
      past: newPast,
      present: previous,
      future: [state.present, ...state.future]
    });
  };

  const redo = () => {
    if (state.future.length === 0) return;

    const next = state.future[0];
    const newFuture = state.future.slice(1);

    setState({
      past: [...state.past, state.present],
      present: next,
      future: newFuture
    });
  };

  const canUndo = computed(() => state.past.length > 0);
  const canRedo = computed(() => state.future.length > 0);

  return { state, set, undo, redo, canUndo, canRedo };
});
```

### Middleware Pattern

Create reusable store middleware:

```typescript
type Middleware = (store: any) => (next: any) => (action: any) => any;

const logger: Middleware = (store) => (next) => (action) => {
  console.log('Dispatching:', action);
  const result = next(action);
  console.log('New State:', store.getState());
  return result;
};

const crashReporter: Middleware = (store) => (next) => (action) => {
  try {
    return next(action);
  } catch (error) {
    console.error('Error in action:', action, error);
    throw error;
  }
};

export const createStoreWithMiddleware = (initialState: any, ...middlewares: Middleware[]) => {
  const [state, setState] = createStore(initialState);

  // Apply middleware
  const dispatch = middlewares.reduceRight(
    (next, middleware) => middleware({ getState: () => state })(next),
    (action: any) => action(setState)
  );

  return [state, dispatch] as const;
};
```

### Computed Cache

Cache expensive computations:

```typescript
import { createComputedCache } from 'nexus/state';

const [state] = createStore({
  users: [] as User[]
});

// Cache computed values by key
const cache = createComputedCache((userId: string) =>
  computed(() => state.users.find(u => u.id === userId))
);

// First access creates computed
const user1 = cache.get('1');

// Subsequent accesses reuse computed
const user1Again = cache.get('1'); // Same computed instance

// Different key creates new computed
const user2 = cache.get('2');
```

### Async Queue

Queue async operations:

```typescript
export const useQueueStore = defineStore('queue', () => {
  const [state, setState] = createStore({
    queue: [] as (() => Promise<void>)[],
    processing: false
  });

  const enqueue = (fn: () => Promise<void>) => {
    setState('queue', q => [...q, fn]);
    processQueue();
  };

  const processQueue = async () => {
    if (state.processing || state.queue.length === 0) return;

    setState('processing', true);

    while (state.queue.length > 0) {
      const fn = state.queue[0];

      try {
        await fn();
      } catch (error) {
        console.error('Queue error:', error);
      }

      setState('queue', q => q.slice(1));
    }

    setState('processing', false);
  };

  return { state, enqueue };
});
```

### Debounced Store

Debounce store updates:

```typescript
import { debounce } from 'nexus/utils';

export const useSearchStore = defineStore('search', () => {
  const [state, setState] = createStore({
    query: '',
    results: [] as Result[]
  });

  const search = async (query: string) => {
    const results = await api.search(query);
    setState({ results });
  };

  const debouncedSearch = debounce(search, 300);

  const setQuery = (query: string) => {
    setState('query', query);
    debouncedSearch(query);
  };

  return { state, setQuery };
});
```

### Optimistic Locking

Prevent concurrent updates:

```typescript
export const useDocumentStore = defineStore('document', () => {
  const [state, setState] = createStore({
    document: null as Document | null,
    version: 0,
    saving: false
  });

  const save = async (changes: Partial<Document>) => {
    if (state.saving) {
      throw new Error('Save already in progress');
    }

    setState('saving', true);

    try {
      const updated = await api.updateDocument(state.document!.id, {
        ...changes,
        version: state.version
      });

      setState({
        document: updated,
        version: updated.version,
        saving: false
      });
    } catch (error) {
      if (error.code === 'VERSION_CONFLICT') {
        // Reload document
        const latest = await api.getDocument(state.document!.id);
        setState({
          document: latest,
          version: latest.version,
          saving: false
        });
        throw new Error('Document was modified by another user');
      }

      setState('saving', false);
      throw error;
    }
  };

  return { state, save };
});
```

## API Reference

### createStore

```typescript
function createStore<T extends object>(
  initialState: T,
  options?: {
    name?: string;
    persist?: PersistOptions;
    sync?: boolean | SyncOptions;
    middleware?: Middleware[];
  }
): [state: T, setState: SetStateFunction<T>];

interface PersistOptions {
  key: string;
  storage: StorageAdapter;
  paths?: string[];
  version?: number;
  migrate?: (persisted: any, version: number) => any;
  serializer?: {
    serialize: (value: any) => string;
    deserialize: (str: string) => any;
  };
}

interface SyncOptions {
  channel?: string;
  paths?: string[];
  debounce?: number;
}

type SetStateFunction<T> = {
  // Set entire state
  (state: Partial<T>): void;
  (updater: (state: T) => Partial<T>): void;

  // Set path
  <K extends keyof T>(key: K, value: T[K]): void;
  <K extends keyof T>(key: K, updater: (value: T[K]) => T[K]): void;

  // Set nested path
  (...args: any[]): void;
};
```

### defineStore

```typescript
function defineStore<T>(
  name: string,
  setup: () => T,
  options?: {
    persist?: PersistOptions;
    sync?: boolean | SyncOptions;
  }
): () => T;
```

### computed

```typescript
function computed<T>(
  fn: () => T,
  options?: {
    equals?: (a: T, b: T) => boolean;
  }
): () => T;
```

### batch

```typescript
function batch<T>(fn: () => T): T;
```

### reconcile

```typescript
function reconcile<T>(
  value: T,
  options?: {
    key?: string | ((item: any) => any);
    merge?: boolean;
  }
): T;
```

### produce

```typescript
function produce<T>(
  fn: (draft: T) => void
): (state: T) => T;
```

### lazy

```typescript
function lazy<T>(fn: () => T): () => T;
```

### enableDevTools

```typescript
function enableDevTools(options?: {
  name?: string;
  maxAge?: number;
}): void;
```

### getSnapshot / loadSnapshot

```typescript
function getSnapshot(storeName: string): any;
function loadSnapshot(storeName: string, snapshot: any): void;
```

## Examples

### Shopping Cart

```typescript
// stores/cart.store.ts
import { defineStore } from 'nexus/state';

interface CartItem {
  productId: string;
  quantity: number;
  price: number;
}

export const useCartStore = defineStore('cart', () => {
  const [state, setState] = createStore({
    items: [] as CartItem[],
    isOpen: false
  });

  const total = computed(() =>
    state.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  );

  const itemCount = computed(() =>
    state.items.reduce((sum, item) => sum + item.quantity, 0)
  );

  const addItem = (product: Product) => {
    const existing = state.items.find(i => i.productId === product.id);

    if (existing) {
      setState('items', items =>
        items.map(i =>
          i.productId === product.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      );
    } else {
      setState('items', items => [
        ...items,
        { productId: product.id, quantity: 1, price: product.price }
      ]);
    }
  };

  const removeItem = (productId: string) => {
    setState('items', items => items.filter(i => i.productId !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
    } else {
      setState('items', items =>
        items.map(i =>
          i.productId === productId ? { ...i, quantity } : i
        )
      );
    }
  };

  const clear = () => {
    setState('items', []);
  };

  const toggleCart = () => {
    setState('isOpen', !state.isOpen);
  };

  return {
    state,
    total,
    itemCount,
    addItem,
    removeItem,
    updateQuantity,
    clear,
    toggleCart
  };
}, {
  persist: {
    key: 'cart',
    storage: localStorage,
    paths: ['items']
  }
});

// Usage
const cart = useCartStore();

<button onClick={() => cart.addItem(product)}>
  Add to Cart
</button>

<CartDrawer open={cart.state.isOpen} onClose={cart.toggleCart}>
  {#each cart.state.items as item}
    <CartItem
      item={item}
      onQuantityChange={(q) => cart.updateQuantity(item.productId, q)}
      onRemove={() => cart.removeItem(item.productId)}
    />
  {/each}

  <div class="total">Total: ${cart.total()}</div>
</CartDrawer>
```

### Form State

```typescript
// stores/form.store.ts
import { createStore } from 'nexus/state';

export function createFormStore<T extends Record<string, any>>(
  initialValues: T,
  validate?: (values: T) => Partial<Record<keyof T, string>>
) {
  const [state, setState] = createStore({
    values: initialValues,
    errors: {} as Partial<Record<keyof T, string>>,
    touched: {} as Partial<Record<keyof T, boolean>>,
    isSubmitting: false,
    isValid: true
  });

  const setFieldValue = <K extends keyof T>(field: K, value: T[K]) => {
    setState('values', field, value);

    if (validate) {
      const errors = validate({ ...state.values, [field]: value });
      setState('errors', errors);
      setState('isValid', Object.keys(errors).length === 0);
    }
  };

  const setFieldTouched = <K extends keyof T>(field: K, touched = true) => {
    setState('touched', field, touched);
  };

  const handleBlur = <K extends keyof T>(field: K) => {
    setFieldTouched(field);
  };

  const handleSubmit = async (onSubmit: (values: T) => Promise<void>) => {
    // Touch all fields
    const touched = Object.keys(state.values).reduce(
      (acc, key) => ({ ...acc, [key]: true }),
      {}
    );
    setState('touched', touched);

    // Validate
    if (validate) {
      const errors = validate(state.values);
      setState('errors', errors);
      setState('isValid', Object.keys(errors).length === 0);

      if (Object.keys(errors).length > 0) return;
    }

    setState('isSubmitting', true);

    try {
      await onSubmit(state.values);
    } finally {
      setState('isSubmitting', false);
    }
  };

  const reset = () => {
    setState({
      values: initialValues,
      errors: {},
      touched: {},
      isSubmitting: false,
      isValid: true
    });
  };

  return {
    state,
    setFieldValue,
    setFieldTouched,
    handleBlur,
    handleSubmit,
    reset
  };
}

// Usage
const form = createFormStore(
  { email: '', password: '' },
  (values) => {
    const errors: any = {};
    if (!values.email) errors.email = 'Required';
    if (!values.password) errors.password = 'Required';
    return errors;
  }
);

<form onSubmit={(e) => {
  e.preventDefault();
  form.handleSubmit(async (values) => {
    await api.login(values);
  });
}}>
  <input
    value={form.state.values.email}
    onInput={(e) => form.setFieldValue('email', e.target.value)}
    onBlur={() => form.handleBlur('email')}
  />
  {#if form.state.touched.email && form.state.errors.email}
    <span class="error">{form.state.errors.email}</span>
  {/if}

  <button type="submit" disabled={form.state.isSubmitting || !form.state.isValid}>
    {form.state.isSubmitting ? 'Logging in...' : 'Login'}
  </button>
</form>
```

### Real-time Collaboration

```typescript
// stores/collab.store.ts
import { defineStore } from 'nexus/state';

interface User {
  id: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number };
}

export const useCollabStore = defineStore('collab', () => {
  const [state, setState] = createStore({
    users: new Map<string, User>(),
    currentUserId: null as string | null
  });

  const ws = new WebSocket('ws://localhost:3000/collab');

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case 'user-joined':
        setState('users', users => new Map(users).set(message.user.id, message.user));
        break;

      case 'user-left':
        setState('users', users => {
          const newUsers = new Map(users);
          newUsers.delete(message.userId);
          return newUsers;
        });
        break;

      case 'cursor-moved':
        setState('users', users => {
          const user = users.get(message.userId);
          if (!user) return users;

          return new Map(users).set(message.userId, {
            ...user,
            cursor: message.cursor
          });
        });
        break;
    }
  };

  const moveCursor = (x: number, y: number) => {
    ws.send(JSON.stringify({
      type: 'cursor-moved',
      cursor: { x, y }
    }));
  };

  const activeUsers = computed(() => Array.from(state.users.values()));

  return {
    state,
    activeUsers,
    moveCursor
  };
});

// Usage
const collab = useCollabStore();

<div onMouseMove={(e) => collab.moveCursor(e.clientX, e.clientY)}>
  {#each collab.activeUsers() as user}
    <Cursor
      x={user.cursor?.x}
      y={user.cursor?.y}
      color={user.color}
      name={user.name}
    />
  {/each}
</div>
```

---

**State management in Aether is designed to be simple, type-safe, and performant.** The fine-grained reactivity system ensures surgical updates without unnecessary re-renders, while the flexible API supports multiple patterns from simple local state to complex global stores with persistence, synchronization, and DevTools integration.

**Next**: [11. Styling →](./11-STYLING.md)
