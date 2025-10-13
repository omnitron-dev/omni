/**
 * Styled Textarea Component
 *
 * A styled textarea with auto-resize support and variants.
 * Built on top of the Textarea primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Textarea as TextareaPrimitive } from '../../primitives/Textarea.js';

/**
 * Textarea - Enhanced textarea with styling and auto-resize
 *
 * @example
 * ```tsx
 * <Textarea
 *   placeholder="Enter your message"
 *   autoResize
 *   minRows={3}
 *   maxRows={10}
 *   size="md"
 * />
 * ```
 */
export const Textarea = styled(TextareaPrimitive, {
  base: {
    width: '100%',
    padding: '0.5rem 1rem',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    fontSize: '1rem',
    lineHeight: '1.5',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    backgroundColor: '#ffffff',
    color: '#111827',
    fontFamily: 'inherit',
    resize: 'vertical',
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
    '&[data-invalid]': {
      borderColor: '#ef4444',
    },
    '&[data-invalid]:focus': {
      borderColor: '#ef4444',
      boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.1)',
    },
    '&[data-autoresize]': {
      resize: 'none',
      overflow: 'hidden',
    },
    '&::placeholder': {
      color: '#9ca3af',
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.375rem 0.75rem',
        fontSize: '0.875rem',
        borderRadius: '0.25rem',
      },
      md: {
        padding: '0.5rem 1rem',
        fontSize: '1rem',
        borderRadius: '0.375rem',
      },
      lg: {
        padding: '0.625rem 1.25rem',
        fontSize: '1.125rem',
        borderRadius: '0.5rem',
      },
    },
    variant: {
      outline: {
        border: '1px solid #e5e7eb',
        backgroundColor: '#ffffff',
      },
      filled: {
        backgroundColor: '#f3f4f6',
        border: '1px solid transparent',
        '&:hover:not(:disabled)': {
          backgroundColor: '#e5e7eb',
        },
        '&:focus': {
          backgroundColor: '#ffffff',
          borderColor: '#3b82f6',
        },
      },
      unstyled: {
        border: 'none',
        padding: '0',
        backgroundColor: 'transparent',
        '&:focus': {
          boxShadow: 'none',
        },
      },
    },
    status: {
      error: {
        borderColor: '#ef4444',
        '&:focus': {
          borderColor: '#ef4444',
          boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.1)',
        },
      },
      success: {
        borderColor: '#10b981',
        '&:focus': {
          borderColor: '#10b981',
          boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.1)',
        },
      },
      warning: {
        borderColor: '#f59e0b',
        '&:focus': {
          borderColor: '#f59e0b',
          boxShadow: '0 0 0 3px rgba(245, 158, 11, 0.1)',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'outline',
  },
});

// Attach display name
(Textarea as any).displayName = 'Textarea';
