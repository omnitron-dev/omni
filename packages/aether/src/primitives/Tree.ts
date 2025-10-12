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
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, computed, effect, type WritableSignal, type Signal } from '../core/reactivity/index.js';
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
  isExpanded: Signal<boolean>;
  isSelected: Signal<boolean>;
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
  const internalExpanded: WritableSignal<string[]> = signal<string[]>(props.defaultExpanded ?? []);
  const internalSelected: WritableSignal<string> = signal<string>(props.defaultSelected ?? '');

  const isExpandedControlled = () => props.expanded !== undefined;
  const currentExpanded = () => (isExpandedControlled() ? (props.expanded ?? []) : internalExpanded());

  const isSelectedControlled = () => props.selected !== undefined;
  const currentSelected = () => (isSelectedControlled() ? (props.selected ?? '') : internalSelected());

  const isExpanded = (value: string) => currentExpanded().includes(value);

  const isSelected = (value: string) => currentSelected() === value;

  const toggleExpanded = (value: string) => {
    const expanded = currentExpanded();
    const newExpanded = expanded.includes(value) ? expanded.filter((v) => v !== value) : [...expanded, value];

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

  // Provide context during setup phase (Pattern 17)
  provideContext(TreeContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', {
      'data-tree': '',
      role: 'tree',
      'aria-label': 'Tree view',
      children,
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

  // Create reactive signals for expanded and selected states
  // Read from signal directly for proper reactivity
  const isExpanded = computed(() => context.expanded().includes(props.value));
  const isSelected = computed(() => context.selected() === props.value);

  const itemContextValue: TreeItemContextValue = {
    value: props.value,
    isExpanded,
    isSelected,
    disabled: props.disabled ?? false,
    toggle,
    select,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(TreeItemContext, itemContextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;
    const { value, disabled } = props;

    const element = jsx('div', {
      'data-tree-item': '',
      'data-value': value,
      'data-disabled': disabled ? '' : undefined,
      role: 'treeitem',
      'aria-disabled': disabled ? 'true' : undefined,
      children,
    }) as HTMLElement;

    // Pattern 18: Apply reactive attributes with effects
    effect(() => {
      const expanded = isExpanded();
      if (expanded) {
        element.setAttribute('data-expanded', '');
        element.setAttribute('aria-expanded', 'true');
      } else {
        element.removeAttribute('data-expanded');
        element.setAttribute('aria-expanded', 'false');
      }
    });

    effect(() => {
      const selected = isSelected();
      if (selected) {
        element.setAttribute('data-selected', '');
        element.setAttribute('aria-selected', 'true');
      } else {
        element.removeAttribute('data-selected');
        element.setAttribute('aria-selected', 'false');
      }
    });

    return element;
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

    const element = jsx('button', {
      ...restProps,
      type: 'button',
      'data-tree-trigger': '',
      disabled: itemContext.disabled,
      onClick: handleClick,
      children,
    }) as HTMLButtonElement;

    // Pattern 18: Apply reactive attributes with effects
    effect(() => {
      const expanded = itemContext.isExpanded();
      element.setAttribute('data-state', expanded ? 'open' : 'closed');
      element.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });

    return element;
  };
});

/**
 * Tree Content
 * Collapsible content for tree item children
 */
export const TreeContent = defineComponent<TreeContentProps>((props) => {
  const itemContext = useTreeItemContext();

  return () => {
    const { children, ...restProps } = props;

    // Evaluate function children during render
    const evaluatedChildren = typeof children === 'function' ? children() : children;

    const element = jsx('div', {
      ...restProps,
      'data-tree-content': '',
      'data-state': 'open',
      role: 'group',
      children: evaluatedChildren,
    }) as HTMLElement;

    // Pattern 18: Visibility toggle instead of conditional rendering
    // This ensures the element exists for tests to query
    effect(() => {
      const expanded = itemContext.isExpanded();
      element.style.display = expanded ? 'block' : 'none';
      element.setAttribute('data-state', expanded ? 'open' : 'closed');
      element.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    });

    return element;
  };
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

    const element = jsx('div', {
      ...restProps,
      'data-tree-label': '',
      tabIndex: itemContext.disabled ? undefined : 0,
      onClick: handleClick,
      children,
    }) as HTMLElement;

    // Pattern 18: Apply reactive attributes with effects
    effect(() => {
      const selected = itemContext.isSelected();
      if (selected) {
        element.setAttribute('data-selected', '');
      } else {
        element.removeAttribute('data-selected');
      }
    });

    return element;
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
