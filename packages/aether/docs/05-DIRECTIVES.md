# 05. Directives - Utility-Based Pattern

> **Status**: ✅ **CURRENT - IMPLEMENTED**
> **Last Updated**: 2025-10-07
> **Part of**: Aether Frontend Framework Specification

---

## Overview

Aether implements directives through a **ref-based pattern** that doesn't require a custom compiler. This approach provides the same power and convenience as Svelte's `use:` directives or Vue's `v-` directives, but with full TypeScript support and no magic.

### Why Utility-Based Directives?

Instead of custom syntax like `use:tooltip="text"`, Aether uses:

```typescript
<button ref={tooltip('text')}>Hover me</button>
```

**Advantages**:
- ✅ **Full Type Safety**: TypeScript checks parameters and return types
- ✅ **Zero Magic**: Clear function calls, no compiler required
- ✅ **Perfect Debugging**: Stack traces show actual source code
- ✅ **Standard Tooling**: Works with all TypeScript tools
- ✅ **Composable**: Easily combine multiple directives
- ✅ **Testable**: Just test functions, no special testing setup

---

## Table of Contents

1. [Directive Basics](#directive-basics)
2. [Creating Custom Directives](#creating-custom-directives)
3. [Built-in Directives](#built-in-directives)
4. [Updatable Directives](#updatable-directives)
5. [Directive Composition](#directive-composition)
6. [Advanced Patterns](#advanced-patterns)
7. [Best Practices](#best-practices)
8. [Migration Guide](#migration-guide)

---

## Directive Basics

### What is a Directive?

A directive is a **reusable behavior** that can be attached to DOM elements. Common use cases:

- **Focus management** (auto-focus, focus trap)
- **Click detection** (click outside, long press)
- **Observers** (intersection, resize, mutation)
- **Gestures** (swipe, drag, pinch)
- **Tooltips** (hover tooltips, positioned elements)
- **Accessibility** (ARIA attributes, keyboard navigation)
- **Animations** (enter/leave animations)

### How Directives Work

Directives use the `ref` prop to execute setup logic when the element mounts:

```typescript
import { createDirective } from '@omnitron-dev/aether/utils';

// 1. Define directive
const myDirective = createDirective<Params>((element, params) => {
  // 2. Setup: Add event listeners, modify element, etc.

  // 3. Return cleanup function
  return () => {
    // 4. Cleanup: Remove listeners, restore state, etc.
  };
});

// 5. Use directive
<div ref={myDirective(params)}>Content</div>
```

**Lifecycle**:
1. Component mounts
2. Element created in DOM
3. `ref` callback fires
4. Directive setup executes
5. (Later) Component unmounts
6. Cleanup function executes

---

## Creating Custom Directives

### Simple Directive

```typescript
import { createDirective } from '@omnitron-dev/aether/utils';

// Directive that logs when element is clicked
const clickLogger = createDirective<string>((element, message) => {
  const handler = () => console.log(message);

  element.addEventListener('click', handler);

  return () => {
    element.removeEventListener('click', handler);
  };
});

// Usage
<button ref={clickLogger('Button was clicked!')}>
  Click me
</button>
```

### Directive with No Parameters

```typescript
import { createDirective } from '@omnitron-dev/aether/utils';

// Directive that highlights element on hover
const highlightOnHover = createDirective<void>((element) => {
  const handleEnter = () => {
    element.style.backgroundColor = 'yellow';
  };

  const handleLeave = () => {
    element.style.backgroundColor = '';
  };

  element.addEventListener('mouseenter', handleEnter);
  element.addEventListener('mouseleave', handleLeave);

  return () => {
    element.removeEventListener('mouseenter', handleEnter);
    element.removeEventListener('mouseleave', handleLeave);
  };
});

// Usage
<div ref={highlightOnHover()}>
  Hover over me
</div>
```

### Directive with Complex Parameters

```typescript
import { createDirective } from '@omnitron-dev/aether/utils';

interface TooltipOptions {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  theme?: 'dark' | 'light';
}

const tooltip = createDirective<TooltipOptions>((element, options) => {
  const {
    text,
    position = 'top',
    delay = 200,
    theme = 'dark'
  } = options;

  let tooltipEl: HTMLElement | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const show = () => {
    timeoutId = setTimeout(() => {
      tooltipEl = document.createElement('div');
      tooltipEl.className = `tooltip tooltip-${position} tooltip-${theme}`;
      tooltipEl.textContent = text;

      document.body.appendChild(tooltipEl);
      positionTooltip(tooltipEl, element, position);

      timeoutId = null;
    }, delay);
  };

  const hide = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  };

  element.addEventListener('mouseenter', show);
  element.addEventListener('mouseleave', hide);
  element.addEventListener('focus', show);
  element.addEventListener('blur', hide);

  return () => {
    hide();
    element.removeEventListener('mouseenter', show);
    element.removeEventListener('mouseleave', hide);
    element.removeEventListener('focus', show);
    element.removeEventListener('blur', hide);
  };
});

// Usage
<button ref={tooltip({
  text: 'Click to submit the form',
  position: 'bottom',
  delay: 500,
  theme: 'light'
})}>
  Submit
</button>
```

### Directive with Return Value

```typescript
import { createDirective } from '@omnitron-dev/aether/utils';

// Directive that provides imperative API
const draggable = createDirective<{ onDrag: (x: number, y: number) => void }>(
  (element, { onDrag }) => {
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      element.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      onDrag(deltaX, deltaY);
    };

    const handleMouseUp = () => {
      isDragging = false;
      element.style.cursor = 'grab';
    };

    element.style.cursor = 'grab';
    element.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      element.removeEventListener('mousedown', handleMouseDown);
    };
  }
);

// Usage
const position = signal({ x: 0, y: 0 });

<div
  ref={draggable({
    onDrag: (deltaX, deltaY) => {
      position.set({
        x: position().x + deltaX,
        y: position().y + deltaY
      });
    }
  })}
  style={{
    transform: `translate(${position().x}px, ${position().y}px)`
  }}
>
  Drag me
</div>
```

---

## Built-in Directives

Aether provides several built-in directives for common use cases.

### autoFocus

Automatically focuses an element when it mounts.

```typescript
import { autoFocus } from '@omnitron-dev/aether/utils';

// Basic usage
<input ref={autoFocus()} placeholder="Auto-focused" />

// Conditional focus
const shouldFocus = signal(true);

{shouldFocus() && (
  <input ref={autoFocus()} placeholder="Focused" />
)}
```

**Use Cases**:
- Modal dialogs
- Search inputs
- Form first field
- Accessibility (keyboard navigation)

### clickOutside

Calls a handler when user clicks outside the element.

```typescript
import { clickOutside } from '@omnitron-dev/aether/utils';

const isOpen = signal(true);
const handleClose = () => isOpen.set(false);

<div ref={clickOutside(handleClose)}>
  <div className="dropdown">
    Dropdown content
  </div>
</div>
```

**Use Cases**:
- Dropdown menus
- Modal dialogs
- Context menus
- Tooltips with click-to-dismiss

**Parameters**:
- `handler: (event: MouseEvent) => void` - Function to call on outside click

### intersectionObserver

Observes element visibility in viewport.

```typescript
import { intersectionObserver } from '@omnitron-dev/aether/utils';

const isVisible = signal(false);

<div ref={intersectionObserver({
  onIntersect: (entry) => {
    isVisible.set(entry.isIntersecting);

    if (entry.isIntersecting) {
      console.log('Element is visible!');
    }
  },
  threshold: 0.5,  // Trigger when 50% visible
  rootMargin: '0px'
})}>
  Lazy-loaded content
</div>
```

**Use Cases**:
- Lazy loading images/components
- Infinite scroll
- Analytics (view tracking)
- Animations on scroll
- Performance (render only visible items)

**Parameters**:
```typescript
interface IntersectionObserverOptions {
  onIntersect: (entry: IntersectionObserverEntry) => void;
  threshold?: number | number[];
  rootMargin?: string;
  root?: Element | null;
}
```

**Example - Lazy Image Loading**:
```typescript
const LazyImage = defineComponent<{ src: string; alt: string }>((props) => {
  const isVisible = signal(false);
  const imgRef = signal<HTMLImageElement | null>(null);

  return () => (
    <img
      ref={combineDirectives([
        (el) => imgRef.set(el as HTMLImageElement),
        intersectionObserver({
          onIntersect: (entry) => {
            if (entry.isIntersecting && imgRef()) {
              imgRef()!.src = props.src;
              isVisible.set(true);
            }
          },
          threshold: 0.1
        })
      ])}
      alt={props.alt}
      style={{ opacity: isVisible() ? 1 : 0, transition: 'opacity 0.3s' }}
    />
  );
});
```

### resizeObserver

Observes element size changes.

```typescript
import { resizeObserver } from '@omnitron-dev/aether/utils';

const size = signal({ width: 0, height: 0 });

<div ref={resizeObserver((entry) => {
  const { width, height } = entry.contentRect;
  size.set({ width, height });
  console.log(`Size: ${width}x${height}`);
})}>
  <p>Width: {size().width}px</p>
  <p>Height: {size().height}px</p>
</div>
```

**Use Cases**:
- Responsive components
- Chart resizing
- Text truncation
- Adaptive layouts
- Container queries

**Parameters**:
- `callback: (entry: ResizeObserverEntry) => void` - Function called on resize

### longPress

Detects long press gesture.

```typescript
import { longPress } from '@omnitron-dev/aether/utils';

<button ref={longPress(() => {
  console.log('Long pressed!');
  showContextMenu();
}, 1000)}>  // 1000ms threshold
  Long press me
</button>
```

**Use Cases**:
- Context menus (mobile)
- Delete confirmations
- Alternative actions
- Touch interfaces

**Parameters**:
- `callback: () => void` - Function to call on long press
- `duration?: number` - Press duration in ms (default: 500)

### swipe

Detects swipe gestures.

```typescript
import { swipe } from '@omnitron-dev/aether/utils';

const currentSlide = signal(0);

<div ref={swipe({
  onSwipeLeft: () => currentSlide.set(currentSlide() + 1),
  onSwipeRight: () => currentSlide.set(currentSlide() - 1),
  onSwipeUp: () => console.log('Swiped up'),
  onSwipeDown: () => console.log('Swiped down'),
  threshold: 50,  // Minimum distance in pixels
  timeout: 500    // Maximum duration in ms
})}>
  Slide {currentSlide()}
</div>
```

**Use Cases**:
- Image carousels
- Card dismissal
- Navigation
- Mobile interfaces

**Parameters**:
```typescript
interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  threshold?: number;  // Min distance (default: 50)
  timeout?: number;    // Max duration (default: 300)
}
```

---

## Updatable Directives

Directives that can react to parameter changes.

### Creating Updatable Directive

```typescript
import { createUpdatableDirective } from '@omnitron-dev/aether/utils';

interface ColorOptions {
  color: string;
  borderWidth: number;
}

const coloredBorder = createUpdatableDirective<ColorOptions>(
  (element, params) => {
    const apply = () => {
      element.style.border = `${params.borderWidth}px solid ${params.color}`;
    };

    // Initial application
    apply();

    return {
      update(newParams: ColorOptions) {
        // Called when parameters change
        params = newParams;
        apply();
      },
      destroy() {
        // Called on cleanup
        element.style.border = '';
      }
    };
  }
);

// Usage with reactive parameters
const borderColor = signal('red');
const borderWidth = signal(2);

<div ref={coloredBorder({
  color: borderColor(),
  width: borderWidth()
})}>
  Content with reactive border
</div>
```

### Tooltip with Update Support

```typescript
import { createUpdatableDirective } from '@omnitron-dev/aether/utils';

const updatableTooltip = createUpdatableDirective<string>(
  (element, text) => {
    let tooltipEl: HTMLElement | null = null;

    const show = () => {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'tooltip';
      tooltipEl.textContent = text;
      document.body.appendChild(tooltipEl);
      positionTooltip(tooltipEl, element);
    };

    const hide = () => {
      tooltipEl?.remove();
      tooltipEl = null;
    };

    const updateText = (newText: string) => {
      text = newText;
      if (tooltipEl) {
        tooltipEl.textContent = newText;
      }
    };

    element.addEventListener('mouseenter', show);
    element.addEventListener('mouseleave', hide);

    return {
      update(newText: string) {
        updateText(newText);
      },
      destroy() {
        hide();
        element.removeEventListener('mouseenter', show);
        element.removeEventListener('mouseleave', hide);
      }
    };
  }
);

// Usage with reactive text
const tooltipText = signal('Initial text');

<button ref={updatableTooltip(tooltipText())}>
  Hover me
</button>

// Later: tooltip text updates automatically
<button onClick={() => tooltipText.set('Updated text!')}>
  Change Tooltip
</button>
```

---

## Directive Composition

Combine multiple directives on a single element.

### Basic Composition

```typescript
import { combineDirectives, autoFocus, tooltip } from '@omnitron-dev/aether/utils';

const multiDirective = combineDirectives([
  autoFocus(),
  tooltip('Enter your email address')
]);

<input ref={multiDirective} type="email" />
```

### Composition with Parameters

```typescript
import { combineDirectives, tooltip, clickOutside, autoFocus } from '@omnitron-dev/aether/utils';

const handleClose = () => setIsOpen(false);

const modalDirectives = combineDirectives([
  autoFocus(),
  tooltip('Press Escape to close'),
  clickOutside(handleClose)
]);

<div ref={modalDirectives} className="modal">
  Modal content
</div>
```

### Dynamic Composition

```typescript
import { combineDirectives } from '@omnitron-dev/aether/utils';

const shouldAutoFocus = signal(true);
const enableTooltip = signal(true);

const dynamicDirectives = () => {
  const directives = [];

  if (shouldAutoFocus()) {
    directives.push(autoFocus());
  }

  if (enableTooltip()) {
    directives.push(tooltip('Help text'));
  }

  return combineDirectives(directives);
};

<input ref={dynamicDirectives()} />
```

### Composition Pattern for Accessibility

```typescript
import { createDirective, combineDirectives } from '@omnitron-dev/aether/utils';

// ARIA label directive
const ariaLabel = createDirective<string>((element, label) => {
  element.setAttribute('aria-label', label);
  return () => element.removeAttribute('aria-label');
});

// ARIA role directive
const ariaRole = createDirective<string>((element, role) => {
  element.setAttribute('role', role);
  return () => element.removeAttribute('role');
});

// Keyboard navigation directive
const keyboardNav = createDirective<{
  onEnter?: () => void;
  onEscape?: () => void;
}>((element, { onEnter, onEscape }) => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && onEnter) onEnter();
    if (e.key === 'Escape' && onEscape) onEscape();
  };

  element.addEventListener('keydown', handler);
  return () => element.removeEventListener('keydown', handler);
});

// Combine for accessible button
const accessibleButton = (label: string, onActivate: () => void) =>
  combineDirectives([
    ariaLabel(label),
    ariaRole('button'),
    keyboardNav({ onEnter: onActivate })
  ]);

<div
  ref={accessibleButton('Submit form', handleSubmit)}
  tabIndex={0}
  className="custom-button"
>
  Submit
</div>
```

---

## Advanced Patterns

### Directive Factory

Create directives with shared configuration:

```typescript
import { createDirective } from '@omnitron-dev/aether/utils';

function createTooltipFactory(defaultTheme: 'dark' | 'light') {
  return (text: string, theme = defaultTheme) =>
    createDirective<void>((element) => {
      // Tooltip implementation with theme
      const tooltipEl = document.createElement('div');
      tooltipEl.className = `tooltip tooltip-${theme}`;
      tooltipEl.textContent = text;

      // ... rest of implementation
    })();
}

// Create themed tooltip directives
const darkTooltip = createTooltipFactory('dark');
const lightTooltip = createTooltipFactory('light');

<button ref={darkTooltip('Dark theme tooltip')}>Hover</button>
<button ref={lightTooltip('Light theme tooltip')}>Hover</button>
```

### Directive with Ref Access

Access element reference within directive:

```typescript
import { createDirective } from '@omnitron-dev/aether/utils';
import { signal } from '@omnitron-dev/aether/reactivity';

const createMeasuredDirective = () => {
  const measurements = signal({ width: 0, height: 0 });

  const directive = createDirective<void>((element) => {
    const updateMeasurements = () => {
      const rect = element.getBoundingClientRect();
      measurements.set({
        width: rect.width,
        height: rect.height
      });
    };

    updateMeasurements();
    window.addEventListener('resize', updateMeasurements);

    return () => {
      window.removeEventListener('resize', updateMeasurements);
    };
  });

  return { directive, measurements };
};

// Usage
const { directive: measured, measurements } = createMeasuredDirective();

<div ref={measured()}>
  <p>Width: {measurements().width}px</p>
  <p>Height: {measurements().height}px</p>
</div>
```

### Directive with Event Bus

Directives can communicate via event bus:

```typescript
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { createDirective } from '@omnitron-dev/aether/utils';

const dragDropBus = new EventEmitter();

const draggable = createDirective<{ id: string; data: any }>(
  (element, { id, data }) => {
    const handleDragStart = (e: DragEvent) => {
      dragDropBus.emit('dragStart', { id, data });
      e.dataTransfer!.effectAllowed = 'move';
      element.style.opacity = '0.5';
    };

    const handleDragEnd = () => {
      dragDropBus.emit('dragEnd', { id });
      element.style.opacity = '1';
    };

    element.draggable = true;
    element.addEventListener('dragstart', handleDragStart);
    element.addEventListener('dragend', handleDragEnd);

    return () => {
      element.removeEventListener('dragstart', handleDragStart);
      element.removeEventListener('dragend', handleDragEnd);
    };
  }
);

const droppable = createDirective<{
  onDrop: (data: any) => void;
}>((element, { onDrop }) => {
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    element.style.backgroundColor = 'lightblue';
  };

  const handleDragLeave = () => {
    element.style.backgroundColor = '';
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    element.style.backgroundColor = '';

    // Get data from event bus
    dragDropBus.once('dragEnd', ({ id, data }: any) => {
      onDrop(data);
    });
  };

  element.addEventListener('dragover', handleDragOver);
  element.addEventListener('dragleave', handleDragLeave);
  element.addEventListener('drop', handleDrop);

  return () => {
    element.removeEventListener('dragover', handleDragOver);
    element.removeEventListener('dragleave', handleDragLeave);
    element.removeEventListener('drop', handleDrop);
  };
});

// Usage
<div ref={draggable({ id: '1', data: { name: 'Item 1' } })}>
  Drag me
</div>

<div ref={droppable({ onDrop: (data) => console.log('Dropped:', data) })}>
  Drop here
</div>
```

---

## Best Practices

### 1. Always Clean Up

```typescript
// ❌ Bad - no cleanup
const badDirective = createDirective<void>((element) => {
  window.addEventListener('resize', handleResize);
  // Missing cleanup!
});

// ✅ Good - proper cleanup
const goodDirective = createDirective<void>((element) => {
  window.addEventListener('resize', handleResize);

  return () => {
    window.removeEventListener('resize', handleResize);
  };
});
```

### 2. Use TypeScript for Parameter Types

```typescript
// ❌ Bad - no types
const badTooltip = createDirective((element, text) => {
  // text has 'any' type
});

// ✅ Good - explicit types
const goodTooltip = createDirective<string>((element, text) => {
  // text is string, TypeScript checks usage
});

// ✅ Better - interface for complex params
interface TooltipOptions {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

const betterTooltip = createDirective<TooltipOptions>((element, options) => {
  // Full type safety and autocomplete
});
```

### 3. Make Directives Reusable

```typescript
// ❌ Bad - hardcoded values
const badHighlight = createDirective<void>((element) => {
  element.style.backgroundColor = 'yellow'; // Hardcoded!
});

// ✅ Good - configurable
interface HighlightOptions {
  color?: string;
  opacity?: number;
}

const goodHighlight = createDirective<HighlightOptions>(
  (element, { color = 'yellow', opacity = 0.3 } = {}) => {
    const originalBg = element.style.backgroundColor;

    const highlight = () => {
      element.style.backgroundColor = color;
      element.style.opacity = String(opacity);
    };

    const restore = () => {
      element.style.backgroundColor = originalBg;
      element.style.opacity = '1';
    };

    element.addEventListener('mouseenter', highlight);
    element.addEventListener('mouseleave', restore);

    return () => {
      restore();
      element.removeEventListener('mouseenter', highlight);
      element.removeEventListener('mouseleave', restore);
    };
  }
);
```

### 4. Handle Edge Cases

```typescript
// ✅ Good - handles missing element
const safeDirective = createDirective<string>((element, param) => {
  if (!(element instanceof HTMLElement)) {
    console.warn('Directive requires HTMLElement');
    return;
  }

  // Safe to proceed
  element.setAttribute('data-param', param);

  return () => {
    element.removeAttribute('data-param');
  };
});
```

### 5. Prefer Composition Over Complex Directives

```typescript
// ❌ Bad - one directive does too much
const complexDirective = createDirective<{
  autoFocus: boolean;
  tooltip: string;
  onClick: () => void;
  // ... many more options
}>((element, options) => {
  // Tons of logic here
});

// ✅ Better - compose simple directives
const App = () => {
  return () => (
    <input
      ref={combineDirectives([
        autoFocus(),
        tooltip('Enter value'),
        onClick(handleClick)
      ])}
    />
  );
};
```

### 6. Document Your Directives

```typescript
/**
 * Animates element entrance with specified animation
 *
 * @param animation - Animation type ('fade' | 'slide' | 'scale')
 * @param duration - Animation duration in milliseconds (default: 300)
 * @param delay - Delay before animation starts (default: 0)
 *
 * @example
 * ```typescript
 * <div ref={animateEntrance('fade', 500, 100)}>
 *   Content fades in
 * </div>
 * ```
 */
const animateEntrance = createDirective<{
  animation: 'fade' | 'slide' | 'scale';
  duration?: number;
  delay?: number;
}>((element, { animation, duration = 300, delay = 0 }) => {
  // Implementation
});
```

### 7. Test Directives Independently

```typescript
import { describe, it, expect, vi } from 'vitest';
import { clickOutside } from '@omnitron-dev/aether/utils';

describe('clickOutside directive', () => {
  it('should call handler when clicking outside element', () => {
    const handler = vi.fn();
    const element = document.createElement('div');
    document.body.appendChild(element);

    // Apply directive
    const cleanup = clickOutside(handler)(element);

    // Simulate outside click
    document.body.click();

    expect(handler).toHaveBeenCalled();

    // Cleanup
    cleanup?.();
    document.body.removeChild(element);
  });

  it('should not call handler when clicking inside element', () => {
    const handler = vi.fn();
    const element = document.createElement('div');
    document.body.appendChild(element);

    const cleanup = clickOutside(handler)(element);

    // Simulate inside click
    element.click();

    expect(handler).not.toHaveBeenCalled();

    cleanup?.();
    document.body.removeChild(element);
  });
});
```

---

## Migration Guide

### From Svelte `use:` Directives

| Svelte Syntax | Aether Pattern |
|---------------|----------------|
| `use:tooltip="text"` | `ref={tooltip('text')}` |
| `use:clickOutside={handler}` | `ref={clickOutside(handler)}` |
| `use:action` | `ref={action()}` |
| `use:action={params}` | `ref={action(params)}` |

### From Vue `v-` Directives

| Vue Syntax | Aether Pattern |
|------------|----------------|
| `v-focus` | `ref={autoFocus()}` |
| `v-click-outside="handler"` | `ref={clickOutside(handler)}` |
| `v-tooltip="text"` | `ref={tooltip(text)}` |
| `v-my-directive="value"` | `ref={myDirective(value)}` |

### Creating Equivalent to Svelte Actions

**Svelte**:
```javascript
function tooltip(node, text) {
  const tooltip = document.createElement('div');
  tooltip.textContent = text;

  // ...

  return {
    destroy() {
      tooltip.remove();
    }
  };
}

// Usage: <button use:tooltip="text">
```

**Aether**:
```typescript
const tooltip = createDirective<string>((element, text) => {
  const tooltipEl = document.createElement('div');
  tooltipEl.textContent = text;

  // ...

  return () => {
    tooltipEl.remove();
  };
});

// Usage: <button ref={tooltip('text')}>
```

**Key Differences**:
1. Use `createDirective()` wrapper
2. Return cleanup function directly (not in object)
3. Use `ref` prop instead of `use:`
4. Full TypeScript support

---

## Complete Example: Advanced Form

```typescript
import { defineComponent, signal } from '@omnitron-dev/aether';
import {
  autoFocus,
  tooltip,
  clickOutside,
  combineDirectives,
  createDirective,
} from '@omnitron-dev/aether/utils';

// Custom validation directive
const validateOnBlur = createDirective<{
  validator: (value: string) => string | null;
  onError: (error: string | null) => void;
}>((element, { validator, onError }) => {
  const handleBlur = () => {
    const value = (element as HTMLInputElement).value;
    const error = validator(value);
    onError(error);
  };

  element.addEventListener('blur', handleBlur);

  return () => {
    element.removeEventListener('blur', handleBlur);
  };
});

// Custom character counter directive
const charCounter = createDirective<{
  max: number;
  onUpdate: (count: number) => void;
}>((element, { max, onUpdate }) => {
  const handleInput = () => {
    const count = (element as HTMLInputElement).value.length;
    onUpdate(count);

    if (count > max) {
      element.style.borderColor = 'red';
    } else {
      element.style.borderColor = '';
    }
  };

  element.addEventListener('input', handleInput);

  return () => {
    element.removeEventListener('input', handleInput);
  };
});

export const AdvancedForm = defineComponent(() => {
  const email = signal('');
  const emailError = signal<string | null>(null);
  const charCount = signal(0);
  const maxChars = 50;

  const validateEmail = (value: string): string | null => {
    if (!value) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return 'Invalid email format';
    }
    return null;
  };

  return () => (
    <form>
      <div className="form-group">
        <label>Email</label>
        <input
          type="email"
          ref={combineDirectives([
            autoFocus(),
            tooltip('Enter a valid email address'),
            validateOnBlur({
              validator: validateEmail,
              onError: (error) => emailError.set(error)
            }),
            charCounter({
              max: maxChars,
              onUpdate: (count) => charCount.set(count)
            })
          ])}
          value={email()}
          onInput={(e) => email.set(e.currentTarget.value)}
        />

        {emailError() && (
          <span className="error">{emailError()}</span>
        )}

        <span className="char-count">
          {charCount()} / {maxChars}
        </span>
      </div>

      <button type="submit">Submit</button>
    </form>
  );
});
```

---

## Summary

Aether's **utility-based directive pattern** provides:

✅ **No Compiler Required** - Standard TypeScript/JSX
✅ **Full Type Safety** - TypeScript checks all parameters
✅ **Perfect Debugging** - Clear stack traces
✅ **Easy Composition** - Combine directives effortlessly
✅ **Fully Testable** - Test as regular functions
✅ **Built-in Directives** - autoFocus, clickOutside, intersectionObserver, resizeObserver, longPress, swipe
✅ **Custom Directives** - Easy to create with `createDirective()`
✅ **Production Ready** - 16/16 directive tests passing

This approach delivers the **power of directives** without the complexity of a custom compiler, while maintaining all benefits of standard TypeScript tooling.

---

## Further Reading

- **Template Syntax**: See [04-TEMPLATE-SYNTAX.md](./04-TEMPLATE-SYNTAX.md)
- **Component Patterns**: See [03-COMPONENTS.md](./03-COMPONENTS.md)
- **Architectural Decision**: See [TEMPLATE-DIRECTIVES-EVALUATION.md](./TEMPLATE-DIRECTIVES-EVALUATION.md)
- **Implementation**: See `packages/aether/src/utils/directive.ts`
- **Tests**: See `packages/aether/tests/unit/utils/directive.spec.ts`
