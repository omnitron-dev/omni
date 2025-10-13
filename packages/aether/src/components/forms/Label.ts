/**
 * Styled Label Component
 *
 * A styled label for form controls.
 * Built on top of the Label primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Label as LabelPrimitive } from '../../primitives/Label.js';

/**
 * Label - Styled form label
 *
 * @example
 * ```tsx
 * <Label for="email" size="md" weight="medium">
 *   Email Address
 * </Label>
 * <Input id="email" type="email" />
 * ```
 */
export const Label = styled(LabelPrimitive, {
  base: {
    display: 'inline-block',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '0.5rem',
    cursor: 'pointer',
    userSelect: 'none',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.75rem',
        marginBottom: '0.375rem',
      },
      md: {
        fontSize: '0.875rem',
        marginBottom: '0.5rem',
      },
      lg: {
        fontSize: '1rem',
        marginBottom: '0.625rem',
      },
    },
    weight: {
      normal: {
        fontWeight: '400',
      },
      medium: {
        fontWeight: '500',
      },
      semibold: {
        fontWeight: '600',
      },
      bold: {
        fontWeight: '700',
      },
    },
    required: {
      true: {
        '&::after': {
          content: '"*"',
          marginLeft: '0.25rem',
          color: '#ef4444',
        },
      },
    },
    disabled: {
      true: {
        color: '#9ca3af',
        cursor: 'not-allowed',
      },
    },
  },
  defaultVariants: {
    size: 'md',
    weight: 'medium',
  },
});

// Attach display name
(Label as any).displayName = 'Label';
