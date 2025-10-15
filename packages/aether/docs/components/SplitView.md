# SplitView

A high-level composition component built on top of the Resizable primitive that makes it easy to create split-pane layouts with multiple panels, size constraints, collapsible panels, and optional persistence to localStorage.

## Features

- Support for horizontal and vertical splits
- Multiple panels (not just 2)
- Default size configuration for each panel
- Minimum and maximum size constraints
- Collapsible panels with double-click toggle
- Persistence of panel sizes to localStorage (optional)
- Signal-based reactive state management
- Built on Aether's styled() function pattern

## Basic Usage

```tsx
import { SplitView } from '@aether/components/layout';

function App() {
  return (
    <SplitView
      direction="horizontal"
      panels={[
        { id: 'sidebar', defaultSize: 250, minSize: 200, maxSize: 400 },
        { id: 'main', defaultSize: '*', minSize: 400 },
      ]}
    >
      <SplitView.Panel id="sidebar">
        <div>Sidebar content</div>
      </SplitView.Panel>

      <SplitView.Handle direction="horizontal" />

      <SplitView.Panel id="main">
        <div>Main content</div>
      </SplitView.Panel>
    </SplitView>
  );
}
```

## API Reference

### SplitView

The root component that manages the split layout.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'horizontal' \| 'vertical'` | `'horizontal'` | Direction of the split |
| `panels` | `PanelConfig[]` | Required | Array of panel configurations |
| `storageKey` | `string` | `undefined` | Key for localStorage persistence |
| `onSizesChange` | `(sizes: number[]) => void` | `undefined` | Callback when panel sizes change |
| `children` | `ReactNode` | Required | Child components (should be SplitView.Panel) |

### PanelConfig

Configuration object for each panel.

```typescript
interface PanelConfig {
  id: string;                    // Unique identifier for the panel
  defaultSize: number | string;  // Default size in pixels or '*' for flexible
  minSize?: number;              // Minimum size in pixels
  maxSize?: number;              // Maximum size in pixels
  collapsible?: boolean;         // Whether the panel can be collapsed
  defaultCollapsed?: boolean;    // Initial collapsed state
}
```

### SplitView.Panel

Individual panel within a SplitView.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | Required | Panel ID (must match one in panels config) |
| `children` | `ReactNode` | `undefined` | Panel content |

### SplitView.Handle

Draggable handle between panels.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'horizontal' \| 'vertical'` | `'horizontal'` | Direction of the handle |
| `panelId` | `string` | `undefined` | Associated panel ID for collapse toggle |
| `children` | `ReactNode` | `undefined` | Custom handle content |

## Examples

### Three-Panel Layout with Collapsible Panels

```tsx
<SplitView
  direction="horizontal"
  panels={[
    { id: 'sidebar', defaultSize: 250, minSize: 200, maxSize: 400, collapsible: true },
    { id: 'main', defaultSize: '*', minSize: 400 },
    { id: 'inspector', defaultSize: 300, minSize: 200, collapsible: true },
  ]}
  storageKey="app-layout"
>
  <SplitView.Panel id="sidebar">
    <div>Sidebar</div>
  </SplitView.Panel>

  <SplitView.Handle direction="horizontal" panelId="sidebar" />

  <SplitView.Panel id="main">
    <div>Main Content</div>
  </SplitView.Panel>

  <SplitView.Handle direction="horizontal" panelId="inspector" />

  <SplitView.Panel id="inspector">
    <div>Inspector</div>
  </SplitView.Panel>
</SplitView>
```

### Vertical Split

```tsx
<SplitView
  direction="vertical"
  panels={[
    { id: 'top', defaultSize: 200, minSize: 100 },
    { id: 'bottom', defaultSize: '*', minSize: 200 },
  ]}
>
  <SplitView.Panel id="top">
    <div>Top Panel</div>
  </SplitView.Panel>

  <SplitView.Handle direction="vertical" />

  <SplitView.Panel id="bottom">
    <div>Bottom Panel</div>
  </SplitView.Panel>
</SplitView>
```

### Nested SplitViews (IDE Layout)

