# Philosophy and Design Principles of Nexus

## Introduction

Nexus Framework is not just another JavaScript framework. It is a fundamental rethinking of what web application development should look like. Every architectural decision in Nexus was made with three key principles in mind:

1. **Minimalism** — Less code, fewer concepts, lower cognitive load
2. **Performance** — Zero runtime overhead, maximum work at compile time
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

  return <button onClick={() => count.set(count + 1)}>{count}</button>;
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

## The Nexus Approach: Elegant Simplicity

```typescript
// Counter.tsx
import { defineComponent, signal } from 'nexus';

export const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <button on:click={() => count.update(n => n + 1)}>
      {count()}
    </button>
  );
});
```

**Benefits:**
- No boilerplate (bundle: 1.2KB)
- Granular updates (only the button text)
- Obvious reactivity
- Compile-time optimizations
- TypeScript out of the box

## Principle 1: Minimalism

### 1.1 Cognitive Load

Every new concept increases cognitive load. Nexus strives for a minimal set of orthogonal primitives.

**Nexus primitives:**
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
count.set(count + 1); // Doesn't work in a loop!

// Why? Because setCount is asynchronous
for (let i = 0; i < 3; i++) {
  count.set(count + 1); // Always sets 1!
}

// ✅ No surprise: Nexus signal
const count = signal(0);
count.update(n => n + 1); // Synchronous, works everywhere

for (let i = 0; i < 3; i++) {
  count.update(n => n + 1); // Correctly increments
}
```

### 1.3 Fewer Syntactic Constructs

```html
<!-- ❌ Verbose: React -->
{isLoggedIn ? (
  isAdmin ? (
    <AdminDashboard />
  ) : (
    <UserDashboard />
  )
) : (
  <LoginForm />
)}

<!-- ✅ Declarative: Nexus -->
<div nx:if={isLoggedIn() && isAdmin()}>
  <AdminDashboard />
</div>
<div nx:else-if={isLoggedIn()}>
  <UserDashboard />
</div>
<div nx:else>
  <LoginForm />
</div>
```

## Principle 2: Performance

### 2.1 Compile-Time > Runtime

Shift as much work as possible to compile time.

```html
<!-- Source -->
<div class="container">
  <h1>{title()}</h1>
  <p nx:if={show()}>{content()}</p>
</div>

<!-- Compiled (simplified) -->
function render() {
  const div = el('div', { class: 'container' });
  const h1 = el('h1');
  const h1Text = text();
  h1.append(h1Text);
  div.append(h1);

  let p, pText;

  effect(() => h1Text.data = title());

  effect(() => {
    if (show()) {
      if (!p) {
        p = el('p');
        pText = text();
        p.append(pText);
        div.append(p);
      }
      pText.data = content();
    } else if (p) {
      p.remove();
      p = pText = null;
    }
  });

  return div;
}
```

**Result:**
- Only the necessary code
- No template interpretation at runtime
- No Virtual DOM diffing
- Direct DOM operations

### 2.2 Fine-Grained Reactivity

Virtual DOM frameworks re-render the entire component. Nexus updates only the changed nodes.

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
- **Nexus**: Update only the first text node

### 2.3 Zero Runtime Overhead

```typescript
// Bundle size comparison (gzipped)
{
  "Hello World": {
    "Nexus": "1.2KB",   // runtime + component
    "Qwik": "1KB",
    "Svelte": "2KB",
    "SolidJS": "7KB",
    "Vue": "34KB",
    "React": "42KB"
  }
}
```

### 2.4 Islands Architecture

Static content does not require JavaScript.

```typescript
// routes/blog/[slug].tsx
import { defineComponent } from 'nexus';

export const mode = 'static'; // 0KB JavaScript!

export default defineComponent<{ post: BlogPost }>((props) => {
  return () => (
    <article>
      <h1>{props.post.title}</h1>
      <div>{props.post.content}</div>
    </article>
  );
});
```

Interactivity only where needed:

```typescript
import { defineComponent, signal } from 'nexus';

export const mode = 'visible'; // JS loads when visible

export const CommentsSection = defineComponent(() => {
  const comments = signal([]);

  return () => <CommentSection comments={comments()} />;
});
```

### 2.5 Resumability vs Hydration

**Traditional SSR:**
```
Server: Render HTML (1MB)
  ↓
Client: Download HTML
  ↓
Client: Download JS bundle (200KB)
  ↓
