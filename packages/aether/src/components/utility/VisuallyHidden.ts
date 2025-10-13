/**
 * Styled VisuallyHidden Component
 *
 * Screen reader only content - hidden visually but accessible to screen readers.
 * Built on top of the VisuallyHidden primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import { VisuallyHidden as VisuallyHiddenPrimitive, type VisuallyHiddenProps as VisuallyHiddenPrimitiveProps } from '../../primitives/VisuallyHidden.js';

/**
 * VisuallyHidden - Screen reader only content
 *
 * @example
 * ```tsx
 * <VisuallyHidden>This text is only for screen readers</VisuallyHidden>
 * ```
 */
export const VisuallyHidden = styled(VisuallyHiddenPrimitive, {
  base: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: '0',
  },
});

// Display name
VisuallyHidden.displayName = 'VisuallyHidden';

// Type exports
export type { VisuallyHiddenPrimitiveProps as VisuallyHiddenProps };
