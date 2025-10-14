# Getting Started with Aether

Aether is a minimalist, high-performance frontend framework built with fine-grained reactivity and a clean, composable API. This guide will help you get started with your first Aether application.

## Installation

Install Aether using your preferred package manager:

```bash
# Using npm
npm install @omnitron-dev/aether

# Using yarn
yarn add @omnitron-dev/aether

# Using pnpm
pnpm add @omnitron-dev/aether

# Using bun
bun add @omnitron-dev/aether
```

## Quick Start

### 1. Create Your First Component

Create a simple counter component using Aether's reactive primitives:

```typescript
import { signal, computed, defineComponent } from '@omnitron-dev/aether';

const Counter = defineComponent(() => {
  const count = signal(0);
  const doubled = computed(() => count() * 2);

  const increment = () => count(count() + 1);
  const decrement = () => count(count() - 1);

  return () => (
    <div class="counter">
      <h1>Counter: {count()}</h1>
      <p>Doubled: {doubled()}</p>
      <button onClick={increment}>+</button>
      <button onClick={decrement}>-</button>
    </div>
  );
});

export default Counter;
```

### 2. Mount Your Application

Create an entry point for your application:

```typescript
import { createApp } from '@omnitron-dev/aether';
import Counter from './Counter';

const app = createApp(Counter);
app.mount('#app');
```

### 3. Set Up Your HTML

Create an `index.html` file:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aether App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

## Core Concepts

### Signals: Fine-Grained Reactivity

Signals are the building blocks of reactivity in Aether. They hold values and notify dependents when they change.

```typescript
import { signal } from '@omnitron-dev/aether';

// Create a signal
const count = signal(0);

// Read a signal
console.log(count()); // 0

// Update a signal
count(1);
console.log(count()); // 1

// Update based on previous value
count(prev => prev + 1);
console.log(count()); // 2
```

### Computed: Derived Values

Computed values automatically update when their dependencies change:

```typescript
import { signal, computed } from '@omnitron-dev/aether';

const firstName = signal('John');
const lastName = signal('Doe');

const fullName = computed(() => `${firstName()} ${lastName()}`);

console.log(fullName()); // "John Doe"

firstName('Jane');
console.log(fullName()); // "Jane Doe"
```

### Effects: Side Effects

Effects run automatically when their dependencies change:

```typescript
import { signal, effect } from '@omnitron-dev/aether';

const count = signal(0);

// This effect runs immediately and whenever count changes
effect(() => {
  console.log(`Count is now: ${count()}`);
});

count(1); // Logs: "Count is now: 1"
count(2); // Logs: "Count is now: 2"
```

### Components: Building UI

Components in Aether are simple functions that return render functions:

```typescript
import { defineComponent, signal } from '@omnitron-dev/aether';

const TodoItem = defineComponent<{ text: string; completed: boolean }>((props) => {
  const isCompleted = signal(props.completed);

  const toggle = () => isCompleted(!isCompleted());

  return () => (
    <li class={isCompleted() ? 'completed' : ''}>
      <input type="checkbox" checked={isCompleted()} onChange={toggle} />
      <span>{props.text}</span>
    </li>
  );
});

const TodoList = defineComponent(() => {
  const todos = signal([
    { id: 1, text: 'Learn Aether', completed: false },
    { id: 2, text: 'Build an app', completed: false }
  ]);

  return () => (
    <ul>
      {todos().map(todo => (
        <TodoItem key={todo.id} text={todo.text} completed={todo.completed} />
      ))}
    </ul>
  );
});
```

## Project Setup with Vite

Aether works seamlessly with Vite for a fast development experience.

### 1. Create a New Vite Project

```bash
npm create vite@latest my-aether-app -- --template vanilla-ts
cd my-aether-app
npm install
npm install @omnitron-dev/aether
```

### 2. Configure Vite

Update your `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import aether from '@omnitron-dev/aether/vite';

export default defineConfig({
  plugins: [aether()],
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from '@omnitron-dev/aether'`
  }
});
```

### 3. Update tsconfig.json

Configure TypeScript for JSX:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "jsxImportSource": "@omnitron-dev/aether",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

## TypeScript Configuration

For the best development experience, configure TypeScript with Aether's types:

```typescript
// src/types/jsx.d.ts
import '@omnitron-dev/aether';

declare module '@omnitron-dev/aether' {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}
```

## Simple Examples

### Example 1: Form Handling

```typescript
import { signal, defineComponent } from '@omnitron-dev/aether';

const LoginForm = defineComponent(() => {
  const email = signal('');
  const password = signal('');
  const error = signal('');

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    error('');

    if (!email() || !password()) {
      error('Please fill in all fields');
      return;
    }

    try {
      // Simulate API call
      await login(email(), password());
    } catch (err) {
      error('Login failed');
    }
  };

  return () => (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email()}
        onInput={(e) => email(e.target.value)}
        placeholder="Email"
      />
      <input
        type="password"
        value={password()}
        onInput={(e) => password(e.target.value)}
        placeholder="Password"
      />
      {error() && <div class="error">{error()}</div>}
      <button type="submit">Login</button>
    </form>
  );
});
```

### Example 2: Data Fetching

```typescript
import { signal, effect, defineComponent } from '@omnitron-dev/aether';

