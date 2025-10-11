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

