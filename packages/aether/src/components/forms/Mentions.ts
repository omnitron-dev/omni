/**
 * Styled Mentions Component
 *
 * An @mention input support component.
 * Built on top of the Mentions primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Mentions as MentionsPrimitive } from '../../primitives/Mentions.js';

/**
 * Mentions - @mention input support
 *
 * @example
 * ```tsx
 * <Mentions
 *   value={text}
 *   onValueChange={setText}
 *   suggestions={users}
 *   size="md"
 * />
 * ```
 */
export const Mentions = styled(MentionsPrimitive, {
  base: {
    position: 'relative',
    width: '100%',
    '& [data-mentions-input]': {
      width: '100%',
      padding: '0.5rem 1rem',
      borderRadius: '0.375rem',
      border: '1px solid #e5e7eb',
      fontSize: '1rem',
      lineHeight: '1.5',
      backgroundColor: '#ffffff',
      color: '#111827',
      resize: 'vertical',
      fontFamily: 'inherit',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      '&:focus': {
        outline: 'none',
        borderColor: '#3b82f6',
        boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
      },
      '&:hover:not(:disabled)': {
        borderColor: '#d1d5db',
      },
      '&:disabled': {
        backgroundColor: '#f9fafb',
        color: '#9ca3af',
        cursor: 'not-allowed',
      },
    },
    '& [data-mentions-dropdown]': {
      position: 'absolute',
      zIndex: 50,
      width: '100%',
      marginTop: '0.25rem',
      backgroundColor: '#ffffff',
      borderRadius: '0.375rem',
      border: '1px solid #e5e7eb',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      maxHeight: '200px',
      overflowY: 'auto',
    },
    '& [data-mention-item]': {
      padding: '0.5rem 0.75rem',
      cursor: 'pointer',
      fontSize: '0.875rem',
      transition: 'background-color 0.15s',
      '&[data-highlighted]': {
        backgroundColor: '#f3f4f6',
      },
      '&[data-selected]': {
        backgroundColor: '#eff6ff',
        color: '#3b82f6',
      },
    },
  },
  variants: {
    size: {
      sm: {
        '& [data-mentions-input]': {
          padding: '0.375rem 0.75rem',
          fontSize: '0.875rem',
        },
      },
      md: {
        '& [data-mentions-input]': {
          padding: '0.5rem 1rem',
          fontSize: '1rem',
        },
      },
      lg: {
        '& [data-mentions-input]': {
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
(Mentions as any).displayName = 'Mentions';
