/**
 * TreeView Component Examples
 *
 * Demonstrates usage of the TreeView component with various configurations
 */

import { signal } from '../src/core/reactivity/index.js';
import { TreeView } from '../src/components/data/TreeView.js';
import type { TreeNodeData } from '../src/components/data/TreeView.js';

// ============================================================================
// Example Data
// ============================================================================

const fileSystemData: TreeNodeData[] = [
  {
    id: 'src',
    label: '📁 src',
    children: [
      {
        id: 'components',
        label: '📁 components',
        children: [
          { id: 'Button.tsx', label: '📄 Button.tsx' },
          { id: 'Input.tsx', label: '📄 Input.tsx' },
          {
            id: 'layout',
            label: '📁 layout',
            children: [
              { id: 'Header.tsx', label: '📄 Header.tsx' },
              { id: 'Footer.tsx', label: '📄 Footer.tsx' },
            ],
          },
        ],
      },
      {
        id: 'utils',
        label: '📁 utils',
        children: [
          { id: 'helpers.ts', label: '📄 helpers.ts' },
          { id: 'constants.ts', label: '📄 constants.ts' },
        ],
      },
      { id: 'App.tsx', label: '📄 App.tsx' },
      { id: 'main.tsx', label: '📄 main.tsx' },
    ],
  },
  {
    id: 'public',
    label: '📁 public',
    children: [
      { id: 'index.html', label: '📄 index.html' },
      { id: 'favicon.ico', label: '🖼️ favicon.ico' },
    ],
  },
  { id: 'package.json', label: '📦 package.json' },
  { id: 'tsconfig.json', label: '⚙️ tsconfig.json' },
  { id: 'README.md', label: '📖 README.md' },
];

const organizationData: TreeNodeData[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    children: [
      {
        id: 'frontend',
        label: 'Frontend',
        children: [
          { id: 'alice', label: 'Alice Johnson', data: { role: 'Senior Frontend Developer' } },
          { id: 'bob', label: 'Bob Smith', data: { role: 'Frontend Developer' } },
        ],
      },
      {
        id: 'backend',
        label: 'Backend',
        children: [
          { id: 'charlie', label: 'Charlie Brown', data: { role: 'Senior Backend Developer' } },
          { id: 'diana', label: 'Diana Prince', data: { role: 'Backend Developer' } },
        ],
      },
    ],
  },
  {
    id: 'design',
    label: 'Design',
    children: [
      { id: 'eve', label: 'Eve Davis', data: { role: 'Lead Designer' } },
      { id: 'frank', label: 'Frank Wilson', data: { role: 'UI/UX Designer' } },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    children: [{ id: 'grace', label: 'Grace Lee', data: { role: 'Marketing Manager' } }],
  },
];

// Generate large dataset for performance testing
const generateLargeDataset = (depth: number, breadth: number, prefix = ''): TreeNodeData[] => {
  const nodes: TreeNodeData[] = [];

  for (let i = 0; i < breadth; i++) {
    const id = prefix ? `${prefix}-${i}` : `${i}`;
    const node: TreeNodeData = {
      id,
      label: `Node ${id}`,
    };

    if (depth > 1) {
      node.children = generateLargeDataset(depth - 1, breadth, id);
    }

    nodes.push(node);
  }

  return nodes;
};

const largeDataset = generateLargeDataset(4, 10); // 10,000+ nodes

// ============================================================================
// Example 1: Basic Tree View
// ============================================================================

export function BasicTreeView() {
  const expandedKeys = signal<string[]>(['src']);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Basic Tree View</h2>
      <p>Simple file system tree with basic expand/collapse functionality.</p>
      <TreeView
        data={fileSystemData}
        height={400}
        itemHeight={32}
        expandedKeys={expandedKeys}
        onExpand={(keys) => {
          console.log('Expanded keys:', keys);
          expandedKeys.set(keys);
        }}
      />
    </div>
  );
}

// ============================================================================
// Example 2: Tree View with Selection
// ============================================================================

