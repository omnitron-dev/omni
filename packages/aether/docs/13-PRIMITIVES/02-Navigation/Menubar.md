### Menubar

A horizontal menu bar component with dropdown menus, similar to desktop application menus (File, Edit, View, etc.). Provides keyboard navigation, nested menu support, and flexible content rendering.

#### Features

- Desktop application style menubar
- Multiple independent menus
- Click to open/close
- Keyboard navigation
- Sub-menu support
- Menu items with actions
- Separators and labels
- Keyboard shortcuts display
- Click outside to close
- Escape key to close
- ARIA menubar pattern
- Portal-based rendering
- Configurable positioning

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Menubar } from 'aether/primitives';

const Example = defineComponent(() => {
  const handleNew = () => console.log('New file');
  const handleOpen = () => console.log('Open file');
  const handleSave = () => console.log('Save file');

  return () => (
    <Menubar>
      <Menubar.Menu>
        <Menubar.Trigger>File</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item onSelect={handleNew}>New</Menubar.Item>
          <Menubar.Item onSelect={handleOpen}>Open</Menubar.Item>
          <Menubar.Item onSelect={handleSave}>Save</Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onSelect={() => window.close()}>Exit</Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger>Edit</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item onSelect={() => document.execCommand('undo')}>
            Undo
          </Menubar.Item>
          <Menubar.Item onSelect={() => document.execCommand('redo')}>
            Redo
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onSelect={() => document.execCommand('cut')}>
            Cut
          </Menubar.Item>
          <Menubar.Item onSelect={() => document.execCommand('copy')}>
            Copy
          </Menubar.Item>
          <Menubar.Item onSelect={() => document.execCommand('paste')}>
            Paste
          </Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger>View</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item>Zoom In</Menubar.Item>
          <Menubar.Item>Zoom Out</Menubar.Item>
          <Menubar.Item>Reset Zoom</Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>
    </Menubar>
  );
});
```

#### With Keyboard Shortcuts

```typescript
const Example = defineComponent(() => {
  return () => (
    <Menubar>
      <Menubar.Menu>
        <Menubar.Trigger>File</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item onSelect={() => {}}>
            New File
            <Menubar.Shortcut>⌘N</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onSelect={() => {}}>
            Open File
            <Menubar.Shortcut>⌘O</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onSelect={() => {}}>
            Save
            <Menubar.Shortcut>⌘S</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onSelect={() => {}}>
            Save As
            <Menubar.Shortcut>⌘⇧S</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onSelect={() => {}}>
            Close Window
            <Menubar.Shortcut>⌘W</Menubar.Shortcut>
          </Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger>Edit</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item onSelect={() => {}}>
            Undo
            <Menubar.Shortcut>⌘Z</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onSelect={() => {}}>
            Redo
            <Menubar.Shortcut>⌘⇧Z</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item onSelect={() => {}}>
            Cut
            <Menubar.Shortcut>⌘X</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onSelect={() => {}}>
            Copy
            <Menubar.Shortcut>⌘C</Menubar.Shortcut>
          </Menubar.Item>
          <Menubar.Item onSelect={() => {}}>
            Paste
            <Menubar.Shortcut>⌘V</Menubar.Shortcut>
          </Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>
    </Menubar>
  );
});
```

#### With Disabled Items

```typescript
const Example = defineComponent(() => {
  const hasSelection = signal(false);

  return () => (
    <Menubar>
      <Menubar.Menu>
        <Menubar.Trigger>Edit</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Item onSelect={() => {}}>Undo</Menubar.Item>
          <Menubar.Item onSelect={() => {}}>Redo</Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item
            disabled={!hasSelection()}
            onSelect={() => {}}
          >
            Cut
          </Menubar.Item>
          <Menubar.Item
            disabled={!hasSelection()}
            onSelect={() => {}}
          >
            Copy
          </Menubar.Item>
          <Menubar.Item onSelect={() => {}}>Paste</Menubar.Item>
          <Menubar.Separator />
          <Menubar.Item
            disabled={!hasSelection()}
            onSelect={() => {}}
          >
            Delete
          </Menubar.Item>
          <Menubar.Item onSelect={() => {}}>Select All</Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>
    </Menubar>
  );
});
```

#### Desktop Application Style

```typescript
const Example = defineComponent(() => {
  return () => (
    <div class="app-window">
      <Menubar class="app-menubar">
        <Menubar.Menu>
          <Menubar.Trigger>File</Menubar.Trigger>
          <Menubar.Content>
            <Menubar.Item onSelect={() => {}}>New Window</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>New Tab</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>Open File...</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Open Folder...</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>Save</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Save As...</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Save All</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>Close Editor</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Close Window</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>Exit</Menubar.Item>
          </Menubar.Content>
        </Menubar.Menu>

        <Menubar.Menu>
          <Menubar.Trigger>Edit</Menubar.Trigger>
          <Menubar.Content>
            <Menubar.Item onSelect={() => {}}>Undo</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Redo</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>Cut</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Copy</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Paste</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>Find</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Replace</Menubar.Item>
          </Menubar.Content>
        </Menubar.Menu>

        <Menubar.Menu>
          <Menubar.Trigger>Selection</Menubar.Trigger>
          <Menubar.Content>
            <Menubar.Item onSelect={() => {}}>Select All</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Expand Selection</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Shrink Selection</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>Copy Line Up</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Copy Line Down</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Move Line Up</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Move Line Down</Menubar.Item>
          </Menubar.Content>
        </Menubar.Menu>

        <Menubar.Menu>
          <Menubar.Trigger>View</Menubar.Trigger>
          <Menubar.Content>
            <Menubar.Item onSelect={() => {}}>Command Palette</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Open View...</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Label>Appearance</Menubar.Label>
            <Menubar.Item onSelect={() => {}}>Full Screen</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Zen Mode</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>Show Panel</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Show Sidebar</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Show Minimap</Menubar.Item>
          </Menubar.Content>
        </Menubar.Menu>

        <Menubar.Menu>
          <Menubar.Trigger>Help</Menubar.Trigger>
          <Menubar.Content>
            <Menubar.Item onSelect={() => {}}>Welcome</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Documentation</Menubar.Item>
            <Menubar.Item onSelect={() => {}}>Keyboard Shortcuts</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>Check for Updates</Menubar.Item>
            <Menubar.Separator />
            <Menubar.Item onSelect={() => {}}>About</Menubar.Item>
          </Menubar.Content>
        </Menubar.Menu>
      </Menubar>

      <div class="app-content">
        {/* Application content */}
      </div>
    </div>
  );
});
```

#### With Labels and Groups

```typescript
const Example = defineComponent(() => {
  return () => (
    <Menubar>
      <Menubar.Menu>
        <Menubar.Trigger>Preferences</Menubar.Trigger>
        <Menubar.Content>
          <Menubar.Label>Editor Settings</Menubar.Label>
          <Menubar.Item onSelect={() => {}}>Font Size</Menubar.Item>
          <Menubar.Item onSelect={() => {}}>Line Height</Menubar.Item>
          <Menubar.Item onSelect={() => {}}>Tab Size</Menubar.Item>
          <Menubar.Separator />
          <Menubar.Label>Display</Menubar.Label>
          <Menubar.Item onSelect={() => {}}>Theme</Menubar.Item>
          <Menubar.Item onSelect={() => {}}>Color Scheme</Menubar.Item>
          <Menubar.Item onSelect={() => {}}>Icon Theme</Menubar.Item>
          <Menubar.Separator />
          <Menubar.Label>Advanced</Menubar.Label>
          <Menubar.Item onSelect={() => {}}>Settings JSON</Menubar.Item>
          <Menubar.Item onSelect={() => {}}>Keyboard Shortcuts</Menubar.Item>
        </Menubar.Content>
      </Menubar.Menu>
    </Menubar>
  );
});
```

#### Styling Example

```css
/* Menubar container */
[data-menubar] {
  display: flex;
  align-items: center;
  height: 40px;
  background: var(--color-background-secondary);
  border-bottom: 1px solid var(--color-border);
  padding: 0 var(--spacing-2);
  gap: var(--spacing-1);
}

