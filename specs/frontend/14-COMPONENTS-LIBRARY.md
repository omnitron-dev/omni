# 14. Component Library

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Installation](#installation)
- [Theming](#theming)
- [Components](#components)
  - [Button](#button)
  - [Input](#input)
  - [Card](#card)
  - [Dialog](#dialog)
  - [Dropdown](#dropdown)
  - [Select](#select)
  - [Table](#table)
  - [Tabs](#tabs)
  - [Form](#form)
  - [Toast](#toast)
- [Customization](#customization)
- [Accessibility](#accessibility)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

Nexus Component Library is a **styled component library** built on top of Nexus Primitives. It provides:

- 🎨 **Beautiful defaults**: Production-ready designs
- 🔧 **Fully customizable**: Theme tokens and variant props
- ♿ **Accessible**: WAI-ARIA compliant
- 📦 **Tree-shakeable**: Import only what you need
- 🎯 **Type-safe**: Full TypeScript support
- 🌗 **Dark mode**: Built-in theme support

### Architecture

```
Nexus Component Library (Styled)
       ↓ Built on
Nexus Primitives (Headless)
       ↓ Uses
Nexus Core (Reactivity, Components)
```

**Primitives** (from spec 13): Headless, unstyled, accessible
**Component Library** (this spec): Styled, themed, production-ready

### Quick Example

```typescript
import { Button, Card, Input } from 'nexus/components';

export default defineComponent(() => {
  const email = signal('');

  return () => (
    <Card>
      <Card.Header>
        <Card.Title>Sign In</Card.Title>
        <Card.Description>Enter your email to continue</Card.Description>
      </Card.Header>

      <Card.Content>
        <Input
          type="email"
          placeholder="email@example.com"
          value={email()}
          onInput={e => email.set(e.target.value)}
        />
      </Card.Content>

      <Card.Footer>
        <Button variant="primary" size="lg">
          Continue
        </Button>
      </Card.Footer>
    </Card>
  );
});
```

## Philosophy

### Built on Primitives

Components are **styled wrappers around primitives**:

```typescript
// Primitive (headless)
import { Button as ButtonPrimitive } from 'nexus/primitives';

// Component (styled)
export const Button = styled(ButtonPrimitive, {
  // Base styles
  padding: '$2 $4',
  borderRadius: '$md',
  fontSize: '$sm',
  fontWeight: 500,
  transition: 'all 0.2s',

  // Variants
  variants: {
    variant: {
      primary: {
        background: '$primary',
        color: '$onPrimary',
        '&:hover': { background: '$primaryHover' }
      },
      secondary: {
        background: '$secondary',
        color: '$onSecondary',
        '&:hover': { background: '$secondaryHover' }
      }
    }
  }
});
```

### Theme-Driven

All styles use **theme tokens**:

```typescript
// ✅ Theme tokens (easy to customize)
const Button = styled('button', {
  background: '$primary',
  color: '$onPrimary',
  padding: '$2 $4',
  borderRadius: '$md'
});

// ❌ Hardcoded values (difficult to customize)
const Button = styled('button', {
  background: '#007bff',
  color: '#ffffff',
  padding: '8px 16px',
  borderRadius: '6px'
});
```

### Composable

Components **compose together**:

```typescript
<Card>
  <Card.Header>
    <Card.Title>User Profile</Card.Title>
  </Card.Header>

  <Card.Content>
    <Form>
      <Form.Field>
        <Form.Label>Name</Form.Label>
        <Input />
      </Form.Field>

      <Form.Field>
        <Form.Label>Email</Form.Label>
        <Input type="email" />
      </Form.Field>
    </Form>
  </Card.Content>

  <Card.Footer>
    <Button variant="outline">Cancel</Button>
    <Button variant="primary">Save</Button>
  </Card.Footer>
</Card>
```

### Customizable

Override styles easily:

```typescript
// Override with className
<Button className="custom-button">Click me</Button>

// Override with style prop
<Button style={{ background: 'red' }}>Click me</Button>

// Override with css prop
<Button css={{ background: '$danger' }}>Click me</Button>
```

## Installation

### Package Installation

```bash
npm install nexus
# or
yarn add nexus
# or
pnpm add nexus
```

### Import Components

```typescript
// Individual imports (tree-shakeable)
import { Button } from 'nexus/components/Button';
import { Card } from 'nexus/components/Card';
import { Input } from 'nexus/components/Input';

// Namespace import
import * as UI from 'nexus/components';

<UI.Button>Click me</UI.Button>
```

### Setup Theme

```typescript
// app.tsx
import { ThemeProvider } from 'nexus/theme';
import { lightTheme } from 'nexus/themes';

export default defineComponent(() => {
  return () => (
    <ThemeProvider theme={lightTheme}>
      <App />
    </ThemeProvider>
  );
});
```

## Theming

### Default Themes

Built-in themes:

```typescript
import { lightTheme, darkTheme } from 'nexus/themes';

// Light theme
<ThemeProvider theme={lightTheme}>
  <App />
</ThemeProvider>

// Dark theme
<ThemeProvider theme={darkTheme}>
  <App />
</ThemeProvider>
```

### Custom Theme

Create custom theme:

```typescript
import { createTheme } from 'nexus/theme';

const myTheme = createTheme({
  colors: {
    primary: '#6366f1',
    primaryHover: '#4f46e5',
    onPrimary: '#ffffff',

    secondary: '#f3f4f6',
    secondaryHover: '#e5e7eb',
    onSecondary: '#111827',

    danger: '#ef4444',
    dangerHover: '#dc2626',
    onDanger: '#ffffff'
  },

  spacing: {
    '1': '4px',
    '2': '8px',
    '3': '12px',
    '4': '16px',
    '6': '24px',
    '8': '32px'
  },

  borderRadius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    full: '9999px'
  },

  fonts: {
    body: 'Inter, sans-serif',
    heading: 'Inter, sans-serif',
    mono: 'JetBrains Mono, monospace'
  }
});

<ThemeProvider theme={myTheme}>
  <App />
</ThemeProvider>
```

### Theme Switching

Switch themes dynamically:

```typescript
import { useTheme } from 'nexus/theme';

export const ThemeToggle = defineComponent(() => {
  const { theme, setTheme } = useTheme();

  const toggle = () => {
    theme.set(theme === 'light' ? 'dark' : 'light');
  };

  return () => (
    <Button onClick={toggle}>
      {theme === 'light' ? '🌙' : '☀️'}
    </Button>
  );
});
```

## Components

### Button

**Variants**: `primary`, `secondary`, `outline`, `ghost`, `danger`
**Sizes**: `sm`, `md`, `lg`

```typescript
import { Button } from 'nexus/components';

<Button variant="primary" size="md">
  Click me
</Button>

<Button variant="outline" size="lg">
  Outlined
</Button>

<Button variant="ghost" disabled>
  Disabled
</Button>

<Button variant="danger" loading>
  Loading...
</Button>
```

**Props**:

```typescript
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: JSX.Element;
  rightIcon?: JSX.Element;
  children: any;
  onClick?: () => void;
}
```

**Example**:

```typescript
<Button
  variant="primary"
  size="lg"
  leftIcon={<PlusIcon />}
  onClick={() => console.log('clicked')}
>
  Add Item
</Button>
```

### Input

**Variants**: `default`, `outline`, `filled`
**Sizes**: `sm`, `md`, `lg`

```typescript
import { Input } from 'nexus/components';

<Input
  type="text"
  placeholder="Enter text..."
  value={value()}
  onInput={e => value.set(e.target.value)}
/>

<Input
  type="email"
  variant="outline"
  size="lg"
  error="Invalid email"
/>

<Input
  type="password"
  leftIcon={<LockIcon />}
  rightIcon={<EyeIcon />}
/>
```

**Props**:

```typescript
interface InputProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';
  variant?: 'default' | 'outline' | 'filled';
  size?: 'sm' | 'md' | 'lg';
  placeholder?: string;
  value?: string;
  error?: string;
  disabled?: boolean;
  leftIcon?: JSX.Element;
  rightIcon?: JSX.Element;
  onInput?: (e: InputEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
}
```

### Card

**Structure**: `Card`, `Card.Header`, `Card.Title`, `Card.Description`, `Card.Content`, `Card.Footer`

```typescript
import { Card } from 'nexus/components';

<Card>
  <Card.Header>
    <Card.Title>Card Title</Card.Title>
    <Card.Description>Card description goes here</Card.Description>
  </Card.Header>

  <Card.Content>
    <p>Card content...</p>
  </Card.Content>

  <Card.Footer>
    <Button variant="outline">Cancel</Button>
    <Button variant="primary">Save</Button>
  </Card.Footer>
</Card>
```

**Variants**:

```typescript
<Card variant="elevated">Elevated</Card>
<Card variant="outlined">Outlined</Card>
<Card variant="filled">Filled</Card>
```

### Dialog

**Modal dialog with overlay**

```typescript
import { Dialog } from 'nexus/components';

const open = signal(false);

<>
  <Button onClick={() => open.set(true)}>Open Dialog</Button>

  <Dialog open={open()} onOpenChange={setOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Confirm Action</Dialog.Title>
        <Dialog.Description>
          Are you sure you want to proceed?
        </Dialog.Description>
      </Dialog.Header>

      <Dialog.Footer>
        <Button variant="outline" onClick={() => open.set(false)}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => open.set(false)}>
          Confirm
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog>
</>
```

### Dropdown

**Dropdown menu**

```typescript
import { Dropdown } from 'nexus/components';

<Dropdown>
  <Dropdown.Trigger>
    <Button variant="outline">Options</Button>
  </Dropdown.Trigger>

  <Dropdown.Content>
    <Dropdown.Item onClick={() => console.log('Edit')}>
      Edit
    </Dropdown.Item>
    <Dropdown.Item onClick={() => console.log('Duplicate')}>
      Duplicate
    </Dropdown.Item>
    <Dropdown.Separator />
    <Dropdown.Item variant="danger" onClick={() => console.log('Delete')}>
      Delete
    </Dropdown.Item>
  </Dropdown.Content>
</Dropdown>
```

### Select

**Select dropdown**

```typescript
import { Select } from 'nexus/components';

const value = signal('apple');

<Select value={value()} onValueChange={setValue}>
  <Select.Trigger>
    <Select.Value placeholder="Select a fruit" />
  </Select.Trigger>

  <Select.Content>
    <Select.Item value="apple">Apple</Select.Item>
    <Select.Item value="banana">Banana</Select.Item>
    <Select.Item value="orange">Orange</Select.Item>
  </Select.Content>
</Select>
```

### Table

**Data table**

```typescript
import { Table } from 'nexus/components';

const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' }
];

<Table>
  <Table.Header>
    <Table.Row>
      <Table.Head>Name</Table.Head>
      <Table.Head>Email</Table.Head>
      <Table.Head>Actions</Table.Head>
    </Table.Row>
  </Table.Header>

  <Table.Body>
    {#each users as user}
      <Table.Row>
        <Table.Cell>{user.name}</Table.Cell>
        <Table.Cell>{user.email}</Table.Cell>
        <Table.Cell>
          <Button variant="ghost" size="sm">Edit</Button>
        </Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table>
```

### Tabs

**Tabbed interface**

```typescript
import { Tabs } from 'nexus/components';

<Tabs defaultValue="account">
  <Tabs.List>
    <Tabs.Trigger value="account">Account</Tabs.Trigger>
    <Tabs.Trigger value="password">Password</Tabs.Trigger>
    <Tabs.Trigger value="notifications">Notifications</Tabs.Trigger>
  </Tabs.List>

  <Tabs.Content value="account">
    <p>Account settings</p>
  </Tabs.Content>

  <Tabs.Content value="password">
    <p>Password settings</p>
  </Tabs.Content>

  <Tabs.Content value="notifications">
    <p>Notification settings</p>
  </Tabs.Content>
</Tabs>
```

### Form

**Form components**

```typescript
import { Form, Input, Button } from 'nexus/components';

const form = createForm({
  initialValues: { name: '', email: '' },
  validate: schema
});

<Form onSubmit={form.handleSubmit}>
  <Form.Field>
    <Form.Label htmlFor="name">Name</Form.Label>
    <Input id="name" {...form.getFieldProps('name')} />
    {#if form.errors.name}
      <Form.Error>{form.errors.name}</Form.Error>
    {/if}
  </Form.Field>

  <Form.Field>
    <Form.Label htmlFor="email">Email</Form.Label>
    <Input id="email" type="email" {...form.getFieldProps('email')} />
    {#if form.errors.email}
      <Form.Error>{form.errors.email}</Form.Error>
    {/if}
  </Form.Field>

  <Button type="submit" loading={form.isSubmitting}>
    Submit
  </Button>
</Form>
```

### Toast

**Toast notifications**

```typescript
import { toast } from 'nexus/components';

// Success
toast.success('User created successfully!');

// Error
toast.error('Failed to create user');

// Info
toast.info('New message received');

// Warning
toast.warning('Your session will expire soon');

// Custom
toast({
  title: 'Custom Toast',
  description: 'This is a custom toast',
  duration: 5000,
  action: {
    label: 'Undo',
    onClick: () => console.log('Undo clicked')
  }
});
```

## Customization

### Override Styles

```typescript
// With className
<Button className="my-custom-button">Click me</Button>

// With css prop
<Button css={{ background: '$danger' }}>Click me</Button>

// With style prop
<Button style={{ fontSize: '20px' }}>Click me</Button>
```

### Custom Variants

Add custom variants:

```typescript
import { styled } from 'nexus/styles';
import { Button as BaseButton } from 'nexus/components';

export const Button = styled(BaseButton, {
  variants: {
    variant: {
      // Add custom variant
      gradient: {
        background: 'linear-gradient(to right, #667eea, #764ba2)',
        color: 'white'
      }
    }
  }
});

<Button variant="gradient">Gradient Button</Button>
```

### Extend Components

Extend existing components:

```typescript
import { Button as BaseButton } from 'nexus/components';

export const IconButton = defineComponent<{
  icon: JSX.Element;
  label: string;
}>((props) => {
  return () => (
    <BaseButton variant="ghost" aria-label={props.label}>
      {props.icon}
    </BaseButton>
  );
});

<IconButton icon={<TrashIcon />} label="Delete" />
```

## Accessibility

All components are **fully accessible**:

### Keyboard Navigation

- **Button**: `Enter`, `Space`
- **Dialog**: `Escape` to close
- **Dropdown**: Arrow keys, `Enter`, `Escape`
- **Tabs**: Arrow keys to navigate
- **Select**: Arrow keys, `Enter`, `Escape`

### Screen Reader Support

```typescript
// Automatic ARIA attributes
<Button>Click me</Button>
// <button type="button">Click me</button>

<Input error="Invalid email" />
// <input aria-invalid="true" aria-describedby="error-id" />
// <span id="error-id" role="alert">Invalid email</span>

<Dialog>
  <Dialog.Title>Title</Dialog.Title>
  {/* ... */}
</Dialog>
// <div role="dialog" aria-labelledby="title-id" aria-modal="true">
//   <h2 id="title-id">Title</h2>
// </div>
```

### Focus Management

```typescript
// Dialog traps focus
<Dialog open={open()}>
  <Dialog.Content>
    {/* Focus trapped within dialog */}
    <Input />
    <Button>Close</Button>
  </Dialog.Content>
</Dialog>

// Focus returns to trigger when closed
```

## Best Practices

### 1. Use Semantic HTML

```typescript
// ✅ Semantic
<Form>
  <Form.Field>
    <Form.Label htmlFor="email">Email</Form.Label>
    <Input id="email" type="email" />
  </Form.Field>
</Form>

// ❌ Non-semantic
<div>
  <div>Email</div>
  <input type="email" />
</div>
```

### 2. Provide Accessible Labels

```typescript
// ✅ Accessible
<Button aria-label="Delete item">
  <TrashIcon />
</Button>

<Input placeholder="Search..." aria-label="Search" />

// ❌ Not accessible
<Button>
  <TrashIcon />
</Button>
```

### 3. Handle Loading States

```typescript
// ✅ Loading state
<Button loading={isLoading()}>
  {isLoading() ? 'Saving...' : 'Save'}
</Button>

// ❌ No feedback
<Button onClick={save}>Save</Button>
```

### 4. Show Error States

```typescript
// ✅ Error state
<Input
  value={email()}
  error={errors().email}
  aria-invalid={!!errors().email}
/>

// ❌ Silent errors
<Input value={email()} />
```

## Examples

### Login Form

```typescript
import { Card, Form, Input, Button, toast } from 'nexus/components';

export const LoginForm = defineComponent(() => {
  const form = createForm({
    initialValues: { email: '', password: '' },
    validate: z.object({
      email: z.string().email(),
      password: z.string().min(8)
    }),
    onSubmit: async (values) => {
      try {
        await api.login(values);
        toast.success('Logged in successfully!');
      } catch (error) {
        toast.error('Invalid credentials');
      }
    }
  });

  return () => (
    <Card>
      <Card.Header>
        <Card.Title>Sign In</Card.Title>
        <Card.Description>Enter your credentials to continue</Card.Description>
      </Card.Header>

      <Card.Content>
        <Form onSubmit={form.handleSubmit}>
          <Form.Field>
            <Form.Label htmlFor="email">Email</Form.Label>
            <Input
              id="email"
              type="email"
              placeholder="email@example.com"
              {...form.getFieldProps('email')}
              error={form.errors.email}
            />
          </Form.Field>

          <Form.Field>
            <Form.Label htmlFor="password">Password</Form.Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              {...form.getFieldProps('password')}
              error={form.errors.password}
            />
          </Form.Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={form.isSubmitting}
          >
            Sign In
          </Button>
        </Form>
      </Card.Content>
    </Card>
  );
});
```

### Data Table with Actions

```typescript
import { Table, Button, Dropdown, Dialog, toast } from 'nexus/components';

export const UserTable = defineComponent<{ users: User[] }>((props) => {
  const deleteId = signal<string | null>(null);

  const handleDelete = async () => {
    if (!deleteId()) return;

    try {
      await api.deleteUser(deleteId()!);
      toast.success('User deleted');
      deleteId.set(null);
    } catch (error) {
      toast.error('Failed to delete user');
    }
  };

  return () => (
    <>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.Head>Name</Table.Head>
            <Table.Head>Email</Table.Head>
            <Table.Head>Role</Table.Head>
            <Table.Head>Actions</Table.Head>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {#each props.users as user}
            <Table.Row>
              <Table.Cell>{user.name}</Table.Cell>
              <Table.Cell>{user.email}</Table.Cell>
              <Table.Cell>{user.role}</Table.Cell>
              <Table.Cell>
                <Dropdown>
                  <Dropdown.Trigger>
                    <Button variant="ghost" size="sm">
                      •••
                    </Button>
                  </Dropdown.Trigger>

                  <Dropdown.Content>
                    <Dropdown.Item onClick={() => navigate(`/users/${user.id}/edit`)}>
                      Edit
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => navigate(`/users/${user.id}`)}>
                      View
                    </Dropdown.Item>
                    <Dropdown.Separator />
                    <Dropdown.Item
                      variant="danger"
                      onClick={() => deleteId.set(user.id)}
                    >
                      Delete
                    </Dropdown.Item>
                  </Dropdown.Content>
                </Dropdown>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table>

      <Dialog open={!!deleteId()} onOpenChange={() => deleteId.set(null)}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Confirm Deletion</Dialog.Title>
            <Dialog.Description>
              Are you sure you want to delete this user? This action cannot be undone.
            </Dialog.Description>
          </Dialog.Header>

          <Dialog.Footer>
            <Button variant="outline" onClick={() => deleteId.set(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
});
```

### Settings Page

```typescript
import { Tabs, Card, Form, Input, Button, Select } from 'nexus/components';

export const SettingsPage = defineComponent(() => {
  const form = createForm({
    initialValues: {
      name: 'Alice',
      email: 'alice@example.com',
      theme: 'light',
      language: 'en'
    },
    onSubmit: async (values) => {
      await api.updateSettings(values);
      toast.success('Settings saved');
    }
  });

  return () => (
    <div class="container">
      <h1>Settings</h1>

      <Tabs defaultValue="profile">
        <Tabs.List>
          <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
          <Tabs.Trigger value="appearance">Appearance</Tabs.Trigger>
          <Tabs.Trigger value="notifications">Notifications</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="profile">
          <Card>
            <Card.Header>
              <Card.Title>Profile</Card.Title>
              <Card.Description>Manage your profile information</Card.Description>
            </Card.Header>

            <Card.Content>
              <Form onSubmit={form.handleSubmit}>
                <Form.Field>
                  <Form.Label>Name</Form.Label>
                  <Input {...form.getFieldProps('name')} />
                </Form.Field>

                <Form.Field>
                  <Form.Label>Email</Form.Label>
                  <Input type="email" {...form.getFieldProps('email')} />
                </Form.Field>
              </Form>
            </Card.Content>

            <Card.Footer>
              <Button variant="primary" onClick={form.handleSubmit}>
                Save Changes
              </Button>
            </Card.Footer>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="appearance">
          <Card>
            <Card.Header>
              <Card.Title>Appearance</Card.Title>
              <Card.Description>Customize the app appearance</Card.Description>
            </Card.Header>

            <Card.Content>
              <Form.Field>
                <Form.Label>Theme</Form.Label>
                <Select {...form.getFieldProps('theme')}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="light">Light</Select.Item>
                    <Select.Item value="dark">Dark</Select.Item>
                    <Select.Item value="system">System</Select.Item>
                  </Select.Content>
                </Select>
              </Form.Field>

              <Form.Field>
                <Form.Label>Language</Form.Label>
                <Select {...form.getFieldProps('language')}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="en">English</Select.Item>
                    <Select.Item value="es">Español</Select.Item>
                    <Select.Item value="fr">Français</Select.Item>
                  </Select.Content>
                </Select>
              </Form.Field>
            </Card.Content>

            <Card.Footer>
              <Button variant="primary" onClick={form.handleSubmit}>
                Save Changes
              </Button>
            </Card.Footer>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="notifications">
          <Card>
            <Card.Header>
              <Card.Title>Notifications</Card.Title>
              <Card.Description>Manage notification preferences</Card.Description>
            </Card.Header>

            <Card.Content>
              <p>Notification settings coming soon...</p>
            </Card.Content>
          </Card>
        </Tabs.Content>
      </Tabs>
    </div>
  );
});
```

---

**Nexus Component Library provides production-ready, accessible components** built on solid primitives with beautiful defaults and full customization. Use it to build modern web applications quickly without sacrificing quality or flexibility.

**Next**: [18. Static Site Generation →](./18-SSG.md)
