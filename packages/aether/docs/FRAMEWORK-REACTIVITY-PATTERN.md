# Aether Framework Reactivity Pattern

**Last Updated:** October 11, 2025 (Session 10 - Architectural Improvements Applied)

## Critical Understanding: Components Don't Re-Render

**This is the most important concept to understand about Aether's reactivity model.**

> **✅ UPDATE:** All control flow components (Show, For) have been fixed to properly handle dynamic conditions using the effect pattern described in this document. See [Control Flow Components - Fixed!](#control-flow-components---fixed) section for details.

### The Core Limitation

In Aether, **components do NOT re-render** when signals change. The render function runs **exactly once** when the component is created.

```typescript
// Component lifecycle:
const MyComponent = defineComponent((props) => {
  // 1. Setup function runs ONCE
  const count = signal(0);

  return () => {
    // 2. Render function runs ONCE
    // 3. NEVER runs again, even if count() changes!
    return <div>{count()}</div>;
  };
});
```

### Why Conditional Rendering Doesn't Work

```typescript
// ❌ WRONG - This doesn't work!
export const ConditionalComponent = defineComponent<{ show: () => boolean }>((props) => {
  return () => {
    if (!props.show()) {
      return null;  // Render returns null once
    }
    return <div>Content</div>;  // Never reached if initially false!
  };
});

// When props.show() changes from false to true:
// - The render function does NOT run again
// - The component stays as null forever
// - The content never appears
```

### The Correct Pattern: Always Render + Effect

```typescript
// ✅ CORRECT - This works!
export const ConditionalComponent = defineComponent<{ show: () => boolean }>((props) => {
  return () => {
    // Always create the element
    const div = <div>Content</div> as HTMLElement;

    // Use effect() to update visibility reactively
    effect(() => {
      div.style.display = props.show() ? '' : 'none';
    });

    return div;
  };
});
```

## Key Principles

### 1. Always Create DOM Elements

Never use conditional returns in the render function:

```typescript
// ❌ WRONG
return () => {
  if (condition()) return null;
  return <div>...</div>;
};

// ✅ CORRECT
return () => {
  const div = <div>...</div> as HTMLElement;
  effect(() => {
    div.style.display = condition() ? '' : 'none';
  });
  return div;
};
```

### 2. Use effect() for Reactive Updates

All reactive behavior must use `effect()` blocks:

```typescript
// ✅ CORRECT - Reactive attribute updates
const button = <button>Click me</button> as HTMLElement;

effect(() => {
  button.setAttribute('aria-pressed', String(isPressed()));
  button.setAttribute('data-state', isPressed() ? 'pressed' : 'idle');
  button.disabled = isDisabled();
});

return button;
```

### 3. Visibility Control Pattern

Three approaches for conditional visibility:

#### A. display: none (Most Common)

```typescript
const element = <div>Content</div> as HTMLElement;

effect(() => {
  element.style.display = isVisible() ? '' : 'none';
});
```

#### B. CSS Classes

```typescript
const element = <div>Content</div> as HTMLElement;

effect(() => {
  if (isVisible()) {
    element.classList.add('visible');
    element.classList.remove('hidden');
  } else {
    element.classList.add('hidden');
    element.classList.remove('visible');
  }
});
```

#### C. aria-hidden (Accessibility)

```typescript
const element = <div>Content</div> as HTMLElement;

effect(() => {
  element.setAttribute('aria-hidden', String(!isVisible()));
  element.style.display = isVisible() ? '' : 'none';
});
```

## Real-World Examples

### TabsContent Pattern

```typescript
export const TabsContent = defineComponent<TabsContentProps>((props) => {
  return () => {
    const ctx = useContext(TabsContext);
    const { value, children } = props;

    // Always create the panel
    const panel = jsx('div', {
      role: 'tabpanel',
      children,
    }) as HTMLElement;

    // Use effect to toggle visibility
    effect(() => {
      const isSelected = ctx.value() === value;
      panel.setAttribute('data-state', isSelected ? 'active' : 'inactive');
      panel.style.display = isSelected ? '' : 'none';
    });

    return panel;
  };
});
```

### AccordionContent Pattern

```typescript
export const AccordionContent = defineComponent<AccordionContentProps>((props) => {
  return () => {
    const ctx = useContext(AccordionItemContext);
    const { children } = props;

    // Always create the region
    const region = jsx('div', {
      role: 'region',
      children,
    }) as HTMLElement;

    // Use effect to toggle visibility
    effect(() => {
      const isOpen = ctx.isOpen();
      region.setAttribute('data-state', isOpen ? 'open' : 'closed');
      region.style.display = isOpen ? '' : 'none';
    });

    return region;
  };
});
```

### Control Flow Components - Fixed!

All control flow components now properly support dynamic conditions:

#### Show Component (FIXED)

```typescript
// ✅ NOW WORKS with dynamic conditions!
export const Show = defineComponent<ShowProps>((props) => {
  return () => {
    // Always create containers for both children and fallback
    const contentWrapper = jsx('div', {
      'data-show-content': '',
      style: { display: 'contents' },
    });

    const fallbackWrapper = jsx('div', {
      'data-show-fallback': '',
      style: { display: 'contents' },
    });

    // Set up reactive effect to toggle visibility
    effect(() => {
      const condition = evaluateCondition(props.when);

      if (condition) {
        contentWrapper.style.display = 'contents';
        fallbackWrapper.style.display = 'none';
      } else {
        contentWrapper.style.display = 'none';
        fallbackWrapper.style.display = props.fallback ? 'contents' : 'none';
      }
    });

    return container;
  };
});

// Usage - now properly reactive!
const isVisible = signal(false);
<Show when={() => isVisible()} fallback={<div>Loading...</div>}>
  <div>Content appears when signal changes!</div>
</Show>
```

#### For Component (FIXED)

```typescript
// ✅ NOW WORKS with dynamic lists!
export const For = defineComponent<ForProps>((props) => {
  return () => {
    const listContainer = jsx('div', {
      'data-for-list': '',
      style: { display: 'contents' },
    });

    // Map to track rendered items
    const renderedItems = new Map();

    // Set up reactive effect to update list
    effect(() => {
      const items = getItems(props.each);

      // Add/remove/update items as needed
      items.forEach((item, index) => {
        let node = renderedItems.get(index);
        if (!node) {
          // Render new item
          const rendered = props.children(item, index);
          // ... add to DOM
        } else {
          // Update existing item
          // ... re-render in place
        }
      });
    });

    return container;
  };
});

// Usage - properly reactive!
const todos = signal([]);
<For each={() => todos()} fallback={<div>No items</div>}>
  {(item, index) => <div>{index}: {item.text}</div>}
</For>
```

**Both components now:**
- ✅ Support dynamic signal updates
- ✅ Always render containers (use `display: contents` for layout neutrality)
- ✅ Use `effect()` for reactive updates
- ✅ Handle nested usage correctly
- ✅ Have comprehensive test coverage

## Testing Implications

When testing components, remember:

```typescript
// Test must account for all elements being in DOM
const contents = container.querySelectorAll('[role="tabpanel"]');

// ❌ WRONG - Expects only visible content
expect(contents.length).toBe(1);

// ✅ CORRECT - All content is rendered
expect(contents.length).toBe(2);

// Find visible content
const visibleContent = Array.from(contents).find(
  (el) => (el as HTMLElement).style.display !== 'none'
);
expect(visibleContent?.textContent).toBe('Expected Content');
```

## Migration Guide

If you have components using conditional rendering:

### Step 1: Identify the Pattern

Look for:
- `return null` in render functions
- `if (condition) return ...`
- Ternary operators returning different elements

### Step 2: Refactor to Always Render

```typescript
// Before
return () => {
  if (!isVisible()) return null;
  return <div>Content</div>;
};

// After
return () => {
  const div = <div>Content</div> as HTMLElement;
  effect(() => {
    div.style.display = isVisible() ? '' : 'none';
  });
  return div;
};
```

### Step 3: Update Tests

```typescript
// Before
const element = container.querySelector('.content');
expect(element).toBeTruthy();

// After
const element = container.querySelector('.content');
expect(element).toBeTruthy();
expect(element.style.display).not.toBe('none');
```

## Why This Design?

This reactivity model is **intentional** and provides:

1. **Performance**: No virtual DOM diffing or reconciliation
2. **Simplicity**: Clear mental model - one render, effects for updates
3. **Predictability**: DOM structure is stable, only attributes/styles change
4. **Fine-grained reactivity**: Effects track exactly what signals they use

It's similar to SolidJS's approach but even more explicit.

## Summary

**Golden Rule**: In Aether, render functions run once. All dynamic behavior must use `effect()` blocks.

- ❌ Don't use conditional returns
- ✅ Always create elements
- ✅ Use `effect()` for reactive updates
- ✅ Toggle visibility with `display: none` or CSS classes
- ✅ Update tests to account for all elements in DOM
