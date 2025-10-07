/**
 * Tree Primitive
 *
 * A tree view component for displaying hierarchical data.
 * Supports expansion, selection, and keyboard navigation.
 *
 * @example
 * ```tsx
 * const expanded = signal(['folder-1']);
 * const selected = signal('file-1');
 *
 * <Tree expanded={expanded()} onExpandedChange={expanded}>
 *   <Tree.Item value="folder-1">
 *     <Tree.Trigger>📁 Folder 1</Tree.Trigger>
 *     <Tree.Content>
 *       <Tree.Item value="file-1">
 *         <Tree.Label>📄 File 1</Tree.Label>
 *       </Tree.Item>
 *     </Tree.Content>
 *   </Tree.Item>
 * </Tree>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import { signal, computed, type WritableSignal, type Signal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface TreeProps {
  children?: any;
  /** Expanded item values */
  expanded?: string[];
  /** Callback when expanded items change */
  onExpandedChange?: (expanded: string[]) => void;
  /** Selected item value */
  selected?: string;
  /** Callback when selected item changes */
  onSelectedChange?: (selected: string) => void;
  /** Default expanded items (uncontrolled) */
  defaultExpanded?: string[];
  /** Default selected item (uncontrolled) */
  defaultSelected?: string;
  [key: string]: any;
}

export interface TreeItemProps {
  children?: any;
  /** Unique value for this item */
  value: string;
  /** Whether item is disabled */
  disabled?: boolean;
  [key: string]: any;
}

export interface TreeTriggerProps {
  children?: any;
  [key: string]: any;
}

export interface TreeContentProps {
  children?: any;
  [key: string]: any;
}

export interface TreeLabelProps {
  children?: any;
  [key: string]: any;
}

interface TreeContextValue {
  expanded: Signal<string[]>;
  selected: Signal<string>;
  isExpanded: (value: string) => boolean;
  isSelected: (value: string) => boolean;
  toggleExpanded: (value: string) => void;
  setSelected: (value: string) => void;
}

interface TreeItemContextValue {
  value: string;
  isExpanded: boolean;
  isSelected: boolean;
  disabled: boolean;
  toggle: () => void;
  select: () => void;
}

// ============================================================================
// Context
// ============================================================================

const TreeContext = createContext<TreeContextValue | undefined>(undefined);
const TreeItemContext = createContext<TreeItemContextValue | undefined>(undefined);

function useTreeContext(): TreeContextValue {
  const context = useContext(TreeContext);
  if (!context) {
    throw new Error('Tree components must be used within Tree');
  }
  return context;
}

function useTreeItemContext(): TreeItemContextValue {
  const context = useContext(TreeItemContext);
  if (!context) {
    throw new Error('Tree.Item components must be used within Tree.Item');
  }
  return context;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Tree Root
 */
export const Tree = defineComponent<TreeProps>((props) => {
  const internalExpanded: WritableSignal<string[]> = signal<string[]>(
    props.defaultExpanded ?? [],
  );
  const internalSelected: WritableSignal<string> = signal<string>(props.defaultSelected ?? '');

  const isExpandedControlled = () => props.expanded !== undefined;
  const currentExpanded = () =>
    isExpandedControlled() ? props.expanded ?? [] : internalExpanded();

  const isSelectedControlled = () => props.selected !== undefined;
  const currentSelected = () =>
    isSelectedControlled() ? props.selected ?? '' : internalSelected();

  const isExpanded = (value: string) => currentExpanded().includes(value);

  const isSelected = (value: string) => currentSelected() === value;

  const toggleExpanded = (value: string) => {
    const expanded = currentExpanded();
    const newExpanded = expanded.includes(value)
      ? expanded.filter((v) => v !== value)
      : [...expanded, value];

    if (!isExpandedControlled()) {
      internalExpanded.set(newExpanded);
    }
    props.onExpandedChange?.(newExpanded);
  };

  const setSelected = (value: string) => {
    if (!isSelectedControlled()) {
      internalSelected.set(value);
    }
    props.onSelectedChange?.(value);
  };

  const contextValue: TreeContextValue = {
    expanded: computed(() => currentExpanded()),
    selected: computed(() => currentSelected()),
    isExpanded,
    isSelected,
    toggleExpanded,
    setSelected,
  };

  return () => {
    const { children } = props;

    return jsx(TreeContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-tree': '',
        role: 'tree',
        'aria-label': 'Tree view',
        children,
      }),
    });
  };
});