export function TreeViewWithSelection() {
  const expandedKeys = signal<string[]>(['src', 'components']);
  const selectedKeys = signal<string[]>([]);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Tree View with Selection</h2>
      <p>Click on nodes to select them. Selected: {selectedKeys().join(', ') || 'None'}</p>
      <TreeView
        data={fileSystemData}
        height={400}
        itemHeight={32}
        expandedKeys={expandedKeys}
        selectedKeys={selectedKeys}
        onExpand={(keys) => expandedKeys.set(keys)}
        onSelect={(keys) => {
          console.log('Selected keys:', keys);
          selectedKeys.set(keys);
        }}
      />
    </div>
  );
}

// ============================================================================
// Example 3: Multi-Select Tree View
// ============================================================================

export function MultiSelectTreeView() {
  const expandedKeys = signal<string[]>(['engineering']);
  const selectedKeys = signal<string[]>([]);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Multi-Select Tree View</h2>
      <p>Hold Ctrl/Cmd to select multiple nodes. Selected: {selectedKeys().join(', ') || 'None'}</p>
      <TreeView
        data={organizationData}
        height={400}
        itemHeight={32}
        multiSelect={true}
        expandedKeys={expandedKeys}
        selectedKeys={selectedKeys}
        onExpand={(keys) => expandedKeys.set(keys)}
        onSelect={(keys) => selectedKeys.set(keys)}
      />
    </div>
  );
}

// ============================================================================
// Example 4: Tree View with Search
// ============================================================================

export function TreeViewWithSearch() {
  const expandedKeys = signal<string[]>([]);
  const searchTerm = signal('');

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Tree View with Search</h2>
      <p>Search automatically expands matching nodes.</p>
      <input
        type="text"
        placeholder="Search..."
        value={searchTerm()}
        onInput={(e) => searchTerm.set((e.target as HTMLInputElement).value)}
        style={{
          width: '100%',
          padding: '0.5rem',
          marginBottom: '1rem',
          border: '1px solid #e5e7eb',
          borderRadius: '0.375rem',
        }}
      />
      <TreeView
        data={fileSystemData}
        height={400}
        itemHeight={32}
        expandedKeys={expandedKeys}
        searchTerm={searchTerm()}
        onExpand={(keys) => expandedKeys.set(keys)}
      />
    </div>
  );
}

// ============================================================================
// Example 5: Custom Node Renderer
// ============================================================================

export function TreeViewWithCustomRenderer() {
  const expandedKeys = signal<string[]>(['engineering', 'frontend']);
  const selectedKeys = signal<string[]>([]);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Tree View with Custom Renderer</h2>
      <p>Custom rendering shows additional information for each node.</p>
      <TreeView
        data={organizationData}
        height={400}
        itemHeight={40}
        expandedKeys={expandedKeys}
        selectedKeys={selectedKeys}
        onExpand={(keys) => expandedKeys.set(keys)}
        onSelect={(keys) => selectedKeys.set(keys)}
        renderNode={(node, { isExpanded, isSelected, level, hasChildren }) => (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              width: '100%',
            }}
          >
            {hasChildren && (
              <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                ▶
              </span>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: isSelected ? 'bold' : 'normal' }}>{node.label}</div>
              {node.data?.role && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{node.data.role}</div>}
            </div>
          </div>
        )}
      />
    </div>
  );
}

// ============================================================================
// Example 6: Large Dataset with Virtual Scrolling
// ============================================================================

export function LargeDatasetTreeView() {
  const expandedKeys = signal<string[]>([]);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Large Dataset (10,000+ nodes)</h2>
      <p>Virtual scrolling ensures smooth performance with large datasets.</p>
      <div style={{ marginBottom: '1rem' }}>
        <button
          onClick={() => {
            // Expand first level
            const firstLevel = largeDataset.map((n) => n.id);
            expandedKeys.set(firstLevel);
          }}
          style={{ padding: '0.5rem 1rem', marginRight: '0.5rem' }}
        >
          Expand First Level
        </button>
        <button
          onClick={() => expandedKeys.set([])}
          style={{ padding: '0.5rem 1rem' }}
        >
          Collapse All
        </button>
      </div>
      <TreeView
        data={largeDataset}
        height={600}
        itemHeight={32}
        expandedKeys={expandedKeys}
        onExpand={(keys) => expandedKeys.set(keys)}
      />
    </div>
  );
}

// ============================================================================
// Example 7: Tree View Variants
// ============================================================================