```tsx
<SplitView
  direction="vertical"
  panels={[
    { id: 'editor-area', defaultSize: '*', minSize: 300 },
    { id: 'terminal', defaultSize: 200, minSize: 100, collapsible: true },
  ]}
>
  <SplitView.Panel id="editor-area">
    <SplitView
      direction="horizontal"
      panels={[
        { id: 'file-tree', defaultSize: 250, collapsible: true },
        { id: 'editor', defaultSize: '*' },
        { id: 'properties', defaultSize: 300, collapsible: true },
      ]}
    >
      <SplitView.Panel id="file-tree">File Explorer</SplitView.Panel>
      <SplitView.Handle direction="horizontal" panelId="file-tree" />
      <SplitView.Panel id="editor">Code Editor</SplitView.Panel>
      <SplitView.Handle direction="horizontal" panelId="properties" />
      <SplitView.Panel id="properties">Properties</SplitView.Panel>
    </SplitView>
  </SplitView.Panel>

  <SplitView.Handle direction="vertical" panelId="terminal" />

  <SplitView.Panel id="terminal">
    <div>Terminal</div>
  </SplitView.Panel>
</SplitView>
```

### Controlled Sizes with Callback

```tsx
function App() {
  const handleSizesChange = (sizes: number[]) => {
    console.log('Panel sizes changed:', sizes);
  };

  return (
    <SplitView
      direction="horizontal"
      panels={[
        { id: 'panel1', defaultSize: 300 },
        { id: 'panel2', defaultSize: 400 },
        { id: 'panel3', defaultSize: 300 },
      ]}
      onSizesChange={handleSizesChange}
    >
      <SplitView.Panel id="panel1">Panel 1</SplitView.Panel>
      <SplitView.Handle direction="horizontal" />
      <SplitView.Panel id="panel2">Panel 2</SplitView.Panel>
      <SplitView.Handle direction="horizontal" />
      <SplitView.Panel id="panel3">Panel 3</SplitView.Panel>
    </SplitView>
  );
}
```

## Features in Detail

### Flexible Sizing

Use `'*'` as the `defaultSize` to make a panel take up remaining space:

```tsx
panels={[
  { id: 'sidebar', defaultSize: 250 },  // Fixed 250px
  { id: 'main', defaultSize: '*' },     // Takes remaining space
]}
```

### Size Constraints

Set minimum and maximum sizes to control how much panels can be resized:

```tsx
panels={[
  { id: 'sidebar', defaultSize: 250, minSize: 200, maxSize: 500 },
]}
```

### Collapsible Panels

Mark panels as collapsible and double-click the associated handle to toggle:

```tsx
panels={[
  { id: 'sidebar', defaultSize: 250, collapsible: true, defaultCollapsed: false },
]}

// ...

<SplitView.Handle direction="horizontal" panelId="sidebar" />
```

### localStorage Persistence

Provide a `storageKey` to automatically save and restore panel sizes:

```tsx
<SplitView
  storageKey="my-app-layout"
  panels={[...]}
>
  {/* ... */}
</SplitView>
```

Panel sizes will be saved to `localStorage` whenever they change and restored on component mount.

### Size Change Callback

Use `onSizesChange` to react to size changes:

```tsx
<SplitView
  onSizesChange={(sizes) => {
    console.log('New sizes:', sizes);
  }}
  panels={[...]}
>
  {/* ... */}
</SplitView>
```

## Styling

The SplitView uses the styled() function pattern and includes data attributes for custom styling:

```css
/* Custom handle styling */
[data-resizable-handle] {
  background-color: #e5e7eb;
}

[data-resizable-handle]:hover {
  background-color: #3b82f6;
}

[data-collapsible]:hover {
  background-color: #8b5cf6;
}

/* Panel styling */
[data-resizable-panel] {
  overflow: auto;
}
```

## Accessibility

- Handles have proper ARIA attributes (`role="separator"`, `aria-orientation`)
- Keyboard navigation supported via tab and arrow keys
- Collapsible panels can be toggled via double-click

## Browser Support

Works in all modern browsers that support:
- CSS Flexbox
- localStorage (for persistence feature)
- Modern JavaScript (ES2020+)

## Performance

- Uses Aether's signal-based reactivity for efficient updates
- Minimal re-renders when resizing
- localStorage persistence is debounced to avoid excessive writes

## Related Components

- [Resizable](/docs/components/Resizable.md) - Low-level primitive for resizable panels
- [Flex](/docs/components/Flex.md) - Flexible layout container
- [Grid](/docs/components/Grid.md) - Grid layout container
