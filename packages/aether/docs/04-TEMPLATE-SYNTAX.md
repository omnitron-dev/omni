# 04. Template Syntax

> **Status**: ⚠️ **OUTDATED - NOT IMPLEMENTED**
> **Last Updated**: 2025-10-06 (marked as outdated)
> **Part of**: Aether Frontend Framework Specification

---

## ⚠️ CRITICAL NOTICE ⚠️

**This specification describes a custom template compiler that was NOT implemented.**

After comprehensive architectural evaluation (see `TEMPLATE-DIRECTIVES-EVALUATION.md`), we made the decision to use **standard TypeScript JSX** instead of implementing a custom compiler.

### What This Means:

❌ **NOT IMPLEMENTED** (as described in this document):
- Custom control flow syntax: `{#if}`, `{#each}`, `{#await}`, `{#key}`
- Event modifier syntax: `on:click|preventDefault|stopPropagation`
- Two-way binding syntax: `bind:value`, `bind:checked`, `bind:group`
- Conditional syntax blocks: `{:else}`, `{:then}`, `{:catch}`
- Custom template compiler
- Svelte-like directives

✅ **ACTUALLY IMPLEMENTED** (TypeScript JSX + Utilities):
- Standard TypeScript JSX: `<button onClick={handler}>Click</button>`
- Component-based control flow: `<Show>`, `<For>`, `<Switch>`, `<Suspense>`
- Event utilities: `<button onClick={prevent(handler)}>Submit</button>`
- Binding utilities: `<input {...bindValue(signal)} />`
- Class utilities: `<div className={classes('btn', { active: isActive() })}>`
- Style utilities: `<div style={styles({ color: theme() })}>`
- Directive pattern: `<button ref={tooltip('text')}>Hover</button>`

### Why the Change?

**Weighted Evaluation Score**: TypeScript JSX (8.70/10) vs Custom Compiler (6.90/10)

**Key Reasons**:
1. **Superior Error Resistance** (20% weight): TypeScript type safety (10/10) vs source maps (6/10)
2. **Zero Learning Curve** (20% weight): Standard JavaScript (10/10) vs new syntax (7/10)
3. **Unlimited Possibilities** (15% weight): No constraints (10/10) vs compiler limits (7/10)
4. **Fast Implementation**: 2 weeks + 500 lines vs 3-6 months + 15-25k lines
5. **Better Tooling**: Works with all standard tools (VSCode, Prettier, ESLint, etc.)

### Where to Find Actual Documentation:

For **actual implementation patterns**, see:
- ✅ **`ARCHITECTURE-ANALYSIS.md`** - Component API alignment
- ✅ **`TEMPLATE-DIRECTIVES-EVALUATION.md`** - Full architectural evaluation (2850 lines)
- ✅ **`IMPLEMENTATION-PLAN.md`** - Updated with architectural decision
- ✅ **`03-COMPONENTS.md`** - Component patterns (aligned with implementation)
- ✅ **Source code**: `packages/aether/src/utils/` - Utility implementations
- ✅ **Tests**: `packages/aether/tests/unit/utils/` - Usage examples (109 tests)

### Quick Migration Guide:

If you were expecting the syntax described in this document, here's how to use the actual implementation:

<details>
<summary><b>Control Flow (Click to expand)</b></summary>

**Spec (NOT implemented)**:
```tsx
{#if condition}
  <p>True</p>
{:else}
  <p>False</p>
{/if}
```

**Actual Implementation**:
```tsx
<Show when={condition} fallback={<p>False</p>}>
  <p>True</p>
</Show>
```
</details>

<details>
<summary><b>Lists (Click to expand)</b></summary>

**Spec (NOT implemented)**:
```tsx
{#each items as item (item.id)}
  <div>{item.name}</div>
{/each}
```

**Actual Implementation**:
```tsx
<For each={items}>
  {(item) => <div>{item.name}</div>}
</For>
```
</details>

<details>
<summary><b>Events (Click to expand)</b></summary>

**Spec (NOT implemented)**:
```tsx
<button on:click|preventDefault={handleClick}>Click</button>
```

**Actual Implementation**:
```tsx
import { prevent } from '@omnitron-dev/aether';
<button onClick={prevent(handleClick)}>Click</button>
```
</details>

<details>
<summary><b>Binding (Click to expand)</b></summary>

**Spec (NOT implemented)**:
```tsx
<input bind:value={text} />
<input type="number" bind:value|number={age} />
```

**Actual Implementation**:
```tsx
import { bindValue, bindNumber } from '@omnitron-dev/aether';
<input {...bindValue(text)} />
<input type="number" {...bindNumber(age)} />
```
</details>

