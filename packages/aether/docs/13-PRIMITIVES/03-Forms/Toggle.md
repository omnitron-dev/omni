# Toggle

A two-state button for binary options like text formatting, view modes, or filter states.

## Overview

The Toggle primitive is a button that maintains a pressed/unpressed state, ideal for toolbar buttons, formatting controls, and filters. Unlike Switch (which represents settings) or Checkbox (which represents selection), Toggle is designed for immediate actions that can be turned on/off.

### When to Use Toggle vs Switch vs Checkbox

**Use Toggle when:**
- Building formatting toolbars (bold, italic, underline)
- Creating view switchers (grid/list views)
- Toggling UI features (show/hide panels)
- Filter buttons that affect content display
- Actions that need immediate visual feedback

**Use Switch when:**
- Configuring settings (airplane mode, notifications)
- Enabling/disabling system features
- Changes that take effect immediately but represent configuration
- Binary preferences that persist

**Use Checkbox when:**
- Selecting items from a list
- Accepting terms and conditions
- Multi-item selection scenarios
- Form inputs that need to submit a value

**Key Differences:**
```typescript
// Toggle - Button with aria-pressed (action-oriented)
<Toggle pressed={isBold} aria-label="Bold">
  <BoldIcon />
</Toggle>

// Switch - Input with checked state (setting-oriented)
<Switch checked={notificationsEnabled}>
  <Switch.Thumb />
</Switch>

// Checkbox - Input for selection (data-oriented)
<Checkbox checked={isSelected} name="item-1" />
```

## Features

- Two-state pressed/unpressed indication
- Keyboard support (Space and Enter)
- Disabled state handling
- ARIA button pattern with `aria-pressed`
- Controlled and uncontrolled modes
- Icon-only or text+icon support
- Data attributes for styling (`data-state`, `data-disabled`)

## Basic Usage

### Icon-Only Toggle (Most Common)

```typescript
import { defineComponent, signal } from 'aether';
import { Toggle } from 'aether/primitives';

export const FormatToolbar = defineComponent(() => {
  const isBold = signal(false);
  const isItalic = signal(false);
  const isUnderline = signal(false);

  return () => (
    <div class="toolbar">
      <Toggle
        pressed={isBold}
        onPressedChange={(pressed) => {
          isBold.set(pressed);
          applyBold(pressed);
        }}
        aria-label="Bold"
        class="toggle-button"
      >
        <BoldIcon />
      </Toggle>

      <Toggle
        pressed={isItalic}
        onPressedChange={(pressed) => {
          isItalic.set(pressed);
          applyItalic(pressed);
        }}
        aria-label="Italic"
        class="toggle-button"
      >
        <ItalicIcon />
      </Toggle>

      <Toggle
        pressed={isUnderline}
        onPressedChange={(pressed) => {
          isUnderline.set(pressed);
          applyUnderline(pressed);
        }}
        aria-label="Underline"
        class="toggle-button"
      >
        <UnderlineIcon />
      </Toggle>
    </div>
  );
});
```

### View Switcher

```typescript
export const ViewSwitcher = defineComponent(() => {
  const isGridView = signal(false);

  return () => (
    <Toggle
      pressed={isGridView}
      onPressedChange={isGridView}
      aria-label={isGridView() ? "Switch to list view" : "Switch to grid view"}
      class="view-toggle"
    >
      {isGridView() ? <ListIcon /> : <GridIcon />}
    </Toggle>
  );
});
```

### Text with Icon

```typescript
export const FilterToggle = defineComponent(() => {
  const showCompleted = signal(false);

  return () => (
    <Toggle
      pressed={showCompleted}
      onPressedChange={showCompleted}
      class="filter-toggle"
    >
      <CheckIcon />
      <span>Show Completed</span>
    </Toggle>
  );
});
```

## Advanced Examples

### Uncontrolled Mode

```typescript
export const QuickToggle = defineComponent(() => {
  const handleToggle = (pressed: boolean) => {
    console.log('Toggle state changed:', pressed);
    // Apply changes without managing signal
  };

  return () => (
    <Toggle
      defaultPressed={false}
      onPressedChange={handleToggle}
      aria-label="Quick toggle"
      class="toggle-button"
    >
      <StarIcon />
    </Toggle>
  );
});
```

### Disabled State

