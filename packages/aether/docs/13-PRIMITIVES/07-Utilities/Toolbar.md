### Toolbar

A container for grouping buttons and controls with keyboard navigation support.

#### Features

- Horizontal and vertical orientation
- Arrow key navigation with Home/End support
- Optional keyboard loop navigation
- Grouped controls with separators
- Button, link, and toggle item support
- Toggle groups (single/multiple selection)
- Disabled state support
- Full keyboard accessibility

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Toolbar } from 'aether/primitives';

export const BasicToolbar = defineComponent(() => {
  const handleAction = (action: string) => {
    console.log(`Action: ${action}`);
  };

  return () => (
    <Toolbar aria-label="Text formatting" class="toolbar">
      <Toolbar.Group class="toolbar-group">
        <Toolbar.Button onClick={() => handleAction('bold')} class="toolbar-button">
          <BoldIcon />
        </Toolbar.Button>
        <Toolbar.Button onClick={() => handleAction('italic')} class="toolbar-button">
          <ItalicIcon />
        </Toolbar.Button>
        <Toolbar.Button onClick={() => handleAction('underline')} class="toolbar-button">
          <UnderlineIcon />
        </Toolbar.Button>
      </Toolbar.Group>

      <Toolbar.Separator class="toolbar-separator" />

      <Toolbar.Group class="toolbar-group">
        <Toolbar.Button onClick={() => handleAction('undo')} class="toolbar-button">
          <UndoIcon />
        </Toolbar.Button>
        <Toolbar.Button onClick={() => handleAction('redo')} class="toolbar-button">
          <RedoIcon />
        </Toolbar.Button>
      </Toolbar.Group>
    </Toolbar>
  );
});
```

#### Vertical Toolbar

```typescript
import { defineComponent } from 'aether';
import { Toolbar } from 'aether/primitives';

export const VerticalToolbar = defineComponent(() => {
  return () => (
    <div class="toolbar-container">
      <Toolbar
        orientation="vertical"
        aria-label="Drawing tools"
        class="toolbar-vertical"
      >
        <Toolbar.Button class="toolbar-button">
          <SelectIcon />
        </Toolbar.Button>
        <Toolbar.Button class="toolbar-button">
          <PencilIcon />
        </Toolbar.Button>
        <Toolbar.Button class="toolbar-button">
          <ShapesIcon />
        </Toolbar.Button>

        <Toolbar.Separator class="toolbar-separator-horizontal" />

        <Toolbar.Button class="toolbar-button">
          <EraserIcon />
        </Toolbar.Button>
      </Toolbar>

      <main class="canvas">
        {/* Drawing canvas */}
      </main>
    </div>
  );
});
```

#### Toggle Groups

```typescript
import { defineComponent, signal } from 'aether';
import { Toolbar } from 'aether/primitives';

export const ToolbarWithToggles = defineComponent(() => {
  const textAlign = signal('left');
  const textStyles = signal<string[]>([]);

  return () => (
    <Toolbar aria-label="Text editor" class="toolbar">
      {/* Single selection toggle group */}
      <Toolbar.ToggleGroup
        type="single"
        value={textAlign()}
        onValueChange={(value) => textAlign(value as string)}
        class="toolbar-toggle-group"
      >
        <Toolbar.ToggleItem value="left" class="toolbar-toggle-item">
          <AlignLeftIcon />
        </Toolbar.ToggleItem>
        <Toolbar.ToggleItem value="center" class="toolbar-toggle-item">
          <AlignCenterIcon />
        </Toolbar.ToggleItem>
        <Toolbar.ToggleItem value="right" class="toolbar-toggle-item">
          <AlignRightIcon />
        </Toolbar.ToggleItem>
        <Toolbar.ToggleItem value="justify" class="toolbar-toggle-item">
          <AlignJustifyIcon />
        </Toolbar.ToggleItem>
      </Toolbar.ToggleGroup>

      <Toolbar.Separator class="toolbar-separator" />

      {/* Multiple selection toggle group */}
      <Toolbar.ToggleGroup
        type="multiple"
        value={textStyles()}
        onValueChange={(value) => textStyles(value as string[])}
        class="toolbar-toggle-group"
      >
        <Toolbar.ToggleItem value="bold" class="toolbar-toggle-item">
          <BoldIcon />
        </Toolbar.ToggleItem>
        <Toolbar.ToggleItem value="italic" class="toolbar-toggle-item">
          <ItalicIcon />
        </Toolbar.ToggleItem>
        <Toolbar.ToggleItem value="underline" class="toolbar-toggle-item">
          <UnderlineIcon />
        </Toolbar.ToggleItem>
      </Toolbar.ToggleGroup>
    </Toolbar>
  );
});
```

#### Toolbar with Links

```typescript
import { defineComponent } from 'aether';
import { Toolbar } from 'aether/primitives';

