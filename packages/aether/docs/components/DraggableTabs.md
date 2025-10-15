# DraggableTabs

Enhanced tabs component with drag-and-drop reordering functionality, similar to browser tabs or VSCode editor tabs.

## Features

- **Drag and Drop Reordering**: Reorder tabs by dragging them to new positions
- **Close Buttons**: Optional close buttons on individual tabs
- **Add Button**: Optional button to add new tabs
- **Pinned Tabs**: Support for pinned tabs that cannot be closed or moved
- **Maximum Tabs Limit**: Configurable limit on the number of tabs
- **Touch Support**: Full touch support for mobile devices
- **Smooth Animations**: Configurable animation duration for drag operations
- **Size Variants**: Small, medium, and large size options
- **Icons**: Support for icons on tabs
- **Accessibility**: Full ARIA support with keyboard navigation
- **Custom Data**: Attach custom data to each tab

## Basic Usage

```tsx
import { DraggableTabs, type DraggableTabItem } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether';

function MyComponent() {
  const tabs = signal<DraggableTabItem[]>([
    { id: '1', label: 'Tab 1', closeable: true },
    { id: '2', label: 'Tab 2', closeable: true },
    { id: '3', label: 'Tab 3', closeable: true },
  ]);

  const activeTab = signal('1');

  const handleTabChange = (id: string) => {
    activeTab.set(id);
  };

  const handleTabReorder = (oldIndex: number, newIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(oldIndex, 1);
    currentTabs.splice(newIndex, 0, removed);
    tabs.set(currentTabs);
  };

  const handleTabClose = (id: string) => {
    tabs.set(tabs().filter(tab => tab.id !== id));
  };

  return (
    <DraggableTabs
      tabs={tabs()}
      activeTab={activeTab()}
      onTabChange={handleTabChange}
      onTabReorder={handleTabReorder}
      onTabClose={handleTabClose}
    />
  );
}
```

## Props

### DraggableTabsProps

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tabs` | `DraggableTabItem[]` | Required | Array of tab items |
| `activeTab` | `string` | - | Currently active tab ID |
| `onTabChange` | `(id: string) => void` | - | Callback when active tab changes |
| `onTabReorder` | `(oldIndex: number, newIndex: number) => void` | - | Callback when tabs are reordered |
| `onTabClose` | `(id: string) => void` | - | Callback when a tab is closed |
| `onTabAdd` | `() => void` | - | Callback when add button is clicked |
| `maxTabs` | `number` | `Infinity` | Maximum number of tabs allowed |
| `showAddButton` | `boolean` | `false` | Whether to show the add button |
| `variant` | `'default' \| 'enclosed' \| 'pills'` | `'default'` | Visual style variant |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size variant |
| `touchEnabled` | `boolean` | `true` | Enable touch support for mobile |
| `animationDuration` | `number` | `200` | Animation duration in milliseconds |
| `className` | `string` | - | Additional CSS class name |

### DraggableTabItem

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `id` | `string` | Required | Unique identifier for the tab |
| `label` | `string` | Required | Display label for the tab |
| `closeable` | `boolean` | `true` | Whether the tab can be closed |
| `pinned` | `boolean` | `false` | Whether the tab is pinned (cannot be closed or moved) |
| `icon` | `any` | - | Optional icon element |
| `disabled` | `boolean` | `false` | Whether the tab is disabled |
| `data` | `any` | - | Custom data attached to the tab |

## Examples

### Pinned Tabs

Create tabs that cannot be closed or reordered:

```tsx
const tabs = signal<DraggableTabItem[]>([
  { id: 'home', label: 'Home', closeable: false, pinned: true },
  { id: 'dashboard', label: 'Dashboard', closeable: false, pinned: true },
  { id: 'doc1', label: 'Document 1', closeable: true },
  { id: 'doc2', label: 'Document 2', closeable: true },
]);

<DraggableTabs
  tabs={tabs()}
  activeTab={activeTab()}
  onTabChange={handleTabChange}
  onTabReorder={handleTabReorder}
  onTabClose={handleTabClose}
