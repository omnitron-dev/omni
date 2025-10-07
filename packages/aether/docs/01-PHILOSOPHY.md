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

## Principle 11: Lightweight Dependency Injection

### 11.1 Why DI in a Frontend Framework?

**Architectural Decision**: Aether includes a **lightweight, type-safe DI system** designed specifically for frontend applications.

**Common Objection**: "Why use DI? Just import modules directly!"

**Answer**: For simple cases, ES6 imports are sufficient. But DI becomes essential for:

1. **Testing** — Easy to mock dependencies without hacking imports
2. **Modularity** — Swap implementations without changing consumer code
3. **Scoping** — Different instances for different contexts (component, module, request)
4. **Lazy Loading** — Defer service instantiation until actually needed
5. **Backend Integration** — Seamless Netron RPC proxy injection

```typescript
// ❌ Without DI: Hard to test
export class UserComponent {
  async loadUsers() {
    const users = await fetch('/api/users'); // Hard-coded dependency
    // How to mock fetch in tests?
  }
}

// ✅ With DI: Easy to test
@Injectable()
export class UserComponent {
  constructor(private http: HttpService) {}

  async loadUsers() {
    const users = await this.http.get('/api/users');
  }
}

// Test
const mockHttp = { get: vi.fn().mockResolvedValue([]) };
const component = new UserComponent(mockHttp);
```

### 11.2 Lightweight vs Angular DI

**Architectural Comparison**: Aether DI vs Angular DI

| Aspect | Angular DI | Aether DI |
|--------|-----------|-----------|
| **Bundle Size** | ~40KB | ~8KB |
| **Decorators Required** | Yes, everywhere | Optional (can use explicit deps) |
| **Runtime Metadata** | reflect-metadata (~4KB) | reflect-metadata (~4KB) |
| **Scopes** | 4 (root, module, component, platform) | 4 (singleton, module, transient, request) |
| **Hierarchical** | Yes | Yes |
| **Tree-Shakeable** | Limited | Better |
| **Learning Curve** | Steep | Gentle |

**Trade-off Acknowledged**: Aether DI uses `reflect-metadata` for decorator-based injection, adding ~4KB runtime overhead. This is a **conscious trade-off**:

- **Pro**: Better developer experience, automatic dependency resolution
- **Con**: 4KB runtime overhead
- **Alternative**: Manual dependency specification without decorators (zero overhead)

```typescript
// With reflect-metadata (automatic)
@Injectable()
class UserService {
  constructor(private http: HttpService) {}
}

// Without reflect-metadata (explicit deps)
@Injectable({ deps: [HttpService] })
class UserService {
  constructor(private http: HttpService) {}
}
```

### 11.3 Four Scopes for Different Needs

```typescript
// Singleton — one instance for entire application
@Injectable({ scope: 'singleton' }) // default
class AuthService {}

// Transient — new instance on every injection
@Injectable({ scope: 'transient' })
class IdGenerator {
  id = crypto.randomUUID(); // Different on each injection
}

// Module — one instance per Aether module
@Injectable({ scope: 'module' })
class FeatureStateService {}

// Request — one instance per SSR request (server-only)
@Injectable({ scope: 'request' })
class RequestContext {
  headers = getCurrentRequest().headers;
}
```

**When to use each scope:**
- **Singleton**: Auth, config, global state, API clients
- **Transient**: ID generators, temporary data, request builders
- **Module**: Feature-specific state, lazy-loaded services
- **Request**: User context, request headers, session data (SSR)

### 11.4 Separate Frontend and Backend DI

**Critical Architectural Decision**: Aether and Titan have **separate DI containers**.

```
┌─────────────────────────────────┐
│   Aether DI (Frontend)         │
│   - Lightweight (~8KB)          │
│   - Component-focused           │
│   - Client state management     │
│   - UI services                 │
└───────────┬─────────────────────┘
            │
            │ TypeScript Interfaces
            │ + Netron RPC Proxies
            │
┌───────────▼─────────────────────┐
│   Titan DI (Backend)           │
│   - Feature-rich                │
│   - Business logic              │
│   - Database access             │
│   - Background jobs             │
└─────────────────────────────────┘
```