interface User {
  id: number;
  name: string;
  email: string;
}

const UserProfile = defineComponent<{ userId: number }>((props) => {
  const user = signal<User | null>(null);
  const loading = signal(true);
  const error = signal('');

  effect(() => {
    const fetchUser = async () => {
      loading(true);
      error('');

      try {
        const response = await fetch(`/api/users/${props.userId}`);
        const data = await response.json();
        user(data);
      } catch (err) {
        error('Failed to load user');
      } finally {
        loading(false);
      }
    };

    fetchUser();
  });

  return () => {
    if (loading()) return <div>Loading...</div>;
    if (error()) return <div class="error">{error()}</div>;
    if (!user()) return <div>No user found</div>;

    return (
      <div class="user-profile">
        <h2>{user()!.name}</h2>
        <p>{user()!.email}</p>
      </div>
    );
  };
});
```

### Example 3: List Management

```typescript
import { signal, defineComponent } from '@omnitron-dev/aether';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

const TodoApp = defineComponent(() => {
  const todos = signal<Todo[]>([]);
  const newTodo = signal('');
  let nextId = 1;

  const addTodo = () => {
    if (!newTodo().trim()) return;

    todos([
      ...todos(),
      { id: nextId++, text: newTodo(), completed: false }
    ]);
    newTodo('');
  };

  const toggleTodo = (id: number) => {
    todos(todos().map(todo =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  const removeTodo = (id: number) => {
    todos(todos().filter(todo => todo.id !== id));
  };

  const remaining = () => todos().filter(t => !t.completed).length;

  return () => (
    <div class="todo-app">
      <h1>Todo List</h1>
      <div class="add-todo">
        <input
          value={newTodo()}
          onInput={(e) => newTodo(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && addTodo()}
          placeholder="What needs to be done?"
        />
        <button onClick={addTodo}>Add</button>
      </div>
      <ul class="todo-list">
        {todos().map(todo => (
          <li key={todo.id} class={todo.completed ? 'completed' : ''}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo.id)}
            />
            <span>{todo.text}</span>
            <button onClick={() => removeTodo(todo.id)}>×</button>
          </li>
        ))}
      </ul>
      <div class="footer">
        {remaining()} item{remaining() !== 1 ? 's' : ''} remaining
      </div>
    </div>
  );
});
```

## Next Steps

Now that you understand the basics, explore more advanced features:

- **Routing**: Add navigation to your app with the built-in router
- **Forms**: Use the forms module for validation and submission
- **State Management**: Organize complex state with stores
- **Server-Side Rendering**: Enable SSR for better performance
- **Testing**: Write tests with Aether's testing utilities

Check out the [API Reference](./api-reference.md) for complete documentation of all features.

## Best Practices

1. **Keep components small**: Break down complex UIs into smaller, reusable components
2. **Use computed for derived state**: Don't duplicate state; derive it when possible
3. **Avoid unnecessary effects**: Effects should only be used for side effects, not derived state
4. **Leverage TypeScript**: Take advantage of full type safety for props and state
5. **Think in signals**: Embrace fine-grained reactivity instead of component re-renders

## Common Patterns

### Conditional Rendering

```typescript
const conditional = signal(true);

return () => (
  <div>
    {conditional() && <p>This is shown conditionally</p>}
    {conditional() ? <p>True branch</p> : <p>False branch</p>}
  </div>
);
```

### Refs for DOM Access

```typescript
import { ref } from '@omnitron-dev/aether';

const inputRef = ref<HTMLInputElement>();

const focusInput = () => {
  inputRef.current?.focus();
};

return () => (
  <div>
    <input ref={inputRef} type="text" />
    <button onClick={focusInput}>Focus Input</button>
  </div>
);
```

### Custom Hooks

```typescript
function useCounter(initialValue = 0) {
  const count = signal(initialValue);
  const increment = () => count(count() + 1);
  const decrement = () => count(count() - 1);
  const reset = () => count(initialValue);

  return { count, increment, decrement, reset };
}

const Counter = defineComponent(() => {
  const { count, increment, decrement, reset } = useCounter(0);

  return () => (
    <div>
      <p>Count: {count()}</p>
      <button onClick={increment}>+</button>
      <button onClick={decrement}>-</button>
      <button onClick={reset}>Reset</button>
    </div>
  );
});
```

## Resources

- [API Reference](./api-reference.md) - Complete API documentation
- [Performance Guide](./performance-guide.md) - Optimization techniques
- [Migration Guide](./migration-guide.md) - Migrate from other frameworks
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

## Community

- GitHub: [omnitron-dev/omni](https://github.com/omnitron-dev/omni)
- Discord: [Join our community](https://discord.gg/omnitron)
- Twitter: [@omnitrondev](https://twitter.com/omnitrondev)

Happy building with Aether!
