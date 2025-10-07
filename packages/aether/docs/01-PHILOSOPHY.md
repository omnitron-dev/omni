# Philosophy and Design Principles of Aether

## Introduction

Aether Framework is not just another JavaScript framework. It is a fundamental rethinking of what web application development should look like. Every architectural decision in Aether was made with three key principles in mind:

1. **Minimalism** — Less code, fewer concepts, lower cognitive load
2. **Performance** — Fine-grained reactivity, zero virtual DOM overhead
3. **Type Safety** — TypeScript first, full type inference everywhere

## Problems with Modern Frameworks

### React: Imperative under the guise of declarative

```jsx
// Looks declarative
function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    document.title = `Count: ${count}`;
  }, [count]);

  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

**Issues:**
- Virtual DOM overhead (~40KB runtime)
- Re-rendering the entire component on state changes
- useEffect as an escape hatch with manual dependency management
- Hook rules violate intuition
- Requires manual memoization and optimizations

### Vue: Magic and implicit behavior

```vue
<script setup>
const count = ref(0);
const doubled = computed(() => count.value * 2);
</script>

<template>
  <button @click="count++">{{ count }}</button>
</template>
```

**Issues:**
- `.value` syntax in script vs automatic unwrap in template
- Proxy-based reactivity with runtime overhead
- Options API vs Composition API splits the ecosystem
- Magical compiler transformations are not always predictable

### Angular: Enterprise complexity

```typescript
@Component({
  selector: 'app-counter',
  template: '<button (click)="increment()">{{ count }}</button>'
})
export class CounterComponent {
  count = 0;

  increment() {
    this.count++;
  }
}
```

**Issues:**
- Huge bundle size (>150KB for Hello World)
- Zone.js for change detection
- Decorators everywhere
- RxJS is mandatory for reactivity
- Steep learning curve

## The Aether Approach: Elegant Simplicity

```typescript
// Counter.tsx
import { defineComponent, signal } from 'aether';

export const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      {count()}
    </button>
  );
});
```

**Benefits:**
- No boilerplate (bundle: ~6KB core)
- Granular updates (only the button text)
- Obvious reactivity
- Standard TypeScript/JSX (no custom compiler)
- TypeScript out of the box

## Principle 1: Minimalism

### 1.1 Cognitive Load

Every new concept increases cognitive load. Aether strives for a minimal set of orthogonal primitives.

**Aether primitives:**
1. **Signals** — reactive state
2. **Computed** — derived values
3. **Effects** — side effects
4. **Components** — reusable UI building blocks

Everything else is built on top of these four concepts.

### 1.2 Principle of Least Astonishment (POLA)

Code should do what you expect.

```typescript
// ❌ Surprise: React useState
const [count, setCount] = useState(0);
setCount(count + 1); // Doesn't work in a loop!

// Why? Because setCount is asynchronous
for (let i = 0; i < 3; i++) {
  setCount(count + 1); // Always sets 1!
}

// ✅ No surprise: Aether signal
const count = signal(0);
count.set(count() + 1); // Synchronous, works everywhere

for (let i = 0; i < 3; i++) {
  count.set(count() + 1); // Correctly increments
}
```

### 1.3 Standard TypeScript JSX, Not Custom Syntax

**Architectural Decision**: Aether uses **standard TypeScript JSX** with **strategic utility functions**, not a custom compiler or template syntax.

**Why?**
- **Error Resistance**: TypeScript catches all errors at compile time
- **Intuitiveness**: If you know JSX, you know Aether
- **Unlimited Possibilities**: Full JavaScript power in templates
- **Ecosystem Integration**: Works with all TypeScript/JSX tools
- **Implementation Cost**: ~500 lines of utilities vs 15-25K lines for a compiler

```typescript
// ❌ Verbose: React conditional rendering
{isLoggedIn ? (
  isAdmin ? (
    <AdminDashboard />
  ) : (
    <UserDashboard />
  )
) : (
  <LoginForm />
)}

// ✅ Clean: Aether with Show component
import { Show } from 'aether';

<Show when={isLoggedIn() && isAdmin()}>
  <AdminDashboard />
</Show>
<Show when={isLoggedIn() && !isAdmin()}>
  <UserDashboard />
</Show>
<Show when={!isLoggedIn()}>
  <LoginForm />