```typescript
export const ConditionalToggle = defineComponent(() => {
  const hasPermission = signal(false);
  const isActive = signal(false);

  return () => (
    <div>
      <Toggle
        pressed={isActive}
        onPressedChange={isActive}
        disabled={!hasPermission()}
        aria-label="Activate feature"
        class="toggle-button"
      >
        <FeatureIcon />
      </Toggle>

      {!hasPermission() && (
        <p class="help-text">You need permission to use this feature</p>
      )}
    </div>
  );
});
```

### Multiple Toggle States

```typescript
export const EditorToolbar = defineComponent(() => {
  const formatting = signal({
    bold: false,
    italic: false,
    underline: false,
    code: false,
  });

  const toggleFormat = (format: keyof typeof formatting.value) => {
    formatting.set({
      ...formatting(),
      [format]: !formatting()[format],
    });
  };

  return () => (
    <div class="editor-toolbar">
      <div class="toolbar-group">
        <Toggle
          pressed={signal(() => formatting().bold)}
          onPressedChange={() => toggleFormat('bold')}
          aria-label="Bold"
          class="toggle-button"
        >
          <BoldIcon />
        </Toggle>

        <Toggle
          pressed={signal(() => formatting().italic)}
          onPressedChange={() => toggleFormat('italic')}
          aria-label="Italic"
          class="toggle-button"
        >
          <ItalicIcon />
        </Toggle>

        <Toggle
          pressed={signal(() => formatting().underline)}
          onPressedChange={() => toggleFormat('underline')}
          aria-label="Underline"
          class="toggle-button"
        >
          <UnderlineIcon />
        </Toggle>
      </div>

      <div class="toolbar-separator" />

      <div class="toolbar-group">
        <Toggle
          pressed={signal(() => formatting().code)}
          onPressedChange={() => toggleFormat('code')}
          aria-label="Inline code"
          class="toggle-button"
        >
          <CodeIcon />
        </Toggle>
      </div>
    </div>
  );
});
```

### Filter Toolbar

```typescript
export const FilterToolbar = defineComponent(() => {
  const filters = signal({
    favorites: false,
    unread: false,
    archived: false,
  });

  const toggleFilter = (filter: keyof typeof filters.value) => {
    filters.set({
      ...filters(),
      [filter]: !filters()[filter],
    });
  };

  return () => (
    <div class="filter-toolbar">
      <Toggle
        pressed={signal(() => filters().favorites)}
        onPressedChange={() => toggleFilter('favorites')}
        class="filter-toggle"
      >
        <StarIcon />
        <span>Favorites</span>
      </Toggle>

      <Toggle
        pressed={signal(() => filters().unread)}
        onPressedChange={() => toggleFilter('unread')}
        class="filter-toggle"
      >
        <MailIcon />
        <span>Unread</span>
      </Toggle>

      <Toggle
        pressed={signal(() => filters().archived)}
        onPressedChange={() => toggleFilter('archived')}
        class="filter-toggle"
      >
        <ArchiveIcon />
        <span>Archived</span>
      </Toggle>
    </div>
  );
});
```

## Styling

### Basic Toggle Button

```css
.toggle-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  min-width: 36px;
  height: 36px;
  padding: 0 var(--spacing-2);

  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);

  cursor: pointer;
  transition: all var(--transition-fast);
  outline: none;
}

.toggle-button:hover {
  background: var(--color-background-secondary);
  color: var(--color-text-primary);
}

.toggle-button:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
  border-color: var(--color-primary-500);
}

/* Pressed state */
.toggle-button[data-state="on"] {
  background: var(--color-primary-100);
  border-color: var(--color-primary-500);
  color: var(--color-primary-700);
}

.toggle-button[data-state="on"]:hover {
  background: var(--color-primary-200);
}

/* Disabled state */
.toggle-button[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
```

### Toolbar Group

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-2);
  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.toolbar-group {
  display: flex;
  gap: var(--spacing-1);
}

.toolbar-separator {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  margin: 0 var(--spacing-1);
}
```

### Filter Toggle

```css
.filter-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);

  padding: var(--spacing-2) var(--spacing-3);

  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);

  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 500;

  cursor: pointer;
  transition: all var(--transition-fast);
}

.filter-toggle:hover {
  border-color: var(--color-primary-300);
  background: var(--color-primary-50);
}

.filter-toggle[data-state="on"] {
  background: var(--color-primary-500);
  border-color: var(--color-primary-500);
  color: white;
}

