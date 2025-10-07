# Custom Directive Examples

> Advanced patterns for creating custom directives

## Table of Contents

1. [Form Validation Directive](#form-validation-directive)
2. [Auto-save Directive](#auto-save-directive)
3. [Lazy Load Directive](#lazy-load-directive)
4. [Keyboard Shortcut Directive](#keyboard-shortcut-directive)
5. [Copy to Clipboard Directive](#copy-to-clipboard-directive)
6. [Tooltip Directive](#tooltip-directive)
7. [Drag and Drop Directive](#drag-and-drop-directive)

---

## Form Validation Directive

### Pattern: Inline Validation Directive

```typescript
import { createUpdatableDirective } from '@omnitron-dev/aether/utils';

interface ValidationRule {
  validate: (value: string) => boolean;
  message: string;
}

interface ValidationOptions {
  rules: ValidationRule[];
  onValidate?: (isValid: boolean, errors: string[]) => void;
}

/**
 * Validation directive - validates input on blur and input
 */
export const validate = createUpdatableDirective<ValidationOptions>(
  (element, options) => {
    const inputElement = element as HTMLInputElement;
    let errorElement: HTMLDivElement | null = null;

    const showErrors = (errors: string[]) => {
      // Remove existing error element
      if (errorElement) {
        errorElement.remove();
      }

      if (errors.length === 0) return;

      // Create error element
      errorElement = document.createElement('div');
      errorElement.className = 'validation-error';
      errorElement.style.cssText = `
        margin-top: 0.25rem;
        font-size: 0.875rem;
        color: #dc2626;
      `;
      errorElement.textContent = errors[0]; // Show first error

      // Insert after input
      inputElement.parentNode?.insertBefore(
        errorElement,
        inputElement.nextSibling
      );

      // Mark input as invalid
      inputElement.style.borderColor = '#dc2626';
    };

    const clearErrors = () => {
      if (errorElement) {
        errorElement.remove();
        errorElement = null;
      }
      inputElement.style.borderColor = '';
    };

    const validateInput = () => {
      const value = inputElement.value;
      const errors: string[] = [];

      for (const rule of options.rules) {
        if (!rule.validate(value)) {
          errors.push(rule.message);
        }
      }

      const isValid = errors.length === 0;

      if (isValid) {
        clearErrors();
      } else {
        showErrors(errors);
      }

      options.onValidate?.(isValid, errors);
    };

    // Validate on blur and input
    inputElement.addEventListener('blur', validateInput);
    inputElement.addEventListener('input', validateInput);

    return () => {
      inputElement.removeEventListener('blur', validateInput);
      inputElement.removeEventListener('input', validateInput);
      clearErrors();
    };
  }
);

/**
 * Usage Example
 */
import { defineComponent } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

export const ValidationExample = defineComponent(() => {
  const isValid = signal(false);

  return () => (
    <form>
      <label>
        Email:
        <input
          type="email"
          ref={validate({
            rules: [
              {
                validate: (v) => v.length > 0,
                message: 'Email is required',
              },
              {
                validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
                message: 'Invalid email format',
              },
            ],
            onValidate: (valid) => isValid.set(valid),
          })}
        />
      </label>

      <button type="submit" disabled={!isValid()}>
        Submit
      </button>
    </form>
  );
});
```

---

## Auto-save Directive

### Pattern: Automatic Save with Debounce

```typescript
import { createUpdatableDirective } from '@omnitron-dev/aether/utils';

interface AutoSaveOptions {
  /** Debounce delay in milliseconds */
  delay?: number;
  /** Save callback */
  onSave: (value: string) => void | Promise<void>;
  /** Optional save indicator callback */
  onSaving?: (isSaving: boolean) => void;
}

/**
 * Auto-save directive - automatically saves input value after delay
 */
export const autoSave = createUpdatableDirective<AutoSaveOptions>(
  (element, options) => {
    const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
    let timeoutId: number | null = null;
    let lastValue = inputElement.value;

    const save = async () => {
      const currentValue = inputElement.value;

      if (currentValue === lastValue) return;

      options.onSaving?.(true);
      try {
        await options.onSave(currentValue);
        lastValue = currentValue;
      } finally {
        options.onSaving?.(false);
      }
    };

    const handleInput = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(save, options.delay ?? 1000);
    };

    inputElement.addEventListener('input', handleInput);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      inputElement.removeEventListener('input', handleInput);
    };
  }
);

/**
 * Usage Example
 */
export const AutoSaveExample = defineComponent(() => {
  const isSaving = signal(false);
  const lastSaved = signal<Date | null>(null);

  const handleSave = async (value: string) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('Saved:', value);
    lastSaved.set(new Date());
  };

  return () => (
    <div>
      <label>
        Notes (auto-saves):
        <textarea
          ref={autoSave({
            delay: 1000,
            onSave: handleSave,
            onSaving: (saving) => isSaving.set(saving),
          })}
          rows={10}
          style={{ width: '100%', padding: '0.5rem' }}
        />
      </label>

      <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
        {isSaving() && <span>Saving...</span>}
        {!isSaving() && lastSaved() && (
          <span>Last saved: {lastSaved()!.toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  );
});
```

---

## Lazy Load Directive

### Pattern: Lazy Load Images

```typescript
import { createDirective } from '@omnitron-dev/aether/utils';

interface LazyLoadOptions {
  /** Placeholder image to show while loading */
  placeholder?: string;
  /** Root margin for intersection observer */
  rootMargin?: string;
  /** Threshold for intersection observer */
  threshold?: number;
}

/**
 * Lazy load directive - loads images when they enter viewport
 */
export const lazyLoad = createDirective<LazyLoadOptions>((element, options = {}) => {
  const imgElement = element as HTMLImageElement;
  const src = imgElement.getAttribute('data-src');

  if (!src) {
    console.warn('lazyLoad: data-src attribute is required');
    return;
  }

  // Set placeholder
  if (options.placeholder) {
    imgElement.src = options.placeholder;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        // Load image
        const img = new Image();
        img.onload = () => {
          imgElement.src = src;
          imgElement.classList.add('loaded');
        };
        img.onerror = () => {
          console.error('Failed to load image:', src);
          imgElement.classList.add('error');
        };
        img.src = src;

        // Stop observing
        observer.unobserve(imgElement);
      }
    },
    {
      rootMargin: options.rootMargin ?? '50px',
      threshold: options.threshold ?? 0.01,
    }
  );

  observer.observe(imgElement);

  return () => {
    observer.disconnect();
  };
});

/**
 * Usage Example
 */
export const LazyLoadExample = defineComponent(() => {
  const images = signal([
    'https://picsum.photos/400/300?random=1',
    'https://picsum.photos/400/300?random=2',
    'https://picsum.photos/400/300?random=3',
    'https://picsum.photos/400/300?random=4',
    'https://picsum.photos/400/300?random=5',
    'https://picsum.photos/400/300?random=6',
  ]);

  return () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <For each={images()}>
        {(src) => (
          <img
            data-src={src}
            ref={lazyLoad({
              placeholder: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23f3f4f6" width="400" height="300"/%3E%3C/svg%3E',
              rootMargin: '100px',
            })}
            alt="Lazy loaded image"
            style={{
              width: '100%',
              height: 'auto',
              borderRadius: '0.5rem',
              transition: 'opacity 0.3s',
            }}
          />
        )}
      </For>
    </div>
  );
});
```

---

## Keyboard Shortcut Directive

### Pattern: Global Keyboard Shortcuts

```typescript
import { createUpdatableDirective } from '@omnitron-dev/aether/utils';

interface ShortcutOptions {
  /** Keyboard shortcut (e.g., 'ctrl+s', 'alt+enter') */
  shortcut: string;
  /** Callback when shortcut is triggered */
  onTrigger: () => void;
  /** Whether to prevent default behavior */
  preventDefault?: boolean;
  /** Whether to stop propagation */
  stopPropagation?: boolean;
}

/**
 * Parse keyboard shortcut string
 */
function parseShortcut(shortcut: string) {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const modifiers = {
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta') || parts.includes('cmd'),
  };
  return { key, modifiers };
}

/**
 * Keyboard shortcut directive
 */
export const keyboardShortcut = createUpdatableDirective<ShortcutOptions>(
  (element, options) => {
    const { key, modifiers } = parseShortcut(options.shortcut);

    const handleKeyDown = (e: KeyboardEvent) => {
      const matchesKey = e.key.toLowerCase() === key;
      const matchesModifiers =
        e.ctrlKey === modifiers.ctrl &&
        e.altKey === modifiers.alt &&
        e.shiftKey === modifiers.shift &&
        e.metaKey === modifiers.meta;

      if (matchesKey && matchesModifiers) {
        if (options.preventDefault !== false) {
          e.preventDefault();
        }
        if (options.stopPropagation) {
          e.stopPropagation();
        }
        options.onTrigger();
      }
    };

    // Listen on document for global shortcuts
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }
);

/**
 * Usage Example
 */
export const KeyboardShortcutExample = defineComponent(() => {
  const savedCount = signal(0);
  const undoneCount = signal(0);
  const redoneCount = signal(0);

  return () => (
    <div
      ref={keyboardShortcut({
        shortcut: 'ctrl+s',
        onTrigger: () => {
          savedCount.set(savedCount() + 1);
          console.log('Saved!');
        },
      })}
      style={{ padding: '2rem' }}
    >
      <h2>Keyboard Shortcuts Demo</h2>

      <div style={{ marginBottom: '1rem' }}>
        <p>Try these shortcuts:</p>
        <ul>
          <li><code>Ctrl+S</code> - Save (triggered {savedCount()} times)</li>
          <li><code>Ctrl+Z</code> - Undo (triggered {undoneCount()} times)</li>
          <li><code>Ctrl+Shift+Z</code> - Redo (triggered {redoneCount()} times)</li>
        </ul>
      </div>

      <textarea
        ref={keyboardShortcut({
          shortcut: 'ctrl+z',
          onTrigger: () => undoneCount.set(undoneCount() + 1),
        })}
        rows={10}
        style={{ width: '100%', padding: '0.5rem' }}
        placeholder="Type something and try Ctrl+S to save..."
      />
    </div>
  );
});
```

---

## Copy to Clipboard Directive

### Pattern: Click to Copy

```typescript
import { createUpdatableDirective } from '@omnitron-dev/aether/utils';

interface CopyOptions {
  /** Text to copy (if not provided, uses element's textContent) */
  text?: string;
  /** Callback when copy succeeds */
  onSuccess?: () => void;
  /** Callback when copy fails */
  onError?: (error: Error) => void;
}

/**
 * Copy to clipboard directive
 */
export const copyToClipboard = createUpdatableDirective<CopyOptions>(
  (element, options) => {
    const handleClick = async () => {
      const textToCopy = options.text ?? element.textContent ?? '';

      try {
        await navigator.clipboard.writeText(textToCopy);
        options.onSuccess?.();
      } catch (error) {
        options.onError?.(error as Error);
      }
    };

    element.addEventListener('click', handleClick);
    element.style.cursor = 'pointer';

    return () => {
      element.removeEventListener('click', handleClick);
      element.style.cursor = '';
    };
  }
);

/**
 * Usage Example
 */
export const CopyToClipboardExample = defineComponent(() => {
  const copied = signal(false);
  const copyText = 'npm install @omnitron-dev/aether';

  const handleCopySuccess = () => {
    copied.set(true);
    setTimeout(() => copied.set(false), 2000);
  };

  return () => (
    <div>
      <h3>Click to Copy</h3>

      <div
        ref={copyToClipboard({
          text: copyText,
          onSuccess: handleCopySuccess,
        })}
        style={{
          padding: '1rem',
          backgroundColor: '#f3f4f6',
          border: '1px solid #d1d5db',
          borderRadius: '0.5rem',
          fontFamily: 'monospace',
          position: 'relative',
        }}
      >
        <code>{copyText}</code>
        {copied() && (
          <span
            style={{
              position: 'absolute',
              right: '1rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#10b981',
              fontSize: '0.875rem',
              fontWeight: 'bold',
            }}
          >
            ✓ Copied!
          </span>
        )}
      </div>
    </div>
  );
});
```

---

## Tooltip Directive

### Pattern: Hover Tooltip

```typescript
import { createUpdatableDirective } from '@omnitron-dev/aether/utils';

interface TooltipOptions {
  /** Tooltip text */
  text: string;
  /** Tooltip position */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay before showing (ms) */
  delay?: number;
}

/**
 * Tooltip directive
 */
export const tooltip = createUpdatableDirective<TooltipOptions>((element, options) => {
  let tooltipElement: HTMLDivElement | null = null;
  let timeoutId: number | null = null;

  const createTooltip = () => {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'tooltip';
    tooltipElement.textContent = options.text;
    tooltipElement.style.cssText = `
      position: absolute;
      z-index: 9999;
      background-color: #1f2937;
      color: white;
      padding: 0.5rem 0.75rem;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    `;
    document.body.appendChild(tooltipElement);
  };

  const positionTooltip = () => {
    if (!tooltipElement) return;

    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const position = options.position ?? 'top';
    const gap = 8;

    let left = 0;
    let top = 0;

    switch (position) {
      case 'top':
        left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        top = rect.top - tooltipRect.height - gap;
        break;
      case 'bottom':
        left = rect.left + rect.width / 2 - tooltipRect.width / 2;
        top = rect.bottom + gap;
        break;
      case 'left':
        left = rect.left - tooltipRect.width - gap;
        top = rect.top + rect.height / 2 - tooltipRect.height / 2;
        break;
      case 'right':
        left = rect.right + gap;
        top = rect.top + rect.height / 2 - tooltipRect.height / 2;
        break;
    }

    tooltipElement.style.left = `${left}px`;
    tooltipElement.style.top = `${top}px`;
  };

  const showTooltip = () => {
    if (timeoutId) return;

    timeoutId = window.setTimeout(() => {
      createTooltip();
      positionTooltip();
      if (tooltipElement) {
        tooltipElement.style.opacity = '1';
      }
    }, options.delay ?? 500);
  };

  const hideTooltip = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (tooltipElement) {
      tooltipElement.remove();
      tooltipElement = null;
    }
  };

  element.addEventListener('mouseenter', showTooltip);
  element.addEventListener('mouseleave', hideTooltip);

  return () => {
    element.removeEventListener('mouseenter', showTooltip);
    element.removeEventListener('mouseleave', hideTooltip);
    hideTooltip();
  };
});

/**
 * Usage Example
 */
export const TooltipExample = defineComponent(() => {
  return () => (
    <div style={{ padding: '4rem', textAlign: 'center' }}>
      <h2>Hover for Tooltips</h2>

      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2rem' }}>
        <button
          ref={tooltip({ text: 'Tooltip on top', position: 'top' })}
          style={{ padding: '0.5rem 1rem' }}
        >
          Top
        </button>

        <button
          ref={tooltip({ text: 'Tooltip on bottom', position: 'bottom' })}
          style={{ padding: '0.5rem 1rem' }}
        >
          Bottom
        </button>

        <button
          ref={tooltip({ text: 'Tooltip on left', position: 'left' })}
          style={{ padding: '0.5rem 1rem' }}
        >
          Left
        </button>

        <button
          ref={tooltip({ text: 'Tooltip on right', position: 'right' })}
          style={{ padding: '0.5rem 1rem' }}
        >
          Right
        </button>
      </div>
    </div>
  );
});
```

---

## Drag and Drop Directive

### Pattern: Draggable Items

```typescript
import { createUpdatableDirective } from '@omnitron-dev/aether/utils';

interface DragOptions {
  /** Data to transfer */
  data: any;
  /** Drag effect */
  effect?: 'copy' | 'move' | 'link';
  /** Callback when drag starts */
  onDragStart?: () => void;
  /** Callback when drag ends */
  onDragEnd?: () => void;
}

interface DropOptions {
  /** Callback when item is dropped */
  onDrop: (data: any) => void;
  /** Allowed drag effects */
  accept?: string[];
}

/**
 * Draggable directive
 */
export const draggable = createUpdatableDirective<DragOptions>((element, options) => {
  element.setAttribute('draggable', 'true');

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer!.effectAllowed = options.effect ?? 'move';
    e.dataTransfer!.setData('application/json', JSON.stringify(options.data));
    element.classList.add('dragging');
    options.onDragStart?.();
  };

  const handleDragEnd = () => {
    element.classList.remove('dragging');
    options.onDragEnd?.();
  };

  element.addEventListener('dragstart', handleDragStart);
  element.addEventListener('dragend', handleDragEnd);

  return () => {
    element.removeEventListener('dragstart', handleDragStart);
    element.removeEventListener('dragend', handleDragEnd);
    element.removeAttribute('draggable');
  };
});

/**
 * Droppable directive
 */
export const droppable = createUpdatableDirective<DropOptions>((element, options) => {
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    element.classList.add('drag-over');
  };

  const handleDragLeave = () => {
    element.classList.remove('drag-over');
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    element.classList.remove('drag-over');

    const data = JSON.parse(e.dataTransfer!.getData('application/json'));
    options.onDrop(data);
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

/**
 * Usage Example
 */
export const DragDropExample = defineComponent(() => {
  const leftItems = signal(['Item 1', 'Item 2', 'Item 3']);
  const rightItems = signal<string[]>([]);

  const moveToRight = (item: string) => {
    leftItems.set(leftItems().filter((i) => i !== item));
    rightItems.set([...rightItems(), item]);
  };

  const moveToLeft = (item: string) => {
    rightItems.set(rightItems().filter((i) => i !== item));
    leftItems.set([...leftItems(), item]);
  };

  return () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
      {/* Left column */}
      <div
        ref={droppable({
          onDrop: (data) => moveToLeft(data.text),
        })}
        style={{
          minHeight: '300px',
          padding: '1rem',
          border: '2px dashed #d1d5db',
          borderRadius: '0.5rem',
        }}
      >
        <h3>Left</h3>
        <For each={leftItems()}>
          {(item) => (
            <div
              key={item}
              ref={draggable({
                data: { text: item },
                effect: 'move',
              })}
              style={{
                padding: '0.75rem',
                marginBottom: '0.5rem',
                backgroundColor: '#dbeafe',
                border: '1px solid #3b82f6',
                borderRadius: '0.25rem',
                cursor: 'grab',
              }}
            >
              {item}
            </div>
          )}
        </For>
      </div>

      {/* Right column */}
      <div
        ref={droppable({
          onDrop: (data) => moveToRight(data.text),
        })}
        style={{
          minHeight: '300px',
          padding: '1rem',
          border: '2px dashed #d1d5db',
          borderRadius: '0.5rem',
        }}
      >
        <h3>Right</h3>
        <For each={rightItems()}>
          {(item) => (
            <div
              key={item}
              ref={draggable({
                data: { text: item },
                effect: 'move',
              })}
              style={{
                padding: '0.75rem',
                marginBottom: '0.5rem',
                backgroundColor: '#dcfce7',
                border: '1px solid #10b981',
                borderRadius: '0.25rem',
                cursor: 'grab',
              }}
            >
              {item}
            </div>
          )}
        </For>
      </div>
    </div>
  );
});
```

**CSS**:
```css
.dragging {
  opacity: 0.5;
  cursor: grabbing !important;
}

.drag-over {
  background-color: #f0f9ff;
  border-color: #3b82f6 !important;
  border-style: solid !important;
}
```

---

## Summary

These custom directive examples demonstrate:

✅ **Validation** - Inline form validation with error display
✅ **Auto-save** - Debounced automatic saving
✅ **Lazy Load** - Performance optimization for images
✅ **Keyboard Shortcuts** - Global keyboard handling
✅ **Copy to Clipboard** - One-click copying
✅ **Tooltip** - Positioned hover tooltips
✅ **Drag & Drop** - Full drag and drop support

### Directive Creation Patterns

1. **createDirective** - For simple, non-updatable directives
2. **createUpdatableDirective** - For directives that can be updated
3. **Cleanup** - Always return cleanup function
4. **Type Safety** - Use TypeScript interfaces for options
5. **Error Handling** - Handle edge cases gracefully
6. **Accessibility** - Consider ARIA attributes and keyboard support

All patterns are production-ready and follow Aether best practices!
