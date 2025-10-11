### Dropdown Menu

A menu of actions or links triggered by a button.

#### Features

- Keyboard navigation (arrows, Home, End)
- Typeahead search
- Sub-menus (nested)
- Checkboxes and radio items
- Separators and labels
- Disabled items
- Custom trigger

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { DropdownMenu } from 'aether/primitives';

export const ActionsDropdown = defineComponent(() => {
  const handleAction = (action: string) => {
    console.log('Action:', action);
  };

  return () => (
    <DropdownMenu>
      <DropdownMenu.Trigger class="btn">
        Actions
        <ChevronDownIcon />
      </DropdownMenu.Trigger>

      <DropdownMenu.Content class="dropdown-content">
        <DropdownMenu.Item
          class="dropdown-item"
          on:select={() => handleAction('new')}
        >
          <PlusIcon />
          New File
          <DropdownMenu.Shortcut>⌘N</DropdownMenu.Shortcut>
        </DropdownMenu.Item>

        <DropdownMenu.Item
          class="dropdown-item"
          on:select={() => handleAction('open')}
        >
          <FolderIcon />
          Open...
          <DropdownMenu.Shortcut>⌘O</DropdownMenu.Shortcut>
        </DropdownMenu.Item>

        <DropdownMenu.Separator class="dropdown-separator" />

        <DropdownMenu.Item
          class="dropdown-item"
          disabled
        >
          <SaveIcon />
          Save (disabled)
        </DropdownMenu.Item>

        <DropdownMenu.Separator />

        <DropdownMenu.Item
          class="dropdown-item destructive"
          on:select={() => handleAction('delete')}
        >
          <TrashIcon />
          Delete
          <DropdownMenu.Shortcut>⌘⌫</DropdownMenu.Shortcut>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
});
```

#### Sub-menus

```html
<DropdownMenu>
  <DropdownMenu.Trigger>Menu</DropdownMenu.Trigger>

  <DropdownMenu.Content>
    <DropdownMenu.Item>New File</DropdownMenu.Item>

    <!-- Sub-menu -->
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger class="dropdown-item">
        Open Recent
        <ChevronRightIcon class="ml-auto" />
      </DropdownMenu.SubTrigger>

      <DropdownMenu.SubContent class="dropdown-content">
        <DropdownMenu.Item>project-1.ts</DropdownMenu.Item>
        <DropdownMenu.Item>project-2.ts</DropdownMenu.Item>
        <DropdownMenu.Item>project-3.ts</DropdownMenu.Item>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>

    <DropdownMenu.Separator />

    <DropdownMenu.Item>Settings</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu>
```

#### Checkbox Items

```typescript
import { defineComponent, signal } from 'aether';
import { DropdownMenu } from 'aether/primitives';

export const ViewDropdown = defineComponent(() => {
  const showBookmarks = signal(true);
  const showHistory = signal(false);

  return () => (
    <DropdownMenu>
      <DropdownMenu.Trigger>View</DropdownMenu.Trigger>

      <DropdownMenu.Content>
        <DropdownMenu.Label class="dropdown-label">
          Panels
        </DropdownMenu.Label>

        <DropdownMenu.CheckboxItem
          class="dropdown-item"
          bind:checked={showBookmarks}
        >
          <DropdownMenu.ItemIndicator class="dropdown-indicator">
            <CheckIcon />
          </DropdownMenu.ItemIndicator>
          Show Bookmarks
        </DropdownMenu.CheckboxItem>

        <DropdownMenu.CheckboxItem
          class="dropdown-item"
          bind:checked={showHistory}
        >
          <DropdownMenu.ItemIndicator class="dropdown-indicator">
            <CheckIcon />
          </DropdownMenu.ItemIndicator>
          Show History
        </DropdownMenu.CheckboxItem>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
});
```

#### Radio Items

```typescript
import { defineComponent, signal } from 'aether';
import { DropdownMenu } from 'aether/primitives';

export const ThemeDropdown = defineComponent(() => {
  const theme = signal<'light' | 'dark' | 'system'>('system');

  return () => (
    <DropdownMenu>
      <DropdownMenu.Trigger>Theme</DropdownMenu.Trigger>

      <DropdownMenu.Content>
        <DropdownMenu.Label>Appearance</DropdownMenu.Label>

        <DropdownMenu.RadioGroup bind:value={theme}>
          <DropdownMenu.RadioItem value="light" class="dropdown-item">
            <DropdownMenu.ItemIndicator class="dropdown-indicator">
              <DotIcon />
            </DropdownMenu.ItemIndicator>
            Light
          </DropdownMenu.RadioItem>

          <DropdownMenu.RadioItem value="dark" class="dropdown-item">
            <DropdownMenu.ItemIndicator class="dropdown-indicator">
              <DotIcon />
            </DropdownMenu.ItemIndicator>
            Dark
          </DropdownMenu.RadioItem>

          <DropdownMenu.RadioItem value="system" class="dropdown-item">
            <DropdownMenu.ItemIndicator class="dropdown-indicator">
              <DotIcon />
            </DropdownMenu.ItemIndicator>
            System
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
});
```

#### Styling Example

```css
.dropdown-content {
  min-width: 220px;
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-1);

  z-index: var(--z-dropdown);

  animation: slideDown 150ms ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);

  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-sm);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  user-select: none;
  outline: none;

  transition: background-color var(--transition-fast);
}