**Why Separate?**
1. **Optimization**: Each optimized for its use case
2. **Security**: Backend services never exposed to client
3. **Tree-Shaking**: Frontend doesn't include backend code
4. **Flexibility**: Can use different DI strategies

**How They Connect**: Via **interface contracts** and **Netron RPC**

```typescript
// Shared interface (contract)
export interface IUserService {
  findAll(): Promise<User[]>;
  findOne(id: number): Promise<User>;
}

// Backend implementation (Titan)
@Injectable()
@Service('users@1.0.0')
class UserService implements IUserService {
  constructor(private db: Database) {}

  async findAll() {
    return this.db.query('SELECT * FROM users');
  }

  async findOne(id: number) {
    return this.db.queryOne('SELECT * FROM users WHERE id = ?', [id]);
  }
}

// Frontend proxy (auto-generated by Netron)
@Injectable()
class UserServiceProxy implements IUserService {
  constructor(private rpc: NetronClient) {}

  async findAll() {
    return this.rpc.call<User[]>('users@1.0.0', 'findAll');
  }

  async findOne(id: number) {
    return this.rpc.call<User>('users@1.0.0', 'findOne', [id]);
  }
}

// Aether DI registration (automatic)
providers: [
  { provide: IUserService, useClass: UserServiceProxy }
]
```

**Frontend component** uses the interface, **unaware of RPC**:

```typescript
const UserList = defineComponent(() => {
  const userService = inject<IUserService>(IUserService);
  const users = signal<User[]>([]);

  onMount(async () => {
    users.set(await userService.findAll()); // RPC call, but looks like local call
  });

  return () => (
    <For each={users()}>
      {(user) => <div>{user.name}</div>}
    </For>
  );
});
```

### 11.5 Optional: Use ES6 Imports When DI is Overkill

DI is **optional** in Aether. For simple utilities, use ES6 imports:

```typescript
// ✅ Good: Simple utility, no DI needed
// utils/format.ts
export function formatDate(date: Date): string {
  return date.toISOString();
}

// component.tsx
import { formatDate } from './utils/format';

// ❌ Overkill: DI for simple pure function
@Injectable()
class DateFormatter {
  format(date: Date): string {
    return date.toISOString();
  }
}
```

**Rule of Thumb**: Use DI when you need **testability, mocking, or scope management**. Use ES6 imports for **pure utilities and constants**.

## Principle 12: Module System for Code Organization

### 12.1 Why Modules on Top of ES6 Modules?

**Common Objection**: "We already have ES6 modules. Why another abstraction?"

**Answer**: ES6 modules handle **file imports**. Aether modules handle **application structure**:

| ES6 Modules | Aether Modules |
|-------------|----------------|
| File-level imports | Application-level organization |
| Static imports only | Lazy loading built-in |
| No DI integration | DI scope boundaries |
| No code splitting | Automatic code splitting |
| Import every file | Import entire feature |

**Aether modules are optional**. You can build entire apps with just ES6 imports. Use modules when you need:

1. **Lazy Loading** — Load features on demand
2. **Code Splitting** — Automatic chunk separation per module
3. **DI Scoping** — Module-scoped services
4. **Feature Encapsulation** — Public/private API boundaries
5. **Team Scalability** — Clear feature ownership

### 12.2 Simpler Than Angular Modules

**Architectural Comparison**: Angular NgModules vs Aether Modules

| Aspect | Angular NgModules | Aether Modules |
|--------|-------------------|----------------|
| **Declaration** | `@NgModule` decorator | `defineModule()` function |
| **Syntax** | Class-based | Object-based |
| **Imports** | Implicit global | Explicit ES6 imports |
| **Tree-Shaking** | Limited | Full |
| **Boilerplate** | High | Low |
| **Components Array** | Required | Optional |
| **Bootstrap** | Complex | Simple |

