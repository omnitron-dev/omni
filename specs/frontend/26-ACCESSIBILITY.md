# 26. Accessibility

## Table of Contents
- [Overview](#overview)
- [WCAG Compliance](#wcag-compliance)
- [Semantic HTML](#semantic-html)
- [ARIA Attributes](#aria-attributes)
- [Keyboard Navigation](#keyboard-navigation)
- [Screen Reader Support](#screen-reader-support)
- [Focus Management](#focus-management)
- [Color and Contrast](#color-and-contrast)
- [Accessible Forms](#accessible-forms)
- [Accessible Components](#accessible-components)
- [Motion and Animation](#motion-and-animation)
- [Testing Accessibility](#testing-accessibility)
- [Best Practices](#best-practices)
- [Nexus Integration](#nexus-integration)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Nexus is designed with accessibility as a core principle, not an afterthought. The framework provides built-in tools, components, and patterns to ensure your applications are usable by everyone, including people with disabilities.

### Why Accessibility Matters

```typescript
/**
 * Accessibility benefits everyone:
 * - 15% of the world's population has some form of disability
 * - Improves usability for all users
 * - Better SEO and search engine rankings
 * - Legal compliance (ADA, Section 508, etc.)
 * - Wider audience reach
 * - Better user experience
 */
```

### Core Principles

1. **Perceivable**: Information must be presentable to users in ways they can perceive
2. **Operable**: User interface components must be operable
3. **Understandable**: Information and operation must be understandable
4. **Robust**: Content must be robust enough to work with assistive technologies

### Nexus Accessibility Features

- **Semantic HTML by default**: Framework encourages proper markup
- **ARIA attributes**: Built-in support for ARIA roles and properties
- **Keyboard navigation**: All interactive elements keyboard-accessible
- **Focus management**: Automatic and manual focus control
- **Screen reader support**: Optimized for screen reader usage
- **High contrast themes**: Theme system supports accessibility themes
- **Reduced motion**: Respect user's motion preferences
- **Testing tools**: Built-in accessibility testing utilities

## WCAG Compliance

Nexus helps you build applications that comply with Web Content Accessibility Guidelines (WCAG) 2.1/2.2.

### Compliance Levels

```typescript
/**
 * WCAG Levels:
 * - Level A: Minimum compliance (basic accessibility)
 * - Level AA: Acceptable compliance (industry standard)
 * - Level AAA: Optimal compliance (highest standard)
 *
 * Nexus targets Level AA by default, with tools for AAA
 */

// Configure accessibility level
export default defineConfig({
  accessibility: {
    level: 'AA', // 'A' | 'AA' | 'AAA'
    strict: true, // Throw errors on violations
    warn: true // Warn on potential issues
  }
});
```

### WCAG 2.1 Level AA Requirements

```typescript
/**
 * Perceivable:
 * - 1.1.1 Non-text Content (A)
 * - 1.2.1 Audio-only and Video-only (A)
 * - 1.2.2 Captions (A)
 * - 1.2.3 Audio Description or Media Alternative (A)
 * - 1.2.4 Captions (Live) (AA)
 * - 1.2.5 Audio Description (AA)
 * - 1.3.1 Info and Relationships (A)
 * - 1.3.2 Meaningful Sequence (A)
 * - 1.3.3 Sensory Characteristics (A)
 * - 1.3.4 Orientation (AA)
 * - 1.3.5 Identify Input Purpose (AA)
 * - 1.4.1 Use of Color (A)
 * - 1.4.2 Audio Control (A)
 * - 1.4.3 Contrast (Minimum) (AA) - 4.5:1
 * - 1.4.4 Resize Text (AA)
 * - 1.4.5 Images of Text (AA)
 * - 1.4.10 Reflow (AA)
 * - 1.4.11 Non-text Contrast (AA) - 3:1
 * - 1.4.12 Text Spacing (AA)
 * - 1.4.13 Content on Hover or Focus (AA)
 *
 * Operable:
 * - 2.1.1 Keyboard (A)
 * - 2.1.2 No Keyboard Trap (A)
 * - 2.1.4 Character Key Shortcuts (A)
 * - 2.2.1 Timing Adjustable (A)
 * - 2.2.2 Pause, Stop, Hide (A)
 * - 2.4.1 Bypass Blocks (A)
 * - 2.4.2 Page Titled (A)
 * - 2.4.3 Focus Order (A)
 * - 2.4.4 Link Purpose (A)
 * - 2.4.5 Multiple Ways (AA)
 * - 2.4.6 Headings and Labels (AA)
 * - 2.4.7 Focus Visible (AA)
 * - 2.5.1 Pointer Gestures (A)
 * - 2.5.2 Pointer Cancellation (A)
 * - 2.5.3 Label in Name (A)
 * - 2.5.4 Motion Actuation (A)
 *
 * Understandable:
 * - 3.1.1 Language of Page (A)
 * - 3.1.2 Language of Parts (AA)
 * - 3.2.1 On Focus (A)
 * - 3.2.2 On Input (A)
 * - 3.2.3 Consistent Navigation (AA)
 * - 3.2.4 Consistent Identification (AA)
 * - 3.3.1 Error Identification (A)
 * - 3.3.2 Labels or Instructions (A)
 * - 3.3.3 Error Suggestion (AA)
 * - 3.3.4 Error Prevention (AA)
 *
 * Robust:
 * - 4.1.1 Parsing (A)
 * - 4.1.2 Name, Role, Value (A)
 * - 4.1.3 Status Messages (AA)
 */
```

### Automated Compliance Checking

```typescript
import { checkAccessibility } from '@nexus/testing';

// During development
if (import.meta.env.DEV) {
  checkAccessibility({
    level: 'AA',
    rules: {
      'color-contrast': true,
      'heading-order': true,
      'image-alt': true,
      'label': true,
      'landmark-unique': true
    }
  });
}

// In tests
describe('Accessibility', () => {
  it('meets WCAG AA standards', async () => {
    const { container } = render(() => <App />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

## Semantic HTML

Nexus encourages the use of semantic HTML elements for better accessibility and SEO.

### Semantic Elements

```typescript
import { defineComponent } from '@nexus/core';

// ✅ Good - Semantic HTML
export default defineComponent(() => {
  return () => (
    <article>
      <header>
        <h1>Article Title</h1>
        <time datetime="2024-01-01">January 1, 2024</time>
      </header>

      <section>
        <h2>Section Title</h2>
        <p>Content...</p>
      </section>

      <footer>
        <nav aria-label="Article navigation">
          <a href="/previous">Previous</a>
          <a href="/next">Next</a>
        </nav>
      </footer>
    </article>
  );
});

// ❌ Bad - Non-semantic divs
export default defineComponent(() => {
  return () => (
    <div class="article">
      <div class="header">
        <div class="title">Article Title</div>
        <div class="date">January 1, 2024</div>
      </div>
      <div class="content">Content...</div>
    </div>
  );
});
```

### Landmark Regions

```typescript
// Main application structure with landmarks
export default defineComponent(() => {
  return () => (
    <>
      {/* Skip to main content link */}
      <a href="#main-content" class="skip-link">
        Skip to main content
      </a>

      <header role="banner">
        <h1>Site Title</h1>
        <nav aria-label="Primary navigation">
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>

      <main id="main-content" role="main">
        <article>
          <h1>Page Title</h1>
          <p>Main content...</p>
        </article>

        <aside role="complementary" aria-label="Related content">
          <h2>Related Articles</h2>
        </aside>
      </main>

      <footer role="contentinfo">
        <p>&copy; 2024 Company Name</p>
      </footer>
    </>
  );
});
```

### Document Structure

```typescript
// Proper heading hierarchy
export default defineComponent(() => {
  return () => (
    <article>
      <h1>Main Title</h1>

      <section>
        <h2>Section 1</h2>
        <p>Content...</p>

        <h3>Subsection 1.1</h3>
        <p>Content...</p>

        <h3>Subsection 1.2</h3>
        <p>Content...</p>
      </section>

      <section>
        <h2>Section 2</h2>
        <p>Content...</p>
      </section>
    </article>
  );
});

// ❌ Bad - Skipping heading levels
// <h1> -> <h3> (skipped h2)
// <h2> -> <h4> (skipped h3)
```

### Lists and Tables

```typescript
// Proper list semantics
export default defineComponent(() => {
  return () => (
    <>
      {/* Unordered list */}
      <ul>
        <li>Item 1</li>
        <li>Item 2</li>
      </ul>

      {/* Ordered list */}
      <ol>
        <li>Step 1</li>
        <li>Step 2</li>
      </ol>

      {/* Definition list */}
      <dl>
        <dt>Term 1</dt>
        <dd>Definition 1</dd>
        <dt>Term 2</dt>
        <dd>Definition 2</dd>
      </dl>

      {/* Accessible table */}
      <table>
        <caption>User Data</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Alice</th>
            <td>alice@example.com</td>
            <td>Admin</td>
          </tr>
        </tbody>
      </table>
    </>
  );
});
```

## ARIA Attributes

ARIA (Accessible Rich Internet Applications) attributes provide additional semantic information for assistive technologies.

### ARIA Roles

```typescript
import { defineComponent } from '@nexus/core';

// Common ARIA roles
export default defineComponent(() => {
  return () => (
    <>
      {/* Navigation */}
      <nav role="navigation" aria-label="Main navigation">
        <a href="/">Home</a>
      </nav>

      {/* Search */}
      <div role="search">
        <label for="search-input">Search</label>
        <input type="search" id="search-input" />
      </div>

      {/* Alert */}
      <div role="alert" aria-live="assertive">
        Error: Invalid input
      </div>

      {/* Status message */}
      <div role="status" aria-live="polite">
        Saving...
      </div>

      {/* Dialog */}
      <div role="dialog" aria-labelledby="dialog-title" aria-modal="true">
        <h2 id="dialog-title">Confirmation</h2>
        <p>Are you sure?</p>
      </div>

      {/* Tablist */}
      <div role="tablist">
        <button role="tab" aria-selected="true" aria-controls="panel-1">
          Tab 1
        </button>
        <button role="tab" aria-selected="false" aria-controls="panel-2">
          Tab 2
        </button>
      </div>
      <div role="tabpanel" id="panel-1">Panel 1 content</div>

      {/* Menu */}
      <div role="menu">
        <div role="menuitem">Option 1</div>
        <div role="menuitem">Option 2</div>
      </div>
    </>
  );
});
```

### ARIA Properties

```typescript
// aria-label and aria-labelledby
export const IconButton = defineComponent((props: { icon: string; label: string }) => {
  return () => (
    <button aria-label={props.label}>
      <Icon name={props.icon} aria-hidden="true" />
    </button>
  );
});

// aria-describedby
export const FormField = defineComponent(() => {
  return () => (
    <div>
      <label for="username">Username</label>
      <input
        type="text"
        id="username"
        aria-describedby="username-help username-error"
      />
      <div id="username-help">Must be 3-20 characters</div>
      <div id="username-error" role="alert">
        Username is required
      </div>
    </div>
  );
});

// aria-expanded for expandable elements
export const Accordion = defineComponent(() => {
  const expanded = signal(false);

  return () => (
    <div>
      <button
        aria-expanded={expanded()}
        aria-controls="accordion-content"
        onClick={() => expanded.set(!expanded())}
      >
        Toggle Content
      </button>
      <div id="accordion-content" hidden={!expanded()}>
        Content...
      </div>
    </div>
  );
});

// aria-pressed for toggle buttons
export const ToggleButton = defineComponent(() => {
  const pressed = signal(false);

  return () => (
    <button
      aria-pressed={pressed()}
      onClick={() => pressed.set(!pressed())}
    >
      {pressed() ? 'Mute' : 'Unmute'}
    </button>
  );
});

// aria-disabled vs disabled
export const Button = defineComponent((props: { disabled?: boolean }) => {
  return () => (
    <>
      {/* Fully disabled - removed from tab order */}
      <button disabled={props.disabled}>Submit</button>

      {/* Visually disabled but still focusable */}
      <button aria-disabled={props.disabled}>Submit</button>
    </>
  );
});
```

### ARIA States

```typescript
// aria-current for current item in navigation
export const NavLink = defineComponent((props: { href: string; current?: boolean }) => {
  return () => (
    <a href={props.href} aria-current={props.current ? 'page' : undefined}>
      {props.children}
    </a>
  );
});

// aria-checked for custom checkboxes
export const Checkbox = defineComponent(() => {
  const checked = signal(false);

  return () => (
    <div
      role="checkbox"
      aria-checked={checked()}
      tabindex="0"
      onClick={() => checked.set(!checked())}
      onKeyPress={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          checked.set(!checked());
        }
      }}
    >
      {checked() ? '☑' : '☐'} Check me
    </div>
  );
});

// aria-selected for selectable items
export const ListBox = defineComponent(() => {
  const selected = signal(0);
  const items = ['Item 1', 'Item 2', 'Item 3'];

  return () => (
    <div role="listbox" aria-label="Options">
      <For each={items}>
        {(item, index) => (
          <div
            role="option"
            aria-selected={selected() === index()}
            onClick={() => selected.set(index())}
          >
            {item}
          </div>
        )}
      </For>
    </div>
  );
});

// aria-invalid for form validation
export const Input = defineComponent((props: { error?: string }) => {
  return () => (
    <>
      <input
        type="text"
        aria-invalid={!!props.error}
        aria-describedby={props.error ? 'error-message' : undefined}
      />
      {props.error && (
        <div id="error-message" role="alert">
          {props.error}
        </div>
      )}
    </>
  );
});
```

### Live Regions

```typescript
import { signal, createEffect } from '@nexus/core';

// Polite live region (non-interrupting)
export const StatusMessage = defineComponent(() => {
  const message = signal('')

  return () => (
    <div role="status" aria-live="polite" aria-atomic="true">
      {message()}
    </div>
  );
});

// Assertive live region (interrupting)
export const ErrorMessage = defineComponent(() => {
  const error = signal('')

  return () => (
    <div role="alert" aria-live="assertive" aria-atomic="true">
      {error()}
    </div>
  );
});

// Loading state with live region
export const LoadingIndicator = defineComponent(() => {
  const loading = signal(false);

  return () => (
    <>
      {loading() && (
        <div role="status" aria-live="polite" aria-busy="true">
          <div class="spinner" aria-hidden="true"></div>
          <span>Loading...</span>
        </div>
      )}
    </>
  );
});

// Dynamic content updates
export const NotificationCenter = defineComponent(() => {
  const notifications = signal<string[]>([]);

  return () => (
    <div
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-atomic="false"
    >
      <For each={notifications()}>
        {(notification) => <div>{notification}</div>}
      </For>
    </div>
  );
});
```

## Keyboard Navigation

All interactive elements must be keyboard-accessible.

### Tab Order and Focus

```typescript
import { defineComponent } from '@nexus/core';

// Natural tab order
export default defineComponent(() => {
  return () => (
    <form>
      {/* Tab order: 1 -> 2 -> 3 -> 4 */}
      <input type="text" placeholder="First" />
      <input type="text" placeholder="Second" />
      <button type="submit">Submit</button>
      <button type="button">Cancel</button>
    </form>
  );
});

// Custom focusable elements
export const CustomButton = defineComponent(() => {
  return () => (
    <div
      role="button"
      tabindex="0"
      onClick={handleClick}
      onKeyPress={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      Click me
    </div>
  );
});

// Skip to main content
export const SkipLink = defineComponent(() => {
  return () => (
    <a href="#main-content" class="skip-link">
      Skip to main content
    </a>
  );
});

// Focus trap in modal
export const Modal = defineComponent(() => {
  let firstFocusable: HTMLElement;
  let lastFocusable: HTMLElement;

  onMount(() => {
    const focusable = modalRef.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable = focusable[0] as HTMLElement;
    lastFocusable = focusable[focusable.length - 1] as HTMLElement;
    firstFocusable?.focus();
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    }

    if (e.key === 'Escape') {
      closeModal();
    }
  };

  return () => (
    <div
      role="dialog"
      aria-modal="true"
      onKeyDown={handleKeyDown}
      ref={modalRef}
    >
      <h2>Modal Title</h2>
      <p>Modal content...</p>
      <button onClick={closeModal}>Close</button>
    </div>
  );
});
```

### Keyboard Shortcuts

```typescript
import { onMount, onCleanup } from '@nexus/core';

// Global keyboard shortcuts
export const useKeyboardShortcuts = () => {
  const shortcuts = new Map<string, () => void>();

  const handleKeyDown = (e: KeyboardEvent) => {
    const key = [
      e.ctrlKey && 'Ctrl',
      e.altKey && 'Alt',
      e.shiftKey && 'Shift',
      e.key
    ]
      .filter(Boolean)
      .join('+');

    const handler = shortcuts.get(key);
    if (handler) {
      e.preventDefault();
      handler();
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  return {
    register: (key: string, handler: () => void) => {
      shortcuts.set(key, handler);
    },
    unregister: (key: string) => {
      shortcuts.delete(key);
    }
  };
};

// Usage
export default defineComponent(() => {
  const shortcuts = useKeyboardShortcuts();

  onMount(() => {
    shortcuts.register('Ctrl+s', () => save());
    shortcuts.register('Ctrl+k', () => openCommandPalette());
    shortcuts.register('/', () => focusSearch());
  });

  return () => (
    <div>
      <kbd>Ctrl+S</kbd> to save
      <kbd>Ctrl+K</kbd> to open command palette
      <kbd>/</kbd> to search
    </div>
  );
});
```

### Arrow Key Navigation

```typescript
// List navigation with arrow keys
export const NavigableList = defineComponent((props: { items: string[] }) => {
  const activeIndex = signal(0);

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        activeIndex.set((prev) => Math.min(prev + 1, props.items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        activeIndex.set((prev) => Math.max(prev - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        activeIndex.set(0);
        break;
      case 'End':
        e.preventDefault();
        activeIndex.set(props.items.length - 1);
        break;
      case 'Enter':
        selectItem(activeIndex());
        break;
    }
  };

  return () => (
    <div role="listbox" onKeyDown={handleKeyDown} tabindex="0">
      <For each={props.items}>
        {(item, index) => (
          <div
            role="option"
            aria-selected={activeIndex() === index()}
            id={`option-${index()}`}
          >
            {item}
          </div>
        )}
      </For>
    </div>
  );
});

// Grid navigation (2D)
export const DataGrid = defineComponent(() => {
  const row = signal(0);
  const col = signal(0);

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        col.set((c) => Math.min(c + 1, maxCols - 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        col.set((c) => Math.max(c - 1, 0));
        break;
      case 'ArrowDown':
        e.preventDefault();
        row.set((r) => Math.min(r + 1, maxRows - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        row.set((r) => Math.max(r - 1, 0));
        break;
    }
  };

  return () => (
    <div role="grid" onKeyDown={handleKeyDown}>
      {/* Grid content */}
    </div>
  );
});
```

## Screen Reader Support

Optimize your application for screen reader users.

### Screen Reader Text

```typescript
// Visually hidden but accessible to screen readers
export const VisuallyHidden = defineComponent((props) => {
  return () => (
    <span class="sr-only">
      {props.children}
    </span>
  );
});

// CSS for sr-only
const styles = css({
  '.sr-only': {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0
  }
});

// Usage
export const IconButton = defineComponent(() => {
  return () => (
    <button>
      <Icon name="close" aria-hidden="true" />
      <VisuallyHidden>Close dialog</VisuallyHidden>
    </button>
  );
});
```

### Descriptive Labels

```typescript
// Good labels for screen readers
export const SearchForm = defineComponent(() => {
  return () => (
    <form role="search">
      {/* Visible label */}
      <label for="search-input">Search</label>
      <input type="search" id="search-input" />

      {/* aria-label when visual label not needed */}
      <button aria-label="Submit search">
        <Icon name="search" aria-hidden="true" />
      </button>

      {/* aria-labelledby for complex labels */}
      <div id="filter-label">Filter by:</div>
      <select aria-labelledby="filter-label">
        <option>All</option>
        <option>Active</option>
      </select>
    </form>
  );
});

// Descriptive link text
export const Links = defineComponent(() => {
  return () => (
    <>
      {/* ❌ Bad - Unclear context */}
      <a href="/article">Click here</a>

      {/* ✅ Good - Descriptive */}
      <a href="/article">Read the full article</a>

      {/* ✅ Good - With aria-label */}
      <a href="/article" aria-label="Read more about accessibility">
        Read more
      </a>
    </>
  );
});
```

### Announcements

```typescript
import { createSignal, createEffect } from '@nexus/core';

// Announce messages to screen readers
export const useAnnouncer = () => {
  const message = signal('')
  const politeness = signal<'polite' | 'assertive'>('polite');

  const announce = (msg: string, level: 'polite' | 'assertive' = 'polite') => {
    politeness.set(level);
    message.set(''); // Clear first to ensure announcement
    setTimeout(() => message.set(msg), 100);
  };

  return { message, politeness, announce };
};

// Announcer component
export const Announcer = defineComponent(() => {
  const { message, politeness } = useAnnouncer();

  return () => (
    <div
      role="status"
      aria-live={politeness()}
      aria-atomic="true"
      class="sr-only"
    >
      {message()}
    </div>
  );
});

// Usage
export default defineComponent(() => {
  const { announce } = useAnnouncer();

  const handleSave = async () => {
    announce('Saving...', 'polite');
    await save();
    announce('Saved successfully!', 'polite');
  };

  const handleError = () => {
    announce('Error: Failed to save', 'assertive');
  };

  return () => (
    <>
      <Announcer />
      <button onClick={handleSave}>Save</button>
    </>
  );
});
```

### Table Accessibility

```typescript
// Accessible data table for screen readers
export const DataTable = defineComponent((props: { data: User[] }) => {
  return () => (
    <table>
      <caption>User Directory</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Email</th>
          <th scope="col">Role</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.data}>
          {(user) => (
            <tr>
              <th scope="row">{user.name}</th>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>
                <button aria-label={`Edit ${user.name}`}>
                  <Icon name="edit" aria-hidden="true" />
                </button>
                <button aria-label={`Delete ${user.name}`}>
                  <Icon name="delete" aria-hidden="true" />
                </button>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
});

// Complex table with row and column headers
export const ComplexTable = defineComponent(() => {
  return () => (
    <table>
      <caption>Quarterly Revenue by Region</caption>
      <thead>
        <tr>
          <td></td>
          <th scope="col">Q1</th>
          <th scope="col">Q2</th>
          <th scope="col">Q3</th>
          <th scope="col">Q4</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">North</th>
          <td>$100K</td>
          <td>$150K</td>
          <td>$200K</td>
          <td>$250K</td>
        </tr>
        <tr>
          <th scope="row">South</th>
          <td>$80K</td>
          <td>$120K</td>
          <td>$160K</td>
          <td>$200K</td>
        </tr>
      </tbody>
    </table>
  );
});
```

## Focus Management

Proper focus management is critical for keyboard navigation and screen reader users.

### Focus Styles

```typescript
// Always provide visible focus indicators
const styles = css({
  'button:focus-visible': {
    outline: '2px solid $primary',
    outlineOffset: '2px'
  },

  'a:focus-visible': {
    outline: '2px solid $primary',
    outlineOffset: '2px'
  },

  // Don't remove focus outline!
  // ❌ 'button:focus': { outline: 'none' }
});

// Custom focus ring
export const FocusRing = defineComponent((props) => {
  const focused = signal(false);

  return () => (
    <div
      class={focused() ? 'focused' : ''}
      onFocus={() => focused.set(true)}
      onBlur={() => focused.set(false)}
    >
      {props.children}
      {focused() && <div class="focus-ring" />}
    </div>
  );
});
```

### Programmatic Focus

```typescript
import { ref, onMount } from '@nexus/core';

// Focus on mount
export const SearchModal = defineComponent(() => {
  let inputRef: HTMLInputElement;

  onMount(() => {
    inputRef?.focus();
  });

  return () => (
    <dialog open>
      <input type="search" ref={inputRef} placeholder="Search..." />
    </dialog>
  );
});

// Focus after action
export const TodoList = defineComponent(() => {
  const todos = signal<Todo[]>([]);
  let newTodoRef: HTMLInputElement;

  const addTodo = (text: string) => {
    todos.set([...todos(), { id: Date.now(), text }]);
    newTodoRef?.focus();
  };

  return () => (
    <>
      <input
        ref={newTodoRef}
        type="text"
        placeholder="New todo"
        onKeyPress={(e) => {
          if (e.key === 'Enter') {
            addTodo(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
      <ul>
        <For each={todos()}>
          {(todo) => <li>{todo.text}</li>}
        </For>
      </ul>
    </>
  );
});

// Restore focus after modal close
export const useModal = () => {
  let previousFocus: HTMLElement | null = null;

  const open = () => {
    previousFocus = document.activeElement as HTMLElement;
    // Open modal and focus first element
  };

  const close = () => {
    // Close modal
    previousFocus?.focus();
    previousFocus = null;
  };

  return { open, close };
};
```

### Focus Trap

```typescript
// Reusable focus trap
export const useFocusTrap = (containerRef: () => HTMLElement | undefined) => {
  let firstFocusable: HTMLElement | null = null;
  let lastFocusable: HTMLElement | null = null;

  const updateFocusableElements = () => {
    const container = containerRef();
    if (!container) return;

    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), ' +
      'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    firstFocusable = focusable[0] || null;
    lastFocusable = focusable[focusable.length - 1] || null;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    updateFocusableElements();

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable?.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable?.focus();
      }
    }
  };

  return { handleKeyDown, updateFocusableElements };
};

// Usage in dialog
export const Dialog = defineComponent(() => {
  let dialogRef: HTMLElement;
  const focusTrap = useFocusTrap(() => dialogRef);

  onMount(() => {
    focusTrap.updateFocusableElements();
  });

  return () => (
    <div
      role="dialog"
      aria-modal="true"
      ref={dialogRef}
      onKeyDown={focusTrap.handleKeyDown}
    >
      <h2>Dialog Title</h2>
      <button>Action</button>
      <button>Close</button>
    </div>
  );
});
```

### Focus Management Utilities

```typescript
// Check if element is focusable
export const isFocusable = (element: HTMLElement): boolean => {
  if (element.hasAttribute('disabled')) return false;
  if (element.getAttribute('tabindex') === '-1') return false;

  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ];

  return focusableSelectors.some(sel => element.matches(sel));
};

// Get all focusable elements
export const getFocusableElements = (container: HTMLElement): HTMLElement[] => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), ' +
      'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
};

// Focus first element
export const focusFirst = (container: HTMLElement) => {
  const elements = getFocusableElements(container);
  elements[0]?.focus();
};

// Focus last element
export const focusLast = (container: HTMLElement) => {
  const elements = getFocusableElements(container);
  elements[elements.length - 1]?.focus();
};
```

## Color and Contrast

Ensure sufficient color contrast for readability.

### Contrast Ratios

```typescript
/**
 * WCAG Contrast Requirements:
 * - AA: 4.5:1 for normal text, 3:1 for large text (18pt+)
 * - AAA: 7:1 for normal text, 4.5:1 for large text
 * - UI Components: 3:1 minimum contrast
 */

// Theme with accessible colors
export const theme = createTheme({
  colors: {
    // Text on white background
    text: '#1a1a1a',        // 16.4:1 contrast (AAA)
    textSecondary: '#4a4a4a', // 9.3:1 contrast (AAA)
    textMuted: '#757575',   // 4.5:1 contrast (AA)

    // Background colors
    background: '#ffffff',
    surface: '#f5f5f5',

    // Primary colors with accessible contrast
    primary: '#0066cc',     // 4.7:1 on white (AA)
    primaryDark: '#004499', // 7.5:1 on white (AAA)
    onPrimary: '#ffffff',   // 7.5:1 on primary (AAA)

    // Error colors
    error: '#c62828',       // 5.5:1 on white (AA)
    onError: '#ffffff',     // 8.2:1 on error (AAA)

    // Success colors
    success: '#2e7d32',     // 4.7:1 on white (AA)
    onSuccess: '#ffffff'    // 7.8:1 on success (AAA)
  }
});

// Verify contrast during development
if (import.meta.env.DEV) {
  const contrastRatio = calculateContrast('#0066cc', '#ffffff');
  if (contrastRatio < 4.5) {
    console.warn('Insufficient contrast ratio:', contrastRatio);
  }
}
```

### Don't Rely on Color Alone

```typescript
// ❌ Bad - Only uses color to convey information
export const BadStatus = defineComponent((props: { status: string }) => {
  const color = props.status === 'success' ? 'green' : 'red';

  return () => (
    <div style={{ color }}>
      {props.status}
    </div>
  );
});

// ✅ Good - Uses color + icon + text
export const GoodStatus = defineComponent((props: { status: string }) => {
  const isSuccess = props.status === 'success';

  return () => (
    <div class={isSuccess ? 'status-success' : 'status-error'}>
      <Icon name={isSuccess ? 'check-circle' : 'error-circle'} />
      <span>{isSuccess ? 'Success' : 'Error'}</span>
    </div>
  );
});

// Form validation with multiple indicators
export const FormField = defineComponent((props: { error?: string }) => {
  return () => (
    <div class={props.error ? 'field-error' : 'field-valid'}>
      <label>
        Email
        {props.error && <Icon name="error" />}
      </label>
      <input
        type="email"
        aria-invalid={!!props.error}
        aria-describedby={props.error ? 'email-error' : undefined}
      />
      {props.error && (
        <div id="email-error" role="alert" class="error-message">
          <Icon name="error" />
          {props.error}
        </div>
      )}
    </div>
  );
});
```

### High Contrast Mode

```typescript
// Detect and support high contrast mode
export const useHighContrast = () => {
  const highContrast = signal(false);

  onMount(() => {
    // Check for Windows High Contrast mode
    const mediaQuery = window.matchMedia('(prefers-contrast: high)');
    highContrast.set(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => {
      highContrast.set(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    onCleanup(() => mediaQuery.removeEventListener('change', handler));
  });

  return highContrast;
};

// High contrast theme
export const HighContrastTheme = defineComponent(() => {
  const highContrast = useHighContrast();

  createEffect(() => {
    if (highContrast()) {
      document.body.classList.add('high-contrast');
    } else {
      document.body.classList.remove('high-contrast');
    }
  });

  return null;
});

// CSS for high contrast
const styles = css({
  '.high-contrast': {
    '--text-color': '#000000',
    '--background-color': '#ffffff',
    '--border-color': '#000000',
    '--link-color': '#0000ff',

    button: {
      border: '2px solid var(--border-color)'
    }
  }
});
```

### Color Blindness

```typescript
// Use patterns in addition to colors
export const Chart = defineComponent((props: { data: ChartData[] }) => {
  return () => (
    <svg viewBox="0 0 400 300">
      {/* Use different patterns, not just colors */}
      <For each={props.data}>
        {(item, index) => (
          <rect
            x={index() * 50}
            y={300 - item.value}
            width="40"
            height={item.value}
            fill={`var(--color-${index()})`}
            // Add pattern for color-blind users
            style={{
              'stroke': '#000',
              'stroke-width': index() % 2 === 0 ? '0' : '2',
              'fill-opacity': index() % 3 === 0 ? '0.5' : '1'
            }}
          />
        )}
      </For>
    </svg>
  );
});
```

## Accessible Forms

Forms must be accessible to all users.

### Labels and Instructions

```typescript
// Always provide labels
export const FormField = defineComponent(() => {
  return () => (
    <div>
      {/* ✅ Explicit label */}
      <label for="username">Username</label>
      <input type="text" id="username" />

      {/* ✅ Implicit label */}
      <label>
        Email
        <input type="email" />
      </label>

      {/* ✅ aria-label when visual label not possible */}
      <input type="search" aria-label="Search" placeholder="Search..." />

      {/* ❌ Missing label */}
      <input type="text" placeholder="Username" />
    </div>
  );
});

// Required fields
export const RequiredField = defineComponent(() => {
  return () => (
    <div>
      <label for="email">
        Email
        <abbr title="required" aria-label="required">*</abbr>
      </label>
      <input
        type="email"
        id="email"
        required
        aria-required="true"
      />
    </div>
  );
});

// Field instructions
export const FieldWithInstructions = defineComponent(() => {
  return () => (
    <div>
      <label for="password">Password</label>
      <input
        type="password"
        id="password"
        aria-describedby="password-hint"
      />
      <div id="password-hint">
        Must be at least 8 characters with uppercase, lowercase, and numbers
      </div>
    </div>
  );
});
```

### Form Validation

```typescript
import { createForm } from '@nexus/forms';

// Accessible form validation
export const SignupForm = defineComponent(() => {
  const form = createForm({
    initialValues: {
      email: '',
      password: ''
    },
    validate: (values) => {
      const errors: any = {};

      if (!values.email) {
        errors.email = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
        errors.email = 'Invalid email format';
      }

      if (!values.password) {
        errors.password = 'Password is required';
      } else if (values.password.length < 8) {
        errors.password = 'Password must be at least 8 characters';
      }

      return errors;
    },
    onSubmit: async (values) => {
      await signup(values);
    }
  });

  return () => (
    <form onSubmit={form.handleSubmit}>
      {/* Email field */}
      <div>
        <label for="email">Email</label>
        <input
          type="email"
          id="email"
          name="email"
          value={form.values.email}
          onInput={form.handleChange}
          onBlur={form.handleBlur}
          aria-invalid={form.touched.email && !!form.errors.email}
          aria-describedby={
            form.touched.email && form.errors.email
              ? 'email-error'
              : undefined
          }
        />
        {form.touched.email && form.errors.email && (
          <div id="email-error" role="alert" class="error">
            <Icon name="error" aria-hidden="true" />
            {form.errors.email}
          </div>
        )}
      </div>

      {/* Password field */}
      <div>
        <label for="password">Password</label>
        <input
          type="password"
          id="password"
          name="password"
          value={form.values.password}
          onInput={form.handleChange}
          onBlur={form.handleBlur}
          aria-invalid={form.touched.password && !!form.errors.password}
          aria-describedby="password-hint password-error"
        />
        <div id="password-hint">Must be at least 8 characters</div>
        {form.touched.password && form.errors.password && (
          <div id="password-error" role="alert" class="error">
            {form.errors.password}
          </div>
        )}
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={form.isSubmitting}
        aria-busy={form.isSubmitting}
      >
        {form.isSubmitting ? 'Signing up...' : 'Sign up'}
      </button>

      {/* Form-level errors */}
      {form.submitError && (
        <div role="alert" class="form-error">
          {form.submitError}
        </div>
      )}
    </form>
  );
});
```

### Fieldsets and Groups

```typescript
// Group related fields
export const AddressForm = defineComponent(() => {
  return () => (
    <fieldset>
      <legend>Shipping Address</legend>

      <div>
        <label for="street">Street</label>
        <input type="text" id="street" />
      </div>

      <div>
        <label for="city">City</label>
        <input type="text" id="city" />
      </div>

      <div>
        <label for="zip">ZIP Code</label>
        <input type="text" id="zip" />
      </div>
    </fieldset>
  );
});

// Radio button groups
export const RadioGroup = defineComponent() => {
  const selected = signal('option1');

  return () => (
    <fieldset>
      <legend>Choose an option</legend>

      <div>
        <input
          type="radio"
          id="option1"
          name="options"
          value="option1"
          checked={selected() === 'option1'}
          onChange={(e) => selected.set(e.currentTarget.value)}
        />
        <label for="option1">Option 1</label>
      </div>

      <div>
        <input
          type="radio"
          id="option2"
          name="options"
          value="option2"
          checked={selected() === 'option2'}
          onChange={(e) => selected.set(e.currentTarget.value)}
        />
        <label for="option2">Option 2</label>
      </div>
    </fieldset>
  );
});
```

## Accessible Components

All Nexus components are built with accessibility in mind.

### Button

```typescript
// Accessible button component
export const Button = defineComponent((props: {
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) => {
  return () => (
    <button
      class={`btn btn-${props.variant || 'primary'}`}
      disabled={props.disabled || props.loading}
      aria-busy={props.loading}
      onClick={props.onClick}
    >
      {props.loading && (
        <>
          <span class="spinner" aria-hidden="true"></span>
          <VisuallyHidden>Loading...</VisuallyHidden>
        </>
      )}
      {props.children}
    </button>
  );
});
```

### Dialog/Modal

```typescript
// Accessible modal dialog
export const Dialog = defineComponent((props: {
  open: boolean;
  onClose: () => void;
  title: string;
}) => {
  let dialogRef: HTMLDialogElement;
  let previousFocus: HTMLElement | null = null;

  createEffect(() => {
    if (props.open) {
      previousFocus = document.activeElement as HTMLElement;
      dialogRef?.showModal();
      // Focus first element
    } else {
      dialogRef?.close();
      previousFocus?.focus();
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onClose();
    }
  };

  return () => (
    <Show when={props.open}>
      <dialog
        ref={dialogRef}
        aria-labelledby="dialog-title"
        aria-modal="true"
        onKeyDown={handleKeyDown}
        onClick={(e) => {
          // Close on backdrop click
          if (e.target === dialogRef) {
            props.onClose();
          }
        }}
      >
        <div class="dialog-content">
          <h2 id="dialog-title">{props.title}</h2>
          {props.children}
          <button onClick={props.onClose}>Close</button>
        </div>
      </dialog>
    </Show>
  );
});
```

### Tooltip

```typescript
// Accessible tooltip
export const Tooltip = defineComponent((props: {
  content: string;
}) => {
  const visible = signal(false);
  const tooltipId = createUniqueId();

  return () => (
    <span class="tooltip-wrapper">
      <button
        aria-describedby={visible() ? tooltipId : undefined}
        onMouseEnter={() => isVisible.set(true)}
        onMouseLeave={() => isVisible.set(false)}
        onFocus={() => isVisible.set(true)}
        onBlur={() => isVisible.set(false)}
      >
        {props.children}
      </button>

      {visible() && (
        <div
          id={tooltipId}
          role="tooltip"
          class="tooltip"
        >
          {props.content}
        </div>
      )}
    </span>
  );
});
```

### Tabs

```typescript
// Accessible tabs component
export const Tabs = defineComponent((props: {
  tabs: Array<{ id: string; label: string; content: JSX.Element }>;
}) => {
  const activeTab = signal(0);

  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        activeTab.set((index + 1) % props.tabs.length);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        activeTab.set((index - 1 + props.tabs.length) % props.tabs.length);
        break;
      case 'Home':
        e.preventDefault();
        activeTab.set(0);
        break;
      case 'End':
        e.preventDefault();
        activeTab.set(props.tabs.length - 1);
        break;
    }
  };

  return () => (
    <div>
      <div role="tablist">
        <For each={props.tabs}>
          {(tab, index) => (
            <button
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={activeTab() === index()}
              aria-controls={`panel-${tab.id}`}
              tabindex={activeTab() === index() ? 0 : -1}
              onClick={() => activeTab.set(index())}
              onKeyDown={(e) => handleKeyDown(e, index())}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>

      <For each={props.tabs}>
        {(tab, index) => (
          <div
            role="tabpanel"
            id={`panel-${tab.id}`}
            aria-labelledby={`tab-${tab.id}`}
            hidden={activeTab() !== index()}
            tabindex="0"
          >
            {tab.content}
          </div>
        )}
      </For>
    </div>
  );
});
```

### Menu

```typescript
// Accessible dropdown menu
export const Menu = defineComponent((props: {
  trigger: JSX.Element;
  items: Array<{ label: string; onClick: () => void }>;
}) => {
  const open = signal(false);
  const activeIndex = signal(0);

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        activeIndex.set((prev) => (prev + 1) % props.items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        activeIndex.set((prev) => (prev - 1 + props.items.length) % props.items.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        props.items[activeIndex()].onClick();
        open.set(false);
        break;
      case 'Escape':
        e.preventDefault();
        open.set(false);
        break;
    }
  };

  return () => (
    <div class="menu">
      <button
        aria-haspopup="true"
        aria-expanded={open()}
        onClick={() => open.set(!open())}
      >
        {props.trigger}
      </button>

      {open() && (
        <div
          role="menu"
          onKeyDown={handleKeyDown}
        >
          <For each={props.items}>
            {(item, index) => (
              <div
                role="menuitem"
                tabindex={activeIndex() === index() ? 0 : -1}
                onClick={() => {
                  item.onClick();
                  open.set(false);
                }}
              >
                {item.label}
              </div>
            )}
          </For>
        </div>
      )}
    </div>
  );
});
```

## Motion and Animation

Respect user preferences for reduced motion.

### Prefers Reduced Motion

```typescript
// Detect reduced motion preference
export const usePrefersReducedMotion = () => {
  const reducedMotion = signal(false);

  onMount(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.set(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => {
      reducedMotion.set(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    onCleanup(() => mediaQuery.removeEventListener('change', handler));
  });

  return reducedMotion;
};

// Conditional animation
export const AnimatedComponent = defineComponent(() => {
  const reducedMotion = usePrefersReducedMotion();

  return () => (
    <div
      class={reducedMotion() ? 'no-animation' : 'with-animation'}
    >
      Content
    </div>
  );
});

// CSS
const styles = css({
  '@media (prefers-reduced-motion: reduce)': {
    '*': {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      transitionDuration: '0.01ms !important',
      scrollBehavior: 'auto !important'
    }
  }
});
```

### Safe Animations

```typescript
// Provide option to disable animations
export const useAnimations = () => {
  const enabled = signal(true);
  const reducedMotion = usePrefersReducedMotion();

  const shouldAnimate = computed(() => {
    return enabled() && !reducedMotion();
  });

  return { shouldAnimate, setEnabled };
};

// Fade transition respecting preferences
export const FadeTransition = defineComponent(() => {
  const { shouldAnimate } = useAnimations();

  return () => (
    <div
      class={shouldAnimate() ? 'fade-enter' : 'fade-instant'}
    >
      {props.children}
    </div>
  );
});
```

## Testing Accessibility

Nexus provides tools for testing accessibility.

### Automated Testing

```typescript
import { render } from '@nexus/testing';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

describe('Component Accessibility', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(() => <MyComponent />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has proper ARIA attributes', () => {
    const { getByRole } = render(() => <Button>Click me</Button>);
    const button = getByRole('button');
    expect(button).toHaveAccessibleName('Click me');
  });

  it('supports keyboard navigation', async () => {
    const { getByRole } = render(() => <Menu />);
    const trigger = getByRole('button');

    // Open menu with Enter key
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(getByRole('menu')).toBeVisible();

    // Navigate with arrow keys
    await fireEvent.keyDown(getByRole('menu'), { key: 'ArrowDown' });
    expect(getByRole('menuitem')).toHaveFocus();
  });
});
```

### Manual Testing Checklist

```typescript
/**
 * Manual Accessibility Testing Checklist:
 *
 * Keyboard Navigation:
 * - [ ] All interactive elements are keyboard accessible
 * - [ ] Tab order is logical
 * - [ ] Focus indicators are visible
 * - [ ] No keyboard traps
 * - [ ] Esc key closes modals/dialogs
 *
 * Screen Readers:
 * - [ ] All images have alt text
 * - [ ] Form fields have labels
 * - [ ] Headings are in logical order
 * - [ ] Landmarks are properly defined
 * - [ ] Dynamic content updates are announced
 *
 * Visual:
 * - [ ] Sufficient color contrast (4.5:1 minimum)
 * - [ ] Content is readable at 200% zoom
 * - [ ] Information not conveyed by color alone
 * - [ ] Focus indicators are visible
 *
 * Content:
 * - [ ] Page has descriptive title
 * - [ ] Language is declared
 * - [ ] Link text is descriptive
 * - [ ] Error messages are clear
 *
 * Forms:
 * - [ ] All form fields have labels
 * - [ ] Required fields are marked
 * - [ ] Error messages are associated with fields
 * - [ ] Help text is available
 */
```

### Testing Tools

```typescript
// Enable accessibility DevTools
if (import.meta.env.DEV) {
  import('@nexus/devtools').then(({ enableA11yTools }) => {
    enableA11yTools({
      // Highlight accessibility issues
      highlightIssues: true,
      // Check on every render
      checkOnRender: true,
      // Log issues to console
      logIssues: true
    });
  });
}

// Accessibility testing utilities
export const a11yTest = {
  // Check contrast ratio
  checkContrast: (foreground: string, background: string) => {
    const ratio = calculateContrast(foreground, background);
    return {
      ratio,
      passesAA: ratio >= 4.5,
      passesAAA: ratio >= 7
    };
  },

  // Check heading order
  checkHeadingOrder: (container: HTMLElement) => {
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let previousLevel = 0;
    const issues: string[] = [];

    headings.forEach((heading) => {
      const level = parseInt(heading.tagName[1]);
      if (level > previousLevel + 1) {
        issues.push(`Skipped heading level: ${previousLevel} to ${level}`);
      }
      previousLevel = level;
    });

    return { valid: issues.length === 0, issues };
  },

  // Check for alt text on images
  checkImageAlt: (container: HTMLElement) => {
    const images = container.querySelectorAll('img');
    const missing: HTMLImageElement[] = [];

    images.forEach((img) => {
      if (!img.alt && !img.hasAttribute('role')) {
        missing.push(img);
      }
    });

    return { valid: missing.length === 0, missing };
  }
};
```

## Best Practices

### General Guidelines

```typescript
/**
 * Accessibility Best Practices:
 *
 * 1. Semantic HTML First
 *    - Use proper HTML elements
 *    - Maintain logical document structure
 *    - Use headings correctly (h1-h6)
 *
 * 2. Keyboard Navigation
 *    - All interactive elements must be keyboard accessible
 *    - Provide visible focus indicators
 *    - Manage focus appropriately
 *
 * 3. ARIA Usage
 *    - Use ARIA only when necessary
 *    - Prefer semantic HTML over ARIA
 *    - Follow ARIA Authoring Practices Guide
 *
 * 4. Forms
 *    - Always label form fields
 *    - Provide clear error messages
 *    - Associate help text with fields
 *
 * 5. Color and Contrast
 *    - Maintain sufficient contrast ratios
 *    - Don't rely on color alone
 *    - Support high contrast mode
 *
 * 6. Images and Media
 *    - Provide alt text for images
 *    - Caption videos
 *    - Provide transcripts for audio
 *
 * 7. Motion and Animation
 *    - Respect prefers-reduced-motion
 *    - Provide option to disable animations
 *    - Avoid seizure-inducing content
 *
 * 8. Testing
 *    - Test with keyboard only
 *    - Test with screen readers
 *    - Use automated testing tools
 *    - Involve users with disabilities
 */
```

### Common Patterns

```typescript
// Accessible loading state
export const LoadingButton = defineComponent((props: {
  loading: boolean;
  onClick: () => void;
}) => {
  return () => (
    <button
      onClick={props.onClick}
      disabled={props.loading}
      aria-busy={props.loading}
    >
      {props.loading ? (
        <>
          <span class="spinner" aria-hidden="true"></span>
          <span>Loading...</span>
        </>
      ) : (
        props.children
      )}
    </button>
  );
});

// Accessible pagination
export const Pagination = defineComponent((props: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) => {
  return () => (
    <nav aria-label="Pagination">
      <ul>
        <li>
          <button
            onClick={() => props.onPageChange(props.currentPage - 1)}
            disabled={props.currentPage === 1}
            aria-label="Previous page"
          >
            Previous
          </button>
        </li>

        <For each={Array.from({ length: props.totalPages }, (_, i) => i + 1)}>
          {(page) => (
            <li>
              <button
                onClick={() => props.onPageChange(page)}
                aria-label={`Page ${page}`}
                aria-current={page === props.currentPage ? 'page' : undefined}
              >
                {page}
              </button>
            </li>
          )}
        </For>

        <li>
          <button
            onClick={() => props.onPageChange(props.currentPage + 1)}
            disabled={props.currentPage === props.totalPages}
            aria-label="Next page"
          >
            Next
          </button>
        </li>
      </ul>
    </nav>
  );
});

// Accessible breadcrumbs
export const Breadcrumbs = defineComponent((props: {
  items: Array<{ label: string; href?: string }>;
}) => {
  return () => (
    <nav aria-label="Breadcrumb">
      <ol>
        <For each={props.items}>
          {(item, index) => (
            <li>
              {index() < props.items.length - 1 ? (
                <a href={item.href}>{item.label}</a>
              ) : (
                <span aria-current="page">{item.label}</span>
              )}
            </li>
          )}
        </For>
      </ol>
    </nav>
  );
});
```

## Nexus Integration

Nexus provides accessibility features out of the box.

### Automatic ARIA

```typescript
// Nexus components have built-in ARIA support
import { Button, Input, Select } from '@nexus/components';

export default defineComponent(() => {
  return () => (
    <form>
      {/* Automatically generates proper ARIA attributes */}
      <Input
        label="Email"
        type="email"
        required
        error="Invalid email"
      />
      {/* Renders as:
        <div>
          <label for="auto-id-1">Email <abbr aria-label="required">*</abbr></label>
          <input
            type="email"
            id="auto-id-1"
            aria-required="true"
            aria-invalid="true"
            aria-describedby="auto-id-1-error"
          />
          <div id="auto-id-1-error" role="alert">Invalid email</div>
        </div>
      */}

      <Select
        label="Country"
        options={countries}
        placeholder="Select a country"
      />
      {/* Renders with proper combobox ARIA roles */}

      <Button type="submit" loading={isSubmitting}>
        Submit
      </Button>
      {/* Renders with aria-busy when loading */}
    </form>
  );
});
```

### Accessibility Context

```typescript
// Global accessibility settings
export const AccessibilityProvider = defineComponent(() => {
  const settings = signal({
    reduceMotion: false,
    highContrast: false,
    fontSize: 'medium' as 'small' | 'medium' | 'large',
    announceMessages: true
  });

  // Detect system preferences
  onMount(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contrastQuery = window.matchMedia('(prefers-contrast: high)');

    settings.set({
      ...settings(),
      reduceMotion: motionQuery.matches,
      highContrast: contrastQuery.matches
    });
  });

  provide(AccessibilityContext, { settings, setSettings });

  return () => (
    <div
      class={{
        'reduce-motion': settings().reduceMotion,
        'high-contrast': settings().highContrast,
        [`font-${settings().fontSize}`]: true
      }}
    >
      {props.children}
    </div>
  );
});

// Use in components
export const AnimatedCard = defineComponent(() => {
  const { settings } = inject(AccessibilityContext);

  return () => (
    <div class={settings().reduceMotion ? 'no-animation' : 'animated'}>
      Card content
    </div>
  );
});
```

## API Reference

### Accessibility Utilities

```typescript
// Auto-generate unique IDs for ARIA
export function createUniqueId(prefix = 'nexus'): string;

// Check if element is focusable
export function isFocusable(element: HTMLElement): boolean;

// Get all focusable elements in container
export function getFocusableElements(container: HTMLElement): HTMLElement[];

// Focus first element
export function focusFirst(container: HTMLElement): void;

// Focus last element
export function focusLast(container: HTMLElement): void;

// Calculate color contrast ratio
export function calculateContrast(foreground: string, background: string): number;

// Check WCAG compliance
export function checkWCAG(
  foreground: string,
  background: string,
  level: 'AA' | 'AAA',
  large?: boolean
): boolean;
```

### Hooks

```typescript
// Detect reduced motion preference
export function usePrefersReducedMotion(): Accessor<boolean>;

// Detect high contrast mode
export function useHighContrast(): Accessor<boolean>;

// Screen reader announcer
export function useAnnouncer(): {
  message: Accessor<string>;
  politeness: Accessor<'polite' | 'assertive'>;
  announce: (message: string, level?: 'polite' | 'assertive') => void;
};

// Focus trap
export function useFocusTrap(container: () => HTMLElement | undefined): {
  handleKeyDown: (e: KeyboardEvent) => void;
  updateFocusableElements: () => void;
};

// Keyboard shortcuts
export function useKeyboardShortcuts(): {
  register: (key: string, handler: () => void) => void;
  unregister: (key: string) => void;
};
```

### Components

```typescript
// Visually hidden text
export const VisuallyHidden: Component<{ children: JSX.Element }>;

// Live region announcer
export const Announcer: Component<{}>;

// Skip link
export const SkipLink: Component<{ href: string; children: string }>;

// Focus ring
export const FocusRing: Component<{ children: JSX.Element }>;
```

## Examples

### Complete Accessible Form

```typescript
import { defineComponent } from '@nexus/core';
import { createForm } from '@nexus/forms';
import { z } from 'zod';

export default defineComponent(() => {
  const form = createForm({
    initialValues: {
      name: '',
      email: '',
      role: '',
      acceptTerms: false
    },
    validate: z.object({
      name: z.string().min(2, 'Name must be at least 2 characters'),
      email: z.string().email('Invalid email address'),
      role: z.string().min(1, 'Please select a role'),
      acceptTerms: z.boolean().refine((v) => v, 'You must accept the terms')
    }),
    onSubmit: async (values) => {
      await api.createUser(values);
      announce('User created successfully!', 'polite');
    }
  });

  const { announce } = useAnnouncer();

  return () => (
    <>
      <Announcer />

      <form onSubmit={form.handleSubmit}>
        <h1>Create Account</h1>

        {/* Name field */}
        <div class="field">
          <label for="name">
            Name
            <abbr title="required" aria-label="required">*</abbr>
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={form.values.name}
            onInput={form.handleChange}
            onBlur={form.handleBlur}
            aria-required="true"
            aria-invalid={form.touched.name && !!form.errors.name}
            aria-describedby={
              form.touched.name && form.errors.name ? 'name-error' : undefined
            }
          />
          {form.touched.name && form.errors.name && (
            <div id="name-error" role="alert" class="error">
              {form.errors.name}
            </div>
          )}
        </div>

        {/* Email field */}
        <div class="field">
          <label for="email">
            Email
            <abbr title="required" aria-label="required">*</abbr>
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={form.values.email}
            onInput={form.handleChange}
            onBlur={form.handleBlur}
            aria-required="true"
            aria-invalid={form.touched.email && !!form.errors.email}
            aria-describedby="email-hint email-error"
          />
          <div id="email-hint" class="hint">
            We'll never share your email
          </div>
          {form.touched.email && form.errors.email && (
            <div id="email-error" role="alert" class="error">
              {form.errors.email}
            </div>
          )}
        </div>

        {/* Role select */}
        <fieldset>
          <legend>
            Role
            <abbr title="required" aria-label="required">*</abbr>
          </legend>

          <div>
            <input
              type="radio"
              id="role-user"
              name="role"
              value="user"
              checked={form.values.role === 'user'}
              onChange={form.handleChange}
            />
            <label for="role-user">User</label>
          </div>

          <div>
            <input
              type="radio"
              id="role-admin"
              name="role"
              value="admin"
              checked={form.values.role === 'admin'}
              onChange={form.handleChange}
            />
            <label for="role-admin">Administrator</label>
          </div>

          {form.touched.role && form.errors.role && (
            <div role="alert" class="error">
              {form.errors.role}
            </div>
          )}
        </fieldset>

        {/* Terms checkbox */}
        <div class="field">
          <input
            type="checkbox"
            id="terms"
            name="acceptTerms"
            checked={form.values.acceptTerms}
            onChange={form.handleChange}
            aria-required="true"
            aria-invalid={form.touched.acceptTerms && !!form.errors.acceptTerms}
            aria-describedby={
              form.touched.acceptTerms && form.errors.acceptTerms
                ? 'terms-error'
                : undefined
            }
          />
          <label for="terms">
            I accept the <a href="/terms">terms and conditions</a>
            <abbr title="required" aria-label="required">*</abbr>
          </label>
          {form.touched.acceptTerms && form.errors.acceptTerms && (
            <div id="terms-error" role="alert" class="error">
              {form.errors.acceptTerms}
            </div>
          )}
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={form.isSubmitting}
          aria-busy={form.isSubmitting}
        >
          {form.isSubmitting ? 'Creating account...' : 'Create account'}
        </button>

        {/* Form-level errors */}
        {form.submitError && (
          <div role="alert" class="form-error">
            {form.submitError}
          </div>
        )}
      </form>
    </>
  );
});
```

### Accessible Data Table

```typescript
export const UserTable = defineComponent((props: { users: User[] }) => {
  const sortBy = signal<keyof User>('name');
  const sortDir = signal<'asc' | 'desc'>('asc');

  const sortedUsers = computed(() => {
    return [...props.users].sort((a, b) => {
      const aVal = a[sortBy()];
      const bVal = b[sortBy()];
      const dir = sortDir() === 'asc' ? 1 : -1;
      return aVal < bVal ? -dir : aVal > bVal ? dir : 0;
    });
  });

  const toggleSort = (column: keyof User) => {
    if (sortBy() === column) {
      sortDir.set(sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      sortBy.set(column);
      sortDir.set('asc');
    }
  };

  return () => (
    <table>
      <caption>User Directory ({props.users.length} users)</caption>
      <thead>
        <tr>
          <th scope="col">
            <button
              onClick={() => toggleSort('name')}
              aria-label="Sort by name"
              aria-sort={
                sortBy() === 'name'
                  ? sortDir() === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
            >
              Name
              {sortBy() === 'name' && (
                <span aria-hidden="true">
                  {sortDir() === 'asc' ? ' ↑' : ' ↓'}
                </span>
              )}
            </button>
          </th>
          <th scope="col">
            <button
              onClick={() => toggleSort('email')}
              aria-label="Sort by email"
              aria-sort={
                sortBy() === 'email'
                  ? sortDir() === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
            >
              Email
              {sortBy() === 'email' && (
                <span aria-hidden="true">
                  {sortDir() === 'asc' ? ' ↑' : ' ↓'}
                </span>
              )}
            </button>
          </th>
          <th scope="col">Role</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        <For each={sortedUsers()}>
          {(user) => (
            <tr>
              <th scope="row">{user.name}</th>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>
                <button
                  aria-label={`Edit ${user.name}`}
                  onClick={() => edit(user.id)}
                >
                  <Icon name="edit" aria-hidden="true" />
                  <VisuallyHidden>Edit</VisuallyHidden>
                </button>
                <button
                  aria-label={`Delete ${user.name}`}
                  onClick={() => deleteUser(user.id)}
                >
                  <Icon name="delete" aria-hidden="true" />
                  <VisuallyHidden>Delete</VisuallyHidden>
                </button>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
});
```

### Accessible Modal with Focus Management

```typescript
export const ConfirmDialog = defineComponent((props: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  let dialogRef: HTMLDialogElement;
  let previousFocus: HTMLElement | null = null;
  const focusTrap = useFocusTrap(() => dialogRef);

  createEffect(() => {
    if (props.open) {
      previousFocus = document.activeElement as HTMLElement;
      dialogRef?.showModal();
      focusTrap.updateFocusableElements();
    } else {
      dialogRef?.close();
      previousFocus?.focus();
      previousFocus = null;
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onCancel();
    } else {
      focusTrap.handleKeyDown(e);
    }
  };

  return () => (
    <Show when={props.open}>
      <dialog
        ref={dialogRef}
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
        aria-modal="true"
        onKeyDown={handleKeyDown}
      >
        <div class="dialog-content">
          <h2 id="dialog-title">{props.title}</h2>
          <p id="dialog-description">{props.message}</p>

          <div class="dialog-actions">
            <button onClick={props.onCancel} ref={(el) => el.focus()}>
              Cancel
            </button>
            <button onClick={props.onConfirm} class="primary">
              Confirm
            </button>
          </div>
        </div>
      </dialog>
    </Show>
  );
});
```

## Summary

Nexus provides comprehensive accessibility support:

1. **WCAG Compliance**: Built-in tools for AA/AAA compliance
2. **Semantic HTML**: Framework encourages proper markup
3. **ARIA Support**: Automatic and manual ARIA attributes
4. **Keyboard Navigation**: Full keyboard accessibility
5. **Screen Reader**: Optimized for screen readers
6. **Focus Management**: Automatic and manual focus control
7. **Color Contrast**: Theme system with accessible colors
8. **Accessible Components**: All components follow best practices
9. **Testing Tools**: Built-in accessibility testing
10. **Best Practices**: Documentation and examples

Accessibility is not optional in Nexus—it's fundamental.