Client: Parse & Execute JS (300ms)
  ↓
Client: Hydrate (re-execute all components) (200ms)
  ↓
Interactive (Total: ~500ms)
```

**Nexus Resumable:**
```
Server: Render HTML + serialize state (1MB + 2KB)
  ↓
Client: Download HTML
  ↓
Interactive (Total: ~30ms)
  ↓
(JS loads only upon interaction)
```

## Principle 3: Type Safety

### 3.1 TypeScript First

Nexus is written in TypeScript and designed with type safety in mind.

```typescript
// Automatic type inference
const count = signal(0);        // Signal<number>
const name = signal('John');    // Signal<string>
const user = signal<User | null>(null); // Explicit type

// Computed inherits types
const doubled = computed(() => count() * 2); // Computed<number>
const greeting = computed(() =>
  `Hello, ${name()}`
); // Computed<string>

// Effect is typed
effect(() => {
  const c = count(); // number
  const n = name();  // string
});
```

### 3.2 Props Validation

```typescript
import { defineComponent } from 'nexus';

interface ButtonProps {
  variant: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
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
      class={`btn-${props.variant} btn-${size()}`}
      disabled={disabled()}
      on:click={props.onClick}
    >
      <slot />
    </button>
  );
});
```

### 3.3 Typed Routes

```typescript
// Generated route types
import type { Routes } from '.nexus/routes';

// Type-safe navigation
navigate('/blog/:slug', {
  params: { slug: 'my-post' }
}); // ✅

navigate('/blog/:id', {
  params: { id: 123 }
}); // ❌ TS Error: Route doesn't exist

// Type-safe loader data
export const load = loader<{ post: BlogPost }>(async ({ params }) => {
  const post = await fetchPost(params.slug); // params.slug: string
  return { post };
});

const { post } = useLoaderData(); // post: Signal<BlogPost>
```

### 3.4 Service Injection

```typescript
// Type-safe DI
@Injectable()
class UserService {
  async findAll(): Promise<User[]> { /*...*/ }
  async findOne(id: number): Promise<User> { /*...*/ }
}

// Usage
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

// ✅ Nexus
"Cannot interpolate object directly. Did you forget to access a property?

  Component: UserCard.tsx:15:8
  Expression: {user()}

  Hint: Try {user().name} or {JSON.stringify(user())}"
```

### 4.3 Zero Configuration

```bash
# Create project
npx create-nexus my-app

# Everything is preconfigured:
# - TypeScript
# - File-based routing
# - SSR
# - HMR
# - Build optimization
```

### 4.4 IDE Integration

The VS Code extension provides:
- Syntax highlighting for TypeScript/JSX
- IntelliSense for components and directives
- Type checking
- Auto-imports
- Refactoring tools
- Go to definition
- Find all references

## Principle 5: Progressive Enhancement

### 5.1 Static First

By default everything is static. JavaScript is added only explicitly.

```typescript
// Static component
interface ArticleProps {
  title: string;
  content: string;
}

const Article = defineComponent<ArticleProps>((props) => {
  return () => (
    <article>
      <h1>{props.title}</h1>
      <p>{props.content}</p>
    </article>
  );
});

// Result: Pure HTML, 0KB JavaScript
```

### 5.2 Gradual Interactivity

```typescript
// Adding interactivity
import { defineComponent, signal } from 'nexus';

export const mode = 'visible'; // JS loads when visible

interface InteractiveArticleProps {
  title: string;
  content: string;
}

const InteractiveArticle = defineComponent<InteractiveArticleProps>((props) => {
  const likes = signal(0);

  return () => (
    <article>
      <h1>{props.title}</h1>
      <p>{props.content}</p>

      {/* Only this button is interactive */}
      <button on:click={() => likes.update(n => n + 1)}>
        ❤️ {likes()}
      </button>
    </article>
  );
});
```

### 5.3 Works without JavaScript

Critical functionality should work without JS:

```typescript
// The form works with and without JS
import { defineComponent, onMount } from 'nexus';

const SubscribeForm = defineComponent(() => {
  let formRef: HTMLFormElement;

  onMount(() => {
    if (import.meta.env.CLIENT) {
      enhanceForm(formRef, {
        onSubmit: async (data) => {
          await fetch('/api/subscribe', {
            method: 'POST',
            body: JSON.stringify(data)
          });
        }
      });
    }
  });

  return () => (
    <form ref={formRef} action="/api/subscribe" method="POST">
      <input type="email" name="email" required />
      <button type="submit">Subscribe</button>
    </form>
  );
});
```

## Principle 6: Composition Over Inheritance

### 6.1 Components as Functions

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

// ✅ Composition (Nexus)
function useFeature() {
  const data = signal([]);

  onMount(() => {
    // setup
  });

  return { data };
}

// Usage
const feature = useFeature();
```

