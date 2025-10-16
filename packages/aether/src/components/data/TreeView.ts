/**
 * TreeView Component (Styled)
 *
 * A high-performance tree view component with virtual scrolling for large datasets:
 * - Virtual scrolling for 1000+ nodes
 * - Expand/collapse functionality
 * - Multi-level nesting support
 * - Node selection (single and multi-select)
 * - Keyboard navigation (arrow keys, Enter, Space)
 * - Search/filter capability
 * - Efficient flattened tree structure
 * - Memoized computed values
 *
 * @example
 * ```tsx
 * const data = [
 *   {
 *     id: '1',
 *     label: 'Node 1',
 *     children: [
 *       { id: '1-1', label: 'Child 1-1' },
 *       { id: '1-2', label: 'Child 1-2' }
 *     ]
 *   }
 * ];
 *
 * <TreeView
 *   data={data}
 *   height={600}
 *   itemHeight={32}
 *   expandedKeys={expandedKeys()}
 *   selectedKeys={selectedKeys()}
 *   onExpand={handleExpand}
 *   onSelect={handleSelect}
 *   renderNode={(node, { isExpanded, isSelected, level }) => (
 *     <TreeNode node={node} expanded={isExpanded} selected={isSelected} level={level} />
 *   )}
 * />
 * ```
 */

import { defineComponent } from '../../core/component/index.js';
import { createContext, useContext, provideContext } from '../../core/component/context.js';
import { signal, computed, type Signal, type WritableSignal } from '../../core/reactivity/index.js';
import { jsx } from '../../jsx-runtime.js';
import { styled } from '../../styling/styled.js';
import { VirtualList } from '../../primitives/VirtualList.js';

// ============================================================================
// Types
// ============================================================================

