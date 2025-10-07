# 04. Template Syntax - TypeScript JSX Implementation

> **Status**: ✅ **CURRENT - IMPLEMENTED**
> **Last Updated**: 2025-10-07
> **Part of**: Aether Frontend Framework Specification

---

## Overview

Aether uses **standard TypeScript JSX** for templates, providing full type safety, excellent tooling support, and zero learning curve for developers familiar with React or Solid.js. Instead of a custom template compiler, we provide **lightweight utility functions** that offer directive-like convenience while maintaining all benefits of standard JavaScript.

### Architecture Decision

After comprehensive evaluation (see `TEMPLATE-DIRECTIVES-EVALUATION.md`), we chose TypeScript JSX over a custom compiler:

**Weighted Score**: TypeScript JSX (8.70/10) vs Custom Compiler (6.90/10)

**Key Benefits**:
- ✅ **Superior Error Resistance** (10/10): Full TypeScript type safety, clear stack traces
- ✅ **Intuitiveness** (10/10): Standard JavaScript, zero learning curve
- ✅ **Unlimited Possibilities** (10/10): No compiler constraints
- ✅ **Fast Implementation**: 2 weeks vs 3-6 months
- ✅ **Perfect Tooling**: VSCode, Prettier, ESLint, Jest - all work out of box

---

## Table of Contents