export const NavigationToolbar = defineComponent(() => {
  return () => (
    <Toolbar aria-label="Main navigation" class="toolbar">
      <Toolbar.Link href="/" class="toolbar-link">
        Home
      </Toolbar.Link>
      <Toolbar.Link href="/products" class="toolbar-link">
        Products
      </Toolbar.Link>
      <Toolbar.Link href="/about" class="toolbar-link">
        About
      </Toolbar.Link>
      <Toolbar.Link href="/contact" class="toolbar-link">
        Contact
      </Toolbar.Link>
    </Toolbar>
  );
});
```

#### Disabled Items

```typescript
import { defineComponent, signal } from 'aether';
import { Toolbar } from 'aether/primitives';

export const ToolbarWithDisabledItems = defineComponent(() => {
  const hasSelection = signal(false);
  const canUndo = signal(false);
  const canRedo = signal(false);

  return () => (
    <Toolbar aria-label="Editor controls" class="toolbar">
      <Toolbar.Group class="toolbar-group">
        <Toolbar.Button
          disabled={!hasSelection()}
          onClick={() => document.execCommand('cut')}
          class="toolbar-button"
        >
          <CutIcon />
        </Toolbar.Button>
        <Toolbar.Button
          disabled={!hasSelection()}
          onClick={() => document.execCommand('copy')}
          class="toolbar-button"
        >
          <CopyIcon />
        </Toolbar.Button>
        <Toolbar.Button
          onClick={() => document.execCommand('paste')}
          class="toolbar-button"
        >
          <PasteIcon />
        </Toolbar.Button>
      </Toolbar.Group>

      <Toolbar.Separator class="toolbar-separator" />

      <Toolbar.Group class="toolbar-group">
        <Toolbar.Button
          disabled={!canUndo()}
          onClick={() => document.execCommand('undo')}
          class="toolbar-button"
        >
          <UndoIcon />
        </Toolbar.Button>
        <Toolbar.Button
          disabled={!canRedo()}
          onClick={() => document.execCommand('redo')}
          class="toolbar-button"
        >
          <RedoIcon />
        </Toolbar.Button>
      </Toolbar.Group>
    </Toolbar>
  );
});
```

#### Styling Example

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2);
  background: var(--color-background-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.toolbar[data-orientation="vertical"] {
  flex-direction: column;
  width: fit-content;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
}

.toolbar[data-orientation="vertical"] .toolbar-group {
  flex-direction: column;
}

.toolbar-button,
.toolbar-toggle-item,
.toolbar-link {
  display: flex;
  align-items: center;
  justify-content: center;

  min-width: 36px;
  height: 36px;
  padding: var(--spacing-2);

  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);

  color: var(--color-text-primary);
  text-decoration: none;
  font-size: var(--font-size-sm);

  cursor: pointer;
  outline: none;

  transition: all var(--transition-fast);
}

.toolbar-button:hover,
.toolbar-toggle-item:hover,
.toolbar-link:hover {
  background: var(--color-background-primary);
  border-color: var(--color-border);
}

.toolbar-button:focus-visible,
.toolbar-toggle-item:focus-visible,
.toolbar-link:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
}

.toolbar-button:active,
.toolbar-toggle-item:active {
  background: var(--color-background-tertiary);
}

.toolbar-button[data-disabled],
.toolbar-toggle-item[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.toolbar-toggle-item[aria-checked="true"] {
  background: var(--color-primary-100);
  color: var(--color-primary-700);
  border-color: var(--color-primary-300);
}

.toolbar-separator {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  margin: 0 var(--spacing-1);
}

.toolbar[data-orientation="vertical"] .toolbar-separator,
.toolbar-separator-horizontal {
  width: 24px;
  height: 1px;
  margin: var(--spacing-1) 0;
}

.toolbar-toggle-group {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-1);
  background: var(--color-background-primary);
  border-radius: var(--radius-sm);
}

.toolbar[data-orientation="vertical"] .toolbar-toggle-group {
  flex-direction: column;
}
```

#### API Reference

**`<Toolbar>`** - Root toolbar container

Props:
- `orientation?: 'horizontal' | 'vertical'` - Layout orientation (default: 'horizontal')
- `aria-label?: string` - Accessible label (required)
- `loop?: boolean` - Enable keyboard navigation looping (default: true)
- `...HTMLAttributes` - Standard div props

Keyboard Navigation:
- `ArrowRight`/`ArrowDown` - Navigate to next item (based on orientation)
- `ArrowLeft`/`ArrowUp` - Navigate to previous item (based on orientation)
- `Home` - Focus first item
- `End` - Focus last item

**`<Toolbar.Group>`** - Groups related toolbar items

Props:
- `...HTMLAttributes` - Standard div props

**`<Toolbar.Button>`** - Button within toolbar

