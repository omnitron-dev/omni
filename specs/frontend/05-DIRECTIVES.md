# 05. Directives System

> **Status**: Complete Specification
> **Last Updated**: 2025-10-06
> **Part of**: Nexus Frontend Framework Specification

---

## Table of Contents

1. [Overview](#overview)
2. [Philosophy](#philosophy)
3. [Built-in Directives](#built-in-directives)
   - [on: (Events)](#on-events)
   - [bind: (Two-way Binding)](#bind-two-way-binding)
   - [class: (Conditional Classes)](#class-conditional-classes)
   - [style: (Inline Styles)](#style-inline-styles)
   - [ref (Element Reference)](#ref-element-reference)
   - [use: (Custom Directives)](#use-custom-directives)
   - [show: (Visibility)](#show-visibility)
   - [transition: (Animations)](#transition-animations)
4. [Custom Directives](#custom-directives)
5. [Directive Composition](#directive-composition)
6. [TypeScript Support](#typescript-support)
7. [Best Practices](#best-practices)
8. [Examples](#examples)

---

## Overview

**Directives** are special attributes that modify the behavior of DOM elements. They provide a declarative way to attach behavior to elements without writing imperative code.

### What are Directives?

Directives are prefixed with a colon (`:`) and provide special functionality:

```typescript
<button
  on:click={handleClick}        {/* Event handler */}
  bind:value={inputValue}        {/* Two-way binding */}
  class:active={isActive()}      {/* Conditional class */}
  style:color={color()}          {/* Inline style */}
  ref={buttonRef}                {/* Element reference */}
  use:tooltip="Click me"         {/* Custom directive */}
>
  Click Me
</button>
```

### Directives vs Attributes

**Regular Attributes** (static or dynamic values):
```typescript
<div
  id="main"
  class="container"
  data-id={userId()}
>
```

**Directives** (add behavior):
```typescript
<div
  on:click={handleClick}         {/* Behavior: event handler */}
  bind:scrollTop={scroll}        {/* Behavior: two-way binding */}
  use:clickOutside={handleOut}   {/* Behavior: custom logic */}
>
```

---

## Philosophy

### Declarative over Imperative

**Imperative** (manual DOM manipulation):
```typescript
const Component = defineComponent(() => {
  const buttonRef = signal<HTMLButtonElement | null>(null);

  onMount(() => {
    const button = buttonRef();
    if (!button) return;

    // Manual event listener
    const handleClick = () => console.log('Clicked');
    button.addEventListener('click', handleClick);

    // Manual cleanup
    return () => button.removeEventListener('click', handleClick);
  });

  return () => <button ref={buttonRef}>Click</button>;
});
```

**Declarative** (directive):
```typescript
const Component = defineComponent(() => {
  const handleClick = () => console.log('Clicked');

  return () => (
    <button on:click={handleClick}>
      Click
    </button>
  );
});
```

### Reusability

Directives encapsulate reusable behavior:

```typescript
// Tooltip directive - use anywhere
<button use:tooltip="Save changes">Save</button>
<span use:tooltip="Username">👤</span>
<div use:tooltip="Help text">?</div>
```

### Separation of Concerns

Directives separate **what** (template) from **how** (directive logic):

```typescript
// Template: WHAT behavior
<div use:clickOutside={handleClickOutside} use:draggable>
  Content
</div>

// Directives: HOW to implement behavior
// (defined separately, reusable across components)
```

---

## Built-in Directives

### on: (Events)

Attach event listeners to elements.

#### Basic Usage

```typescript
<button on:click={handleClick}>Click</button>

<input
  on:input={handleInput}
  on:focus={handleFocus}
  on:blur={handleBlur}
/>

<form on:submit={handleSubmit}>
  <button type="submit">Submit</button>
</form>
```

#### Event Modifiers

```typescript
// preventDefault
<form on:submit|preventDefault={handleSubmit}>
  <button>Submit</button>
</form>

// stopPropagation
<div on:click={() => console.log('parent')}>
  <button on:click|stopPropagation={() => console.log('child')}>
    Click (doesn't bubble)
  </button>
</div>

// capture (use capture phase)
<div on:click|capture={handleClick}>
  <button>Click</button>
</div>

// once (runs only once)
<button on:click|once={handleFirstClick}>
  Click Once
</button>

// passive (improves scroll performance)
<div on:scroll|passive={handleScroll}>
  Scrollable content
</div>

// self (only if event.target === currentTarget)
<div on:click|self={handleDivClick}>
  <button>Clicking button won't trigger div handler</button>
</div>

// Multiple modifiers
<a href="/page" on:click|preventDefault|stopPropagation={handleClick}>
  Link
</a>
```

#### Custom Events

```typescript
// Child component
const Child = defineComponent<{ onCustom: (data: string) => void }>((props) => {
  const emit = () => props.onCustom('Hello');

  return () => <button on:click={emit}>Emit</button>;
});

// Parent
const Parent = defineComponent(() => {
  return () => (
    <Child on:custom={(data) => console.log(data)} />
  );
});
```

---

### bind: (Two-way Binding)

Create two-way data binding for form elements.

#### Input Binding

```typescript
const text = signal('');

// Text input
<input type="text" bind:value={text} />

// Number input
const age = signal(0);
<input type="number" bind:value={age} />

// Range input
const volume = signal(50);
<input type="range" bind:value={volume} min="0" max="100" />
```

#### Checkbox Binding

```typescript
// Single checkbox
const agreed = signal(false);
<input type="checkbox" bind:checked={agreed} />

// Multiple checkboxes (group)
const selected = signal<string[]>([]);

<input type="checkbox" bind:group={selected} value="red" />
<input type="checkbox" bind:group={selected} value="green" />
<input type="checkbox" bind:group={selected} value="blue" />

// selected() = ['red', 'blue'] (example)
```

#### Radio Binding

```typescript
const picked = signal('option1');

<input type="radio" bind:group={picked} value="option1" />
<input type="radio" bind:group={picked} value="option2" />
<input type="radio" bind:group={picked} value="option3" />

// picked() = 'option2' (example)
```

#### Select Binding

```typescript
// Single select
const selected = signal('apple');

<select bind:value={selected}>
  <option value="apple">Apple</option>
  <option value="banana">Banana</option>
  <option value="orange">Orange</option>
</select>

// Multiple select
const selectedMultiple = signal<string[]>([]);

<select multiple bind:value={selectedMultiple}>
  <option value="red">Red</option>
  <option value="green">Green</option>
  <option value="blue">Blue</option>
</select>
```

#### Textarea Binding

```typescript
const message = signal('');

<textarea bind:value={message}></textarea>
```

#### Contenteditable Binding

```typescript
const html = signal('<strong>Bold</strong>');
const text = signal('Plain text');

// Bind HTML content
<div contenteditable="true" bind:innerHTML={html}></div>

// Bind text content
<div contenteditable="true" bind:textContent={text}></div>
```

#### Element Property Binding

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

<div
  bind:scrollTop={scrollTop}
  bind:scrollLeft={scrollLeft}
  style="overflow: auto; height: 200px;"
>
  Scrollable content
</div>
```

#### Binding Modifiers

```typescript
// number - convert to number
<input type="number" bind:value|number={age} />

// trim - trim whitespace
<input type="text" bind:value|trim={name} />

// debounce - debounce updates (ms)
<input type="text" bind:value|debounce={300}={search} />

// lazy - update on blur instead of input
<input type="text" bind:value|lazy={email} />
```

---

### class: (Conditional Classes)

Conditionally add CSS classes.

#### Basic Usage

```typescript
const isActive = signal(true);
const isDisabled = signal(false);

<div
  class:active={isActive()}
  class:disabled={isDisabled()}
>
  Content
</div>

// Result: <div class="active">Content</div>
```

#### Multiple Classes

```typescript
<button
  class:btn-primary={variant() === 'primary'}
  class:btn-secondary={variant() === 'secondary'}
  class:btn-large={size() === 'large'}
  class:btn-small={size() === 'small'}
  class:disabled={isDisabled()}
>
  Button
</button>
```

#### Shorthand Syntax

```typescript
// When class name matches variable name
const active = signal(true);
const disabled = signal(false);

<div class:active class:disabled>
  Content
</div>

// Equivalent to:
<div class:active={active()} class:disabled={disabled()}>
```

#### Static + Dynamic Classes

```typescript
<div class="base-class static-class" class:dynamic={isDynamic()}>
  Content
</div>

// Result: <div class="base-class static-class dynamic">
```

---

### style: (Inline Styles)

Apply inline CSS styles.

#### Basic Usage

```typescript
const color = signal('red');
const fontSize = signal(16);

<div
  style:color={color()}
  style:font-size={`${fontSize()}px`}
>
  Styled text
</div>
```

#### CSS Variables

```typescript
const primaryColor = signal('#0ea5e9');

<div style:--primary-color={primaryColor()}>
  <button style="background: var(--primary-color)">
    Button
  </button>
</div>
```

#### Conditional Styles

```typescript
<div
  style:display={isVisible() ? 'block' : 'none'}
  style:opacity={isVisible() ? '1' : '0.5'}
  style:background-color={isActive() ? 'blue' : 'gray'}
>
  Content
</div>
```

#### Important Modifier

```typescript
<div style:color|important={color()}>
  This color overrides all other rules
</div>

// Result: style="color: red !important;"
```

---

### ref (Element Reference)

Get reference to DOM element.

#### Basic Usage

```typescript
const inputRef = signal<HTMLInputElement | null>(null);

onMount(() => {
  inputRef()?.focus();
});

<input ref={inputRef} type="text" />
```

#### Callback Ref

```typescript
const handleRef = (el: HTMLDivElement | null) => {
  if (el) {
    console.log('Element mounted:', el);
    // Access element
  } else {
    console.log('Element unmounted');
  }
};

<div ref={handleRef}>Content</div>
```

#### Multiple Refs

```typescript
const refs = {
  header: signal<HTMLElement | null>(null),
  main: signal<HTMLElement | null>(null),
  footer: signal<HTMLElement | null>(null)
};

<div>
  <header ref={refs.header}>Header</header>
  <main ref={refs.main}>Main</main>
  <footer ref={refs.footer}>Footer</footer>
</div>
```

---

### use: (Custom Directives)

Apply custom directive logic to elements.

#### Basic Usage

```typescript
import { tooltip } from './directives/tooltip';

<button use:tooltip="Click to submit">
  Submit
</button>
```

#### With Parameters

```typescript
import { clickOutside } from './directives/clickOutside';

<div use:clickOutside={handleClickOutside}>
  Modal content
</div>
```

#### Multiple Directives

```typescript
<div
  use:draggable
  use:resizable
  use:clickOutside={handleClose}
  use:tooltip="Draggable box"
>
  Content
</div>
```

---

### show: (Visibility)

Toggle element visibility without removing from DOM.

#### Basic Usage

```typescript
const isVisible = signal(true);

// Element stays in DOM, visibility toggled
<div show:visible={isVisible()}>
  Content
</div>

// Equivalent to:
<div style:display={isVisible() ? '' : 'none'}>
  Content
</div>
```

#### vs Conditional Rendering

```typescript
// Conditional rendering - removed from DOM
{#if isVisible()}
  <ExpensiveComponent />
{/if}

// show: directive - stays in DOM
<ExpensiveComponent show:visible={isVisible()} />
```

**Use `show:` when**:
- Component is expensive to mount/unmount
- You need to preserve scroll position
- Frequent toggling (animation performance)

---

### transition: (Animations)

Add enter/leave animations.

#### Basic Usage

```typescript
import { fade } from 'nexus/transitions';

const isVisible = signal(true);

{#if isVisible()}
  <div transition:fade>
    Fades in and out
  </div>
{/if}
```

#### With Parameters

```typescript
import { fly } from 'nexus/transitions';

{#if isVisible()}
  <div transition:fly={{ y: 200, duration: 300 }}>
    Flies in from bottom
  </div>
{/if}
```

#### Separate In/Out Transitions

```typescript
import { fade, fly } from 'nexus/transitions';

{#if isVisible()}
  <div in:fly={{ y: -100 }} out:fade>
    Flies in from top, fades out
  </div>
{/if}
```

#### Built-in Transitions

```typescript
import {
  fade,
  fly,
  slide,
  scale,
  blur,
  draw // For SVG paths
} from 'nexus/transitions';

// Fade
<div transition:fade={{ duration: 300 }}>...</div>

// Fly
<div transition:fly={{ x: -100, y: 0, duration: 300 }}>...</div>

// Slide
<div transition:slide={{ duration: 300 }}>...</div>

// Scale
<div transition:scale={{ start: 0, opacity: 0.5, duration: 300 }}>...</div>

// Blur
<div transition:blur={{ amount: 10, duration: 300 }}>...</div>

// Draw (SVG)
<svg>
  <path transition:draw={{ duration: 1000 }} d="..." />
</svg>
```

---

## Custom Directives

### Creating Directives

A directive is a function that returns an object with lifecycle methods:

```typescript
import type { DirectiveFunction } from 'nexus';

export const myDirective: DirectiveFunction<Params> = (
  node: HTMLElement,
  params: Params
) => {
  // Setup logic

  return {
    // Optional: called when params change
    update(newParams: Params) {
      // Update logic
    },

    // Optional: cleanup
    destroy() {
      // Cleanup logic
    }
  };
};
```

### Tooltip Directive

```typescript
// directives/tooltip.ts
import type { DirectiveFunction } from 'nexus';

interface TooltipParams {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const tooltip: DirectiveFunction<TooltipParams> = (node, params) => {
  let tooltipEl: HTMLDivElement;

  const createTooltip = () => {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tooltip';
    tooltipEl.textContent = params.text;
    tooltipEl.setAttribute('data-position', params.position || 'top');
  };

  const showTooltip = () => {
    document.body.appendChild(tooltipEl);
    positionTooltip();
  };

  const hideTooltip = () => {
    tooltipEl.remove();
  };

  const positionTooltip = () => {
    const rect = node.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    switch (params.position || 'top') {
      case 'top':
        tooltipEl.style.top = `${rect.top - tooltipRect.height - 8}px`;
        tooltipEl.style.left = `${rect.left + (rect.width - tooltipRect.width) / 2}px`;
        break;
      case 'bottom':
        tooltipEl.style.top = `${rect.bottom + 8}px`;
        tooltipEl.style.left = `${rect.left + (rect.width - tooltipRect.width) / 2}px`;
        break;
      // ... other positions
    }
  };

  createTooltip();

  node.addEventListener('mouseenter', showTooltip);
  node.addEventListener('mouseleave', hideTooltip);

  return {
    update(newParams) {
      tooltipEl.textContent = newParams.text;
      tooltipEl.setAttribute('data-position', newParams.position || 'top');
    },

    destroy() {
      node.removeEventListener('mouseenter', showTooltip);
      node.removeEventListener('mouseleave', hideTooltip);
      tooltipEl.remove();
    }
  };
};

// Usage
<button use:tooltip={{ text: "Save changes", position: "top" }}>
  Save
</button>
```

### Click Outside Directive

```typescript
// directives/clickOutside.ts
export const clickOutside: DirectiveFunction<(event: MouseEvent) => void> = (
  node,
  callback
) => {
  const handleClick = (event: MouseEvent) => {
    if (!node.contains(event.target as Node)) {
      callback(event);
    }
  };

  document.addEventListener('click', handleClick, true);

  return {
    destroy() {
      document.removeEventListener('click', handleClick, true);
    }
  };
};

// Usage
const Modal = defineComponent(() => {
  const isOpen = signal(true);

  const handleClickOutside = () => {
    isOpen.set(false);
  };

  return () => (
    {#if isOpen()}
      <div class="modal-overlay">
        <div class="modal" use:clickOutside={handleClickOutside}>
          <h2>Modal</h2>
          <p>Click outside to close</p>
        </div>
      </div>
    {/if}
  );
});
```

### Autofocus Directive

```typescript
// directives/autofocus.ts
export const autofocus: DirectiveFunction<boolean> = (node, enabled = true) => {
  if (enabled) {
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      node.focus();
    });
  }

  return {
    update(newEnabled) {
      if (newEnabled) {
        node.focus();
      }
    }
  };
};

// Usage
<input use:autofocus={true} />
```

### Long Press Directive

```typescript
// directives/longPress.ts
interface LongPressParams {
  duration?: number;
  onLongPress: () => void;
}

export const longPress: DirectiveFunction<LongPressParams> = (node, params) => {
  let timer: number;

  const handleMouseDown = () => {
    timer = window.setTimeout(() => {
      params.onLongPress();
    }, params.duration || 500);
  };

  const handleMouseUp = () => {
    clearTimeout(timer);
  };

  node.addEventListener('mousedown', handleMouseDown);
  node.addEventListener('mouseup', handleMouseUp);
  node.addEventListener('mouseleave', handleMouseUp);

  return {
    update(newParams) {
      params = newParams;
    },

    destroy() {
      clearTimeout(timer);
      node.removeEventListener('mousedown', handleMouseDown);
      node.removeEventListener('mouseup', handleMouseUp);
      node.removeEventListener('mouseleave', handleMouseUp);
    }
  };
};

// Usage
<button use:longPress={{ duration: 1000, onLongPress: handleDelete }}>
  Hold to Delete
</button>
```

### Intersection Observer Directive

```typescript
// directives/intersect.ts
interface IntersectParams {
  onEnter?: () => void;
  onLeave?: () => void;
  threshold?: number;
}

export const intersect: DirectiveFunction<IntersectParams> = (node, params) => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          params.onEnter?.();
        } else {
          params.onLeave?.();
        }
      });
    },
    { threshold: params.threshold || 0 }
  );

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    }
  };
};

// Usage - lazy load image
const Image = defineComponent<{ src: string }>((props) => {
  const isVisible = signal(false);

  return () => (
    <div use:intersect={{ onEnter: () => isVisible.set(true) }}>
      {#if isVisible()}
        <img src={props.src} alt="" />
      {:else}
        <div class="placeholder">Loading...</div>
      {/if}
    </div>
  );
});
```

### Draggable Directive

```typescript
// directives/draggable.ts
interface DragParams {
  onDrag?: (x: number, y: number) => void;
  onDragEnd?: () => void;
}

export const draggable: DirectiveFunction<DragParams> = (node, params = {}) => {
  let startX: number;
  let startY: number;
  let initialX: number;
  let initialY: number;
  let isDragging = false;

  const handleMouseDown = (e: MouseEvent) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = node.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const newX = initialX + dx;
    const newY = initialY + dy;

    node.style.position = 'fixed';
    node.style.left = `${newX}px`;
    node.style.top = `${newY}px`;

    params.onDrag?.(newX, newY);
  };

  const handleMouseUp = () => {
    isDragging = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    params.onDragEnd?.();
  };

  node.addEventListener('mousedown', handleMouseDown);
  node.style.cursor = 'move';

  return {
    update(newParams) {
      params = newParams;
    },

    destroy() {
      node.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  };
};

// Usage
<div
  use:draggable={{
    onDrag: (x, y) => console.log('Position:', x, y),
    onDragEnd: () => console.log('Drag ended')
  }}
  style="width: 100px; height: 100px; background: blue;"
>
  Drag me
</div>
```

---

## Directive Composition

### Combining Multiple Directives

```typescript
<div
  use:draggable
  use:resizable
  use:clickOutside={handleClose}
  use:tooltip="Draggable, resizable box"
  ref={boxRef}
>
  Content
</div>
```

### Directive Factory

Create directives that return configured directives:

```typescript
// Create a directive factory
export const createTooltip = (defaultPosition: 'top' | 'bottom' = 'top') => {
  return (node: HTMLElement, text: string) => {
    return tooltip(node, { text, position: defaultPosition });
  };
};

// Use factory
const topTooltip = createTooltip('top');
const bottomTooltip = createTooltip('bottom');

<button use:topTooltip="Top tooltip">Hover (top)</button>
<button use:bottomTooltip="Bottom tooltip">Hover (bottom)</button>
```

### Directive HOC (Higher-Order Directive)

Wrap directives to add functionality:

```typescript
// Add logging to any directive
export const withLogging = <T>(
  directive: DirectiveFunction<T>,
  name: string
): DirectiveFunction<T> => {
  return (node, params) => {
    console.log(`[${name}] Directive applied`, node, params);

    const result = directive(node, params);

    return {
      update(newParams) {
        console.log(`[${name}] Directive updated`, newParams);
        result.update?.(newParams);
      },

      destroy() {
        console.log(`[${name}] Directive destroyed`);
        result.destroy?.();
      }
    };
  };
};

// Usage
const tooltipWithLogging = withLogging(tooltip, 'Tooltip');

<button use:tooltipWithLogging="Logged tooltip">
  Hover
</button>
```

---

## TypeScript Support

### Typing Directives

```typescript
import type { DirectiveFunction } from 'nexus';

// Simple directive (boolean parameter)
export const autofocus: DirectiveFunction<boolean> = (node, enabled) => {
  if (enabled) {
    node.focus();
  }

  return {};
};

// Directive with object parameter
interface TooltipOptions {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export const tooltip: DirectiveFunction<TooltipOptions> = (node, options) => {
  // Implementation
  return {};
};

// Directive with function parameter
export const clickOutside: DirectiveFunction<(event: MouseEvent) => void> = (
  node,
  callback
) => {
  // Implementation
  return {};
};
```

### Directive Module Augmentation

Declare custom directives for TypeScript autocomplete:

```typescript
// directives.d.ts
import 'nexus';

declare module 'nexus' {
  interface DirectiveAttributes {
    tooltip?: TooltipOptions | string;
    clickOutside?: (event: MouseEvent) => void;
    autofocus?: boolean;
    draggable?: DragOptions;
  }
}
```

Now you get autocomplete:

```typescript
// TypeScript knows about your custom directives
<div use:tooltip="Text">...</div>
<div use:clickOutside={handler}>...</div>
<input use:autofocus={true} />
```

---

## Best Practices

### 1. Name Directives Clearly

```typescript
// ✅ Good - clear names
use:clickOutside
use:autofocus
use:tooltip
use:draggable

// ❌ Bad - unclear names
use:co
use:af
use:tt
use:d
```

### 2. Keep Directives Focused

```typescript
// ❌ Bad - directive does too much
export const megaDirective = (node, params) => {
  // Handles tooltip, dragging, resizing, click outside, etc.
};

// ✅ Good - single responsibility
export const tooltip = (node, params) => { /* tooltip only */ };
export const draggable = (node, params) => { /* dragging only */ };
export const clickOutside = (node, params) => { /* click outside only */ };
```

### 3. Cleanup Resources

```typescript
// ✅ Always cleanup in destroy()
export const myDirective = (node, params) => {
  const listener = () => { /* ... */ };
  node.addEventListener('click', listener);

  return {
    destroy() {
      node.removeEventListener('click', listener); // Cleanup!
    }
  };
};
```

### 4. Handle Updates Properly

```typescript
// ✅ Update when params change
export const tooltip = (node, params) => {
  let tooltipEl = createTooltip(params.text);

  return {
    update(newParams) {
      // Update tooltip text
      tooltipEl.textContent = newParams.text;
    },
    destroy() {
      tooltipEl.remove();
    }
  };
};
```

### 5. Use TypeScript

```typescript
// ✅ Type your directives
interface MyDirectiveParams {
  enabled: boolean;
  duration: number;
}

export const myDirective: DirectiveFunction<MyDirectiveParams> = (
  node,
  params
) => {
  // TypeScript knows params.enabled and params.duration exist
  return {};
};
```

### 6. Document Directives

```typescript
/**
 * Tooltip directive
 *
 * Displays a tooltip on hover
 *
 * @example
 * <button use:tooltip="Save changes">Save</button>
 * <button use:tooltip={{ text: "Delete", position: "bottom" }}>Delete</button>
 *
 * @param node - The element to attach tooltip to
 * @param params - Tooltip text or options
 */
export const tooltip: DirectiveFunction<TooltipOptions | string> = (
  node,
  params
) => {
  // Implementation
};
```

---

## Examples

### Complete Tooltip Directive

```typescript
// directives/tooltip.ts
import type { DirectiveFunction } from 'nexus';

interface TooltipOptions {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  theme?: 'dark' | 'light';
}

export const tooltip: DirectiveFunction<TooltipOptions | string> = (
  node,
  params
) => {
  // Normalize params
  const options: TooltipOptions =
    typeof params === 'string' ? { text: params } : params;

  let tooltipEl: HTMLDivElement;
  let showTimer: number;

  const createTooltip = () => {
    tooltipEl = document.createElement('div');
    tooltipEl.className = `tooltip tooltip-${options.theme || 'dark'}`;
    tooltipEl.textContent = options.text;
    tooltipEl.setAttribute('role', 'tooltip');
  };

  const showTooltip = () => {
    showTimer = window.setTimeout(() => {
      document.body.appendChild(tooltipEl);
      positionTooltip();
      tooltipEl.classList.add('tooltip-visible');
    }, options.delay || 300);
  };

  const hideTooltip = () => {
    clearTimeout(showTimer);
    tooltipEl.classList.remove('tooltip-visible');
    setTimeout(() => tooltipEl.remove(), 200); // Wait for fade out
  };

  const positionTooltip = () => {
    const rect = node.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const gap = 8;

    switch (options.position || 'top') {
      case 'top':
        tooltipEl.style.top = `${rect.top - tooltipRect.height - gap}px`;
        tooltipEl.style.left = `${rect.left + (rect.width - tooltipRect.width) / 2}px`;
        break;
      case 'bottom':
        tooltipEl.style.top = `${rect.bottom + gap}px`;
        tooltipEl.style.left = `${rect.left + (rect.width - tooltipRect.width) / 2}px`;
        break;
      case 'left':
        tooltipEl.style.top = `${rect.top + (rect.height - tooltipRect.height) / 2}px`;
        tooltipEl.style.left = `${rect.left - tooltipRect.width - gap}px`;
        break;
      case 'right':
        tooltipEl.style.top = `${rect.top + (rect.height - tooltipRect.height) / 2}px`;
        tooltipEl.style.left = `${rect.right + gap}px`;
        break;
    }
  };

  createTooltip();

  node.addEventListener('mouseenter', showTooltip);
  node.addEventListener('mouseleave', hideTooltip);
  node.addEventListener('focus', showTooltip);
  node.addEventListener('blur', hideTooltip);

  // Accessibility
  node.setAttribute('aria-describedby', 'tooltip');

  return {
    update(newParams) {
      const newOptions: TooltipOptions =
        typeof newParams === 'string' ? { text: newParams } : newParams;

      tooltipEl.textContent = newOptions.text;
      tooltipEl.className = `tooltip tooltip-${newOptions.theme || 'dark'}`;
    },

    destroy() {
      clearTimeout(showTimer);
      node.removeEventListener('mouseenter', showTooltip);
      node.removeEventListener('mouseleave', hideTooltip);
      node.removeEventListener('focus', showTooltip);
      node.removeEventListener('blur', hideTooltip);
      node.removeAttribute('aria-describedby');
      tooltipEl.remove();
    }
  };
};
```

**CSS**:

```css
.tooltip {
  position: fixed;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 9999;

  opacity: 0;
  transition: opacity 200ms;
}

.tooltip-visible {
  opacity: 1;
}

.tooltip-dark {
  background: rgba(0, 0, 0, 0.9);
  color: white;
}

.tooltip-light {
  background: white;
  color: black;
  border: 1px solid #ccc;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
```

**Usage**:

```typescript
<button use:tooltip="Save changes">Save</button>

<button use:tooltip={{ text: "Delete permanently", position: "bottom", theme: "light" }}>
  Delete
</button>
```

---

**End of Directives Specification**