.dropdown-item:hover,
.dropdown-item:focus {
  background: var(--color-background-secondary);
}

.dropdown-item[data-disabled] {
  color: var(--color-text-disabled);
  pointer-events: none;
}

.dropdown-item.destructive {
  color: var(--color-error);
}

.dropdown-separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--spacing-1) 0;
}

.dropdown-label {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.dropdown-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
```

#### API Reference

**`<DropdownMenu>`** - Root component

**`<DropdownMenu.Trigger>`** - Opens the menu

**`<DropdownMenu.Content>`** - Menu content

Props: Same as Popover.Content (positioning, collision detection, etc.)

**`<DropdownMenu.Item>`** - Menu item

Props:
- `disabled?: boolean` - Disable the item
- `onSelect?: (event: Event) => void` - Called when item is selected
- `textValue?: string` - For typeahead search

**`<DropdownMenu.CheckboxItem>`** - Checkbox menu item

Props:
- `checked?: Signal<boolean>` - Controlled checked state
- `onCheckedChange?: (checked: boolean) => void`
- `disabled?: boolean`

**`<DropdownMenu.RadioGroup>`** - Radio group container

Props:
- `value?: Signal<string>` - Controlled selected value
- `onValueChange?: (value: string) => void`

**`<DropdownMenu.RadioItem>`** - Radio menu item

Props:
- `value: string` - Item value
- `disabled?: boolean`

**`<DropdownMenu.Sub>`** - Sub-menu container

**`<DropdownMenu.SubTrigger>`** - Opens sub-menu

**`<DropdownMenu.SubContent>`** - Sub-menu content

**`<DropdownMenu.Separator>`** - Visual separator

**`<DropdownMenu.Label>`** - Non-interactive label

**`<DropdownMenu.ItemIndicator>`** - Shows only when checkbox/radio is checked

**`<DropdownMenu.Shortcut>`** - Keyboard shortcut hint (non-functional)

#### Advanced: Context Menu

```typescript
import { defineComponent } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const BasicContextMenu = defineComponent(() => {
  return () => (
    <ContextMenu>
      <ContextMenu.Trigger class="context-area">
        Right click here
      </ContextMenu.Trigger>

      <ContextMenu.Content class="dropdown-content">
        <ContextMenu.Item>Cut</ContextMenu.Item>
        <ContextMenu.Item>Copy</ContextMenu.Item>
        <ContextMenu.Item>Paste</ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
});
```

Context Menu uses the same API as Dropdown Menu but triggers on right-click.

---

