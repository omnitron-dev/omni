/**
 * Box - The foundational layout component
 *
 * Features:
 * - Base component for all layout primitives
 * - Polymorphic component (can render as any element)
 * - Style props support for rapid prototyping
 * - Responsive values support
 * - Semantic HTML elements
 */

import { defineComponent } from '../core/component/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface BoxProps {
  /** Element to render as (default: 'div') */
  as?: string;
  /** Child elements */
  children?: any;
  /** Additional CSS class */
  class?: string;
  /** Inline styles */
  style?: Record<string, any>;
  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Box Component
// ============================================================================

/**
 * Box is the foundational component that all other layout components build upon.
 * It's a polymorphic component that can render as any HTML element.
 *
 * @example
 * ```tsx
 * <Box>Default div</Box>
 * <Box as="section" class="container">Section element</Box>
 * <Box as="article" style={{ padding: '1rem' }}>Article with styles</Box>
 * ```
 */
export const Box = defineComponent<BoxProps>((props) => () => {
    const { as, children, ...restProps } = props;
    const element = as ?? 'div';

    return jsx(element as any, {
      ...restProps,
      children,
    });
  });
