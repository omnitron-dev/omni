### Tabs

A set of layered sections of content (tab panels) displayed one at a time.

#### Features

- Keyboard navigation (Arrow keys, Home, End)
- Automatic/manual activation
- Horizontal/vertical orientation
- Disabled tabs
- Dynamic tabs
- URL-synchronized tabs

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Tabs } from 'aether/primitives';

export const SettingsTabs = defineComponent(() => {
  const activeTab = signal('account');

  return () => (
    <Tabs bind:value={activeTab} class="tabs-root">
      <Tabs.List class="tabs-list">
        <Tabs.Trigger value="account" class="tabs-trigger">
          Account
        </Tabs.Trigger>
        <Tabs.Trigger value="password" class="tabs-trigger">
          Password
        </Tabs.Trigger>
        <Tabs.Trigger value="notifications" class="tabs-trigger">
          Notifications
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="account" class="tabs-content">
        <h3>Account Settings</h3>
        <form>
          <label>
            Name
            <input type="text" value="John Doe" />
          </label>
          <label>
            Email
            <input type="email" value="john@example.com" />
          </label>
        </form>
      </Tabs.Content>

      <Tabs.Content value="password" class="tabs-content">
        <h3>Change Password</h3>
        <form>
          <label>
            Current Password
            <input type="password" />
          </label>
          <label>
            New Password
            <input type="password" />
          </label>
        </form>
      </Tabs.Content>

      <Tabs.Content value="notifications" class="tabs-content">
        <h3>Notification Settings</h3>
        <label>
          <input type="checkbox" />
          Email notifications
        </label>
        <label>
          <input type="checkbox" />
          Push notifications
        </label>
      </Tabs.Content>
    </Tabs>
  );
});
```

#### Vertical Tabs

```html
<Tabs
  bind:value={activeTab}
  orientation="vertical"
  class="tabs-root tabs-vertical"
>
  <Tabs.List class="tabs-list-vertical">
    <Tabs.Trigger value="general">General</Tabs.Trigger>
    <Tabs.Trigger value="security">Security</Tabs.Trigger>
    <Tabs.Trigger value="billing">Billing</Tabs.Trigger>
  </Tabs.List>

  <Tabs.Content value="general">General settings</Tabs.Content>
  <Tabs.Content value="security">Security settings</Tabs.Content>
  <Tabs.Content value="billing">Billing settings</Tabs.Content>
</Tabs>
```

#### Styling Example

```css
.tabs-root {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.tabs-list {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  gap: var(--spacing-1);
}

.tabs-trigger {
  padding: var(--spacing-3) var(--spacing-4);

  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;

  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);

  cursor: pointer;
  outline: none;

  transition: all var(--transition-fast);
}

.tabs-trigger:hover {
  color: var(--color-text-primary);
  background: var(--color-background-secondary);
}

.tabs-trigger[data-state="active"] {
  color: var(--color-primary-500);
  border-bottom-color: var(--color-primary-500);
}

.tabs-trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.tabs-trigger[data-disabled] {
  color: var(--color-text-disabled);
  pointer-events: none;
}

.tabs-content {
  padding: var(--spacing-4);

  animation: fadeIn 200ms;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Vertical variant */
.tabs-vertical {
  flex-direction: row;
}

.tabs-list-vertical {
  flex-direction: column;
  border-bottom: none;
  border-right: 1px solid var(--color-border);
}

.tabs-list-vertical .tabs-trigger {
  border-bottom: none;
  border-right: 2px solid transparent;
  justify-content: flex-start;
}

.tabs-list-vertical .tabs-trigger[data-state="active"] {
  border-right-color: var(--color-primary-500);
}
```

#### API Reference

**`<Tabs>`** - Root component

Props:
- `value?: Signal<string>` - Controlled active tab
- `defaultValue?: string` - Initial active tab
- `onValueChange?: (value: string) => void`
- `orientation?: 'horizontal' | 'vertical'` - Layout orientation (default: 'horizontal')
- `activationMode?: 'automatic' | 'manual'` - Automatic activates on focus, manual requires Enter/Space (default: 'automatic')

**`<Tabs.List>`** - Container for triggers

**`<Tabs.Trigger>`** - Tab button

Props:
- `value: string` - Tab identifier
- `disabled?: boolean`

**`<Tabs.Content>`** - Tab panel

Props:
- `value: string` - Tab identifier
- `forceMount?: boolean` - Keep mounted when inactive (for animations)

#### Advanced: URL-Synchronized Tabs

```typescript
import { defineComponent, signal, effect } from 'aether';
import { Tabs } from 'aether/primitives';
import { useRouter } from 'aether/router';

export const URLSyncedTabs = defineComponent(() => {
  const router = useRouter();

  // Sync with URL query parameter
  const activeTab = signal(router.query.get('tab') || 'account');

  // Update URL when tab changes
  effect(() => {
    router.push({ query: { tab: activeTab() } });
  });

  return () => (
    <Tabs bind:value={activeTab}>
      {/* ... */}
    </Tabs>
  );
});
```

---