.filter-toggle svg {
  width: 16px;
  height: 16px;
}
```

### View Toggle

```css
.view-toggle {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 40px;
  height: 40px;

  background: transparent;
  border: none;
  border-radius: var(--radius-md);

  color: var(--color-text-secondary);

  cursor: pointer;
  transition: all var(--transition-fast);
}

.view-toggle:hover {
  background: var(--color-background-secondary);
  color: var(--color-text-primary);
}

.view-toggle[data-state="on"] {
  background: var(--color-primary-100);
  color: var(--color-primary-700);
}
```

## Accessibility

### ARIA Attributes

The Toggle component implements the WAI-ARIA button pattern with pressed state:

```typescript
<button
  role="button"
  aria-pressed="true"  // or "false"
  aria-label="Bold"    // Required for icon-only toggles
>
  <BoldIcon />
</button>
```

### Key Features

1. **Role**: Uses `role="button"` (native button element)
2. **State**: `aria-pressed` indicates toggle state to screen readers
3. **Labels**: `aria-label` required for icon-only toggles
4. **Keyboard**: Space and Enter keys toggle the state
5. **Focus**: Visible focus indicators required
6. **Disabled**: Both `disabled` attribute and `data-disabled` for styling

### Screen Reader Announcements

```typescript
// Unpressed state
"Bold, button, not pressed"

// Pressed state
"Bold, button, pressed"

// Disabled state
"Bold, button, not pressed, disabled"
```

### Best Practices

1. **Always provide labels** for icon-only toggles:
```typescript
<Toggle aria-label="Bold" pressed={isBold}>
  <BoldIcon />
</Toggle>
```

2. **Use descriptive labels** that indicate the action:
```typescript
// Good
<Toggle aria-label="Bold text">

// Better
<Toggle aria-label="Toggle bold formatting">
```

3. **Provide context** for dynamic toggles:
```typescript
<Toggle
  aria-label={isGridView() ? "Switch to list view" : "Switch to grid view"}
  pressed={isGridView}
>
  {isGridView() ? <ListIcon /> : <GridIcon />}
</Toggle>
```

4. **Group related toggles** semantically:
```typescript
<div role="toolbar" aria-label="Text formatting">
  <Toggle aria-label="Bold">...</Toggle>
  <Toggle aria-label="Italic">...</Toggle>
  <Toggle aria-label="Underline">...</Toggle>
</div>
```

## API Reference

### Toggle Props

```typescript
interface ToggleProps {
  /**
   * Controlled pressed state
   */
  pressed?: WritableSignal<boolean>;

  /**
   * Initial pressed state (uncontrolled)
   * @default false
   */
  defaultPressed?: boolean;

  /**
   * Callback when pressed state changes
   */
  onPressedChange?: (pressed: boolean) => void;

  /**
   * Disabled state
   * @default false
   */
  disabled?: boolean;

  /**
   * ID for the toggle button
   */
  id?: string;

  /**
   * Children (icon, text, or both)
   */
  children?: any;

  /**
   * Additional HTML button attributes
   */
  [key: string]: any;
}
```

### Data Attributes

The component automatically sets these data attributes for styling:

- `data-state`: `"on"` | `"off"` - Current pressed state
- `data-disabled`: Present when disabled, undefined otherwise

### HTML Attributes

All standard button attributes are supported:
- `aria-label` - Label for icon-only toggles (recommended)
- `aria-describedby` - Additional description
- `class` - CSS classes
- `style` - Inline styles
- `title` - Tooltip text

## Common Use Cases

### 1. Text Formatting Toolbar

```typescript
const TextEditor = defineComponent(() => {
  const format = signal({ bold: false, italic: false, underline: false });

  return () => (
    <div role="toolbar" aria-label="Text formatting">
      <Toggle
        pressed={signal(() => format().bold)}
        onPressedChange={(p) => format.set({ ...format(), bold: p })}
        aria-label="Bold"
      >
        <BoldIcon />
      </Toggle>
      {/* More format toggles... */}
    </div>
  );
});
```

### 2. Sidebar Panel Toggles

```typescript
const LayoutControls = defineComponent(() => {
  const showSidebar = signal(true);
  const showPreview = signal(false);

  return () => (
    <div class="layout-controls">
      <Toggle pressed={showSidebar} aria-label="Toggle sidebar">
        <SidebarIcon />
      </Toggle>
      <Toggle pressed={showPreview} aria-label="Toggle preview">
        <EyeIcon />
      </Toggle>
    </div>
  );
});
```

### 3. Filter Buttons

```typescript
const ProductFilters = defineComponent(() => {
  const showSale = signal(false);
  const showInStock = signal(true);

  return () => (
    <div class="filters">
      <Toggle pressed={showSale} class="filter-toggle">
        <TagIcon />
        On Sale
      </Toggle>
      <Toggle pressed={showInStock} class="filter-toggle">
        <CheckIcon />
        In Stock
      </Toggle>
    </div>
  );
});
```

### 4. View Mode Switcher

```typescript
const ViewModeSwitcher = defineComponent(() => {
  const isCompact = signal(false);

  return () => (
    <Toggle
      pressed={isCompact}
      onPressedChange={(pressed) => {
        isCompact.set(pressed);
        saveViewPreference(pressed ? 'compact' : 'comfortable');
      }}
      aria-label={isCompact() ? "Switch to comfortable view" : "Switch to compact view"}
    >
      {isCompact() ? <ExpandIcon /> : <CompressIcon />}
    </Toggle>
  );
});
```

## Best Practices

### 1. Use Appropriate Labels

```typescript
// ❌ Bad - No context
<Toggle aria-label="Bold">