</Show>
```

## Principle 2: Performance

### 2.1 Fine-Grained Reactivity

Virtual DOM frameworks re-render the entire component. Aether updates only the changed nodes.

```typescript
const UserInfo = defineComponent(() => {
  const firstName = signal('John');
  const lastName = signal('Doe');
  const age = signal(25);

  return () => (
    <div>
      <span>{firstName()}</span>
      <span>{lastName()}</span>
      <span>{age()}</span>
    </div>
  );
});
```

When `firstName()` changes:
- **React/Vue**: Re-render the entire component (3 spans)
- **Aether**: Update only the first text node

### 2.2 Zero Virtual DOM Overhead

```typescript
// Bundle size comparison (gzipped)
{
  "Hello World": {
    "Aether": "~6KB",   // runtime + component
    "Qwik": "1KB",
    "Svelte": "2KB",
    "SolidJS": "7KB",
    "Vue": "34KB",
    "React": "42KB"
  }
}
```

### 2.3 Direct DOM Updates

Aether's reactivity compiles to direct DOM operations:

```typescript
// Source
const count = signal(0);
effect(() => {
  textNode.data = `Count: ${count()}`;
});

// No virtual DOM diffing
// No reconciliation
// Just direct property updates
```

### 2.4 Automatic Batching

Multiple signal updates are automatically batched:

```typescript
import { batch } from 'aether';

batch(() => {
  firstName.set('Jane');
  lastName.set('Smith');
  age.set(30);
});
// Only one render cycle, not three
```

## Principle 3: Type Safety

### 3.1 TypeScript First

Aether is written in TypeScript and designed with type safety in mind.

```typescript
// Automatic type inference
const count = signal(0);        // WritableSignal<number>
const name = signal('John');    // WritableSignal<string>
const user = signal<User | null>(null); // Explicit type

// Computed inherits types
const doubled = computed(() => count() * 2); // ComputedSignal<number>
const greeting = computed(() =>
  `Hello, ${name()}`
); // ComputedSignal<string>

// Effect is typed
effect(() => {
  const c = count(); // number
  const n = name();  // string
});
```

### 3.2 Props Validation

```typescript
import { defineComponent } from 'aether';

interface ButtonProps {
  variant: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
  children?: any;
}

