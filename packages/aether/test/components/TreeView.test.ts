/**
 * Tests for TreeView component
 */

import { describe, it, expect } from 'vitest';
import { signal } from '../../src/core/reactivity/index.js';
import { TreeView } from '../../src/components/data/TreeView.js';
import type { TreeNodeData } from '../../src/components/data/TreeView.js';

describe('TreeView Component', () => {
  const mockData: TreeNodeData[] = [
    {
      id: '1',
      label: 'Node 1',
      children: [
        { id: '1-1', label: 'Child 1-1' },
        { id: '1-2', label: 'Child 1-2', children: [{ id: '1-2-1', label: 'Child 1-2-1' }] },
      ],
    },
    {
      id: '2',
      label: 'Node 2',
      children: [{ id: '2-1', label: 'Child 2-1' }],
    },
    {
      id: '3',
      label: 'Node 3',
    },
  ];

  it('should be defined', () => {
    expect(TreeView).toBeDefined();
  });

  it('should render with basic props', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
    });
    expect(component).toBeDefined();
  });

  it('should accept expanded keys as array', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      expandedKeys: ['1', '2'],
    });
    expect(component).toBeDefined();
  });

  it('should accept expanded keys as signal', () => {
    const expandedKeys = signal<string[]>(['1', '2']);
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      expandedKeys,
    });
    expect(component).toBeDefined();
  });

  it('should accept selected keys as array', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      selectedKeys: ['1-1'],
    });
    expect(component).toBeDefined();
  });

  it('should accept selected keys as signal', () => {
    const selectedKeys = signal<string[]>(['1-1']);
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      selectedKeys,
    });
    expect(component).toBeDefined();
  });

  it('should accept default expanded keys', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      defaultExpandedKeys: ['1', '2'],
    });
    expect(component).toBeDefined();
  });

  it('should accept default selected keys', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      defaultSelectedKeys: ['1-1'],
    });
    expect(component).toBeDefined();
  });

  it('should accept onExpand callback', () => {
    let expandedKeys: string[] = [];
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      onExpand: (keys) => {
        expandedKeys = keys;
      },
    });
    expect(component).toBeDefined();
  });

  it('should accept onSelect callback', () => {
    let selectedKeys: string[] = [];
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      onSelect: (keys) => {
        selectedKeys = keys;
      },
    });
    expect(component).toBeDefined();
  });

  it('should accept search term', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      searchTerm: 'Child',
    });
    expect(component).toBeDefined();
  });

  it('should enable multi-select', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      multiSelect: true,
    });
    expect(component).toBeDefined();
  });

  it('should accept custom node renderer', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      renderNode: (node, { isExpanded, isSelected, level }) => {
        return `${node.label} (Level ${level})`;
      },
    });
    expect(component).toBeDefined();
  });

  it('should accept variant prop', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      variant: 'bordered',
    });
    expect(component).toBeDefined();
  });

  it('should accept size prop', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      size: 'lg',
    });
    expect(component).toBeDefined();
  });

  it('should accept multiple props', () => {
    const expandedKeys = signal<string[]>(['1']);
    const selectedKeys = signal<string[]>(['1-1']);

    const component = TreeView({
      data: mockData,
      height: 600,
      itemHeight: 40,
      expandedKeys,
      selectedKeys,
      searchTerm: 'Node',
      multiSelect: true,
      variant: 'elevated',
      size: 'md',
      onExpand: (keys) => console.log('Expanded:', keys),
      onSelect: (keys) => console.log('Selected:', keys),
      renderNode: (node, { isExpanded, level }) => `${node.label} - ${level}`,
    });
    expect(component).toBeDefined();
  });

  it('should handle empty data', () => {
    const component = TreeView({
      data: [],
      height: 400,
      itemHeight: 32,
    });
    expect(component).toBeDefined();
  });

  it('should handle deeply nested data', () => {
    const deepData: TreeNodeData[] = [
      {
        id: '1',
        label: 'Level 1',
        children: [
          {
            id: '1-1',
            label: 'Level 2',
            children: [
              {
                id: '1-1-1',
                label: 'Level 3',
                children: [{ id: '1-1-1-1', label: 'Level 4' }],
              },
            ],
          },
        ],
      },
    ];

    const component = TreeView({
      data: deepData,
      height: 400,
      itemHeight: 32,
      defaultExpandedKeys: ['1', '1-1', '1-1-1'],
    });
    expect(component).toBeDefined();
  });

  it('should handle disabled nodes', () => {
    const dataWithDisabled: TreeNodeData[] = [
      { id: '1', label: 'Node 1', disabled: true },
      { id: '2', label: 'Node 2' },
    ];

    const component = TreeView({
      data: dataWithDisabled,
      height: 400,
      itemHeight: 32,
    });
    expect(component).toBeDefined();
  });

  it('should accept custom class names', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      class: 'custom-tree',
    });
    expect(component).toBeDefined();
  });

  it('should accept inline CSS prop', () => {
    const component = TreeView({
      data: mockData,
      height: 400,
      itemHeight: 32,
      css: { border: '1px solid red' },
    });
    expect(component).toBeDefined();
  });

  it('should handle large datasets', () => {
    // Generate large dataset
    const largeData: TreeNodeData[] = Array.from({ length: 100 }, (_, i) => ({
      id: `node-${i}`,
      label: `Node ${i}`,
      children: Array.from({ length: 10 }, (_, j) => ({
        id: `node-${i}-${j}`,
        label: `Child ${i}-${j}`,
      })),
    }));

    const component = TreeView({
      data: largeData,
      height: 600,
      itemHeight: 32,
    });
    expect(component).toBeDefined();
  });

  it('should accept height as string', () => {
    const component = TreeView({
      data: mockData,
      height: '400px',
      itemHeight: 32,
    });
    expect(component).toBeDefined();
  });

  it('should handle nodes with custom data', () => {
    const dataWithCustomData: TreeNodeData[] = [
      {
        id: '1',
        label: 'Node 1',
        data: { type: 'folder', color: 'blue' },
      },
    ];

    const component = TreeView({
      data: dataWithCustomData,
      height: 400,
      itemHeight: 32,
    });
    expect(component).toBeDefined();
  });
});
