### Input

A headless input component for text input fields with validation states and ARIA support.

#### Features

- Multiple input types (text, email, password, number, tel, url, search, date, time, datetime-local)
- Validation states (invalid)
- Disabled and read-only states
- Full ARIA support
- Controlled and uncontrolled modes
- Event handlers (onChange, onInput, onBlur, onFocus)
- Accessible by default

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Input } from 'aether/primitives';

// Simple text input
export const BasicInput = defineComponent(() => {
  const value = signal('');

  return () => (
    <Input
      type="text"
      placeholder="Enter your name"
      onChange={(newValue) => value.set(newValue)}
      class="input"
    />
  );
});

// Controlled input
export const ControlledInput = defineComponent(() => {
  const email = signal('');

  return () => (
    <div class="field">
      <label for="email-input">Email</label>
      <Input
        id="email-input"
        type="email"
        value={email()}
        onChange={(newValue) => email.set(newValue)}
        placeholder="you@example.com"
        required
        class="input"
      />
      <p>Current value: {email()}</p>
    </div>
  );
});

// Uncontrolled input with default value
export const UncontrolledInput = defineComponent(() => {
  return () => (
    <Input
      type="text"
      defaultValue="Initial value"
      placeholder="Enter text"
      class="input"
    />
  );
});
```

#### With Validation State

```typescript
import { defineComponent, signal, computed } from 'aether';
import { Input } from 'aether/primitives';

export const ValidatedEmailInput = defineComponent(() => {
  const email = signal('');
  const touched = signal(false);

  // Validate email format
  const isInvalid = computed(() => {
    return touched() && email() && !email().includes('@');
  });

  const handleBlur = () => {
    touched.set(true);
  };

  return () => (
    <div class="field">
      <label for="email">Email Address</label>
      <Input
        id="email"
        type="email"
        value={email()}
        onChange={(newValue) => email.set(newValue)}
        onBlur={handleBlur}
        invalid={isInvalid()}
        placeholder="you@example.com"
        class={`input ${isInvalid() ? 'input-error' : ''}`}
        aria-describedby={isInvalid() ? 'email-error' : undefined}
      />
      {isInvalid() && (
        <span id="email-error" class="error-message" role="alert">
          Please enter a valid email address
        </span>
      )}
    </div>
  );
});
```

#### Different Input Types

```typescript
import { defineComponent, signal } from 'aether';
import { Input } from 'aether/primitives';

export const InputTypes = defineComponent(() => {
  const text = signal('');
  const email = signal('');
  const password = signal('');
  const number = signal(0);
  const date = signal('');
  const tel = signal('');
  const url = signal('');

  return () => (
    <div class="form">
      <div class="field">
        <label>Text</label>
        <Input
          type="text"
          value={text()}
          onChange={text.set}
          placeholder="Enter text"
        />
      </div>

      <div class="field">
        <label>Email</label>
        <Input
          type="email"
          value={email()}
          onChange={email.set}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </div>

      <div class="field">
        <label>Password</label>
        <Input
          type="password"
          value={password()}
          onChange={password.set}
          placeholder="Enter password"
          autoComplete="current-password"
        />
      </div>

      <div class="field">
        <label>Number</label>
        <Input
          type="number"
          value={number()}
          onChange={(v) => number.set(Number(v))}
          placeholder="Enter number"
        />
      </div>

      <div class="field">
        <label>Date</label>
        <Input
          type="date"
          value={date()}
          onChange={date.set}
        />
      </div>

      <div class="field">
        <label>Phone</label>
        <Input
          type="tel"
          value={tel()}
          onChange={tel.set}
          placeholder="+1 (555) 000-0000"
          autoComplete="tel"
        />
      </div>

      <div class="field">
        <label>URL</label>
        <Input
          type="url"
          value={url()}
          onChange={url.set}
          placeholder="https://example.com"
        />
      </div>
    </div>
  );
});
```

#### Integration with Form Primitives

```typescript
import { defineComponent, signal } from 'aether';
import { FormField, FormLabel, FormControl, FormMessage } from 'aether/primitives';
import { Input } from 'aether/primitives';

