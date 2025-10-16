# Icon API Integration Examples

**Real-world examples of integrating the Icon API with Aether components**

## Table of Contents

- [Button Component Integration](#button-component-integration)
- [Icon Component Usage](#icon-component-usage)
- [Custom Component Integration](#custom-component-integration)
- [Form Components](#form-components)
- [Navigation Components](#navigation-components)
- [Card Components](#card-components)
- [Modal & Dialog](#modal--dialog)
- [Toast Notifications](#toast-notifications)
- [Advanced Patterns](#advanced-patterns)

---

## Button Component Integration

### Basic Button with Icons

```tsx
import { Button } from '@omnitron-dev/aether';

// Simple icon
<Button icon="save">Save</Button>

// Left icon
<Button leftIcon="arrow-left">Back</Button>

// Right icon
<Button rightIcon="arrow-right">Next</Button>

// Both icons
<Button leftIcon="download" rightIcon="external-link">
  Download
</Button>

// Icon-only button (requires aria-label)
<Button icon="trash" aria-label="Delete" />
```

### Button with Icon Presets

```tsx
// Stroke preset (default)
<Button icon={{ name: "save", preset: "stroke" }}>
  Save
</Button>

// Duotone preset
<Button icon={{ name: "save", preset: "duotone" }}>
  Save
</Button>

// Twotone preset
<Button icon={{ name: "save", preset: "twotone" }}>
  Save
</Button>

// Global preset for all icons
<Button
  leftIcon="user"
  rightIcon="settings"
  iconPreset="duotone"
>
  Profile Settings
</Button>
```

### Animated Button Icons

```tsx
// Hover animation
<Button icon={{ name: "heart", animation: "hover" }}>
  Like
</Button>

// Click animation
<Button icon={{ name: "bookmark", animation: "click" }}>
  Bookmark
</Button>

// Continuous spin
<Button icon={{ name: "refresh", animation: "spin" }}>
  Refresh
</Button>

// Pulse animation
<Button icon={{ name: "bell", animation: "pulse" }}>
  Notifications
</Button>
```

### Loading States

```tsx
import { signal } from '@omnitron-dev/aether';

const isLoading = signal(false);
const isSaving = signal(false);

// Basic loading
<Button
  loading={isLoading}
  onClick={async () => {
    isLoading.set(true);
    await fetchData();
    isLoading.set(false);
  }}
>
  Load Data
</Button>

// Custom loading icon
<Button
  loading={isSaving}
  loadingIcon={{ name: "loader", animation: "loading" }}
  leftIcon="save"
  onClick={async () => {
    isSaving.set(true);
    await saveData();
    isSaving.set(false);
  }}
>
  Save Changes
</Button>

// Different loading icon
<Button
  loading={isLoading}
  loadingIcon={{ name: "spinner", animation: "spin" }}
>
  Processing...
</Button>
```

### Button Size with Icon Scaling

```tsx
// Icon automatically scales with button size
<Button size="xs" icon="home">Home</Button>
<Button size="sm" icon="home">Home</Button>
<Button size="md" icon="home">Home</Button>  {/* Default */}
<Button size="lg" icon="home">Home</Button>
<Button size="xl" icon="home">Home</Button>

// Override icon size
<Button
  size="md"
  icon={{ name: "home", size: "xl" }}
>
  Home
</Button>

// Global icon size
<Button
  leftIcon="user"
  rightIcon="settings"
  iconSize="sm"
>
  Settings
</Button>
```

### Button Variants with Icons

```tsx
<Button variant="default" icon="save">Save</Button>
<Button variant="primary" icon="check">Confirm</Button>
<Button variant="secondary" icon="info">Info</Button>
<Button variant="danger" icon="trash">Delete</Button>
<Button variant="ghost" icon="x">Close</Button>
<Button variant="link" icon="external-link">Learn More</Button>
```

---

## Icon Component Usage

### Basic Icon Usage

```tsx
import { Icon } from '@omnitron-dev/aether';

// Simple icon
<Icon name="heart" />

// With size
<Icon name="heart" size="lg" />
<Icon name="heart" size={32} />

// With color
<Icon name="heart" color="red" />
<Icon name="heart" color="#ff0000" />
<Icon name="heart" color="var(--primary-color)" />

// With preset
<Icon name="heart" preset="duotone" />
```

### Icon Animations

```tsx
// Continuous animations
<Icon name="spinner" animation="spin" />
<Icon name="loader" animation="loading" />
<Icon name="heart" animation="pulse" />
<Icon name="arrow-down" animation="bounce" />

// Interactive animations
<Icon name="star" animation="hover" />
<Icon name="bookmark" animation="click" />

// Custom duration
<Icon
  name="refresh"
  animation="spin"
  animationDuration={1}  // 1 second
/>

// Custom timing
<Icon
  name="heart"
  animation="pulse"
  animationTiming="ease-in-out"
/>

// Limited iterations
<Icon
  name="bell"
  animation="bounce"
  animationIterations={3}
/>
```

### Icon Transformations

```tsx
// Rotation
<Icon name="arrow-right" rotate={45} />
<Icon name="arrow-right" rotate={90} />
<Icon name="arrow-right" rotate={180} />

// Flip
<Icon name="arrow-right" flip="horizontal" />
<Icon name="arrow-up" flip="vertical" />
<Icon name="image" flip="both" />

// Combined transformations
<Icon name="arrow-right" rotate={45} flip="horizontal" />

// Custom transform
<Icon name="star" transform="scale(1.5) translateX(10px)" />
```

### Reactive Icons

```tsx
import { signal, computed } from '@omnitron-dev/aether';

// Reactive color
const likeColor = signal("gray");

<Icon
  name="heart"
  color={likeColor}
  animation="click"
  onClick={() => {
    likeColor.set(likeColor() === "gray" ? "red" : "gray");
  }}
/>

// Reactive rotation
const rotation = signal(0);

<Icon
  name="arrow-right"
  rotate={rotation}
  onClick={() => rotation.set((rotation() + 45) % 360)}
/>

// Reactive animation
const isActive = signal(false);

<Icon
  name="bell"
  animation={computed(() => isActive() ? "pulse" : "none")}
  onClick={() => isActive.set(!isActive())}
/>
```

### Decorative Icons

```tsx
// Decorative icon (hidden from screen readers)
<div>
  <Icon name="sparkle" decorative />
  <span>Premium Feature</span>
</div>

// Meaningful icon with label
<Icon name="warning" label="Warning: Critical error" />

// Icon with explicit ARIA
<Icon
  name="info"
  aria-label="Information"
  aria-describedby="info-tooltip"
/>
```

---

## Custom Component Integration

### Alert Component

```tsx
import { defineComponent } from '@omnitron-dev/aether';
import { Icon } from '@omnitron-dev/aether';
import type { IconProp } from '@omnitron-dev/aether';

interface AlertProps {
  type?: 'info' | 'success' | 'warning' | 'error';
  icon?: IconProp;
  title?: string;
  children: any;
  onClose?: () => void;
}

const ALERT_ICONS: Record<string, IconProp> = {
  info: { name: 'info-circle', preset: 'stroke', color: 'blue' },
  success: { name: 'check-circle', preset: 'stroke', color: 'green' },
  warning: { name: 'alert-triangle', preset: 'stroke', color: 'orange' },
  error: { name: 'x-circle', preset: 'stroke', color: 'red' },
};

export const Alert = defineComponent<AlertProps>((props) => {
  return () => {
    const type = props.type || 'info';
    const icon = props.icon || ALERT_ICONS[type];

    return (
      <div data-alert data-alert-type={type}>
        <div class="alert-icon">
          <Icon {...(typeof icon === 'string' ? { name: icon } : icon)} />
        </div>
        <div class="alert-content">
          {props.title && <div class="alert-title">{props.title}</div>}
          <div class="alert-message">{props.children}</div>
        </div>
        {props.onClose && (
          <button
            class="alert-close"
            onClick={props.onClose}
            aria-label="Close alert"
          >
            <Icon name="x" size="sm" />
          </button>
        )}
      </div>
    );
  };
});

// Usage
<Alert type="success" title="Success!">
  Your changes have been saved.
</Alert>

<Alert icon={{ name: "rocket", animation: "pulse" }}>
  New feature unlocked!
</Alert>
```

### Badge Component

```tsx
interface BadgeProps {
  icon?: IconProp;
  children?: any;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
}

export const Badge = defineComponent<BadgeProps>((props) => {
  return () => (
    <span data-badge data-badge-variant={props.variant || 'default'}>
      {props.icon && (
        <Icon
          {...(typeof props.icon === 'string'
            ? { name: props.icon, size: 'xs' }
            : { size: 'xs', ...props.icon }
          )}
        />
      )}
      {props.children && <span>{props.children}</span>}
    </span>
  );
});

// Usage
<Badge icon="check" variant="success">Verified</Badge>
<Badge icon={{ name: "star", color: "gold" }}>Premium</Badge>
<Badge icon={{ name: "zap", animation: "pulse" }} variant="warning">
  Live
</Badge>
```

---

## Form Components

### Input with Icons

```tsx
interface InputProps {
  leftIcon?: IconProp;
  rightIcon?: IconProp;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export const Input = defineComponent<InputProps>((props) => {
  return () => (
    <div class="input-wrapper">
      {props.leftIcon && (
        <div class="input-icon input-icon-left">
          <Icon
            {...(typeof props.leftIcon === 'string'
              ? { name: props.leftIcon, size: 'sm' }
              : { size: 'sm', ...props.leftIcon }
            )}
          />
        </div>
      )}
      <input
        type="text"
        placeholder={props.placeholder}
        value={props.value}
        onInput={(e) => props.onChange?.(e.currentTarget.value)}
      />
      {props.rightIcon && (
        <div class="input-icon input-icon-right">
          <Icon
            {...(typeof props.rightIcon === 'string'
              ? { name: props.rightIcon, size: 'sm' }
              : { size: 'sm', ...props.rightIcon }
            )}
          />
        </div>
      )}
    </div>
  );
});

// Usage
<Input leftIcon="search" placeholder="Search..." />
<Input leftIcon="mail" placeholder="Email address" />
<Input
  rightIcon={{ name: "eye", animation: "hover" }}
  placeholder="Password"
/>
```

### Select with Icon

```tsx
<Select leftIcon="globe">
  <option>Select country</option>
  <option>United States</option>
  <option>Canada</option>
</Select>
```

---

## Navigation Components

### Nav Item

```tsx
interface NavItemProps {
  icon?: IconProp;
  label: string;
  href?: string;
  active?: boolean;
  badge?: number;
}

export const NavItem = defineComponent<NavItemProps>((props) => {
  return () => (
    <a
      href={props.href}
      data-nav-item
      data-active={props.active ? '' : undefined}
    >
      {props.icon && (
        <Icon
          {...(typeof props.icon === 'string'
            ? { name: props.icon }
            : props.icon
          )}
        />
      )}
      <span>{props.label}</span>
      {props.badge && <Badge>{props.badge}</Badge>}
    </a>
  );
});

// Usage
<nav>
  <NavItem icon="home" label="Home" href="/" active />
  <NavItem icon="user" label="Profile" href="/profile" />
  <NavItem
    icon={{ name: "bell", animation: "pulse" }}
    label="Notifications"
    href="/notifications"
    badge={5}
  />
  <NavItem icon="settings" label="Settings" href="/settings" />
</nav>
```

### Breadcrumb

```tsx
<Breadcrumb>
  <BreadcrumbItem icon="home" href="/">Home</BreadcrumbItem>
  <BreadcrumbItem icon="folder" href="/projects">Projects</BreadcrumbItem>
  <BreadcrumbItem>Current Project</BreadcrumbItem>
</Breadcrumb>
```

---

## Card Components

### Card with Icon Header

```tsx
interface CardProps {
  icon?: IconProp;
  title: string;
  subtitle?: string;
  actions?: any;
  children: any;
}

export const Card = defineComponent<CardProps>((props) => {
  return () => (
    <div data-card>
      <div class="card-header">
        {props.icon && (
          <div class="card-icon">
            <Icon
              {...(typeof props.icon === 'string'
                ? { name: props.icon, size: 'lg' }
                : { size: 'lg', ...props.icon }
              )}
            />
          </div>
        )}
        <div class="card-title-group">
          <h3>{props.title}</h3>
          {props.subtitle && <p>{props.subtitle}</p>}
        </div>
        {props.actions && <div class="card-actions">{props.actions}</div>}
      </div>
      <div class="card-body">{props.children}</div>
    </div>
  );
});

// Usage
<Card
  icon={{ name: "chart-bar", preset: "duotone", animation: "pulse" }}
  title="Analytics"
  subtitle="View your statistics"
  actions={<Button icon="more-vertical" variant="ghost" />}
>
  <ChartComponent />
</Card>
```

---

## Modal & Dialog

### Modal with Icon

```tsx
interface ModalProps {
  open: boolean;
  icon?: IconProp;
  title: string;
  children: any;
  onClose: () => void;
}

export const Modal = defineComponent<ModalProps>((props) => {
  return () => {
    if (!props.open) return null;

    return (
      <div data-modal>
        <div class="modal-overlay" onClick={props.onClose} />
        <div class="modal-content">
          <div class="modal-header">
            {props.icon && (
              <Icon
                {...(typeof props.icon === 'string'
                  ? { name: props.icon, size: 'xl' }
                  : { size: 'xl', ...props.icon }
                )}
              />
            )}
            <h2>{props.title}</h2>
            <button onClick={props.onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          </div>
          <div class="modal-body">{props.children}</div>
        </div>
      </div>
    );
  };
});

// Usage
<Modal
  open={showModal}
  icon={{ name: "alert-triangle", color: "orange", animation: "pulse" }}
  title="Confirm Deletion"
  onClose={() => setShowModal(false)}
>
  <p>Are you sure you want to delete this item?</p>
  <Button variant="danger" icon="trash">Delete</Button>
</Modal>
```

---

## Toast Notifications

```tsx
interface ToastProps {
  type?: 'info' | 'success' | 'warning' | 'error';
  message: string;
  duration?: number;
  onClose: () => void;
}

export const Toast = defineComponent<ToastProps>((props) => {
  const icons: Record<string, IconProp> = {
    info: { name: 'info-circle', preset: 'stroke' },
    success: { name: 'check-circle', preset: 'stroke' },
    warning: { name: 'alert-triangle', preset: 'stroke' },
    error: { name: 'x-circle', preset: 'stroke' },
  };

  return () => {
    const type = props.type || 'info';

    return (
      <div data-toast data-toast-type={type}>
        <Icon {...icons[type]} />
        <span>{props.message}</span>
        <button onClick={props.onClose} aria-label="Close">
          <Icon name="x" size="sm" />
        </button>
      </div>
    );
  };
});
```

---

## Advanced Patterns

### Icon Button Group

```tsx
<div class="icon-button-group">
  <Button icon="bold" variant="ghost" aria-label="Bold" />
  <Button icon="italic" variant="ghost" aria-label="Italic" />
  <Button icon="underline" variant="ghost" aria-label="Underline" />
  <Button icon="strikethrough" variant="ghost" aria-label="Strikethrough" />
</div>
```

### Dynamic Icon State

```tsx
const PlayPauseButton = defineComponent(() => {
  const isPlaying = signal(false);
  const iconName = computed(() => isPlaying() ? 'pause' : 'play');

  return () => (
    <Button
      icon={{
        name: iconName,
        animation: computed(() => isPlaying() ? 'pulse' : 'none')
      }}
      onClick={() => isPlaying.set(!isPlaying())}
    >
      {() => isPlaying() ? 'Pause' : 'Play'}
    </Button>
  );
});
```

### Icon with Tooltip

```tsx
<Tooltip content="Download file">
  <Button
    icon={{ name: "download", animation: "hover" }}
    variant="ghost"
    aria-label="Download"
  />
</Tooltip>
```

### Loading Indicator

```tsx
const LoadingIndicator = defineComponent(() => {
  return () => (
    <div class="loading-indicator">
      <Icon
        name="loader"
        size="xl"
        animation="loading"
        animationDuration={1.5}
      />
      <p>Loading...</p>
    </div>
  );
});
```

---

## Best Practices Summary

1. **Use string syntax for simple cases**: `icon="user"`
2. **Use object syntax for customization**: `icon={{ name: "user", animation: "hover" }}`
3. **Always provide `aria-label` for icon-only buttons**
4. **Use `decorative` prop for decorative icons**
5. **Leverage animation types appropriately** (hover for interactivity, loading for async)
6. **Use IconProvider for global defaults** in your app
7. **Normalize icons in custom components** using utility functions
8. **Respect reduced motion preferences** (handled automatically)

These examples demonstrate the flexibility and power of the Aether Icon API across various use cases.
