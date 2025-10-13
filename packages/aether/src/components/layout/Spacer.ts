/**
 * Spacer - Styled flexible space component
 *
 * A styled version of the Spacer primitive for creating
 * flexible space in flex layouts.
 */

import { styled } from '../../styling/styled.js';
import { Spacer as SpacerPrimitive } from '../../primitives/Spacer.js';

/**
 * Styled Spacer component for flex layouts
 *
 * @example
 * ```tsx
 * // Push items to edges
 * <Flex>
 *   <button>Left</button>
 *   <Spacer />
 *   <button>Right</button>
 * </Flex>
 *
 * // Multiple spacers
 * <Flex>
 *   <div>Start</div>
 *   <Spacer />
 *   <div>Middle</div>
 *   <Spacer />
 *   <div>End</div>
 * </Flex>
 *
 * // Custom grow value
 * <Flex>
 *   <div>Item 1</div>
 *   <Spacer grow={2} />
 *   <div>Item 2</div>
 * </Flex>
 * ```
 */
export const Spacer = styled(SpacerPrimitive, {
  base: {
    flex: '1 0 auto',
    alignSelf: 'stretch',
    justifySelf: 'stretch',
  },
  variants: {
    // Spacer typically doesn't need variants, but we can add some for consistency
    minWidth: {
      none: { minWidth: '0' },
      xs: { minWidth: '0.25rem' },
      sm: { minWidth: '0.5rem' },
      md: { minWidth: '1rem' },
      lg: { minWidth: '1.5rem' },
      xl: { minWidth: '2rem' },
    },
    minHeight: {
      none: { minHeight: '0' },
      xs: { minHeight: '0.25rem' },
      sm: { minHeight: '0.5rem' },
      md: { minHeight: '1rem' },
      lg: { minHeight: '1.5rem' },
      xl: { minHeight: '2rem' },
    },
  },
});

export type { SpacerProps } from '../../primitives/Spacer.js';