```typescript
// ❌ Angular: Verbose, class-based
@NgModule({
  declarations: [BlogListComponent, BlogPostComponent],
  imports: [CommonModule, FormsModule],
  providers: [BlogService],
  exports: [BlogListComponent]
})
export class BlogModule {}

// ✅ Aether: Concise, function-based
export const BlogModule = defineModule({
  id: 'blog',
  imports: [CommonModule, FormsModule],
  providers: [BlogService],
  exports: [BlogListComponent]
});
```

**Key Simplification**: No `declarations` array needed. Components are auto-discovered via imports.

### 12.3 When to Use Modules vs ES6 Imports

**Decision Tree:**

```
Is this a major feature (5+ components)?
  ├─ Yes → Use Aether Module
  │   ├─ Needs lazy loading? → Use lazy module + router
  │   └─ Needs DI scoping? → Use module providers
  │
  └─ No → Use ES6 imports
      ├─ Simple component? → Just export it
      └─ Utility function? → Just export it
```

**Examples:**

```typescript
// ✅ Use Module: Large feature with lazy loading
export const DashboardModule = defineModule({
  id: 'dashboard',
  lazy: true, // Load on demand
  providers: [
    DashboardService,
    AnalyticsService,
    ChartService
  ]
});

// In router
{
  path: '/dashboard',
  loadModule: () => import('./modules/dashboard')
}

// ✅ Use ES6 Imports: Small component
// components/Button.tsx
export const Button = defineComponent<ButtonProps>((props) => {
  return () => <button {...props}>{props.children}</button>;
});

// Import directly
import { Button } from '@/components/Button';
```

### 12.4 Module Benefits: Lazy Loading + Code Splitting

Aether modules automatically create **optimized chunks**:

```typescript
// Without modules: One giant bundle
app.js                  // 500 KB - everything

// With modules: Smart chunking
app.js                  // 50 KB - core + home
dashboard.lazy.js       // 120 KB - loads when /dashboard visited
admin.lazy.js           // 80 KB - loads when /admin visited
blog.lazy.js            // 60 KB - loads when /blog visited
shared.js               // 40 KB - shared across modules
```

**Result**: Initial load **10x smaller**, features load **on demand**.

### 12.5 Module Hierarchy and DI Scoping

Modules create **DI scope boundaries**:

```typescript
// Root Module
export const AppModule = defineModule({
  id: 'app',
  providers: [
    AppConfig,        // Singleton across entire app
    AuthService,      // Singleton across entire app
    HttpService       // Singleton across entire app
  ]
});

// Feature Module (lazy loaded)
export const BlogModule = defineModule({
  id: 'blog',
  lazy: true,
  providers: [
    BlogService,      // Created when BlogModule loads
    CommentService    // Created when BlogModule loads
  ]
});

// Result:
// - AuthService created on app init (singleton)
// - BlogService created when user visits /blog (lazy)
// - When user leaves /blog, BlogService can be garbage collected
```

**Benefits:**
- **Memory Efficiency**: Services created only when needed
- **Faster Startup**: Less initialization on app boot
- **Clear Boundaries**: Module services are private by default

### 12.6 When NOT to Use Modules

**Don't use modules for:**
- Simple websites (< 10 pages)
- Utility libraries
- Component libraries
- Projects with < 3 developers

**Use plain ES6 imports instead**:

```typescript
// ✅ Simple app: No modules needed
// src/App.tsx
import { Home } from './pages/Home';
import { About } from './pages/About';
import { Contact } from './pages/Contact';

export const App = defineComponent(() => {
  return () => (
    <Router>
      <Route path="/" component={Home} />
      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />
    </Router>
  );
});
```

## Principle 13: Self-Contained Server-Side Rendering

### 13.1 Built-In HTTP Server: No External Dependencies

**Architectural Decision**: Aether includes a **built-in, runtime-agnostic HTTP server**.

**Why?**

