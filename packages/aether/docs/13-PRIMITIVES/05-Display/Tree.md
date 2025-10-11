### Tree

A hierarchical tree view component with expand/collapse functionality, selection support, and keyboard navigation.

#### Features

- Multi-level nesting support
- Expand/collapse functionality
- Single selection support
- Keyboard navigation (arrows, Enter, Space)
- Controlled and uncontrolled modes
- ARIA tree pattern
- Lazy loading support
- Custom icons for expand/collapse

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Tree } from 'aether/primitives';

const Example = defineComponent(() => {
  const expanded = signal(['folder-1']);
  const selected = signal('file-1');

  return () => (
    <Tree
      expanded={expanded()}
      onExpandedChange={expanded}
      selected={selected()}
      onSelectedChange={selected}
    >
      <Tree.Item value="folder-1">
        <Tree.Trigger class="tree-trigger">
          <span class="tree-icon">▶</span>
          <Tree.Label class="tree-label">Documents</Tree.Label>
        </Tree.Trigger>
        <Tree.Content class="tree-content">
          <Tree.Item value="file-1">
            <Tree.Label class="tree-label">Report.pdf</Tree.Label>
          </Tree.Item>
          <Tree.Item value="file-2">
            <Tree.Label class="tree-label">Invoice.docx</Tree.Label>
          </Tree.Item>
        </Tree.Content>
      </Tree.Item>

      <Tree.Item value="folder-2">
        <Tree.Trigger class="tree-trigger">
          <span class="tree-icon">▶</span>
          <Tree.Label class="tree-label">Images</Tree.Label>
        </Tree.Trigger>
        <Tree.Content class="tree-content">
          <Tree.Item value="file-3">
            <Tree.Label class="tree-label">photo.jpg</Tree.Label>
          </Tree.Item>
        </Tree.Content>
      </Tree.Item>
    </Tree>
  );
});
```

#### With File System

```typescript
interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

const renderTree = (nodes: FileNode[]) => {
  return nodes.map(node => (
    <Tree.Item key={node.id} value={node.id}>
      {node.type === 'folder' ? (
        <>
          <Tree.Trigger>
            <span class="icon">{node.expanded ? '📂' : '📁'}</span>
            <Tree.Label>{node.name}</Tree.Label>
          </Tree.Trigger>
          <Tree.Content>
            {node.children && renderTree(node.children)}
          </Tree.Content>
        </>
      ) : (
        <>
          <span class="icon">📄</span>
          <Tree.Label>{node.name}</Tree.Label>
        </>
      )}
    </Tree.Item>
  ));
};
```

#### API

**`<Tree>`** - Root component
- `expanded?: string[]` - Controlled expanded items
- `onExpandedChange?: (expanded: string[]) => void` - Expanded change callback
- `defaultExpanded?: string[]` - Default expanded items (uncontrolled)
- `selected?: string` - Controlled selected item
- `onSelectedChange?: (selected: string) => void` - Selected change callback
- `defaultSelected?: string` - Default selected item (uncontrolled)

**`<Tree.Item>`** - Individual tree item
- `value: string` - Unique identifier for the item

**`<Tree.Trigger>`** - Trigger button to expand/collapse children

**`<Tree.Content>`** - Container for child items

**`<Tree.Label>`** - Label for the tree item

---