/**
 * Tree Item
 */
export const TreeItem = defineComponent<TreeItemProps>((props) => {
  const context = useTreeContext();

  const toggle = () => {
    if (!props.disabled) {
      context.toggleExpanded(props.value);
    }
  };

  const select = () => {
    if (!props.disabled) {
      context.setSelected(props.value);
    }
  };

  const itemContextValue: TreeItemContextValue = {
    value: props.value,
    isExpanded: context.isExpanded(props.value),
    isSelected: context.isSelected(props.value),
    disabled: props.disabled ?? false,
    toggle,
    select,
  };

  return () => {
    const { children, value, disabled } = props;

    return jsx(TreeItemContext.Provider, {
      value: itemContextValue,
      children: jsx('div', {
        'data-tree-item': '',
        'data-value': value,
        'data-expanded': itemContextValue.isExpanded ? '' : undefined,
        'data-selected': itemContextValue.isSelected ? '' : undefined,
        'data-disabled': disabled ? '' : undefined,
        role: 'treeitem',
        'aria-expanded': itemContextValue.isExpanded ? 'true' : 'false',
        'aria-selected': itemContextValue.isSelected ? 'true' : 'false',
        'aria-disabled': disabled ? 'true' : undefined,
        children,
      }),
    });
  };
});

/**
 * Tree Trigger
 * Button to expand/collapse tree item
 */
export const TreeTrigger = defineComponent<TreeTriggerProps>((props) => {
  const itemContext = useTreeItemContext();

  const handleClick = (e: MouseEvent) => {
    if (!itemContext.disabled) {
      itemContext.toggle();
    }
    props.onClick?.(e);
  };

  return () => {
    const { children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      type: 'button',
      'data-tree-trigger': '',
      'data-state': itemContext.isExpanded ? 'open' : 'closed',
      'aria-expanded': itemContext.isExpanded,
      disabled: itemContext.disabled,
      onClick: handleClick,
      children,
    });
  };
});

/**
 * Tree Content
 * Collapsible content for tree item children
 */
export const TreeContent = defineComponent<TreeContentProps>((props) => () => {
  const itemContext = useTreeItemContext();
  const { children, ...restProps } = props;

  if (!itemContext.isExpanded) {
    return null;
  }

  return jsx('div', {
    ...restProps,
    'data-tree-content': '',
    'data-state': 'open',
    role: 'group',
    children,
  });
});

/**
 * Tree Label
 * Selectable label for leaf tree items
 */
export const TreeLabel = defineComponent<TreeLabelProps>((props) => {
  const itemContext = useTreeItemContext();

  const handleClick = (e: MouseEvent) => {
    if (!itemContext.disabled) {
      itemContext.select();
    }
    props.onClick?.(e);
  };

  return () => {
    const { children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-tree-label': '',
      'data-selected': itemContext.isSelected ? '' : undefined,
      tabIndex: itemContext.disabled ? undefined : 0,
      onClick: handleClick,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Tree as any).Item = TreeItem;
(Tree as any).Trigger = TreeTrigger;
(Tree as any).Content = TreeContent;
(Tree as any).Label = TreeLabel;

// ============================================================================
// Type augmentation
// ============================================================================

export interface TreeComponent {
  (props: TreeProps): any;
  Item: typeof TreeItem;
  Trigger: typeof TreeTrigger;
  Content: typeof TreeContent;
  Label: typeof TreeLabel;
}