const Button = defineComponent<ButtonProps>((props) => {
  const size = () => props.size ?? 'md';
  const disabled = () => props.disabled ?? false;

  // TypeScript checks usage
  if (props.variant === 'success') { // TS Error: Type '"success"' is not assignable
    // ...
  }

  return () => (
    <button
      className={`btn-${props.variant} btn-${size()}`}
      disabled={disabled()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
});
```

### 3.3 Typed Routes

```typescript
// Type-safe navigation with router
import { useRouter } from 'aether/router';

const router = useRouter();

// Navigate with type checking
router.navigate('/blog/my-post');

// Type-safe loader data
export const loader = async ({ params }: { params: { slug: string } }) => {
  const post = await fetchPost(params.slug); // params.slug: string
  return { post };
};

const loaderData = useLoaderData(); // Typed based on loader return
```

### 3.4 Service Injection (with Titan Integration)

```typescript
// Type-safe DI from Titan backend
import { Injectable } from '@omnitron-dev/titan';

@Injectable()
class UserService {
  async findAll(): Promise<User[]> { /*...*/ }
  async findOne(id: number): Promise<User> { /*...*/ }
}

// Usage in frontend (via Netron RPC)
const userService = inject(UserService); // Type: UserService

const users = await userService.findAll(); // Type: User[]
const user = await userService.findOne('123'); // TS Error: Argument of type 'string' is not assignable to parameter of type 'number'
```

## Principle 4: Developer Experience

### 4.1 Instant Feedback

Hot Module Replacement updates only changed modules without a full reload:

```typescript
// Component change
const Counter = defineComponent(() => {
  const count = signal(0); // was signal(10)

  return () => <button>{count()}</button>;
});

// HMR: updates only this component, state is preserved!
```

### 4.2 Clear Error Messages

```typescript
// ❌ React
"Objects are not valid as a React child (found: object with keys {name, age})"
// Where? Why? How to fix?

// ✅ Aether
"Cannot interpolate object directly. Did you forget to access a property?

  Component: UserCard.tsx:15:8
  Expression: {user()}

  Hint: Try {user().name} or {JSON.stringify(user())}"
```

### 4.3 Zero Configuration

```bash
# Create project
npx create-aether my-app

# Everything is preconfigured:
# - TypeScript
# - File-based routing
# - SSR (via Titan integration)
# - HMR
# - Build optimization
```

### 4.4 IDE Integration

Standard TypeScript/JSX provides excellent IDE support:
- Syntax highlighting for TypeScript/JSX
- IntelliSense for components and props
- Type checking
- Auto-imports
- Refactoring tools
- Go to definition
- Find all references

## Principle 5: Composition Over Inheritance

### 5.1 Components as Functions

```typescript
// ❌ Inheritance (Angular, old Vue)
class BaseComponent {
  ngOnInit() { }
}

class MyComponent extends BaseComponent {
  override ngOnInit() {
    super.ngOnInit();
    // ...
  }
}

// ✅ Composition (Aether)
function useFeature() {
  const data = signal([]);

  onMount(() => {
    // setup
  });

  return { data };
}

// Usage in component
const MyComponent = defineComponent(() => {
  const feature = useFeature();

  return () => <div>{feature.data()}</div>;
});
```

### 5.2 Children Pattern for Composition

Aether uses standard `props.children` pattern instead of slots:

```typescript
// Card.tsx
import { defineComponent } from 'aether';

interface CardProps {
  header?: any;
  footer?: any;
  children?: any;
}

const Card = defineComponent<CardProps>((props) => {
  return () => (
    <div className="card">
      {props.header && (
        <div className="card-header">{props.header}</div>
      )}
      <div className="card-body">
        {props.children}
      </div>
      {props.footer && (
        <div className="card-footer">{props.footer}</div>
      )}
    </div>
  );
});

// Usage
<Card
  header={<h2>Title</h2>}
  footer={<button>Action</button>}
>
  <p>Content</p>
</Card>
```

## Principle 6: Explicit Over Implicit

### 6.1 Explicit Reactivity

```typescript
// ✅ Aether — explicitly reactive
const count = signal(0);
const doubled = computed(() => count() * 2);

effect(() => {
  console.log(count()); // Explicit subscription via ()
});

// ❌ Vue — implicit reactivity via Proxy
const state = reactive({ count: 0 });

watch(() => {
  console.log(state.count); // Implicit subscription
});
```

### 6.2 Explicit Dependencies

```typescript
// ✅ Aether — dependencies are tracked automatically
const fullName = computed(() => {
  return `${firstName()} ${lastName()}`; // Automatically tracks both
});

// ❌ React — manual dependency list
const fullName = useMemo(() => {
  return `${firstName} ${lastName}`;
}, [firstName, lastName]); // Easy to forget!
```

## Principle 7: Conventions over Configuration

### 7.1 File-Based Routing

```
routes/
  index.tsx         → /
  about.tsx         → /about
  blog/
    [slug].tsx      → /blog/:slug
```

No routing configuration is required.

### 7.2 Automatic Code Splitting

```typescript
// routes/dashboard.tsx
// Automatically split into a separate chunk

// routes/blog/[slug].tsx
// Another chunk

// No configuration needed!
```

### 7.3 Standard Structure

```
my-app/
  src/
    routes/      # Routes
    components/  # Components
    services/    # Services (Titan integration)
    stores/      # Stores
    lib/         # Utilities
```

## Principle 8: Utility-Based Enhancement

Aether provides **strategic utilities** instead of custom compiler directives:

### 8.1 Event Utilities

```typescript
import { prevent, stop, throttle, debounce, compose } from 'aether/utils';

// Prevent default
<form onSubmit={prevent(() => handleSubmit())}>

// Stop propagation
<div onClick={stop(() => handleClick())}>

// Debounced input
<input onInput={debounce((e) => search(e.target.value), 300)} />

// Throttled scroll
<div onScroll={throttle(() => handleScroll(), 100)} />

// Composed handlers
<button onClick={compose(prevent, stop, () => handleClick())} />
```

### 8.2 Binding Utilities

```typescript
import { bindValue, bindChecked, bindNumber } from 'aether/utils';

const name = signal('');
const age = signal(0);
const agreed = signal(false);

// Two-way binding for text input
<input type="text" {...bindValue(name)} />

// Two-way binding for number input
<input type="number" {...bindNumber(age)} />

// Two-way binding for checkbox
<input type="checkbox" {...bindChecked(agreed)} />
```

### 8.3 Class Utilities

```typescript
import { classes, classNames, variantClasses } from 'aether/utils';

// Conditional classes
<div className={classes({
  'active': isActive(),
  'disabled': isDisabled(),
  'loading': isLoading()
})} />

// Class names array
<div className={classNames('btn', 'btn-primary', size())} />

// Variant-based classes
<button className={variantClasses('btn', {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  sm: 'btn-sm',
  md: 'btn-md',
}, [variant, size])} />
```

### 8.4 Style Utilities

```typescript
import { styles, cssVar, flexStyles, gridStyles } from 'aether/utils';

// Dynamic styles object
<div style={styles({
  color: textColor(),
  fontSize: `${size()}px`,
  display: visible() ? 'block' : 'none'
})} />

// CSS variables
<div style={cssVar({
  'primary-color': '#3b82f6',
  'spacing': '1rem'
})} />

// Flex utilities
<div style={flexStyles({
  direction: 'row',
  justify: 'center',
  align: 'center',
  gap: '1rem'
})} />

// Grid utilities
<div style={gridStyles({
  columns: 3,
  gap: '1rem',
  autoFlow: 'dense'
})} />
```

### 8.5 Custom Directives

```typescript
import { createDirective } from 'aether/utils';

// Create custom directive
const clickOutside = createDirective((el, handler) => {
  const handleClick = (e: Event) => {
    if (!el.contains(e.target as Node)) {
      handler();
    }
  };

  document.addEventListener('click', handleClick);

  return () => {
    document.removeEventListener('click', handleClick);
  };
});

// Usage with ref
const handleClickOutside = () => {
  console.log('Clicked outside!');
};

<div ref={(el) => clickOutside(el, handleClickOutside)}>
  Content
</div>
```

## Principle 9: Control Flow Components

Aether uses **components** for control flow, not custom syntax:

### 9.1 Show Component

```typescript
import { Show } from 'aether';

// Conditional rendering
<Show when={isLoggedIn()}>
  <Dashboard />
</Show>

// With fallback
<Show when={user()} fallback={<Loading />}>
  {(u) => <UserProfile user={u} />}
</Show>
```

### 9.2 For Component

```typescript
import { For } from 'aether';

// List rendering
<For each={items()}>
  {(item, index) => (
    <div key={item.id}>
      {index()}: {item.name}
    </div>
  )}
</For>
```

### 9.3 Switch Component

```typescript
import { Switch, Match } from 'aether';

// Switch/case rendering
<Switch fallback={<NotFound />}>
  <Match when={status() === 'loading'}>
    <Loading />
  </Match>
  <Match when={status() === 'error'}>
    <Error />
  </Match>
  <Match when={status() === 'success'}>
    <Success />
  </Match>
</Switch>
```

### 9.4 Portal Component

```typescript
import { Portal } from 'aether';

// Render to different DOM location
<Portal mount={document.body}>
  <Modal />
</Portal>
```

### 9.5 Suspense Component

```typescript
import { Suspense } from 'aether';

// Async boundary
<Suspense fallback={<Loading />}>
  <AsyncComponent />
</Suspense>
```

## Principle 10: Full-Stack Coherence (Titan Integration)

### 10.1 One Language

TypeScript everywhere — frontend, backend, configuration, tests.

### 10.2 Shared Services via Netron RPC

```typescript
// Backend service (Titan)
@Injectable()
@Service('users@1.0.0')
export class UserService {
  async findAll(): Promise<User[]> {
    return this.db.query('SELECT * FROM users');
  }
}

// Frontend — automatic RPC via Netron
import { inject } from 'aether/di';

const MyComponent = defineComponent(() => {
  const userService = inject(UserService);
  const users = signal<User[]>([]);

  onMount(async () => {
    const data = await userService.findAll(); // RPC call
    users.set(data);
  });

  return () => (
    <For each={users()}>
      {(user) => <div>{user.name}</div>}
    </For>
  );
});
```

### 10.3 Type-Safe Communication

```typescript
// Types are automatically synchronized
// Backend changed a type → Frontend gets TS errors
```

### 10.4 SSR Integration

Aether's server module integrates seamlessly with Titan:

```typescript
import { createServer } from 'aether/server';

const server = createServer({
  routes: [...],
  mode: 'ssr', // or 'ssg'
  port: 3000,
});

await server.listen();
```

## Principle 11: Evolution without Breaking Changes

### 11.1 Backward Compatibility

New features are added as opt-in, without breaking existing code.

### 11.2 Deprecation Warnings

```typescript
// Deprecated API
// Warning: This API is deprecated. Use signal.set() instead. Will be removed in v2.0
signal.value = 5;

// Current API
signal.set(5);
```

### 11.3 Migration Support

Clear migration guides and codemods for major version upgrades.

## Architectural Philosophy Conclusion

Aether is the answer to the question: "What would a frontend framework look like if it were designed from scratch with the lessons of the last 10 years in mind?"

We took the best of:
- **React**: Component model and unidirectional data flow
- **SolidJS**: Fine-grained reactivity
- **TypeScript**: First-class type safety
- **Standard JSX**: No custom compiler needed
- **Titan**: Full-stack TypeScript with DI and RPC

And discarded the worst:
- Virtual DOM overhead
- Custom template syntax
- Complex build tooling
- Magical implicit behavior
- Manual optimizations

The result is a framework that is:
- **Minimal**: ~6KB core runtime, fewer concepts
- **Fast**: Fine-grained reactivity, zero VDOM overhead
- **Type-safe**: TypeScript everywhere
- **Standard**: Pure TypeScript/JSX, no custom compiler
- **Integrated**: Seamless Titan backend integration
- **Developer-Friendly**: Excellent DX out of the box

**Aether is not a compromise. It is a synthesis of the best ideas, implemented with pragmatic architectural choices.**