```typescript
// ❌ Traditional frameworks: Need external server
import express from 'express'; // +500KB
import { renderToString } from 'react-dom/server';

const app = express();
app.get('*', (req, res) => {
  const html = renderToString(<App />);
  res.send(html);
});

// ✅ Aether: Self-contained
import { createServer } from '@omnitron-dev/aether/server';

const server = createServer({
  mode: 'ssr',
  routes: [...],
  port: 3000
});

await server.listen();
// No Express, no Fastify, no configuration
```

**Benefits:**
1. **Zero Configuration** — Works out of the box
2. **Optimized** — Server designed specifically for Aether
3. **Lightweight** — No unnecessary features
4. **Type-Safe** — Native Web Request/Response APIs
5. **Portable** — Same code on Node.js, Bun, Deno

### 13.2 Runtime Agnostic: One Codebase, Three Runtimes

**Architectural Innovation**: Aether server **automatically detects runtime** and uses optimal implementation.

```typescript
// Same code, different runtimes
import { createServer } from '@omnitron-dev/aether/server';

const server = createServer({ routes, port: 3000 });
await server.listen();

// On Node.js 22+ → Uses node:http
// On Bun 1.2+   → Uses Bun.serve() (fastest)
// On Deno 2.0+  → Uses Deno.serve()
```

**Runtime Performance**:

| Runtime | Requests/sec | Memory | Startup |
|---------|--------------|--------|---------|
| **Bun** | ~90,000 | 25 MB | 8ms |
| **Node.js** | ~35,000 | 40 MB | 50ms |
| **Deno** | ~55,000 | 30 MB | 30ms |

**Result**: Write once, deploy anywhere, get optimal performance.

### 13.3 SSR + SSG + Islands: Unified Architecture

**Architectural Synthesis**: Aether provides **three rendering strategies** that work seamlessly together.

```
┌─────────────────────────────────────────┐
│         Aether Framework                │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │    Built-in HTTP Server           │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │    Rendering Strategies           │ │
│  │                                   │ │
│  │  ┌──────┐ ┌─────────┐ ┌────────┐ │ │
│  │  │ SSR  │ │ Islands │ │  SSG   │ │ │
│  │  │(Runtime)│(Selective)│(Build)│ │ │
│  │  └──────┘ └─────────┘ └────────┘ │ │
│  │           │                       │ │
│  │           ▼                       │ │
│  │   Unified Component System       │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │    Hydration System               │ │
│  │  - Auto island detection          │ │
│  │  - Selective hydration            │ │
│  │  - Progressive enhancement        │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Per-Route Strategy Selection:**

```typescript
// routes/index.tsx → SSG (Static homepage)
export const getStaticProps = async () => {
  return { props: { hero: await fetchHero() } };
};

// routes/blog/[slug].tsx → SSG + ISR (Incremental Static Regeneration)
export const getStaticProps = async ({ params }) => {
  return {
    props: { post: await fetchPost(params.slug) },
    revalidate: 60 // Re-generate every 60 seconds
  };
};

// routes/dashboard.tsx → SSR (User-specific data)
export const loader = async ({ request }) => {
  const user = await getUserFromRequest(request);
  return { user, feed: await fetchFeed(user.id) };
};

// All routes: Islands for interactivity
<LikeButton />         {/* Island: ~2KB JS, hydrates immediately */}
<CommentSection />     {/* Island: ~8KB JS, hydrates when visible */}
```

**Performance Characteristics:**

| Strategy | TTFB | FCP | LCP | JavaScript | SEO |
|----------|------|-----|-----|------------|-----|
| **SSG** | < 100ms | < 0.5s | < 1s | 5-20 KB | ★★★★★ |
| **SSG + Islands** | < 100ms | < 0.5s | < 1s | 5-30 KB | ★★★★★ |
| **SSR** | < 300ms | < 1s | < 2s | 10-40 KB | ★★★★★ |
| **SSR + Islands** | < 300ms | < 1s | < 2s | 10-40 KB | ★★★★★ |
| **SPA (React)** | < 100ms | > 2s | > 3s | 100+ KB | ★★☆☆☆ |

### 13.4 Server Components: Zero-JS Server-Rendered Content

**Innovation**: Aether supports **server components** that ship **zero JavaScript** to the client.

```typescript
import { serverOnly } from '@omnitron-dev/aether/server';