<details>
<summary><b>Classes (Click to expand)</b></summary>

**Spec (NOT implemented)**:
```tsx
<div class:active={isActive()} class:disabled={isDisabled()}>
```

**Actual Implementation**:
```tsx
import { classes } from '@omnitron-dev/aether';
<div className={classes('base', { active: isActive(), disabled: isDisabled() })}>
```
</details>

---

**The rest of this document is preserved for reference only and does NOT reflect the actual implementation.**

---

## Table of Contents

1. [Overview](#overview)
2. [Philosophy](#philosophy)
3. [JSX Basics](#jsx-basics)
4. [Interpolation](#interpolation)
5. [Conditionals](#conditionals)
6. [Loops](#loops)
7. [Events](#events)
8. [Bindings](#bindings)
9. [Attributes](#attributes)
10. [Special Elements](#special-elements)
11. [Directives](#directives)
12. [Advanced Features](#advanced-features)
13. [Compilation](#compilation)
14. [Comparison](#comparison)
15. [Best Practices](#best-practices)
16. [Examples](#examples)

---

## Overview

Aether uses **JSX** (JavaScript XML) as its template syntax, extended with special directives and control flow syntax. JSX provides a familiar, type-safe, and powerful way to describe UI.

### Why JSX?

**Advantages**:
- **Type Safety**: Full TypeScript support with autocomplete
- **Familiar**: Used by React, SolidJS, and others
- **Composable**: Easy to extract and reuse logic
- **IDE Support**: Excellent tooling (syntax highlighting, refactoring)
- **JavaScript**: Full power of JavaScript in templates

**Aether Extensions**:
- Control flow: `{#if}`, `{#each}`, `{#await}`
- Directives: `on:event`, `bind:value`, `class:name`
- Automatic reactivity tracking

### Template Syntax Overview

```typescript
const TodoApp = defineComponent(() => {
  const todos = signal<Todo[]>([]);
  const filter = signal<'all' | 'active' | 'completed'>('all');

  const filteredTodos = computed(() => {
    const f = filter();
    return todos().filter(t => {
      if (f === 'active') return !t.done;
      if (f === 'completed') return t.done;
      return true;
    });
  });

  return () => (
    <div class="todo-app">
      {/* Interpolation */}
      <h1>Todos ({filteredTodos().length})</h1>

      {/* Conditionals */}
      {#if filteredTodos().length === 0}
        <p>No todos!</p>
      {:else}
        {/* Loops */}
        <ul>
          {#each filteredTodos() as todo}
            <li class:done={todo.done}>
              {/* Events */}
              <input
                type="checkbox"
                checked={todo.done}
                on:change={() => toggleTodo(todo.id)}
              />
              <span>{todo.text}</span>
            </li>
          {/each}
        </ul>
      {/if}

      {/* Bindings */}
      <select bind:value={filter}>
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="completed">Completed</option>
      </select>
    </div>
  );
});
```

---

## Philosophy

### JSX is Just JavaScript

Unlike template languages (Vue, Svelte, Angular), JSX is **valid JavaScript**:

```typescript
// This is valid JavaScript (after JSX transform)
const element = <div>Hello</div>;

// Equivalent to:
const element = createElement('div', null, 'Hello');
```

**Benefits**:
- No need to learn new syntax
- Full JavaScript power (map, filter, reduce, etc.)
- Type checking works naturally
- Refactoring tools work out of the box

### Reactive by Default

Reading signals in JSX automatically creates dependencies:

```typescript
const count = signal(0);

// ✅ Reactive - automatically updates
<div>{count()}</div>

// ❌ Not reactive - just reads once
const value = count();
<div>{value}</div>
```

### Compile-Time Optimizations

Aether compiler analyzes JSX at **build time** to optimize runtime:

```typescript
// Source
<div class="container">
  <h1>{title()}</h1>
  <p>Static text</p>
</div>

// Compiled (simplified)
const div = createElement('div', { class: 'container' });
const h1 = createElement('h1');
const p = createElement('p', null, 'Static text');

effect(() => {
  h1.textContent = title(); // Only this updates
});

div.append(h1, p);
```

**Optimizations**:
- Static nodes created once
- Only dynamic parts become reactive
- No Virtual DOM diffing

---

## JSX Basics

### Elements

```typescript
// HTML elements (lowercase)
<div>Content</div>
<button>Click</button>
<input type="text" />

// Self-closing tags
<img src="image.jpg" />
<br />
<hr />

// Components (PascalCase)
<UserProfile />
<TodoList />
```

### Attributes

```typescript
// String literals
<div class="container"></div>
<img src="photo.jpg" alt="Photo" />

// Expressions in braces
<div class={className()}></div>
<img src={imageUrl()} alt={altText()} />

// Boolean attributes
<button disabled={isDisabled()}>Submit</button>
<input type="checkbox" checked={isChecked()} />

// Spread attributes
<button {...buttonProps}>Click</button>
```

### Children

```typescript
// Text
<div>Hello World</div>

// Expressions
<div>{userName()}</div>

// Multiple children
<div>
  <h1>Title</h1>
  <p>Paragraph</p>
</div>

// Mixed content
<div>
  Hello, {userName()}! You have {count()} messages.
</div>

// Arrays (automatically flattened)
<ul>
  {todos().map(todo => <li>{todo.text}</li>)}
</ul>
```

### Fragments

Group multiple elements without wrapper:

```typescript
import { Fragment } from 'aether';

// With Fragment component
<Fragment>
  <div>First</div>
  <div>Second</div>
</Fragment>

// Short syntax (if supported by compiler)
<>
  <div>First</div>
  <div>Second</div>
</>
```

### Comments

```typescript
<div>
  {/* JSX comment */}
  <p>Content</p>

  {/*
    Multi-line
    comment
  */}
</div>
```

---

## Interpolation

### Basic Interpolation

```typescript
const name = signal('Alice');
const age = signal(30);

<div>
  <p>Name: {name()}</p>
  <p>Age: {age()}</p>
</div>
```

### Expressions

```typescript
const count = signal(5);

<div>
  {/* Arithmetic */}
  <p>Double: {count() * 2}</p>

  {/* String concatenation */}
  <p>Message: {'Count is ' + count()}</p>

  {/* Template literals */}
  <p>Message: {`Count is ${count()}`}</p>

  {/* Ternary */}
  <p>{count() > 10 ? 'High' : 'Low'}</p>

  {/* Function calls */}
  <p>{formatNumber(count())}</p>

  {/* Logical operators */}
  <p>{count() > 0 && 'Positive'}</p>
  <p>{count() || 'Zero'}</p>
</div>
```

### HTML Escaping

**Automatic Escaping** (safe by default):

```typescript
const userInput = signal('<script>alert("XSS")</script>'

// ✅ Safe - HTML entities escaped
<div>{userInput()}</div>
// Renders: &lt;script&gt;alert("XSS")&lt;/script&gt;
```

**Raw HTML** (dangerous):

```typescript
import { html } from 'aether';

const htmlContent = signal('<strong>Bold</strong>');

// ⚠️ Dangerous - use only for trusted content
<div innerHTML={html(htmlContent())}></div>
```

### Reactive Updates

```typescript
const count = signal(0);

<div>
  {/* Automatically updates when count changes */}
  <p>Count: {count()}</p>

  {/* Computed values also reactive */}
  <p>Doubled: {count() * 2}</p>

  {/* Function calls are reactive if they read signals */}
  <p>Formatted: {formatCount()}</p>
</div>

const formatCount = () => {
  return `Count is ${count()}`; // Reads signal, so reactive
};
```

---

## Conditionals

### if/else

```typescript
const isLoggedIn = signal(false);

<div>
  {#if isLoggedIn()}
    <p>Welcome back!</p>
  {:else}
    <p>Please log in</p>
  {/if}
</div>
```

### if/else if/else

```typescript
const status = signal<'loading' | 'success' | 'error'>('loading');

<div>
  {#if status() === 'loading'}
    <Spinner />
  {:else if status() === 'success'}
    <SuccessMessage />
  {:else if status() === 'error'}
    <ErrorMessage />
  {:else}
    <UnknownState />
  {/if}
</div>
```

### Ternary Operator

```typescript
// Simple conditions
<div>
  {isVisible() ? <Content /> : null}
</div>

<div>
  {count() > 10 ? 'High' : 'Low'}
</div>

// Nested ternary (use sparingly)
<div>
  {status() === 'loading'
    ? <Spinner />
    : status() === 'error'
    ? <Error />
    : <Content />
  }
</div>
```

### Logical Operators

```typescript
// && (renders right side if left is truthy)
<div>
  {isLoggedIn() && <Dashboard />}
  {count() > 0 && <Badge count={count()} />}
</div>

// || (renders right side if left is falsy)
<div>
  {userName() || 'Guest'}
  {imageUrl() || '/default-avatar.png'}
</div>

// ?? (nullish coalescing)
<div>
  {userName() ?? 'Unknown User'}
</div>
```

### Show Directive (Alternative)

```typescript
// show:condition - element stays in DOM, visibility toggled
<div show:visible={isVisible()}>
  This element stays in DOM
</div>

// Equivalent to:
<div style:display={isVisible() ? 'block' : 'none'}>
  This element stays in DOM
</div>
```

---

## Loops

### each

```typescript
interface Todo {
  id: number;
  text: string;
  done: boolean;
}

const todos = signal<Todo[]>([
  { id: 1, text: 'Learn (Aether)', done: false },
  { id: 2, text: 'Build app', done: false }
]);

<ul>
  {#each todos() as todo}
    <li>{todo.text}</li>
  {/each}
</ul>
```

### each with index

```typescript
<ul>
  {#each todos() as todo, index}
    <li>
      {index + 1}. {todo.text}
    </li>
  {/each}
</ul>
```

### each with key

**Important**: Use `key` for lists that can change order:

```typescript
<ul>
  {#each todos() as todo (todo.id)}
    <li>{todo.text}</li>
  {/each}
</ul>

// Alternative syntax
<ul>
  {#each todos() as todo}
    <li key={todo.id}>
      {todo.text}
    </li>
  {/each}
</ul>
```

**Why keys matter**:
- Preserve component state when items reorder
- Optimize DOM updates
- Avoid bugs with stateful components

```typescript
// ❌ Without key - state gets mixed up when reordering
{#each items() as item}
  <Counter initialValue={item.count} />
{/each}

// ✅ With key - state preserved correctly
{#each items() as item (item.id)}
  <Counter initialValue={item.count} />
{/each}
```

### each/else

```typescript
<div>
  {#if todos().length > 0}
    <ul>
      {#each todos() as todo}
        <li>{todo.text}</li>
      {/each}
    </ul>
  {:else}
    <p>No todos yet!</p>
  {/if}
</div>

// Shorter with each/else
<div>
  {#each todos() as todo}
    <li>{todo.text}</li>
  {:else}
    <p>No todos yet!</p>
  {/each}
</div>
```

### Nested Loops

```typescript
interface Category {
  name: string;
  items: string[];
}

const categories = signal<Category[]>([
  { name: 'Fruits', items: ['Apple', 'Banana'] },
  { name: 'Vegetables', items: ['Carrot', 'Lettuce'] }
]);

<div>
  {#each categories() as category}
    <div>
      <h3>{category.name}</h3>
      <ul>
        {#each category.items as item}
          <li>{item}</li>
        {/each}
      </ul>
    </div>
  {/each}
</div>
```

### Destructuring

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

const users = signal<User[]>([...]);

// Destructure in loop
{#each users() as { id, name, email }}
  <div>
    <h4>{name}</h4>
    <p>{email}</p>
  </div>
{/each}
```

---

## Events

### Event Handlers

```typescript
<button on:click={() => console.log('Clicked')}>
  Click Me
</button>

<input
  on:input={(e) => console.log(e.target.value)}
  on:focus={() => console.log('Focused')}
  on:blur={() => console.log('Blurred')}
/>

<form on:submit={(e) => {
  e.preventDefault();
  handleSubmit();
}}>
  <button type="submit">Submit</button>
</form>
```

### Event Object

```typescript
const handleClick = (e: MouseEvent) => {
  console.log('Button:', e.button);
  console.log('Position:', e.clientX, e.clientY);
  console.log('Target:', e.target);
};

<button on:click={handleClick}>Click</button>
```

### Event Modifiers

```typescript
// preventDefault
<form on:submit|preventDefault={handleSubmit}>
  <button>Submit</button>
</form>

// stopPropagation
<div on:click={() => console.log('Parent')}>
  <button on:click|stopPropagation={() => console.log('Child')}>
    Click (doesn't bubble)
  </button>
</div>

// capture (capture phase)
<div on:click|capture={handleClick}>
  <button>Click</button>
</div>

// once (runs only once)
<button on:click|once={handleFirstClick}>
  Click Me Once
</button>

// passive (improves scroll performance)
<div on:scroll|passive={handleScroll}>
  Content
</div>

// self (only if event.target === currentTarget)
<div on:click|self={handleSelf}>
  <button>This won't trigger parent handler</button>
</div>

// Multiple modifiers
<a href="/page" on:click|preventDefault|stopPropagation={handleClick}>
  Link
</a>
```

### Custom Events

```typescript
// Child component
interface ChildProps {
  onCustomEvent: (data: { value: number }) => void;
}

const Child = defineComponent<ChildProps>((props) => {
  const emit = () => {
    props.onCustomEvent({ value: 42 });
  };

  return () => <button on:click={emit}>Emit</button>;
});

// Parent
const Parent = defineComponent(() => {
  const handleCustom = (data: { value: number }) => {
    console.log('Received:', data.value);
  };

  return () => <Child onCustomEvent={handleCustom} />;
});
```

### Event Delegation

Aether automatically delegates common events for performance:

```typescript
// All click events delegated to root
<div>
  {#each items() as item}
    <button on:click={() => handleClick(item.id)}>
      {item.name}
    </button>
  {/each}
</div>
```

---

## Bindings

### Two-Way Binding

**Input**:

```typescript
const text = signal('');

// Bind input value
<input bind:value={text} />

// Equivalent to:
<input
  value={text()}
  on:input={(e) => text.set(e.target.value)}
/>
```

**Checkbox**:

```typescript
const checked = signal(false);

<input type="checkbox" bind:checked={checked} />

// Equivalent to:
<input
  type="checkbox"
  checked={checked()}
  on:change={(e) => checked.set(e.target.checked)}
/>
```

**Radio**:

```typescript
const selected = signal('option1');

<label>
  <input type="radio" bind:group={selected} value="option1" />
  Option 1
</label>
<label>
  <input type="radio" bind:group={selected} value="option2" />
  Option 2
</label>

// selected() will be 'option1' or 'option2'
```

**Select**:

```typescript
const selected = signal('apple');

<select bind:value={selected}>
  <option value="apple">Apple</option>
  <option value="banana">Banana</option>
  <option value="orange">Orange</option>
</select>
```

**Multiple Select**:

```typescript
const selected = signal<string[]>([]);

<select multiple bind:value={selected}>
  <option value="red">Red</option>
  <option value="green">Green</option>
  <option value="blue">Blue</option>
</select>

// selected() will be array like ['red', 'blue']
```

**Textarea**:

```typescript
const text = signal('');

<textarea bind:value={text}></textarea>
```

**Contenteditable**:

```typescript
const html = signal('<strong>Bold</strong>');

<div contenteditable="true" bind:innerHTML={html}></div>
```

### Binding Modifiers

```typescript
// number - convert to number
<input type="number" bind:value|number={age} />

// trim - trim whitespace
<input type="text" bind:value|trim={name} />

// debounce - debounce updates (milliseconds)
<input type="text" bind:value|debounce={500}={search} />
```

### Element Binding

```typescript
// Bind element dimensions
const width = signal(0);
const height = signal(0);

<div bind:clientWidth={width} bind:clientHeight={height}>
  Size: {width()} x {height()}
</div>

// Bind scroll position
const scrollTop = signal(0);
const scrollLeft = signal(0);

<div bind:scrollTop={scrollTop} bind:scrollLeft={scrollLeft}>
  Scroll: {scrollTop()}, {scrollLeft()}
</div>
```

---

## Attributes

### Regular Attributes

```typescript
<div
  id="container"
  class="wrapper"
  data-id="123"
  aria-label="Container"
>
  Content
</div>
```

### Dynamic Attributes

```typescript
const id = signal('main');
const className = signal('container active');

<div
  id={id()}
  class={className()}
  data-count={count()}
>
  Content
</div>
```

### Conditional Classes

```typescript
// class: directive
<div
  class:active={isActive()}
  class:disabled={isDisabled()}
  class:loading={isLoading()}
>
  Content
</div>

// Equivalent to:
<div class={
  (isActive() ? 'active ' : '') +
  (isDisabled() ? 'disabled ' : '') +
  (isLoading() ? 'loading' : '')
}>
```

### Class Object

```typescript
const classes = computed(() => ({
  active: isActive(),
  disabled: isDisabled(),
  'btn-primary': variant() === 'primary',
  'btn-large': size() === 'large'
}));

<button class={classes()}>Button</button>
```

### Style Binding

```typescript
// Inline styles
<div style={`color: ${color()}; font-size: ${fontSize()}px;`}>
  Content
</div>

// style: directive
<div
  style:color={color()}
  style:font-size={`${fontSize()}px`}
  style:display={isVisible() ? 'block' : 'none'}
>
  Content
</div>

// Style object
const styles = computed(() => ({
  color: color(),
  fontSize: `${fontSize()}px`,
  fontWeight: isBold() ? 'bold' : 'normal'
}));

<div style={styles()}>Content</div>
```

### Boolean Attributes

```typescript
// Attributes that don't need value
<button disabled={isDisabled()}>Submit</button>
<input readonly={isReadonly()} />
<option selected={isSelected()}>Option</option>

// When false, attribute is removed
{isDisabled() === false}
<button>Submit</button> {/* No 'disabled' attribute */}
```

### Data Attributes

```typescript
<div
  data-id={user().id}
  data-role={user().role}
  data-active={isActive()}
>
  Content
</div>
```

### Spread Attributes

```typescript
const props = signal({
  id: 'main',
  class: 'container',
  'data-test': 'wrapper'
});

<div {...props()}>
  Content
</div>

// Merge with other attributes
<div class="base" {...props()}>
  {/* class will be "base container" */}
</div>
```

---

## Special Elements

### slot

Render children passed to component:

```typescript
const Card = defineComponent(() => {
  return () => (
    <div class="card">
      <slot /> {/* Children render here */}
    </div>
  );
});

// Usage
<Card>
  <p>This goes in the slot</p>
</Card>
```

**Named slots**:

```typescript
const Layout = defineComponent(() => {
  return () => (
    <div class="layout">
      <header><slot name="header" /></header>
      <main><slot /></main>
      <footer><slot name="footer" /></footer>
    </div>
  );
});

// Usage
<Layout>
  <h1 slot="header">Title</h1>
  <p>Main content</p>
  <span slot="footer">Footer</span>
</Layout>
```

### Fragment

Group elements without wrapper:

```typescript
import { Fragment } from 'aether';

<Fragment>
  <div>First</div>
  <div>Second</div>
</Fragment>

// Short syntax
<>
  <div>First</div>
  <div>Second</div>
</>
```

### Portal

Render outside component tree:

```typescript
import { Portal } from 'aether';

const Modal = defineComponent(() => {
  return () => (
    <Portal target={document.body}>
      <div class="modal-overlay">
        <div class="modal">Modal content</div>
      </div>
    </Portal>
  );
});
```

### Suspense

Handle async rendering:

```typescript
import { Suspense } from 'aether';

<Suspense fallback={<LoadingSpinner />}>
  <AsyncComponent />
</Suspense>
```

### ErrorBoundary

Catch errors:

```typescript
import { ErrorBoundary } from 'aether';

<ErrorBoundary fallback={(error) => <ErrorDisplay error={error} />}>
  <App />
</ErrorBoundary>
```

---

## Directives

### on: (Events)

```typescript
<button on:click={handleClick}>Click</button>
<input on:input={handleInput} on:blur={handleBlur} />
```

### bind: (Two-way binding)

```typescript
<input bind:value={text} />
<input type="checkbox" bind:checked={isChecked} />
<select bind:value={selected}>...</select>
```

### class: (Conditional classes)

```typescript
<div
  class:active={isActive()}
  class:disabled={isDisabled()}
/>
```

### style: (Inline styles)

```typescript
<div
  style:color={color()}
  style:font-size={`${size()}px`}
/>
```

### ref (Element reference)

```typescript
const divRef = signal<HTMLDivElement | null>(null);

<div ref={divRef}>Content</div>
```

### use: (Custom directives)

```typescript
import { tooltip } from './directives/tooltip';

<button use:tooltip="Click to submit">
  Submit
</button>
```

**Custom directive**:

```typescript
export const tooltip = (node: HTMLElement, text: string) => {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.textContent = text;

  const showTooltip = () => {
    document.body.appendChild(tooltip);
    // Position tooltip
  };

  const hideTooltip = () => {
    tooltip.remove();
  };

  node.addEventListener('mouseenter', showTooltip);
  node.addEventListener('mouseleave', hideTooltip);

  return {
    update(newText: string) {
      tooltip.textContent = newText;
    },
    destroy() {
      node.removeEventListener('mouseenter', showTooltip);
      node.removeEventListener('mouseleave', hideTooltip);
      tooltip.remove();
    }
  };
};
```

---

## Advanced Features

### Dynamic Components

```typescript
const CurrentView = signal<Component>(HomeView);

<div>
  <button on:click={() => CurrentView(HomeView)}>Home</button>
  <button on:click={() => CurrentView(AboutView)}>About</button>

  {/* Render dynamic component */}
  <Dynamic component={CurrentView()} {...props} />
</div>
```

### Dynamic Tag Names

```typescript
const Tag = signal<'h1' | 'h2' | 'h3'>('h1');

<Dynamic tag={Tag()}>
  Heading
</Dynamic>
```

### SVG

```typescript
<svg width="100" height="100">
  <circle
    cx="50"
    cy="50"
    r={radius()}
    fill={color()}
  />
</svg>
```

### Math (MathML)

```typescript
<math>
  <mrow>
    <msup>
      <mi>x</mi>
      <mn>2</mn>
    </msup>
  </mrow>
</math>
```

### Keyed Blocks

Force recreation of block when key changes:

```typescript
const userId = signal(1);

{#key userId()}
  <UserProfile userId={userId()} />
{/key}

// When userId changes, UserProfile is destroyed and recreated
```

### Await Blocks

Handle promises in templates:

```typescript
const userPromise = signal(fetchUser()

{#await userPromise()}
  <p>Loading...</p>
{:then user}
  <p>Hello {user.name}!</p>
{:catch error}
  <p>Error: {error.message}</p>
{/await}
```

---

## Compilation

### JSX Transform

Aether uses a custom JSX transform optimized for fine-grained reactivity:

**Source**:

```typescript
<div class="container">
  <h1>{title()}</h1>
  <p>Static text</p>
</div>
```

**Compiled** (simplified):

```typescript
const _tmpl$ = template('<div class="container"><h1></h1><p>Static text</p></div>');

function render() {
  const el = _tmpl$.cloneNode(true);
  const h1 = el.firstChild;

  createRenderEffect(() => {
    h1.textContent = title();
  });

  return el;
}
```

**Optimizations**:
1. **Template Cloning**: Static structure cloned, not created from scratch
2. **Fine-Grained Updates**: Only dynamic parts (like `{title()}`) become reactive
3. **No Virtual DOM**: Direct DOM manipulation
4. **Minimal Runtime**: Small bundle size

### Static vs Dynamic

**Static** (created once):
```typescript
<div class="container">
  <p>Static text</p>
</div>
```

**Dynamic** (reactive):
```typescript
<div class={className()}>
  <p>{text()}</p>
</div>
```

**Mixed** (optimized):
```typescript
<div class="container static-class" data-id="123">
  <h1>{title()}</h1>
  <p>Static paragraph</p>
  <span>{count()}</span>
</div>

// Only title() and count() are reactive
```

### Compiler Directives

```typescript
// @once - evaluate once (not reactive)
<div>{/* @once */ expensiveComputation()}</div>

// @memo - memoize expression
<div>{/* @memo */ items().map(transform)}</div>

// @ssr-only - only render on server
{/* @ssr-only */}
<div>Server only content</div>

// @client-only - only render on client
{/* @client-only */}
<div>Client only content</div>
```

---

## Comparison

### vs React JSX

| Feature | React | Aether |
|---------|-------|-------|
| **Syntax** | JSX | JSX + extensions |
| **Conditionals** | `{condition && <div/>}` | `{#if condition}` or `&&` |
| **Loops** | `.map()` | `{#each}` or `.map()` |
| **Events** | `onClick` | `on:click` |
| **Bindings** | Manual (controlled) | `bind:value` |
| **Class** | `className` | `class` or `class:` |
| **Fragments** | `<Fragment>` or `<>` | `<Fragment>` or `<>` |

### vs Vue Templates

| Feature | Vue | Aether |
|---------|-----|-------|
| **Syntax** | Template DSL | JSX |
| **Conditionals** | `v-if`/`v-else` | `{#if}/{:else}` |
| **Loops** | `v-for` | `{#each}` |
| **Events** | `@click` or `v-on:click` | `on:click` |
| **Bindings** | `v-model` | `bind:value` |
| **Class** | `:class` or `v-bind:class` | `class:` |

### vs Svelte

| Feature | Svelte | Aether |
|---------|--------|-------|
| **Syntax** | Template DSL | JSX |
| **Conditionals** | `{#if}` | `{#if}` |
| **Loops** | `{#each}` | `{#each}` |
| **Events** | `on:click` | `on:click` |
| **Bindings** | `bind:value` | `bind:value` |
| **Class** | `class:active` | `class:active` |

Aether is closest to Svelte in template syntax, but uses JSX instead of HTML templates.

---

## Best Practices

### 1. Keep Templates Simple

```typescript
// ❌ Bad - too much logic in template
<div>
  {users()
    .filter(u => u.active && u.role === 'admin')
    .map(u => u.name.toUpperCase())
    .join(', ')
  }
</div>

// ✅ Good - extract to computed
const activeAdminNames = computed(() => {
  return users()
    .filter(u => u.active && u.role === 'admin')
    .map(u => u.name.toUpperCase())
    .join(', ');
});

<div>{activeAdminNames()}</div>
```

### 2. Use Keys in Lists

```typescript
// ❌ Bad - no keys
{#each items() as item}
  <Item data={item} />
{/each}

// ✅ Good - with keys
{#each items() as item (item.id)}
  <Item data={item} />
{/each}
```

### 3. Avoid Inline Functions in Loops

```typescript
// ❌ Bad - creates new function on every render
{#each items() as item}
  <button on:click={() => handleClick(item.id)}>
    Delete
  </button>
{/each}

// ✅ Good - extract function
const handleItemClick = (id: number) => (e: Event) => {
  handleClick(id);
};

{#each items() as item}
  <button on:click={handleItemClick(item.id)}>
    Delete
  </button>
{/each}

// ✅ Even better - use event delegation
<div on:click={(e) => {
  const id = (e.target as HTMLElement).dataset.id;
  if (id) handleClick(Number(id));
}}>
  {#each items() as item}
    <button data-id={item.id}>Delete</button>
  {/each}
</div>
```

### 4. Use Fragments to Avoid Wrapper Divs

```typescript
// ❌ Bad - unnecessary wrapper
<div>
  <div>First</div>
  <div>Second</div>
</div>

// ✅ Good - fragment
<>
  <div>First</div>
  <div>Second</div>
</>
```

### 5. Bind Only When Needed

```typescript
// ❌ Bad - unnecessary bind for read-only
<input bind:value={search} readonly />

// ✅ Good - just set value
<input value={search()} readonly />

// ✅ Use bind for user input
<input bind:value={search} />
```

---

## Examples

### Complete Form

```typescript
const LoginForm = defineComponent(() => {
  const email = signal('');
  const password = signal('');
  const rememberMe = signal(false);
  const errors = signal<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};

    if (!email()) {
      errs.email = 'Email is required';
    } else if (!email().includes('@')) {
      errs.email = 'Invalid email';
    }

    if (!password()) {
      errs.password = 'Password is required';
    } else if (password().length < 8) {
      errs.password = 'Password must be 8+ characters';
    }

    errors.set(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();

    if (validate()) {
      console.log('Login:', {
        email: email(),
        password: password(),
        rememberMe: rememberMe()
      });
    }
  };

  return () => (
    <form on:submit|preventDefault={handleSubmit} class="login-form">
      <div class="field">
        <label for="email">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          class:error={!!errors().email}
          placeholder="you@example.com"
        />
        {#if errors().email}
          <span class="error-message">{errors().email}</span>
        {/if}
      </div>

      <div class="field">
        <label for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          class:error={!!errors().password}
          placeholder="••••••••"
        />
        {#if errors().password}
          <span class="error-message">{errors().password}</span>
        {/if}
      </div>

      <div class="field-checkbox">
        <input
          id="remember"
          type="checkbox"
          bind:checked={rememberMe}
        />
        <label for="remember">Remember me</label>
      </div>

      <button type="submit" class="btn-primary">
        Log In
      </button>
    </form>
  );
});
```

### Dynamic Table

```typescript
interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
  active: boolean;
}

const UserTable = defineComponent(() => {
  const users = signal<User[]>([...]);
  const sortBy = signal<keyof User>('name');
  const sortDesc = signal(false);
  const filter = signal('');

  const filteredUsers = computed(() => {
    let result = users();

    // Filter
    if (filter()) {
      const q = filter().toLowerCase();
      result = result.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      const aVal = a[sortBy()];
      const bVal = b[sortBy()];
      const order = sortDesc() ? -1 : 1;

      if (aVal < bVal) return -1 * order;
      if (aVal > bVal) return 1 * order;
      return 0;
    });

    return result;
  });

  const toggleSort = (column: keyof User) => {
    if (sortBy() === column) {
      sortDesc(!sortDesc());
    } else {
      sortBy(column);
      sortDesc(false);
    }
  };

  return () => (
    <div class="user-table">
      <div class="table-header">
        <input
          type="search"
          bind:value={filter}
          placeholder="Search users..."
          class="search-input"
        />
      </div>

      <table>
        <thead>
          <tr>
            {#each ['name', 'email', 'role', 'active'] as column}
              <th
                on:click={() => toggleSort(column as keyof User)}
                class:sorted={sortBy() === column}
                class:desc={sortBy() === column && sortDesc()}
              >
                {column}
                {#if sortBy() === column}
                  <span>{sortDesc() ? '▼' : '▲'}</span>
                {/if}
              </th>
            {/each}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredUsers() as user (user.id)}
            <tr class:inactive={!user.active}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>
                <span class={`badge badge-${user.role}`}>
                  {user.role}
                </span>
              </td>
              <td>
                <span class={`status ${user.active ? 'active' : 'inactive'}`}>
                  {user.active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td>
                <button on:click={() => editUser(user.id)}>Edit</button>
                <button on:click={() => deleteUser(user.id)}>Delete</button>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="5" class="no-results">
                No users found
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  );
});
```

---

**End of Template Syntax Specification**