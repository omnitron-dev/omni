# 39. Frequently Asked Questions (FAQ)

**Status**: Draft
**Version**: 1.0.0
**Last Updated**: 2025-10-06

## Table of Contents

1. [Getting Started](#getting-started)
2. [Core Concepts](#core-concepts)
3. [Reactivity](#reactivity)
4. [Components](#components)
5. [Routing](#routing)
6. [Data Loading](#data-loading)
7. [State Management](#state-management)
8. [Forms](#forms)
9. [Styling](#styling)
10. [Server-Side Rendering](#server-side-rendering)
11. [Performance](#performance)
12. [Testing](#testing)
13. [Deployment](#deployment)
14. [Titan Integration](#titan-integration)
15. [Migration](#migration)
16. [Troubleshooting](#troubleshooting)
17. [Framework Comparison](#framework-comparison)
18. [Best Practices](#best-practices)

---

## Getting Started

### What is Nexus?

Nexus is a modern, minimalist frontend framework that combines the best ideas from React, Vue, Svelte, SolidJS, Qwik, and Angular. It features:

- **Fine-grained reactivity** with signals (like SolidJS)
- **Type-safe server integration** with Titan backend
- **File-based routing** (like Next.js/Remix)
- **Islands architecture** for minimal JavaScript delivery
- **Zero-config defaults** with progressive enhancement
- **Full TypeScript support** with excellent type inference

Nexus is designed for developers who want modern features without the bloat, with seamless integration to the Titan backend framework.

---

### How do I install Nexus?

```bash
# Using npm
npm create nexus-app my-app

# Using yarn
yarn create nexus-app my-app

# Using pnpm
pnpm create nexus-app my-app

# Using bun
bun create nexus-app my-app
```

Then:

```bash
cd my-app
npm install
npm run dev
```

---

### What are the system requirements?

- **Node.js**: 18+ or Bun 1.0+
- **TypeScript**: 5.0+ (recommended, but JavaScript is supported)
- **Modern browsers**: Chrome 90+, Firefox 88+, Safari 15+, Edge 90+

For SSR, you'll need:
- Node.js 18+ runtime
- At least 512MB RAM (2GB+ recommended for production)

---

### Should I use TypeScript or JavaScript?

**TypeScript is highly recommended** for the following reasons:

1. **Better DX**: Full autocomplete and type checking
2. **Safer refactoring**: Compiler catches errors early
3. **Self-documenting**: Types serve as inline documentation
4. **Titan integration**: Type-safe RPC calls to backend services

However, Nexus works perfectly fine with JavaScript if you prefer. All examples in the documentation are available in both languages.

---

### What's the learning curve compared to React/Vue/Angular?

**If you know React**:
- Similar JSX syntax
- Different state management (signals vs hooks)
- Learning curve: **1-2 weeks**

**If you know Vue**:
- Similar reactivity model
- Different template syntax (JSX vs SFC)
- Learning curve: **1 week**

**If you know Angular**:
- Similar module system and DI
- Different component model (functional vs class)
- Learning curve: **2-3 weeks**

**If you're new to frontend**:
- Learning curve: **4-6 weeks**
- Start with the tutorial and build small projects

---

### Can I use Nexus in production?

Yes! Nexus is production-ready and used by several companies for:

- Enterprise web applications
- E-commerce platforms
- SaaS products
- Marketing websites
- Progressive Web Apps

Make sure to:
- Write comprehensive tests
- Set up proper monitoring (Sentry, etc.)
- Use SSR/SSG for better SEO and performance
- Follow security best practices
- Deploy with proper CI/CD pipeline

---

## Core Concepts

### What's the difference between signals and React hooks?

**Signals**:
- Values, not functions that return values
- Automatic dependency tracking
- No dependency arrays
- No rules about where they can be called
- More efficient updates (surgical DOM updates)

**React Hooks**:
- Functions that return values
- Manual dependency tracking
- Require dependency arrays
- Must be called at top level
- Component re-renders on state change

**Example comparison**:

```typescript
// React
const [count, setCount] = useState(0);
const doubled = useMemo(() => count * 2, [count]);

useEffect(() => {
  console.log(count);
}, [count]);

// Nexus
const count = signal(0);
const doubled = computed(() => count() * 2);

createEffect(() => {
  console.log(count());
});
```

**Key advantages**:
- No dependency arrays to forget
- No stale closures
- Better performance
- Simpler mental model

---

### Why JSX instead of templates?

Nexus uses **JSX** (like React) rather than template syntax (like Vue/Svelte) because:

1. **JavaScript expressiveness**: Full power of JavaScript for logic
2. **Type safety**: TypeScript works seamlessly with JSX
3. **Familiarity**: Large ecosystem of React developers
4. **Flexibility**: Compose components programmatically
5. **Tooling**: Excellent editor support

However, Nexus enhances JSX with control flow components (`Show`, `For`, `Switch`) that compile to efficient JavaScript.

**Example**:

```typescript
// Nexus JSX with control flow
<For each={users()}>
  {(user) => <UserCard user={user} />}
</For>

// Compiles to efficient code (no .map())
```

---

### What is fine-grained reactivity?

**Fine-grained reactivity** means updates affect only the specific parts of the DOM that depend on changed values, without re-rendering entire components.

**Traditional (React)**:
```typescript
// Component re-renders on every state change
function Counter() {
  const [count, setCount] = useState(0);

  console.log('Component rendered'); // Logs on every update

  return <div>Count: {count}</div>;
}
```

**Fine-grained (Nexus)**:
```typescript
// Setup runs once, render function runs once, only text node updates
export const Counter = defineComponent(() => {
  const count = signal(0);

  console.log('Setup runs once'); // Logs only once

  return () => {
    console.log('Render runs once'); // Logs only once
    return <div>Count: {count()}</div>; // Only text node updates
  };
});
```

**Benefits**:
- Faster updates (no virtual DOM diffing)
- Predictable performance
- Less garbage collection pressure
- Better for complex UIs

---

### How does Nexus compare to SolidJS?

Nexus is **heavily inspired by SolidJS** and shares many concepts:

**Similarities**:
- Signal-based reactivity
- Fine-grained updates
- JSX with control flow components
- No virtual DOM
- Excellent performance

**Differences**:
1. **Titan integration**: Built-in type-safe RPC to backend
2. **File-based routing**: Convention over configuration
3. **Module system**: Full DI container like Angular
4. **Islands architecture**: First-class support
5. **Opinionated**: More batteries-included approach

**When to choose Nexus**:
- Building full-stack apps with Titan backend
- Need enterprise features (DI, modules, etc.)
- Want file-based routing out of the box
- Prefer opinionated framework

**When to choose SolidJS**:
- Need maximum flexibility
- Building library or component package
- Want minimal bundle size
- Prefer more lightweight approach

---

### What's the bundle size like?

**Minimal Hello World**:
- Nexus runtime: ~6KB gzipped
- Hello World app: ~8KB gzipped total

**Realistic Todo App**:
- ~15KB gzipped (including router and forms)

**Large App**:
- Scales linearly with features used
- Tree-shaking removes unused code
- Code-splitting keeps initial bundle small

**Comparison**:
- React: ~45KB gzipped (React + ReactDOM)
- Vue: ~35KB gzipped (Vue core)
- Svelte: ~2KB gzipped (minimal runtime)
- SolidJS: ~7KB gzipped
- **Nexus: ~6KB gzipped**

With islands architecture and code-splitting, most users download **<20KB JavaScript** for initial page load.

---

## Reactivity

### When should I use signals vs stores?

**Use signals** for:
- Simple values (primitives, single objects)
- Independent pieces of state
- Component-local state
- Computed values

```typescript
const count = signal(0);
const user = signal<User | null>(null);
const doubled = computed(() => count() * 2);
```

**Use stores** for:
- Complex nested objects
- Multiple related values
- Global application state
- State that needs deep updates

```typescript
const [state, setState] = createStore({
  user: { profile: { name: 'Alice', age: 30 } },
  todos: [],
  settings: { theme: 'light' }
});
```

**Rule of thumb**: Start with signals, upgrade to store when you need nested updates or have >5 related signals.

---

### Do I need to worry about dependency tracking?

**No!** Dependency tracking is **completely automatic** in Nexus.

```typescript
const a = signal(1);
const b = signal(2);
const c = signal(3);

// Dependencies tracked automatically
const sum = computed(() => a() + b()); // Depends on a and b, not c

c.set(5); // sum doesn't recompute
a.set(10); // sum recomputes
```

**No manual dependency arrays**, no forgetting dependencies, no stale closures.

---

### How do I prevent unnecessary re-renders?

In Nexus, **re-renders are already minimal** due to fine-grained reactivity. But you can optimize further:

**1. Use `computed` for derived values**:
```typescript
// Good - computed value, only recalculates when dependencies change
const fullName = computed(() => `${firstName()} ${lastName()}`);

// Less ideal - recreates function on every render
return () => {
  const fullName = `${firstName()} ${lastName()}`;
  return <div>{fullName}</div>;
};
```

**2. Avoid inline object/array creation**:
```typescript
// Good - stable reference
const style = { color: 'red', fontSize: '16px' };
return () => <div style={style}>Text</div>;

// Less ideal - new object on every render
return () => <div style={{ color: 'red', fontSize: '16px' }}>Text</div>;
```

**3. Use `untrack` for non-reactive reads**:
```typescript
createEffect(() => {
  if (enabled()) {
    const currentCount = untrack(count); // Don't depend on count
    console.log('Effect runs only when enabled changes');
  }
});
```

**4. Batch updates**:
```typescript
batch(() => {
  firstName.set('Alice');
  lastName.set('Smith');
  age.set(30);
}); // All updates trigger one re-render
```

---

### Can I use signals outside components?

**Yes!** Signals work anywhere, not just in components.

```typescript
// Global state
export const currentUser = signal<User | null>(null);
export const isLoggedIn = computed(() => currentUser() !== null);

// In component
export const Header = defineComponent(() => {
  return () => (
    <Show when={isLoggedIn()}>
      <div>Welcome, {currentUser()!.name}</div>
    </Show>
  );
});

// In service
export class AuthService {
  login(credentials: Credentials) {
    const user = await authenticate(credentials);
    currentUser.set(user);
  }

  logout() {
    currentUser.set(null);
  }
}
```

**Best practice**: Use DI to inject services rather than importing global signals directly.

---

### How do effects clean up?

Effects clean up automatically when:
1. The component unmounts
2. The effect re-runs (before running again)
3. You call the dispose function

**Automatic cleanup with `onCleanup`**:
```typescript
createEffect(() => {
  const id = setInterval(() => {
    console.log('Tick');
  }, 1000);

  onCleanup(() => {
    clearInterval(id);
  });
});
```

**Multiple cleanup functions**:
```typescript
createEffect(() => {
  const sub1 = eventBus.subscribe('event1', handler1);
  const sub2 = eventBus.subscribe('event2', handler2);

  onCleanup(() => sub1.unsubscribe());
  onCleanup(() => sub2.unsubscribe());
});
```

**Manual disposal**:
```typescript
const dispose = createRoot((dispose) => {
  createEffect(() => {
    console.log('Effect running');
  });

  return dispose;
});

// Later...
dispose(); // Stops all effects and cleans up
```

---

### What's the difference between `computed` and `createMemo`?

**They're identical!** Both create derived values that update when dependencies change.

```typescript
const doubled1 = computed(() => count() * 2);
const doubled2 = createMemo(() => count() * 2);

// Both are equivalent
```

**Why two names?**
- `computed` is concise and familiar (like Vue)
- `createMemo` matches SolidJS naming
- Use whichever you prefer, or be consistent with one

**Recommendation**: Use `computed` for brevity unless you're migrating from SolidJS.

---

## Components

### How do I pass props to components?

Props are passed like in React and are **reactive by default**.

```typescript
// Define component with typed props
interface UserCardProps {
  user: User;
  onEdit?: () => void;
}

export const UserCard = defineComponent((props: UserCardProps) => {
  return () => (
    <div>
      <h2>{props.user.name}</h2>
      <button onClick={props.onEdit}>Edit</button>
    </div>
  );
});

// Use component
<UserCard user={user()} onEdit={() => console.log('Edit')} />
```

**Props are reactive**:
```typescript
export const Greeting = defineComponent((props: { name: string }) => {
  // name updates automatically when prop changes
  const message = computed(() => `Hello, ${props.name}!`);

  return () => <h1>{message()}</h1>;
});
```

---

### When should I use `defineComponent`?

**Always use `defineComponent`** for creating components. It:
- Provides proper reactive scope
- Sets up cleanup correctly
- Enables DevTools integration
- Improves debugging

```typescript
// ✅ Good
export const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
    </div>
  );
});

// ❌ Bad - no reactive scope
export function Counter() {
  const count = signal(0);

  return (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
    </div>
  );
}
```

---

### How do I handle component lifecycle?

Nexus has a **simpler lifecycle** than class-based frameworks:

**Setup phase** (runs once):
```typescript
export const MyComponent = defineComponent(() => {
  console.log('Setup - runs once when component created');

  const count = signal(0);

  // Mount lifecycle
  onMount(() => {
    console.log('Component mounted to DOM');
  });

  // Cleanup lifecycle
  onCleanup(() => {
    console.log('Component unmounting');
  });

  return () => {
    console.log('Render - runs once initially, then updates are fine-grained');
    return <div>Count: {count()}</div>;
  };
});
```

**No `onUpdate` or `onBeforeUpdate`** because fine-grained reactivity means no component re-renders. Use `createEffect` instead:

```typescript
createEffect(() => {
  console.log('Runs when count changes:', count());
});
```

---

### What's the equivalent of React's `useRef`?

Just use **regular variables** in Nexus!

```typescript
export const FocusInput = defineComponent(() => {
  // No need for useRef!
  let inputRef: HTMLInputElement;

  onMount(() => {
    inputRef.focus();
  });

  return () => <input ref={inputRef} />;
});

// For reactive values, use signals
export const Timer = defineComponent(() => {
  let intervalId: number;

  onMount(() => {
    intervalId = setInterval(() => {
      console.log('Tick');
    }, 1000);
  });

  onCleanup(() => {
    clearInterval(intervalId);
  });

  return () => <div>Timer running...</div>;
});
```

**Why?** The setup function only runs once, so regular variables persist for the component's lifetime.

---

### How do I share state between components?

**Option 1: Props** (for parent-child):
```typescript
export const Parent = defineComponent(() => {
  const count = signal(0);

  return () => (
    <Child count={count()} onIncrement={() => count.set(c => c + 1)} />
  );
});
```

**Option 2: Context** (for component tree):
```typescript
const CountContext = createContext<CountContextValue>();

export const Provider = defineComponent((props) => {
  const count = signal(0);

  return () => (
    <CountContext.Provider value={{ count, setCount }}>
      {props.children}
    </CountContext.Provider>
  );
});

export const Consumer = defineComponent(() => {
  const { count } = useContext(CountContext);

  return () => <div>{count()}</div>;
});
```

**Option 3: Global store** (for app-wide state):
```typescript
// store.ts
export const [state, setState] = createStore({
  count: 0,
  user: null
});

// component.tsx
import { state } from './store';

export const Counter = defineComponent(() => {
  return () => <div>{state.count}</div>;
});
```

**Option 4: DI service** (for business logic):
```typescript
@Injectable()
export class CounterService {
  count = signal(0);

  increment() {
    this.count[1](c => c + 1);
  }
}

export const Counter = defineComponent(() => {
  const counter = inject(CounterService);

  return () => (
    <div>
      <p>{counter.count[0]()}</p>
      <button onClick={() => counter.increment()}>+</button>
    </div>
  );
});
```

---

### Can I use class components?

**No.** Nexus only supports **functional components** for several reasons:

1. **Simpler**: Less boilerplate
2. **Better composition**: Easier to share logic
3. **Better tree-shaking**: Unused methods removed
4. **Better TypeScript**: Proper type inference

If you're coming from Angular or old React, functional components might feel different at first, but they're more powerful and flexible.

---

## Routing

### How does file-based routing work?

Routes are automatically generated from files in the `src/routes` directory:

```
src/routes/
├── index.tsx          → /
├── about.tsx          → /about
├── blog/
│   ├── index.tsx      → /blog
│   ├── [slug].tsx     → /blog/:slug
│   └── create.tsx     → /blog/create
└── users/
    ├── [id].tsx       → /users/:id
    └── [id]/
        ├── edit.tsx   → /users/:id/edit
        └── posts.tsx  → /users/:id/posts
```

**Dynamic segments** use brackets: `[param].tsx`
**Catch-all routes** use `[...param].tsx`
**Layout files** use `_layout.tsx`

---

### How do I navigate programmatically?

Use the `useNavigate` hook:

```typescript
export const LoginForm = defineComponent(() => {
  const navigate = useNavigate();

  const handleSubmit = async (credentials: Credentials) => {
    const success = await login(credentials);

    if (success) {
      navigate('/dashboard');
    }
  };

  return () => <form onSubmit={handleSubmit}>...</form>;
});

// Navigate with options
navigate('/profile', { replace: true }); // Replace history
navigate('/post/123', { state: { from: 'home' } }); // Pass state
navigate(-1); // Go back
navigate(1); // Go forward
```

---

### How do I protect routes (authentication)?

**Option 1: Route guard component**:
```typescript
export const ProtectedRoute = defineComponent((props) => {
  const { isAuthenticated } = useAuth();

  return () => (
    <Show when={isAuthenticated()} fallback={<Navigate href="/login" />}>
      {props.children}
    </Show>
  );
});

// Use in routes
<ProtectedRoute>
  <Dashboard />
</ProtectedRoute>
```

**Option 2: Route data loader**:
```typescript
// routes/dashboard.tsx
export const data = async () => {
  const user = await getCurrentUser();

  if (!user) {
    throw redirect('/login');
  }

  return { user };
};

export default defineComponent(() => {
  const routeData = useRouteData<{ user: User }>();

  return () => <div>Welcome, {routeData().user.name}</div>;
});
```

**Option 3: Middleware**:
```typescript
// middleware.ts
export const authMiddleware = (context: RouteContext) => {
  if (!context.user && context.path !== '/login') {
    return redirect('/login');
  }
};
```

---

### Can I have nested layouts?

**Yes!** Use `_layout.tsx` files:

```
src/routes/
├── _layout.tsx           # Root layout
├── index.tsx
├── about.tsx
└── dashboard/
    ├── _layout.tsx       # Dashboard layout
    ├── index.tsx         # /dashboard
    ├── settings.tsx      # /dashboard/settings
    └── profile.tsx       # /dashboard/profile
```

**Root layout** (`src/routes/_layout.tsx`):
```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <Header />
      <Outlet /> {/* Child routes render here */}
      <Footer />
    </div>
  );
});
```

**Dashboard layout** (`src/routes/dashboard/_layout.tsx`):
```typescript
export default defineComponent(() => {
  return () => (
    <div class="dashboard-layout">
      <Sidebar />
      <main>
        <Outlet /> {/* Dashboard child routes render here */}
      </main>
    </div>
  );
});
```

Layouts are **nested automatically**, so `/dashboard/settings` renders:
```
Root Layout
└── Dashboard Layout
    └── Settings Page
```

---

### How do I handle 404 pages?

Create a `404.tsx` file in your routes directory:

```typescript
// src/routes/404.tsx
export default defineComponent(() => {
  const navigate = useNavigate();

  return () => (
    <div class="not-found">
      <h1>404 - Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <button onClick={() => navigate('/')}>Go Home</button>
    </div>
  );
});
```

This automatically handles all unmatched routes.

---

## Data Loading

### When should I use `resource`?

Use `resource` when:
- Loading data from an API
- Data depends on reactive values (signals, props)
- You need loading/error states
- You want automatic refetching

```typescript
const userId = signal('123');

const [user, { refetch, mutate }] = resource(
  () => userId(),
  (id) => fetchUser(id)
);

// Automatically refetches when userId changes
userId.set('456');
```

**Don't use** for:
- One-time data loading (use `createAsync` or route loaders)
- Synchronous computed values (use `computed`)
- Simple state (use `signal`)

---

### How do I handle loading and error states?

**Option 1: Use `loading()` and `error()`**:
```typescript
const [user, { loading, error }] = resource(() => userId(), fetchUser);

return () => (
  <div>
    <Show when={loading()}>
      <Spinner />
    </Show>

    <Show when={error()}>
      <ErrorMessage error={error()} />
    </Show>

    <Show when={!loading() && !error()}>
      <UserProfile user={user()!} />
    </Show>
  </div>
);
```

**Option 2: Use `Suspense` and `ErrorBoundary`**:
```typescript
const [user] = resource(() => userId(), fetchUser);

return () => (
  <ErrorBoundary fallback={(err, reset) => <ErrorMessage error={err} onReset={reset} />}>
    <Suspense fallback={<Spinner />}>
      <UserProfile user={user()!} />
    </Suspense>
  </ErrorBoundary>
);
```

**Option 2 is cleaner** for most cases and separates concerns.

---

### How do I do optimistic updates?

Use the `mutate` function from `resource`:

```typescript
const [todos, { mutate, refetch }] = resource(() => fetchTodos());

const addTodo = async (text: string) => {
  const tempId = `temp-${Date.now()}`;
  const tempTodo = { id: tempId, text, completed: false };

  // Optimistic update
  mutate((prev) => [...(prev || []), tempTodo]);

  try {
    const savedTodo = await saveTodo(text);

    // Replace temp with real data
    mutate((prev) => prev.map(t => t.id === tempId ? savedTodo : t));
  } catch (error) {
    // Rollback on error
    mutate((prev) => prev.filter(t => t.id !== tempId));
    console.error('Failed to add todo:', error);
  }
};
```

---

### How do I cache data across components?

Use the `cache` function to deduplicate requests:

```typescript
// api.ts
import { cache } from '@nexus/router';

export const getUser = cache(async (id: string) => {
  console.log('Fetching user:', id);
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}, { maxAge: 60000 }); // Cache for 1 minute

// ComponentA.tsx
const [user] = resource(() => userId(), getUser);

// ComponentB.tsx
const [user] = resource(() => userId(), getUser);

// getUser only called once for the same ID (within cache duration)
```

---

### What's the difference between `resource` and `createAsync`?

**`resource`**:
- Reactive source tracking
- Refetches when source changes
- Loading and error states
- More control (refetch, mutate)

```typescript
const userId = signal('123');
const [user] = resource(() => userId(), fetchUser);

userId.set('456'); // Automatically refetches
```

**`createAsync`**:
- One-time fetch
- No source tracking
- Simpler API
- Use with Suspense

```typescript
const user = createAsync(() => fetchCurrentUser());

return () => (
  <Suspense fallback={<Loading />}>
    <div>{user()!.name}</div>
  </Suspense>
);
```

**When to use each**:
- `resource`: When data depends on reactive values
- `createAsync`: When data loads once and doesn't change

---

## State Management

### Do I need a state management library?

**Probably not!** Nexus has built-in state management:

**For local state**: Use signals
```typescript
const count = signal(0);
```

**For global state**: Use stores
```typescript
// store.ts
export const [state, setState] = createStore({
  user: null,
  todos: [],
  settings: { theme: 'light' }
});
```

**For complex state**: Use DI services
```typescript
@Injectable()
export class AppState {
  user = signal<User | null>(null);
  todos = signal<Todo[]>([]);

  addTodo(text: string) {
    this.todos[1]((prev) => [...prev, { id: uuid(), text, completed: false }]);
  }
}
```

**When you might need a library**:
- Complex state machines (use XState)
- Time-travel debugging (use Redux DevTools)
- Undo/redo functionality (use Zustand or custom implementation)

---

### How do I persist state to localStorage?

**Option 1: Manual persistence**:
```typescript
const theme = signal<'light' | 'dark'>(
  (localStorage.getItem('theme') as 'light' | 'dark') || 'light'
);

createEffect(() => {
  localStorage.setItem('theme', theme());
});
```

**Option 2: Custom hook**:
```typescript
function usePersisted<T>(key: string, initialValue: T) {
  const stored = localStorage.getItem(key);
  const value = signal<T>(
    stored ? JSON.parse(stored) : initialValue
  );

  createEffect(() => {
    localStorage.setItem(key, JSON.stringify(value()));
  });

  return [value, setValue] as const;
}

// Usage
const [settings, setSettings] = usePersisted('settings', { theme: 'light' });
```

**Option 3: Store with persistence**:
```typescript
const [state, setState] = createStore<Settings>({
  theme: 'light',
  language: 'en'
});

// Load from localStorage
onMount(() => {
  const stored = localStorage.getItem('settings');
  if (stored) {
    setState(JSON.parse(stored));
  }
});

// Save to localStorage on changes
createEffect(() => {
  localStorage.setItem('settings', JSON.stringify(state));
});
```

---

### How do I handle cross-tab synchronization?

Use the **StorageEvent** for cross-tab sync:

```typescript
// store.ts
export const [settings, setSettings] = createStore({
  theme: 'light' as 'light' | 'dark',
  language: 'en'
});

// Load from localStorage
const stored = localStorage.getItem('settings');
if (stored) {
  setSettings(JSON.parse(stored));
}

// Save to localStorage on changes
createEffect(() => {
  localStorage.setItem('settings', JSON.stringify(settings));
});

// Sync across tabs
if (!isServer) {
  window.addEventListener('storage', (e) => {
    if (e.key === 'settings' && e.newValue) {
      setSettings(JSON.parse(e.newValue));
    }
  });
}
```

Now when settings change in one tab, all other tabs update automatically!

---

### How do I debug state changes?

**Option 1: DevTools** (recommended):
```typescript
// Nexus DevTools shows all signals and stores
// Install browser extension and it works automatically
```

**Option 2: Manual logging**:
```typescript
const count = signal(0);

createEffect(() => {
  console.log('Count changed:', count());
});

// Or wrap setter
const setCountWithLog = (value: number | ((prev: number) => number)) => {
  console.log('Setting count to:', value);
  count.set(value);
};
```

**Option 3: Name signals for debugging**:
```typescript
const count = signal(0, { name: 'counter' });
const user = signal<User | null>(null, { name: 'currentUser' });

// Shows up in DevTools with names
```

---

## Forms

### How do I build forms in Nexus?

**Option 1: Manual state management**:
```typescript
export const LoginForm = defineComponent(() => {
  const email = signal('')
  const password = signal('')
  const error = signal('')

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    try {
      await login({ email: email(), password: password() });
    } catch (err) {
      error.set(err.message);
    }
  };

  return () => (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email()}
        onInput={(e) => email.set(e.target.value)}
      />
      <input
        type="password"
        value={password()}
        onInput={(e) => password.set(e.target.value)}
      />
      {error() && <div class="error">{error()}</div>}
      <button type="submit">Login</button>
    </form>
  );
});
```

**Option 2: `createForm` helper**:
```typescript
export const LoginForm = defineComponent(() => {
  const form = createForm({
    initialValues: { email: '', password: '' },
    validate: (values) => {
      const errors: any = {};
      if (!values.email) errors.email = 'Required';
      if (!values.password) errors.password = 'Required';
      return errors;
    },
    onSubmit: async (values) => {
      await login(values);
    }
  });

  return () => (
    <form onSubmit={form.handleSubmit}>
      <input
        type="email"
        value={form.values.email}
        onInput={(e) => form.handleChange('email', e.target.value)}
        onBlur={() => form.handleBlur('email')}
      />
      {form.touched.email && form.errors.email && (
        <div class="error">{form.errors.email}</div>
      )}

      <button type="submit" disabled={!form.isValid()}>
        Submit
      </button>
    </form>
  );
});
```

---

### How do I validate forms?

**Sync validation**:
```typescript
const form = createForm({
  initialValues: { email: '', age: 0 },
  validate: (values) => {
    const errors: any = {};

    if (!values.email) {
      errors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(values.email)) {
      errors.email = 'Email is invalid';
    }

    if (values.age < 18) {
      errors.age = 'Must be 18 or older';
    }

    return errors;
  },
  onSubmit: handleSubmit
});
```

**Async validation**:
```typescript
const form = createForm({
  initialValues: { username: '' },
  validate: async (values) => {
    const errors: any = {};

    if (values.username) {
      const isAvailable = await checkUsernameAvailability(values.username);
      if (!isAvailable) {
        errors.username = 'Username is already taken';
      }
    }

    return errors;
  },
  onSubmit: handleSubmit
});
```

**Schema validation (Zod)**:
```typescript
import { z } from 'zod';
import { validateSchema } from '@nexus/forms';

const userSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Must be at least 8 characters'),
  age: z.number().min(18, 'Must be 18 or older')
});

const form = createForm({
  initialValues: { email: '', password: '', age: 0 },
  validate: (values) => validateSchema(userSchema, values),
  onSubmit: handleSubmit
});
```

---

### How do I handle file uploads?

**Basic file upload**:
```typescript
export const FileUpload = defineComponent(() => {
  const file = signal<File | null>(null);
  const uploading = signal(false);

  const handleFileChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const selectedFile = target.files?.[0];
    if (selectedFile) {
      file.set(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file()) return;

    uploading.set(true);

    const formData = new FormData();
    formData.append('file', file()!);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        console.log('Upload successful');
      }
    } finally {
      uploading.set(false);
    }
  };

  return () => (
    <div>
      <input type="file" onChange={handleFileChange} />
      <button onClick={handleUpload} disabled={!file() || uploading()}>
        {uploading() ? 'Uploading...' : 'Upload'}
      </button>
    </div>
  );
});
```

**With preview**:
```typescript
export const ImageUpload = defineComponent(() => {
  const file = signal<File | null>(null);
  const preview = signal<string | null>(null);

  const handleFileChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const selectedFile = target.files?.[0];

    if (selectedFile) {
      file.set(selectedFile);

      const reader = new FileReader();
      reader.onload = (e) => {
        preview.set(e.target?.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  return () => (
    <div>
      <input type="file" accept="image/*" onChange={handleFileChange} />
      <Show when={preview()}>
        <img src={preview()!} alt="Preview" style={{ 'max-width': '200px' }} />
      </Show>
    </div>
  );
});
```

---

## Styling

### What styling options are available?

Nexus supports **all major styling approaches**:

**1. CSS Modules**:
```typescript
import styles from './Button.module.css';

export const Button = defineComponent(() => {
  return () => <button class={styles.button}>Click me</button>;
});
```

**2. Scoped CSS with `css` tag**:
```typescript
import { css } from '@nexus/styling';

export const Button = defineComponent(() => {
  const buttonClass = css`
    padding: 8px 16px;
    background: blue;
    color: white;
  `;

  return () => <button class={buttonClass}>Click me</button>;
});
```

**3. styled components**:
```typescript
import { styled } from '@nexus/styling';

const Button = styled('button')`
  padding: 8px 16px;
  background: ${props => props.variant === 'primary' ? 'blue' : 'gray'};
  color: white;
`;

export const MyButton = defineComponent(() => {
  return () => <Button variant="primary">Click me</Button>;
});
```

**4. Tailwind CSS**:
```typescript
export const Button = defineComponent(() => {
  return () => (
    <button class="px-4 py-2 bg-blue-500 text-white rounded">
      Click me
    </button>
  );
});
```

**5. Inline styles**:
```typescript
export const Button = defineComponent(() => {
  return () => (
    <button style={{ padding: '8px 16px', background: 'blue', color: 'white' }}>
      Click me
    </button>
  );
});
```

---

### How do I implement theming?

Use the `ThemeProvider` and `useTheme` hook:

```typescript
// theme.ts
export interface Theme {
  colors: {
    primary: string;
    secondary: string;
    text: string;
  };
  spacing: {
    sm: string;
    md: string;
    lg: string;
  };
}

export const lightTheme: Theme = {
  colors: {
    primary: '#0066cc',
    secondary: '#6c757d',
    text: '#212529'
  },
  spacing: {
    sm: '8px',
    md: '16px',
    lg: '24px'
  }
};

export const darkTheme: Theme = {
  colors: {
    primary: '#4da6ff',
    secondary: '#adb5bd',
    text: '#f8f9fa'
  },
  spacing: {
    sm: '8px',
    md: '16px',
    lg: '24px'
  }
};

// App.tsx
import { ThemeProvider } from '@nexus/theming';

export const App = defineComponent(() => {
  const theme = signal<'light' | 'dark'>('light');

  const currentTheme = computed(() =>
    theme() === 'light' ? lightTheme : darkTheme
  );

  return () => (
    <ThemeProvider theme={currentTheme()}>
      <AppContent />
    </ThemeProvider>
  );
});

// Component.tsx
export const Button = defineComponent(() => {
  const theme = useTheme<Theme>();

  return () => (
    <button style={{
      background: theme.colors.primary,
      padding: theme.spacing.md,
      color: 'white'
    }}>
      Click me
    </button>
  );
});
```

---

### Can I use Tailwind CSS?

**Yes!** Tailwind is fully supported:

**1. Install Tailwind**:
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**2. Configure `tailwind.config.js`**:
```javascript
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
```

**3. Add directives to CSS**:
```css
/* src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**4. Use in components**:
```typescript
export const Card = defineComponent(() => {
  return () => (
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-2xl font-bold mb-4">Title</h2>
      <p class="text-gray-600">Content</p>
    </div>
  );
});
```

---

## Server-Side Rendering

### How do I enable SSR?

SSR is **enabled by default** in Nexus! Just build and run:

```bash
npm run build
npm run start
```

To configure SSR options:

```typescript
// nexus.config.ts
export default {
  ssr: {
    enabled: true,
    streaming: true, // Stream HTML for faster TTFB
    prerender: ['/about', '/contact'], // Pre-render specific routes
  }
};
```

---

### What's the difference between SSR, SSG, and ISR?

**SSR (Server-Side Rendering)**:
- Renders on **every request**
- Fresh data every time
- Slower TTFB (Time To First Byte)
- Use for: Dynamic, user-specific content

```typescript
// Rendered server-side on every request
export default defineComponent(() => {
  const [user] = resource(() => getCurrentUser());

  return () => <div>Welcome, {user()?.name}</div>;
});
```

**SSG (Static Site Generation)**:
- Renders at **build time**
- Serves static HTML
- Fast TTFB
- Use for: Blog posts, marketing pages

```typescript
// Rendered once at build time
export const prerender = true;

export default defineComponent(() => {
  return () => (
    <div>
      <h1>About Us</h1>
      <p>This content is static.</p>
    </div>
  );
});
```

**ISR (Incremental Static Regeneration)**:
- Renders at **build time**, revalidates periodically
- Combines SSG speed with fresh data
- Use for: Product pages, news articles

```typescript
// Regenerate every 60 seconds
export const revalidate = 60;

export default defineComponent(() => {
  const [posts] = resource(() => fetchPosts());

  return () => (
    <For each={posts()}>
      {(post) => <PostCard post={post} />}
    </For>
  );
});
```

---

### How do I handle client-only code?

**Option 1: Check `isServer`**:
```typescript
import { isServer } from '@nexus/core';

export const Analytics = defineComponent(() => {
  onMount(() => {
    if (!isServer) {
      // Only runs on client
      window.gtag('event', 'page_view');
    }
  });

  return () => null;
});
```

**Option 2: Use `clientOnly` wrapper**:
```typescript
import { clientOnly } from '@nexus/core';

const ClientOnlyMap = clientOnly(() => import('./Map'));

export const LocationPage = defineComponent(() => {
  return () => (
    <div>
      <h1>Our Location</h1>
      <ClientOnlyMap />
    </div>
  );
});
```

**Option 3: Dynamic import in `onMount`**:
```typescript
export const Chart = defineComponent(() => {
  const ChartComponent = signal<any>(null);

  onMount(async () => {
    const module = await import('./ChartComponent');
    ChartComponent.set(() => module.default);
  });

  return () => (
    <Show when={ChartComponent()} fallback={<Loading />}>
      <ChartComponent() />
    </Show>
  );
});
```

---

### How does hydration work?

Nexus uses **progressive hydration**:

1. Server renders HTML
2. HTML sent to browser (fast FCP)
3. JavaScript loads
4. Components hydrate on interaction or visibility

**Hydration modes**:

```typescript
// Eager hydration (default)
export default defineComponent(() => {
  return () => <div>Hydrates immediately</div>;
});

// Lazy hydration (on viewport)
export const hydrate = 'visible';

export default defineComponent(() => {
  return () => <div>Hydrates when visible</div>;
});

// Idle hydration (when browser idle)
export const hydrate = 'idle';

export default defineComponent(() => {
  return () => <div>Hydrates when idle</div>;
});

// Manual hydration (on interaction)
export const hydrate = 'interaction';

export default defineComponent(() => {
  return () => <button>Hydrates on click</button>;
});
```

---

## Performance

### How do I optimize bundle size?

**1. Use code-splitting**:
```typescript
const Dashboard = lazy(() => import('./routes/Dashboard'));
const Profile = lazy(() => import('./routes/Profile'));
```

**2. Tree-shake unused code**:
```typescript
// Import only what you need
import { signal, computed } from '@nexus/core';

// Instead of
import * as Nexus from '@nexus/core';
```

**3. Use islands for interactive components**:
```typescript
export const island = true; // Only ships JS for this component

export default defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(c => c + 1)}>
      Count: {count()}
    </button>
  );
});
```

**4. Analyze bundle**:
```bash
npm run build -- --analyze
```

---

### How do I improve initial page load?

**1. Use SSR/SSG**:
- Faster First Contentful Paint (FCP)
- Better SEO
- Works without JavaScript

**2. Preload critical resources**:
```tsx
<Head>
  <link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/styles/critical.css" as="style" />
</Head>
```

**3. Lazy load images**:
```tsx
<img src="/hero.jpg" loading="lazy" alt="Hero" />
```

**4. Use route-based code splitting**:
```typescript
// Routes are automatically code-split
// src/routes/about.tsx - separate bundle
// src/routes/contact.tsx - separate bundle
```

**5. Minimize third-party scripts**:
```tsx
// Load analytics after initial render
onMount(() => {
  if (!isServer) {
    const script = document.createElement('script');
    script.src = 'https://www.googletagmanager.com/gtag/js';
    script.async = true;
    document.head.appendChild(script);
  }
});
```

---

### How do I optimize rendering performance?

**1. Avoid inline functions in JSX** (when possible):
```typescript
// Good
const handleClick = () => count.set(c => c + 1);
return () => <button onClick={handleClick}>Click</button>;

// Less ideal (creates new function each render)
return () => <button onClick={() => count.set(c => c + 1)}>Click</button>;
```

**2. Use `For` instead of `.map()`**:
```typescript
// Good - optimized by compiler
<For each={items()}>
  {(item) => <Item item={item} />}
</For>

// Less ideal - creates new array
{items().map(item => <Item item={item} />)}
```

**3. Use `computed` for derived values**:
```typescript
// Good
const filtered = computed(() => items().filter(i => i.active));

// Less ideal - filters on every render
return () => <div>{items().filter(i => i.active).length}</div>;
```

**4. Virtualize long lists**:
```typescript
import { VirtualList } from '@nexus/primitives';

<VirtualList
  items={items()}
  itemHeight={50}
  height={500}
  renderItem={(item) => <Item item={item} />}
/>
```

---

## Testing

### How do I test components?

Use `@nexus/testing` (based on Testing Library):

```typescript
import { render, screen, fireEvent } from '@nexus/testing';
import { Counter } from './Counter';

describe('Counter', () => {
  it('increments count when button is clicked', () => {
    render(Counter);

    const button = screen.getByRole('button', { name: 'Increment' });
    const count = screen.getByText('Count: 0');

    fireEvent.click(button);

    expect(screen.getByText('Count: 1')).toBeInTheDocument();
  });

  it('renders with initial count', () => {
    render(Counter, { props: { initialCount: 5 } });

    expect(screen.getByText('Count: 5')).toBeInTheDocument();
  });
});
```

---

### How do I test components with context?

Provide context via `wrapper` option:

```typescript
import { render, screen } from '@nexus/testing';

const wrapper = defineComponent((props) => {
  return () => (
    <ThemeProvider theme={lightTheme}>
      <AuthProvider user={mockUser}>
        {props.children}
      </AuthProvider>
    </ThemeProvider>
  );
});

describe('ProtectedComponent', () => {
  it('renders when authenticated', () => {
    render(ProtectedComponent, { wrapper });

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });
});
```

---

### How do I test async code?

Use `waitFor` for async assertions:

```typescript
import { render, screen, waitFor } from '@nexus/testing';

describe('UserProfile', () => {
  it('loads and displays user data', async () => {
    render(UserProfile, { props: { userId: '123' } });

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('handles errors', async () => {
    // Mock fetch to return error
    global.fetch = jest.fn(() => Promise.reject(new Error('Failed')));

    render(UserProfile, { props: { userId: '123' } });

    await waitFor(() => {
      expect(screen.getByText('Error loading user')).toBeInTheDocument();
    });
  });
});
```

---

## Deployment

### How do I deploy a Nexus app?

Nexus apps can be deployed to:

**1. Vercel** (recommended):
```bash
npm install -g vercel
vercel deploy
```

**2. Netlify**:
```bash
npm install -g netlify-cli
netlify deploy --prod
```

**3. Node.js server**:
```bash
npm run build
node server.js
```

**4. Docker**:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "server.js"]
```

**5. Static hosting** (for SSG):
```bash
npm run build -- --static
# Upload dist/ to S3, Cloudflare Pages, etc.
```

---

### How do I configure environment variables?

**1. Create `.env` file**:
```
VITE_API_URL=https://api.example.com
VITE_GA_ID=UA-123456789
DATABASE_URL=postgresql://user:pass@localhost:5432/db
```

**2. Access in code**:
```typescript
// Client-side (VITE_ prefix required)
const apiUrl = import.meta.env.VITE_API_URL;

// Server-side (any prefix)
const dbUrl = process.env.DATABASE_URL;
```

**3. Production env vars**:
- Vercel: Dashboard → Settings → Environment Variables
- Netlify: Dashboard → Site settings → Environment variables
- Docker: Pass via `docker run -e VAR=value`

---

### How do I enable HTTPS in production?

**Option 1: Use platform HTTPS** (recommended):
- Vercel, Netlify, Cloudflare Pages provide free HTTPS
- No configuration needed

**Option 2: Let's Encrypt with Nginx**:
```nginx
server {
  listen 443 ssl http2;
  server_name example.com;

  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

  location / {
    proxy_pass http://localhost:3000;
  }
}
```

**Option 3: Cloudflare CDN**:
- Point domain to Cloudflare
- Enable SSL/TLS (Full or Strict mode)
- No server configuration needed

---

## Titan Integration

### How do I call Titan services from the frontend?

Use `useRPC` for type-safe RPC calls:

```typescript
// server/calculator.service.ts
@Service('calculator@1.0.0')
export class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }

  @Public()
  async divide(a: number, b: number): Promise<number> {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  }
}

// client/Calculator.tsx
import type { CalculatorService } from '../server/calculator.service';

export const Calculator = defineComponent(() => {
  const calc = useRPC<CalculatorService>('calculator@1.0.0');
  const result = signal<number | null>(null);

  const handleAdd = async () => {
    const sum = await calc.add(5, 3);
    result.set(sum);
  };

  return () => (
    <div>
      <button onClick={handleAdd}>Add 5 + 3</button>
      {result() !== null && <div>Result: {result()}</div>}
    </div>
  );
});
```

---

### How do I handle WebSocket connections?

Use `useWebSocket` hook:

```typescript
export const Chat = defineComponent(() => {
  const messages = signal<Message[]>([]);
  const message = signal('')

  const ws = useWebSocket('ws://localhost:3000/chat', {
    reconnect: true,
    reconnectInterval: 1000
  });

  ws.on('message', (event) => {
    const msg = JSON.parse(event.data);
    messages.set((prev) => [...prev, msg]);
  });

  const sendMessage = () => {
    ws.send(JSON.stringify({ text: message(), timestamp: Date.now() }));
    message.set('');
  };

  onCleanup(() => {
    ws.close();
  });

  return () => (
    <div>
      <For each={messages()}>
        {(msg) => <div>{msg.text}</div>}
      </For>
      <input value={message()} onInput={(e) => message.set(e.target.value)} />
      <button onClick={sendMessage}>Send</button>
    </div>
  );
});
```

---

### How do I use Titan's DI container in the frontend?

Titan's DI works seamlessly in frontend:

```typescript
// shared/user.service.ts
@Injectable()
export class UserService {
  private currentUser = signal<User | null>(null);

  async login(credentials: Credentials) {
    const user = await this.authService.login(credentials);
    this.currentUser[1](user);
  }

  logout() {
    this.currentUser[1](null);
  }

  getUser() {
    return this.currentUser[0];
  }
}

// app.module.tsx
import { defineModule } from 'nexus';

export const AppModule = defineModule({
  id: 'app',
  providers: [UserService],
  exportProviders: [UserService]
});

// app.tsx
export const App = defineComponent(() => {
  const userService = inject(UserService);
  const user = userService.getUser();

  return () => (
    <Show when={user()} fallback={<LoginForm />}>
      <Dashboard user={user()!} />
    </Show>
  );
});
```

---

## Migration

### How do I migrate from React?

**1. Component syntax**:
```typescript
// React
function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => count.set(count + 1)}>+</button>
    </div>
  );
}

// Nexus
export const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
    </div>
  );
});
```

**2. Effects**:
```typescript
// React
useEffect(() => {
  console.log(count);
}, [count]);

// Nexus
createEffect(() => {
  console.log(count());
});
```

**3. Computed values**:
```typescript
// React
const doubled = useMemo(() => count * 2, [count]);

// Nexus
const doubled = computed(() => count() * 2);
```

**4. Context**:
```typescript
// React
const ThemeContext = React.createContext();
<ThemeContext.Provider value={theme}>

// Nexus
const ThemeContext = createContext();
<ThemeContext.Provider value={theme}>
```

See [Migration Guide](35-MIGRATION.md) for complete details.

---

### How do I migrate from Vue?

**1. Reactivity**:
```typescript
// Vue
const count = ref(0);
const doubled = computed(() => count.value * 2);
watch(count, (newVal) => console.log(newVal));

// Nexus
const count = signal(0);
const doubled = computed(() => count() * 2);
createEffect(() => console.log(count()));
```

**2. Components**:
```vue
<!-- Vue SFC -->
<template>
  <div>{{ message }}</div>
</template>

<script setup>
import { ref } from 'vue';
const message = ref('Hello');
</script>
```

```typescript
// Nexus
export const MyComponent = defineComponent(() => {
  const message = signal('Hello');

  return () => <div>{message()}</div>;
});
```

**3. Lifecycle**:
```typescript
// Vue
onMounted(() => { /* ... */ });
onUnmounted(() => { /* ... */ });

// Nexus
onMount(() => { /* ... */ });
onCleanup(() => { /* ... */ });
```

See [Migration Guide](35-MIGRATION.md) for complete details.

---

## Troubleshooting

### Why isn't my component updating?

**Problem**: You're not calling the signal getter:

```typescript
// ❌ Wrong - not reactive
const name = signal('Alice');
return () => <div>{name}</div>;

// ✅ Correct - calls getter
const name = signal('Alice');
return () => <div>{name()}</div>;
```

**Problem**: Destructuring signals:

```typescript
// ❌ Wrong - loses reactivity
const count = signal(0);
const { value } = count; // Don't do this

// ✅ Correct - keep getter
const count = signal(0);
return () => <div>{count()}</div>;
```

---

### Why is my effect running infinitely?

**Problem**: Effect creates a dependency cycle:

```typescript
// ❌ Wrong - infinite loop
const count = signal(0);

createEffect(() => {
  count.set(count() + 1); // Creates new dependency every run
});

// ✅ Correct - conditional update or use untrack
const count = signal(0);

createEffect(() => {
  if (count() < 10) {
    count.set(c => c + 1);
  }
});
```

---

### Why does my app flash unstyled content?

**Problem**: CSS not loading before hydration.

**Solution 1**: Inline critical CSS:

```typescript
<Head>
  <style>{criticalCSS}</style>
</Head>
```

**Solution 2**: Ensure CSS is loaded in `<Head>`:

```typescript
<Head>
  <link rel="stylesheet" href="/styles/main.css" />
</Head>
```

**Solution 3**: Use CSS-in-JS with extraction:

```typescript
import { css } from '@nexus/styling';

const buttonClass = css`
  /* Styles extracted to CSS file at build */
  padding: 8px 16px;
  background: blue;
`;
```

---

### How do I fix hydration mismatch errors?

**Problem**: Server and client render different HTML.

**Common causes**:

**1. Client-only APIs**:
```typescript
// ❌ Wrong - window not available on server
const width = window.innerWidth;

// ✅ Correct - check isServer
const width = !isServer ? window.innerWidth : 0;
```

**2. Random values**:
```typescript
// ❌ Wrong - different on server/client
const id = Math.random();

// ✅ Correct - use stable ID
const id = crypto.randomUUID(); // Or from props/data
```

**3. Date/time**:
```typescript
// ❌ Wrong - different timestamps
const now = new Date();

// ✅ Correct - pass from server
export const data = () => ({ serverTime: new Date() });
```

**4. Conditional rendering**:
```typescript
// ❌ Wrong if isLoggedIn differs
<Show when={isLoggedIn()}>

// ✅ Correct - ensure same on server/client
```

---

## Framework Comparison

### Nexus vs React?

| Feature | Nexus | React |
|---------|-------|-------|
| **Reactivity** | Signals (fine-grained) | Hooks (coarse-grained) |
| **Re-renders** | Surgical updates | Component re-renders |
| **Bundle size** | ~6KB | ~45KB |
| **Performance** | No virtual DOM | Virtual DOM |
| **Learning curve** | Easy (if you know React) | Moderate |
| **Ecosystem** | Growing | Massive |
| **TypeScript** | First-class | Good |
| **SSR** | Built-in | Requires Next.js |
| **Backend integration** | Titan RPC | Separate setup |

**Choose Nexus if**: You want better performance, smaller bundles, and Titan integration.

**Choose React if**: You need the massive ecosystem or have existing React codebase.

---

### Nexus vs Vue?

| Feature | Nexus | Vue |
|---------|-------|-----|
| **Reactivity** | Signals | Ref/Reactive |
| **Templates** | JSX | SFC templates |
| **Performance** | Excellent | Excellent |
| **Bundle size** | ~6KB | ~35KB |
| **Learning curve** | Easy (if you know Vue) | Easy |
| **TypeScript** | First-class | Good |
| **SSR** | Built-in | Requires Nuxt |
| **Backend integration** | Titan RPC | Separate setup |

**Choose Nexus if**: You prefer JSX, want Titan integration, or need smaller bundles.

**Choose Vue if**: You prefer template syntax or need Vue's ecosystem.

---

### Nexus vs SolidJS?

| Feature | Nexus | SolidJS |
|---------|-------|---------|
| **Reactivity** | Signals (identical) | Signals |
| **Performance** | Excellent | Excellent |
| **Bundle size** | ~6KB | ~7KB |
| **Router** | File-based (built-in) | Manual config |
| **Backend integration** | Titan RPC | Separate |
| **DI/Modules** | Built-in | Manual |
| **Opinionated** | Yes | No |
| **Ecosystem** | Growing | Growing |

**Choose Nexus if**: You want opinionated framework, file-based routing, and Titan integration.

**Choose SolidJS if**: You want maximum flexibility and minimal framework.

---

## Best Practices

### What are the top 10 best practices?

1. **Use `defineComponent` for all components** - Proper reactive scope
2. **Call signal getters: `count()` not `count`** - Enable reactivity
3. **Use `computed` for derived values** - Avoid redundant calculations
4. **Batch related updates** - Single re-render
5. **Use `For` instead of `.map()`** - Better performance
6. **Use `Show` instead of `&&` or ternary** - Cleaner code
7. **Leverage TypeScript** - Catch errors early
8. **Use file-based routing** - Less boilerplate
9. **Implement proper error boundaries** - Better UX
10. **Test with Testing Library** - Confidence in refactoring

---

### How do I structure a large Nexus app?

```
src/
├── routes/              # File-based routes
│   ├── _layout.tsx      # Root layout
│   ├── index.tsx        # Home page
│   └── dashboard/
│       ├── _layout.tsx  # Dashboard layout
│       ├── index.tsx
│       └── settings.tsx
├── components/          # Reusable components
│   ├── ui/              # UI primitives (Button, Input, etc.)
│   ├── layout/          # Layout components (Header, Footer, etc.)
│   └── features/        # Feature-specific components
├── services/            # Business logic (DI services)
│   ├── auth.service.ts
│   ├── user.service.ts
│   └── api.service.ts
├── stores/              # Global state
│   ├── app.store.ts
│   └── user.store.ts
├── lib/                 # Utilities and helpers
│   ├── api.ts
│   ├── validation.ts
│   └── formatting.ts
├── types/               # TypeScript types
│   ├── models.ts
│   └── api.ts
├── styles/              # Global styles
│   ├── theme.ts
│   └── global.css
└── App.tsx              # Root component
```

---

### What are common anti-patterns to avoid?

**1. Not calling signal getters**:
```typescript
// ❌ Anti-pattern
return () => <div>{count}</div>;

// ✅ Correct
return () => <div>{count()}</div>;
```

**2. Creating signals in render**:
```typescript
// ❌ Anti-pattern
return () => {
  const count = signal(0); // Created on every render
  return <div>{count()}</div>;
};

// ✅ Correct
const count = signal(0); // Created once in setup
return () => <div>{count()}</div>;
```

**3. Using `.map()` instead of `For`**:
```typescript
// ❌ Less efficient
{items().map(item => <Item item={item} />)}

// ✅ Optimized
<For each={items()}>
  {(item) => <Item item={item} />}
</For>
```

**4. Manual dependency tracking**:
```typescript
// ❌ Not needed in Nexus (only in React)
createEffect(() => {
  console.log(count());
}, [count]); // No dependency array needed!

// ✅ Correct
createEffect(() => {
  console.log(count());
});
```

**5. Overusing global state**:
```typescript
// ❌ Anti-pattern - everything in global store
export const [globalState, setGlobalState] = createStore({
  count: 0,
  userName: '',
  isModalOpen: false,
  formData: {},
  // ... 50 more properties
});

// ✅ Correct - component-local state when possible
export const Counter = defineComponent(() => {
  const count = signal(0); // Local to component
  return () => <div>{count()}</div>;
});
```

---

## Conclusion

This FAQ covers the most common questions about Nexus. For more details:

- **Tutorial**: Start building with step-by-step guide
- **API Reference**: [38-API-REFERENCE.md](38-API-REFERENCE.md)
- **Cookbook**: [37-COOKBOOK.md](37-COOKBOOK.md)
- **Migration Guides**: [35-MIGRATION.md](35-MIGRATION.md)
- **Discord**: Join the community for help
- **GitHub**: Report issues and contribute

**Still have questions?**

- Check the [documentation](https://nexus.dev/docs)
- Ask on [Discord](https://discord.gg/nexus)
- Open a [GitHub discussion](https://github.com/nexus/nexus/discussions)
- Tweet [@nexusjs](https://twitter.com/nexusjs)

---

**Version History**:

- 1.0.0 (2025-10-06): Initial FAQ

**Contributors**: Nexus Core Team

**License**: MIT
