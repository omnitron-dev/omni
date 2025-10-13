/**
 * Styled Affix Component
 *
 * Sticky positioning helper that fixes elements to viewport.
 * Built on top of the Affix primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Affix as AffixPrimitive, type AffixProps as AffixPrimitiveProps } from '../../primitives/Affix.js';

/**
 * Affix - Sticky positioned element
 *
 * @example
 * ```tsx
 * <Affix position="top" offset={10}>
 *   <Header>Sticky header</Header>
 * </Affix>
 * ```
 */
export const Affix = styled<{
  position?: 'top' | 'bottom' | 'left' | 'right';
  zIndex?: 'low' | 'medium' | 'high';
}>(AffixPrimitive, {
  base: {
    position: 'sticky',
  },
  variants: {
    position: {
      top: {
        top: '0',
      },
      bottom: {
        bottom: '0',
      },
      left: {
        left: '0',
      },
      right: {
        right: '0',
      },
    },
    zIndex: {
      low: {
        zIndex: '10',
      },
      medium: {
        zIndex: '20',
      },
      high: {
        zIndex: '30',
      },
    },
  },
  defaultVariants: {
    position: 'top',
    zIndex: 'medium',
  },
});

// Display name
Affix.displayName = 'Affix';

// Type exports
export type { AffixPrimitiveProps as AffixProps };