// This component NEVER ships JS to client
export const ServerStats = serverOnly(defineComponent(async () => {
  // Direct database access (server-only)
  const stats = await db.stats.aggregate({
    _count: true,
    _sum: { views: true }
  });

  return () => (
    <div className="stats">
      <p>Total Posts: {stats._count}</p>
      <p>Total Views: {stats._sum.views}</p>
    </div>
  );
}));

// Usage
<article>
  <ServerStats />           {/* 0 KB JS */}
  <ArticleContent />        {/* 0 KB JS - static HTML */}
  <LikeButton />            {/* 2 KB JS - island */}
  <CommentSection />        {/* 8 KB JS - island */}
</article>

// Total JS: 10 KB (only interactive parts)
// Traditional SPA: 100+ KB (everything)
```

### 13.5 Optional Titan Integration: Standalone or Full-Stack

**Architectural Flexibility**: Aether server works **standalone** or integrates with Titan.

```typescript
// ✅ Standalone mode (no backend needed)
import { createServer } from '@omnitron-dev/aether/server';

const server = createServer({
  mode: 'ssr',
  routes: [...]
});

await server.listen(); // Complete SSR app

// ✅ With Titan backend (optional)
import { createServer } from '@omnitron-dev/aether/server';
import { createNetronClient } from '@omnitron-dev/netron/client';

const backend = createNetronClient({
  url: 'ws://localhost:4000',
  services: { UserService, ProductService }
});

const server = createServer({
  mode: 'ssr',
  routes: [...],
  providers: [
    { provide: 'Backend', useValue: backend }
  ]
});
```

**Deployment Options:**

```
Option 1: Aether Standalone
┌─────────────────────────┐
│   Aether SSR Server     │
│   - HTTP server         │
│   - Routing             │
│   - Rendering           │
│   - Static assets       │
└─────────────────────────┘

Option 2: Aether + Titan
┌─────────────────────────┐    ┌─────────────────────────┐
│   Aether SSR Server     │───▶│   Titan Backend         │
│   - Frontend rendering  │ RPC│   - Business logic      │
│   - Client hydration    │    │   - Database            │
│   - Static assets       │    │   - Authentication      │
└─────────────────────────┘    └─────────────────────────┘
```

**Result**: **Maximum flexibility** — start simple, scale to full-stack when needed.

### 13.6 Progressive Enhancement: Works Without JavaScript

Aether SSR pages **work without JavaScript**, then **enhance** with interactivity:

```typescript
export default defineComponent(() => {
  return () => (
    <html>
      <body>
        {/* Layer 1: Static HTML (works without JS) */}
        <header>
          <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
          </nav>
        </header>

        <main>
          {/* Layer 2: Server-rendered content */}
          <article>
            <h1>Article Title</h1>
            <p>Content rendered on server...</p>
          </article>

          {/* Layer 3: Islands (enhanced with JS) */}
          <LikeButton />                    {/* 2 KB JS */}
          <CommentSection hydrate="visible" /> {/* 8 KB JS, lazy */}
        </main>

        <footer>© 2025</footer>
      </body>
    </html>
  );
});