/* Individual menu */
[data-menubar-menu] {
  position: relative;
}

/* Menu trigger */
[data-menubar-trigger] {
  padding: var(--spacing-1) var(--spacing-3);
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  transition: background 0.2s;
}

[data-menubar-trigger]:hover {
  background: var(--color-background-hover);
}

[data-menubar-trigger][data-state="open"] {
  background: var(--color-background-active);
}

/* Menu content */
[data-menubar-content] {
  min-width: 200px;
  padding: var(--spacing-2);
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
}

/* Menu item */
[data-menubar-item] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  transition: background 0.15s;
  outline: none;
}

[data-menubar-item]:hover:not([data-disabled]) {
  background: var(--color-background-hover);
}

[data-menubar-item]:focus-visible {
  background: var(--color-background-hover);
  outline: 2px solid var(--color-focus);
  outline-offset: -2px;
}

[data-menubar-item][data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

/* Separator */
[data-menubar-separator] {
  height: 1px;
  margin: var(--spacing-2) 0;
  background: var(--color-border);
}

/* Label */
[data-menubar-label] {
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Shortcut */
[data-menubar-shortcut] {
  margin-left: auto;
  padding-left: var(--spacing-4);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
}
```

#### API Reference

**`<Menubar>`** - Root menubar container

Props:
- Standard HTML `<div>` attributes

Context Provided:
- Global open menu state
- Single menu open at a time

**`<Menubar.Menu>`** - Individual menu within the menubar

Props:
- Standard HTML `<div>` attributes

Context Provided:
- Menu open/close state
- Menu ID and trigger ID
- Toggle functionality

**`<Menubar.Trigger>`** - Button that opens a menu

Props:
- `children?: any` - Trigger content
- Standard HTML `<button>` attributes

Accessibility:
- Has `aria-haspopup="menu"`
- Has `aria-expanded` reflecting open state
- Has `aria-controls` pointing to content

**`<Menubar.Content>`** - Dropdown content panel

Props:
- `side?: 'top' | 'right' | 'bottom' | 'left'` - Position side (default: 'bottom')
- `align?: 'start' | 'center' | 'end'` - Alignment (default: 'start')
- `sideOffset?: number` - Offset from trigger (default: 4)
- `alignOffset?: number` - Alignment offset (default: 0)
- Standard HTML `<div>` attributes

Behavior:
- Rendered in a Portal
- Positioned relative to trigger
- Only rendered when menu is open
- Closes on click outside
- Closes on Escape key

**`<Menubar.Item>`** - Individual menu item

Props:
- `disabled?: boolean` - Disables the item
- `onSelect?: () => void` - Selection handler
- `children?: any` - Item content
- Standard HTML `<div>` attributes

Behavior:
- Calls `onSelect` on click or Enter/Space
- Closes menu after selection
- Keyboard navigable

**`<Menubar.Separator>`** - Visual separator

Props:
- Standard HTML `<div>` attributes

Accessibility:
- Has `role="separator"`
- Has `aria-orientation="horizontal"`

**`<Menubar.Label>`** - Non-interactive label for grouping

Props:
- `children?: any` - Label content
- Standard HTML `<div>` attributes

**`<Menubar.Shortcut>`** - Keyboard shortcut display

Props:
- `children?: any` - Shortcut text (e.g., "⌘K")
- Standard HTML `<span>` attributes

Accessibility:
- Has `aria-hidden="true"` (visual only)

#### Keyboard Navigation

- **Tab**: Focus next/previous trigger
- **Enter/Space**: Open menu when trigger focused
- **Arrow Down**: Open menu and focus first item
- **Arrow Up/Down**: Navigate between items (when open)
- **Escape**: Close menu and return focus to trigger
- **Enter/Space**: Activate focused item

#### Accessibility

The Menubar component follows the ARIA menubar pattern:

- Root has `role="menubar"`
- Triggers have `aria-haspopup="menu"` and `aria-expanded`
- Content has `role="menu"` and `aria-labelledby`
- Items have `role="menuitem"` and appropriate `tabIndex`
- Disabled items have `aria-disabled="true"`
- Separators have `role="separator"`
- Full keyboard navigation support
- Proper focus management

#### Best Practices

1. **Use for application menus**: Best suited for desktop-style application interfaces
2. **Keep labels short**: Trigger text should be concise (File, Edit, View)
3. **Group related items**: Use separators and labels to organize menu items
4. **Show shortcuts**: Display keyboard shortcuts for discoverability
5. **Indicate state**: Disable items that aren't currently available
6. **Close on action**: Menus automatically close when an item is selected
7. **Single open menu**: Only one menu should be open at a time
8. **Consistent ordering**: Follow platform conventions (File usually first, Help usually last)
9. **Don't nest too deep**: Avoid sub-menus within menubar menus if possible
10. **Consider mobile**: Menubar pattern is desktop-focused; provide alternative navigation for mobile

---

