# Migration Guide

This guide helps you migrate to Aether from other popular frameworks.

## Table of Contents

- [Migrating from React](#migrating-from-react)
- [Migrating from Vue](#migrating-from-vue)
- [Migrating from Solid](#migrating-from-solid)
- [Version Migration](#version-migration)

---

## Migrating from React

Aether's API will feel familiar if you're coming from React, but there are important differences due to fine-grained reactivity.

### Component Syntax

**React:**
```typescript
function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}
```

**Aether:**
```typescript
const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => count(count() + 1)}>Increment</button>
    </div>
  );
});
```

**Key Differences:**
- Use `signal()` instead of `useState()`
- Signals are called as functions: `count()` to read, `count(value)` to set
- Component returns a render function, not JSX directly
- No need for dependency arrays - reactivity is automatic

### Props

**React:**
```typescript
interface ButtonProps {
  label: string;
  onClick: () => void;
}

function Button({ label, onClick }: ButtonProps) {
  return <button onClick={onClick}>{label}</button>;
}
```

**Aether:**
```typescript
interface ButtonProps {
  label: string;
  onClick: () => void;
}

const Button = defineComponent<ButtonProps>((props) => {
  return () => <button onClick={props.onClick}>{props.label}</button>;
});
```

**Key Differences:**
- Props are accessed through the `props` object in the setup function
- Props are reactive - no need to destructure in the render function
- Props changes automatically trigger re-renders of affected parts

### Effects and Lifecycle

**React:**
```typescript
function DataFetcher({ userId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchUser(userId).then(setData);
  }, [userId]);

  useEffect(() => {
    console.log('Component mounted');
    return () => console.log('Component unmounted');
  }, []);

  return <div>{data?.name}</div>;
}
```

**Aether:**
```typescript
const DataFetcher = defineComponent<{ userId: number }>((props) => {
  const data = signal(null);

  // Effect automatically tracks userId
  effect(() => {
    fetchUser(props.userId).then(data);
  });

  // One-time setup
  onMount(() => {
    console.log('Component mounted');
  });

  onCleanup(() => {
    console.log('Component unmounted');
  });

  return () => <div>{data()?.name}</div>;
});
```

**Key Differences:**
- No dependency arrays - tracking is automatic
- Use `onMount()` for one-time setup
- Use `onCleanup()` for cleanup
- Effects run immediately and on dependency changes

### Computed Values

**React:**
```typescript
function UserProfile({ user }) {
  const fullName = useMemo(
    () => `${user.firstName} ${user.lastName}`,
    [user.firstName, user.lastName]
  );

  return <div>{fullName}</div>;
}
```

**Aether:**
```typescript
const UserProfile = defineComponent<{ user: User }>((props) => {
  const fullName = computed(() =>
    `${props.user.firstName} ${props.user.lastName}`
  );

  return () => <div>{fullName()}</div>;
});
```

**Key Differences:**
- Use `computed()` instead of `useMemo()`
- No dependency array needed
- Computed values are cached and only recompute when dependencies change

### Context

**React:**
```typescript
const ThemeContext = createContext('light');

function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Button />
    </ThemeContext.Provider>
  );
}

function Button() {
  const theme = useContext(ThemeContext);
  return <button className={theme}>Click</button>;
}
```

**Aether:**
```typescript
const ThemeContext = createContext('light');

const App = defineComponent(() => {
  return () => (
    <ThemeContext.Provider value="dark">
      <Button />
    </ThemeContext.Provider>
  );
});

const Button = defineComponent(() => {
  const theme = useContext(ThemeContext);
  return () => <button class={theme}>Click</button>;
});
```

**Key Differences:**
- Very similar API
- Context values in Aether can be signals for reactivity

### Conditional Rendering

**React:**
```typescript
function Conditional({ show }) {
  return (
    <div>
      {show && <p>Visible</p>}
      {show ? <p>True</p> : <p>False</p>}
    </div>
  );
}
```

**Aether:**
```typescript
const Conditional = defineComponent<{ show: boolean }>((props) => {
  return () => (
    <div>
      {props.show && <p>Visible</p>}
      {props.show ? <p>True</p> : <p>False</p>}
    </div>
  );
});
```

**Key Differences:**
- Same syntax
- In Aether, only the conditional part re-renders, not the entire component

### Lists

**React:**
```typescript
function TodoList({ todos }) {
  return (
    <ul>
      {todos.map(todo => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}
```

**Aether:**
```typescript
const TodoList = defineComponent<{ todos: Todo[] }>((props) => {
  return () => (
    <ul>
      {props.todos.map(todo => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
});
```

**Key Differences:**
- Same `key` prop for list optimization
- Aether's reconciler is more efficient with keyed lists

### Forms

**React:**
```typescript
function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    login(email, password);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Login</button>
    </form>
  );
}
```

**Aether:**
```typescript
const LoginForm = defineComponent(() => {
  const email = signal('');
  const password = signal('');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    login(email(), password());
  };

  return () => (
    <form onSubmit={handleSubmit}>
      <input
        value={email()}
        onInput={(e) => email(e.target.value)}
      />
      <input
        type="password"
        value={password()}
        onInput={(e) => password(e.target.value)}
      />
      <button type="submit">Login</button>
    </form>
  );
});
```

**Key Differences:**
- Use `onInput` instead of `onChange` for better reactivity
- Access values with `email()`, set with `email(value)`

### Performance Optimization

**React:**
```typescript
const MemoizedComponent = React.memo(ExpensiveComponent);

function Parent() {
  const handleClick = useCallback(() => {
    console.log('clicked');
  }, []);

  return <MemoizedComponent onClick={handleClick} />;
}
```

**Aether:**
```typescript
// No memoization needed - components don't re-render unnecessarily
const ExpensiveComponent = defineComponent<{ onClick: () => void }>((props) => {
  return () => <button onClick={props.onClick}>Click</button>;
});

const Parent = defineComponent(() => {
  const handleClick = () => {
    console.log('clicked');
  };

  return () => <ExpensiveComponent onClick={handleClick} />;
});
```

**Key Differences:**
- No `React.memo`, `useMemo`, or `useCallback` needed
- Fine-grained reactivity means only affected parts update
- Functions are stable by default

### Migration Checklist

- [ ] Replace `useState` with `signal`
- [ ] Replace `useMemo` with `computed`
- [ ] Replace `useEffect` with `effect` (no dependency arrays)
- [ ] Add `() =>` before JSX in components (return render function)
- [ ] Call signals as functions: `count()` instead of `count`
- [ ] Change `onChange` to `onInput` for inputs
- [ ] Remove `React.memo`, `useCallback`, `useMemo` optimizations
- [ ] Update lifecycle methods (`useEffect` → `onMount`, `onCleanup`)
- [ ] Replace `className` with `class`
- [ ] Update refs API if using refs

---

## Migrating from Vue

Vue developers will find Aether's reactivity system familiar, though the syntax differs.

### Component Syntax

**Vue 3 (Composition API):**
```vue
<script setup>
import { ref, computed } from 'vue';

const count = ref(0);
const doubled = computed(() => count.value * 2);

function increment() {
  count.value++;
}
</script>

<template>
  <div>
    <p>Count: {{ count }}</p>
    <p>Doubled: {{ doubled }}</p>
    <button @click="increment">Increment</button>
  </div>
</template>
```

**Aether:**
```typescript
const Counter = defineComponent(() => {
  const count = signal(0);
  const doubled = computed(() => count() * 2);

  const increment = () => count(count() + 1);

  return () => (
    <div>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={increment}>Increment</button>
    </div>
  );
});
```

**Key Differences:**
- No template syntax - use JSX
- Use `count()` instead of `count.value`
- Return a render function from setup
- Event handlers use camelCase: `onClick` instead of `@click`

### Props

**Vue:**
```vue
<script setup>
const props = defineProps<{
  title: string;
  count: number;
}>();
</script>

<template>
  <div>
    <h1>{{ props.title }}</h1>
    <p>{{ props.count }}</p>
  </div>
</template>
```

**Aether:**
```typescript
interface Props {
  title: string;
  count: number;
}

const Component = defineComponent<Props>((props) => {
  return () => (
    <div>
      <h1>{props.title}</h1>
      <p>{props.count}</p>
    </div>
  );
});
```

**Key Differences:**
- Props are passed to setup function
- No `defineProps` macro
- Props are reactive by default

### Watchers

**Vue:**
```typescript
import { ref, watch, watchEffect } from 'vue';

const count = ref(0);

watch(count, (newValue, oldValue) => {
  console.log(`Count changed from ${oldValue} to ${newValue}`);
});

watchEffect(() => {
  console.log(`Count is ${count.value}`);
});
```

**Aether:**
```typescript
const count = signal(0);

// Similar to watch (manual dependency)
effect(() => {
  const current = count();
  console.log(`Count is ${current}`);
});

// To get previous value, store it
let previous = count();
effect(() => {
  const current = count();
  console.log(`Count changed from ${previous} to ${current}`);
  previous = current;
});
```

**Key Differences:**
- Use `effect()` instead of `watch` or `watchEffect`
- No separate API for immediate vs lazy watchers
- Dependencies tracked automatically

### Computed Properties

**Vue:**
```typescript
import { ref, computed } from 'vue';

const firstName = ref('John');
const lastName = ref('Doe');

const fullName = computed(() => `${firstName.value} ${lastName.value}`);

// Writable computed
const fullNameWritable = computed({
  get: () => `${firstName.value} ${lastName.value}`,
  set: (value) => {
    const [first, last] = value.split(' ');
    firstName.value = first;
    lastName.value = last;
  }
});
```

**Aether:**
```typescript
const firstName = signal('John');
const lastName = signal('Doe');

const fullName = computed(() => `${firstName()} ${lastName()}`);

// For writable computed, use a regular signal with a setter
const fullName = signal('John Doe');
const setFullName = (value: string) => {
  const [first, last] = value.split(' ');
  firstName(first);
  lastName(last);
  fullName(value);
};
```

**Key Differences:**
- Similar API
- Writable computed requires manual implementation
- Use function call syntax instead of `.value`

### Lifecycle Hooks

**Vue:**
```typescript
import { onMounted, onUnmounted, onUpdated } from 'vue';

onMounted(() => {
  console.log('Component mounted');
});

onUnmounted(() => {
  console.log('Component unmounted');
});

onUpdated(() => {
  console.log('Component updated');
});
```

**Aether:**
```typescript
onMount(() => {
  console.log('Component mounted');
});

onCleanup(() => {
  console.log('Component unmounted');
});

// No direct equivalent to onUpdated - use effect instead
effect(() => {
  // This runs on any reactive change
  console.log('Reactive value changed');
});
```

**Key Differences:**
- `onMount` instead of `onMounted`
- `onCleanup` instead of `onUnmounted`
- No `onUpdated` - use `effect` for reactive updates

### v-model

**Vue:**
```vue
<template>
  <input v-model="text" />
</template>
```

**Aether:**
```typescript
const text = signal('');

return () => (
  <input
    value={text()}
    onInput={(e) => text(e.target.value)}
  />
);
```

**Key Differences:**
- No `v-model` directive
- Manual binding with `value` and `onInput`
- More explicit but more flexible

### Directives

**Vue:**
```vue
<template>
  <div v-if="show">Visible</div>
  <div v-show="show">Toggle visibility</div>
  <div v-for="item in items" :key="item.id">{{ item.text }}</div>
</template>
```

**Aether:**
```typescript
return () => (
  <>
    {show() && <div>Visible</div>}
    <div style={{ display: show() ? 'block' : 'none' }}>Toggle visibility</div>
    {items().map(item => (
      <div key={item.id}>{item.text}</div>
    ))}
  </>
);
```

**Key Differences:**
- No template directives
- Use JavaScript expressions directly in JSX
- More flexible but requires JavaScript knowledge

### Migration Checklist

- [ ] Convert templates to JSX
- [ ] Replace `ref` with `signal`
- [ ] Change `.value` to function calls `()`
- [ ] Replace `watch`/`watchEffect` with `effect`
- [ ] Update event handlers (`@click` → `onClick`)
- [ ] Convert `v-model` to manual bindings
- [ ] Replace template directives with JavaScript
- [ ] Update lifecycle hooks names
- [ ] Remove template syntax helpers
- [ ] Adjust component definition syntax

---

## Migrating from Solid

Aether's API is heavily inspired by Solid, so migration should be straightforward.

### Component Syntax

**Solid:**
```typescript
function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);

  return (
    <div>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => setCount(count() + 1)}>Increment</button>
    </div>
  );
}
```

**Aether:**
```typescript
const Counter = defineComponent(() => {
  const count = signal(0);
  const doubled = computed(() => count() * 2);

  return () => (
    <div>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count(count() + 1)}>Increment</button>
    </div>
  );
});
```

**Key Differences:**
- Use `signal()` instead of `createSignal()` (returns single function)
- Use `computed()` instead of `createMemo()`
- Wrap component with `defineComponent()`
- Return a render function instead of JSX directly

### Signals

**Solid:**
```typescript
const [count, setCount] = createSignal(0);

console.log(count()); // Read
setCount(5); // Write
setCount(c => c + 1); // Update
```

**Aether:**
```typescript
const count = signal(0);

console.log(count()); // Read
count(5); // Write
count(c => c + 1); // Update
```

**Key Differences:**
- Single function instead of getter/setter tuple
- Same function for reading and writing
- More concise syntax

### Effects

**Solid:**
```typescript
createEffect(() => {
  console.log(`Count is ${count()}`);
});

onCleanup(() => {
  console.log('Cleanup');
});
```

**Aether:**
```typescript
effect(() => {
  console.log(`Count is ${count()}`);

  return () => {
    console.log('Cleanup');
  };
});

// Or use onCleanup
effect(() => {
  console.log(`Count is ${count()}`);
});

onCleanup(() => {
  console.log('Cleanup');
});
```

**Key Differences:**
- Use `effect()` instead of `createEffect()`
- Can return cleanup function directly
- `onCleanup` also available

### Resources

**Solid:**
```typescript
const [user] = createResource(userId, fetchUser);

return (
  <div>
    <Show when={!user.loading} fallback={<div>Loading...</div>}>
      <p>{user()?.name}</p>
    </Show>
  </div>
);
```

**Aether:**
```typescript
const user = signal(null);
const loading = signal(true);

effect(() => {
  loading(true);
  fetchUser(userId()).then(data => {
    user(data);
    loading(false);
  });
});

return () => (
  <div>
    {loading() ? (
      <div>Loading...</div>
    ) : (
      <p>{user()?.name}</p>
    )}
  </div>
);
```

**Key Differences:**
- No `createResource` - use signals and effects manually
- More explicit but more flexible
- Can use `Suspense` component for loading states

### Control Flow

**Solid:**
```typescript
import { Show, For, Switch, Match } from 'solid-js';

<Show when={condition} fallback={<div>False</div>}>
  <div>True</div>
</Show>

<For each={items()}>
  {(item, index) => <div>{item}</div>}
</For>

<Switch fallback={<div>Default</div>}>
  <Match when={value() === 'a'}><div>A</div></Match>
  <Match when={value() === 'b'}><div>B</div></Match>
</Switch>
```

**Aether:**
```typescript
// Use JavaScript expressions directly
{condition() ? <div>True</div> : <div>False</div>}

{items().map((item, index) => <div>{item}</div>)}

{value() === 'a' ? <div>A</div> :
 value() === 'b' ? <div>B</div> :
 <div>Default</div>}
```

**Key Differences:**
- No special control flow components
- Use standard JavaScript expressions
- More concise for simple cases
- May need helper functions for complex logic

### Context

**Solid:**
```typescript
const ThemeContext = createContext();

function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Button />
    </ThemeContext.Provider>
  );
}

function Button() {
  const theme = useContext(ThemeContext);
  return <button class={theme()}>Click</button>;
}
```

**Aether:**
```typescript
const ThemeContext = createContext('light');

const App = defineComponent(() => {
  return () => (
    <ThemeContext.Provider value="dark">
      <Button />
    </ThemeContext.Provider>
  );
});

const Button = defineComponent(() => {
  const theme = useContext(ThemeContext);
  return () => <button class={theme}>Click</button>;
});
```

**Key Differences:**
- Very similar API
- Context values don't need to be signals in Aether (but can be)

### Migration Checklist

- [ ] Replace `createSignal` with `signal` (single function)
- [ ] Replace `createMemo` with `computed`
- [ ] Replace `createEffect` with `effect`
- [ ] Wrap components with `defineComponent()`
- [ ] Return render functions instead of JSX directly
- [ ] Replace `createResource` with manual signal + effect
- [ ] Remove control flow components (`Show`, `For`, etc.)
- [ ] Use JavaScript expressions for conditionals and loops
- [ ] Update context API if needed (minimal changes)
- [ ] Adjust `onCleanup` usage (can return cleanup from effect)

---

## Version Migration

### Migrating from v0.x to v1.x

**Breaking Changes:**

1. **Signal API changed from tuple to single function**
   ```typescript
   // v0.x
   const [count, setCount] = signal(0);

   // v1.x
   const count = signal(0);
   ```

2. **Component definition requires `defineComponent`**
   ```typescript
   // v0.x
   function Counter() {
     return () => <div>...</div>;
   }

   // v1.x
   const Counter = defineComponent(() => {
     return () => <div>...</div>;
   });
   ```

3. **Router API restructured**
   ```typescript
   // v0.x
   import { createRouter } from '@omnitron-dev/aether';

   // v1.x
   import { Router, Route } from '@omnitron-dev/aether/router';
   ```

4. **Forms module is now separate**
   ```typescript
   // v0.x
   import { createForm } from '@omnitron-dev/aether';

   // v1.x
   import { createForm } from '@omnitron-dev/aether/forms';
   ```

5. **Testing utilities moved to separate import**
   ```typescript
   // v0.x
   import { render } from '@omnitron-dev/aether';

   // v1.x
   import { render } from '@omnitron-dev/aether/testing';
   ```

**Migration Steps:**

1. Update signal declarations
2. Wrap components with `defineComponent`
3. Update imports for router, forms, and testing
4. Test thoroughly - reactivity behavior may differ slightly
5. Update any custom utilities that depend on old APIs

---

## General Migration Tips

### Code Organization

Structure your Aether app for maintainability:

```
src/
  components/
    common/
      Button.tsx
      Input.tsx
    features/
      UserProfile.tsx
  hooks/
    useAuth.ts
    useLocalStorage.ts
  stores/
    userStore.ts
  utils/
    api.ts
  App.tsx
  main.ts
```

### State Management

For complex state, create stores:

```typescript
// stores/userStore.ts
import { signal, computed } from '@omnitron-dev/aether';

export function createUserStore() {
  const user = signal(null);
  const isAuthenticated = computed(() => user() !== null);

  const login = async (credentials) => {
    const userData = await api.login(credentials);
    user(userData);
  };

  const logout = () => {
    user(null);
  };

  return { user, isAuthenticated, login, logout };
}
```

### Performance Monitoring

Monitor your migration:

```typescript
import { effect } from '@omnitron-dev/aether';

// Track render counts during development
if (import.meta.env.DEV) {
  let renderCount = 0;
  effect(() => {
    renderCount++;
    console.log(`Component rendered ${renderCount} times`);
  });
}
```

### Testing Strategy

Test incrementally during migration:

1. Start with pure components (no state)
2. Migrate components with local state
3. Update components with shared state
4. Test interactions between components
5. Verify performance improvements

---

## Getting Help

If you encounter issues during migration:

- Check the [Troubleshooting Guide](./troubleshooting.md)
- Review the [API Reference](./api-reference.md)
- Join our [Discord community](https://discord.gg/omnitron)
- Open an issue on [GitHub](https://github.com/omnitron-dev/omni)

We're here to help make your migration smooth!
