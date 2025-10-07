/**
 * VisuallyHidden Component
 *
 * Hides content visually while keeping it accessible to screen readers.
 *
 * @example
 * ```tsx
 * <button>
 *   <VisuallyHidden>Close dialog</VisuallyHidden>
 *   <XIcon />
 * </button>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';

export interface VisuallyHiddenProps {
  /**
   * Children content
   */
  children?: any;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

/**
 * VisuallyHidden
 *
 * Hides content visually but keeps it accessible to assistive technologies.
 *
 * Features:
 * - Visually hidden using CSS clip technique
 * - Accessible to screen readers
 * - Maintains document flow
 * - Focusable when interactive
 *
 * Use cases:
 * - Icon-only buttons with accessible labels
 * - Skip navigation links
 * - Additional context for screen readers
 * - Form labels that should be hidden visually
 */
export const VisuallyHidden = defineComponent<VisuallyHiddenProps>((props) => () => {
  const { children, style, ...restProps } = props;

  return jsx('span', {
    ...restProps,
    'data-visually-hidden': '',
    style: {
      // Visually hide but keep accessible
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      borderWidth: '0',
      ...style,
    },
    children,
  });
});

// Attach display name
VisuallyHidden.displayName = 'VisuallyHidden';