// ✅ Good - Clear action
<Toggle aria-label="Toggle bold formatting">
```

### 2. Group Related Toggles

```typescript
// ✅ Good - Logical grouping
<div role="toolbar" aria-label="Text formatting">
  <div class="toolbar-group">
    <Toggle aria-label="Bold">...</Toggle>
    <Toggle aria-label="Italic">...</Toggle>
  </div>
  <div class="toolbar-separator" />
  <div class="toolbar-group">
    <Toggle aria-label="Align left">...</Toggle>
    <Toggle aria-label="Align center">...</Toggle>
  </div>
</div>
```

### 3. Provide Visual Feedback

```typescript
// ✅ Good - Clear pressed state
.toggle-button[data-state="on"] {
  background: var(--color-primary-100);
  border-color: var(--color-primary-500);
  color: var(--color-primary-700);
}
```

### 4. Handle Side Effects Properly

```typescript
// ✅ Good - Clear separation of state and effect
const isBold = signal(false);

<Toggle
  pressed={isBold}
  onPressedChange={(pressed) => {
    isBold.set(pressed);
    applyFormatting('bold', pressed); // Side effect
  }}
/>
```

### 5. Consider Toggle vs ToggleGroup

```typescript
// ❌ Bad - Individual toggles for exclusive selection
<Toggle pressed={signal(() => align() === 'left')}>Left</Toggle>
<Toggle pressed={signal(() => align() === 'center')}>Center</Toggle>

// ✅ Good - Use ToggleGroup for exclusive selection
<ToggleGroup type="single" value={align()}>
  <ToggleGroup.Item value="left">Left</ToggleGroup.Item>
  <ToggleGroup.Item value="center">Center</ToggleGroup.Item>
</ToggleGroup>
```

## Integration Patterns

### With Keyboard Shortcuts

```typescript
export const EditorWithShortcuts = defineComponent(() => {
  const isBold = signal(false);

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        isBold.set(!isBold());
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

  return () => (
    <Toggle
      pressed={isBold}
      onPressedChange={isBold}
      aria-label="Bold (⌘B)"
      title="Bold (⌘B)"
    >
      <BoldIcon />
    </Toggle>
  );
});
```

### With Tooltips

```typescript
export const ToggleWithTooltip = defineComponent(() => {
  const isActive = signal(false);

  return () => (
    <Tooltip content="Toggle feature">
      <Toggle pressed={isActive} aria-label="Toggle feature">
        <FeatureIcon />
      </Toggle>
    </Tooltip>
  );
});
```

### With Loading State

```typescript
export const AsyncToggle = defineComponent(() => {
  const isEnabled = signal(false);
  const isLoading = signal(false);

  const handleToggle = async (pressed: boolean) => {
    isLoading.set(true);
    try {
      await savePreference(pressed);
      isEnabled.set(pressed);
    } catch (error) {
      console.error('Failed to save preference:', error);
    } finally {
      isLoading.set(false);
    }
  };

  return () => (
    <Toggle
      pressed={isEnabled}
      onPressedChange={handleToggle}
      disabled={isLoading()}
      aria-label="Toggle feature"
      aria-busy={isLoading()}
    >
      {isLoading() ? <SpinnerIcon /> : <FeatureIcon />}
    </Toggle>
  );
});
```

---

[← Back to Forms](./README.md)