export interface TreeNodeData {
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

export interface FlattenedNode {
  /** Original node data */
  node: TreeNodeData;
  /** Nesting level (0-based) */
  level: number;
  /** Index in the flattened array */
  index: number;
  /** Whether the node has children */
  hasChildren: boolean;
  /** Parent node ID */
  parentId?: string;
}

export interface TreeViewProps {
  /** Tree data */
  data: TreeNodeData[];
  /** Height of the tree view container */
  height: number | string;
  /** Height of each tree item */
  itemHeight: number;
  /** Expanded node keys (controlled) */
  expandedKeys?: string[] | WritableSignal<string[]>;
  /** Selected node keys (controlled) */
  selectedKeys?: string[] | WritableSignal<string[]>;
  /** Default expanded keys (uncontrolled) */
  defaultExpandedKeys?: string[];
  /** Default selected keys (uncontrolled) */
  defaultSelectedKeys?: string[];
  /** Callback when expanded keys change */
  onExpand?: (expandedKeys: string[]) => void;
  /** Callback when selected keys change */
  onSelect?: (selectedKeys: string[]) => void;
  /** Search term for filtering */
  searchTerm?: string;
  /** Enable multi-select */
  multiSelect?: boolean;
  /** Custom node renderer */
  renderNode?: (
    node: TreeNodeData,
    context: { isExpanded: boolean; isSelected: boolean; level: number; hasChildren: boolean }
  ) => any;
  /** Variant style */
  variant?: 'default' | 'bordered' | 'elevated';
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional props */
  [key: string]: any;
}

export interface TreeViewNodeProps {
  /** Flattened node */
  flatNode: FlattenedNode;
  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

interface TreeViewContextValue {
  expandedKeys: Signal<string[]>;
  selectedKeys: Signal<string[]>;
  toggleExpand: (key: string) => void;
  toggleSelect: (key: string, isMulti: boolean) => void;
  isExpanded: (key: string) => boolean;
  isSelected: (key: string) => boolean;
  itemHeight: number;
  multiSelect: boolean;
  renderNode?: TreeViewProps['renderNode'];
  size: 'sm' | 'md' | 'lg';
}

const TreeViewContext = createContext<TreeViewContextValue | null>(null);

function useTreeViewContext(): TreeViewContextValue {
  const context = useContext(TreeViewContext);
  if (!context) {
    throw new Error('TreeView components must be used within TreeView');
  }
  return context;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Flatten tree structure into a linear array for virtualization
 */
function flattenTree(nodes: TreeNodeData[], expandedKeys: Set<string>, level = 0, parentId?: string): FlattenedNode[] {
  const result: FlattenedNode[] = [];

  for (const node of nodes) {
    const hasChildren = Boolean(node.children && node.children.length > 0);

    result.push({
      node,
      level,
      index: result.length,
      hasChildren,
      parentId,
    });

    // Include children if expanded
    if (hasChildren && expandedKeys.has(node.id)) {
      result.push(...flattenTree(node.children!, expandedKeys, level + 1, node.id));
    }
  }

  return result;
}

/**
 * Filter tree based on search term
 */
function filterTree(nodes: TreeNodeData[], searchTerm: string): TreeNodeData[] {
  if (!searchTerm) return nodes;

  const search = searchTerm.toLowerCase();
  const result: TreeNodeData[] = [];

  for (const node of nodes) {
    const matchesSearch = node.label.toLowerCase().includes(search);
    const filteredChildren = node.children ? filterTree(node.children, searchTerm) : [];

    // Include node if it matches or has matching children
    if (matchesSearch || filteredChildren.length > 0) {
      result.push({
        ...node,
        children: filteredChildren,
      });
    }
  }

  return result;
}

/**
 * Get all node IDs that match search term (for auto-expansion)
 */
function getMatchingNodeIds(nodes: TreeNodeData[], searchTerm: string, parentIds: string[] = []): string[] {
  if (!searchTerm) return [];

  const search = searchTerm.toLowerCase();
  const result: string[] = [];

  for (const node of nodes) {
    const matchesSearch = node.label.toLowerCase().includes(search);
    const childMatches = node.children ? getMatchingNodeIds(node.children, searchTerm, [...parentIds, node.id]) : [];

    if (matchesSearch) {
      // Add all parent IDs to expand the path to this node
      result.push(...parentIds);
    }

    if (childMatches.length > 0) {
      // Add this node ID and all child matches
      result.push(node.id, ...childMatches);
    }
  }

  return result;
}

// ============================================================================
// Styled Components
// ============================================================================

const TreeViewContainer = styled('div', {
  base: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    overflow: 'hidden',
  },
  variants: {
    variant: {
      default: {},
      bordered: {
        border: '1px solid #e5e7eb',
      },
      elevated: {
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

const TreeNodeContainer = styled('div', {
  base: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
    outline: 'none',
    userSelect: 'none',
    '&:hover': {
      backgroundColor: '#f3f4f6',
    },
    '&:focus': {
      backgroundColor: '#e5e7eb',
      outline: '2px solid #3b82f6',
      outlineOffset: '-2px',
    },
    '&[data-selected="true"]': {
      backgroundColor: '#dbeafe',
      '&:hover': {
        backgroundColor: '#bfdbfe',
      },
    },
    '&[data-disabled="true"]': {
      opacity: '0.5',
      cursor: 'not-allowed',
      '&:hover': {
        backgroundColor: 'transparent',
      },
    },
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.75rem',
        padding: '0.25rem 0.5rem',
      },
      md: {
        fontSize: '0.875rem',
        padding: '0.375rem 0.75rem',
      },
      lg: {
        fontSize: '1rem',
        padding: '0.5rem 1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

const TreeNodeExpander = styled('button', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
    width: '1.5rem',
    height: '1.5rem',
    padding: '0',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    borderRadius: '0.25rem',
    transition: 'all 0.15s ease',
    color: '#6b7280',
    '&:hover': {
      backgroundColor: '#e5e7eb',
      color: '#111827',
    },
    '&[data-expanded="true"]': {
      transform: 'rotate(90deg)',
    },
    '&[data-invisible="true"]': {
      visibility: 'hidden',
      pointerEvents: 'none',
    },
  },
  variants: {
    size: {
      sm: {
        width: '1.25rem',
        height: '1.25rem',
      },
      md: {
        width: '1.5rem',
        height: '1.5rem',
      },
      lg: {
        width: '1.75rem',
        height: '1.75rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

const TreeNodeContent = styled('div', {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flex: '1',
    overflow: 'hidden',
  },
});

const TreeNodeLabel = styled('span', {
  base: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

// ============================================================================
// Components
// ============================================================================

/**
 * TreeViewNode - Individual node in the tree
 */
const TreeViewNode = defineComponent<TreeViewNodeProps>((props) => {
  const context = useTreeViewContext();
  const flatNode = props.flatNode;
  const node = flatNode.node;

  const isExpanded = computed(() => context.isExpanded(node.id));
  const isSelected = computed(() => context.isSelected(node.id));

  const handleExpandClick = (e: Event) => {
    e.stopPropagation();
    if (!node.disabled && flatNode.hasChildren) {
      context.toggleExpand(node.id);
    }
  };

  const handleNodeClick = (e: Event) => {
    if (!node.disabled) {
      context.toggleSelect(node.id, context.multiSelect && (e as MouseEvent).ctrlKey);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (node.disabled) return;

    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        context.toggleSelect(node.id, false);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (flatNode.hasChildren && !isExpanded()) {
          context.toggleExpand(node.id);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (flatNode.hasChildren && isExpanded()) {
          context.toggleExpand(node.id);
        }
        break;
      default:
        // Ignore other keys
        break;
    }
  };

  return () => {
    const indentSize = context.size === 'sm' ? 16 : context.size === 'lg' ? 24 : 20;
    const indent = flatNode.level * indentSize;

    // Use custom renderer if provided
    if (context.renderNode) {
      const customContent = context.renderNode(node, {
        isExpanded: isExpanded(),
        isSelected: isSelected(),
        level: flatNode.level,
        hasChildren: flatNode.hasChildren,
      });

      return jsx(TreeNodeContainer, {
        size: context.size,
        style: { paddingLeft: `${indent}px` },
        'data-selected': isSelected() ? 'true' : 'false',
        'data-disabled': node.disabled ? 'true' : 'false',
        'data-level': flatNode.level,
        'data-node-id': node.id,
        tabIndex: node.disabled ? -1 : 0,
        onClick: handleNodeClick,
        onKeyDown: handleKeyDown,
        children: customContent,
      });
    }

    // Default rendering
    const expanderEl = jsx(TreeNodeExpander, {
      size: context.size,
      'data-expanded': isExpanded() ? 'true' : 'false',
      'data-invisible': !flatNode.hasChildren ? 'true' : 'false',
      onClick: handleExpandClick,
      children: '▶',
    });

    const contentEl = jsx(TreeNodeContent, {
      children: jsx(TreeNodeLabel, {
        children: node.label,
      }),
    });

    return jsx(TreeNodeContainer, {
      size: context.size,
      style: { paddingLeft: `${indent}px` },
      'data-selected': isSelected() ? 'true' : 'false',
      'data-disabled': node.disabled ? 'true' : 'false',
      'data-level': flatNode.level,
      'data-node-id': node.id,
      tabIndex: node.disabled ? -1 : 0,
      onClick: handleNodeClick,
      onKeyDown: handleKeyDown,
      children: [expanderEl, contentEl],
    });
  };
});

/**
 * TreeView - Main component
 */
export const TreeView = defineComponent<TreeViewProps>((props) => {
  const variant = props.variant ?? 'default';
  const size = props.size ?? 'md';
  const multiSelect = props.multiSelect ?? false;

  // State management
  const isSignalArray = (val: any): val is WritableSignal<string[]> => typeof val === 'function' && 'set' in val;

  const expandedKeysSignal = isSignalArray(props.expandedKeys)
    ? props.expandedKeys
    : signal<string[]>(props.defaultExpandedKeys ?? []);

  const selectedKeysSignal = isSignalArray(props.selectedKeys)
    ? props.selectedKeys
    : signal<string[]>(props.defaultSelectedKeys ?? []);

  const currentExpandedKeys = () => {
    if (Array.isArray(props.expandedKeys)) {
      return props.expandedKeys;
    }
    return expandedKeysSignal();
  };

  const currentSelectedKeys = () => {
    if (Array.isArray(props.selectedKeys)) {
      return props.selectedKeys;
    }
    return selectedKeysSignal();
  };

  // Auto-expand nodes when searching
  const searchTerm = props.searchTerm ?? '';
  if (searchTerm) {
    const matchingIds = getMatchingNodeIds(props.data, searchTerm);
    const currentExpanded = currentExpandedKeys();
    const newExpanded = [...new Set([...currentExpanded, ...matchingIds])];

    if (newExpanded.length !== currentExpanded.length) {
      if (!Array.isArray(props.expandedKeys)) {
        expandedKeysSignal.set(newExpanded);
      }
      props.onExpand?.(newExpanded);
    }
  }

  // Filter data based on search
  const filteredData = searchTerm ? filterTree(props.data, searchTerm) : props.data;

  // Flatten tree for virtualization
  const flattenedNodes = computed(() => {
    const expandedSet = new Set(currentExpandedKeys());
    return flattenTree(filteredData, expandedSet);
  });

  const toggleExpand = (key: string) => {
    const current = currentExpandedKeys();
    const newExpanded = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];

    if (!Array.isArray(props.expandedKeys)) {
      expandedKeysSignal.set(newExpanded);
    }
    props.onExpand?.(newExpanded);
  };

  const toggleSelect = (key: string, isMulti: boolean) => {
    const current = currentSelectedKeys();
    let newSelected: string[];

    if (isMulti && multiSelect) {
      // Multi-select with Ctrl
      newSelected = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    } else if (multiSelect) {
      // Multi-select without Ctrl - replace selection
      newSelected = [key];
    } else {
      // Single select
      newSelected = current.includes(key) ? [] : [key];
    }

    if (!Array.isArray(props.selectedKeys)) {
      selectedKeysSignal.set(newSelected);
    }
    props.onSelect?.(newSelected);
  };

  const isExpanded = (key: string): boolean => currentExpandedKeys().includes(key);
  const isSelected = (key: string): boolean => currentSelectedKeys().includes(key);

  const contextValue: TreeViewContextValue = {
    expandedKeys: computed(() => currentExpandedKeys()),
    selectedKeys: computed(() => currentSelectedKeys()),
    toggleExpand,
    toggleSelect,
    isExpanded,
    isSelected,
    itemHeight: props.itemHeight,
    multiSelect,
    renderNode: props.renderNode,
    size,
  };

  provideContext(TreeViewContext, contextValue);

  return () => {
    const nodes = flattenedNodes();

    const {
      data: _data,
      height,
      itemHeight,
      expandedKeys: _expandedKeys,
      selectedKeys: _selectedKeys,
      defaultExpandedKeys: _defaultExpandedKeys,
      defaultSelectedKeys: _defaultSelectedKeys,
      onExpand: _onExpand,
      onSelect: _onSelect,
      searchTerm: _searchTerm,
      multiSelect: _multiSelect,
      renderNode: _renderNode,
      variant: _variant,
      size: _size,
      ...restProps
    } = props;

    return jsx(TreeViewContainer, {
      variant,
      ...restProps,
      children: jsx(VirtualList, {
        count: nodes.length,
        height,
        itemSize: itemHeight,
        overscan: 5,
        children: (index: number) => {
          const flatNode = nodes[index];
          return jsx(TreeViewNode, {
            flatNode,
            key: flatNode.node.id,
          });
        },
      }),
    });
  };
});

// ============================================================================
// Display name
// ============================================================================

TreeView.displayName = 'TreeView';

// ============================================================================
// Type exports
// ============================================================================

export type { TreeViewContextValue };
