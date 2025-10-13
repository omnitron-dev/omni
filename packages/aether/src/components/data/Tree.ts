/**
 * Tree Component (Styled)
 *
 * A styled tree component for displaying hierarchical data:
 * - Indentation for hierarchy
 * - Interactive expand/collapse
 * - Selection states
 * - Size variants
 */

import { styled } from '../../styling/styled.js';
import {
  Tree as TreePrimitive,
  TreeItem as TreeItemPrimitive,
  TreeTrigger as TreeTriggerPrimitive,
  TreeContent as TreeContentPrimitive,
  TreeLabel as TreeLabelPrimitive,
  type TreeProps as TreePrimitiveProps,
  type TreeItemProps,
  type TreeTriggerProps,
  type TreeContentProps,
  type TreeLabelProps,
} from '../../primitives/Tree.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * Tree Root - Styled tree container
 */
export const Tree = styled<
  TreePrimitiveProps & {
    size?: 'sm' | 'md' | 'lg';
  }
>(TreePrimitive, {
  base: {
    width: '100%',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.875rem',
      },
      md: {
        fontSize: '0.875rem',
      },
      lg: {
        fontSize: '1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Tree Item - Styled tree item
 */
export const TreeItem = styled<
  TreeItemProps & {
    indent?: boolean;
  }
>(TreeItemPrimitive, {
  base: {
    display: 'block',
  },
  variants: {
    indent: {
      true: {
        paddingLeft: '1.5rem',
      },
      false: {},
    },
  },
  defaultVariants: {
    indent: true,
  },
});

/**
 * Tree Trigger - Styled tree expand/collapse trigger
 */
export const TreeTrigger = styled<
  TreeTriggerProps & {
    size?: 'sm' | 'md' | 'lg';
  }
>(TreeTriggerPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    width: '100%',
    padding: '0.5rem',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#111827',
    borderRadius: '0.375rem',
    transition: 'all 0.15s ease',
    textAlign: 'left',
    fontWeight: '500',
  },
  variants: {
    size: {
      sm: {
        padding: '0.375rem',
        fontSize: '0.75rem',
      },
      md: {
        padding: '0.5rem',
        fontSize: '0.875rem',
      },
      lg: {
        padding: '0.625rem',
        fontSize: '1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Tree Content - Styled tree content (children)
 */
export const TreeContent = styled(TreeContentPrimitive, {
  base: {
    paddingLeft: '1rem',
    marginTop: '0.25rem',
  },
});

/**
 * Tree Label - Styled tree label (leaf node)
 */
export const TreeLabel = styled<
  TreeLabelProps & {
    size?: 'sm' | 'md' | 'lg';
  }
>(TreeLabelPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem',
    cursor: 'pointer',
    color: '#111827',
    borderRadius: '0.375rem',
    transition: 'all 0.15s ease',
  },
  variants: {
    size: {
      sm: {
        padding: '0.375rem',
        fontSize: '0.75rem',
      },
      md: {
        padding: '0.5rem',
        fontSize: '0.875rem',
      },
      lg: {
        padding: '0.625rem',
        fontSize: '1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Tree as any).Item = TreeItem;
(Tree as any).Trigger = TreeTrigger;
(Tree as any).Content = TreeContent;
(Tree as any).Label = TreeLabel;

// ============================================================================
// Display names
// ============================================================================

Tree.displayName = 'Tree';
TreeItem.displayName = 'Tree.Item';
TreeTrigger.displayName = 'Tree.Trigger';
TreeContent.displayName = 'Tree.Content';
TreeLabel.displayName = 'Tree.Label';

// ============================================================================
// Type exports
// ============================================================================

export type { TreePrimitiveProps as TreeProps, TreeItemProps, TreeTriggerProps, TreeContentProps, TreeLabelProps };