### 6.2 Slots for Composition

```typescript
// Card.tsx
import { defineComponent } from 'nexus';

const Card = defineComponent(() => {
  return () => (
    <div class="card">
      <div class="card-header">
        <slot name="header" />
      </div>
      <div class="card-body">
        <slot />
      </div>
      <div class="card-footer">
        <slot name="footer" />
      </div>
    </div>
  );
});

// Usage
<Card>
  <h2 slot="header">Title</h2>
  <p>Content</p>
  <button slot="footer">Action</button>
</Card>
```

## Principle 7: Explicit Over Implicit

### 7.1 Explicit Reactivity

```typescript
// ✅ Nexus — explicitly reactive
const count = signal(0);
const doubled = computed(() => count() * 2);

effect(() => {
  console.log(count()); // Explicit subscription
});

// ❌ Vue — implicit reactivity via Proxy
const state = reactive({ count: 0 });

watch(() => {
  console.log(state.count); // Implicit subscription
});
```

### 7.2 Explicit Dependencies

```typescript
// ✅ Nexus — dependencies are tracked automatically
const fullName = computed(() => {
  return `${firstName()} ${lastName()}`; // Automatically tracks both
});

// ❌ React — manual dependency list
const fullName = useMemo(() => {
  return `${firstName} ${lastName}`;
}, [firstName, lastName]); // Easy to forget!
```

## Principle 8: Conventions over Configuration

### 8.1 File-Based Routing

```
routes/
  index.tsx         → /
  about.tsx         → /about
  blog/
    [slug].tsx      → /blog/:slug
```

No routing configuration is required.

### 8.2 Automatic Code Splitting

```typescript
// routes/dashboard.tsx
// Automatically split into a separate chunk

// routes/blog/[slug].tsx
// Another chunk

// No configuration needed!
```

### 8.3 Standard Structure

```
my-app/
  src/
    routes/      # Routes
    components/  # Components
    services/    # Services
    stores/      # Stores
    lib/         # Utilities
```

## Principle 9: Full-Stack Coherence

### 9.1 One Language

TypeScript everywhere — frontend, backend, configuration, tests.

### 9.2 Shared Code

```typescript
// services/user.service.ts — used everywhere!

@Injectable()
@Service('users@1.0.0')
export class UserService {
  // Backend: database access
  async findAll(): Promise<User[]> {
    return this.db.query('SELECT * FROM users');
  }
}

// Frontend — automatic RPC
const users = await inject(UserService).findAll();
```

### 9.3 Type-Safe Communication

```typescript
// Types are automatically synchronized
// Backend changed a type → Frontend gets TS errors
```

## Principle 10: Evolution without Breaking Changes

### 10.1 Backward Compatibility

New features are added as opt-in, without breaking existing code.

### 10.2 Deprecation Warnings

```typescript
// Old API
signal.value = 5; // Warning: Use signal(5) instead. Will be removed in v2.0

// New API
signal(5);
```

### 10.3 Migration Codemods

```bash
nx migrate v1-to-v2
# Automatic codebase migration
```

## Philosophical Conclusion

Nexus is the answer to the question: "What would a frontend framework look like if it were designed from scratch with the lessons of the last 10 years in mind?"

We took the best of:
- **React**: Component model and unidirectional data flow
- **Vue**: Intuitive template syntax
- **Svelte**: Compile-time optimizations
- **SolidJS**: Fine-grained reactivity
- **Qwik**: Resumability
- **Angular**: Dependency Injection and modular architecture
- **Astro**: Islands Architecture

And discarded the worst:
- Virtual DOM overhead
- Runtime reactivity systems
- Boilerplate code
- Magical implicit behavior
- The need for manual optimizations

The result is a framework that is:
- **Minimal**: Less code, fewer concepts
- **Fast**: ~1KB runtime, ~30ms TTI
- **Type-safe**: TypeScript everywhere
- **Convenient**: Excellent DX out of the box
- **Powerful**: Full-stack integration with Titan

**Nexus is not a compromise. It is a synthesis of the best ideas.**
