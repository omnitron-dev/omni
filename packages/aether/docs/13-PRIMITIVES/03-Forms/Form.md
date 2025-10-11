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

