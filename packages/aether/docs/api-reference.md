# Aether API Reference

Complete API documentation for all Aether modules and functions.

## Table of Contents

- [Core Reactivity](#core-reactivity)
  - [signal](#signal)
  - [computed](#computed)
  - [effect](#effect)
  - [batch](#batch)
  - [untrack](#untrack)
- [Components](#components)
  - [defineComponent](#definecomponent)
  - [Fragment](#fragment)
  - [Portal](#portal)
  - [Suspense](#suspense)
  - [ErrorBoundary](#errorboundary)
- [Router](#router)
  - [Router](#router-1)
  - [Route](#route)
  - [Link](#link)
  - [useNavigate](#usenavigate)
  - [useParams](#useparams)
  - [useLocation](#uselocation)
- [Forms](#forms)
  - [createForm](#createform)
  - [Field](#field)
  - [validators](#validators)
- [Testing](#testing)
  - [render](#render)
  - [screen](#screen)
  - [fireEvent](#fireevent)
  - [waitFor](#waitfor)
- [Build Tools](#build-tools)
  - [Vite Plugin](#vite-plugin)
  - [Compiler](#compiler)

---

## Core Reactivity

### signal

Creates a reactive signal that holds a value and notifies dependents when it changes.

```typescript
function signal<T>(initialValue: T): Signal<T>
```

**Parameters:**
- `initialValue: T` - The initial value of the signal

**Returns:**
- `Signal<T>` - A signal accessor/setter function

**Example:**

```typescript
import { signal } from '@omnitron-dev/aether';

// Create a signal
const count = signal(0);

// Read the value
console.log(count()); // 0

// Set a new value
count(1);

// Update based on previous value
count(prev => prev + 1);
console.log(count()); // 2
```

**Signal Methods:**

```typescript
interface Signal<T> {
  (): T;                           // Get value
  (value: T): void;                // Set value
  (updater: (prev: T) => T): void; // Update value
}
```

---

### computed

Creates a derived signal that automatically updates when its dependencies change.

```typescript
function computed<T>(computation: () => T): ReadonlySignal<T>
```

**Parameters:**
- `computation: () => T` - A function that computes the derived value

**Returns:**
- `ReadonlySignal<T>` - A read-only signal with the computed value

**Example:**

```typescript
import { signal, computed } from '@omnitron-dev/aether';

const firstName = signal('John');
const lastName = signal('Doe');

const fullName = computed(() => `${firstName()} ${lastName()}`);

console.log(fullName()); // "John Doe"

firstName('Jane');
console.log(fullName()); // "Jane Doe"
```

**Advanced Example:**

```typescript
const items = signal([1, 2, 3, 4, 5]);

const sum = computed(() => items().reduce((a, b) => a + b, 0));
const average = computed(() => sum() / items().length);

console.log(sum());     // 15
console.log(average()); // 3
```

---

### effect

Runs a side effect function automatically when its dependencies change.

```typescript
function effect(fn: () => void | (() => void)): () => void
```

**Parameters:**
- `fn: () => void | (() => void)` - Effect function that may return a cleanup function

**Returns:**
- `() => void` - Cleanup function to stop the effect

**Example:**

```typescript
import { signal, effect } from '@omnitron-dev/aether';

const count = signal(0);

// Effect runs immediately and on changes
const dispose = effect(() => {
  console.log(`Count is: ${count()}`);

  // Optional cleanup
  return () => {
    console.log('Cleaning up');
  };
});

count(1); // Logs: "Count is: 1"
count(2); // Logs: "Count is: 2"

dispose(); // Stop the effect
```

**Async Effects:**

```typescript
const userId = signal(1);

effect(() => {
  const id = userId(); // Track dependency

  fetchUser(id).then(user => {
    console.log('User loaded:', user);
  });
});
```

---

### batch

Batches multiple signal updates into a single reactive update.

```typescript
function batch<T>(fn: () => T): T
```

**Parameters:**
- `fn: () => T` - Function containing signal updates

**Returns:**
- `T` - The return value of the function

**Example:**

```typescript
import { signal, computed, batch } from '@omnitron-dev/aether';

const firstName = signal('John');
const lastName = signal('Doe');
const fullName = computed(() => `${firstName()} ${lastName()}`);

let computeCount = 0;
effect(() => {
  fullName();
  computeCount++;
});

// Without batch: triggers 2 updates
firstName('Jane');
lastName('Smith');
console.log(computeCount); // 3 (initial + 2 updates)

// With batch: triggers 1 update
batch(() => {
  firstName('Bob');
  lastName('Johnson');
});
console.log(computeCount); // 4 (1 batched update)
```

---

### untrack

Reads signal values without creating dependencies.

```typescript
function untrack<T>(fn: () => T): T
```

**Parameters:**
- `fn: () => T` - Function to run without tracking

**Returns:**
- `T` - The return value of the function

**Example:**

```typescript
import { signal, computed, untrack } from '@omnitron-dev/aether';

const count = signal(0);
const multiplier = signal(2);

const result = computed(() => {
  const c = count();
  // Read multiplier without creating dependency
  const m = untrack(() => multiplier());
  return c * m;
});

console.log(result()); // 0

count(5);
console.log(result()); // 10

multiplier(3); // Does NOT trigger recomputation
console.log(result()); // 10 (still using multiplier = 2)
```

---

## Components

### defineComponent

Defines a reusable component with props and lifecycle.

```typescript
function defineComponent<P = {}>(
  setup: (props: P) => () => JSX.Element
): Component<P>
```

**Parameters:**
- `setup: (props: P) => () => JSX.Element` - Setup function that returns a render function

**Returns:**
- `Component<P>` - A component that can be used in JSX

**Example:**

```typescript
import { defineComponent, signal } from '@omnitron-dev/aether';

interface CounterProps {
  initialValue?: number;
  onCountChange?: (count: number) => void;
}

const Counter = defineComponent<CounterProps>((props) => {
  const count = signal(props.initialValue ?? 0);

  const increment = () => {
    const newCount = count() + 1;
    count(newCount);
    props.onCountChange?.(newCount);
  };

  return () => (
    <div>
      <p>Count: {count()}</p>
      <button onClick={increment}>Increment</button>
    </div>
  );
});

// Usage
<Counter initialValue={5} onCountChange={(c) => console.log(c)} />
```

**With Children:**

```typescript
interface CardProps {
  title: string;
  children?: JSX.Element;
}

const Card = defineComponent<CardProps>((props) => {
  return () => (
    <div class="card">
      <h2>{props.title}</h2>
      <div class="card-body">
        {props.children}
      </div>
    </div>
  );
});

// Usage
<Card title="Hello">
  <p>Card content here</p>
</Card>
```

---

### Fragment

Groups multiple children without adding a wrapper element.

```typescript
const Fragment: Component<{ children?: JSX.Element }>
```

**Example:**

```typescript
import { Fragment } from '@omnitron-dev/aether';

return () => (
  <Fragment>
    <h1>Title</h1>
    <p>Paragraph</p>
  </Fragment>
);

// Or using short syntax
return () => (
  <>
    <h1>Title</h1>
    <p>Paragraph</p>
  </>
);
```

---

### Portal

Renders children into a different DOM node.

```typescript
interface PortalProps {
  mount?: HTMLElement;
  children: JSX.Element;
}

const Portal: Component<PortalProps>
```

**Parameters:**
- `mount?: HTMLElement` - Target DOM node (defaults to document.body)
- `children: JSX.Element` - Content to render in the portal

**Example:**

```typescript
import { Portal, signal, defineComponent } from '@omnitron-dev/aether';

const Modal = defineComponent<{ onClose: () => void }>((props) => {
  return () => (
    <Portal>
      <div class="modal-overlay">
        <div class="modal">
          <button onClick={props.onClose}>Close</button>
          <p>Modal content</p>
        </div>
      </div>
    </Portal>
  );
});
```

---

### Suspense

Shows fallback content while async content loads.

```typescript
interface SuspenseProps {
  fallback: JSX.Element;
  children: JSX.Element;
}

const Suspense: Component<SuspenseProps>
```

**Parameters:**
- `fallback: JSX.Element` - Content to show while loading
- `children: JSX.Element` - Async content

**Example:**

```typescript
import { Suspense } from '@omnitron-dev/aether';

<Suspense fallback={<div>Loading...</div>}>
  <AsyncUserProfile userId={1} />
</Suspense>
```

---

### ErrorBoundary

Catches errors in child components and shows fallback UI.

```typescript
interface ErrorBoundaryProps {
  fallback: (error: Error) => JSX.Element;
  children: JSX.Element;
}

const ErrorBoundary: Component<ErrorBoundaryProps>
```

**Parameters:**
- `fallback: (error: Error) => JSX.Element` - Function that renders error UI
- `children: JSX.Element` - Protected content

**Example:**

```typescript
import { ErrorBoundary } from '@omnitron-dev/aether';

<ErrorBoundary
  fallback={(error) => (
    <div class="error">
      <h2>Something went wrong</h2>
      <p>{error.message}</p>
    </div>
  )}
>
  <UserProfile />
</ErrorBoundary>
```

---

## Router

### Router

Main router component that provides routing context.

```typescript
interface RouterProps {
  children: JSX.Element;
}

const Router: Component<RouterProps>
```

**Example:**

```typescript
import { Router, Route } from '@omnitron-dev/aether/router';

const App = () => (
  <Router>
    <Route path="/" component={Home} />
    <Route path="/about" component={About} />
    <Route path="/users/:id" component={UserProfile} />
  </Router>
);
```

---

### Route

Defines a route with a path and component.

```typescript
interface RouteProps {
  path: string;
  component: Component;
  loader?: () => Promise<any>;
  guard?: (context: RouteContext) => boolean | Promise<boolean>;
}

const Route: Component<RouteProps>
```

**Parameters:**
- `path: string` - URL path pattern (supports :param syntax)
- `component: Component` - Component to render for this route
- `loader?: () => Promise<any>` - Optional data loader
- `guard?: (context) => boolean` - Optional route guard

**Example:**

```typescript
<Route
  path="/users/:id"
  component={UserProfile}
  loader={async ({ params }) => {
    const user = await fetchUser(params.id);
    return { user };
  }}
  guard={({ user }) => user.isAuthenticated}
/>
```

---

### Link

Navigation link component.

```typescript
interface LinkProps {
  to: string;
  children: JSX.Element;
  activeClass?: string;
  replace?: boolean;
}

const Link: Component<LinkProps>
```

**Parameters:**
- `to: string` - Target path
- `children: JSX.Element` - Link content
- `activeClass?: string` - Class added when route is active
- `replace?: boolean` - Replace history instead of push

**Example:**

```typescript
import { Link } from '@omnitron-dev/aether/router';

<Link to="/about" activeClass="active">
  About
</Link>
```

---

### useNavigate

Hook for programmatic navigation.

```typescript
function useNavigate(): (to: string, options?: NavigateOptions) => void

interface NavigateOptions {
  replace?: boolean;
  state?: any;
}
```

**Returns:**
- Navigation function

**Example:**

```typescript
import { useNavigate } from '@omnitron-dev/aether/router';

const LoginForm = defineComponent(() => {
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    await login();
    navigate('/dashboard', { replace: true });
  };

  return () => <form onSubmit={handleSubmit}>...</form>;
});
```

---

### useParams

Hook to access route parameters.

```typescript
function useParams<T = Record<string, string>>(): T
```

**Returns:**
- Object with route parameters

**Example:**

```typescript
import { useParams } from '@omnitron-dev/aether/router';

const UserProfile = defineComponent(() => {
  const params = useParams<{ id: string }>();

  return () => <div>User ID: {params.id}</div>;
});

// Route: /users/:id
// URL: /users/123
// params.id = "123"
```

---

### useLocation

Hook to access current location.

```typescript
function useLocation(): Location

interface Location {
  pathname: string;
  search: string;
  hash: string;
  state: any;
}
```

**Returns:**
- Current location object

**Example:**

```typescript
import { useLocation } from '@omnitron-dev/aether/router';

const Navigation = defineComponent(() => {
  const location = useLocation();

  return () => (
    <div>
      <p>Current path: {location.pathname}</p>
      <p>Query: {location.search}</p>
    </div>
  );
});
```

---

## Forms

### createForm

Creates a form controller with validation and submission handling.

```typescript
function createForm<T>(config: FormConfig<T>): Form<T>

interface FormConfig<T> {
  initialValues: T;
  validate?: (values: T) => ValidationErrors<T>;
  onSubmit: (values: T) => void | Promise<void>;
}

interface Form<T> {
  values: Signal<T>;
  errors: Signal<ValidationErrors<T>>;
  touched: Signal<Record<keyof T, boolean>>;
  isSubmitting: Signal<boolean>;
  isValid: ReadonlySignal<boolean>;
  handleSubmit: (e: Event) => void;
  setFieldValue: (field: keyof T, value: any) => void;
  setFieldTouched: (field: keyof T, touched: boolean) => void;
  reset: () => void;
}
```

**Example:**

```typescript
import { createForm, validators } from '@omnitron-dev/aether/forms';

const LoginForm = defineComponent(() => {
  const form = createForm({
    initialValues: {
      email: '',
      password: ''
    },
    validate: (values) => {
      const errors: any = {};

      if (!validators.email(values.email)) {
        errors.email = 'Invalid email';
      }

      if (!validators.minLength(8)(values.password)) {
        errors.password = 'Password must be at least 8 characters';
      }

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
        value={form.values().email}
        onInput={(e) => form.setFieldValue('email', e.target.value)}
        onBlur={() => form.setFieldTouched('email', true)}
      />
      {form.touched().email && form.errors().email && (
        <span class="error">{form.errors().email}</span>
      )}

      <input
        type="password"
        value={form.values().password}
        onInput={(e) => form.setFieldValue('password', e.target.value)}
        onBlur={() => form.setFieldTouched('password', true)}
      />
      {form.touched().password && form.errors().password && (
        <span class="error">{form.errors().password}</span>
      )}

      <button type="submit" disabled={form.isSubmitting() || !form.isValid()}>
        {form.isSubmitting() ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
});
```

---

### Field

Form field component with built-in validation.

```typescript
interface FieldProps<T> {
  name: keyof T;
  form: Form<T>;
  type?: string;
  placeholder?: string;
  validate?: (value: any) => string | undefined;
}

const Field: Component<FieldProps>
```

**Example:**

```typescript
import { Field } from '@omnitron-dev/aether/forms';

<Field
  name="email"
  form={form}
  type="email"
  placeholder="Enter email"
  validate={validators.required}
/>
```

---

### validators

Built-in validation functions.

```typescript
const validators = {
  required: (value: any) => boolean,
  email: (value: string) => boolean,
  minLength: (min: number) => (value: string) => boolean,
  maxLength: (max: number) => (value: string) => boolean,
  pattern: (regex: RegExp) => (value: string) => boolean,
  min: (min: number) => (value: number) => boolean,
  max: (max: number) => (value: number) => boolean,
  url: (value: string) => boolean,
  numeric: (value: string) => boolean
}
```

**Example:**

```typescript
import { validators } from '@omnitron-dev/aether/forms';

const validate = (values) => {
  const errors: any = {};

  if (!validators.required(values.username)) {
    errors.username = 'Required';
  }

  if (!validators.minLength(3)(values.username)) {
    errors.username = 'Must be at least 3 characters';
  }

  if (!validators.email(values.email)) {
    errors.email = 'Invalid email';
  }

  return errors;
};
```

---

## Testing

### render

Renders a component for testing.

```typescript
function render(component: JSX.Element): RenderResult

interface RenderResult {
  container: HTMLElement;
  unmount: () => void;
  rerender: (component: JSX.Element) => void;
}
```

**Example:**

```typescript
import { render } from '@omnitron-dev/aether/testing';
import { Counter } from './Counter';

test('renders counter', () => {
  const { container } = render(<Counter initialValue={5} />);
  expect(container.textContent).toContain('Count: 5');
});
```

---

### screen

Query methods for finding elements.

```typescript
const screen = {
  getByText: (text: string | RegExp) => HTMLElement,
  getByRole: (role: string) => HTMLElement,
  getByLabelText: (text: string | RegExp) => HTMLElement,
  getByTestId: (testId: string) => HTMLElement,
  queryByText: (text: string | RegExp) => HTMLElement | null,
  queryByRole: (role: string) => HTMLElement | null,
  findByText: (text: string | RegExp) => Promise<HTMLElement>,
  findByRole: (role: string) => Promise<HTMLElement>
}
```

**Example:**

```typescript
import { render, screen } from '@omnitron-dev/aether/testing';

test('button click', () => {
  render(<Counter />);

  const button = screen.getByRole('button', { name: /increment/i });
  expect(button).toBeDefined();
});
```

---

### fireEvent

Simulates user events.

```typescript
const fireEvent = {
  click: (element: HTMLElement) => void,
  input: (element: HTMLElement, value: string) => void,
  change: (element: HTMLElement, value: string) => void,
  submit: (element: HTMLElement) => void,
  keyDown: (element: HTMLElement, options: KeyboardEventInit) => void,
  keyUp: (element: HTMLElement, options: KeyboardEventInit) => void
}
```

**Example:**

```typescript
import { render, screen, fireEvent } from '@omnitron-dev/aether/testing';

test('counter increment', () => {
  render(<Counter />);

  const button = screen.getByText('Increment');
  fireEvent.click(button);

  expect(screen.getByText('Count: 1')).toBeDefined();
});
```

---

### waitFor

Waits for an assertion to pass.

```typescript
function waitFor(
  callback: () => void,
  options?: WaitForOptions
): Promise<void>

interface WaitForOptions {
  timeout?: number;
  interval?: number;
}
```

**Example:**

```typescript
import { render, screen, waitFor } from '@omnitron-dev/aether/testing';

test('async data loading', async () => {
  render(<UserProfile userId={1} />);

  await waitFor(() => {
    expect(screen.getByText('John Doe')).toBeDefined();
  });
});
```

---

## Build Tools

### Vite Plugin

Vite plugin for Aether applications.

```typescript
import aether from '@omnitron-dev/aether/vite';

export default {
  plugins: [
    aether({
      ssr?: boolean;
      islands?: boolean;
      prerender?: string[];
    })
  ]
}
```

**Options:**
- `ssr?: boolean` - Enable server-side rendering
- `islands?: boolean` - Enable islands architecture
- `prerender?: string[]` - Routes to prerender

**Example:**

```typescript
import { defineConfig } from 'vite';
import aether from '@omnitron-dev/aether/vite';

export default defineConfig({
  plugins: [
    aether({
      ssr: true,
      islands: true,
      prerender: ['/', '/about']
    })
  ]
});
```

---

### Compiler

Standalone compiler API.

```typescript
import { compile } from '@omnitron-dev/aether/compiler';

interface CompileOptions {
  filename?: string;
  sourceMaps?: boolean;
  optimize?: boolean;
}

function compile(source: string, options?: CompileOptions): CompileResult

interface CompileResult {
  code: string;
  map?: SourceMap;
}
```

**Example:**

```typescript
import { compile } from '@omnitron-dev/aether/compiler';

const result = compile(`
  const Counter = defineComponent(() => {
    const count = signal(0);
    return () => <div>{count()}</div>;
  });
`, {
  filename: 'Counter.tsx',
  sourceMaps: true,
  optimize: true
});

console.log(result.code);
```

---

## Type Definitions

### JSX Types

```typescript
declare namespace JSX {
  interface Element extends VNode {}

  interface IntrinsicElements {
    [elemName: string]: any;
  }

  interface ElementChildrenAttribute {
    children: {};
  }
}
```

### Component Types

```typescript
type Component<P = {}> = (props: P) => JSX.Element;

type VNode = {
  type: string | Component;
  props: Record<string, any>;
  children: VNode[];
};
```

---

## Advanced Topics

### Custom Directives

Create custom directives for reusable behavior:

```typescript
function clickOutside(element: HTMLElement, callback: () => void) {
  const handler = (e: Event) => {
    if (!element.contains(e.target as Node)) {
      callback();
    }
  };

  document.addEventListener('click', handler);

  return () => {
    document.removeEventListener('click', handler);
  };
}

// Usage
<div use:clickOutside={() => close()}>
  Menu content
</div>
```

### Context API

Share values through component tree:

```typescript
import { createContext, useContext } from '@omnitron-dev/aether';

const ThemeContext = createContext<'light' | 'dark'>('light');

const App = defineComponent(() => {
  const theme = signal<'light' | 'dark'>('light');

  return () => (
    <ThemeContext.Provider value={theme()}>
      <Layout />
    </ThemeContext.Provider>
  );
});

const Button = defineComponent(() => {
  const theme = useContext(ThemeContext);

  return () => (
    <button class={`btn btn-${theme}`}>
      Click me
    </button>
  );
});
```

---

For more examples and guides, see:
- [Getting Started](./getting-started.md)
- [Performance Guide](./performance-guide.md)
- [Migration Guide](./migration-guide.md)
- [Troubleshooting](./troubleshooting.md)