/>
```

### Add New Tabs

Enable the add button to create new tabs:

```tsx
const handleTabAdd = () => {
  const newTab: DraggableTabItem = {
    id: `tab-${Date.now()}`,
    label: 'New Tab',
    closeable: true,
  };

  tabs.set([...tabs(), newTab]);
  activeTab.set(newTab.id);
};

<DraggableTabs
  tabs={tabs()}
  activeTab={activeTab()}
  onTabChange={handleTabChange}
  onTabReorder={handleTabReorder}
  onTabClose={handleTabClose}
  onTabAdd={handleTabAdd}
  showAddButton={true}
/>
```

### Maximum Tabs Limit

Set a maximum number of tabs:

```tsx
<DraggableTabs
  tabs={tabs()}
  activeTab={activeTab()}
  onTabChange={handleTabChange}
  onTabReorder={handleTabReorder}
  onTabClose={handleTabClose}
  onTabAdd={handleTabAdd}
  showAddButton={true}
  maxTabs={10}
/>
```

The add button will be automatically disabled when the limit is reached.

### Tabs with Icons

Add icons to tabs for better visual identification:

```tsx
const tabs = signal<DraggableTabItem[]>([
  { id: 'home', label: 'Home', icon: '🏠', closeable: false, pinned: true },
  { id: 'search', label: 'Search', icon: '🔍', closeable: true },
  { id: 'settings', label: 'Settings', icon: '⚙️', closeable: true },
]);

<DraggableTabs
  tabs={tabs()}
  activeTab={activeTab()}
  onTabChange={handleTabChange}
  onTabReorder={handleTabReorder}
  onTabClose={handleTabClose}
/>
```

### Size Variants

Choose from three size variants:

```tsx
// Small
<DraggableTabs tabs={tabs()} activeTab={activeTab()} size="sm" />

// Medium (default)
<DraggableTabs tabs={tabs()} activeTab={activeTab()} size="md" />

// Large
<DraggableTabs tabs={tabs()} activeTab={activeTab()} size="lg" />
```

### Browser-like Tabs

Create a browser-like tab experience:

```tsx
const tabs = signal<DraggableTabItem[]>([
  {
    id: '1',
    label: 'New Tab',
    closeable: true,
    data: { url: 'https://example.com' },
  },
  {
    id: '2',
    label: 'GitHub',
    icon: '🐙',
    closeable: true,
    data: { url: 'https://github.com' },
  },
]);

const handleTabChange = (id: string) => {
  activeTab.set(id);
  const tab = tabs().find(t => t.id === id);
  if (tab?.data?.url) {
    // Navigate to URL
    console.log('Navigate to:', tab.data.url);
  }
};

<DraggableTabs
  tabs={tabs()}
  activeTab={activeTab()}
  onTabChange={handleTabChange}
  onTabReorder={handleTabReorder}
  onTabClose={handleTabClose}
  onTabAdd={handleTabAdd}
  showAddButton={true}
  maxTabs={20}
/>
```

### Editor-like Tabs (VSCode Style)

Create an editor-like tab interface with file indicators:

```tsx
const tabs = signal<DraggableTabItem[]>([
  {
    id: 'file1',
    label: 'index.ts',
    icon: '📄',
    closeable: true,
    data: { path: '/src/index.ts', modified: false },
  },
  {
    id: 'file2',
    label: 'App.tsx •',  // • indicates modified
    icon: '⚛️',
    closeable: true,
    data: { path: '/src/App.tsx', modified: true },
  },
]);

const handleTabClose = (id: string) => {
  const tab = tabs().find(t => t.id === id);

  // Confirm close if file is modified
  if (tab?.data?.modified) {
    const confirm = window.confirm(
      `${tab.label.replace(' •', '')} has unsaved changes. Close anyway?`
    );
    if (!confirm) return;
  }

  tabs.set(tabs().filter(t => t.id !== id));
};

<DraggableTabs
  tabs={tabs()}
  activeTab={activeTab()}
  onTabChange={handleTabChange}
  onTabReorder={handleTabReorder}
  onTabClose={handleTabClose}
  onTabAdd={handleTabAdd}
  showAddButton={true}
  size="sm"