export function TreeViewVariants() {
  const expandedKeys = signal<string[]>(['src']);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Tree View Variants</h2>

      <h3>Default</h3>
      <TreeView
        data={fileSystemData}
        height={300}
        itemHeight={32}
        expandedKeys={expandedKeys}
        variant="default"
        onExpand={(keys) => expandedKeys.set(keys)}
      />

      <h3 style={{ marginTop: '2rem' }}>Bordered</h3>
      <TreeView
        data={fileSystemData}
        height={300}
        itemHeight={32}
        expandedKeys={expandedKeys}
        variant="bordered"
        onExpand={(keys) => expandedKeys.set(keys)}
      />

      <h3 style={{ marginTop: '2rem' }}>Elevated</h3>
      <TreeView
        data={fileSystemData}
        height={300}
        itemHeight={32}
        expandedKeys={expandedKeys}
        variant="elevated"
        onExpand={(keys) => expandedKeys.set(keys)}
      />
    </div>
  );
}

// ============================================================================
// Example 8: Tree View Sizes
// ============================================================================

export function TreeViewSizes() {
  const expandedKeys = signal<string[]>(['src']);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Tree View Sizes</h2>

      <h3>Small</h3>
      <TreeView
        data={fileSystemData}
        height={250}
        itemHeight={28}
        expandedKeys={expandedKeys}
        size="sm"
        variant="bordered"
        onExpand={(keys) => expandedKeys.set(keys)}
      />

      <h3 style={{ marginTop: '2rem' }}>Medium (Default)</h3>
      <TreeView
        data={fileSystemData}
        height={300}
        itemHeight={32}
        expandedKeys={expandedKeys}
        size="md"
        variant="bordered"
        onExpand={(keys) => expandedKeys.set(keys)}
      />

      <h3 style={{ marginTop: '2rem' }}>Large</h3>
      <TreeView
        data={fileSystemData}
        height={350}
        itemHeight={40}
        expandedKeys={expandedKeys}
        size="lg"
        variant="bordered"
        onExpand={(keys) => expandedKeys.set(keys)}
      />
    </div>
  );
}

// ============================================================================
// Example 9: Disabled Nodes
// ============================================================================

export function TreeViewWithDisabledNodes() {
  const dataWithDisabled: TreeNodeData[] = [
    {
      id: 'public',
      label: '📁 public (read-only)',
      disabled: true,
      children: [
        { id: 'index.html', label: '📄 index.html', disabled: true },
        { id: 'favicon.ico', label: '🖼️ favicon.ico', disabled: true },
      ],
    },
    {
      id: 'src',
      label: '📁 src',
      children: [{ id: 'App.tsx', label: '📄 App.tsx' }],
    },
  ];

  const expandedKeys = signal<string[]>(['public', 'src']);
  const selectedKeys = signal<string[]>([]);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Tree View with Disabled Nodes</h2>
      <p>Disabled nodes cannot be selected or expanded.</p>
      <TreeView
        data={dataWithDisabled}
        height={300}
        itemHeight={32}
        expandedKeys={expandedKeys}
        selectedKeys={selectedKeys}
        onExpand={(keys) => expandedKeys.set(keys)}
        onSelect={(keys) => selectedKeys.set(keys)}
      />
    </div>
  );
}

// ============================================================================
// Example 10: Keyboard Navigation
// ============================================================================

export function TreeViewKeyboardNavigation() {
  const expandedKeys = signal<string[]>(['src']);
  const selectedKeys = signal<string[]>([]);

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Tree View with Keyboard Navigation</h2>
      <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f3f4f6', borderRadius: '0.375rem' }}>
        <strong>Keyboard shortcuts:</strong>
        <ul style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          <li>
            <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd>: Navigate between nodes
          </li>
          <li>
            <kbd>Enter</kbd> / <kbd>Space</kbd>: Select node
          </li>
          <li>
            <kbd>→</kbd>: Expand node
          </li>
          <li>
            <kbd>←</kbd>: Collapse node
          </li>
        </ul>
      </div>
      <TreeView
        data={fileSystemData}
        height={400}
        itemHeight={32}
        expandedKeys={expandedKeys}
        selectedKeys={selectedKeys}
        variant="bordered"
        onExpand={(keys) => expandedKeys.set(keys)}
        onSelect={(keys) => selectedKeys.set(keys)}
      />
    </div>
  );
}
