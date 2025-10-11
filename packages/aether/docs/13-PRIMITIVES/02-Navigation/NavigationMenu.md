### NavigationMenu

A complex navigation menu component with support for nested sub-menus, keyboard navigation, and flexible positioning.

#### Features

- Horizontal and vertical orientation
- Nested sub-menu support
- Keyboard navigation (arrows, Enter, Escape)
- Controlled and uncontrolled modes
- Active item tracking
- ARIA navigation pattern
- Collision detection for positioning
- Viewport-aware rendering

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { NavigationMenu } from 'aether/primitives';

const Example = defineComponent(() => {
  const activeItem = signal('home');

  return () => (
    <NavigationMenu value={activeItem()} onValueChange={activeItem}>
      <NavigationMenu.List class="nav-list">
        <NavigationMenu.Item value="home">
          <NavigationMenu.Link href="/" class="nav-link">
            Home
          </NavigationMenu.Link>
        </NavigationMenu.Item>

        <NavigationMenu.Item value="products">
          <NavigationMenu.Trigger class="nav-trigger">
            Products
          </NavigationMenu.Trigger>
          <NavigationMenu.Content class="nav-content">
            <NavigationMenu.Link href="/products/software" class="nav-link">
              Software
            </NavigationMenu.Link>
            <NavigationMenu.Link href="/products/hardware" class="nav-link">
              Hardware
            </NavigationMenu.Link>
          </NavigationMenu.Content>
        </NavigationMenu.Item>

        <NavigationMenu.Item value="about">
          <NavigationMenu.Link href="/about" class="nav-link">
            About
          </NavigationMenu.Link>
        </NavigationMenu.Item>
      </NavigationMenu.List>

      <NavigationMenu.Viewport class="nav-viewport" />
      <NavigationMenu.Indicator class="nav-indicator" />
    </NavigationMenu>
  );
});
```

#### With Nested Menus

```typescript
const Example = defineComponent(() => {
  return () => (
    <NavigationMenu orientation="vertical">
      <NavigationMenu.List>
        <NavigationMenu.Item value="dashboard">
          <NavigationMenu.Trigger>Dashboard</NavigationMenu.Trigger>
          <NavigationMenu.Content>
            <NavigationMenu.Link href="/dashboard/analytics">
              Analytics
            </NavigationMenu.Link>
            <NavigationMenu.Link href="/dashboard/reports">
              Reports
            </NavigationMenu.Link>
          </NavigationMenu.Content>
        </NavigationMenu.Item>

        <NavigationMenu.Item value="settings">
          <NavigationMenu.Trigger>Settings</NavigationMenu.Trigger>
          <NavigationMenu.Content>
            <NavigationMenu.Link href="/settings/profile">
              Profile
            </NavigationMenu.Link>
            <NavigationMenu.Link href="/settings/security">
              Security
            </NavigationMenu.Link>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
      </NavigationMenu.List>
    </NavigationMenu>
  );
});
```

#### API

**`<NavigationMenu>`** - Root component
- `value?: string` - Controlled active value
- `onValueChange?: (value: string) => void` - Value change callback
- `defaultValue?: string` - Default active value (uncontrolled)
- `orientation?: 'horizontal' | 'vertical'` - Orientation (default: 'horizontal')

**`<NavigationMenu.List>`** - List container for navigation items

**`<NavigationMenu.Item>`** - Individual navigation item
- `value: string` - Unique identifier for the item

**`<NavigationMenu.Trigger>`** - Trigger button for sub-menu content

**`<NavigationMenu.Content>`** - Content panel for sub-menu items

**`<NavigationMenu.Link>`** - Navigation link
- `href?: string` - Link destination
- `active?: boolean` - Active state

**`<NavigationMenu.Indicator>`** - Active item indicator (animated)

**`<NavigationMenu.Viewport>`** - Viewport for rendering sub-menu content

---

