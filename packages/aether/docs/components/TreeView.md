# TreeView

A high-performance tree view component with virtual scrolling for displaying hierarchical data. Supports expand/collapse, selection, keyboard navigation, and search functionality.

## Features

- **Virtual Scrolling**: Efficiently handles 1000+ nodes using VirtualList primitive
- **Expand/Collapse**: Interactive tree navigation with expand/collapse functionality
- **Selection**: Single and multi-select support with keyboard modifiers
- **Keyboard Navigation**: Full keyboard support (arrow keys, Enter, Space)
- **Search/Filter**: Built-in search with auto-expansion of matching nodes
- **Custom Rendering**: Flexible node rendering with custom components
- **Performance**: Flattened tree structure with memoized computations
- **Accessibility**: ARIA attributes and keyboard navigation

## Import

```typescript
import { TreeView } from '@omnitron-dev/aether/components/data';
import type { TreeNodeData } from '@omnitron-dev/aether/components/data';
```

## Usage

### Basic Example

```tsx
import { signal } from '@omnitron-dev/aether/reactivity';
import { TreeView } from '@omnitron-dev/aether/components/data';

const data = [
  {
    id: '1',
    label: 'Node 1',
    children: [
      { id: '1-1', label: 'Child 1-1' },
      { id: '1-2', label: 'Child 1-2' },
    ],
  },
  {
    id: '2',
    label: 'Node 2',
    children: [{ id: '2-1', label: 'Child 2-1' }],
  },
];

const expandedKeys = signal(['1']);

<TreeView
  data={data}
  height={400}
  itemHeight={32}
  expandedKeys={expandedKeys}
  onExpand={(keys) => expandedKeys.set(keys)}
/>;
```

### With Selection

```tsx
const expandedKeys = signal(['1']);
const selectedKeys = signal([]);

<TreeView
  data={data}
  height={400}
  itemHeight={32}
  expandedKeys={expandedKeys}
  selectedKeys={selectedKeys}
  onExpand={(keys) => expandedKeys.set(keys)}
  onSelect={(keys) => selectedKeys.set(keys)}
/>;
```

### Multi-Select

```tsx
<TreeView
  data={data}
  height={400}
  itemHeight={32}
  multiSelect={true}
  selectedKeys={selectedKeys}
  onSelect={(keys) => selectedKeys.set(keys)}
/>
```

Hold `Ctrl` (or `Cmd` on Mac) to select multiple nodes.

### With Search

```tsx
const searchTerm = signal('');

<input
  type="text"
  value={searchTerm()}
  onInput={(e) => searchTerm.set(e.target.value)}
/>

<TreeView
  data={data}
  height={400}
  itemHeight={32}
  searchTerm={searchTerm()}
  expandedKeys={expandedKeys}
  onExpand={(keys) => expandedKeys.set(keys)}
/>
```

Search automatically expands nodes to show matching results.

### Custom Node Renderer

```tsx
<TreeView
  data={data}
  height={400}
  itemHeight={40}
  renderNode={(node, { isExpanded, isSelected, level, hasChildren }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {hasChildren && (
        <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}>
          ▶
        </span>
      )}
      <div>
        <div style={{ fontWeight: isSelected ? 'bold' : 'normal' }}>
          {node.label}
        </div>
        {node.data?.description && (
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
            {node.data.description}
          </div>
        )}
      </div>
    </div>
  )}
/>
```

### Variants

```tsx
<TreeView variant="default" {...props} />
<TreeView variant="bordered" {...props} />
<TreeView variant="elevated" {...props} />
```

### Sizes

```tsx
<TreeView size="sm" itemHeight={28} {...props} />
<TreeView size="md" itemHeight={32} {...props} />
<TreeView size="lg" itemHeight={40} {...props} />
```

### Disabled Nodes

```tsx
const data = [
  { id: '1', label: 'Node 1', disabled: true },
  { id: '2', label: 'Node 2' },
];
```

Disabled nodes cannot be expanded or selected.

## API Reference

### TreeView Props

| Prop                   | Type                                                                                       | Default     | Description                           |
| ---------------------- | ------------------------------------------------------------------------------------------ | ----------- | ------------------------------------- |
| `data`                 | `TreeNodeData[]`                                                                           | _required_  | Tree data                             |
| `height`               | `number \| string`                                                                         | _required_  | Height of the tree container          |
| `itemHeight`           | `number`                                                                                   | _required_  | Height of each tree item              |
| `expandedKeys`         | `string[] \| WritableSignal<string[]>`                                                     | `[]`        | Expanded node keys (controlled)       |
| `selectedKeys`         | `string[] \| WritableSignal<string[]>`                                                     | `[]`        | Selected node keys (controlled)       |
| `defaultExpandedKeys`  | `string[]`                                                                                 | `[]`        | Default expanded keys (uncontrolled)  |
| `defaultSelectedKeys`  | `string[]`                                                                                 | `[]`        | Default selected keys (uncontrolled)  |
| `onExpand`             | `(expandedKeys: string[]) => void`                                                         | -           | Callback when expanded keys change    |
| `onSelect`             | `(selectedKeys: string[]) => void`                                                         | -           | Callback when selected keys change    |
| `searchTerm`           | `string`                                                                                   | `''`        | Search term for filtering             |
| `multiSelect`          | `boolean`                                                                                  | `false`     | Enable multi-select                   |
| `renderNode`           | `(node, context) => any`                                                                   | -           | Custom node renderer                  |
| `variant`              | `'default' \| 'bordered' \| 'elevated'`                                                    | `'default'` | Visual variant                        |
| `size`                 | `'sm' \| 'md' \| 'lg'`                                                                     | `'md'`      | Size variant                          |