// Progressive enhancement layers:
// 1. HTML (0 KB JS)     → Works immediately, no JS needed
// 2. Critical Islands   → 2 KB JS, loads immediately
// 3. Lazy Islands       → 8 KB JS, loads when visible
//
// Total: 10 KB JS (loaded progressively)
// Traditional SPA: 100+ KB (all upfront)
```

### 13.7 Trade-offs Acknowledged

**Runtime Overhead**: SSR adds server-side rendering cost.

| Metric | SSR | SSG | SPA |
|--------|-----|-----|-----|
| **Server CPU** | High | None | None |
| **Build Time** | Low | High | Medium |
| **Cache-ability** | Low | High | Medium |
| **Personalization** | Easy | Hard | Easy |

**When to use SSR vs SSG:**
- **SSR**: User-specific content, real-time data, personalization
- **SSG**: Static content, blogs, marketing pages, documentation
- **SSG + ISR**: E-commerce, news (static but frequently updated)
- **Hybrid**: Use both based on route needs

## Principle 14: Evolution without Breaking Changes

### 14.1 Backward Compatibility

New features are added as opt-in, without breaking existing code.

### 14.2 Deprecation Warnings

```typescript
// Deprecated API
// Warning: This API is deprecated. Use signal.set() instead. Will be removed in v2.0
signal.value = 5;

// Current API
signal.set(5);
```

### 14.3 Migration Support

Clear migration guides and codemods for major version upgrades.

## Architectural Philosophy Conclusion

Aether is the answer to the question: "What would a frontend framework look like if it were designed from scratch with the lessons of the last 10 years in mind?"

We took the best of:
- **React**: Component model and unidirectional data flow
- **SolidJS**: Fine-grained reactivity
- **TypeScript**: First-class type safety
- **Standard JSX**: No custom compiler needed
- **Angular**: Structured DI and modules (simplified)
- **Next.js**: SSR/SSG strategies (self-contained)
- **Titan**: Optional backend integration via Netron RPC

And discarded the worst:
- Virtual DOM overhead
- Custom template syntax
- Complex build tooling
- Magical implicit behavior
- Manual optimizations
- Mandatory server dependencies
- Heavyweight module systems

The result is a framework that is:
- **Minimal**: ~6KB core runtime, +8KB DI (optional), fewer concepts
- **Fast**: Fine-grained reactivity, zero VDOM overhead, runtime-agnostic SSR
- **Type-safe**: TypeScript everywhere, from UI to backend contracts
- **Standard**: Pure TypeScript/JSX, no custom compiler
- **Self-Contained**: Built-in HTTP server, no Express/Fastify needed
- **Flexible**: Works standalone or integrates with Titan backend
- **Scalable**: Optional module system for large apps, ES6 imports for simple apps
- **Progressive**: SSR → SSG → Islands, all in one framework
- **Developer-Friendly**: Excellent DX out of the box

### 14 Core Principles Summary:

1. **Minimalism** — Fewer concepts, lower cognitive load
2. **Performance** — Fine-grained reactivity, direct DOM updates
3. **Type Safety** — TypeScript first, full inference
4. **Developer Experience** — Hot reload, clear errors, zero config
5. **Composition Over Inheritance** — Functions, not classes
6. **Explicit Over Implicit** — No magic, clear dependencies
7. **Conventions Over Configuration** — File-based routing, auto code splitting
8. **Utility-Based Enhancement** — Strategic utilities, no custom compiler
9. **Control Flow Components** — Show/For/Switch, not custom syntax
10. **Full-Stack Coherence** — TypeScript everywhere, Titan integration
11. **Lightweight DI** — Optional, type-safe, ~8KB (vs Angular's 40KB)
12. **Module System** — Optional, for large apps, simpler than Angular
13. **Self-Contained SSR** — Built-in server, runtime-agnostic, standalone
14. **Evolution Without Breaking Changes** — Backward compatibility, clear migrations

### Trade-offs Acknowledged:

Aether makes **conscious, documented trade-offs**:

1. **reflect-metadata (~4KB)** for DI — Better DX vs bundle size
2. **Module system** — Organization vs simplicity (optional)
3. **Built-in server** — Simplicity vs flexibility (works for 95% of use cases)
4. **SSR overhead** — Better SEO/performance vs server CPU (use SSG when possible)

**Aether is not a compromise. It is a synthesis of the best ideas, implemented with pragmatic architectural choices, where every trade-off is conscious and documented.**
