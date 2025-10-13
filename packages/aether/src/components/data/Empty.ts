/**
 * Empty Component (Styled)
 *
 * A styled empty state component for no-data scenarios:
 * - Multiple size variants
 * - Icon, title, description, and actions
 * - Centered layout with proper spacing
 */

import { styled } from '../../styling/styled.js';
import {
  Empty as EmptyPrimitive,
  EmptyIcon as EmptyIconPrimitive,
  EmptyTitle as EmptyTitlePrimitive,
  EmptyDescription as EmptyDescriptionPrimitive,
  EmptyActions as EmptyActionsPrimitive,
  type EmptyProps as EmptyPrimitiveProps,
  type EmptyIconProps,
  type EmptyTitleProps,
  type EmptyDescriptionProps,
  type EmptyActionsProps,
} from '../../primitives/Empty.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * Empty Root - Styled empty state container
 */
export const Empty = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  EmptyPrimitiveProps
>(EmptyPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '2rem',
  },
  variants: {
    size: {
      sm: {
        padding: '1.5rem',
        gap: '0.75rem',
      },
      md: {
        padding: '2rem',
        gap: '1rem',
      },
      lg: {
        padding: '3rem',
        gap: '1.5rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Empty Icon - Styled empty state icon
 */
export const EmptyIcon = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  EmptyIconProps
>(EmptyIconPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#9ca3af',
    marginBottom: '0.5rem',
  },
  variants: {
    size: {
      sm: {
        width: '3rem',
        height: '3rem',
        fontSize: '3rem',
      },
      md: {
        width: '4rem',
        height: '4rem',
        fontSize: '4rem',
      },
      lg: {
        width: '5rem',
        height: '5rem',
        fontSize: '5rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Empty Title - Styled empty state title
 */
export const EmptyTitle = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  EmptyTitleProps
>(EmptyTitlePrimitive, {
  base: {
    fontWeight: '600',
    color: '#111827',
    marginBottom: '0.5rem',
  },
  variants: {
    size: {
      sm: {
        fontSize: '1rem',
      },
      md: {
        fontSize: '1.125rem',
      },
      lg: {
        fontSize: '1.25rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Empty Description - Styled empty state description
 */
export const EmptyDescription = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  EmptyDescriptionProps
>(EmptyDescriptionPrimitive, {
  base: {
    color: '#6b7280',
    lineHeight: '1.5',
    maxWidth: '28rem',
    marginBottom: '1rem',
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
 * Empty Actions - Styled empty state actions container
 */
export const EmptyActions = styled(EmptyActionsPrimitive, {
  base: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Empty as any).Icon = EmptyIcon;
(Empty as any).Title = EmptyTitle;
(Empty as any).Description = EmptyDescription;
(Empty as any).Actions = EmptyActions;

// ============================================================================
// Display names
// ============================================================================

Empty.displayName = 'Empty';
EmptyIcon.displayName = 'Empty.Icon';
EmptyTitle.displayName = 'Empty.Title';
EmptyDescription.displayName = 'Empty.Description';
EmptyActions.displayName = 'Empty.Actions';

// ============================================================================
// Type exports
// ============================================================================

export type {
  EmptyPrimitiveProps as EmptyProps,
  EmptyIconProps,
  EmptyTitleProps,
  EmptyDescriptionProps,
  EmptyActionsProps,
};