export const FormIntegration = defineComponent(() => {
  const username = signal('');
  const error = signal<string | null>(null);

  const handleChange = (value: string) => {
    username.set(value);

    // Validate username
    if (value.length < 3) {
      error.set('Username must be at least 3 characters');
    } else if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      error.set('Username can only contain letters, numbers, and underscores');
    } else {
      error.set(null);
    }
  };

  return () => (
    <FormField name="username">
      <FormLabel>Username</FormLabel>
      <FormControl>
        <Input
          type="text"
          value={username()}
          onChange={handleChange}
          invalid={!!error()}
          placeholder="Enter username"
          class="input"
        />
      </FormControl>
      {error() && (
        <FormMessage>{error()}</FormMessage>
      )}
    </FormField>
  );
});
```

#### Styling Example

```css
/* Basic input styling */
[data-input] {
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
}

/* Hover state */
[data-input]:hover:not([data-disabled]) {
  border-color: var(--color-border-hover);
}

/* Focus state */
[data-input]:focus {
  border-color: var(--color-primary-500);
  box-shadow: 0 0 0 3px var(--color-primary-100);
}

/* Invalid state */
[data-input][data-invalid] {
  border-color: var(--color-error);
}

[data-input][data-invalid]:focus {
  box-shadow: 0 0 0 3px var(--color-error-light);
}

/* Disabled state */
[data-input][data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-background-secondary);
}

/* Read-only state */
[data-input][data-readonly] {
  background: var(--color-background-secondary);
  cursor: default;
}

/* Placeholder */
[data-input]::placeholder {
  color: var(--color-text-tertiary);
  opacity: 1;
}
```

#### API Reference

**`<Input>`** - Input component

Props:
- `type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'date' | 'time' | 'datetime-local'` - Input type (default: 'text')
- `value?: string | number` - Controlled value
- `defaultValue?: string | number` - Default value for uncontrolled mode
- `placeholder?: string` - Placeholder text
- `disabled?: boolean` - Disabled state
- `readOnly?: boolean` - Read-only state
- `required?: boolean` - Required field
- `invalid?: boolean` - Invalid state for validation errors
- `name?: string` - Input name
- `id?: string` - Input ID
- `autoComplete?: string` - Autocomplete attribute
- `aria-label?: string` - ARIA label
- `aria-labelledby?: string` - ARIA labelledby
- `aria-describedby?: string` - ARIA describedby
- `aria-invalid?: boolean` - ARIA invalid (auto-set based on invalid prop)
- `onChange?: (value: string) => void` - Change handler
- `onInput?: (value: string) => void` - Input handler
- `onBlur?: (event: FocusEvent) => void` - Blur handler
- `onFocus?: (event: FocusEvent) => void` - Focus handler
- `...HTMLInputAttributes` - Additional HTML input attributes

Data attributes:
- `data-input` - Always present
- `data-disabled` - Present when disabled
- `data-readonly` - Present when read-only
- `data-invalid` - Present when invalid

#### Accessibility Notes

- Always provide a label using `<label>`, `aria-label`, or `aria-labelledby`
- Use `aria-describedby` to associate error messages or help text
- Set `aria-invalid="true"` when validation fails (automatically handled)
- Use appropriate `type` attribute for better mobile keyboard layouts
- Use `autoComplete` attribute for better user experience
- Ensure sufficient color contrast for text and borders
- Minimum touch target size of 44x44px for mobile devices

#### Best Practices

1. **Always provide labels**: Use semantic `<label>` elements with `for` attribute
2. **Use appropriate input types**: Choose the right type for better UX (email, tel, url, etc.)
3. **Validate on blur**: Only show errors after user leaves the field
4. **Clear error messages**: Provide actionable feedback
5. **Autocomplete**: Use autocomplete attributes for common fields
6. **Disabled vs Read-only**: Use disabled when field can't be changed, read-only when it can be copied
7. **Placeholder vs Label**: Never use placeholder as a replacement for label
8. **Password fields**: Always use type="password" and appropriate autocomplete

---

