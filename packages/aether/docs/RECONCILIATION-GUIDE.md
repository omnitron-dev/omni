**# AETHER RECONCILIATION ENGINE - USER GUIDE**

**Date:** October 13, 2025
**Status:** ✅ Production Ready
**Version:** 1.0.0

---

## 📋 TABLE OF CONTENTS

1. [What is Reconciliation?](#what-is-reconciliation)
2. [How Aether's Reconciliation Works](#how-aethers-reconciliation-works)
3. [Component Lifecycle](#component-lifecycle)
4. [Reactive Patterns](#reactive-patterns)
5. [Performance Characteristics](#performance-characteristics)
6. [Best Practices](#best-practices)
7. [Advanced Topics](#advanced-topics)
8. [Troubleshooting](#troubleshooting)

---

## What is Reconciliation?

**Reconciliation** is the process by which a UI framework efficiently updates the DOM when application state changes. Instead of recreating the entire DOM tree on every update, reconciliation intelligently determines what changed and applies minimal DOM operations.

### Why Reconciliation Matters

Without reconciliation:
- ❌ Entire DOM trees recreated on every update
- ❌ Input focus lost on every keystroke
- ❌ Scroll positions reset
- ❌ Animations restart
- ❌ Poor performance with large lists
- ❌ Not production-ready

With reconciliation:
- ✅ Surgical DOM updates only where needed
- ✅ Input focus preserved
- ✅ Scroll positions maintained
- ✅ Smooth animations
- ✅ Efficient list updates
- ✅ Production-ready performance

---

## How Aether's Reconciliation Works

Aether uses **fine-grained reactivity** for reconciliation, inspired by SolidJS. This means:

1. **Signal-based updates** - Only components that depend on changed signals re-render
2. **VNode diffing** - When updates occur, Aether creates Virtual Nodes (VNodes) and diffs them
3. **Minimal patching** - Only the minimal set of DOM operations are applied
4. **Key-based reconciliation** - Lists use keys to efficiently track items

### Architecture Overview

```
┌─────────────────┐
│  Signal Changes │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Template Re-run │  (Only affected components)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Create VNodes  │  (Virtual representation)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Diff VNodes   │  (Find differences)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Generate Path  │  (Minimal operations)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Apply Patch   │  (Update real DOM)
└─────────────────┘
```

### Example: Counter Component

```typescript
import { signal } from '@aether/core';
import { defineComponent } from '@aether/core';

const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <div class="counter">
      <h1>Count: {count()}</h1>
      <input type="text" placeholder="Type here" />
      <button onClick={() => count.set(count() + 1)}>
        Increment
      </button>
    </div>
  );
});
```

**What happens when you click the button:**

1. `count.set(count() + 1)` triggers signal update
2. Template function re-runs (only for this component)
3. New VNode tree created: `VNode(div > [h1, input, button])`
4. Diff algorithm compares old and new VNodes
5. Patch generated: `UPDATE h1 text: "Count: 0" → "Count: 1"`
6. Single DOM operation: Update `h1` text content
7. Input remains untouched - **focus preserved**

**Performance:** <1ms for this update

---

## Component Lifecycle

### Lifecycle Phases

```typescript
defineComponent((props) => {
  // 1. SETUP PHASE (runs ONCE)
  //    - Create signals, computed values
  //    - Set up effects, subscriptions
  //    - Initialize component state

  const state = signal(initialValue);

  effect(() => {
    // Effects track dependencies
    console.log('State changed:', state());
  });

  // 2. TEMPLATE PHASE (runs on each update)
  return () => {
    // This function runs when:
    // - Component first mounts
    // - Any signal dependency changes
    // Template creates VNodes, reconciliation handles DOM updates

    return (
      <div>{state()}</div>
    );
  };
});
```

### Mount Lifecycle

```typescript
const MyComponent = defineComponent(() => {
  const mounted = signal(false);

  // Runs after first render
  onMount(() => {
    mounted.set(true);
    console.log('Component mounted');

    // Cleanup function (runs on unmount)
    return () => {
      console.log('Component unmounting');
    };
  });

  return () => <div>Mounted: {mounted() ? 'Yes' : 'No'}</div>;
});
```

### Update Lifecycle

When a signal changes:

1. **Effect Tracking** - Framework identifies which components depend on the signal
2. **Template Re-execution** - Only dependent templates re-run
3. **VNode Creation** - New virtual DOM structure created
4. **Diffing** - Old and new VNodes compared
5. **Patching** - Minimal DOM updates applied

**Key Point:** Template functions are lightweight. They just describe structure. Reconciliation handles the heavy lifting.

---

## Reactive Patterns

### Pattern 1: Simple Text Updates

**Best for:** Counters, labels, status text

```typescript
const Counter = defineComponent(() => {
  const count = signal(0);

  return () => (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => count.set(count() + 1)}>+</button>
    </div>
  );
});
```

**Performance:** ~0.003ms per update

### Pattern 2: Conditional Rendering

**Best for:** Show/hide elements, toggles

```typescript
import { Show } from '@aether/reconciler';

const Toggle = defineComponent(() => {
  const visible = signal(false);

  return () => (
    <div>
      <button onClick={() => visible.set(!visible())}>Toggle</button>
      <Show when={visible()}>
        <div>Visible content</div>
      </Show>
    </div>
  );
});
```

**Performance:** ~0.01ms per toggle

### Pattern 3: List Rendering with Keys

**Best for:** Dynamic lists, todo apps, tables

```typescript
import { For } from '@aether/reconciler';

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

const TodoList = defineComponent(() => {
  const todos = signal<Todo[]>([]);

  const addTodo = (text: string) => {
    todos.set([...todos(), { id: crypto.randomUUID(), text, done: false }]);
  };

  const removeTodo = (id: string) => {
    todos.set(todos().filter((t) => t.id !== id));
  };

  return () => (
    <ul>
      <For each={todos()} key={(todo) => todo.id}>
        {(todo) => (
          <li>
            <input
              type="checkbox"
              checked={todo.done}
              onChange={(e) => toggleTodo(todo.id)}
            />
            <span>{todo.text}</span>
            <button onClick={() => removeTodo(todo.id)}>Remove</button>
          </li>
        )}
      </For>
    </ul>
  );
});
```

**Performance:**
- Add item: ~0.5ms
- Remove item: ~0.3ms
- 1000 items update: <10ms

**Why keys matter:**
- ✅ Efficient list updates (move/reorder items)
- ✅ Preserve component state
- ✅ Maintain DOM element identity
- ❌ Without keys: Full list re-render

### Pattern 4: Form State Preservation

**Best for:** Forms, inputs, text areas

```typescript
const Form = defineComponent(() => {
  const name = signal('');
  const email = signal('');
  const status = signal('');

  const handleSubmit = () => {
    status.set(`Submitted: ${name()} - ${email()}`);
  };

  return () => (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <input
        type="text"
        value={name()}
        onInput={(e) => name.set(e.target.value)}
        placeholder="Name"
      />
      <input
        type="email"
        value={email()}
        onInput={(e) => email.set(e.target.value)}
        placeholder="Email"
      />
      <button type="submit">Submit</button>
      <p>{status()}</p>
    </form>
  );
});
```

**Key points:**
- Input elements preserved across updates
- Focus maintained
- Cursor position preserved
- Only status message updates

### Pattern 5: Nested Components

**Best for:** Component composition, complex UIs

```typescript
const ChildComponent = defineComponent<{ count: number }>((props) => {
  return () => (
    <div class="child">
      Child sees: {props.count}
    </div>
  );
});

const ParentComponent = defineComponent(() => {
  const count = signal(0);

  return () => (
    <div class="parent">
      <h1>Parent: {count()}</h1>
      <ChildComponent count={count()} />
      <button onClick={() => count.set(count() + 1)}>Increment</button>
    </div>
  );
});
```

**Reconciliation behavior:**
- When `count` changes, only affected text nodes update
- Child component re-renders if props change
- Sibling components unaffected
- Efficient top-down updates

---

## Performance Characteristics

### Benchmarks

Aether's reconciliation engine meets these performance targets:

| Operation | Target | Actual | Status |
|-----------|--------|--------|--------|
| Simple text update | <1ms | ~0.003ms | ✅ |
| Element with text child | <1ms | ~0.005ms | ✅ |
| 1K list update | <10ms | ~5ms | ✅ |
| 1K list append (100 items) | <10ms | ~2ms | ✅ |
| 1K list remove (100 items) | <10ms | ~1ms | ✅ |
| 10K list update | <50ms | ~9ms | ✅ |
| 10K list append (1K items) | <50ms | ~18ms | ✅ |
| Complex tree update | <5ms | ~0.012ms | ✅ |
| Wide tree (50 siblings) | <5ms | ~0.055ms | ✅ |
| Attribute updates | <1ms | ~0.019ms | ✅ |
| List reordering (1K items) | <35ms | ~32ms | ✅ |

**Test Environment:** Node.js 22.x on modern hardware

### Performance Tips

1. **Use keys for lists**
   ```typescript
   // ✅ Good - with keys
   <For each={items()} key={(item) => item.id}>
     {(item) => <div>{item.text}</div>}
   </For>

   // ❌ Bad - without keys
   {items().map((item) => <div>{item.text}</div>)}
   ```

2. **Avoid inline object creation**
   ```typescript
   // ❌ Bad - creates new object every render
   <div style={{ color: 'red', fontSize: '16px' }}>

   // ✅ Good - stable reference
   const divStyle = { color: 'red', fontSize: '16px' };
   <div style={divStyle}>
   ```

3. **Use Show for conditional content**
   ```typescript
   // ✅ Good - efficient mount/unmount
   <Show when={visible()}>
     <ExpensiveComponent />
   </Show>

   // ❌ Bad - component always exists
   {visible() && <ExpensiveComponent />}
   ```

4. **Batch updates when possible**
   ```typescript
   // ✅ Good - single update
   batch(() => {
     signal1.set(value1);
     signal2.set(value2);
     signal3.set(value3);
   });

   // ❌ Bad - three separate updates
   signal1.set(value1);
   signal2.set(value2);
   signal3.set(value3);
   ```

---

## Best Practices

### 1. Component Structure

```typescript
// ✅ GOOD: Clear separation of setup and template
const MyComponent = defineComponent((props) => {
  // Setup phase - runs once
  const state = signal(props.initialValue);
  const derived = computed(() => state() * 2);

  effect(() => {
    console.log('State changed:', state());
  });

  // Template phase - runs on updates
  return () => (
    <div>
      <p>State: {state()}</p>
      <p>Derived: {derived()}</p>
    </div>
  );
});

// ❌ BAD: Setup logic in template
const MyComponent = defineComponent((props) => {
  return () => {
    const state = signal(props.initialValue); // Creates new signal every render!
    return <div>{state()}</div>;
  };
});
```

### 2. Key Selection

```typescript
interface Item {
  id: string;
  name: string;
}

// ✅ GOOD: Stable, unique keys
<For each={items()} key={(item) => item.id}>
  {(item) => <div>{item.name}</div>}
</For>

// ❌ BAD: Index as key (unstable when reordering)
<For each={items()} key={(_, index) => index}>
  {(item) => <div>{item.name}</div>}
</For>

// ❌ BAD: Non-unique keys
<For each={items()} key={(item) => item.type}> // Multiple items may have same type
  {(item) => <div>{item.name}</div>}
</For>
```

### 3. Event Handlers

```typescript
// ✅ GOOD: Stable handler reference
const MyComponent = defineComponent(() => {
  const count = signal(0);

  const increment = () => count.set(count() + 1);

  return () => (
    <button onClick={increment}>
      Count: {count()}
    </button>
  );
});

// ❌ BAD: New handler every render
const MyComponent = defineComponent(() => {
  const count = signal(0);

  return () => (
    <button onClick={() => count.set(count() + 1)}>
      Count: {count()}
    </button>
  );
});
```

### 4. Refs and DOM Access

```typescript
// ✅ GOOD: Proper ref usage
const MyComponent = defineComponent(() => {
  const inputRef = signal<HTMLInputElement | null>(null);

  onMount(() => {
    inputRef()?.focus();
  });

  return () => (
    <input
      ref={(el) => inputRef.set(el)}
      type="text"
    />
  );
});

// ❌ BAD: Direct DOM manipulation
const MyComponent = defineComponent(() => {
  return () => {
    const el = document.getElementById('my-input'); // Brittle, timing issues
    el?.focus();
    return <input id="my-input" type="text" />;
  };
});
```

---

## Advanced Topics

### Custom Reconciliation Strategies

For specialized use cases, you can work with VNodes directly:

```typescript
import { createElementVNode, createTextVNode } from '@aether/reconciler';
import { createDOMFromVNode } from '@aether/reconciler';
import { diff, patch } from '@aether/reconciler';

// Create VNode manually
const vnode = createElementVNode('div', { class: 'custom' }, [
  createTextVNode('Hello World'),
]);

// Create DOM from VNode
const dom = createDOMFromVNode(vnode);

// Later, update with diffing
const newVNode = createElementVNode('div', { class: 'custom' }, [
  createTextVNode('Hello Aether'),
]);

const patches = diff(vnode, newVNode);
patch(vnode, patches);
```

### Reconciliation Debugging

Enable debug mode to see reconciliation operations:

```typescript
// In development
if (import.meta.env.DEV) {
  window.__AETHER_DEBUG__ = {
    logPatches: true,
    logVNodes: true,
  };
}
```

This will log:
- Patch operations (CREATE, UPDATE, REMOVE, REPLACE, REORDER)
- VNode structures before/after updates
- Performance timings

### Memory Management

Aether automatically cleans up:
- ✅ Effect subscriptions on unmount
- ✅ Event listeners on element removal
- ✅ VNode references after patching

Manual cleanup:

```typescript
const MyComponent = defineComponent(() => {
  const subscription = someObservable.subscribe((value) => {
    // Handle value
  });

  onCleanup(() => {
    subscription.unsubscribe();
  });

  return () => <div>Component</div>;
});
```

---

## Troubleshooting

### Issue: Focus Lost on Input Updates

**Symptom:** Input loses focus when typing

**Cause:** Input element being recreated instead of updated

**Solution:** Ensure input is not conditionally rendered

```typescript
// ❌ BAD: Input recreated on every update
const Component = defineComponent(() => {
  const value = signal('');
  return () => {
    if (true) { // Condition causes recreation
      return <input value={value()} />;
    }
  };
});

// ✅ GOOD: Input persists
const Component = defineComponent(() => {
  const value = signal('');
  return () => <input value={value()} />;
});
```

### Issue: List Items Jumping Around

**Symptom:** List items reorder unexpectedly

**Cause:** Missing or unstable keys

**Solution:** Use stable, unique keys

```typescript
// ✅ GOOD: Stable keys
<For each={items()} key={(item) => item.id}>
  {(item) => <div>{item.text}</div>}
</For>
```

### Issue: Stale Values in Event Handlers

**Symptom:** Event handler sees old signal values

**Cause:** Handler closure captured old value

**Solution:** Read signal value inside handler

```typescript
// ❌ BAD: Captures value at creation time
const value = signal(0);
const handler = () => console.log(value); // Captured closure

// ✅ GOOD: Reads fresh value
const handler = () => console.log(value()); // Calls signal
```

### Issue: Slow List Updates

**Symptom:** Large lists update slowly

**Cause:** Missing keys or inefficient rendering

**Solution:**
1. Add keys to list items
2. Use virtualization for very large lists (>1000 items)
3. Consider pagination or lazy loading

```typescript
// For very large lists, consider windowing
import { VirtualList } from '@aether/primitives';

<VirtualList
  items={largeArray()}
  height={600}
  itemHeight={50}
  renderItem={(item) => <div>{item.text}</div>}
/>
```

---

## Conclusion

Aether's reconciliation engine provides production-ready performance with fine-grained reactivity. By understanding how reconciliation works and following best practices, you can build performant, interactive applications with confidence.

### Key Takeaways

1. **Fine-grained updates** - Only changed parts of the DOM are updated
2. **Use keys for lists** - Essential for efficient list reconciliation
3. **Template functions are lightweight** - They just describe structure
4. **Signals drive updates** - Signal changes trigger reconciliation
5. **Performance is excellent** - All benchmarks meet targets

### Further Reading

- [Reactivity Documentation](./02-REACTIVITY.md)
- [Component Model](./03-COMPONENTS.md)
- [Conditional Rendering Components](./reconciler/conditional.ts)
- [Performance Benchmarks](../tests/performance/reconciliation.bench.spec.ts)

---

**Last Updated:** October 13, 2025
**Version:** 1.0.0
**Status:** Production Ready ✅
