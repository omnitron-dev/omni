/**
 * Styled Editable Component
 *
 * An inline editable text component.
 * Built on top of the Editable primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Editable as EditablePrimitive } from '../../primitives/Editable.js';

/**
 * Editable - Inline editable text
 *
 * @example
 * ```tsx
 * <Editable
 *   value={text}
 *   onValueChange={setText}
 *   placeholder="Click to edit..."
 *   size="md"
 * />
 * ```
 */
export const Editable = styled(EditablePrimitive, {
  base: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    minWidth: '120px',
    '&[data-editing="false"]': {
      cursor: 'text',
      padding: '0.25rem 0.5rem',
      borderRadius: '0.25rem',
      transition: 'background-color 0.15s',
      '&:hover': {
        backgroundColor: '#f3f4f6',
      },
    },
    '&[data-editing="true"] input, &[data-editing="true"] textarea': {
      width: '100%',
      padding: '0.5rem 1rem',
      borderRadius: '0.375rem',
      border: '1px solid #e5e7eb',
      fontSize: '1rem',
      lineHeight: '1.5',
      backgroundColor: '#ffffff',
      color: '#111827',
      fontFamily: 'inherit',
      '&:focus': {
        outline: 'none',
        borderColor: '#3b82f6',
        boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
      },
    },
    '&[data-placeholder]': {
      color: '#9ca3af',
    },
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.875rem',
        '&[data-editing="true"] input, &[data-editing="true"] textarea': {
          padding: '0.375rem 0.75rem',
          fontSize: '0.875rem',
        },
      },
      md: {
        fontSize: '1rem',
        '&[data-editing="true"] input, &[data-editing="true"] textarea': {
          padding: '0.5rem 1rem',
          fontSize: '1rem',
        },
      },
      lg: {
        fontSize: '1.125rem',
        '&[data-editing="true"] input, &[data-editing="true"] textarea': {
          padding: '0.625rem 1.25rem',
          fontSize: '1.125rem',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Attach display name
(Editable as any).displayName = 'Editable';