### TreeNodeData Interface

```typescript
interface TreeNodeData {
  /** Unique identifier for the node */
  id: string;
  /** Node label/text */
  label: string;
  /** Children nodes */
  children?: TreeNodeData[];
  /** Whether the node is disabled */
  disabled?: boolean;
  /** Custom data attached to the node */
  data?: any;
}
```

### RenderNode Context

The `renderNode` function receives a context object with:

```typescript
{
  isExpanded: boolean;   // Whether the node is expanded
  isSelected: boolean;   // Whether the node is selected
  level: number;         // Nesting level (0-based)
  hasChildren: boolean;  // Whether the node has children
}
```

## Keyboard Navigation

| Key                    | Action          |
| ---------------------- | --------------- |
| `Tab` / `Shift+Tab`    | Navigate nodes  |
| `Enter` / `Space`      | Select node     |
| `ArrowRight` (`→`)     | Expand node     |
| `ArrowLeft` (`←`)      | Collapse node   |

## Performance Considerations

### Virtual Scrolling

TreeView uses the VirtualList primitive internally, which only renders visible nodes. This ensures smooth performance even with datasets containing thousands of nodes.

```tsx
// Large dataset with 10,000+ nodes
const largeData = generateLargeDataset(4, 10);

<TreeView
  data={largeData}
  height={600}
  itemHeight={32}
  expandedKeys={expandedKeys}
  onExpand={(keys) => expandedKeys.set(keys)}
/>
```

### Flattened Structure

The component internally flattens the tree structure for efficient virtualization:

1. Tree is flattened into a linear array
2. Only visible nodes are rendered
3. Expanded/collapsed state determines which nodes are included
4. Memoization prevents unnecessary recalculations

### Search Optimization

When searching:
- Tree is filtered to include only matching nodes and their ancestors
- Matching nodes are automatically expanded
- Filtering happens before flattening for optimal performance

## Styling

### Using CSS Variables

```css
.custom-tree [data-tree-node] {
  --tree-node-bg-hover: #f0f9ff;
  --tree-node-bg-selected: #dbeafe;
  --tree-node-text-color: #111827;
}
```

### Using Inline Styles

```tsx
<TreeView
  style={{
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
  }}
  {...props}
/>
```

### Using CSS Prop

```tsx
<TreeView
  css={{
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
  }}
  {...props}
/>
```

## Examples

See [TreeView.example.tsx](../../examples/TreeView.example.tsx) for comprehensive examples including:

1. Basic Tree View
2. Tree View with Selection
3. Multi-Select Tree View
4. Tree View with Search
5. Custom Node Renderer
6. Large Dataset (10,000+ nodes)
7. Tree View Variants
8. Tree View Sizes
9. Disabled Nodes
10. Keyboard Navigation

## Accessibility

- Uses proper ARIA attributes (`role`, `aria-expanded`, `aria-selected`)
- Full keyboard navigation support
- Focus management with visible focus indicators
- Screen reader friendly labels
- Disabled state properly communicated

## Best Practices

### 1. Use Controlled State for Dynamic Updates

```tsx
const expandedKeys = signal(['1', '2']);
const selectedKeys = signal([]);

// Update state reactively
effect(() => {
  console.log('Expanded:', expandedKeys());
  console.log('Selected:', selectedKeys());
});
```

### 2. Optimize Large Datasets

```tsx
// Use appropriate itemHeight for your content
<TreeView
  data={largeData}
  height={600}
  itemHeight={32}  // Match your actual content height
  overscan={5}     // Render extra items for smooth scrolling
/>
```

### 3. Provide Clear Visual Feedback

```tsx
<TreeView
  renderNode={(node, { isExpanded, isSelected }) => (
    <div style={{
      fontWeight: isSelected ? 'bold' : 'normal',
      color: isSelected ? '#3b82f6' : '#111827'
    }}>
      {node.label}
    </div>
  )}
/>
```

### 4. Handle Empty States

```tsx
{data.length === 0 ? (
  <div>No data available</div>
) : (
  <TreeView data={data} {...props} />
)}
```

### 5. Combine with Search for Better UX

```tsx
const searchTerm = signal('');
const expandedKeys = signal([]);

// Search automatically expands matching nodes
<TreeView
  searchTerm={searchTerm()}
  expandedKeys={expandedKeys}
  onExpand={(keys) => expandedKeys.set(keys)}
/>
```

## Related Components

- [Tree](./Tree.md) - Primitive tree component without virtualization
- [VirtualList](./VirtualList.md) - Virtual list primitive
- [Transfer](./Transfer.md) - List transfer component

## TypeScript

TreeView is fully typed with TypeScript. Import types:

```typescript
import type {
  TreeNodeData,
  TreeViewProps,
  FlattenedNode,
  TreeViewContextValue,
} from '@omnitron-dev/aether/components/data';
```