1. [Basic JSX Syntax](#basic-jsx-syntax)
2. [Control Flow Components](#control-flow-components)
3. [Event Handling](#event-handling)
4. [Two-Way Binding](#two-way-binding)
5. [Class Management](#class-management)
6. [Style Management](#style-management)
7. [Custom Directives](#custom-directives)
8. [Performance Patterns](#performance-patterns)
9. [Migration from Spec](#migration-from-spec)

---

## Basic JSX Syntax

Aether uses standard TypeScript JSX. If you know React or Solid, you already know Aether templates.

### Simple Component

```typescript
import { defineComponent } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

export const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <div className="counter">
      <p>Count: {count()}</p>
      <button onClick={() => count.set(count() + 1)}>
        Increment
      </button>
    </div>
  );
});
```

### JSX Elements

All standard HTML elements work as expected:

```typescript
// Text elements
<h1>Heading</h1>
<p>Paragraph</p>
<span>Inline text</span>

// Form elements
<input type="text" />
<textarea />
<select>
  <option value="1">Option 1</option>
</select>

// Interactive elements
<button>Click me</button>
<a href="/link">Link</a>

// Media
<img src="/image.jpg" alt="Description" />
<video src="/video.mp4" />
```

### Fragments

Use fragments to group elements without extra DOM nodes:

```typescript
// Fragment syntax
<>
  <h1>Title</h1>
  <p>Content</p>
</>

// Or explicit Fragment component
import { Fragment } from '@omnitron-dev/aether';

<Fragment>
  <h1>Title</h1>
  <p>Content</p>
</Fragment>
```

### Dynamic Content

Embed reactive expressions directly:

```typescript
const name = signal('Alice');
const age = signal(25);

<div>
  <p>Name: {name()}</p>
  <p>Age: {age()}</p>
  <p>Next year: {age() + 1}</p>
</div>
```

---

## Control Flow Components

Instead of custom syntax like `{#if}` or `{#each}`, Aether provides **type-safe components** for control flow.

### Conditional Rendering - `<Show>`

#### Basic Usage

```typescript
import { Show } from '@omnitron-dev/aether';

const isLoggedIn = signal(false);

<Show when={isLoggedIn()} fallback={<p>Please log in</p>}>
  <p>Welcome back!</p>
</Show>
```

#### With Type Narrowing

```typescript
const user = signal<User | null>(null);

<Show when={user()} fallback={<p>Loading...</p>}>
  {(u) => (
    // u is typed as User (not User | null)
    <p>Hello, {u.name}!</p>
  )}
</Show>
```

#### Keyed Updates

```typescript
// Re-render when key changes
<Show when={user()} keyed fallback={<p>No user</p>}>
  {(u) => <UserProfile user={u} />}
</Show>
```

### Lists - `<For>`

#### Basic List Rendering

```typescript
import { For } from '@omnitron-dev/aether';

const items = signal(['Apple', 'Banana', 'Cherry']);

<For each={items()}>
  {(item, index) => (
    <li>
      {index()}: {item}
    </li>
  )}
</For>
```

#### With Fallback

```typescript
const items = signal<Item[]>([]);

<For each={items()} fallback={<p>No items found</p>}>
  {(item) => <ItemCard item={item} />}
</For>
```

#### Efficient Updates (Keyed)

```typescript
// Automatically uses item.id as key if available
<For each={items()}>
  {(item) => <div key={item.id}>{item.name}</div>}
</For>

// Or specify custom key
<For each={items()} by={(item) => item.id}>
  {(item) => <div>{item.name}</div>}
</For>
```

### Multi-way Conditionals - `<Switch>`

```typescript
import { Switch, Match } from '@omnitron-dev/aether';

const status = signal<'loading' | 'success' | 'error'>('loading');

<Switch>
  <Match when={status() === 'loading'}>
    <Spinner />
  </Match>
  <Match when={status() === 'success'}>
    <SuccessMessage />
  </Match>
  <Match when={status() === 'error'}>
    <ErrorMessage />
  </Match>
</Switch>
```

### Async Components - `<Suspense>`

```typescript
import { Suspense } from '@omnitron-dev/aether';

<Suspense fallback={<LoadingSpinner />}>
  <AsyncUserProfile userId={userId()} />
</Suspense>
```

#### Nested Suspense

```typescript
<Suspense fallback={<PageSkeleton />}>
  <Header />
  <Suspense fallback={<ContentSkeleton />}>
    <MainContent />
  </Suspense>
  <Suspense fallback={<SidebarSkeleton />}>
    <Sidebar />
  </Suspense>
</Suspense>
```

### Error Boundaries - `<ErrorBoundary>`

```typescript
import { ErrorBoundary } from '@omnitron-dev/aether';

<ErrorBoundary
  fallback={(error, reset) => (
    <div>
      <p>Error: {error.message}</p>
      <button onClick={reset}>Try Again</button>
    </div>
  )}
  onError={(error) => console.error(error)}
>
  <RiskyComponent />
</ErrorBoundary>
```

---

## Event Handling

Aether provides **event utility helpers** for common patterns, eliminating boilerplate while maintaining clarity.

### Basic Events

```typescript
// Standard JSX event handlers
<button onClick={() => console.log('clicked')}>Click</button>
<input onInput={(e) => setText(e.currentTarget.value)} />
<form onSubmit={(e) => handleSubmit(e)}>Submit</form>
```

### Event Modifiers

Instead of custom syntax like `on:click|preventDefault`, use utility functions:

```typescript
import { prevent, stop, preventStop } from '@omnitron-dev/aether/utils';

// Prevent default
<button onClick={prevent(handleSubmit)}>Submit</button>

// Stop propagation
<div onClick={stop(handleClick)}>Click won't bubble</div>

// Both
<form onSubmit={preventStop(handleFormSubmit)}>...</form>
```

### Available Event Modifiers

```typescript
import {
  prevent,           // preventDefault()
  stop,              // stopPropagation()
  stopImmediate,     // stopImmediatePropagation()
  preventStop,       // both prevent and stop
  self,              // only if event.target matches selector
  trusted,           // only trusted events (not programmatic)
  debounce,          // debounce handler
  throttle,          // throttle handler
  compose,           // compose multiple modifiers
} from '@omnitron-dev/aether/utils';
```

### Debouncing Events

```typescript
import { debounce } from '@omnitron-dev/aether/utils';

// Debounce search input
<input
  onInput={debounce(handleSearch, 500)}
  placeholder="Search..."
/>
```

### Throttling Events

```typescript
import { throttle } from '@omnitron-dev/aether/utils';

// Throttle scroll handler
<div onScroll={throttle(handleScroll, 100)}>
  Scrollable content
</div>
```

### Composing Modifiers

```typescript
import { compose, prevent, stop, debounce } from '@omnitron-dev/aether/utils';

// Combine multiple modifiers
const preventStopDebounce = compose([prevent, stop, (h) => debounce(h, 300)]);

<button onClick={preventStopDebounce(handleClick)}>
  Click
</button>
```

### Self Target Filter

```typescript
import { self } from '@omnitron-dev/aether/utils';

// Only handle clicks on button itself, not children
<button onClick={self('button', handleClick)}>
  <span>Icon</span>
  <span>Text</span>
</button>
```

### Trusted Events Only

```typescript
import { trusted } from '@omnitron-dev/aether/utils';

// Only handle real user interactions, not programmatic
<button onClick={trusted(handleRealClick)}>
  Security-sensitive action
</button>
```

---

## Two-Way Binding

Instead of `bind:value` syntax, Aether provides **binding utilities** that spread props.

### Text Input Binding

```typescript
import { bindValue } from '@omnitron-dev/aether/utils';

const text = signal('');

// Simple binding
<input {...bindValue(text)} />

// With transformation
<input {...bindValue(text, (v) => v.toUpperCase())} />
```

### Number Input Binding

```typescript
import { bindNumber } from '@omnitron-dev/aether/utils';

const age = signal(0);

<input type="number" {...bindNumber(age)} />
```

### Trimmed Input Binding

```typescript
import { bindTrimmed } from '@omnitron-dev/aether/utils';

const name = signal('');

<input {...bindTrimmed(name)} placeholder="Name" />
```

### Debounced Binding

```typescript
import { bindDebounced } from '@omnitron-dev/aether/utils';

const search = signal('');

// Updates signal 500ms after user stops typing
<input {...bindDebounced(search, 500)} placeholder="Search..." />
```

### Throttled Binding

```typescript
import { bindThrottled } from '@omnitron-dev/aether/utils';

const value = signal('');

// Updates signal at most once per 300ms
<input {...bindThrottled(value, 300)} />
```

### Lazy Binding (Update on Blur)

```typescript
import { bindLazy } from '@omnitron-dev/aether/utils';

const email = signal('');

// Only updates when input loses focus
<input {...bindLazy(email)} type="email" />
```

### Checkbox Binding

```typescript
import { bindChecked } from '@omnitron-dev/aether/utils';

const agreed = signal(false);

<input type="checkbox" {...bindChecked(agreed)} />
<label>I agree to terms</label>
```

### Radio Group Binding

```typescript
import { bindGroup } from '@omnitron-dev/aether/utils';

const selected = signal('option1');

<div>
  <input type="radio" {...bindGroup(selected, 'option1')} />
  <label>Option 1</label>

  <input type="radio" {...bindGroup(selected, 'option2')} />
  <label>Option 2</label>
</div>
```

### Select Binding

```typescript
import { bindSelect } from '@omnitron-dev/aether/utils';

const selection = signal('');

<select {...bindSelect(selection)}>
  <option value="">Choose...</option>
  <option value="opt1">Option 1</option>
  <option value="opt2">Option 2</option>
</select>
```

### Available Binding Helpers

```typescript
import {
  bindValue,        // Basic value binding
  bindNumber,       // Auto-convert to number
  bindTrimmed,      // Auto-trim whitespace
  bindDebounced,    // Debounced updates
  bindThrottled,    // Throttled updates
  bindLazy,         // Update on blur
  bindChecked,      // Checkbox binding
  bindGroup,        // Radio group binding
  bindSelect,       // Select element binding
  composeBinding,   // Compose binding modifiers
} from '@omnitron-dev/aether/utils';
```

---

## Class Management

Instead of `class:active={isActive}` syntax, use **class utilities**.

### Basic Class Names

```typescript
import { classNames } from '@omnitron-dev/aether/utils';

// Static classes
<div className="btn btn-primary">Button</div>

// Dynamic classes with classNames
<div className={classNames('btn', 'btn-primary', 'btn-large')}>
  Button
</div>
```

### Conditional Classes

```typescript
import { classNames } from '@omnitron-dev/aether/utils';

const isActive = signal(true);
const isDisabled = signal(false);

<div className={classNames('btn', {
  active: isActive(),
  disabled: isDisabled(),
  'btn-primary': !isDisabled()
})}>
  Button
</div>
```

### Reactive Classes with Functions

```typescript
import { classes } from '@omnitron-dev/aether/utils';

const theme = signal('dark');

<div className={classes('base', {
  dark: () => theme() === 'dark',
  light: () => theme() === 'light',
  active: isActive
})}>
  Content
</div>
```

### Toggle Single Class

```typescript
import { toggleClass } from '@omnitron-dev/aether/utils';

const isVisible = signal(true);

<div className={toggleClass('visible', isVisible)}>
  Content
</div>
```

### Variant-Based Classes

```typescript
import { variantClasses } from '@omnitron-dev/aether/utils';

const variant = signal<'primary' | 'secondary'>('primary');
const size = signal<'sm' | 'md' | 'lg'>('md');

<button className={variantClasses(
  'btn',
  {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    sm: 'btn-sm',
    md: 'btn-md',
    lg: 'btn-lg'
  },
  [variant(), size()]
)}>
  Button
</button>
```

### Merge Classes

```typescript
import { mergeClasses } from '@omnitron-dev/aether/utils';

const baseClasses = 'btn btn-primary';
const conditionalClasses = isActive() ? 'active hover' : '';

// Removes duplicates
<button className={mergeClasses(baseClasses, conditionalClasses, 'btn')}>
  Button (no duplicate 'btn')
</button>
```

### Available Class Utilities

```typescript
import {
  classNames,           // Main utility, alias: cx
  classes,              // With base and conditional
  reactiveClasses,      // Reactive evaluation
  toggleClass,          // Single class toggle
  conditionalClasses,   // Only conditional
  variantClasses,       // Variant-based
  mergeClasses,         // Deduplicate classes
} from '@omnitron-dev/aether/utils';
```

---

## Style Management

Instead of `style:color={color}` syntax, use **style utilities**.

### Basic Styles

```typescript
import { styles } from '@omnitron-dev/aether/utils';

const color = signal('red');
const fontSize = signal(16);

<div style={styles({
  color: color(),
  fontSize: `${fontSize()}px`,
  padding: '10px',
  margin: 0
})}>
  Styled content
</div>
```

### Reactive Styles with Functions

```typescript
import { styles } from '@omnitron-dev/aether/utils';

const theme = signal({ primary: '#007bff', text: '#333' });

<div style={styles({
  color: () => theme().text,
  backgroundColor: () => theme().primary,
  fontSize: () => `${baseFontSize() * 1.5}px`
})}>
  Themed content
</div>
```

### CSS Custom Properties (Variables)

```typescript
import { cssVar, styles } from '@omnitron-dev/aether/utils';

const themeColor = signal('#007bff');

// Single CSS variable
<div style={cssVar('theme-color', themeColor())}>
  <p style={{ color: 'var(--theme-color)' }}>Text</p>
</div>

// Multiple CSS variables
<div style={styles({
  '--primary-color': themeColor(),
  '--secondary-color': '#6c757d',
  '--spacing': '1rem'
})}>
  Content
</div>
```

### Conditional Styles

```typescript
import { conditionalStyles } from '@omnitron-dev/aether/utils';

const isHighlighted = signal(true);

<div style={conditionalStyles(
  isHighlighted(),
  { backgroundColor: 'yellow', fontWeight: 'bold' },
  { backgroundColor: 'transparent' }
)}>
  Conditionally styled
</div>
```

### Merge Styles

```typescript
import { mergeStyles } from '@omnitron-dev/aether/utils';

const baseStyles = { padding: '10px', margin: '5px' };
const themeStyles = { color: theme().text, backgroundColor: theme().bg };

<div style={mergeStyles(baseStyles, themeStyles, { fontSize: '14px' })}>
  Merged styles
</div>
```

### Layout Helpers

```typescript
import { flexStyles, gridStyles, sizeStyles } from '@omnitron-dev/aether/utils';

// Flexbox
<div style={flexStyles({ justify: 'center', align: 'center', gap: '1rem' })}>
  Flex container
</div>

// Grid
<div style={gridStyles({ columns: 3, gap: '20px' })}>
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>

// Size
<div style={sizeStyles({ width: 300, height: 200 })}>
  Fixed size
</div>
```

### Available Style Utilities

```typescript
import {
  styles,              // Main utility
  reactiveStyles,      // Reactive evaluation
  mergeStyles,         // Merge multiple style objects
  cssVar,              // Single CSS custom property
  cssVars,             // Multiple CSS custom properties
  conditionalStyles,   // Conditional style objects
  sizeStyles,          // Width/height helpers
  positionStyles,      // Position helpers
  flexStyles,          // Flexbox helpers
  gridStyles,          // Grid helpers
} from '@omnitron-dev/aether/utils';
```

---

## Custom Directives

Instead of `use:directiveName` syntax, use the **directive pattern** with refs.

### Creating a Directive

```typescript
import { createDirective } from '@omnitron-dev/aether/utils';

// Define tooltip directive
const tooltip = createDirective<string>((element, text) => {
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.textContent = text;

  const show = () => {
    document.body.appendChild(tooltipEl);
    positionTooltip(tooltipEl, element);
  };

  const hide = () => {
    tooltipEl.remove();
  };

  element.addEventListener('mouseenter', show);
  element.addEventListener('mouseleave', hide);

  // Return cleanup function
  return () => {
    hide();
    element.removeEventListener('mouseenter', show);
    element.removeEventListener('mouseleave', hide);
  };
});

// Use directive
<button ref={tooltip('Click to submit')}>
  Submit
</button>
```

### Built-in Directives

```typescript
import {
  autoFocus,
  clickOutside,
  intersectionObserver,
  resizeObserver,
  longPress,
  swipe,
} from '@omnitron-dev/aether/utils';

// Auto-focus input
<input ref={autoFocus()} />

// Click outside handler
const handleClose = () => setIsOpen(false);
<div ref={clickOutside(handleClose)}>
  Modal content
</div>

// Intersection observer
<div ref={intersectionObserver({
  onIntersect: (entry) => console.log('Visible:', entry.isIntersecting),
  threshold: 0.5
})}>
  Lazy-loaded content
</div>

// Resize observer
<div ref={resizeObserver((entry) => {
  console.log('Size:', entry.contentRect.width, entry.contentRect.height);
})}>
  Resizable content
</div>

// Long press
<button ref={longPress(() => console.log('Long pressed'), 1000)}>
  Hold me
</button>

// Swipe gesture
<div ref={swipe({
  onSwipeLeft: () => console.log('Swiped left'),
  onSwipeRight: () => console.log('Swiped right'),
  threshold: 50
})}>
  Swipeable content
</div>
```

### Updatable Directives

```typescript
import { createUpdatableDirective } from '@omnitron-dev/aether/utils';

const coloredBorder = createUpdatableDirective<{ color: string; width: number }>(
  (element, params) => {
    const apply = () => {
      element.style.border = `${params.width}px solid ${params.color}`;
    };

    apply();

    return {
      update(newParams) {
        params = newParams;
        apply();
      },
      destroy() {
        element.style.border = '';
      }
    };
  }
);

// Use with reactive parameters
const borderColor = signal('red');
<div ref={coloredBorder({ color: borderColor(), width: 2 })}>
  Content
</div>
```

### Combining Directives

```typescript
import { combineDirectives, autoFocus, tooltip, clickOutside } from '@omnitron-dev/aether/utils';

const multiDirective = combineDirectives([
  autoFocus(),
  tooltip('Enter your email'),
  clickOutside(() => console.log('Clicked outside'))
]);

<input ref={multiDirective} />
```

### Available Directive Utilities

```typescript
import {
  createDirective,           // Create custom directive
  createUpdatableDirective,  // Create updatable directive
  combineDirectives,         // Combine multiple directives
  autoFocus,                 // Auto-focus element
  clickOutside,              // Click outside handler
  intersectionObserver,      // Intersection observer
  resizeObserver,            // Resize observer
  longPress,                 // Long press gesture
  swipe,                     // Swipe gesture
} from '@omnitron-dev/aether/utils';
```

---

## Performance Patterns

### Memoization with `computed()`

```typescript
import { signal, computed } from '@omnitron-dev/aether/reactivity';

const numbers = signal([1, 2, 3, 4, 5]);

// Only recomputes when numbers change
const sum = computed(() =>
  numbers().reduce((a, b) => a + b, 0)
);

<div>Sum: {sum()}</div>
```

### Batching Updates

```typescript
import { batch } from '@omnitron-dev/aether/reactivity';

const firstName = signal('');
const lastName = signal('');
const fullName = computed(() => `${firstName()} ${lastName()}`);

// Update both without triggering fullName twice
batch(() => {
  firstName.set('John');
  lastName.set('Doe');
});
// fullName computes only once
```

### Lazy Loading Components

```typescript
import { lazy } from '@omnitron-dev/aether/component';
import { Suspense } from '@omnitron-dev/aether';

// Lazy load heavy component
const HeavyChart = lazy(() => import('./HeavyChart'));

<Suspense fallback={<div>Loading chart...</div>}>
  <HeavyChart data={chartData()} />
</Suspense>
```

### Virtual Lists (For Large Lists)

```typescript
import { For } from '@omnitron-dev/aether';
import { signal, computed } from '@omnitron-dev/aether/reactivity';

const items = signal(Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `Item ${i}` })));
const scrollTop = signal(0);
const itemHeight = 50;
const visibleCount = 20;

const visibleItems = computed(() => {
  const start = Math.floor(scrollTop() / itemHeight);
  const end = start + visibleCount;
  return items().slice(start, end);
});

<div
  style={{ height: '1000px', overflow: 'auto' }}
  onScroll={(e) => scrollTop.set(e.currentTarget.scrollTop)}
>
  <div style={{ height: `${items().length * itemHeight}px`, position: 'relative' }}>
    <For each={visibleItems()}>
      {(item, index) => (
        <div
          style={{
            position: 'absolute',
            top: `${(Math.floor(scrollTop() / itemHeight) + index()) * itemHeight}px`,
            height: `${itemHeight}px`
          }}
        >
          {item.name}
        </div>
      )}
    </For>
  </div>
</div>
```

### Avoiding Unnecessary Re-renders

```typescript
import { signal, computed } from '@omnitron-dev/aether/reactivity';

const user = signal({ name: 'Alice', age: 25, email: 'alice@example.com' });

// Only re-renders when name changes, not when age or email change
const userName = computed(() => user().name);

<div>Name: {userName()}</div>
```

---

## Migration from Spec

If you were expecting Svelte-like syntax from the original specification, here's how to use the actual implementation:

### Control Flow Migration

| Spec Syntax (NOT implemented) | Actual Implementation |
|-------------------------------|----------------------|
| `{#if condition}...{:else}...{/if}` | `<Show when={condition} fallback={...}>...</Show>` |
| `{#each items as item}...{/each}` | `<For each={items}>{(item) => ...}</For>` |
| `{#await promise}...{:then}...{:catch}...{/await}` | `<Suspense fallback={...}><Async /></Suspense>` |
| `{#key value}...{/key}` | `<Show when={value} keyed>...</Show>` |

### Event Handling Migration

| Spec Syntax (NOT implemented) | Actual Implementation |
|-------------------------------|----------------------|
| `on:click\|preventDefault={handler}` | `onClick={prevent(handler)}` |
| `on:click\|stopPropagation={handler}` | `onClick={stop(handler)}` |
| `on:input\|debounce={500}={handler}` | `onInput={debounce(handler, 500)}` |
| `on:scroll\|throttle={100}={handler}` | `onScroll={throttle(handler, 100)}` |

### Binding Migration

| Spec Syntax (NOT implemented) | Actual Implementation |
|-------------------------------|----------------------|
| `bind:value={text}` | `{...bindValue(text)}` |
| `bind:value\|number={age}` | `{...bindNumber(age)}` |
| `bind:value\|trim={name}` | `{...bindTrimmed(name)}` |
| `bind:value\|debounce={500}={search}` | `{...bindDebounced(search, 500)}` |
| `bind:checked={agreed}` | `{...bindChecked(agreed)}` |
| `bind:group={selected}` | `{...bindGroup(selected, value)}` |

### Class/Style Migration

| Spec Syntax (NOT implemented) | Actual Implementation |
|-------------------------------|----------------------|
| `class:active={isActive}` | `className={classes('base', { active: isActive })}` |
| `style:color={textColor}` | `style={styles({ color: textColor })}` |
| `style:--theme={themeColor}` | `style={cssVar('theme', themeColor)}` |

### Directive Migration

| Spec Syntax (NOT implemented) | Actual Implementation |
|-------------------------------|----------------------|
| `use:tooltip="text"` | `ref={tooltip('text')}` |
| `use:clickOutside={handler}` | `ref={clickOutside(handler)}` |
| `use:autoFocus` | `ref={autoFocus()}` |

---

## Best Practices

### 1. Prefer Components Over Utilities When Reusing

```typescript
// ❌ Not ideal - repetitive
<button onClick={preventStop(handleClick)} className={classes('btn', { active: isActive() })}>
  Click
</button>
<button onClick={preventStop(handleClick)} className={classes('btn', { active: isActive() })}>
  Another
</button>

// ✅ Better - create component
const ActiveButton = defineComponent<{ onClick: () => void; children: any }>((props) => {
  return () => (
    <button
      onClick={preventStop(props.onClick)}
      className={classes('btn', { active: isActive() })}
    >
      {props.children}
    </button>
  );
});

<ActiveButton onClick={handleClick}>Click</ActiveButton>
<ActiveButton onClick={handleClick}>Another</ActiveButton>
```

### 2. Use computed() for Expensive Operations

```typescript
// ❌ Not ideal - recalculates on every render
<div>Total: {items().reduce((sum, item) => sum + item.price, 0)}</div>

// ✅ Better - memoized
const total = computed(() =>
  items().reduce((sum, item) => sum + item.price, 0)
);
<div>Total: {total()}</div>
```

### 3. Batch Related Updates

```typescript
// ❌ Not ideal - triggers multiple updates
setFirstName('John');
setLastName('Doe');
setAge(30);

// ✅ Better - single update
batch(() => {
  setFirstName('John');
  setLastName('Doe');
  setAge(30);
});
```

### 4. Use Type-Safe Props

```typescript
// ✅ Always define prop types
interface ButtonProps {
  variant: 'primary' | 'secondary';
  size: 'sm' | 'md' | 'lg';
  onClick: () => void;
  children: any;
}

const Button = defineComponent<ButtonProps>((props) => {
  // TypeScript ensures props are correct
  return () => <button className={variantClasses('btn', variants, [props.variant, props.size])}>...</button>;
});
```

### 5. Clean Up Side Effects

```typescript
import { onCleanup } from '@omnitron-dev/aether/reactivity';

const MyComponent = defineComponent(() => {
  const interval = setInterval(() => console.log('tick'), 1000);

  onCleanup(() => {
    clearInterval(interval);
  });

  return () => <div>Component</div>;
});
```

---

## Performance Comparison

### TypeScript JSX vs Custom Compiler

| Metric | TypeScript JSX | Custom Compiler |
|--------|---------------|-----------------|
| **Runtime Performance** | 7/10 (very good) | 10/10 (optimal) |
| **Build Time** | 10/10 (fast) | 6/10 (slower) |
| **Bundle Size** | 8/10 (~6KB core + utils) | 9/10 (~4KB core) |
| **Type Safety** | 10/10 (full TS) | 6/10 (needs plugin) |
| **Debugging** | 10/10 (clear traces) | 6/10 (source maps) |
| **Tooling** | 10/10 (standard) | 4/10 (custom) |
| **Learning Curve** | 10/10 (zero) | 7/10 (new syntax) |

**Verdict**: TypeScript JSX provides **7/10 runtime performance**, which is sufficient for 99% of use cases, while excelling in developer experience, tooling, and type safety. The 3-point performance gap can be addressed with optional compiler plugins in the future without breaking existing code.

---

## Next Steps

- **Component Patterns**: See [03-COMPONENTS.md](./03-COMPONENTS.md)
- **Directives Deep Dive**: See [05-DIRECTIVES.md](./05-DIRECTIVES.md)
- **Architectural Decision**: See [TEMPLATE-DIRECTIVES-EVALUATION.md](./TEMPLATE-DIRECTIVES-EVALUATION.md)
- **Implementation Examples**: See `packages/aether/tests/unit/utils/*.spec.ts`

---

## Summary

Aether's **TypeScript JSX + Utilities** approach provides:

✅ **Zero Learning Curve** - Standard JavaScript/TypeScript
✅ **Full Type Safety** - TypeScript checks everything
✅ **Perfect Tooling** - VSCode, Prettier, ESLint, Jest all work
✅ **Clear Debugging** - No source maps needed
✅ **Unlimited Flexibility** - No compiler constraints
✅ **Directive-like Convenience** - Utilities reduce boilerplate
✅ **Production Ready** - 109/109 utility tests passing

This approach delivers the best balance of **developer experience**, **error resistance**, **flexibility**, and **convenience** without requiring a custom compiler.