/>
```

## Drag and Drop Behavior

### Desktop (Mouse)

1. Click and hold on a tab to start dragging
2. Move the mouse to reorder tabs
3. Release to drop the tab in the new position
4. Pinned tabs cannot be dragged

### Mobile (Touch)

1. Touch and hold on a tab to start dragging
2. Move your finger to reorder tabs
3. Release to drop the tab in the new position
4. Touch support can be disabled with `touchEnabled={false}`

### Visual Feedback

- **Dragging**: The dragged tab becomes semi-transparent
- **Drop Zone**: The target position is highlighted in blue
- **Pinned**: Pinned tabs have a blue left border
- **Active**: Active tab has blue bottom border

## Accessibility

The component follows WAI-ARIA best practices:

- Uses `role="tablist"` for the container
- Uses `aria-orientation="horizontal"` for horizontal layout
- Each close button has descriptive `aria-label`
- Add button has `aria-label="Add tab"`
- Proper keyboard navigation support

## Keyboard Navigation

- **Arrow Keys**: Navigate between tabs (when focused)
- **Enter/Space**: Activate focused tab
- **Escape**: Cancel drag operation
- **Tab**: Move focus to next focusable element

## Styling

The component uses the Aether styling system with the `styled()` function. You can customize the appearance by:

1. **Using the className prop**: Add custom CSS classes
2. **CSS custom properties**: Override CSS variables
3. **Variants**: Use built-in size variants

```tsx
<DraggableTabs
  tabs={tabs()}
  activeTab={activeTab()}
  className="my-custom-tabs"
  size="lg"
/>
```

## Performance Considerations

- **Tab Limit**: Consider setting a reasonable `maxTabs` limit for better performance
- **Animation Duration**: Adjust `animationDuration` based on your needs (lower = faster, higher = smoother)
- **Touch Support**: Disable `touchEnabled` if not needed for desktop-only applications

## Browser Support

- **Desktop**: Chrome, Firefox, Safari, Edge (modern versions)
- **Mobile**: iOS Safari, Chrome Mobile, Samsung Internet
- **Drag & Drop API**: Uses HTML5 Drag and Drop API with fallback for touch devices

## Common Patterns

### Auto-save Tab Order

```tsx
const handleTabReorder = (oldIndex: number, newIndex: number) => {
  const currentTabs = [...tabs()];
  const [removed] = currentTabs.splice(oldIndex, 1);
  currentTabs.splice(newIndex, 0, removed);
  tabs.set(currentTabs);

  // Save to localStorage
  localStorage.setItem('tab-order', JSON.stringify(currentTabs));
};
```

### Close Active Tab and Switch

```tsx
const handleTabClose = (id: string) => {
  const currentTabs = tabs().filter(tab => tab.id !== id);
  tabs.set(currentTabs);

  // If closing active tab, switch to adjacent tab
  if (activeTab() === id && currentTabs.length > 0) {
    const closedIndex = tabs().findIndex(t => t.id === id);
    const nextTab = currentTabs[closedIndex] || currentTabs[closedIndex - 1];
    activeTab.set(nextTab.id);
  }
};
```

### Prevent Closing Last Tab

```tsx
const handleTabClose = (id: string) => {
  if (tabs().length <= 1) {
    console.warn('Cannot close the last tab');
    return;
  }

  tabs.set(tabs().filter(tab => tab.id !== id));
};
```

## Related Components

- **Tabs**: Basic tabs component without drag-and-drop
- **TabsList**: Container for tab triggers
- **TabsTrigger**: Individual tab button
- **TabsContent**: Tab panel content

## Type Exports

```typescript
import type {
  DraggableTabsProps,
  DraggableTabItem
} from '@omnitron-dev/aether';
```

## Notes

- Tabs are rendered in a horizontally scrollable container
- Scrollbar is customized for a modern look
- Component maintains internal drag state
- All callbacks are optional but recommended for full functionality
- The component is controlled (requires external state management)
