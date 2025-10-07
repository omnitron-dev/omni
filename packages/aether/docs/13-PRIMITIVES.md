# 13. UI Primitives - Headless Component Library

> **Status**: Complete Specification
> **Last Updated**: 2025-10-06
> **Part of**: Aether Frontend Framework Specification

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Architecture](#architecture)
3. [Accessibility by Default](#accessibility-by-default)
4. [Core Primitives](#core-primitives)
   - [Dialog](#dialog)
   - [Popover](#popover)
   - [Dropdown Menu](#dropdown-menu)
   - [Select](#select)
   - [Combobox](#combobox)
   - [Tabs](#tabs)
   - [Accordion](#accordion)
   - [Radio Group](#radio-group)
   - [Checkbox Group](#checkbox-group)
   - [Slider](#slider)
   - [Toggle](#toggle)
   - [Switch](#switch)
   - [Alert Dialog](#alert-dialog)
   - [Sheet](#sheet)
   - [Command Palette](#command-palette)
   - [DatePicker](#datepicker)
   - [Calendar](#calendar)
   - [Form](#form)
   - [Avatar](#avatar)
   - [Badge](#badge)
   - [Progress](#progress)
   - [AspectRatio](#aspectratio)
   - [Toast](#toast)
   - [Collapsible](#collapsible)
   - [Skeleton](#skeleton)
   - [Label](#label)
   - [Input](#input)
   - [Textarea](#textarea)
   - [ScrollArea](#scrollarea)
   - [Pagination](#pagination)
   - [Menubar](#menubar)
   - [Table](#table)
5. [Composition Patterns](#composition-patterns)
6. [Customization](#customization)
7. [Theme Integration](#theme-integration)
8. [Animation System](#animation-system)
9. [Testing Primitives](#testing-primitives)
10. [Advanced Patterns](#advanced-patterns)
11. [Best Practices](#best-practices)

---

## Philosophy

### Why Headless Components?

Traditional component libraries couple **behavior** with **presentation**, leading to:

**Problems**:
- **Limited Customization**: Hard to override styles without `!important` hacks
- **Bundle Bloat**: Shipping CSS you might not use
- **Design Lock-in**: Forced to use the library's design system
- **Accessibility Gaps**: Often bolted on as an afterthought
- **Framework Coupling**: Tied to specific styling solutions (CSS-in-JS, CSS Modules, etc.)

**Aether Primitives Solution**:
```typescript
// Headless = Unstyled but fully functional + accessible
import { Dialog } from 'aether/primitives';

// You control 100% of the presentation
<Dialog>
  <Dialog.Trigger class="my-button">Open</Dialog.Trigger>
  <Dialog.Content class="my-modal">
    <Dialog.Title class="my-title">Welcome</Dialog.Title>
    <Dialog.Description class="my-text">
      This is your custom styled modal
    </Dialog.Description>
    <Dialog.Close class="my-close-btn">Close</Dialog.Close>
  </Dialog.Content>
</Dialog>
```

**Benefits**:
- **Full Design Control**: Style with CSS, Tailwind, theme tokens, anything
- **Zero Bundle Overhead**: No unused CSS shipped to production
- **Accessibility First**: WAI-ARIA compliant out of the box
- **Composable**: Build complex UIs from simple primitives
- **Type-Safe**: Full TypeScript support with autocomplete
- **Framework Coherent**: Integrates with Aether reactivity and DI

### Headless vs Traditional Libraries

| Aspect | Traditional (Material-UI) | Headless (Aether Primitives) |
|--------|---------------------------|------------------------------|
| **Styling** | Pre-styled (theme overrides) | Unstyled (you provide all styles) |
| **Bundle Size** | 150KB+ (with styles) | 12KB (behavior only) |
| **Customization** | Theme API, `sx` prop, CSS override | Direct CSS/Tailwind/CSS-in-JS |
| **Accessibility** | Variable (community maintained) | Built-in (WAI-ARIA by design) |
| **Learning Curve** | Library-specific API + theme system | Web standards + small API surface |
| **Design System** | Material Design by default | Your design system |

### Inspiration

Aether Primitives draws from the best:

- **Radix UI**: WAI-ARIA compliance, composable API
- **Headless UI**: Simplicity, framework integration
- **Ark UI**: Advanced state machines, framework agnostic
- **React Aria**: Adobe's accessibility expertise
- **shadcn/ui**: Developer experience, copy-paste philosophy

**But with Aether advantages**:
- Fine-grained reactivity (no Virtual DOM overhead)
- Compile-time optimizations
- Deep TypeScript integration
- Unified with Aether DI and theming
- SSR/Islands architecture support

---

## Architecture

### Component Structure

Every primitive follows a consistent pattern:

```typescript
// 1. Root Component (Context Provider)
<Primitive>
  {/* Manages state, keyboard navigation, focus management */}

  // 2. Trigger/Button (Opens/activates the primitive)
  <Primitive.Trigger>...</Primitive.Trigger>

  // 3. Content (The main interactive area)
  <Primitive.Content>
    {/* 4. Sub-components (Title, Description, etc.) */}
    <Primitive.Title>...</Primitive.Title>
    <Primitive.Description>...</Primitive.Description>
  </Primitive.Content>

  // 5. Close/Cancel (Dismisses the primitive)
  <Primitive.Close>...</Primitive.Close>
</Primitive>
```

### State Management

Each primitive uses **signals** for reactive state:

```typescript
// Internal implementation (simplified)
export const Dialog = defineComponent(() => {
  // Fine-grained reactive state
  const isOpen = signal(false);
  const triggerRef = signal<HTMLElement | null>(null);
  const contentRef = signal<HTMLElement | null>(null);

  // Computed values
  const shouldRenderContent = computed(() => isOpen());

  // Effects for side effects
  effect(() => {
    if (isOpen()) {
      // Trap focus, disable body scroll
      disableBodyScroll(contentRef());
      trapFocus(contentRef());
    } else {
      // Restore on close
      enableBodyScroll();
      restoreFocus(triggerRef());
    }
  });

  // Provide context to children
  provideContext(DialogContext, {
    isOpen,
    open: () => isOpen(true),
    close: () => isOpen(false),
    toggle: () => isOpen(!isOpen())
  });

  return () => <slot />;
});
```

### Context System

Primitives use Aether context for component communication:

```typescript
// DialogContext.ts
export interface DialogContextValue {
  isOpen: Signal<boolean>;
  open: () => void;
  close: () => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  titleId: string;
  descriptionId: string;
}

export const DialogContext = createContext<DialogContextValue>('Dialog');

// Usage in sub-components
export const DialogTrigger = defineComponent((props) => {
  const ctx = injectContext(DialogContext);

  return () => (
    <button
      id={ctx.triggerId}
      aria-haspopup="dialog"
      aria-expanded={ctx.isOpen()}
      aria-controls={ctx.contentId}
      on:click={ctx.toggle}
      {...props}
    >
      <slot />
    </button>
  );
});
```

### Accessibility Architecture

Every primitive implements WAI-ARIA patterns:

1. **Semantic HTML**: Use native elements when possible
2. **ARIA Attributes**: Proper roles, states, properties
3. **Keyboard Navigation**: Full keyboard support
4. **Focus Management**: Logical tab order, focus trapping
5. **Screen Reader Support**: Announcements, labels, descriptions

```typescript
// Example: Accessible Dialog
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby={titleId}
  aria-describedby={descriptionId}
  tabindex="-1"
>
  <h2 id={titleId}>Dialog Title</h2>
  <p id={descriptionId}>Dialog description for screen readers</p>
  {/* Content */}
</div>
```

---

## Accessibility by Default

### WAI-ARIA Compliance

All primitives follow [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/):

| Primitive | ARIA Pattern | Key Features |
|-----------|--------------|--------------|
| Dialog | [Dialog (Modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Focus trap, Esc closes, focus restoration |
| Popover | [Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) | aria-expanded, aria-controls |
| Dropdown | [Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menubutton/) | Arrow keys, Home/End, typeahead |
| Select | [Listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) | aria-selected, keyboard selection |
| Tabs | [Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | Arrow keys, automatic/manual activation |
| Accordion | [Accordion](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) | Expand/collapse with Enter/Space |
| Slider | [Slider](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) | Arrow keys, Page Up/Down, Home/End |

### Keyboard Navigation

Standard keyboard shortcuts across all primitives:

```typescript
// Common keyboard patterns
const KEYBOARD_SHORTCUTS = {
  // Close/Dismiss
  Escape: 'Close current overlay/dialog',

  // Navigation
  ArrowDown: 'Move focus to next item',
  ArrowUp: 'Move focus to previous item',
  Home: 'Move focus to first item',
  End: 'Move focus to last item',

  // Selection
  Enter: 'Activate/select focused item',
  Space: 'Activate/toggle focused item',

  // Tabs
  Tab: 'Move to next focusable element',
  'Shift+Tab': 'Move to previous focusable element',

  // Typeahead (for lists/menus)
  'a-z': 'Jump to item starting with typed character'
};
```

Example implementation:

```typescript
// Dropdown Menu keyboard handling
const handleKeyDown = (event: KeyboardEvent) => {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusNextItem();
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusPreviousItem();
      break;
    case 'Home':
      event.preventDefault();
      focusFirstItem();
      break;
    case 'End':
      event.preventDefault();
      focusLastItem();
      break;
    case 'Escape':
      event.preventDefault();
      close();
      restoreFocus();
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      selectCurrentItem();
      break;
    default:
      // Typeahead search
      handleTypeahead(event.key);
  }
};
```

### Focus Management

Primitives automatically manage focus:

```typescript
// Focus trap example (Dialog, Popover)
export const useFocusTrap = (containerRef: Signal<HTMLElement | null>) => {
  const previousActiveElement = signal<HTMLElement | null>(null);

  effect(() => {
    const container = containerRef();
    if (!container) return;

    // Store current focus
    previousActiveElement(document.activeElement as HTMLElement);

    // Get all focusable elements
    const focusableElements = getFocusableElements(container);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Focus first element
    firstElement?.focus();

    // Trap focus within container
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift+Tab on first element -> focus last
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab on last element -> focus first
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Restore focus on cleanup
      previousActiveElement()?.focus();
    };
  });
};

// Get focusable elements
const getFocusableElements = (container: HTMLElement): HTMLElement[] => {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  return Array.from(container.querySelectorAll(selector));
};
```

### Screen Reader Support

Proper labeling and announcements:

```typescript
// Live region announcements
export const useLiveRegion = () => {
  const announce = (message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const liveRegion = document.createElement('div');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', priority);
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.className = 'sr-only'; // Visually hidden
    liveRegion.textContent = message;

    document.body.appendChild(liveRegion);

    // Remove after announcement
    setTimeout(() => {
      document.body.removeChild(liveRegion);
    }, 1000);
  };

  return { announce };
};

// Usage in components
const { announce } = useLiveRegion();

// When dialog opens
announce('Dialog opened');

// When form has errors
announce('Form has 3 errors', 'assertive');

// When action completes
announce('Item added to cart');
```

### Visually Hidden Utility

For screen reader only content:

```css
/* sr-only class for screen reader only text */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

```html
<!-- Usage -->
<button aria-label="Close dialog">
  <XIcon aria-hidden="true" />
  <span class="sr-only">Close</span>
</button>
```

---

## Core Primitives

### Dialog

A modal dialog that overlays the page content.

#### Features

- Focus trapping
- Body scroll locking
- Esc to close
- Click outside to close (optional)
- Focus restoration on close
- Nested dialog support
- Animated enter/exit
- Portal rendering (escape DOM hierarchy)

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Dialog } from 'aether/primitives';

export const ProfileDialog = defineComponent(() => {
  const isOpen = signal(false);

  return () => (
    <Dialog bind:open={isOpen}>
      <Dialog.Trigger>Open Dialog</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay" />
        <Dialog.Content class="dialog-content">
          <Dialog.Title class="dialog-title">
            Edit Profile
          </Dialog.Title>
          <Dialog.Description class="dialog-description">
            Make changes to your profile here. Click save when you're done.
          </Dialog.Description>

          <form class="dialog-form">
            <label>
              Name
              <input type="text" value="John Doe" />
            </label>
            <label>
              Email
              <input type="email" value="john@example.com" />
            </label>
          </form>

          <div class="dialog-actions">
            <Dialog.Close class="btn-secondary">Cancel</Dialog.Close>
            <button class="btn-primary" on:click={() => save()}>
              Save Changes
            </button>
          </div>

          <Dialog.Close class="dialog-close-icon" aria-label="Close">
            <XIcon />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
});
```

#### Controlled vs Uncontrolled

```typescript
// Uncontrolled (Dialog manages state internally)
<Dialog>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Content>...</Dialog.Content>
</Dialog>

// Controlled (You manage state externally)
const isOpen = signal(false);

<Dialog bind:open={isOpen}>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Content>...</Dialog.Content>
</Dialog>

// Programmatic control
<button on:click={() => isOpen(true)}>Open from outside</button>
```

#### Styling Example

```css
/* Overlay (backdrop) */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: var(--z-modal);

  /* Animation */
  animation: fadeIn 200ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Content */
.dialog-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  width: 90vw;
  max-width: 450px;
  max-height: 85vh;
  overflow: auto;

  background: var(--color-background-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: var(--spacing-6);

  z-index: calc(var(--z-modal) + 1);

  /* Animation */
  animation: slideIn 200ms ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translate(-50%, -48%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

/* Title */
.dialog-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-2);
}

/* Description */
.dialog-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-4);
}

/* Close icon button */
.dialog-close-icon {
  position: absolute;
  top: var(--spacing-4);
  right: var(--spacing-4);

  display: flex;
  align-items: center;
  justify-content: center;

  width: 32px;
  height: 32px;

  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;

  color: var(--color-text-secondary);

  transition: background-color var(--transition-fast);
}

.dialog-close-icon:hover {
  background: var(--color-background-secondary);
}
```

#### API Reference

**`<Dialog>`** - Root component

Props:
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial open state (uncontrolled)
- `onOpenChange?: (open: boolean) => void` - Callback when open state changes
- `modal?: boolean` - Whether to render as modal (default: true)

**`<Dialog.Trigger>`** - Opens the dialog

Props:
- `asChild?: boolean` - Merge props into child instead of wrapping

**`<Dialog.Portal>`** - Portal for rendering outside DOM hierarchy

Props:
- `container?: HTMLElement` - Custom container (default: document.body)

**`<Dialog.Overlay>`** - Backdrop overlay

**`<Dialog.Content>`** - Main dialog content

Props:
- `onEscapeKeyDown?: (event: KeyboardEvent) => void` - Handle Esc key
- `onPointerDownOutside?: (event: PointerEvent) => void` - Handle click outside
- `onInteractOutside?: (event: Event) => void` - Handle any interaction outside
- `forceMount?: boolean` - Force mount even when closed (for animations)
- `trapFocus?: boolean` - Trap focus within dialog (default: true)
- `closeOnEscape?: boolean` - Close on Esc key (default: true)
- `closeOnOutsideClick?: boolean` - Close on outside click (default: true)

**`<Dialog.Title>`** - Dialog title (required for accessibility)

**`<Dialog.Description>`** - Dialog description (required for accessibility)

**`<Dialog.Close>`** - Closes the dialog

#### Advanced: Nested Dialogs

```html
<Dialog>
  <Dialog.Trigger>Open Outer</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Title>Outer Dialog</Dialog.Title>

    <!-- Nested dialog -->
    <Dialog>
      <Dialog.Trigger>Open Inner</Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Title>Inner Dialog</Dialog.Title>
        <p>This is a nested dialog</p>
        <Dialog.Close>Close Inner</Dialog.Close>
      </Dialog.Content>
    </Dialog>

    <Dialog.Close>Close Outer</Dialog.Close>
  </Dialog.Content>
</Dialog>
```

Focus management automatically handles nested dialogs:
- Focus trap applies to the topmost dialog
- Esc closes only the topmost dialog
- Closing inner dialog restores focus to outer dialog

#### Advanced: Custom Close Behavior

```typescript
import { defineComponent, signal } from 'aether';
import { Dialog } from 'aether/primitives';

export const UnsavedChangesDialog = defineComponent(() => {
  const isOpen = signal(false);
  const hasUnsavedChanges = signal(false);

  const handleOpenChange = (open: boolean) => {
    if (!open && hasUnsavedChanges()) {
      // Prevent closing if there are unsaved changes
      if (!confirm('You have unsaved changes. Close anyway?')) {
        return; // Don't close
      }
    }
    isOpen(open);
  };

  return () => (
    <Dialog bind:open={isOpen} onOpenChange={handleOpenChange}>
      {/* ... */}
    </Dialog>
  );
});
```

#### Advanced: Animation with `forceMount`

```typescript
import { defineComponent, signal } from 'aether';
import { Dialog } from 'aether/primitives';
import { presence } from 'aether/primitives/animation';

export const AnimatedDialog = defineComponent(() => {
  const isOpen = signal(false);
  const overlayPresence = presence(() => isOpen());
  const contentPresence = presence(() => isOpen());

  return () => (
    <Dialog bind:open={isOpen}>
      <Dialog.Trigger>Open</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          forceMount
          data-state={overlayPresence.state()}
          class="dialog-overlay"
        />
        <Dialog.Content
          forceMount
          data-state={contentPresence.state()}
          class="dialog-content"
        >
          {/* Content */}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
});
```

```css
/* Animate based on data-state */
.dialog-overlay[data-state="open"] {
  animation: fadeIn 200ms;
}

.dialog-overlay[data-state="closed"] {
  animation: fadeOut 200ms;
}

.dialog-content[data-state="open"] {
  animation: slideIn 200ms;
}

.dialog-content[data-state="closed"] {
  animation: slideOut 200ms;
}
```

---

### Popover

Non-modal floating element positioned relative to a trigger.

#### Features

- Smart positioning (auto-flip, auto-shift)
- Arrow pointing to trigger
- Click outside to close
- Esc to close
- Focus management (optional trap)
- Collision detection
- Virtual element support

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Popover } from 'aether/primitives';

export const NotificationsPopover = defineComponent(() => {
  return () => (
    <Popover>
      <Popover.Trigger class="btn">
        Open Popover
      </Popover.Trigger>

      <Popover.Content class="popover-content">
        <Popover.Arrow class="popover-arrow" />

        <div class="popover-header">
          <h3>Notifications</h3>
          <Popover.Close class="popover-close">
            <XIcon />
          </Popover.Close>
        </div>

        <div class="popover-body">
          <p>You have 3 new notifications</p>
          <ul>
            <li>Message from Alice</li>
            <li>New follower</li>
            <li>Comment on your post</li>
          </ul>
        </div>
      </Popover.Content>
    </Popover>
  );
});
```

#### Positioning

```typescript
import { defineComponent } from 'aether';
import { Popover } from 'aether/primitives';

export const PositionedPopover = defineComponent(() => {
  return () => (
    <>
      {/* Side options: top, right, bottom, left */}
      {/* Align options: start, center, end */}
      <Popover>
        <Popover.Trigger>Open</Popover.Trigger>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          alignOffset={0}
        >
          Positioned at bottom-start with 8px offset
        </Popover.Content>
      </Popover>

      {/* Auto-positioning (flips if no space) */}
      <Popover>
        <Popover.Trigger>Open</Popover.Trigger>
        <Popover.Content
          side="top"
          avoidCollisions={true}
          collisionPadding={16}
        >
          Will flip to bottom if not enough space at top
        </Popover.Content>
      </Popover>
    </>
  );
});
```

#### Styling Example

```css
.popover-content {
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-4);

  max-width: 300px;

  z-index: var(--z-popover);

  /* Animation */
  animation: scaleIn 150ms ease-out;
  transform-origin: var(--radix-popover-content-transform-origin);
}

@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.popover-arrow {
  fill: var(--color-background-primary);
  stroke: var(--color-border);
  stroke-width: 1px;
}
```

#### API Reference

**`<Popover>`** - Root component

Props:
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial open state
- `onOpenChange?: (open: boolean) => void` - Callback
- `modal?: boolean` - Modal behavior (default: false)

**`<Popover.Trigger>`** - Opens the popover

**`<Popover.Anchor>`** - Optional anchor element (different from trigger)

**`<Popover.Content>`** - Popover content

Props:
- `side?: 'top' | 'right' | 'bottom' | 'left'` - Preferred side (default: 'bottom')
- `align?: 'start' | 'center' | 'end'` - Alignment (default: 'center')
- `sideOffset?: number` - Offset from anchor (default: 0)
- `alignOffset?: number` - Offset along alignment axis (default: 0)
- `avoidCollisions?: boolean` - Auto-flip/shift to avoid viewport edges (default: true)
- `collisionPadding?: number | { top, right, bottom, left }` - Padding from edges (default: 10)
- `sticky?: 'partial' | 'always'` - Keep in viewport when scrolling
- `hideWhenDetached?: boolean` - Hide when anchor is fully clipped (default: false)
- `onEscapeKeyDown?: (event: KeyboardEvent) => void`
- `onPointerDownOutside?: (event: PointerEvent) => void`

**`<Popover.Arrow>`** - Arrow pointing to trigger

Props:
- `width?: number` - Arrow width (default: 10)
- `height?: number` - Arrow height (default: 5)

**`<Popover.Close>`** - Closes the popover

#### Advanced: Tooltip Behavior

```typescript
import { defineComponent, signal } from 'aether';
import { Popover } from 'aether/primitives';

export const TooltipBehaviorPopover = defineComponent(() => {
  const delayOpen = 700; // ms
  const delayClose = 300;
  const isOpen = signal(false);

  const handleMouseEnter = () => {
    setTimeout(() => isOpen(true), delayOpen);
  };

  const handleMouseLeave = () => {
    setTimeout(() => isOpen(false), delayClose);
  };

  return () => (
    <Popover bind:open={isOpen}>
      <Popover.Trigger
        on:mouseenter={handleMouseEnter}
        on:mouseleave={handleMouseLeave}
      >
        Hover me
      </Popover.Trigger>

      <Popover.Content
        side="top"
        onPointerDownOutside={(e) => e.preventDefault()} {/* Don't close on outside click */}
      >
        Tooltip content
      </Popover.Content>
    </Popover>
  );
});
```

---

### Dropdown Menu

A menu of actions or links triggered by a button.

#### Features

- Keyboard navigation (arrows, Home, End)
- Typeahead search
- Sub-menus (nested)
- Checkboxes and radio items
- Separators and labels
- Disabled items
- Custom trigger

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { DropdownMenu } from 'aether/primitives';

export const ActionsDropdown = defineComponent(() => {
  const handleAction = (action: string) => {
    console.log('Action:', action);
  };

  return () => (
    <DropdownMenu>
      <DropdownMenu.Trigger class="btn">
        Actions
        <ChevronDownIcon />
      </DropdownMenu.Trigger>

      <DropdownMenu.Content class="dropdown-content">
        <DropdownMenu.Item
          class="dropdown-item"
          on:select={() => handleAction('new')}
        >
          <PlusIcon />
          New File
          <DropdownMenu.Shortcut>⌘N</DropdownMenu.Shortcut>
        </DropdownMenu.Item>

        <DropdownMenu.Item
          class="dropdown-item"
          on:select={() => handleAction('open')}
        >
          <FolderIcon />
          Open...
          <DropdownMenu.Shortcut>⌘O</DropdownMenu.Shortcut>
        </DropdownMenu.Item>

        <DropdownMenu.Separator class="dropdown-separator" />

        <DropdownMenu.Item
          class="dropdown-item"
          disabled
        >
          <SaveIcon />
          Save (disabled)
        </DropdownMenu.Item>

        <DropdownMenu.Separator />

        <DropdownMenu.Item
          class="dropdown-item destructive"
          on:select={() => handleAction('delete')}
        >
          <TrashIcon />
          Delete
          <DropdownMenu.Shortcut>⌘⌫</DropdownMenu.Shortcut>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
});
```

#### Sub-menus

```html
<DropdownMenu>
  <DropdownMenu.Trigger>Menu</DropdownMenu.Trigger>

  <DropdownMenu.Content>
    <DropdownMenu.Item>New File</DropdownMenu.Item>

    <!-- Sub-menu -->
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger class="dropdown-item">
        Open Recent
        <ChevronRightIcon class="ml-auto" />
      </DropdownMenu.SubTrigger>

      <DropdownMenu.SubContent class="dropdown-content">
        <DropdownMenu.Item>project-1.ts</DropdownMenu.Item>
        <DropdownMenu.Item>project-2.ts</DropdownMenu.Item>
        <DropdownMenu.Item>project-3.ts</DropdownMenu.Item>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>

    <DropdownMenu.Separator />

    <DropdownMenu.Item>Settings</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu>
```

#### Checkbox Items

```typescript
import { defineComponent, signal } from 'aether';
import { DropdownMenu } from 'aether/primitives';

export const ViewDropdown = defineComponent(() => {
  const showBookmarks = signal(true);
  const showHistory = signal(false);

  return () => (
    <DropdownMenu>
      <DropdownMenu.Trigger>View</DropdownMenu.Trigger>

      <DropdownMenu.Content>
        <DropdownMenu.Label class="dropdown-label">
          Panels
        </DropdownMenu.Label>

        <DropdownMenu.CheckboxItem
          class="dropdown-item"
          bind:checked={showBookmarks}
        >
          <DropdownMenu.ItemIndicator class="dropdown-indicator">
            <CheckIcon />
          </DropdownMenu.ItemIndicator>
          Show Bookmarks
        </DropdownMenu.CheckboxItem>

        <DropdownMenu.CheckboxItem
          class="dropdown-item"
          bind:checked={showHistory}
        >
          <DropdownMenu.ItemIndicator class="dropdown-indicator">
            <CheckIcon />
          </DropdownMenu.ItemIndicator>
          Show History
        </DropdownMenu.CheckboxItem>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
});
```

#### Radio Items

```typescript
import { defineComponent, signal } from 'aether';
import { DropdownMenu } from 'aether/primitives';

export const ThemeDropdown = defineComponent(() => {
  const theme = signal<'light' | 'dark' | 'system'>('system');

  return () => (
    <DropdownMenu>
      <DropdownMenu.Trigger>Theme</DropdownMenu.Trigger>

      <DropdownMenu.Content>
        <DropdownMenu.Label>Appearance</DropdownMenu.Label>

        <DropdownMenu.RadioGroup bind:value={theme}>
          <DropdownMenu.RadioItem value="light" class="dropdown-item">
            <DropdownMenu.ItemIndicator class="dropdown-indicator">
              <DotIcon />
            </DropdownMenu.ItemIndicator>
            Light
          </DropdownMenu.RadioItem>

          <DropdownMenu.RadioItem value="dark" class="dropdown-item">
            <DropdownMenu.ItemIndicator class="dropdown-indicator">
              <DotIcon />
            </DropdownMenu.ItemIndicator>
            Dark
          </DropdownMenu.RadioItem>

          <DropdownMenu.RadioItem value="system" class="dropdown-item">
            <DropdownMenu.ItemIndicator class="dropdown-indicator">
              <DotIcon />
            </DropdownMenu.ItemIndicator>
            System
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
});
```

#### Styling Example

```css
.dropdown-content {
  min-width: 220px;
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-1);

  z-index: var(--z-dropdown);

  animation: slideDown 150ms ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);

  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-sm);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  user-select: none;
  outline: none;

  transition: background-color var(--transition-fast);
}

.dropdown-item:hover,
.dropdown-item:focus {
  background: var(--color-background-secondary);
}

.dropdown-item[data-disabled] {
  color: var(--color-text-disabled);
  pointer-events: none;
}

.dropdown-item.destructive {
  color: var(--color-error);
}

.dropdown-separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--spacing-1) 0;
}

.dropdown-label {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.dropdown-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
```

#### API Reference

**`<DropdownMenu>`** - Root component

**`<DropdownMenu.Trigger>`** - Opens the menu

**`<DropdownMenu.Content>`** - Menu content

Props: Same as Popover.Content (positioning, collision detection, etc.)

**`<DropdownMenu.Item>`** - Menu item

Props:
- `disabled?: boolean` - Disable the item
- `onSelect?: (event: Event) => void` - Called when item is selected
- `textValue?: string` - For typeahead search

**`<DropdownMenu.CheckboxItem>`** - Checkbox menu item

Props:
- `checked?: Signal<boolean>` - Controlled checked state
- `onCheckedChange?: (checked: boolean) => void`
- `disabled?: boolean`

**`<DropdownMenu.RadioGroup>`** - Radio group container

Props:
- `value?: Signal<string>` - Controlled selected value
- `onValueChange?: (value: string) => void`

**`<DropdownMenu.RadioItem>`** - Radio menu item

Props:
- `value: string` - Item value
- `disabled?: boolean`

**`<DropdownMenu.Sub>`** - Sub-menu container

**`<DropdownMenu.SubTrigger>`** - Opens sub-menu

**`<DropdownMenu.SubContent>`** - Sub-menu content

**`<DropdownMenu.Separator>`** - Visual separator

**`<DropdownMenu.Label>`** - Non-interactive label

**`<DropdownMenu.ItemIndicator>`** - Shows only when checkbox/radio is checked

**`<DropdownMenu.Shortcut>`** - Keyboard shortcut hint (non-functional)

#### Advanced: Context Menu

```typescript
import { defineComponent } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const BasicContextMenu = defineComponent(() => {
  return () => (
    <ContextMenu>
      <ContextMenu.Trigger class="context-area">
        Right click here
      </ContextMenu.Trigger>

      <ContextMenu.Content class="dropdown-content">
        <ContextMenu.Item>Cut</ContextMenu.Item>
        <ContextMenu.Item>Copy</ContextMenu.Item>
        <ContextMenu.Item>Paste</ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
});
```

Context Menu uses the same API as Dropdown Menu but triggers on right-click.

---

### Select

A form control for selecting a value from a list of options.

#### Features

- Keyboard navigation
- Typeahead search
- Multi-select support
- Grouping options
- Custom option rendering
- Virtualization for large lists
- Form integration

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Select } from 'aether/primitives';

export const FruitSelect = defineComponent(() => {
  const selectedFruit = signal('apple');

  const fruits = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'orange', label: 'Orange' },
    { value: 'grape', label: 'Grape' }
  ];

  return () => (
    <Select bind:value={selectedFruit}>
      <Select.Trigger class="select-trigger">
        <Select.Value placeholder="Select a fruit..." />
        <Select.Icon>
          <ChevronDownIcon />
        </Select.Icon>
      </Select.Trigger>

      <Select.Content class="select-content">
        <Select.Viewport>
          {fruits.map(fruit => (
            <Select.Item value={fruit.value} class="select-item">
              <Select.ItemText>{fruit.label}</Select.ItemText>
              <Select.ItemIndicator class="select-indicator">
                <CheckIcon />
              </Select.ItemIndicator>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select>
  );
});
```

#### With Groups

```html
<Select bind:value={selectedAnimal}>
  <Select.Trigger class="select-trigger">
    <Select.Value placeholder="Select an animal..." />
  </Select.Trigger>

  <Select.Content>
    <Select.Viewport>
      <Select.Group>
        <Select.Label class="select-label">Mammals</Select.Label>
        <Select.Item value="dog">Dog</Select.Item>
        <Select.Item value="cat">Cat</Select.Item>
        <Select.Item value="elephant">Elephant</Select.Item>
      </Select.Group>

      <Select.Separator class="select-separator" />

      <Select.Group>
        <Select.Label class="select-label">Birds</Select.Label>
        <Select.Item value="eagle">Eagle</Select.Item>
        <Select.Item value="parrot">Parrot</Select.Item>
        <Select.Item value="penguin">Penguin</Select.Item>
      </Select.Group>
    </Select.Viewport>
  </Select.Content>
</Select>
```

#### Custom Option Rendering

```typescript
import { defineComponent, signal } from 'aether';
import { Select } from 'aether/primitives';

interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

export const UserSelect = defineComponent(() => {
  const selectedUser = signal<string | null>(null);
  const users: User[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com', avatar: '/alice.jpg' },
    { id: '2', name: 'Bob', email: 'bob@example.com', avatar: '/bob.jpg' }
  ];

  return () => (
    <Select bind:value={selectedUser}>
      <Select.Trigger class="select-trigger">
        <Select.Value placeholder="Select user...">
          {selectedUser() && users.find(u => u.id === selectedUser())?.name}
        </Select.Value>
      </Select.Trigger>

      <Select.Content>
        <Select.Viewport>
          {users.map(user => (
            <Select.Item value={user.id} class="select-item-user">
              <img src={user.avatar} alt="" class="avatar" />
              <div class="user-info">
                <div class="user-name">{user.name}</div>
                <div class="user-email">{user.email}</div>
              </div>
              <Select.ItemIndicator class="select-indicator">
                <CheckIcon />
              </Select.ItemIndicator>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select>
  );
});
```

#### Styling Example

```css
.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-2);

  width: 100%;
  padding: var(--spacing-2) var(--spacing-3);

  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  outline: none;

  transition: border-color var(--transition-fast);
}

.select-trigger:hover {
  border-color: var(--color-border-hover);
}

.select-trigger:focus {
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 3px var(--color-primary-100);
}

.select-trigger[data-placeholder] {
  color: var(--color-text-placeholder);
}

.select-content {
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);

  max-height: 300px;
  overflow: auto;

  z-index: var(--z-dropdown);

  animation: slideDown 150ms ease-out;
}

.select-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);

  padding: var(--spacing-2) var(--spacing-3);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  user-select: none;
  outline: none;

  transition: background-color var(--transition-fast);
}

.select-item:hover,
.select-item:focus,
.select-item[data-highlighted] {
  background: var(--color-background-secondary);
}

.select-item[data-disabled] {
  color: var(--color-text-disabled);
  pointer-events: none;
}

.select-indicator {
  margin-left: auto;
}

.select-label {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.select-separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--spacing-1) 0;
}
```

#### API Reference

**`<Select>`** - Root component

Props:
- `value?: Signal<string>` - Controlled selected value
- `defaultValue?: string` - Initial value (uncontrolled)
- `onValueChange?: (value: string) => void` - Callback
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial open state
- `onOpenChange?: (open: boolean) => void`
- `disabled?: boolean` - Disable the select
- `required?: boolean` - Mark as required
- `name?: string` - Form field name

**`<Select.Trigger>`** - Opens the dropdown

**`<Select.Value>`** - Displays selected value

Props:
- `placeholder?: string` - Shown when no value selected

**`<Select.Icon>`** - Icon (usually chevron)

**`<Select.Content>`** - Dropdown content

Props: Same as Popover.Content

**`<Select.Viewport>`** - Scrollable viewport

**`<Select.Item>`** - Selectable option

Props:
- `value: string` - Option value
- `disabled?: boolean`
- `textValue?: string` - For typeahead

**`<Select.ItemText>`** - Item label

**`<Select.ItemIndicator>`** - Shows when item is selected

**`<Select.Group>`** - Group options

**`<Select.Label>`** - Group label

**`<Select.Separator>`** - Visual separator

#### Advanced: Multi-Select

```typescript
import { defineComponent, signal } from 'aether';
import { MultiSelect } from 'aether/primitives';

export const TagsMultiSelect = defineComponent(() => {
  const selectedTags = signal<string[]>(['react', 'typescript']);

  const allTags = [
    'react', 'vue', 'angular', 'svelte',
    'typescript', 'javascript', 'python', 'rust'
  ];

  const removeTag = (tag: string) => {
    selectedTags(selectedTags().filter(t => t !== tag));
  };

  return () => (
    <MultiSelect bind:value={selectedTags}>
      <MultiSelect.Trigger class="select-trigger">
        <MultiSelect.Value>
          {selectedTags().length > 0 ? (
            <div class="selected-tags">
              {selectedTags().map(tag => (
                <span class="tag">
                  {tag}
                  <button
                    on:click={(e) => {
                      e.stopPropagation();
                      removeTag(tag);
                    }}
                  >
                    <XIcon />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span class="placeholder">Select tags...</span>
          )}
        </MultiSelect.Value>
      </MultiSelect.Trigger>

      <MultiSelect.Content>
        <MultiSelect.Viewport>
          {allTags.map(tag => (
            <MultiSelect.Item value={tag} class="select-item">
              <MultiSelect.ItemIndicator>
                <CheckIcon />
              </MultiSelect.ItemIndicator>
              <MultiSelect.ItemText>{tag}</MultiSelect.ItemText>
            </MultiSelect.Item>
          ))}
        </MultiSelect.Viewport>
      </MultiSelect.Content>
    </MultiSelect>
  );
});
```

---

### Combobox

A searchable select with autocomplete.

#### Features

- Text input with dropdown
- Filtering/autocomplete
- Keyboard navigation
- Custom filtering logic
- Async data loading
- Virtualization

#### Basic Usage

```typescript
import { defineComponent, signal, computed } from 'aether';
import { Combobox } from 'aether/primitives';

export const FrameworkCombobox = defineComponent(() => {
  const frameworks = [
    { value: 'react', label: 'React' },
    { value: 'vue', label: 'Vue' },
    { value: 'angular', label: 'Angular' },
    { value: 'svelte', label: 'Svelte' },
    { value: 'solid', label: 'SolidJS' }
  ];

  const selectedFramework = signal<string | null>(null);
  const searchQuery = signal('');

  // Filter options based on search
  const filteredFrameworks = computed(() => {
    const query = searchQuery().toLowerCase();
    if (!query) return frameworks;
    return frameworks.filter(f =>
      f.label.toLowerCase().includes(query)
    );
  });

  return () => (
    <Combobox bind:value={selectedFramework}>
      <Combobox.Trigger class="combobox-trigger">
        <Combobox.Input
          class="combobox-input"
          placeholder="Search framework..."
          bind:value={searchQuery}
        />
        <Combobox.Icon>
          <ChevronDownIcon />
        </Combobox.Icon>
      </Combobox.Trigger>

      <Combobox.Content class="combobox-content">
        <Combobox.Viewport>
          {filteredFrameworks().length > 0 ? (
            <>
              {filteredFrameworks().map(framework => (
                <Combobox.Item value={framework.value} class="combobox-item">
                  <CheckIcon class="combobox-check" />
                  {framework.label}
                </Combobox.Item>
              ))}
            </>
          ) : (
            <Combobox.Empty class="combobox-empty">
              No framework found
            </Combobox.Empty>
          )}
        </Combobox.Viewport>
      </Combobox.Content>
    </Combobox>
  );
});
```

#### With Async Data

```typescript
import { defineComponent, signal, effect } from 'aether';
import { Combobox } from 'aether/primitives';
import { debounce } from 'aether/utils';

interface User {
  id: string;
  name: string;
  email: string;
}

export const UserSearchCombobox = defineComponent(() => {
  const selectedUser = signal<string | null>(null);
  const searchQuery = signal('');
  const users = signal<User[]>([]);
  const isLoading = signal(false);

  // Debounced search
  const debouncedSearch = debounce(async (query: string) => {
    if (!query) {
      users([]);
      return;
    }

    isLoading(true);
    try {
      const response = await fetch(`/api/users/search?q=${query}`);
      const data = await response.json();
      users(data);
    } finally {
      isLoading(false);
    }
  }, 300);

  // Trigger search on query change
  effect(() => {
    debouncedSearch(searchQuery());
  });

  return () => (
    <Combobox bind:value={selectedUser}>
      <Combobox.Trigger class="combobox-trigger">
        <Combobox.Input
          placeholder="Search users..."
          bind:value={searchQuery}
        />
        <Combobox.Icon>
          {isLoading() ? <SpinnerIcon /> : <SearchIcon />}
        </Combobox.Icon>
      </Combobox.Trigger>

      <Combobox.Content>
        <Combobox.Viewport>
          {isLoading() ? (
            <div class="combobox-loading">Loading...</div>
          ) : users().length > 0 ? (
            <>
              {users().map(user => (
                <Combobox.Item value={user.id} class="combobox-item">
                  <div class="user-result">
                    <div class="user-name">{user.name}</div>
                    <div class="user-email">{user.email}</div>
                  </div>
                </Combobox.Item>
              ))}
            </>
          ) : searchQuery() ? (
            <Combobox.Empty>No users found</Combobox.Empty>
          ) : null}
        </Combobox.Viewport>
      </Combobox.Content>
    </Combobox>
  );
});
```

#### API Reference

**`<Combobox>`** - Root component

Props: Same as Select

**`<Combobox.Trigger>`** - Trigger container

**`<Combobox.Input>`** - Text input for search

Props:
- `value?: Signal<string>` - Search query
- `placeholder?: string`
- Standard input props

**`<Combobox.Icon>`** - Icon (search/chevron)

**`<Combobox.Content>`** - Dropdown content

**`<Combobox.Viewport>`** - Scrollable viewport

**`<Combobox.Item>`** - Selectable option

**`<Combobox.Empty>`** - Shown when no results

---

### Tabs

A set of layered sections of content (tab panels) displayed one at a time.

#### Features

- Keyboard navigation (Arrow keys, Home, End)
- Automatic/manual activation
- Horizontal/vertical orientation
- Disabled tabs
- Dynamic tabs
- URL-synchronized tabs

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Tabs } from 'aether/primitives';

export const SettingsTabs = defineComponent(() => {
  const activeTab = signal('account');

  return () => (
    <Tabs bind:value={activeTab} class="tabs-root">
      <Tabs.List class="tabs-list">
        <Tabs.Trigger value="account" class="tabs-trigger">
          Account
        </Tabs.Trigger>
        <Tabs.Trigger value="password" class="tabs-trigger">
          Password
        </Tabs.Trigger>
        <Tabs.Trigger value="notifications" class="tabs-trigger">
          Notifications
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="account" class="tabs-content">
        <h3>Account Settings</h3>
        <form>
          <label>
            Name
            <input type="text" value="John Doe" />
          </label>
          <label>
            Email
            <input type="email" value="john@example.com" />
          </label>
        </form>
      </Tabs.Content>

      <Tabs.Content value="password" class="tabs-content">
        <h3>Change Password</h3>
        <form>
          <label>
            Current Password
            <input type="password" />
          </label>
          <label>
            New Password
            <input type="password" />
          </label>
        </form>
      </Tabs.Content>

      <Tabs.Content value="notifications" class="tabs-content">
        <h3>Notification Settings</h3>
        <label>
          <input type="checkbox" />
          Email notifications
        </label>
        <label>
          <input type="checkbox" />
          Push notifications
        </label>
      </Tabs.Content>
    </Tabs>
  );
});
```

#### Vertical Tabs

```html
<Tabs
  bind:value={activeTab}
  orientation="vertical"
  class="tabs-root tabs-vertical"
>
  <Tabs.List class="tabs-list-vertical">
    <Tabs.Trigger value="general">General</Tabs.Trigger>
    <Tabs.Trigger value="security">Security</Tabs.Trigger>
    <Tabs.Trigger value="billing">Billing</Tabs.Trigger>
  </Tabs.List>

  <Tabs.Content value="general">General settings</Tabs.Content>
  <Tabs.Content value="security">Security settings</Tabs.Content>
  <Tabs.Content value="billing">Billing settings</Tabs.Content>
</Tabs>
```

#### Styling Example

```css
.tabs-root {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.tabs-list {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  gap: var(--spacing-1);
}

.tabs-trigger {
  padding: var(--spacing-3) var(--spacing-4);

  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;

  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);

  cursor: pointer;
  outline: none;

  transition: all var(--transition-fast);
}

.tabs-trigger:hover {
  color: var(--color-text-primary);
  background: var(--color-background-secondary);
}

.tabs-trigger[data-state="active"] {
  color: var(--color-primary-500);
  border-bottom-color: var(--color-primary-500);
}

.tabs-trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.tabs-trigger[data-disabled] {
  color: var(--color-text-disabled);
  pointer-events: none;
}

.tabs-content {
  padding: var(--spacing-4);

  animation: fadeIn 200ms;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Vertical variant */
.tabs-vertical {
  flex-direction: row;
}

.tabs-list-vertical {
  flex-direction: column;
  border-bottom: none;
  border-right: 1px solid var(--color-border);
}

.tabs-list-vertical .tabs-trigger {
  border-bottom: none;
  border-right: 2px solid transparent;
  justify-content: flex-start;
}

.tabs-list-vertical .tabs-trigger[data-state="active"] {
  border-right-color: var(--color-primary-500);
}
```

#### API Reference

**`<Tabs>`** - Root component

Props:
- `value?: Signal<string>` - Controlled active tab
- `defaultValue?: string` - Initial active tab
- `onValueChange?: (value: string) => void`
- `orientation?: 'horizontal' | 'vertical'` - Layout orientation (default: 'horizontal')
- `activationMode?: 'automatic' | 'manual'` - Automatic activates on focus, manual requires Enter/Space (default: 'automatic')

**`<Tabs.List>`** - Container for triggers

**`<Tabs.Trigger>`** - Tab button

Props:
- `value: string` - Tab identifier
- `disabled?: boolean`

**`<Tabs.Content>`** - Tab panel

Props:
- `value: string` - Tab identifier
- `forceMount?: boolean` - Keep mounted when inactive (for animations)

#### Advanced: URL-Synchronized Tabs

```typescript
import { defineComponent, signal, effect } from 'aether';
import { Tabs } from 'aether/primitives';
import { useRouter } from 'aether/router';

export const URLSyncedTabs = defineComponent(() => {
  const router = useRouter();

  // Sync with URL query parameter
  const activeTab = signal(router.query.get('tab') || 'account');

  // Update URL when tab changes
  effect(() => {
    router.push({ query: { tab: activeTab() } });
  });

  return () => (
    <Tabs bind:value={activeTab}>
      {/* ... */}
    </Tabs>
  );
});
```

---

### Accordion

Vertically stacked set of interactive headings that expand/collapse content panels.

#### Features

- Single or multiple items open
- Keyboard navigation
- Smooth animations
- Disabled items
- Controlled/uncontrolled

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Accordion } from 'aether/primitives';

export const FAQAccordion = defineComponent(() => {
  return () => (
    <Accordion type="single" collapsible class="accordion-root">
      <Accordion.Item value="item-1" class="accordion-item">
        <Accordion.Trigger class="accordion-trigger">
          What is Aether?
          <ChevronDownIcon class="accordion-chevron" />
        </Accordion.Trigger>
        <Accordion.Content class="accordion-content">
          Aether is a minimalist frontend framework that combines the best
          ideas from React, Vue, Svelte, and SolidJS into a cohesive,
          developer-friendly package.
        </Accordion.Content>
      </Accordion.Item>

      <Accordion.Item value="item-2" class="accordion-item">
        <Accordion.Trigger class="accordion-trigger">
          How does reactivity work?
          <ChevronDownIcon class="accordion-chevron" />
        </Accordion.Trigger>
        <Accordion.Content class="accordion-content">
          Aether uses fine-grained reactivity based on signals, similar to
          SolidJS. This allows surgical DOM updates without a Virtual DOM.
        </Accordion.Content>
      </Accordion.Item>

      <Accordion.Item value="item-3" class="accordion-item">
        <Accordion.Trigger class="accordion-trigger">
          Is it production ready?
          <ChevronDownIcon class="accordion-chevron" />
        </Accordion.Trigger>
        <Accordion.Content class="accordion-content">
          Yes! Aether is used in production by several companies and has
          excellent test coverage.
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
});
```

#### Multiple Items Open

```typescript
import { defineComponent, signal } from 'aether';
import { Accordion } from 'aether/primitives';

export const MultiAccordion = defineComponent(() => {
  const openItems = signal(['item-1', 'item-3']);

  return () => (
    <Accordion type="multiple" bind:value={openItems}>
      <Accordion.Item value="item-1">
        <Accordion.Trigger>Item 1</Accordion.Trigger>
        <Accordion.Content>Content 1</Accordion.Content>
      </Accordion.Item>

      <Accordion.Item value="item-2">
        <Accordion.Trigger>Item 2</Accordion.Trigger>
        <Accordion.Content>Content 2</Accordion.Content>
      </Accordion.Item>

      <Accordion.Item value="item-3">
        <Accordion.Trigger>Item 3</Accordion.Trigger>
        <Accordion.Content>Content 3</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
});
```

#### Styling Example

```css
.accordion-root {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.accordion-item {
  border-bottom: 1px solid var(--color-border);
}

.accordion-item:last-child {
  border-bottom: none;
}

.accordion-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;

  width: 100%;
  padding: var(--spacing-4);

  background: transparent;
  border: none;

  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  text-align: left;

  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.accordion-trigger:hover {
  background: var(--color-background-secondary);
}

.accordion-trigger:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-primary-500);
}

.accordion-trigger[data-disabled] {
  color: var(--color-text-disabled);
  pointer-events: none;
}

.accordion-chevron {
  transition: transform var(--transition-normal);
}

.accordion-trigger[data-state="open"] .accordion-chevron {
  transform: rotate(180deg);
}

.accordion-content {
  overflow: hidden;

  /* Animation */
  data-state: closed;
}

.accordion-content[data-state="open"] {
  animation: slideDown 300ms cubic-bezier(0.87, 0, 0.13, 1);
}

.accordion-content[data-state="closed"] {
  animation: slideUp 300ms cubic-bezier(0.87, 0, 0.13, 1);
}

@keyframes slideDown {
  from {
    height: 0;
    opacity: 0;
  }
  to {
    height: var(--radix-accordion-content-height);
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    height: var(--radix-accordion-content-height);
    opacity: 1;
  }
  to {
    height: 0;
    opacity: 0;
  }
}

.accordion-content > div {
  padding: var(--spacing-4);
  padding-top: 0;
}
```

#### API Reference

**`<Accordion>`** - Root component

Props:
- `type: 'single' | 'multiple'` - Single or multiple items open
- `value?: Signal<string> | Signal<string[]>` - Controlled open items
- `defaultValue?: string | string[]` - Initial open items
- `onValueChange?: (value: string | string[]) => void`
- `collapsible?: boolean` - Allow all items to close (type="single" only, default: false)
- `disabled?: boolean` - Disable all items
- `orientation?: 'horizontal' | 'vertical'` - For keyboard navigation (default: 'vertical')

**`<Accordion.Item>`** - Accordion item

Props:
- `value: string` - Item identifier
- `disabled?: boolean`

**`<Accordion.Trigger>`** - Expand/collapse button

**`<Accordion.Content>`** - Expandable content

Props:
- `forceMount?: boolean` - Keep mounted when closed (for animations)

---

### Radio Group

A set of radio buttons where only one can be selected.

#### Features

- Keyboard navigation (Arrow keys)
- Form integration
- Disabled options
- Required validation
- Custom styling

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { RadioGroup } from 'aether/primitives';

export const PlanSelector = defineComponent(() => {
  const selectedPlan = signal('pro');

  return () => (
    <RadioGroup bind:value={selectedPlan} class="radio-group">
      <RadioGroup.Item value="free" id="free" class="radio-item">
        <RadioGroup.Indicator class="radio-indicator" />
      </RadioGroup.Item>
      <label for="free" class="radio-label">
        <div class="radio-label-title">Free</div>
        <div class="radio-label-description">
          For personal projects
        </div>
      </label>

      <RadioGroup.Item value="pro" id="pro" class="radio-item">
        <RadioGroup.Indicator class="radio-indicator" />
      </RadioGroup.Item>
      <label for="pro" class="radio-label">
        <div class="radio-label-title">Pro</div>
        <div class="radio-label-description">
          For professional use
        </div>
      </label>

      <RadioGroup.Item value="enterprise" id="enterprise" class="radio-item">
        <RadioGroup.Indicator class="radio-indicator" />
      </RadioGroup.Item>
      <label for="enterprise" class="radio-label">
        <div class="radio-label-title">Enterprise</div>
        <div class="radio-label-description">
          For large organizations
        </div>
      </label>
    </RadioGroup>
  );
});
```

#### Styling Example

```css
.radio-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.radio-item {
  width: 20px;
  height: 20px;

  background: var(--color-background-primary);
  border: 2px solid var(--color-border);
  border-radius: 50%;

  cursor: pointer;
  outline: none;

  transition: border-color var(--transition-fast);
}

.radio-item:hover {
  border-color: var(--color-primary-500);
}

.radio-item:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.radio-item[data-state="checked"] {
  border-color: var(--color-primary-500);
}

.radio-item[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.radio-indicator {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 100%;
  height: 100%;
}

.radio-indicator::after {
  content: '';
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary-500);
}

.radio-label {
  cursor: pointer;
}

.radio-label-title {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.radio-label-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
```

#### API Reference

**`<RadioGroup>`** - Root component

Props:
- `value?: Signal<string>` - Controlled selected value
- `defaultValue?: string` - Initial value
- `onValueChange?: (value: string) => void`
- `disabled?: boolean` - Disable all items
- `required?: boolean` - Required for forms
- `name?: string` - Form field name
- `orientation?: 'horizontal' | 'vertical'` - For keyboard navigation (default: 'vertical')
- `loop?: boolean` - Loop focus with arrow keys (default: true)

**`<RadioGroup.Item>`** - Radio button

Props:
- `value: string` - Item value
- `disabled?: boolean`
- `id?: string` - For label association

**`<RadioGroup.Indicator>`** - Checked indicator (only renders when checked)

---

### Checkbox Group

A set of checkboxes for multi-selection.

#### Features

- Individual checkboxes
- Select all functionality
- Indeterminate state
- Form integration
- Disabled options

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Checkbox } from 'aether/primitives';

export const BasicCheckboxes = defineComponent(() => {
  const agreedToTerms = signal(false);
  const subscribedToNewsletter = signal(true);

  return () => (
    <div class="checkbox-group">
      <div class="checkbox-wrapper">
        <Checkbox bind:checked={agreedToTerms} id="terms" class="checkbox">
          <Checkbox.Indicator class="checkbox-indicator">
            <CheckIcon />
          </Checkbox.Indicator>
        </Checkbox>
        <label for="terms" class="checkbox-label">
          I agree to the terms and conditions
        </label>
      </div>

      <div class="checkbox-wrapper">
        <Checkbox
          bind:checked={subscribedToNewsletter}
          id="newsletter"
          class="checkbox"
        >
          <Checkbox.Indicator class="checkbox-indicator">
            <CheckIcon />
          </Checkbox.Indicator>
        </Checkbox>
        <label for="newsletter" class="checkbox-label">
          Subscribe to newsletter
        </label>
      </div>
    </div>
  );
});
```

#### Select All with Indeterminate

```typescript
import { defineComponent, signal, computed } from 'aether';
import { Checkbox } from 'aether/primitives';

export const SelectAllCheckboxes = defineComponent(() => {
  const items = ['item1', 'item2', 'item3'];
  const selectedItems = signal<string[]>(['item1']);

  // Select all checkbox state
  const allSelected = computed(() => selectedItems().length === items.length);
  const someSelected = computed(() =>
    selectedItems().length > 0 && selectedItems().length < items.length
  );
  const selectAllState = computed<boolean | 'indeterminate'>(() => {
    if (allSelected()) return true;
    if (someSelected()) return 'indeterminate';
    return false;
  });

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      selectedItems(items);
    } else {
      selectedItems([]);
    }
  };

  const handleItemChange = (item: string, checked: boolean) => {
    if (checked) {
      selectedItems([...selectedItems(), item]);
    } else {
      selectedItems(selectedItems().filter(i => i !== item));
    }
  };

  return () => (
    <div class="checkbox-group">
      {/* Select all */}
      <div class="checkbox-wrapper">
        <Checkbox
          checked={selectAllState()}
          onCheckedChange={handleSelectAll}
          id="select-all"
          class="checkbox"
        >
          <Checkbox.Indicator class="checkbox-indicator">
            {selectAllState() === 'indeterminate' ? <MinusIcon /> : <CheckIcon />}
          </Checkbox.Indicator>
        </Checkbox>
        <label for="select-all" class="checkbox-label">
          <strong>Select All</strong>
        </label>
      </div>

      {/* Individual items */}
      {items.map(item => (
        <div class="checkbox-wrapper checkbox-wrapper-indent">
          <Checkbox
            checked={selectedItems().includes(item)}
            onCheckedChange={(checked) => handleItemChange(item, checked)}
            id={item}
            class="checkbox"
          >
            <Checkbox.Indicator class="checkbox-indicator">
              <CheckIcon />
            </Checkbox.Indicator>
          </Checkbox>
          <label for={item} class="checkbox-label">
            {item}
          </label>
        </div>
      ))}
    </div>
  );
});
```

#### Styling Example

```css
.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.checkbox-wrapper-indent {
  padding-left: var(--spacing-4);
}

.checkbox {
  width: 20px;
  height: 20px;

  display: flex;
  align-items: center;
  justify-content: center;

  background: var(--color-background-primary);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);

  cursor: pointer;
  outline: none;

  transition: all var(--transition-fast);
}

.checkbox:hover {
  border-color: var(--color-primary-500);
}

.checkbox:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.checkbox[data-state="checked"],
.checkbox[data-state="indeterminate"] {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
}

.checkbox[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.checkbox-indicator {
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
}

.checkbox-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  user-select: none;
}
```

#### API Reference

**`<Checkbox>`** - Checkbox component

Props:
- `checked?: Signal<boolean | 'indeterminate'>` - Controlled checked state
- `defaultChecked?: boolean` - Initial state
- `onCheckedChange?: (checked: boolean | 'indeterminate') => void`
- `disabled?: boolean`
- `required?: boolean`
- `name?: string` - Form field name
- `value?: string` - Form field value

**`<Checkbox.Indicator>`** - Checked/indeterminate indicator

---

### Slider

An input for selecting a value from a range.

#### Features

- Single and range sliders
- Keyboard navigation (Arrow keys, Page Up/Down, Home/End)
- Touch support
- Vertical/horizontal orientation
- Step increments
- Min/max values
- Disabled state

#### Basic Usage (Single Value)

```typescript
import { defineComponent, signal } from 'aether';
import { Slider } from 'aether/primitives';

export const VolumeSlider = defineComponent(() => {
  const volume = signal(50);

  return () => (
    <div class="slider-container">
      <label for="volume">Volume: {volume()}%</label>
      <Slider
        bind:value={volume}
        min={0}
        max={100}
        step={1}
        id="volume"
        class="slider-root"
      >
        <Slider.Track class="slider-track">
          <Slider.Range class="slider-range" />
        </Slider.Track>
        <Slider.Thumb class="slider-thumb" />
      </Slider>
    </div>
  );
});
```

#### Range Slider (Two Values)

```typescript
import { defineComponent, signal } from 'aether';
import { Slider } from 'aether/primitives';

export const PriceRangeSlider = defineComponent(() => {
  const priceRange = signal([20, 80]);

  return () => (
    <div class="slider-container">
      <label>
        Price Range: ${priceRange()[0]} - ${priceRange()[1]}
      </label>
      <Slider
        bind:value={priceRange}
        min={0}
        max={100}
        step={5}
        class="slider-root"
      >
        <Slider.Track class="slider-track">
          <Slider.Range class="slider-range" />
        </Slider.Track>
        <Slider.Thumb class="slider-thumb" />
        <Slider.Thumb class="slider-thumb" />
      </Slider>
    </div>
  );
});
```

#### Styling Example

```css
.slider-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.slider-root {
  position: relative;
  display: flex;
  align-items: center;

  width: 100%;
  height: 20px;

  touch-action: none;
  user-select: none;
}

.slider-track {
  position: relative;
  flex-grow: 1;
  height: 4px;

  background: var(--color-background-secondary);
  border-radius: var(--radius-full);

  overflow: hidden;
}

.slider-range {
  position: absolute;
  height: 100%;

  background: var(--color-primary-500);
  border-radius: var(--radius-full);
}

.slider-thumb {
  display: block;
  width: 20px;
  height: 20px;

  background: white;
  border: 2px solid var(--color-primary-500);
  border-radius: 50%;
  box-shadow: var(--shadow-sm);

  cursor: grab;
  outline: none;

  transition: box-shadow var(--transition-fast);
}

.slider-thumb:hover {
  box-shadow: var(--shadow-md);
}

.slider-thumb:focus-visible {
  box-shadow: 0 0 0 4px var(--color-primary-100);
}

.slider-thumb:active {
  cursor: grabbing;
}

.slider-thumb[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
```

#### API Reference

**`<Slider>`** - Root component

Props:
- `value?: Signal<number | number[]>` - Controlled value(s)
- `defaultValue?: number | number[]` - Initial value(s)
- `onValueChange?: (value: number | number[]) => void`
- `onValueCommit?: (value: number | number[]) => void` - When user releases thumb
- `min?: number` - Minimum value (default: 0)
- `max?: number` - Maximum value (default: 100)
- `step?: number` - Step increment (default: 1)
- `minStepsBetweenThumbs?: number` - For range sliders (default: 0)
- `orientation?: 'horizontal' | 'vertical'` - Orientation (default: 'horizontal')
- `disabled?: boolean`
- `inverted?: boolean` - Invert slider direction

**`<Slider.Track>`** - Track background

**`<Slider.Range>`** - Filled range

**`<Slider.Thumb>`** - Draggable thumb (one per value)

#### Advanced: Custom Value Display

```typescript
import { defineComponent, signal } from 'aether';
import { Slider } from 'aether/primitives';

export const BrightnessSliderWithTooltip = defineComponent(() => {
  const brightness = signal(75);

  return () => (
    <Slider bind:value={brightness} min={0} max={100} step={5}>
      <Slider.Track class="slider-track">
        <Slider.Range class="slider-range" />
      </Slider.Track>
      <Slider.Thumb class="slider-thumb">
        {/* Tooltip on thumb */}
        <div class="slider-tooltip">
          {brightness()}%
        </div>
      </Slider.Thumb>
    </Slider>
  );
});
```

```css
.slider-thumb {
  position: relative;
}

.slider-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);

  padding: var(--spacing-1) var(--spacing-2);

  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);

  font-size: var(--font-size-xs);
  white-space: nowrap;

  pointer-events: none;
}
```

---

### Toggle

A two-state button for binary options.

#### Features

- Pressed/unpressed states
- Keyboard support (Space/Enter)
- Disabled state
- Icon toggles

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Toggle } from 'aether/primitives';

export const TextFormattingToggles = defineComponent(() => {
  const isBold = signal(false);
  const isItalic = signal(false);
  const isUnderline = signal(false);

  return () => (
    <div class="toggle-group">
      <Toggle bind:pressed={isBold} class="toggle" aria-label="Bold">
        <BoldIcon />
      </Toggle>

      <Toggle bind:pressed={isItalic} class="toggle" aria-label="Italic">
        <ItalicIcon />
      </Toggle>

      <Toggle bind:pressed={isUnderline} class="toggle" aria-label="Underline">
        <UnderlineIcon />
      </Toggle>
    </div>
  );
});
```

#### Styling Example

```css
.toggle-group {
  display: inline-flex;
  gap: var(--spacing-1);
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 36px;
  height: 36px;

  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  color: var(--color-text-secondary);

  cursor: pointer;
  outline: none;

  transition: all var(--transition-fast);
}

.toggle:hover {
  background: var(--color-background-secondary);
  color: var(--color-text-primary);
}

.toggle:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.toggle[data-state="on"] {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
  color: white;
}

.toggle[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
```

#### API Reference

**`<Toggle>`** - Toggle button

Props:
- `pressed?: Signal<boolean>` - Controlled pressed state
- `defaultPressed?: boolean` - Initial state
- `onPressedChange?: (pressed: boolean) => void`
- `disabled?: boolean`

---

### Switch

An on/off control (like iOS toggle).

#### Features

- On/off states
- Keyboard support
- Disabled state
- Form integration
- Animated thumb

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Switch } from 'aether/primitives';

export const SettingsSwitches = defineComponent(() => {
  const airplaneMode = signal(false);
  const wifiEnabled = signal(true);

  return () => (
    <div class="switch-group">
      <div class="switch-wrapper">
        <Switch
          bind:checked={airplaneMode}
          id="airplane"
          class="switch"
        >
          <Switch.Thumb class="switch-thumb" />
        </Switch>
        <label for="airplane" class="switch-label">
          Airplane Mode
        </label>
      </div>

      <div class="switch-wrapper">
        <Switch
          bind:checked={wifiEnabled}
          id="wifi"
          class="switch"
        >
          <Switch.Thumb class="switch-thumb" />
        </Switch>
        <label for="wifi" class="switch-label">
          Wi-Fi
        </label>
      </div>
    </div>
  );
});
```

#### Styling Example

```css
.switch-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.switch-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.switch {
  position: relative;
  width: 44px;
  height: 24px;

  background: var(--color-background-secondary);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-full);

  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.switch:hover {
  background: var(--color-background-tertiary);
}

.switch:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.switch[data-state="checked"] {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
}

.switch[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.switch-thumb {
  display: block;
  width: 18px;
  height: 18px;

  background: white;
  border-radius: 50%;
  box-shadow: var(--shadow-sm);

  transition: transform var(--transition-fast);
  will-change: transform;
}

.switch[data-state="checked"] .switch-thumb {
  transform: translateX(20px);
}

.switch-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  user-select: none;
}
```

#### API Reference

**`<Switch>`** - Switch component

Props:
- `checked?: Signal<boolean>` - Controlled checked state
- `defaultChecked?: boolean` - Initial state
- `onCheckedChange?: (checked: boolean) => void`
- `disabled?: boolean`
- `required?: boolean`
- `name?: string` - Form field name
- `value?: string` - Form field value

**`<Switch.Thumb>`** - Moving thumb element

---

### Alert Dialog

A modal dialog that interrupts the user for important information or actions.

#### Features

- Focus trap
- No click-outside to close (must use button)
- Esc key disabled by default (customizable)
- Cancel and action buttons
- Destructive action styling

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { AlertDialog } from 'aether/primitives';

export const DeleteAccountAlert = defineComponent(() => {
  const isOpen = signal(false);

  const handleDelete = () => {
    // Perform destructive action
    console.log('Deleted!');
    isOpen(false);
  };

  return () => (
    <AlertDialog bind:open={isOpen}>
      <AlertDialog.Trigger class="btn btn-destructive">
        Delete Account
      </AlertDialog.Trigger>

      <AlertDialog.Portal>
        <AlertDialog.Overlay class="dialog-overlay" />
        <AlertDialog.Content class="alert-dialog-content">
          <AlertDialog.Title class="alert-dialog-title">
            Are you absolutely sure?
          </AlertDialog.Title>
          <AlertDialog.Description class="alert-dialog-description">
            This action cannot be undone. This will permanently delete your
            account and remove your data from our servers.
          </AlertDialog.Description>

          <div class="alert-dialog-actions">
            <AlertDialog.Cancel class="btn btn-secondary">
              Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
              class="btn btn-destructive"
              on:click={handleDelete}
            >
              Yes, delete my account
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
});
```

#### Styling Example

```css
.alert-dialog-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  width: 90vw;
  max-width: 500px;

  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: var(--spacing-6);

  z-index: calc(var(--z-modal) + 1);

  animation: slideIn 200ms ease-out;
}

.alert-dialog-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-2);
}

.alert-dialog-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-bottom: var(--spacing-6);
}

.alert-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
}
```

#### API Reference

**`<AlertDialog>`** - Root component

Props:
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial state
- `onOpenChange?: (open: boolean) => void`

**`<AlertDialog.Trigger>`** - Opens the dialog

**`<AlertDialog.Portal>`** - Portal for rendering

**`<AlertDialog.Overlay>`** - Backdrop overlay

**`<AlertDialog.Content>`** - Dialog content

Props:
- `onEscapeKeyDown?: (event: KeyboardEvent) => void` - Esc disabled by default
- `onPointerDownOutside?: (event: PointerEvent) => void` - Outside click disabled
- `forceMount?: boolean`

**`<AlertDialog.Title>`** - Dialog title (required)

**`<AlertDialog.Description>`** - Dialog description (required)

**`<AlertDialog.Cancel>`** - Cancel button (closes dialog)

**`<AlertDialog.Action>`** - Action button (does not auto-close, you must close manually)

---

### Sheet

A sliding panel from edge of screen (drawer/slide-over).

#### Features

- Slide from top/right/bottom/left
- Overlay backdrop
- Focus trap
- Esc to close
- Click outside to close
- Responsive sizing

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Sheet } from 'aether/primitives';

export const SettingsSheet = defineComponent(() => {
  const isOpen = signal(false);

  return () => (
    <Sheet bind:open={isOpen}>
      <Sheet.Trigger class="btn">
        Open Sheet
      </Sheet.Trigger>

      <Sheet.Portal>
        <Sheet.Overlay class="sheet-overlay" />
        <Sheet.Content side="right" class="sheet-content">
          <Sheet.Title class="sheet-title">
            Settings
          </Sheet.Title>
          <Sheet.Description class="sheet-description">
            Manage your account settings
          </Sheet.Description>

          <div class="sheet-body">
            <form>
              <label>
                Username
                <input type="text" value="john_doe" />
              </label>
              <label>
                Email
                <input type="email" value="john@example.com" />
              </label>
            </form>
          </div>

          <div class="sheet-footer">
            <Sheet.Close class="btn btn-secondary">
              Cancel
            </Sheet.Close>
            <button class="btn btn-primary">
              Save Changes
            </button>
          </div>

          <Sheet.Close class="sheet-close-icon" aria-label="Close">
            <XIcon />
          </Sheet.Close>
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet>
  );
});
```

#### Styling Example

```css
.sheet-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: var(--z-modal);
  animation: fadeIn 200ms ease-out;
}

.sheet-content {
  position: fixed;
  z-index: calc(var(--z-modal) + 1);

  background: var(--color-background-primary);
  box-shadow: var(--shadow-xl);

  display: flex;
  flex-direction: column;

  padding: var(--spacing-6);
}

/* Side: right (default) */
.sheet-content[data-side="right"] {
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  max-width: 100vw;
  animation: slideInRight 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

/* Side: left */
.sheet-content[data-side="left"] {
  top: 0;
  left: 0;
  bottom: 0;
  width: 400px;
  animation: slideInLeft 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes slideInLeft {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}

/* Side: top */
.sheet-content[data-side="top"] {
  top: 0;
  left: 0;
  right: 0;
  height: 400px;
  animation: slideInTop 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes slideInTop {
  from {
    transform: translateY(-100%);
  }
  to {
    transform: translateY(0);
  }
}

/* Side: bottom */
.sheet-content[data-side="bottom"] {
  bottom: 0;
  left: 0;
  right: 0;
  height: 400px;
  animation: slideInBottom 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

@keyframes slideInBottom {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.sheet-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-2);
}

.sheet-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-4);
}

.sheet-body {
  flex: 1;
  overflow-y: auto;
  margin-bottom: var(--spacing-4);
}

.sheet-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
  padding-top: var(--spacing-4);
  border-top: 1px solid var(--color-border);
}

.sheet-close-icon {
  position: absolute;
  top: var(--spacing-4);
  right: var(--spacing-4);

  display: flex;
  align-items: center;
  justify-content: center;

  width: 32px;
  height: 32px;

  background: transparent;
  border: none;
  border-radius: var(--radius-md);

  color: var(--color-text-secondary);
  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.sheet-close-icon:hover {
  background: var(--color-background-secondary);
}
```

#### API Reference

**`<Sheet>`** - Root component

Props: Same as Dialog

**`<Sheet.Trigger>`** - Opens the sheet

**`<Sheet.Portal>`** - Portal for rendering

**`<Sheet.Overlay>`** - Backdrop overlay

**`<Sheet.Content>`** - Sheet content

Props:
- `side?: 'top' | 'right' | 'bottom' | 'left'` - Which edge to slide from (default: 'right')
- `onEscapeKeyDown?: (event: KeyboardEvent) => void`
- `onPointerDownOutside?: (event: PointerEvent) => void`
- `forceMount?: boolean`

**`<Sheet.Title>`** - Sheet title (required)

**`<Sheet.Description>`** - Sheet description (required)

**`<Sheet.Close>`** - Closes the sheet

---

### Command Palette

A searchable command menu for quick actions (like VS Code's command palette).

#### Features

- Fuzzy search
- Keyboard shortcuts display
- Command groups
- Recent commands
- Custom filtering and ranking
- Icons and descriptions

#### Basic Usage

```typescript
import { defineComponent, signal, effect } from 'aether';
import { CommandPalette } from 'aether/primitives';

export const BasicCommandPalette = defineComponent(() => {
  const isOpen = signal(false);
  const searchQuery = signal('');

  // Listen for Cmd+K / Ctrl+K
  effect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        isOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return () => (
    <CommandPalette bind:open={isOpen}>
      <CommandPalette.Dialog>
        <CommandPalette.Input
          placeholder="Type a command or search..."
          bind:value={searchQuery}
          class="command-input"
        />

        <CommandPalette.List class="command-list">
          <CommandPalette.Empty class="command-empty">
            No results found
          </CommandPalette.Empty>

          <CommandPalette.Group heading="Suggestions" class="command-group">
            <CommandPalette.Item
              value="new-file"
              onSelect={() => createNewFile()}
              class="command-item"
            >
              <FileIcon />
              <span>New File</span>
              <CommandPalette.Shortcut class="command-shortcut">
                ⌘N
              </CommandPalette.Shortcut>
            </CommandPalette.Item>

            <CommandPalette.Item
              value="open-file"
              onSelect={() => openFile()}
              class="command-item"
            >
              <FolderIcon />
              <span>Open File</span>
              <CommandPalette.Shortcut>⌘O</CommandPalette.Shortcut>
            </CommandPalette.Item>

            <CommandPalette.Item
              value="save"
              onSelect={() => save()}
              class="command-item"
            >
              <SaveIcon />
              <span>Save</span>
              <CommandPalette.Shortcut>⌘S</CommandPalette.Shortcut>
            </CommandPalette.Item>
          </CommandPalette.Group>

          <CommandPalette.Separator class="command-separator" />

          <CommandPalette.Group heading="Settings" class="command-group">
            <CommandPalette.Item value="settings" class="command-item">
              <SettingsIcon />
              <span>Preferences</span>
            </CommandPalette.Item>

            <CommandPalette.Item value="theme" class="command-item">
              <PaletteIcon />
              <span>Change Theme</span>
            </CommandPalette.Item>
          </CommandPalette.Group>
        </CommandPalette.List>
      </CommandPalette.Dialog>
    </CommandPalette>
  );
});
```

#### Advanced: Dynamic Commands

```typescript
import { defineComponent, signal, computed, type Component } from 'aether';
import { CommandPalette } from 'aether/primitives';

interface Command {
  id: string;
  label: string;
  icon?: Component;
  shortcut?: string;
  action: () => void;
  keywords?: string[];
}

const DynamicCommandPalette = defineComponent(() => {
  const commands: Command[] = [
    {
      id: 'new-file',
      label: 'New File',
      icon: FileIcon,
      shortcut: '⌘N',
      action: () => createNewFile(),
      keywords: ['create', 'file']
    },
    {
      id: 'search',
      label: 'Search Files',
      icon: SearchIcon,
      shortcut: '⌘P',
      action: () => searchFiles(),
      keywords: ['find', 'locate']
    }
    // ... more commands
  ];

  const isOpen = signal(false);
  const searchQuery = signal('');

  // Fuzzy search with ranking
  const filteredCommands = computed(() => {
    const query = searchQuery().toLowerCase();
    if (!query) return commands;

    return commands
      .map(cmd => {
        const labelMatch = fuzzyMatch(query, cmd.label.toLowerCase());
        const keywordMatch = cmd.keywords?.some(k =>
          fuzzyMatch(query, k)
        );

        if (!labelMatch && !keywordMatch) return null;

        return {
          ...cmd,
          score: labelMatch ? labelMatch.score : 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score);
  });

  const fuzzyMatch = (query: string, text: string) => {
    let queryIdx = 0;
    let score = 0;

    for (let i = 0; i < text.length && queryIdx < query.length; i++) {
      if (text[i] === query[queryIdx]) {
        queryIdx++;
        score += 1;
      }
    }

    return queryIdx === query.length ? { score } : null;
  };

  return () => (
    <CommandPalette bind:open={isOpen}>
      <CommandPalette.Dialog>
        <CommandPalette.Input
          placeholder="Type a command..."
          bind:value={searchQuery}
        />

        <CommandPalette.List>
          {#if filteredCommands().length > 0}
            {#each filteredCommands() as command}
              <CommandPalette.Item
                value={command.id}
                onSelect={() => {
                  command.action();
                  isOpen(false);
                }}
                class="command-item"
              >
                {#if command.icon}
                  <command.icon />
                {/if}
                <span>{command.label}</span>
                {#if command.shortcut}
                  <CommandPalette.Shortcut>
                    {command.shortcut}
                  </CommandPalette.Shortcut>
                {/if}
              </CommandPalette.Item>
            {/each}
          {:else}
            <CommandPalette.Empty>
              No commands found
            </CommandPalette.Empty>
          {/if}
        </CommandPalette.List>
      </CommandPalette.Dialog>
    </CommandPalette>
  );
});
```

#### Styling Example

```css
.command-input {
  width: 100%;
  padding: var(--spacing-4);

  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border);

  font-size: var(--font-size-base);
  color: var(--color-text-primary);

  outline: none;
}

.command-input::placeholder {
  color: var(--color-text-placeholder);
}

.command-list {
  max-height: 400px;
  overflow-y: auto;
  padding: var(--spacing-2);
}

.command-group {
  padding: var(--spacing-2) 0;
}

.command-group[data-heading]::before {
  content: attr(data-heading);
  display: block;
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.command-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);

  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-md);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.command-item:hover,
.command-item[data-selected="true"] {
  background: var(--color-background-secondary);
}

.command-shortcut {
  margin-left: auto;
  padding: var(--spacing-1) var(--spacing-2);

  background: var(--color-background-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);

  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  color: var(--color-text-secondary);
}

.command-empty {
  padding: var(--spacing-8) var(--spacing-4);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.command-separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--spacing-2) 0;
}
```

#### API Reference

**`<CommandPalette>`** - Root component

Props:
- `open?: Signal<boolean>` - Controlled open state
- `onOpenChange?: (open: boolean) => void`

**`<CommandPalette.Dialog>`** - Dialog container

**`<CommandPalette.Input>`** - Search input

Props:
- `value?: Signal<string>` - Search query
- `placeholder?: string`

**`<CommandPalette.List>`** - Command list container

**`<CommandPalette.Empty>`** - Shown when no results

**`<CommandPalette.Group>`** - Command group

Props:
- `heading?: string` - Group heading

**`<CommandPalette.Item>`** - Command item

Props:
- `value: string` - Command identifier
- `onSelect?: () => void` - Called when selected
- `disabled?: boolean`
- `keywords?: string[]` - For search matching

**`<CommandPalette.Separator>`** - Visual separator

**`<CommandPalette.Shortcut>`** - Keyboard shortcut display

---

### DatePicker

A date input with calendar dropdown.

#### Features

- Calendar popup
- Date range selection
- Min/max dates
- Disabled dates
- Custom date formatting
- Keyboard navigation
- Multi-month display
- Preset ranges

#### Basic Usage (Single Date)

```typescript
import { defineComponent, signal } from 'aether';
import { DatePicker } from 'aether/primitives';

const DatePickerExample = defineComponent(() => {
  const selectedDate = signal<Date | null>(new Date());

  return () => (
    <DatePicker bind:value={selectedDate}>
      <DatePicker.Trigger class="datepicker-trigger">
        <CalendarIcon />
        <DatePicker.Value>
          {#if selectedDate()}
            {formatDate(selectedDate(), 'MMM dd, yyyy')}
          {:else}
            <span class="placeholder">Pick a date</span>
          {/if}
        </DatePicker.Value>
      </DatePicker.Trigger>

      <DatePicker.Content class="datepicker-content">
        <DatePicker.Calendar class="calendar">
          <DatePicker.Header class="calendar-header">
            <DatePicker.PrevButton class="calendar-nav-btn">
              <ChevronLeftIcon />
            </DatePicker.PrevButton>
            <DatePicker.Heading class="calendar-heading" />
            <DatePicker.NextButton class="calendar-nav-btn">
              <ChevronRightIcon />
            </DatePicker.NextButton>
          </DatePicker.Header>

          <DatePicker.Grid class="calendar-grid">
            <DatePicker.GridHead class="calendar-grid-head">
              <DatePicker.HeadCell>Su</DatePicker.HeadCell>
              <DatePicker.HeadCell>Mo</DatePicker.HeadCell>
              <DatePicker.HeadCell>Tu</DatePicker.HeadCell>
              <DatePicker.HeadCell>We</DatePicker.HeadCell>
              <DatePicker.HeadCell>Th</DatePicker.HeadCell>
              <DatePicker.HeadCell>Fr</DatePicker.HeadCell>
              <DatePicker.HeadCell>Sa</DatePicker.HeadCell>
            </DatePicker.GridHead>
            <DatePicker.GridBody class="calendar-grid-body">
              <!-- Generated date cells -->
            </DatePicker.GridBody>
          </DatePicker.Grid>
        </DatePicker.Calendar>
      </DatePicker.Content>
    </DatePicker>
  );
});
```

#### Date Range Selection

```typescript
import { defineComponent, signal } from 'aether';
import { DateRangePicker } from 'aether/primitives';

const Example333 = defineComponent(() => {
  interface DateRange {
    from: Date | null;
    to: Date | null;
  }
  const dateRange = signal<DateRange>({
    from: new Date(),
    to: addDays(new Date(), 7)
  });

  return () => (
    <DateRangePicker bind:value={dateRange}>
      <DateRangePicker.Trigger class="datepicker-trigger">
        <CalendarIcon />
        <DateRangePicker.Value>
          {#if dateRange().from && dateRange().to}
            {formatDate(dateRange().from, 'MMM dd')}
            {' - '}
            {formatDate(dateRange().to, 'MMM dd, yyyy')}
          {:else}
            <span class="placeholder">Pick a date range</span>
          {/if}
        </DateRangePicker.Value>
      </DateRangePicker.Trigger>
      <DateRangePicker.Content class="datepicker-content">
        <!-- Preset ranges -->
        <div class="date-presets">
          <button
            on:click={() => dateRange({ from: new Date(), to: new Date() })}
            class="preset-btn"
          >
            Today
          </button>
          <button
            on:click={() => dateRange({
              from: startOfWeek(new Date()),
              to: endOfWeek(new Date())
            })}
            class="preset-btn"
          >
            This Week
          </button>
          <button
            on:click={() => dateRange({
              from: startOfMonth(new Date()),
              to: endOfMonth(new Date())
            })}
            class="preset-btn"
          >
            This Month
          </button>
        </div>
        <!-- Two month display -->
        <div class="calendar-months">
          <DateRangePicker.Calendar month={0} />
          <DateRangePicker.Calendar month={1} />
        </div>
      </DateRangePicker.Content>
    </DateRangePicker>
  );
});
```

#### With Disabled Dates

```typescript
import { defineComponent, signal } from 'aether';
const Example438 = defineComponent(() => {
  const selectedDate = signal<Date | null>(null);
  const isWeekend = (date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 6;
  };
  const isPast = (date: Date) => {
    return date < new Date();
  };
  const isDisabled = (date: Date) => {
    return isWeekend(date) || isPast(date);
  };

  return () => (
    <DatePicker bind:value={selectedDate} isDateDisabled={isDisabled}>
      <!-- ... -->
    </DatePicker>
  );
});
```

#### API Reference

**`<DatePicker>`** - Root component

Props:
- `value?: Signal<Date | null>` - Controlled selected date
- `defaultValue?: Date` - Initial date
- `onValueChange?: (date: Date | null) => void`
- `min?: Date` - Minimum selectable date
- `max?: Date` - Maximum selectable date
- `isDateDisabled?: (date: Date) => boolean` - Custom disable logic
- `locale?: string` - Locale for formatting (default: 'en-US')
- `weekStartsOn?: 0 | 1` - Week starts on Sunday (0) or Monday (1)

**`<DatePicker.Trigger>`** - Opens calendar

**`<DatePicker.Value>`** - Displays selected date

**`<DatePicker.Content>`** - Calendar dropdown

**`<DatePicker.Calendar>`** - Calendar component

Props:
- `month?: number` - Month offset from current (for multi-month)

**`<DatePicker.Header>`** - Calendar header (month/year navigation)

**`<DatePicker.PrevButton>`** - Previous month button

**`<DatePicker.NextButton>`** - Next month button

**`<DatePicker.Heading>`** - Current month/year display

**`<DatePicker.Grid>`** - Calendar grid

**`<DatePicker.GridHead>`** - Day name headers

**`<DatePicker.HeadCell>`** - Day name cell

**`<DatePicker.GridBody>`** - Date cells container

**`<DatePicker.Cell>`** - Individual date cell

**`<DateRangePicker>`** - Date range variant

Props:
- `value?: Signal<{ from: Date | null; to: Date | null }>` - Selected range
- Other props same as DatePicker

---

### Calendar

Standalone calendar component (used by DatePicker).

#### Features

- Single/multi/range selection
- Month/year navigation
- Disabled dates
- Custom rendering
- Multiple months
- Keyboard navigation

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Calendar } from 'aether/primitives';

const Example105 = defineComponent(() => {
  const selectedDate = signal<Date>(new Date());

  return () => (
    <Calendar bind:value={selectedDate} class="calendar">
      <Calendar.Header class="calendar-header">
        <Calendar.PrevButton class="calendar-nav-btn">
          <ChevronLeftIcon />
        </Calendar.PrevButton>
        <Calendar.Heading class="calendar-heading" />
        <Calendar.NextButton class="calendar-nav-btn">
          <ChevronRightIcon />
        </Calendar.NextButton>
      </Calendar.Header>
      <Calendar.Grid class="calendar-grid">
        <Calendar.GridHead class="calendar-grid-head">
          <Calendar.HeadCell>Su</Calendar.HeadCell>
          <Calendar.HeadCell>Mo</Calendar.HeadCell>
          <Calendar.HeadCell>Tu</Calendar.HeadCell>
          <Calendar.HeadCell>We</Calendar.HeadCell>
          <Calendar.HeadCell>Th</Calendar.HeadCell>
          <Calendar.HeadCell>Fr</Calendar.HeadCell>
          <Calendar.HeadCell>Sa</Calendar.HeadCell>
        </Calendar.GridHead>
        <Calendar.GridBody class="calendar-grid-body">
          <!-- Auto-generated cells for current month -->
        </Calendar.GridBody>
      </Calendar.Grid>
    </Calendar>
  );
});
```

#### Multi-Select

```typescript
import { defineComponent, signal } from 'aether';
const Example861 = defineComponent(() => {
  const selectedDates = signal<Date[]>([new Date()]);

  return () => (
    <Calendar
      mode="multiple"
      bind:value={selectedDates}
      class="calendar"
    >
      <!-- ... -->
    </Calendar>
  );
});
```

#### Styling Example

```css
.calendar {
  width: 280px;
  padding: var(--spacing-3);

  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  margin-bottom: var(--spacing-2);
}

.calendar-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 32px;
  height: 32px;

  background: transparent;
  border: none;
  border-radius: var(--radius-sm);

  color: var(--color-text-secondary);
  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.calendar-nav-btn:hover {
  background: var(--color-background-secondary);
}

.calendar-heading {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.calendar-grid {
  width: 100%;
}

.calendar-grid-head {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: var(--spacing-1);
}

.calendar-grid-head > * {
  display: flex;
  align-items: center;
  justify-content: center;

  height: 32px;

  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.calendar-grid-body {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--spacing-1);
}

.calendar-cell {
  display: flex;
  align-items: center;
  justify-content: center;

  height: 32px;

  background: transparent;
  border: none;
  border-radius: var(--radius-sm);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.calendar-cell:hover {
  background: var(--color-background-secondary);
}

.calendar-cell:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-500);
}

.calendar-cell[data-selected="true"] {
  background: var(--color-primary-500);
  color: white;
}

.calendar-cell[data-today="true"] {
  font-weight: var(--font-weight-semibold);
  position: relative;
}

.calendar-cell[data-today="true"]::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);

  width: 4px;
  height: 4px;

  background: currentColor;
  border-radius: 50%;
}

.calendar-cell[data-outside-month="true"] {
  color: var(--color-text-disabled);
}

.calendar-cell[data-disabled="true"] {
  color: var(--color-text-disabled);
  cursor: not-allowed;
  pointer-events: none;
}

.calendar-cell[data-range-start="true"],
.calendar-cell[data-range-end="true"] {
  background: var(--color-primary-500);
  color: white;
}

.calendar-cell[data-range-middle="true"] {
  background: var(--color-primary-100);
  color: var(--color-primary-900);
  border-radius: 0;
}
```

#### API Reference

**`<Calendar>`** - Calendar component

Props:
- `mode?: 'single' | 'multiple' | 'range'` - Selection mode (default: 'single')
- `value?: Signal<Date | Date[] | DateRange>` - Selected date(s)
- `defaultValue?: Date | Date[] | DateRange` - Initial value
- `onValueChange?: (value: Date | Date[] | DateRange) => void`
- `min?: Date` - Minimum date
- `max?: Date` - Maximum date
- `isDateDisabled?: (date: Date) => boolean`
- `locale?: string`
- `weekStartsOn?: 0 | 1`
- `numberOfMonths?: number` - Display multiple months (default: 1)

**`<Calendar.Header>`** - Month/year navigation

**`<Calendar.PrevButton>`** - Previous month

**`<Calendar.NextButton>`** - Next month

**`<Calendar.Heading>`** - Current month/year

**`<Calendar.Grid>`** - Calendar grid

**`<Calendar.GridHead>`** - Day headers

**`<Calendar.HeadCell>`** - Day name

**`<Calendar.GridBody>`** - Date cells

**`<Calendar.Cell>`** - Individual date

Props:
- `date: Date` - The date for this cell

---

### Form

**Headless form composition primitives** for accessible field associations. These components handle ARIA relationships and accessibility, but **NO state management or validation** (use `createForm` from `nexus/forms` for that).

#### Design Philosophy

Form primitives provide:
- **Composition**: Flexible component structure
- **Accessibility**: Automatic ARIA associations (label-control, control-message, error announcements)
- **Integration**: Works with any state management (signals, createForm, custom)

Form primitives do NOT provide:
- State management (use `createForm` or signals)
- Validation logic (handled by form state layer)
- Submit handling (handled by form state layer)

#### Features

- Accessible label-control association
- Error message announcement (aria-describedby, aria-invalid)
- Field description support
- Flexible composition via `asChild`
- Works with any input component (native, custom, primitives)
- Type-safe field names

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { FormRoot, FormField, FormLabel, FormControl, FormMessage } from 'aether/primitives';

const Example530 = defineComponent(() => {
  const email = signal('');
  const error = signal<string | null>(null);

  const handleChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    email.set(value);

    // Custom validation
    if (!value.includes('@')) {
      error.set('Invalid email address');
    } else {
      error.set(null);
    }
  };

  return () => (
    <FormRoot>
      <form>
        <FormField name="email">
          <FormLabel>Email Address</FormLabel>
          <FormControl>
            <input
              type="email"
              value={email()}
              on:input={handleChange}
              class="form-input"
            />
          </FormControl>
          {#if error()}
            <FormMessage>{error()}</FormMessage>
          {/if}
        </FormField>
        <button type="submit">Submit</button>
      </form>
    </FormRoot>
  );
});
```

#### Integration with createForm

Primitives work seamlessly with `createForm` hook (see **15-FORMS.md**):

```typescript
import { defineComponent } from 'aether';
import { createForm } from 'aether/forms';
import { FormRoot, FormField, FormLabel, FormControl, FormMessage } from 'aether/primitives';
import { z } from 'zod';

const Example872 = defineComponent(() => {
  const schema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    age: z.number().min(18, 'Must be 18 or older')
  });

  const form = createForm({
    initialValues: {
      name: '',
      email: '',
      age: 0
    },
    validate: schema,
    onSubmit: async (values) => {
      await api.createUser(values);
    }
  });

  return () => (
    <FormRoot>
      <form on:submit={form.handleSubmit}>
        <FormField name="name">
          <FormLabel>Name</FormLabel>
          <FormControl>
            <input
              type="text"
              {...form.getFieldProps('name')}
              class="form-input"
            />
          </FormControl>
          {#if form.touched.name && form.errors.name}
            <FormMessage>{form.errors.name}</FormMessage>
          {/if}
        </FormField>

        <FormField name="email">
          <FormLabel>Email</FormLabel>
          <FormControl>
            <input
              type="email"
              {...form.getFieldProps('email')}
              class="form-input"
            />
          </FormControl>
          {#if form.touched.email && form.errors.email}
            <FormMessage>{form.errors.email}</FormMessage>
          {/if}
        </FormField>

        <FormField name="age">
          <FormLabel>Age</FormLabel>
          <FormControl>
            <input
              type="number"
              {...form.getFieldProps('age')}
              class="form-input"
            />
          </FormControl>
          {#if form.touched.age && form.errors.age}
            <FormMessage>{form.errors.age}</FormMessage>
          {/if}
        </FormField>

        <button
          type="submit"
          disabled={form.isSubmitting || !form.isValid}
        >
          {#if form.isSubmitting}
            Submitting...
          {:else}
            Submit
          {/if}
        </button>
      </form>
    </FormRoot>
  );
});
```

#### With Complex Primitives (Select, Checkbox)

```typescript
import { defineComponent } from 'aether';
import { createForm } from 'aether/forms';
import { FormRoot, FormField, FormLabel, FormControl, FormMessage } from 'aether/primitives';
import { Select, Checkbox } from 'aether/primitives';

const Example844 = defineComponent(() => {
  const form = createForm({
    initialValues: {
      country: '',
      acceptTerms: false
    },
    validate: {
      country: (value) => !value && 'Please select a country',
      acceptTerms: (value) => !value && 'You must accept terms'
    },
    onSubmit: async (values) => {
      await api.register(values);
    }
  });

  return () => (
    <FormRoot>
      <form on:submit={form.handleSubmit}>
        {/* Select integration */}
        <FormField name="country">
          <FormLabel>Country</FormLabel>
          <FormControl asChild>
            <Select bind:value={form.values.country}>
              <Select.Trigger>
                <Select.Value placeholder="Select country..." />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="us">United States</Select.Item>
                <Select.Item value="uk">United Kingdom</Select.Item>
                <Select.Item value="ca">Canada</Select.Item>
              </Select.Content>
            </Select>
          </FormControl>
          {#if form.touched.country && form.errors.country}
            <FormMessage>{form.errors.country}</FormMessage>
          {/if}
        </FormField>

        {/* Checkbox integration */}
        <FormField name="acceptTerms">
          <div class="flex items-center gap-2">
            <FormControl asChild>
              <Checkbox
                bind:checked={form.values.acceptTerms}
                id="terms"
              >
                <Checkbox.Indicator>
                  <CheckIcon />
                </Checkbox.Indicator>
              </Checkbox>
            </FormControl>
            <FormLabel for="terms">
              I accept the terms and conditions
            </FormLabel>
          </div>
          {#if form.touched.acceptTerms && form.errors.acceptTerms}
            <FormMessage>{form.errors.acceptTerms}</FormMessage>
          {/if}
        </FormField>

        <button type="submit" disabled={form.isSubmitting}>
          Submit
        </button>
      </form>
    </FormRoot>
  );
});
```

#### Styling Example

```css
.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.form-input {
  padding: var(--spacing-2) var(--spacing-3);
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color var(--transition-fast);
}

.form-input:hover {
  border-color: var(--color-border-hover);
}

.form-input:focus {
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 3px var(--color-primary-100);
}

.form-input[aria-invalid="true"] {
  border-color: var(--color-error);
}

.form-input[aria-invalid="true"]:focus {
  box-shadow: 0 0 0 3px var(--color-error-light);
}

.form-error {
  font-size: var(--font-size-xs);
  color: var(--color-error);
}
```

#### API Reference

**`<FormRoot>`** - Form container (optional, provides context for field IDs)

Props:
- `id?: string` - Form ID prefix for field associations

**`<FormField>`** - Field wrapper providing context

Props:
- `name: string` - Field name for associations
- `children: ComponentChildren` - Field content

Context provided:
- Field ID for label/control/message association
- Field name for form integration

**`<FormLabel>`** - Accessible label

Props:
- `for?: string` - Control ID (auto-associated via context)
- `...HTMLLabelAttributes` - Standard label props

Behavior:
- Automatically associates with control via `for` attribute
- Uses field context for ID generation

**`<FormControl>`** - Control wrapper

Props:
- `asChild?: boolean` - Merge props into child (default: false)
- `...HTMLAttributes` - Forwarded to wrapper/child

Behavior:
- Adds `aria-describedby` pointing to error message (if error exists)
- Adds `aria-invalid` when error exists
- Generates unique `id` for label association
- If `asChild`, merges ARIA props into child element

**`<FormMessage>`** - Error/help message

Props:
- `...HTMLAttributes` - Standard div props

Behavior:
- Renders with `id` for `aria-describedby` association
- Includes `role="alert"` for screen reader announcements
- Only shown when there's an error message

**`<FormDescription>`** - Field description/help text

Props:
- `...HTMLAttributes` - Standard div props

Behavior:
- Renders with `id` for `aria-describedby` association
- Always included in `aria-describedby` (even with errors)

---

### Avatar

User avatar display with image loading states and fallback support.

#### Features

- Image loading states (idle, loading, loaded, error)
- Fallback content when image fails to load
- Delayed fallback rendering
- Automatic image load/error handling
- Customizable via CSS

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Avatar } from 'aether/primitives';

export const UserAvatar = defineComponent(() => {
  return () => (
    <Avatar class="avatar">
      <Avatar.Image
        src="https://example.com/avatar.jpg"
        alt="John Doe"
      />
      <Avatar.Fallback class="avatar-fallback" delayMs={600}>
        JD
      </Avatar.Fallback>
    </Avatar>
  );
});
```

#### Styling Example

```css
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--color-background-secondary);
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--color-primary-500);
  color: white;
  font-weight: 600;
  font-size: 14px;
}
```

#### API Reference

**`<Avatar>`** - Avatar container

Props:
- `...HTMLAttributes` - Standard span props

**`<Avatar.Image>`** - Avatar image

Props:
- `src: string` - Image URL
- `alt: string` - Alt text
- `onLoad?: () => void` - Image load callback
- `onError?: () => void` - Image error callback

**`<Avatar.Fallback>`** - Fallback content

Props:
- `delayMs?: number` - Delay before showing fallback (default: 0)
- `...HTMLAttributes` - Standard span props

---

### Badge

Status badge for notifications, counts, and status indicators.

#### Features

- Simple, lightweight component
- ARIA live region for screen readers
- Customizable via CSS
- Works with any content (text, numbers, icons)

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Badge } from 'aether/primitives';

export const NotificationBadge = defineComponent(() => {
  return () => (
    <div class="notification-container">
      <BellIcon />
      <Badge class="badge">3</Badge>
    </div>
  );
});

// Status badges
export const StatusBadges = defineComponent(() => {
  return () => (
    <div class="status-list">
      <Badge class="badge badge-success">Active</Badge>
      <Badge class="badge badge-warning">Pending</Badge>
      <Badge class="badge badge-error">Failed</Badge>
    </div>
  );
});
```

#### Styling Example

```css
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 12px;
  background: var(--color-primary-500);
  color: white;
}

.badge-success {
  background: var(--color-success-500);
}

.badge-warning {
  background: var(--color-warning-500);
}

.badge-error {
  background: var(--color-error-500);
}

/* Notification badge */
.notification-container {
  position: relative;
  display: inline-flex;
}

.notification-container .badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
}
```

#### API Reference

**`<Badge>`** - Badge component

Props:
- `...HTMLAttributes` - Standard span props

---

### Progress

Progress bars with determinate and indeterminate states.

#### Features

- Determinate (value 0-100) and indeterminate (loading) modes
- WAI-ARIA progressbar pattern
- Custom value label formatting
- Configurable max value
- Accessible to screen readers

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Progress } from 'aether/primitives';

// Determinate progress
export const FileUpload = defineComponent(() => {
  const uploadProgress = signal(45);

  return () => (
    <div class="upload-container">
      <span>Uploading... {uploadProgress()}%</span>
      <Progress value={uploadProgress()} class="progress">
        <Progress.Indicator class="progress-indicator" />
      </Progress>
    </div>
  );
});

// Indeterminate progress
export const Loading = defineComponent(() => {
  return () => (
    <Progress value={null} class="progress">
      <Progress.Indicator class="progress-indicator" />
    </Progress>
  );
});

// Custom value label
export const CustomProgress = defineComponent(() => {
  const value = signal(75);

  return () => (
    <Progress
      value={value()}
      max={100}
      getValueLabel={(v, max) => `${v} of ${max} items`}
      class="progress"
    >
      <Progress.Indicator class="progress-indicator" />
    </Progress>
  );
});
```

#### Styling Example

```css
.progress {
  position: relative;
  width: 100%;
  height: 8px;
  background: var(--color-background-secondary);
  border-radius: 4px;
  overflow: hidden;
}

.progress-indicator {
  width: 100%;
  height: 100%;
  background: var(--color-primary-500);
  transition: transform 200ms ease;
}

/* Indeterminate animation */
.progress[data-state="indeterminate"] .progress-indicator {
  animation: progress-indeterminate 1.5s ease-in-out infinite;
}

@keyframes progress-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(100%);
  }
}
```

#### API Reference

**`<Progress>`** - Progress container

Props:
- `value: number | null` - Progress value (0-max) or null for indeterminate
- `max?: number` - Maximum value (default: 100)
- `getValueLabel?: (value: number, max: number) => string` - Custom label formatter
- `...HTMLAttributes` - Standard div props

**`<Progress.Indicator>`** - Progress indicator bar

Props:
- `...HTMLAttributes` - Standard div props

---

### AspectRatio

Maintain consistent aspect ratios for images, videos, and embeds.

#### Features

- Maintains aspect ratio regardless of container size
- Responsive by default
- Supports custom ratios
- Common presets (16/9, 4/3, 1/1, 3/2, 21/9)

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { AspectRatio } from 'aether/primitives';

// 16:9 video embed
export const VideoEmbed = defineComponent(() => {
  return () => (
    <AspectRatio ratio={16 / 9}>
      <iframe
        src="https://www.youtube.com/embed/..."
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </AspectRatio>
  );
});

// Square image
export const SquareImage = defineComponent(() => {
  return () => (
    <AspectRatio ratio={1}>
      <img
        src="/product.jpg"
        alt="Product"
        style={{ objectFit: 'cover' }}
      />
    </AspectRatio>
  );
});

// Ultra-wide banner
export const Banner = defineComponent(() => {
  return () => (
    <AspectRatio ratio={21 / 9}>
      <img
        src="/banner.jpg"
        alt="Banner"
        style={{ objectFit: 'cover' }}
      />
    </AspectRatio>
  );
});
```

#### Styling Example

```css
/* AspectRatio renders with position: relative by default */
/* Child content is absolutely positioned */

.aspect-ratio-container {
  max-width: 600px;
}

.aspect-ratio-container img,
.aspect-ratio-container iframe,
.aspect-ratio-container video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: none;
}
```

#### API Reference

**`<AspectRatio>`** - Aspect ratio container

Props:
- `ratio: number` - Aspect ratio (width / height), e.g., 16/9 = 1.777...
- `...HTMLAttributes` - Standard div props

Common ratios:
- `1` - Square (1:1)
- `4/3` - Standard (1.333...)
- `16/9` - Widescreen (1.777...)
- `3/2` - Classic photo (1.5)
- `21/9` - Ultra-wide (2.333...)

---

### Toast

Toast notifications with auto-dismiss, actions, and multiple toast support.

#### Features

- Auto-dismiss with configurable duration
- Max toasts limit (prevents screen clutter)
- Action buttons
- Different variants (default, success, warning, error)
- Keyboard hotkey support (F8 to close)
- Provider pattern with context
- Portal rendering

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Toast, ToastProvider } from 'aether/primitives';

// Wrap your app with ToastProvider
export const App = defineComponent(() => {
  return () => (
    <ToastProvider duration={5000} maxToasts={3}>
      <YourApp />
      <Toast.Viewport class="toast-viewport" />
    </ToastProvider>
  );
});

// Show toasts from anywhere
export const NotificationButton = defineComponent(() => {
  const toastContext = useContext(ToastContext);

  const showToast = () => {
    toastContext.addToast({
      title: 'Success!',
      description: 'Your changes have been saved.',
      variant: 'success',
      duration: 5000,
    });
  };

  return () => (
    <button on:click={showToast}>
      Show Notification
    </button>
  );
});

// With action
export const UndoToast = defineComponent(() => {
  const toastContext = useContext(ToastContext);

  const deleteWithUndo = () => {
    toastContext.addToast({
      title: 'Item deleted',
      description: 'The item has been removed.',
      variant: 'default',
      action: {
        label: 'Undo',
        onClick: () => {
          // Restore the item
          console.log('Undo delete');
        },
      },
    });
  };

  return () => (
    <button on:click={deleteWithUndo}>
      Delete Item
    </button>
  );
});
```

#### Styling Example

```css
.toast-viewport {
  position: fixed;
  bottom: 0;
  right: 0;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 400px;
  z-index: var(--z-toast);
}

[data-toast] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-left: 4px solid var(--color-primary-500);
}

[data-toast][data-variant="success"] {
  border-left-color: var(--color-success-500);
}

[data-toast][data-variant="warning"] {
  border-left-color: var(--color-warning-500);
}

[data-toast][data-variant="error"] {
  border-left-color: var(--color-error-500);
}

[data-toast-title] {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
}

[data-toast-description] {
  font-size: 13px;
  color: var(--color-text-secondary);
}

[data-toast-action] {
  align-self: flex-start;
  padding: 4px 12px;
  border-radius: 4px;
  background: var(--color-primary-500);
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

[data-toast-close] {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  font-size: 18px;
}
```

#### API Reference

**`<ToastProvider>`** - Toast provider (wrap your app)

Props:
- `duration?: number` - Default auto-dismiss duration in ms (default: 5000)
- `maxToasts?: number` - Maximum number of toasts shown at once (default: 3)
- `hotkey?: string[]` - Keyboard hotkey to close toasts (default: ['F8'])
- `children: any` - Your app content

**`<Toast.Viewport>`** - Toast container (render once)

Props:
- `...HTMLAttributes` - Standard ol (ordered list) props

**`<Toast>`** - Individual toast

Props:
- `toast: ToastData` - Toast data object
- `onDismiss?: (id: string) => void` - Dismiss callback

**ToastData** interface:
```typescript
interface ToastData {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}
```

**Context Methods**:
- `addToast(toast: Omit<ToastData, 'id'>): string` - Add new toast, returns ID
- `removeToast(id: string): void` - Remove specific toast
- `toasts(): ToastData[]` - Get all current toasts

---

### Collapsible

Collapsible content regions (single-item accordion).

#### Features

- Controlled and uncontrolled modes
- Smooth height animations
- Disabled state
- forceMount support for animations
- Keyboard accessible (Space/Enter to toggle)

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Collapsible } from 'aether/primitives';

// Uncontrolled
export const SimpleCollapsible = defineComponent(() => {
  return () => (
    <Collapsible defaultOpen={false} class="collapsible">
      <Collapsible.Trigger class="collapsible-trigger">
        Show More
      </Collapsible.Trigger>
      <Collapsible.Content class="collapsible-content">
        <p>Additional content that can be collapsed...</p>
      </Collapsible.Content>
    </Collapsible>
  );
});

// Controlled
export const ControlledCollapsible = defineComponent(() => {
  const isOpen = signal(false);

  return () => (
    <>
      <button on:click={() => isOpen(!isOpen())}>
        {isOpen() ? 'Hide' : 'Show'} Details
      </button>

      <Collapsible bind:open={isOpen} class="collapsible">
        <Collapsible.Content class="collapsible-content">
          <p>Controlled content...</p>
        </Collapsible.Content>
      </Collapsible>
    </>
  );
});
```

#### Styling Example

```css
.collapsible {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.collapsible-trigger {
  width: 100%;
  padding: 12px 16px;
  background: transparent;
  border: none;
  text-align: left;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.collapsible-trigger:hover {
  background: var(--color-background-secondary);
}

.collapsible-trigger::after {
  content: '▼';
  transition: transform 200ms ease;
}

.collapsible[data-state="open"] .collapsible-trigger::after {
  transform: rotate(-180deg);
}

.collapsible-content {
  overflow: hidden;
  padding: 0 16px;
  transition: height 200ms ease;
}

.collapsible[data-state="open"] .collapsible-content {
  padding: 16px;
}
```

#### API Reference

**`<Collapsible>`** - Collapsible container

Props:
- `open?: Signal<boolean>` - Controlled open state
- `defaultOpen?: boolean` - Initial state (uncontrolled)
- `onOpenChange?: (open: boolean) => void` - Open change callback
- `disabled?: boolean` - Disable interaction
- `...HTMLAttributes` - Standard div props

**`<Collapsible.Trigger>`** - Toggle button

Props:
- `...HTMLAttributes` - Standard button props

**`<Collapsible.Content>`** - Collapsible content

Props:
- `forceMount?: boolean` - Always mount (for animations)
- `...HTMLAttributes` - Standard div props

---

### Skeleton

Loading placeholders with shimmer animation.

#### Features

- Configurable width, height, border radius
- Optional shimmer animation
- ARIA busy state for screen readers
- Simple and lightweight
- Customizable via CSS

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Skeleton } from 'aether/primitives';

// Text skeleton
export const TextSkeleton = defineComponent(() => {
  return () => (
    <div class="text-skeleton-container">
      <Skeleton width="100%" height="20px" class="skeleton" />
      <Skeleton width="80%" height="20px" class="skeleton" />
      <Skeleton width="60%" height="20px" class="skeleton" />
    </div>
  );
});

// Avatar skeleton
export const AvatarSkeleton = defineComponent(() => {
  return () => (
    <Skeleton width="40px" height="40px" radius="50%" class="skeleton" />
  );
});

// Card skeleton
export const CardSkeleton = defineComponent(() => {
  return () => (
    <div class="card-skeleton">
      <Skeleton width="100%" height="200px" radius="8px" class="skeleton" />
      <Skeleton width="100%" height="24px" class="skeleton" />
      <Skeleton width="100%" height="16px" class="skeleton" />
      <Skeleton width="70%" height="16px" class="skeleton" />
    </div>
  );
});

// Disable animation
export const StaticSkeleton = defineComponent(() => {
  return () => (
    <Skeleton width="100%" height="100px" animate={false} class="skeleton" />
  );
});
```

#### Styling Example

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-background-secondary) 0%,
    var(--color-background-tertiary) 50%,
    var(--color-background-secondary) 100%
  );
  background-size: 200% 100%;
}

.skeleton[data-animate] {
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.text-skeleton-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
```

#### API Reference

**`<Skeleton>`** - Skeleton loader

Props:
- `width?: string | number` - Width (CSS value or number in px)
- `height?: string | number` - Height (CSS value or number in px)
- `radius?: string | number` - Border radius (CSS value or number in px, default: '4px')
- `animate?: boolean` - Enable shimmer animation (default: true)
- `...HTMLAttributes` - Standard div props

---

### Table

A data table with sorting, filtering, pagination, and selection.

#### Features

- Column sorting
- Row selection (single/multi)
- Pagination
- Filtering
- Virtual scrolling (large datasets)
- Expandable rows
- Column resizing
- Column visibility toggle
- Sticky headers
- Responsive

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Table } from 'aether/primitives';

const Example793 = defineComponent(() => {
  interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    status: 'active' | 'inactive';
  }
  const users: User[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com', role: 'Admin', status: 'active' },
    { id: '2', name: 'Bob', email: 'bob@example.com', role: 'User', status: 'active' },
    { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'User', status: 'inactive' }
  ];
  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'role', header: 'Role', sortable: true },
    { key: 'status', header: 'Status', sortable: true }
  ];
  const selectedRows = signal<string[]>([]);

  return () => (
    <Table data={users} columns={columns} rowKey="id">
      {#let table}
        <div class="table-container">
          <table class="table">
            <Table.Header class="table-header">
              <Table.Row class="table-row">
                <Table.Head class="table-head-checkbox">
                  <Checkbox
                    checked={table.isAllSelected()}
                    indeterminate={table.isSomeSelected()}
                    onCheckedChange={table.toggleAllRows}
                  />
                </Table.Head>
                {#each columns as column}
                  <Table.Head
                    key={column.key}
                    sortable={column.sortable}
                    class="table-head"
                  >
                    {column.header}
                    {#if column.sortable}
                      <Table.SortIndicator column={column.key} />
                    {/if}
                  </Table.Head>
                {/each}
                <Table.Head class="table-head-actions">
                  Actions
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body class="table-body">
              {#each table.rows() as row}
                <Table.Row
                  key={row.id}
                  selected={table.isRowSelected(row.id)}
                  class="table-row"
                >
                  <Table.Cell class="table-cell-checkbox">
                    <Checkbox
                      checked={table.isRowSelected(row.id)}
                      onCheckedChange={() => table.toggleRow(row.id)}
                    />
                  </Table.Cell>
                  <Table.Cell class="table-cell">
                    {row.name}
                  </Table.Cell>
                  <Table.Cell class="table-cell">
                    {row.email}
                  </Table.Cell>
                  <Table.Cell class="table-cell">
                    <span class="badge badge-{row.role.toLowerCase()}">
                      {row.role}
                    </span>
                  </Table.Cell>
                  <Table.Cell class="table-cell">
                    <span class="status status-{row.status}">
                      {row.status}
                    </span>
                  </Table.Cell>
                  <Table.Cell class="table-cell-actions">
                    <DropdownMenu>
                      <DropdownMenu.Trigger class="btn-icon">
                        <MoreVerticalIcon />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item>Edit</DropdownMenu.Item>
                        <DropdownMenu.Item>Delete</DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </table>
          <!-- Pagination -->
          <Table.Pagination class="table-pagination">
            <Table.PageInfo>
              Showing {table.pageStart()} to {table.pageEnd()} of {table.totalRows()}
            </Table.PageInfo>
            <div class="pagination-controls">
              <button
                on:click={table.previousPage}
                disabled={!table.canPreviousPage()}
                class="btn-icon"
              >
                <ChevronLeftIcon />
              </button>
              <span>
                Page {table.currentPage()} of {table.totalPages()}
              </span>
              <button
                on:click={table.nextPage}
                disabled={!table.canNextPage()}
                class="btn-icon"
              >
                <ChevronRightIcon />
              </button>
            </div>
          </Table.Pagination>
        </div>
      {/let}
    </Table>
  );
});
```

#### With Filtering

```typescript
import { defineComponent, signal, computed } from 'aether';
const Example573 = defineComponent(() => {
  const searchQuery = signal('');
  const statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  const filteredUsers = computed(() => {
    return users.filter(user => {
      const matchesSearch =
        user.name.toLowerCase().includes(searchQuery().toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery().toLowerCase());
      const matchesStatus =
        statusFilter() === 'all' || user.status === statusFilter();
      return matchesSearch && matchesStatus;
    });
  });

  return () => (
    <div class="table-filters">
      <input
        type="search"
        placeholder="Search users..."
        bind:value={searchQuery}
        class="search-input"
      />
      <Select bind:value={statusFilter}>
        <Select.Trigger>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="all">All Status</Select.Item>
          <Select.Item value="active">Active</Select.Item>
          <Select.Item value="inactive">Inactive</Select.Item>
        </Select.Content>
      </Select>
    </div>
    <Table data={filteredUsers()} columns={columns} rowKey="id">
      <!-- ... -->
    </Table>
  );
});
```

#### Styling Example

```css
.table-container {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table-header {
  background: var(--color-background-secondary);
}

.table-row {
  border-bottom: 1px solid var(--color-border);
  transition: background-color var(--transition-fast);
}

.table-row:hover {
  background: var(--color-background-secondary);
}

.table-row[data-selected="true"] {
  background: var(--color-primary-50);
}

.table-head {
  padding: var(--spacing-3) var(--spacing-4);

  text-align: left;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;

  white-space: nowrap;
}

.table-head[data-sortable="true"] {
  cursor: pointer;
  user-select: none;
}

.table-head[data-sortable="true"]:hover {
  color: var(--color-text-primary);
}

.table-cell {
  padding: var(--spacing-3) var(--spacing-4);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.table-head-checkbox,
.table-cell-checkbox {
  width: 40px;
  padding-right: 0;
}

.table-head-actions,
.table-cell-actions {
  width: 60px;
  text-align: right;
}

.table-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;

  padding: var(--spacing-3) var(--spacing-4);
  background: var(--color-background-secondary);
  border-top: 1px solid var(--color-border);
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);

  font-size: var(--font-size-sm);
}

.badge {
  display: inline-block;
  padding: var(--spacing-1) var(--spacing-2);

  background: var(--color-background-tertiary);
  border-radius: var(--radius-full);

  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.status {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);

  font-size: var(--font-size-sm);
}

.status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-active::before {
  background: var(--color-success);
}

.status-inactive::before {
  background: var(--color-error);
}
```

#### API Reference

**`<Table>`** - Table component

Props:
- `data: T[]` - Table data
- `columns: Column[]` - Column definitions
- `rowKey: keyof T` - Unique row identifier
- `pageSize?: number` - Rows per page (default: 10)
- `sortable?: boolean` - Enable sorting (default: false)
- `selectable?: boolean` - Enable row selection (default: false)
- `onRowClick?: (row: T) => void` - Row click handler

Exposes:
- `table.rows: Signal<T[]>` - Current page rows
- `table.selectedRows: Signal<string[]>` - Selected row IDs
- `table.isAllSelected: () => boolean` - All rows selected
- `table.isSomeSelected: () => boolean` - Some rows selected
- `table.toggleAllRows: () => void` - Toggle all selection
- `table.toggleRow: (id) => void` - Toggle row selection
- `table.isRowSelected: (id) => boolean` - Check if row selected
- `table.currentPage: Signal<number>` - Current page number
- `table.totalPages: () => number` - Total page count
- `table.pageStart: () => number` - First row index
- `table.pageEnd: () => number` - Last row index
- `table.totalRows: () => number` - Total row count
- `table.nextPage: () => void` - Next page
- `table.previousPage: () => void` - Previous page
- `table.canNextPage: () => boolean` - Has next page
- `table.canPreviousPage: () => boolean` - Has previous page
- `table.sortBy: (column, direction) => void` - Sort table

**`<Table.Header>`** - Table header

**`<Table.Body>`** - Table body

**`<Table.Row>`** - Table row

Props:
- `key: string` - Row identifier
- `selected?: boolean` - Selected state

**`<Table.Head>`** - Header cell

Props:
- `key?: string` - Column identifier
- `sortable?: boolean` - Enable sorting

**`<Table.Cell>`** - Data cell

**`<Table.SortIndicator>`** - Sort direction indicator

Props:
- `column: string` - Column to indicate

**`<Table.Pagination>`** - Pagination controls

**`<Table.PageInfo>`** - Page info display

---

## Composition Patterns

### Building Complex UIs from Primitives

Primitives are designed to be composed together to build complex UIs:

#### Example: Settings Dialog with Tabs

```typescript
import { defineComponent, signal } from 'aether';
import { Dialog, Tabs, Switch, Select } from 'aether/primitives';

const Example221 = defineComponent(() => {
  const isOpen = signal(false);
  const activeTab = signal('general');
  const theme = signal('system');
  const notifications = signal(true);
  const language = signal('en');

  return () => (
    <Dialog bind:open={isOpen}>
      <Dialog.Trigger class="btn">Settings</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay" />
        <Dialog.Content class="dialog-content dialog-wide">
          <Dialog.Title>Settings</Dialog.Title>
          <Tabs bind:value={activeTab} class="settings-tabs">
            <Tabs.List class="tabs-list">
              <Tabs.Trigger value="general">General</Tabs.Trigger>
              <Tabs.Trigger value="appearance">Appearance</Tabs.Trigger>
              <Tabs.Trigger value="notifications">Notifications</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="general" class="tabs-content">
              <div class="settings-section">
                <h3>Language</h3>
                <Select bind:value={language}>
                  <Select.Trigger class="select-trigger">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="en">English</Select.Item>
                    <Select.Item value="es">Español</Select.Item>
                    <Select.Item value="fr">Français</Select.Item>
                  </Select.Content>
                </Select>
              </div>
            </Tabs.Content>
            <Tabs.Content value="appearance" class="tabs-content">
              <div class="settings-section">
                <div class="setting-row">
                  <div>
                    <h4>Theme</h4>
                    <p>Select your theme preference</p>
                  </div>
                  <Select bind:value={theme}>
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="light">Light</Select.Item>
                      <Select.Item value="dark">Dark</Select.Item>
                      <Select.Item value="system">System</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>
            </Tabs.Content>
            <Tabs.Content value="notifications" class="tabs-content">
              <div class="settings-section">
                <div class="setting-row">
                  <div>
                    <h4>Push Notifications</h4>
                    <p>Receive push notifications</p>
                  </div>
                  <Switch bind:checked={notifications}>
                    <Switch.Thumb />
                  </Switch>
                </div>
              </div>
            </Tabs.Content>
          </Tabs>
          <div class="dialog-actions">
            <Dialog.Close class="btn btn-secondary">Cancel</Dialog.Close>
            <button class="btn btn-primary">Save Changes</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
});
```

#### Example: Data Table with Filters and Actions

```typescript
import { defineComponent, signal } from 'aether';
import { Table, Dropdown, Dialog, AlertDialog } from 'aether/primitives';

const Example279 = defineComponent(() => {
  const users = signal([/* user data */]);
  const userToDelete = signal<User | null>(null);
  const showDeleteDialog = signal(false);

  return () => (
    <div class="users-view">
      <!-- Filters -->
      <div class="filters">
        <input type="search" placeholder="Search..." />
        <Select><!-- Status filter --></Select>
        <Select><!-- Role filter --></Select>
      </div>
      <!-- Table -->
      <Table data={users()} columns={columns} rowKey="id">
        {#let table}
          <!-- ... table structure ... -->
          <!-- Actions in row -->
          <Table.Cell class="table-cell-actions">
            <DropdownMenu>
              <DropdownMenu.Trigger class="btn-icon">
                <MoreIcon />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item on:select={() => editUser(row)}>
                  Edit
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  on:select={() => {
                    userToDelete(row);
                    showDeleteDialog(true);
                  }}
                  class="destructive"
                >
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </Table.Cell>
        {/let}
      </Table>
      <!-- Delete confirmation -->
      <AlertDialog bind:open={showDeleteDialog}>
        <AlertDialog.Content>
          <AlertDialog.Title>Delete User</AlertDialog.Title>
          <AlertDialog.Description>
            Are you sure you want to delete {userToDelete()?.name}?
            This action cannot be undone.
          </AlertDialog.Description>
          <div class="alert-dialog-actions">
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              class="btn-destructive"
              on:click={() => deleteUser(userToDelete())}
            >
              Delete
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog>
    </div>
  );
});
```

### Primitive Composition Rules

1. **Primitives don't style themselves** - You provide all styling
2. **Context flows down** - Parent primitives provide context to children
3. **Events bubble up** - Child interactions notify parent components
4. **Accessibility is built-in** - ARIA attributes handled automatically
5. **State can be controlled or uncontrolled** - Flexible state management

---

## Customization

### Styling Strategies

#### 1. Global CSS

```css
/* styles/primitives.css */
.dialog-overlay {
  background: rgba(0, 0, 0, 0.5);
}

.dialog-content {
  background: white;
  border-radius: 8px;
  padding: 24px;
}
```

#### 2. CSS Modules

```css
/* Dialog.module.css */
.overlay {
  background: rgba(0, 0, 0, 0.5);
}

.content {
  background: white;
  border-radius: 8px;
}
```

```typescript
import { defineComponent } from 'aether';
import styles from './Dialog.module.css';

const Example969 = defineComponent(() => {

  return () => (
    <Dialog.Overlay class={styles.overlay} />
    <Dialog.Content class={styles.content}>
      <!-- ... -->
    </Dialog.Content>
  );
});
```

#### 3. Tailwind CSS

```html
<Dialog.Overlay class="fixed inset-0 bg-black/50 backdrop-blur-sm" />
<Dialog.Content class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-lg shadow-xl p-6">
  <!-- ... -->
</Dialog.Content>
```

#### 4. CSS-in-JS (styled components)

```typescript
import { styled } from 'aether/styled';

const StyledOverlay = styled(Dialog.Overlay, {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)'
});

const StyledContent = styled(Dialog.Content, {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'white',
  borderRadius: '$md',
  padding: '$6'
});
```

### Creating Styled Wrapper Components

Build your own component library on top of primitives:

```typescript
// components/ui/Button.tsx
import { defineComponent } from 'aether';
import type { ComponentProps } from 'aether';

interface ButtonProps extends ComponentProps<'button'> {
  variant?: 'primary' | 'secondary' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = defineComponent<ButtonProps>((props) => {
  const { variant = 'primary', size = 'md', class: className, ...rest } = props;

  const classes = computed(() => {
    return [
      'btn',
      `btn-${variant()}`,
      `btn-${size()}`,
      className?.()
    ].filter(Boolean).join(' ');
  });

  return () => (
    <button class={classes()} {...rest}>
      <slot />
    </button>
  );
});
```

```typescript
// components/ui/Dialog.tsx
import * as DialogPrimitive from 'aether/primitives/dialog';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export const DialogContent = defineComponent((props) => {
  return () => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay class="dialog-overlay" />
      <DialogPrimitive.Content class="dialog-content" {...props}>
        <slot />
        <DialogPrimitive.Close class="dialog-close">
          <XIcon />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
```

Usage:

```typescript
import { defineComponent } from 'aether';
import { Dialog, DialogTrigger, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

const Example43 = defineComponent(() => {

  return () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="primary">Open Dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <h2>Dialog Title</h2>
        <p>Dialog content here</p>
      </DialogContent>
    </Dialog>
  );
});
```

---

## Theme Integration

Primitives automatically integrate with the Aether theming system:

```typescript
// theme.ts
export const LightTheme = defineTheme({
  name: 'light',
  colors: {
    primary: {
      500: '#0ea5e9'
    },
    background: {
      primary: '#ffffff',
      secondary: '#f8fafc'
    },
    border: '#e2e8f0'
  },
  radii: {
    md: '0.375rem',
    lg: '0.5rem'
  },
  spacing: {
    4: '1rem',
    6: '1.5rem'
  },
  shadows: {
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
  }
});
```

```css
/* Primitives use CSS variables from theme */
.dialog-content {
  background: var(--color-background-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-6);
}
```

---

## Animation System

### Using `data-state` for Animations

All primitives expose `data-state` attributes for animation:

```css
/* Fade in/out */
.dialog-overlay {
  animation-duration: 200ms;
  animation-timing-function: ease-out;
}

.dialog-overlay[data-state="open"] {
  animation-name: fadeIn;
}

.dialog-overlay[data-state="closed"] {
  animation-name: fadeOut;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

/* Slide in/out */
.dialog-content[data-state="open"] {
  animation-name: slideIn;
}

.dialog-content[data-state="closed"] {
  animation-name: slideOut;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translate(-50%, -48%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes slideOut {
  from {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  to {
    opacity: 0;
    transform: translate(-50%, -48%) scale(0.96);
  }
}
```

### Animation Helpers

```typescript
// utils/animations.ts
export const presence = (isPresent: () => boolean) => {
  const state = signal<'open' | 'closed'>('closed');
  const isAnimating = signal(false);

  effect(() => {
    if (isPresent()) {
      state('open');
    } else {
      isAnimating(true);
      state('closed');

      // Wait for animation to complete
      setTimeout(() => {
        isAnimating(false);
      }, 200); // Match animation duration
    }
  });

  return {
    state,
    shouldMount: computed(() => isPresent() || isAnimating())
  };
};
```

Usage:

```typescript
import { defineComponent, signal } from 'aether';
const Example285 = defineComponent(() => {
  const isOpen = signal(false);
  const dialogPresence = presence(() => isOpen());

  return () => (
    {#if dialogPresence.shouldMount()}
      <Dialog.Overlay data-state={dialogPresence.state()} />
      <Dialog.Content data-state={dialogPresence.state()}>
        <!-- ... -->
      </Dialog.Content>
    {/if}
  );
});
```

---

## Testing Primitives

### Unit Testing

```typescript
import { render, fireEvent } from '@testing-library/nexus';
import { Dialog } from 'aether/primitives';

describe('Dialog', () => {
  it('opens when trigger is clicked', async () => {
    const { getByRole, queryByRole } = render(() => (
      <Dialog>
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Content>Content</Dialog.Content>
      </Dialog>
    ));

    // Initially closed
    expect(queryByRole('dialog')).toBeNull();

    // Click trigger
    await fireEvent.click(getByRole('button', { name: 'Open' }));

    // Now open
    expect(getByRole('dialog')).toBeInTheDocument();
  });

  it('traps focus within dialog', async () => {
    const { getByRole } = render(() => (
      <Dialog defaultOpen>
        <Dialog.Content>
          <button>First</button>
          <button>Last</button>
        </Dialog.Content>
      </Dialog>
    ));

    const dialog = getByRole('dialog');
    const firstButton = getByRole('button', { name: 'First' });
    const lastButton = getByRole('button', { name: 'Last' });

    // Tab from last button should focus first button
    lastButton.focus();
    await fireEvent.keyDown(document, { key: 'Tab' });
    expect(firstButton).toHaveFocus();
  });

  it('closes on Escape key', async () => {
    const { getByRole, queryByRole } = render(() => (
      <Dialog defaultOpen>
        <Dialog.Content>Content</Dialog.Content>
      </Dialog>
    ));

    expect(getByRole('dialog')).toBeInTheDocument();

    await fireEvent.keyDown(document, { key: 'Escape' });

    expect(queryByRole('dialog')).toBeNull();
  });
});
```

### Accessibility Testing

```typescript
import { axe } from 'jest-axe';

it('has no accessibility violations', async () => {
  const { container } = render(() => (
    <Dialog defaultOpen>
      <Dialog.Content>
        <Dialog.Title>Title</Dialog.Title>
        <Dialog.Description>Description</Dialog.Description>
        <p>Content</p>
        <Dialog.Close>Close</Dialog.Close>
      </Dialog.Content>
    </Dialog>
  ));

  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

---

## Advanced Patterns

### Custom Primitives

Build your own primitives following the same patterns:

```typescript
// components/primitives/Rating.tsx
import { defineComponent, signal, injectContext, provideContext } from 'aether';

interface RatingContextValue {
  value: Signal<number>;
  max: number;
  readonly: boolean;
  setValue: (value: number) => void;
}

const RatingContext = createContext<RatingContextValue>('Rating');

export const Rating = defineComponent((props) => {
  const value = signal(props.defaultValue || 0);
  const max = props.max || 5;
  const readonly = props.readonly || false;

  const setValue = (newValue: number) => {
    if (!readonly) {
      value(newValue);
      props.onValueChange?.(newValue);
    }
  };

  provideContext(RatingContext, {
    value,
    max,
    readonly,
    setValue
  });

  return () => (
    <div role="group" aria-label="Rating" {...props}>
      <slot />
    </div>
  );
});

export const RatingItem = defineComponent((props) => {
  const ctx = injectContext(RatingContext);
  const itemValue = props.value;

  const isActive = computed(() => itemValue <= ctx.value());

  const handleClick = () => {
    ctx.value.set(itemValue);
  };

  return () => (
    <button
      role="radio"
      aria-checked={isActive()}
      aria-label={`${itemValue} stars`}
      data-active={isActive()}
      on:click={handleClick}
      disabled={ctx.readonly}
      {...props}
    >
      <slot />
    </button>
  );
});
```

Usage:

```typescript
import { defineComponent, signal } from 'aether';
const Example324 = defineComponent(() => {
  const rating = signal(3);

  return () => (
    <Rating bind:value={rating} max={5}>
      {#each Array(5) as _, i}
        <RatingItem value={i + 1} class="rating-star">
          <StarIcon />
        </RatingItem>
      {/each}
    </Rating>
  );
});
```

### Polymorphic Components (`asChild`)

Allow components to merge props into children:

```typescript
// Implementation
export const Button = defineComponent((props) => {
  if (props.asChild) {
    // Merge props into child element
    return () => (
      <slot {...omit(props, ['asChild'])} />
    );
  }

  return () => (
    <button {...props}>
      <slot />
    </button>
  );
});
```

Usage:

```html
<!-- Renders a button -->
<Button class="my-btn">Click me</Button>

<!-- Renders an anchor with button props -->
<Button asChild>
  <a href="/profile" class="my-btn">Profile</a>
</Button>
```

---

## Best Practices

### 1. Always Provide Labels and Descriptions

```html
<!-- ✅ Good - Has title and description -->
<Dialog>
  <Dialog.Content>
    <Dialog.Title>Delete Account</Dialog.Title>
    <Dialog.Description>
      This action cannot be undone
    </Dialog.Description>
    <!-- content -->
  </Dialog.Content>
</Dialog>

<!-- ❌ Bad - Missing title/description -->
<Dialog>
  <Dialog.Content>
    <p>This action cannot be undone</p>
  </Dialog.Content>
</Dialog>
```

### 2. Use Controlled State When Needed

```typescript
// ✅ Good - Controlled when you need external state
import { defineComponent, signal } from 'aether';

const ControlledExample = defineComponent(() => {
  const isOpen = signal(false);

  // Can control from outside
  const openFromElsewhere = () => isOpen(true);

  return () => (
    <Dialog bind:open={isOpen}>
      {/* ... */}
    </Dialog>
  );
});

// ✅ Also Good - Uncontrolled when internal state is fine
const UncontrolledExample = defineComponent(() => {
  return () => (
    <Dialog>
      {/* ... */}
    </Dialog>
  );
});
```

### 3. Keyboard Navigation Must Work

Test all primitives with keyboard only:
- Tab to focus
- Enter/Space to activate
- Escape to close
- Arrow keys to navigate
- Home/End for first/last

### 4. Mobile Touch Support

```css
/* Increase touch target sizes */
.dialog-trigger,
.dialog-close {
  min-width: 44px;
  min-height: 44px;
}

/* Responsive sizing */
@media (max-width: 640px) {
  .dialog-content {
    width: 100vw;
    max-width: none;
    border-radius: 0;
  }
}
```

### 5. Avoid Nesting Modal Overlays

```html
<!-- ❌ Avoid - Confusing UX -->
<Dialog>
  <Dialog.Content>
    <Dialog>
      <Dialog.Content>
        <!-- Nested dialog -->
      </Dialog.Content>
    </Dialog>
  </Dialog.Content>
</Dialog>

<!-- ✅ Better - Use Sheet or step-based flow -->
<Dialog>
  <Dialog.Content>
    {#if step() === 1}
      <FirstStep />
    {:else}
      <SecondStep />
    {/if}
  </Dialog.Content>
</Dialog>
```

### 6. Performance - Virtual Scrolling for Large Lists

```typescript
import { defineComponent } from 'aether';
import { VirtualScroller } from 'aether/primitives';

const Example327 = defineComponent(() => {
  const items = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `Item ${i}` }));

  return () => (
    <Select>
      <Select.Content>
        <VirtualScroller items={items} itemHeight={32}>
          {#let item}
            <Select.Item value={item.id}>
              {item.name}
            </Select.Item>
          {/let}
        </VirtualScroller>
      </Select.Content>
    </Select>
  );
});
```

### 7. Error Boundaries

```typescript
import { defineComponent } from 'aether';
import { ErrorBoundary } from 'aether';

const Example884 = defineComponent(() => {

  return () => (
    <ErrorBoundary fallback={(error) => (
      <div class="error-state">
        <p>Something went wrong</p>
        <pre>{error.message}</pre>
      </div>
    )}>
      <Dialog>
        <!-- ... -->
      </Dialog>
    </ErrorBoundary>
  );
});
```

### 8. Loading States

```typescript
import { defineComponent, signal } from 'aether';
const Example914 = defineComponent(() => {
  const isLoading = signal(true);
  const data = signal(null);
  onMount(async () => {
    const result = await fetchData();
    data(result);
    isLoading(false);
  });

  return () => (
    <Select disabled={isLoading()}>
      <Select.Trigger>
        {#if isLoading()}
          Loading...
        {:else}
          <Select.Value placeholder="Select option" />
        {/if}
      </Select.Trigger>
      {#if !isLoading()}
        <Select.Content>
          <!-- options -->
        </Select.Content>
      {/if}
    </Select>
  );
});
```

---

## Summary

Aether Primitives provide:

✅ **Unstyled, accessible UI components** - Full control over presentation
✅ **WAI-ARIA compliant** - Accessibility baked in
✅ **Keyboard navigation** - Full keyboard support out of the box
✅ **Composable** - Build complex UIs from simple primitives
✅ **Type-safe** - Full TypeScript support
✅ **Framework coherent** - Integrates with Aether reactivity, DI, and theming
✅ **Flexible** - Controlled or uncontrolled state management
✅ **Production-ready** - Battle-tested patterns

**Complete primitive list**:
- Dialog, Popover, Dropdown Menu, Select, Combobox
- Tabs, Accordion, Radio Group, Checkbox Group
- Slider, Toggle, Switch, Alert Dialog, Sheet
- Command Palette, DatePicker, Calendar, Form, Table

All primitives follow consistent patterns and are fully documented with examples, API references, and best practices.

---

**End of Specification**
