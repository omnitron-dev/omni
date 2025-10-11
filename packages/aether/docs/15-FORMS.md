# 15. Forms and Validation

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Basic Forms](#basic-forms)
- [Form State](#form-state)
- [Validation](#validation)
- [Error Handling](#error-handling)
- [Form Submission](#form-submission)
- [Field Arrays](#field-arrays)
- [File Uploads](#file-uploads)
- [Form Libraries](#form-libraries)
- [Server Validation](#server-validation)
- [Accessibility](#accessibility)
- [Performance](#performance)
- [Best Practices](#best-practices)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Aether provides **powerful form handling** with:

- **Fine-grained reactivity**: Only re-render what changed
- **Type-safe validation**: Full TypeScript support
- **Flexible validation**: Sync, async, schema-based
- **Server integration**: Seamless server-side validation
- **Accessibility**: Built-in ARIA support
- **Performance**: Optimized for large forms

### Quick Example

```typescript
import { createForm, z } from 'aether/forms';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export default defineComponent(() => {
  const form = createForm({
    initialValues: { email: '', password: '' },
    validate: schema,
    onSubmit: async (values) => {
      await api.login(values);
    }
  });

  return () => (
    <form onSubmit={form.handleSubmit}>
      <input
        name="email"
        value={form.values.email}
        onInput={form.handleInput}
        onBlur={form.handleBlur}
      />
      {#if form.touched.email && form.errors.email}
        <span class="error">{form.errors.email}</span>
      {/if}

      <input
        type="password"
        name="password"
        value={form.values.password}
        onInput={form.handleInput}
      />
      {#if form.touched.password && form.errors.password}
        <span class="error">{form.errors.password}</span>
      {/if}

      <button type="submit" disabled={form.isSubmitting}>
        {form.isSubmitting ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
});
```

## Philosophy

### Controlled by Default

Forms are **controlled by default** for predictability:

```typescript
// ✅ Controlled (recommended)
const value = signal('');

<input value={value()} onInput={e => value.set(e.target.value)} />

// ⚠️ Uncontrolled (use when necessary)
<input ref={inputRef} />
```

### Progressive Enhancement

Forms work **without JavaScript** when possible:

```typescript
// Server action
'use server';
export async function login(formData: FormData) {
  const email = formData.get('email');
  const password = formData.get('password');
  // Process login...
}

// Client component
<form action={login}>
  <input name="email" />
  <input name="password" />
  <button type="submit">Login</button>
</form>

// Works without JS, enhanced with JS
```

### Validation First

**Validate early and often**:

```typescript
const form = createForm({
  initialValues: { email: '' },
  validate: {
    email: (value) => {
      if (!value) return 'Required';
      if (!value.includes('@')) return 'Invalid email';
    }
  },
  validateOn: 'blur' // Validate on blur, not on every keystroke
});
```

### Accessible by Default

Forms have **built-in accessibility**:

```typescript
// Auto-generated ARIA attributes
<input
  aria-invalid={!!form.errors.email}
  aria-describedby={form.errors.email ? 'email-error' : undefined}
/>
{#if form.errors.email}
  <span id="email-error" role="alert">{form.errors.email}</span>
{/if}
```

## Integration with Primitives

`createForm` works seamlessly with **Form Primitives** from `nexus/primitives` (see **[13-PRIMITIVES/README.md](./13-PRIMITIVES/README.md)**). Primitives handle composition and accessibility, while `createForm` handles state and validation.

### Why Use Primitives?

**Without Primitives** (manual ARIA):
```typescript
const form = createForm({ /* ... */ });

<form on:submit={form.handleSubmit}>
  <label for="email-input">Email</label>
  <input
    id="email-input"
    aria-invalid={form.touched.email && form.errors.email ? 'true' : 'false'}
    aria-describedby={form.touched.email && form.errors.email ? 'email-error' : undefined}
    {...form.getFieldProps('email')}
  />
  {#if form.touched.email && form.errors.email}
    <span id="email-error" role="alert">{form.errors.email}</span>
  {/if}
</form>
```

**With Primitives** (automatic ARIA):
```typescript
import { FormRoot, FormField, FormLabel, FormControl, FormMessage } from 'aether/primitives';

<FormRoot>
  <form on:submit={form.handleSubmit}>
    <FormField name="email">
      <FormLabel>Email</FormLabel>
      <FormControl>
        <input {...form.getFieldProps('email')} />
      </FormControl>
      {#if form.touched.email && form.errors.email}
        <FormMessage>{form.errors.email}</FormMessage>
      {/if}
    </FormField>
  </form>
</FormRoot>
```

Benefits:
- ✅ Automatic `id` generation
- ✅ Automatic `aria-describedby` associations
- ✅ Automatic `aria-invalid` on errors
- ✅ Automatic `role="alert"` on error messages
- ✅ Screen reader accessibility built-in

### Complete Integration Example

```typescript
import { defineComponent } from 'aether';
import { createForm } from 'aether/forms';
import { FormRoot, FormField, FormLabel, FormControl, FormMessage, FormDescription } from 'aether/primitives';
import { z } from 'zod';

export default defineComponent(() => {
  const schema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string()
  }).refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword']
  });

  const form = createForm({
    initialValues: {
      email: '',
      password: '',
      confirmPassword: ''
    },
    validate: schema,
    onSubmit: async (values) => {
      await api.register(values);
    }
  });

  return () => (
    <FormRoot>
      <form on:submit={form.handleSubmit}>
        <FormField name="email">
          <FormLabel>Email Address</FormLabel>
          <FormControl>
            <input
              type="email"
              {...form.getFieldProps('email')}
            />
          </FormControl>
          <FormDescription>
            We'll never share your email with anyone else.
          </FormDescription>
          {#if form.touched.email && form.errors.email}
            <FormMessage>{form.errors.email}</FormMessage>
          {/if}
        </FormField>

        <FormField name="password">
          <FormLabel>Password</FormLabel>
          <FormControl>
            <input
              type="password"
              {...form.getFieldProps('password')}
            />
          </FormControl>
          {#if form.touched.password && form.errors.password}
            <FormMessage>{form.errors.password}</FormMessage>
          {/if}
        </FormField>

        <FormField name="confirmPassword">
          <FormLabel>Confirm Password</FormLabel>
          <FormControl>
            <input
              type="password"
              {...form.getFieldProps('confirmPassword')}
            />
          </FormControl>
          {#if form.touched.confirmPassword && form.errors.confirmPassword}
            <FormMessage>{form.errors.confirmPassword}</FormMessage>
          {/if}
        </FormField>

        <button
          type="submit"
          disabled={form.isSubmitting || !form.isValid}
        >
          {#if form.isSubmitting}
            Creating account...
          {:else}
            Create Account
          {/if}
        </button>
      </form>
    </FormRoot>
  );
});
```

### Integration with Complex Primitives

Use primitives like `Select`, `Checkbox`, `RadioGroup` with `createForm`:

```typescript
import { defineComponent } from 'aether';
import { createForm } from 'aether/forms';
import { FormRoot, FormField, FormLabel, FormControl, FormMessage } from 'aether/primitives';
import { Select, Checkbox, RadioGroup } from 'aether/primitives';

export default defineComponent(() => {
  const form = createForm({
    initialValues: {
      country: '',
      notifications: false,
      theme: 'light'
    },
    validate: {
      country: (value) => !value && 'Please select a country'
    },
    onSubmit: async (values) => {
      await api.updatePreferences(values);
    }
  });

  return () => (
    <FormRoot>
      <form on:submit={form.handleSubmit}>
        {/* Select */}
        <FormField name="country">
          <FormLabel>Country</FormLabel>
          <FormControl asChild>
            <Select bind:value={form.values.country}>
              <Select.Trigger>
                <Select.Value placeholder="Select your country" />
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

        {/* Checkbox */}
        <FormField name="notifications">
          <div class="flex items-center gap-2">
            <FormControl asChild>
              <Checkbox
                bind:checked={form.values.notifications}
                id="notifications"
              >
                <Checkbox.Indicator>
                  <CheckIcon />
                </Checkbox.Indicator>
              </Checkbox>
            </FormControl>
            <FormLabel for="notifications">
              Enable email notifications
            </FormLabel>
          </div>
        </FormField>

        {/* Radio Group */}
        <FormField name="theme">
          <FormLabel>Theme</FormLabel>
          <FormControl asChild>
            <RadioGroup bind:value={form.values.theme}>
              <div class="flex items-center gap-2">
                <RadioGroup.Item value="light" id="theme-light">
                  <RadioGroup.Indicator />
                </RadioGroup.Item>
                <label for="theme-light">Light</label>
              </div>
              <div class="flex items-center gap-2">
                <RadioGroup.Item value="dark" id="theme-dark">
                  <RadioGroup.Indicator />
                </RadioGroup.Item>
                <label for="theme-dark">Dark</label>
              </div>
            </RadioGroup>
          </FormControl>
        </FormField>

        <button type="submit" disabled={form.isSubmitting}>
          Save Preferences
        </button>
      </form>
    </FormRoot>
  );
});
```

### When to Use Each Approach

**Use Primitives + createForm** (Recommended):
- ✅ Complex forms with validation
- ✅ Forms requiring accessibility features
- ✅ Multi-field forms with error handling
- ✅ Enterprise applications

**Use createForm Only** (Minimal markup):
- ✅ Simple login/signup forms
- ✅ Quick prototypes
- ✅ When you manage ARIA manually

**Use Primitives Only** (Custom state):
- ✅ Custom validation logic
- ✅ Non-standard form behavior
- ✅ Integration with external state management

## Basic Forms

### Controlled Inputs

```typescript
export default defineComponent(() => {
  const email = signal('');
  const password = signal('');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    console.log({ email: email(), password: password() });
  };

  return () => (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email()}
        onInput={e => email.set(e.target.value)}
        placeholder="Email"
      />

      <input
        type="password"
        value={password()}
        onInput={e => password.set(e.target.value)}
        placeholder="Password"
      />

      <button type="submit">Submit</button>
    </form>
  );
});
```

### Uncontrolled Inputs

```typescript
export default defineComponent(() => {
  let emailRef: HTMLInputElement;
  let passwordRef: HTMLInputElement;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    console.log({
      email: emailRef.value,
      password: passwordRef.value
    });
  };

  return () => (
    <form onSubmit={handleSubmit}>
      <input ref={emailRef} type="email" placeholder="Email" />
      <input ref={passwordRef} type="password" placeholder="Password" />
      <button type="submit">Submit</button>
    </form>
  );
});
```

### Two-Way Binding

Use `bind:value` for two-way binding:

```typescript
export default defineComponent(() => {
  const email = signal('');

  return () => (
    <form>
      <input bind:value={email} type="email" placeholder="Email" />
      <p>Email: {email()}</p>
    </form>
  );
});
```

### Form Data

Extract FormData:

```typescript
export default defineComponent(() => {
  const handleSubmit = (e: Event) => {
    e.preventDefault();

    const formData = new FormData(e.target as HTMLFormElement);
    const values = Object.fromEntries(formData);

    console.log(values); // { email: '...', password: '...' }
  };

  return () => (
    <form onSubmit={handleSubmit}>
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button type="submit">Submit</button>
    </form>
  );
});
```

## Form State

### createForm

The **core form API**:

```typescript
import { createForm } from 'aether/forms';

const form = createForm({
  initialValues: {
    email: '',
    password: ''
  },

  validate: {
    email: (value) => {
      if (!value) return 'Required';
      if (!value.includes('@')) return 'Invalid email';
    },
    password: (value) => {
      if (!value) return 'Required';
      if (value.length < 8) return 'Must be at least 8 characters';
    }
  },

  onSubmit: async (values) => {
    await api.login(values);
  }
});

// Form state
form.values; // { email: '', password: '' }
form.errors; // { email?: string, password?: string }
form.touched; // { email?: boolean, password?: boolean }
form.isSubmitting; // boolean
form.isValid; // boolean

// Form methods
form.setFieldValue('email', 'test@example.com');
form.setFieldError('email', 'Email already exists');
form.setFieldTouched('email', true);
form.validateField('email');
form.validateForm();
form.reset();
form.handleSubmit();
```

### Field Helpers

Helper functions for field management:

```typescript
const form = createForm({
  initialValues: { email: '' }
});

// Get field props
const emailProps = form.getFieldProps('email');

<input {...emailProps} />

// Equivalent to:
<input
  name="email"
  value={form.values.email}
  onInput={e => form.setFieldValue('email', e.target.value)}
  onBlur={() => form.setFieldTouched('email', true)}
/>
```

### Nested Values

Handle nested object values:

```typescript
const form = createForm({
  initialValues: {
    user: {
      name: '',
      email: ''
    },
    address: {
      street: '',
      city: ''
    }
  }
});

// Set nested value
form.setFieldValue('user.name', 'Alice');
form.setFieldValue('address.city', 'New York');

// Access nested value
form.values.user.name; // 'Alice'

// Validate nested field
form.validateField('user.email');
```

### Array Values

Handle array values:

```typescript
const form = createForm({
  initialValues: {
    tags: ['']
  }
});

// Add item
form.setFieldValue('tags', [...form.values.tags, '']);

// Remove item
form.setFieldValue('tags', form.values.tags.filter((_, i) => i !== index));

// Update item
form.setFieldValue(`tags.${index}`, newValue);
```

## Validation

### Function Validation

Use validation functions:

```typescript
const form = createForm({
  initialValues: { email: '', password: '' },

  validate: {
    email: (value) => {
      if (!value) return 'Required';
      if (!value.includes('@')) return 'Invalid email';
    },
    password: (value) => {
      if (!value) return 'Required';
      if (value.length < 8) return 'Must be at least 8 characters';
    }
  }
});
```

### Schema Validation

Use Zod for schema validation:

```typescript
import { z } from 'zod';
import { createForm } from 'aether/forms';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Must be at least 8 characters'),
  age: z.number().min(18, 'Must be 18 or older')
});

const form = createForm({
  initialValues: { email: '', password: '', age: 0 },
  validate: schema
});
```

### Yup Validation

Use Yup for validation:

```typescript
import * as yup from 'yup';

const schema = yup.object({
  email: yup.string().email().required(),
  password: yup.string().min(8).required()
});

const form = createForm({
  initialValues: { email: '', password: '' },
  validate: schema
});
```

### Async Validation

Validate with async functions:

```typescript
const form = createForm({
  initialValues: { username: '' },

  validate: {
    username: async (value) => {
      if (!value) return 'Required';

      // Check if username exists
      const exists = await api.checkUsername(value);
      if (exists) return 'Username already taken';
    }
  }
});
```

### Cross-Field Validation

Validate multiple fields together:

```typescript
const form = createForm({
  initialValues: { password: '', confirmPassword: '' },

  validate: (values) => {
    const errors: any = {};

    if (!values.password) {
      errors.password = 'Required';
    }

    if (values.password !== values.confirmPassword) {
      errors.confirmPassword = 'Passwords must match';
    }

    return errors;
  }
});
```

### Conditional Validation

Validate based on other fields:

```typescript
const form = createForm({
  initialValues: { country: '', state: '' },

  validate: {
    state: (value, values) => {
      // Only validate state if country is USA
      if (values.country === 'USA' && !value) {
        return 'State is required for USA';
      }
    }
  }
});
```

### Validation Timing

Control when validation runs:

```typescript
const form = createForm({
  initialValues: { email: '' },

  validate: { email: (value) => !value ? 'Required' : undefined },

  // Validate on blur (default)
  validateOn: 'blur',

  // Or validate on change
  validateOn: 'change',

  // Or validate on submit only
  validateOn: 'submit',

  // Or custom
  validateOn: (field) => field === 'email' ? 'blur' : 'change'
});
```

## Error Handling

### Field Errors

Display field-level errors:

```typescript
const form = createForm({
  initialValues: { email: '' },
  validate: { email: (value) => !value ? 'Required' : undefined }
});

<div>
  <input {...form.getFieldProps('email')} />

  {#if form.touched.email && form.errors.email}
    <span class="error">{form.errors.email}</span>
  {/if}
</div>
```

### Form-Level Errors

Display form-level errors:

```typescript
const form = createForm({
  initialValues: { email: '', password: '' },

  onSubmit: async (values) => {
    try {
      await api.login(values);
    } catch (error) {
      // Set form-level error
      form.setFormError(error.message);
    }
  }
});

<form onSubmit={form.handleSubmit}>
  {#if form.formError}
    <div class="alert alert-error">{form.formError}</div>
  {/if}

  {/* Fields... */}
</form>
```

### Multiple Errors

Show multiple errors per field:

```typescript
const form = createForm({
  initialValues: { password: '' },

  validate: {
    password: (value) => {
      const errors: string[] = [];

      if (!value) errors.push('Required');
      if (value && value.length < 8) errors.push('Must be at least 8 characters');
      if (value && !/[A-Z]/.test(value)) errors.push('Must contain uppercase');
      if (value && !/[0-9]/.test(value)) errors.push('Must contain number');

      return errors.length > 0 ? errors : undefined;
    }
  }
});

<div>
  <input {...form.getFieldProps('password')} />

  {#if form.errors.password}
    <ul class="errors">
      {#each form.errors.password as error}
        <li>{error}</li>
      {/each}
    </ul>
  {/if}
</div>
```

### Error Styling

Style fields based on errors:

```typescript
const inputClass = computed(() => {
  const base = 'input';
  const error = form.touched.email && form.errors.email ? 'input-error' : '';
  return `${base} ${error}`;
});

<input class={inputClass()} {...form.getFieldProps('email')} />
```

## Form Submission

### Basic Submission

```typescript
const form = createForm({
  initialValues: { email: '' },

  onSubmit: async (values) => {
    await api.submitForm(values);
  }
});

<form onSubmit={form.handleSubmit}>
  {/* Fields... */}
  <button type="submit">Submit</button>
</form>
```

### Submission State

Track submission state:

```typescript
const form = createForm({
  initialValues: { email: '' },

  onSubmit: async (values) => {
    await delay(2000); // Simulate API call
  }
});

<button type="submit" disabled={form.isSubmitting}>
  {form.isSubmitting ? 'Submitting...' : 'Submit'}
</button>
```

### Success/Error Handling

Handle submission results:

```typescript
const success = signal(false);

const form = createForm({
  initialValues: { email: '' },

  onSubmit: async (values) => {
    try {
      await api.submitForm(values);
      success.set(true);
      form.reset();
    } catch (error) {
      form.setFormError(error.message);
    }
  }
});

<form onSubmit={form.handleSubmit}>
  {#if success()}
    <div class="alert alert-success">Form submitted successfully!</div>
  {/if}

  {#if form.formError}
    <div class="alert alert-error">{form.formError}</div>
  {/if}

  {/* Fields... */}
</form>
```

### Prevent Duplicate Submissions

Prevent multiple submissions:

```typescript
const form = createForm({
  initialValues: { email: '' },

  onSubmit: async (values) => {
    // Automatically prevents duplicate submissions
    await api.submitForm(values);
  }
});

// Button is disabled while submitting
<button type="submit" disabled={form.isSubmitting}>Submit</button>
```

### Server Actions

Use server actions:

```typescript
// actions/login.ts
'use server';
export async function login(values: { email: string; password: string }) {
  // Validate
  if (!values.email) throw new Error('Email required');

  // Process
  const user = await db.users.findUnique({ where: { email: values.email } });
  if (!user) throw new Error('Invalid credentials');

  return user;
}

// Component
import { login } from '@/actions/login';

const form = createForm({
  initialValues: { email: '', password: '' },
  onSubmit: login
});
```

## Field Arrays

### Dynamic Fields

Add/remove fields dynamically:

```typescript
const form = createForm({
  initialValues: {
    tags: ['']
  }
});

const addTag = () => {
  form.setFieldValue('tags', [...form.values.tags, '']);
};

const removeTag = (index: number) => {
  form.setFieldValue('tags', form.values.tags.filter((_, i) => i !== index));
};

<div>
  {#each form.values.tags as tag, index}
    <div>
      <input
        value={tag}
        onInput={e => form.setFieldValue(`tags.${index}`, e.target.value)}
      />
      <button onClick={() => removeTag(index)}>Remove</button>
    </div>
  {/each}

  <button onClick={addTag}>Add Tag</button>
</div>
```

### Field Array Helper

Use field array helper:

```typescript
import { createFieldArray } from 'aether/forms';

const form = createForm({
  initialValues: {
    todos: [{ text: '', done: false }]
  }
});

const todos = createFieldArray(form, 'todos');

<div>
  {#each todos.fields() as field, index}
    <div>
      <input
        bind:value={field.text}
        placeholder="Todo"
      />
      <input
        type="checkbox"
        bind:checked={field.done}
      />
      <button onClick={() => todos.remove(index)}>Remove</button>
    </div>
  {/each}

  <button onClick={() => todos.push({ text: '', done: false })}>
    Add Todo
  </button>
</div>
```

### Nested Arrays

Handle nested arrays:

```typescript
const form = createForm({
  initialValues: {
    users: [
      { name: '', emails: [''] }
    ]
  }
});

const addEmail = (userIndex: number) => {
  const user = form.values.users[userIndex];
  form.setFieldValue(
    `users.${userIndex}.emails`,
    [...user.emails, '']
  );
};

<div>
  {#each form.values.users as user, userIndex}
    <div>
      <input
        value={user.name}
        onInput={e => form.setFieldValue(`users.${userIndex}.name`, e.target.value)}
      />

      {#each user.emails as email, emailIndex}
        <input
          value={email}
          onInput={e => form.setFieldValue(`users.${userIndex}.emails.${emailIndex}`, e.target.value)}
        />
      {/each}

      <button onClick={() => addEmail(userIndex)}>Add Email</button>
    </div>
  {/each}
</div>
```

## File Uploads

### Single File Upload

```typescript
const file = signal<File | null>(null);

const handleFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const selectedFile = input.files?.[0];
  if (selectedFile) file.set(selectedFile);
};

const handleSubmit = async (e: Event) => {
  e.preventDefault();

  const formData = new FormData();
  if (file()) formData.append('file', file()!);

  await api.uploadFile(formData);
};

<form onSubmit={handleSubmit}>
  <input type="file" onChange={handleFileChange} />

  {#if file()}
    <p>Selected: {file()!.name}</p>
  {/if}

  <button type="submit">Upload</button>
</form>
```

### Multiple File Upload

```typescript
const files = signal<File[]>([]);

const handleFilesChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const selectedFiles = Array.from(input.files || []);
  files.set(selectedFiles);
};

const handleSubmit = async (e: Event) => {
  e.preventDefault();

  const formData = new FormData();
  files().forEach(file => formData.append('files', file));

  await api.uploadFiles(formData);
};

<form onSubmit={handleSubmit}>
  <input type="file" multiple onChange={handleFilesChange} />

  {#if files().length > 0}
    <ul>
      {#each files() as file}
        <li>{file.name}</li>
      {/each}
    </ul>
  {/if}

  <button type="submit">Upload</button>
</form>
```

### File Preview

Preview images before upload:

```typescript
const preview = signal<string | null>(null);

const handleFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    const reader = new FileReader();
    reader.onloadend = () => {
      preview.set(reader.result as string);
    };
    reader.readAsDataURL(file);
  }
};

<div>
  <input type="file" accept="image/*" onChange={handleFileChange} />

  {#if preview()}
    <img src={preview()!} alt="Preview" />
  {/if}
</div>
```

### Progress Tracking

Track upload progress:

```typescript
const progress = signal(0);

const handleSubmit = async (e: Event) => {
  e.preventDefault();

  const formData = new FormData();
  formData.append('file', file()!);

  await api.uploadFile(formData, {
    onUploadProgress: (progressEvent) => {
      const percentCompleted = Math.round(
        (progressEvent.loaded * 100) / progressEvent.total
      );
      progress.set(percentCompleted);
    }
  });
};

<div>
  {#if progress() > 0}
    <progress value={progress()} max="100">{progress()}%</progress>
  {/if}
</div>
```

## Form Libraries

### React Hook Form Integration

Use React Hook Form patterns:

```typescript
import { createForm } from 'aether/forms';

// Similar API to React Hook Form
const form = createForm({
  initialValues: { email: '', password: '' },

  validate: {
    email: (value) => !value ? 'Required' : undefined
  }
});

// Register pattern
const emailField = form.register('email');

<input {...emailField} />
```

### Formik-style API

Formik-compatible API:

```typescript
import { useFormik } from 'aether/forms';

const formik = useFormik({
  initialValues: { email: '', password: '' },

  validate: (values) => {
    const errors: any = {};
    if (!values.email) errors.email = 'Required';
    return errors;
  },

  onSubmit: async (values) => {
    await api.login(values);
  }
});

<form onSubmit={formik.handleSubmit}>
  <input
    name="email"
    value={formik.values.email}
    onChange={formik.handleChange}
    onBlur={formik.handleBlur}
  />
</form>
```

## Server Validation

### Server-Side Validation

Validate on the server:

```typescript
// actions/create-user.ts
'use server';

export async function createUser(values: CreateUserInput) {
  // Server-side validation
  const errors: any = {};

  // Check if email exists
  const existing = await db.users.findUnique({
    where: { email: values.email }
  });

  if (existing) {
    errors.email = 'Email already registered';
  }

  // Check username
  const usernameExists = await db.users.findUnique({
    where: { username: values.username }
  });

  if (usernameExists) {
    errors.username = 'Username taken';
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  // Create user
  return await db.users.create({ data: values });
}

// Component
const form = createForm({
  initialValues: { email: '', username: '' },

  onSubmit: async (values) => {
    try {
      await createUser(values);
    } catch (error) {
      if (error instanceof ValidationError) {
        // Set server errors
        form.errors.set(error.errors);
      }
    }
  }
});
```

### Progressive Enhancement

Forms work without JS:

```typescript
// Server action
'use server';
export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  // Validate
  if (!email) return { error: 'Email required' };

  // Process
  const user = await db.users.findUnique({ where: { email } });
  if (!user) return { error: 'Invalid credentials' };

  redirect('/dashboard');
}

// Component
<form action={login} method="post">
  <input name="email" required />
  <input name="password" type="password" required />
  <button type="submit">Login</button>
</form>
```

Enhanced with JavaScript:

```typescript
const form = createForm({
  action: login,
  initialValues: { email: '', password: '' },

  // Client-side validation (optional)
  validate: {
    email: (value) => !value ? 'Required' : undefined
  }
});

<form onSubmit={form.handleSubmit}>
  <input {...form.getFieldProps('email')} />
  <input {...form.getFieldProps('password')} type="password" />
  <button type="submit" disabled={form.isSubmitting}>Login</button>
</form>
```

## Accessibility

### ARIA Attributes

Auto-generated ARIA attributes:

```typescript
const form = createForm({
  initialValues: { email: '' },
  validate: { email: (value) => !value ? 'Required' : undefined }
});

<input
  {...form.getFieldProps('email')}
  aria-invalid={!!form.errors.email}
  aria-describedby={form.errors.email ? 'email-error' : undefined}
  aria-required="true"
/>

{#if form.errors.email}
  <span id="email-error" role="alert">
    {form.errors.email}
  </span>
{/if}
```

### Field Labels

Always use labels:

```typescript
<label for="email">Email</label>
<input id="email" {...form.getFieldProps('email')} />
```

### Error Announcements

Announce errors to screen readers:

```typescript
<div role="alert" aria-live="polite">
  {#if form.errors.email}
    {form.errors.email}
  {/if}
</div>
```

### Focus Management

Focus first error on submit:

```typescript
const form = createForm({
  initialValues: { email: '', password: '' },

  onSubmit: async (values) => {
    // Validate
    const isValid = await form.validateForm();

    if (!isValid) {
      // Focus first error
      const firstError = Object.keys(form.errors)[0];
      const input = document.querySelector(`[name="${firstError}"]`) as HTMLInputElement;
      input?.focus();
      return;
    }

    // Submit
    await api.login(values);
  }
});
```

## Performance

### Fine-Grained Updates

Only re-render changed fields:

```typescript
const form = createForm({
  initialValues: {
    email: '',
    password: '',
    username: ''
  }
});

// Changing email only re-renders email field
form.setFieldValue('email', 'test@example.com');

// Other fields don't re-render
```

### Debounced Validation

Debounce validation:

```typescript
import { debounce } from 'aether/utils';

const form = createForm({
  initialValues: { username: '' },

  validate: {
    username: debounce(async (value) => {
      const exists = await api.checkUsername(value);
      return exists ? 'Username taken' : undefined;
    }, 300)
  }
});
```

### Memoized Validation

Memoize validation:

```typescript
import { memo } from 'aether/utils';

const validateEmail = memo((value: string) => {
  // Expensive validation
  return !value.includes('@') ? 'Invalid email' : undefined;
});

const form = createForm({
  initialValues: { email: '' },
  validate: { email: validateEmail }
});
```

## Best Practices

### 1. Use Schema Validation

```typescript
// ✅ Schema validation (recommended)
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const form = createForm({
  initialValues: { email: '', password: '' },
  validate: schema
});

// ❌ Manual validation (verbose)
const form = createForm({
  initialValues: { email: '', password: '' },
  validate: {
    email: (value) => {
      if (!value) return 'Required';
      if (!value.includes('@')) return 'Invalid';
    },
    password: (value) => {
      if (!value) return 'Required';
      if (value.length < 8) return 'Too short';
    }
  }
});
```

### 2. Validate on Blur

```typescript
// ✅ Validate on blur (better UX)
const form = createForm({
  initialValues: { email: '' },
  validate: { email: (value) => !value ? 'Required' : undefined },
  validateOn: 'blur'
});

// ❌ Validate on change (annoying)
const form = createForm({
  initialValues: { email: '' },
  validate: { email: (value) => !value ? 'Required' : undefined },
  validateOn: 'change'
});
```

### 3. Show Errors After Touch

```typescript
// ✅ Show errors after touch
{#if form.touched.email && form.errors.email}
  <span class="error">{form.errors.email}</span>
{/if}

// ❌ Show errors immediately
{#if form.errors.email}
  <span class="error">{form.errors.email}</span>
{/if}
```

### 4. Disable Submit While Submitting

```typescript
// ✅ Disable while submitting
<button type="submit" disabled={form.isSubmitting}>
  {form.isSubmitting ? 'Submitting...' : 'Submit'}
</button>

// ❌ No feedback
<button type="submit">Submit</button>
```

### 5. Reset After Success

```typescript
// ✅ Reset after success
onSubmit: async (values) => {
  await api.submitForm(values);
  form.reset();
}

// ❌ Leave stale data
onSubmit: async (values) => {
  await api.submitForm(values);
}
```

## Advanced Patterns

### Wizard Forms

Multi-step forms:

```typescript
const step = signal(1);

const form = createForm({
  initialValues: {
    // Step 1
    email: '',
    password: '',
    // Step 2
    name: '',
    age: 0
  },

  validate: (values) => {
    const errors: any = {};

    if (step() === 1) {
      if (!values.email) errors.email = 'Required';
      if (!values.password) errors.password = 'Required';
    }

    if (step() === 2) {
      if (!values.name) errors.name = 'Required';
      if (values.age < 18) errors.age = 'Must be 18+';
    }

    return errors;
  }
});

const nextStep = async () => {
  const isValid = await form.validateForm();
  if (isValid) step.set(step() + 1);
};

<form onSubmit={form.handleSubmit}>
  {#if step() === 1}
    <input {...form.getFieldProps('email')} />
    <input {...form.getFieldProps('password')} type="password" />
    <button onClick={nextStep}>Next</button>
  {/if}

  {#if step() === 2}
    <input {...form.getFieldProps('name')} />
    <input {...form.getFieldProps('age')} type="number" />
    <button onClick={() => step.set(1)}>Back</button>
    <button type="submit">Submit</button>
  {/if}
</form>
```

### Conditional Fields

Show fields conditionally:

```typescript
const form = createForm({
  initialValues: {
    hasCompany: false,
    companyName: ''
  },

  validate: {
    companyName: (value, values) => {
      if (values.hasCompany && !value) {
        return 'Required';
      }
    }
  }
});

<form>
  <label>
    <input
      type="checkbox"
      bind:checked={form.values.hasCompany}
    />
    I have a company
  </label>

  {#if form.values.hasCompany}
    <input {...form.getFieldProps('companyName')} placeholder="Company Name" />
  {/if}
</form>
```

### Computed Values

Auto-compute values:

```typescript
const form = createForm({
  initialValues: {
    quantity: 1,
    price: 10,
    total: 10
  }
});

// Auto-compute total
effect(() => {
  const total = form.values.quantity * form.values.price;
  form.setFieldValue('total', total);
});

<input
  type="number"
  {...form.getFieldProps('quantity')}
/>

<input
  type="number"
  {...form.getFieldProps('price')}
/>

<p>Total: ${form.values.total}</p>
```

## API Reference

### createForm

```typescript
function createForm<T extends Record<string, any>>(options: {
  initialValues: T;
  validate?: ValidateFunction<T> | Schema;
  validateOn?: 'blur' | 'change' | 'submit' | ((field: keyof T) => 'blur' | 'change');
  onSubmit: (values: T) => void | Promise<void>;
}): Form<T>;

interface Form<T> {
  // State
  values: T;
  errors: Partial<Record<keyof T, string | string[]>>;
  touched: Partial<Record<keyof T, boolean>>;
  isSubmitting: boolean;
  isValid: boolean;
  formError: string | null;

  // Methods
  setFieldValue<K extends keyof T>(field: K, value: T[K]): void;
  setFieldError<K extends keyof T>(field: K, error: string): void;
  setFieldTouched<K extends keyof T>(field: K, touched: boolean): void;
  errors.set(errors: Partial<Record<keyof T, string>>): void;
  setFormError(error: string): void;
  validateField<K extends keyof T>(field: K): Promise<boolean>;
  validateForm(): Promise<boolean>;
  reset(): void;
  handleSubmit(e?: Event): void;
  getFieldProps<K extends keyof T>(field: K): FieldProps;
  register<K extends keyof T>(field: K): RegisterReturn;
}
```

### createFieldArray

```typescript
function createFieldArray<T>(
  form: Form<any>,
  field: string
): FieldArray<T>;

interface FieldArray<T> {
  fields(): T[];
  push(value: T): void;
  remove(index: number): void;
  insert(index: number, value: T): void;
  move(from: number, to: number): void;
  swap(indexA: number, indexB: number): void;
}
```

## Examples

### Login Form

```typescript
import { createForm, z } from 'aether/forms';

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Must be at least 8 characters')
});

export const LoginForm = defineComponent(() => {
  const form = createForm({
    initialValues: { email: '', password: '' },
    validate: loginSchema,
    onSubmit: async (values) => {
      await api.login(values);
    }
  });

  return () => (
    <form onSubmit={form.handleSubmit} class="space-y-4">
      <div>
        <label for="email">Email</label>
        <input
          id="email"
          type="email"
          {...form.getFieldProps('email')}
          class={form.touched.email && form.errors.email ? 'input-error' : ''}
        />
        {#if form.touched.email && form.errors.email}
          <span class="error">{form.errors.email}</span>
        {/if}
      </div>

      <div>
        <label for="password">Password</label>
        <input
          id="password"
          type="password"
          {...form.getFieldProps('password')}
        />
        {#if form.touched.password && form.errors.password}
          <span class="error">{form.errors.password}</span>
        {/if}
      </div>

      <button type="submit" disabled={form.isSubmitting}>
        {form.isSubmitting ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
});
```

### Registration Form

```typescript
import { createForm, z } from 'aether/forms';

const registerSchema = z.object({
  username: z.string().min(3).max(20),
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string()
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword']
});

export const RegisterForm = defineComponent(() => {
  const form = createForm({
    initialValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: ''
    },
    validate: registerSchema,
    onSubmit: async (values) => {
      await api.register(values);
    }
  });

  return () => (
    <form onSubmit={form.handleSubmit}>
      {/* Username */}
      <input {...form.getFieldProps('username')} placeholder="Username" />
      {#if form.touched.username && form.errors.username}
        <span class="error">{form.errors.username}</span>
      {/if}

      {/* Email */}
      <input {...form.getFieldProps('email')} type="email" placeholder="Email" />
      {#if form.touched.email && form.errors.email}
        <span class="error">{form.errors.email}</span>
      {/if}

      {/* Password */}
      <input {...form.getFieldProps('password')} type="password" placeholder="Password" />
      {#if form.touched.password && form.errors.password}
        <span class="error">{form.errors.password}</span>
      {/if}

      {/* Confirm Password */}
      <input {...form.getFieldProps('confirmPassword')} type="password" placeholder="Confirm Password" />
      {#if form.touched.confirmPassword && form.errors.confirmPassword}
        <span class="error">{form.errors.confirmPassword}</span>
      {/if}

      <button type="submit" disabled={form.isSubmitting}>
        {form.isSubmitting ? 'Creating account...' : 'Sign Up'}
      </button>
    </form>
  );
});
```

---

**Aether forms are designed to be flexible, type-safe, and accessible.** The fine-grained reactivity ensures optimal performance, while the rich validation system and server integration make it easy to build robust forms for any use case.

**Next**: [16. Server-Side Rendering →](./16-SSR.md)
