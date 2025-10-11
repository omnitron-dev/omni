### Textarea

A headless textarea component for multi-line text input with auto-resize support and validation states.

#### Features

- Multi-line text input
- Auto-resize to fit content
- Min/max rows constraints
- Validation states (invalid)
- Disabled and read-only states
- Full ARIA support
- Controlled and uncontrolled modes
- Character count support
- Event handlers (onChange, onInput, onBlur, onFocus)

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Textarea } from 'aether/primitives';

// Simple textarea
export const BasicTextarea = defineComponent(() => {
  const comment = signal('');

  return () => (
    <Textarea
      placeholder="Enter your comment"
      onChange={(newValue) => comment.set(newValue)}
      class="textarea"
    />
  );
});

// Controlled textarea
export const ControlledTextarea = defineComponent(() => {
  const message = signal('');

  return () => (
    <div class="field">
      <label for="message">Message</label>
      <Textarea
        id="message"
        value={message()}
        onChange={(newValue) => message.set(newValue)}
        placeholder="Enter your message"
        rows={4}
        class="textarea"
      />
      <p>Character count: {message().length}</p>
    </div>
  );
});

// Uncontrolled textarea
export const UncontrolledTextarea = defineComponent(() => {
  return () => (
    <Textarea
      defaultValue="Initial text content"
      placeholder="Enter text"
      rows={5}
      class="textarea"
    />
  );
});
```

#### Auto-resize Textarea

```typescript
import { defineComponent, signal } from 'aether';
import { Textarea } from 'aether/primitives';

// Auto-resize based on content
export const AutoResizeTextarea = defineComponent(() => {
  const content = signal('');

  return () => (
    <div class="field">
      <label for="auto-resize">Auto-resize Textarea</label>
      <Textarea
        id="auto-resize"
        value={content()}
        onChange={(newValue) => content.set(newValue)}
        placeholder="Type something... The textarea will grow as you type"
        autoResize
        minRows={3}
        maxRows={10}
        class="textarea"
      />
    </div>
  );
});

// Auto-resize with constraints
export const ConstrainedAutoResize = defineComponent(() => {
  const bio = signal('');

  return () => (
    <div class="field">
      <label for="bio">Bio (max 500 characters)</label>
      <Textarea
        id="bio"
        value={bio()}
        onChange={(newValue) => {
          if (newValue.length <= 500) {
            bio.set(newValue);
          }
        }}
        placeholder="Tell us about yourself..."
        autoResize
        minRows={4}
        maxRows={8}
        maxLength={500}
        class="textarea"
      />
      <p class="helper-text">
        {bio().length} / 500 characters
      </p>
    </div>
  );
});
```

#### With Character Count

```typescript
import { defineComponent, signal, computed } from 'aether';
import { Textarea } from 'aether/primitives';

export const TextareaWithCharCount = defineComponent(() => {
  const description = signal('');
  const maxLength = 200;

  const remaining = computed(() => maxLength - description().length);
  const isNearLimit = computed(() => remaining() < 20);
  const isAtLimit = computed(() => remaining() <= 0);

  return () => (
    <div class="field">
      <label for="description">Description</label>
      <Textarea
        id="description"
        value={description()}
        onChange={(newValue) => {
          if (newValue.length <= maxLength) {
            description.set(newValue);
          }
        }}
        placeholder="Enter description"
        maxLength={maxLength}
        rows={4}
        class="textarea"
      />
      <p class={`char-count ${isNearLimit() ? 'warning' : ''} ${isAtLimit() ? 'error' : ''}`}>
        {remaining()} characters remaining
      </p>
    </div>
  );
});
```

#### With Validation State

```typescript
import { defineComponent, signal, computed } from 'aether';
import { Textarea } from 'aether/primitives';

export const ValidatedTextarea = defineComponent(() => {
  const feedback = signal('');
  const touched = signal(false);

  const minLength = 10;
  const isInvalid = computed(() => {
    return touched() && feedback().length > 0 && feedback().length < minLength;
  });

  const errorMessage = computed(() => {
    if (isInvalid()) {
      return `Feedback must be at least ${minLength} characters (currently ${feedback().length})`;
    }
    return null;
  });

  const handleBlur = () => {
    touched.set(true);
  };

  return () => (
    <div class="field">
      <label for="feedback">Feedback</label>
      <Textarea
        id="feedback"
        value={feedback()}
        onChange={(newValue) => feedback.set(newValue)}
        onBlur={handleBlur}
        invalid={isInvalid()}
        placeholder="Please provide your feedback"
        autoResize
        minRows={3}
        maxRows={8}
        class={`textarea ${isInvalid() ? 'textarea-error' : ''}`}
        aria-describedby={isInvalid() ? 'feedback-error' : undefined}
      />
      {isInvalid() && (
        <span id="feedback-error" class="error-message" role="alert">
          {errorMessage()}
        </span>
      )}
    </div>
  );
});
```

#### Integration with Form Primitives

```typescript
import { defineComponent, signal } from 'aether';
import { FormField, FormLabel, FormControl, FormMessage, FormDescription } from 'aether/primitives';
import { Textarea } from 'aether/primitives';

