### Context Menu

A menu triggered by right-clicking (or long-pressing on touch devices) on an element. Context menus provide contextual actions specific to the clicked element.

#### Features

- Right-click (contextmenu event) trigger
- Touch device support (long press)
- Smart positioning at click location
- Auto-adjustment for screen boundaries
- Click outside to close
- Escape key to close
- Keyboard navigation
- Disabled items
- Separators and labels
- Portal-based rendering
- ARIA menu pattern

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const BasicContextMenu = defineComponent(() => {
  const handleCut = () => console.log('Cut');
  const handleCopy = () => console.log('Copy');
  const handlePaste = () => console.log('Paste');

  return () => (
    <ContextMenu>
      <ContextMenu.Trigger class="context-area">
        <p>Right click anywhere in this area</p>
      </ContextMenu.Trigger>

      <ContextMenu.Content class="context-menu-content">
        <ContextMenu.Item class="context-menu-item" onSelect={handleCut}>
          Cut
        </ContextMenu.Item>
        <ContextMenu.Item class="context-menu-item" onSelect={handleCopy}>
          Copy
        </ContextMenu.Item>
        <ContextMenu.Item class="context-menu-item" onSelect={handlePaste}>
          Paste
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
});
```

#### With Icons and Shortcuts

```typescript
import { defineComponent } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const FileContextMenu = defineComponent(() => {
  return () => (
    <ContextMenu>
      <ContextMenu.Trigger class="file-item">
        <div class="file-icon">📄</div>
        <span>document.txt</span>
      </ContextMenu.Trigger>

      <ContextMenu.Content class="context-menu-content">
        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <OpenIcon class="menu-icon" />
          <span>Open</span>
          <span class="menu-shortcut">⏎</span>
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <EditIcon class="menu-icon" />
          <span>Edit</span>
          <span class="menu-shortcut">⌘E</span>
        </ContextMenu.Item>

        <ContextMenu.Separator class="context-menu-separator" />

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <CopyIcon class="menu-icon" />
          <span>Copy</span>
          <span class="menu-shortcut">⌘C</span>
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <DuplicateIcon class="menu-icon" />
          <span>Duplicate</span>
          <span class="menu-shortcut">⌘D</span>
        </ContextMenu.Item>

        <ContextMenu.Separator class="context-menu-separator" />

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <RenameIcon class="menu-icon" />
          <span>Rename</span>
          <span class="menu-shortcut">F2</span>
        </ContextMenu.Item>

        <ContextMenu.Separator class="context-menu-separator" />

        <ContextMenu.Item class="context-menu-item destructive" onSelect={() => {}}>
          <DeleteIcon class="menu-icon" />
          <span>Delete</span>
          <span class="menu-shortcut">⌘⌫</span>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
});
```

#### With Disabled Items

```typescript
import { defineComponent, signal } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const TextContextMenu = defineComponent(() => {
  const hasSelection = signal(false);
  const canPaste = signal(true);

  return () => (
    <ContextMenu>
      <ContextMenu.Trigger class="text-editor">
        <textarea
          onSelect={() => {
            const selection = window.getSelection();
            hasSelection.set(selection?.toString().length > 0);
          }}
        >
          Select some text and right click
        </textarea>
      </ContextMenu.Trigger>

      <ContextMenu.Content class="context-menu-content">
        <ContextMenu.Item
          class="context-menu-item"
          disabled={!hasSelection()}
          onSelect={() => document.execCommand('cut')}
        >
          Cut
        </ContextMenu.Item>

        <ContextMenu.Item
          class="context-menu-item"
          disabled={!hasSelection()}
          onSelect={() => document.execCommand('copy')}
        >
          Copy
        </ContextMenu.Item>

        <ContextMenu.Item
          class="context-menu-item"
          disabled={!canPaste()}
          onSelect={() => document.execCommand('paste')}
        >
          Paste
        </ContextMenu.Item>

        <ContextMenu.Separator class="context-menu-separator" />

        <ContextMenu.Item
          class="context-menu-item"
          onSelect={() => document.execCommand('selectAll')}
        >
          Select All
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
});
```

#### With Labels and Groups

```typescript
import { defineComponent } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const ImageContextMenu = defineComponent(() => {
  return () => (
    <ContextMenu>
      <ContextMenu.Trigger class="image-container">
        <img src="/photo.jpg" alt="Photo" />
      </ContextMenu.Trigger>

      <ContextMenu.Content class="context-menu-content">
        <ContextMenu.Label class="context-menu-label">
          Image Actions
        </ContextMenu.Label>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          Open Image
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          Open Image in New Tab
        </ContextMenu.Item>

        <ContextMenu.Separator class="context-menu-separator" />

        <ContextMenu.Label class="context-menu-label">
          Save Options
        </ContextMenu.Label>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          Save Image As...
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          Copy Image
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          Copy Image Address
        </ContextMenu.Item>

        <ContextMenu.Separator class="context-menu-separator" />

        <ContextMenu.Label class="context-menu-label">
          Tools
        </ContextMenu.Label>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          Inspect Element
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
});
```

#### File Browser Context Menu

```typescript
import { defineComponent } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const FileTreeContextMenu = defineComponent(() => {
  const handleNewFile = () => console.log('New file');
  const handleNewFolder = () => console.log('New folder');
  const handleRename = () => console.log('Rename');
  const handleDelete = () => console.log('Delete');

  return () => (
    <div class="file-tree">
      <ContextMenu>
        <ContextMenu.Trigger class="folder-node">
          <FolderIcon />
          <span>src</span>
        </ContextMenu.Trigger>

        <ContextMenu.Content class="context-menu-content">
          <ContextMenu.Item class="context-menu-item" onSelect={handleNewFile}>
            <FileIcon class="menu-icon" />
            New File
          </ContextMenu.Item>

          <ContextMenu.Item class="context-menu-item" onSelect={handleNewFolder}>
            <FolderIcon class="menu-icon" />
            New Folder
          </ContextMenu.Item>

          <ContextMenu.Separator class="context-menu-separator" />

          <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
            <RevealIcon class="menu-icon" />
            Reveal in Finder
          </ContextMenu.Item>

          <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
            <TerminalIcon class="menu-icon" />
            Open in Terminal
          </ContextMenu.Item>

          <ContextMenu.Separator class="context-menu-separator" />

          <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
            <CopyIcon class="menu-icon" />
            Copy Path
          </ContextMenu.Item>

          <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
            <CopyIcon class="menu-icon" />
            Copy Relative Path
          </ContextMenu.Item>

          <ContextMenu.Separator class="context-menu-separator" />

          <ContextMenu.Item class="context-menu-item" onSelect={handleRename}>
            <RenameIcon class="menu-icon" />
            Rename
          </ContextMenu.Item>

          <ContextMenu.Item class="context-menu-item destructive" onSelect={handleDelete}>
            <DeleteIcon class="menu-icon" />
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu>
    </div>
  );
});
```

#### Table Row Context Menu

```typescript
import { defineComponent } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const DataTableContextMenu = defineComponent(() => {
  return () => (
    <table class="data-table">
      <tbody>
        <ContextMenu>
          <ContextMenu.Trigger as="tr" class="table-row">
            <td>John Doe</td>
            <td>john@example.com</td>
            <td>Active</td>
          </ContextMenu.Trigger>

          <ContextMenu.Content class="context-menu-content">
            <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
              <ViewIcon class="menu-icon" />
              View Details
            </ContextMenu.Item>

            <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
              <EditIcon class="menu-icon" />
              Edit User
            </ContextMenu.Item>

            <ContextMenu.Separator class="context-menu-separator" />

            <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
              <EmailIcon class="menu-icon" />
              Send Email
            </ContextMenu.Item>

            <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
              <ResetIcon class="menu-icon" />
              Reset Password
            </ContextMenu.Item>

            <ContextMenu.Separator class="context-menu-separator" />

            <ContextMenu.Label class="context-menu-label">
              Danger Zone
            </ContextMenu.Label>

            <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
              <BanIcon class="menu-icon" />
              Suspend Account
            </ContextMenu.Item>

            <ContextMenu.Item class="context-menu-item destructive" onSelect={() => {}}>
              <DeleteIcon class="menu-icon" />
              Delete User
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu>
      </tbody>
    </table>
  );
});
```

#### Canvas/Drawing Context Menu

```typescript
import { defineComponent } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const CanvasContextMenu = defineComponent(() => {
  return () => (
    <ContextMenu>
      <ContextMenu.Trigger class="canvas-container">
        <canvas width={800} height={600}>
          Right click to show context menu
        </canvas>
      </ContextMenu.Trigger>

      <ContextMenu.Content class="context-menu-content">
        <ContextMenu.Label class="context-menu-label">
          Edit
        </ContextMenu.Label>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <UndoIcon class="menu-icon" />
          Undo
          <span class="menu-shortcut">⌘Z</span>
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <RedoIcon class="menu-icon" />
          Redo
          <span class="menu-shortcut">⌘⇧Z</span>
        </ContextMenu.Item>

        <ContextMenu.Separator class="context-menu-separator" />

        <ContextMenu.Label class="context-menu-label">
          Tools
        </ContextMenu.Label>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <BrushIcon class="menu-icon" />
          Brush Tool
          <span class="menu-shortcut">B</span>
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <EraserIcon class="menu-icon" />
          Eraser
          <span class="menu-shortcut">E</span>
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <SelectIcon class="menu-icon" />
          Select
          <span class="menu-shortcut">V</span>
        </ContextMenu.Item>

        <ContextMenu.Separator class="context-menu-separator" />

        <ContextMenu.Label class="context-menu-label">
          View
        </ContextMenu.Label>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <ZoomInIcon class="menu-icon" />
          Zoom In
          <span class="menu-shortcut">⌘+</span>
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <ZoomOutIcon class="menu-icon" />
          Zoom Out
          <span class="menu-shortcut">⌘-</span>
        </ContextMenu.Item>

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <ResetIcon class="menu-icon" />
          Reset Zoom
          <span class="menu-shortcut">⌘0</span>
        </ContextMenu.Item>

        <ContextMenu.Separator class="context-menu-separator" />

        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          <ClearIcon class="menu-icon" />
          Clear Canvas
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
});
```

#### With Open State Control

```typescript
import { defineComponent, signal } from 'aether';
import { ContextMenu } from 'aether/primitives';

export const ControlledContextMenu = defineComponent(() => {
  const handleOpenChange = (open: boolean) => {
    console.log('Context menu', open ? 'opened' : 'closed');
  };

  return () => (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenu.Trigger class="controlled-area">
        <p>Right click here</p>
      </ContextMenu.Trigger>

      <ContextMenu.Content class="context-menu-content">
        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          Action 1
        </ContextMenu.Item>
        <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
          Action 2
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
});
```

#### Styling Example

```css
/* Context menu content */
.context-menu-content {
  min-width: 220px;
  max-width: 320px;
  padding: var(--spacing-1);

  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);

  z-index: var(--z-context-menu);

  animation: contextMenuSlide 150ms ease-out;
}

@keyframes contextMenuSlide {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Context menu item */
.context-menu-item {
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

.context-menu-item:hover:not([data-disabled]),
.context-menu-item:focus {
  background: var(--color-background-secondary);
}

.context-menu-item[data-disabled] {
  color: var(--color-text-disabled);
  cursor: not-allowed;
  pointer-events: none;
  opacity: 0.5;
}

.context-menu-item.destructive {
  color: var(--color-error);
}

.context-menu-item.destructive:hover:not([data-disabled]) {
  background: var(--color-error-background);
}

/* Menu icon */
.menu-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* Menu shortcut */
.menu-shortcut {
  margin-left: auto;
  padding-left: var(--spacing-4);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
}

/* Separator */
.context-menu-separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--spacing-1) 0;
}

/* Label */
.context-menu-label {
  padding: var(--spacing-2) var(--spacing-3) var(--spacing-1);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Trigger area */
.context-area {
  padding: var(--spacing-4);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  cursor: context-menu;
}

.context-area:hover {
  border-color: var(--color-border-hover);
  background: var(--color-background-secondary);
}
```

#### API Reference

**`<ContextMenu>`** - Root component

Props:
- `onOpenChange?: (open: boolean) => void` - Called when menu opens/closes
- `children?: any` - Child components

Context Provided:
- Menu open/close state
- Click position tracking
- Menu ID for accessibility

**`<ContextMenu.Trigger>`** - Element that shows menu on right-click

Props:
- `children?: any` - Trigger content
- `disabled?: boolean` - Disable context menu
- Standard HTML `<div>` attributes

Behavior:
- Listens for `contextmenu` event (right-click)
- Prevents default browser context menu
- Opens menu at click coordinates
- Works with touch long-press on mobile

**`<ContextMenu.Content>`** - Menu content panel

Props:
- `children?: any` - Menu items and content
- `loop?: boolean` - Enable keyboard navigation looping
- `onEscapeKeyDown?: (event: KeyboardEvent) => void` - Escape key handler
- Standard HTML `<div>` attributes

Behavior:
- Rendered in a Portal
- Positioned at right-click location
- Auto-adjusts if near screen edges
- Closes on click outside
- Closes on Escape key
- Focuses first item on open

Accessibility:
- Has `role="menu"`
- Has `tabIndex={-1}` for focus management
- Has `data-state="open"` when visible

**`<ContextMenu.Item>`** - Individual menu item

Props:
- `children?: any` - Item content
- `disabled?: boolean` - Disable the item
- `onSelect?: (event: Event) => void` - Called when item is selected
- Standard HTML `<div>` attributes

Behavior:
- Calls `onSelect` on click or Enter/Space key
- Closes menu after selection
- Keyboard navigable

Accessibility:
- Has `role="menuitem"`
- Has `tabIndex={0}` (or `-1` if disabled)
- Has `data-disabled` attribute when disabled

**`<ContextMenu.Separator>`** - Visual separator

Props:
- Standard HTML `<div>` attributes

Accessibility:
- Has `role="separator"`
- Has `aria-orientation="horizontal"`

**`<ContextMenu.Label>`** - Non-interactive label for grouping

Props:
- `children?: any` - Label content
- Standard HTML `<div>` attributes

Behavior:
- Provides visual grouping
- Non-interactive (doesn't receive focus)

#### Keyboard Navigation

When context menu is open:

- **Arrow Up/Down**: Navigate between items
- **Home**: Focus first item
- **End**: Focus last item
- **Enter/Space**: Activate focused item
- **Escape**: Close menu
- **Tab**: Close menu and move focus

#### Accessibility

The ContextMenu component follows the WAI-ARIA Menu pattern:

- Root manages open state and position
- Content has `role="menu"` for screen readers
- Items have `role="menuitem"` and proper `tabIndex`
- Disabled items have appropriate attributes
- Separators have `role="separator"`
- Full keyboard navigation support
- Proper focus management
- Auto-focus first item on open
- Focus returns to trigger area on close

#### Best Practices

1. **Use for contextual actions**: Show actions relevant to the clicked element
2. **Keep menus focused**: Don't overload with too many items (8-12 max recommended)
3. **Group related actions**: Use separators and labels to organize items
4. **Show most common actions first**: Place frequently used actions at the top
5. **Indicate destructive actions**: Use visual styling for delete/remove actions
6. **Disable unavailable actions**: Don't hide items; disable them with explanation if needed
7. **Consider mobile**: Provide alternative access methods for touch devices
8. **Don't nest deeply**: Avoid sub-menus in context menus (current implementation doesn't support)
9. **Consistent with platform**: Follow OS conventions for context menu structure
10. **Close on action**: Menu automatically closes when an item is selected

#### Comparison with DropdownMenu

| Feature | ContextMenu | DropdownMenu |
|---------|-------------|--------------|
| **Trigger** | Right-click event | Click button |
| **Positioning** | At cursor position | Relative to trigger button |
| **Use Case** | Contextual actions | Menu of options |
| **Sub-menus** | Not supported | Full support |
| **Checkbox/Radio** | Not implemented | Full support |
| **Keyboard Shortcuts** | Visual only | Visual only |
| **Mobile Support** | Long-press | Touch tap |
| **Portal** | Yes | Yes |
| **Auto-positioning** | At click + edge detection | Full collision detection |

When to use:
- **ContextMenu**: Right-click menus, canvas tools, file managers, data tables
- **DropdownMenu**: Navigation menus, toolbars, settings, action buttons

#### Touch Device Support

On touch devices, context menus can be triggered by:
- Long press (press and hold for ~500ms)
- Custom gesture (if implemented in your app)
- Explicit "More options" button as fallback

Example with touch support indication:

```typescript
export const TouchFriendlyContextMenu = defineComponent(() => {
  return () => (
    <div class="touch-container">
      <ContextMenu>
        <ContextMenu.Trigger class="touch-area">
          <p>Tap and hold for menu</p>
          <span class="touch-hint">👆 Long press</span>
        </ContextMenu.Trigger>

        <ContextMenu.Content class="context-menu-content">
          <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
            Share
          </ContextMenu.Item>
          <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
            Save
          </ContextMenu.Item>
          <ContextMenu.Item class="context-menu-item" onSelect={() => {}}>
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu>
    </div>
  );
});
```

#### Advanced: Preventing Default Context Menu

Sometimes you want to disable context menu on certain elements but not others:

```typescript
export const SelectiveContextMenu = defineComponent(() => {
  return () => (
    <div class="app">
      {/* Allow context menu here */}
      <ContextMenu>
        <ContextMenu.Trigger class="editable-area">
          <textarea>Right click for options</textarea>
        </ContextMenu.Trigger>

        <ContextMenu.Content class="context-menu-content">
          <ContextMenu.Item onSelect={() => {}}>Custom Action</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu>

      {/* Disable context menu here */}
      <div
        class="protected-area"
        onContextMenu={(e) => e.preventDefault()}
      >
        Right click disabled here
      </div>
    </div>
  );
});
```

---