Props:
- `type?: 'button' | 'submit' | 'reset'` - Button type (default: 'button')
- `disabled?: boolean` - Disable button
- `onClick?: (e: Event) => void` - Click handler
- `...HTMLAttributes` - Standard button props

**`<Toolbar.Link>`** - Link within toolbar

Props:
- `href?: string` - Link destination
- `target?: string` - Link target
- `...HTMLAttributes` - Standard anchor props

**`<Toolbar.Separator>`** - Visual separator

Props:
- `...HTMLAttributes` - Standard div props

**`<Toolbar.ToggleGroup>`** - Group of toggle buttons

Props:
- `type?: 'single' | 'multiple'` - Selection mode (default: 'single')
- `value?: string | string[]` - Controlled value
- `defaultValue?: string | string[]` - Initial value (uncontrolled)
- `onValueChange?: (value: string | string[]) => void` - Change handler
- `...HTMLAttributes` - Standard div props

**`<Toolbar.ToggleItem>`** - Toggle button within toggle group

Props:
- `value: string` - Item value (required)
- `disabled?: boolean` - Disable item
- `...HTMLAttributes` - Standard button props

#### Accessibility

The Toolbar component follows WAI-ARIA authoring practices:

- Uses `role="toolbar"` for the container
- Provides `aria-orientation` matching the orientation prop
- Supports full keyboard navigation with arrow keys
- Implements roving tabindex for efficient keyboard access
- Toggle groups use appropriate ARIA roles (`radiogroup` or `group`)
- Toggle items use `role="radio"` and `aria-checked` states
- Disabled items are properly marked and excluded from navigation
- Requires `aria-label` for screen reader context

#### Best Practices

1. **Always provide an aria-label** - Describes the toolbar's purpose
2. **Group related controls** - Use `Toolbar.Group` for logical grouping
3. **Use separators sparingly** - Only between distinct groups
4. **Provide visual feedback** - Show hover, focus, active, and disabled states
5. **Consider orientation** - Vertical toolbars work well for sidebars
6. **Use toggle groups appropriately** - Single for radio-like, multiple for checkbox-like
7. **Add tooltips** - Especially for icon-only buttons
8. **Keep items focusable** - Don't break keyboard navigation with custom focus handling

#### Advanced: Rich Toolbar with Dropdowns

```typescript
import { defineComponent, signal } from 'aether';
import { Toolbar } from 'aether/primitives';
import { Dropdown } from 'aether/primitives';

export const RichTextToolbar = defineComponent(() => {
  const fontSize = signal('16px');
  const fontFamily = signal('Arial');

  return () => (
    <Toolbar aria-label="Rich text editor" class="toolbar">
      {/* Font family dropdown */}
      <Dropdown>
        <Dropdown.Trigger class="toolbar-dropdown-trigger">
          <span>{fontFamily()}</span>
          <ChevronDownIcon />
        </Dropdown.Trigger>
        <Dropdown.Content class="toolbar-dropdown-content">
          <Dropdown.Item onClick={() => fontFamily('Arial')}>
            Arial
          </Dropdown.Item>
          <Dropdown.Item onClick={() => fontFamily('Times New Roman')}>
            Times New Roman
          </Dropdown.Item>
          <Dropdown.Item onClick={() => fontFamily('Courier New')}>
            Courier New
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>

      {/* Font size dropdown */}
      <Dropdown>
        <Dropdown.Trigger class="toolbar-dropdown-trigger">
          <span>{fontSize()}</span>
          <ChevronDownIcon />
        </Dropdown.Trigger>
        <Dropdown.Content class="toolbar-dropdown-content">
          <Dropdown.Item onClick={() => fontSize('12px')}>12px</Dropdown.Item>
          <Dropdown.Item onClick={() => fontSize('14px')}>14px</Dropdown.Item>
          <Dropdown.Item onClick={() => fontSize('16px')}>16px</Dropdown.Item>
          <Dropdown.Item onClick={() => fontSize('18px')}>18px</Dropdown.Item>
          <Dropdown.Item onClick={() => fontSize('24px')}>24px</Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>

      <Toolbar.Separator class="toolbar-separator" />

      {/* Standard formatting buttons */}
      <Toolbar.Group class="toolbar-group">
        <Toolbar.Button class="toolbar-button">
          <BoldIcon />
        </Toolbar.Button>
        <Toolbar.Button class="toolbar-button">
          <ItalicIcon />
        </Toolbar.Button>
        <Toolbar.Button class="toolbar-button">
          <UnderlineIcon />
        </Toolbar.Button>
      </Toolbar.Group>
    </Toolbar>
  );
});
```

#### Integration with Other Components

Toolbar works well with:
- **Dropdown** - For complex actions and menus
- **Tooltip** - For explaining icon-only buttons
- **Popover** - For color pickers and advanced controls
- **Separator** - For visual grouping
- **VisuallyHidden** - For accessible button labels

---
