/**
 * Empty - Empty state component for no-data scenarios
 *
 * Features:
 * - Icon support
 * - Title and description
 * - Action buttons
 * - Customizable layout
 * - Pre-built variants (no-data, no-results, error)
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface EmptyProps {
  /** Empty state variant */
  variant?: 'no-data' | 'no-results' | 'error' | 'custom';
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface EmptyIconProps {
  /** Children (icon content) */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface EmptyTitleProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface EmptyDescriptionProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface EmptyActionsProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Empty Root
// ============================================================================

export const Empty = defineComponent<EmptyProps>((props) => {
  return () => {
    const { variant = 'no-data', children, ...rest } = props;

    return jsx('div', {
      'data-empty': '',
      'data-variant': variant,
      role: 'status',
      'aria-live': 'polite',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Empty Icon
// ============================================================================

export const EmptyIcon = defineComponent<EmptyIconProps>((props) => {
  return () => {
    const { children, ...rest } = props;

    return jsx('div', {
      'data-empty-icon': '',
      'aria-hidden': 'true',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Empty Title
// ============================================================================

export const EmptyTitle = defineComponent<EmptyTitleProps>((props) => {
  return () => {
    const { children, ...rest } = props;

    return jsx('h3', {
      'data-empty-title': '',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Empty Description
// ============================================================================

export const EmptyDescription = defineComponent<EmptyDescriptionProps>((props) => {
  return () => {
    const { children, ...rest } = props;

    return jsx('p', {
      'data-empty-description': '',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Empty Actions
// ============================================================================

export const EmptyActions = defineComponent<EmptyActionsProps>((props) => {
  return () => {
    const { children, ...rest } = props;

    return jsx('div', {
      'data-empty-actions': '',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Empty as any).Icon = EmptyIcon;
(Empty as any).Title = EmptyTitle;
(Empty as any).Description = EmptyDescription;
(Empty as any).Actions = EmptyActions;