export const TextareaFormIntegration = defineComponent(() => {
  const review = signal('');
  const error = signal<string | null>(null);

  const handleChange = (value: string) => {
    review.set(value);

    // Validate review
    if (value.length < 20) {
      error.set('Review must be at least 20 characters');
    } else if (value.length > 500) {
      error.set('Review must not exceed 500 characters');
    } else {
      error.set(null);
    }
  };

  return () => (
    <FormField name="review">
      <FormLabel>Product Review</FormLabel>
      <FormDescription>
        Share your experience with this product (20-500 characters)
      </FormDescription>
      <FormControl>
        <Textarea
          value={review()}
          onChange={handleChange}
          invalid={!!error()}
          placeholder="Write your review here..."
          autoResize
          minRows={4}
          maxRows={10}
          maxLength={500}
          class="textarea"
        />
      </FormControl>
      {error() && (
        <FormMessage>{error()}</FormMessage>
      )}
      <p class="helper-text">
        {review().length} / 500 characters
      </p>
    </FormField>
  );
});
```

#### Styling Example

```css
/* Basic textarea styling */
[data-textarea] {
  width: 100%;
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-family: inherit;
  line-height: 1.5;
  color: var(--color-text-primary);
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  transition: all var(--transition-fast);
  resize: vertical; /* Allow vertical resize by default */
}

/* Auto-resize textarea (disable manual resize) */
[data-textarea][data-autoresize] {
  resize: none;
  overflow: hidden;
}

/* Hover state */
[data-textarea]:hover:not([data-disabled]) {
  border-color: var(--color-border-hover);
}

/* Focus state */
[data-textarea]:focus {
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 3px var(--color-primary-100);
}

/* Invalid state */
[data-textarea][data-invalid] {
  border-color: var(--color-error);
}

[data-textarea][data-invalid]:focus {
  box-shadow: 0 0 0 3px var(--color-error-light);
}

/* Disabled state */
[data-textarea][data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-background-secondary);
  resize: none;
}

/* Read-only state */
[data-textarea][data-readonly] {
  background: var(--color-background-secondary);
  cursor: default;
  resize: none;
}

/* Placeholder */
[data-textarea]::placeholder {
  color: var(--color-text-tertiary);
  opacity: 1;
}

/* Character count helpers */
.char-count {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-align: right;
  margin-top: var(--spacing-1);
}

.char-count.warning {
  color: var(--color-warning);
}

.char-count.error {
  color: var(--color-error);
  font-weight: var(--font-weight-medium);
}

.helper-text {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  margin-top: var(--spacing-1);
}
```

#### API Reference

**`<Textarea>`** - Textarea component

Props:
- `value?: string` - Controlled value
- `defaultValue?: string` - Default value for uncontrolled mode
- `placeholder?: string` - Placeholder text
- `disabled?: boolean` - Disabled state
- `readOnly?: boolean` - Read-only state
- `required?: boolean` - Required field
- `invalid?: boolean` - Invalid state for validation errors
- `autoResize?: boolean` - Auto-resize to fit content (default: false)
- `minRows?: number` - Minimum rows for auto-resize (default: 1)
- `maxRows?: number` - Maximum rows for auto-resize (default: Infinity)
- `rows?: number` - Fixed number of rows (ignored if autoResize is true)
- `cols?: number` - Number of columns
- `name?: string` - Textarea name
- `id?: string` - Textarea ID
- `maxLength?: number` - Maximum character length
- `aria-label?: string` - ARIA label
- `aria-labelledby?: string` - ARIA labelledby
- `aria-describedby?: string` - ARIA describedby
- `onChange?: (value: string) => void` - Change handler
- `onInput?: (value: string) => void` - Input handler
- `onBlur?: (event: FocusEvent) => void` - Blur handler
- `onFocus?: (event: FocusEvent) => void` - Focus handler
- `...HTMLTextAreaAttributes` - Additional HTML textarea attributes

Data attributes:
- `data-textarea` - Always present
- `data-disabled` - Present when disabled
- `data-readonly` - Present when read-only
- `data-invalid` - Present when invalid
- `data-autoresize` - Present when auto-resize is enabled

#### Accessibility Notes

- Always provide a label using `<label>`, `aria-label`, or `aria-labelledby`
- Use `aria-describedby` to associate helper text or error messages
- Set `aria-invalid="true"` when validation fails (automatically handled)
- When using character limits, announce remaining characters to screen readers
- Ensure sufficient color contrast for text and borders
- Minimum touch target size of 44x44px for the overall field
- Consider adding "required" attribute for required fields

#### Best Practices

1. **Always provide labels**: Use semantic `<label>` elements with `for` attribute
2. **Show character limits**: If there's a maxLength, show character count
3. **Auto-resize for better UX**: Use autoResize with min/max constraints for dynamic content
4. **Validate on blur**: Only show errors after user leaves the field
5. **Clear error messages**: Provide actionable feedback
6. **Set appropriate min/max rows**: Balance between initial size and maximum height
7. **Placeholder vs Label**: Never use placeholder as a replacement for label
8. **Consider line height**: Ensure adequate line height (1.5 recommended) for readability
9. **Fixed height for forms**: Use fixed rows for consistent form layouts
10. **Resize handle**: Allow vertical resize unless using autoResize

---

