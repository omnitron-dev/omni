/**
 * Styled TagsInput Component
 *
 * A tag/chip input field component.
 * Built on top of the TagsInput primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { TagsInput as TagsInputPrimitive } from '../../primitives/TagsInput.js';

/**
 * TagsInput - Tag/chip input field
 *
 * @example
 * ```tsx
 * <TagsInput
 *   value={tags}
 *   onValueChange={setTags}
 *   placeholder="Add tags..."
 *   size="md"
 * />
 * ```
 */
export const TagsInput = styled(TagsInputPrimitive, {
  base: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.375rem',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    backgroundColor: '#ffffff',
    minHeight: '2.5rem',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:focus-within': {
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
    },
    '&:hover:not([data-disabled])': {
      borderColor: '#d1d5db',
    },
    '&[data-disabled]': {
      backgroundColor: '#f9fafb',
      cursor: 'not-allowed',
    },
    '& [data-tag]': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.25rem',
      padding: '0.25rem 0.5rem',
      borderRadius: '0.25rem',
      backgroundColor: '#eff6ff',
      color: '#3b82f6',
      fontSize: '0.875rem',
      fontWeight: '500',
    },
    '& input': {
      flex: '1',
      minWidth: '120px',
      border: 'none',
      outline: 'none',
      backgroundColor: 'transparent',
      fontSize: '1rem',
      padding: '0.25rem 0.5rem',
      '&::placeholder': {
        color: '#9ca3af',
      },
    },
  },
  variants: {
    size: {
      sm: {
        minHeight: '2rem',
        '& [data-tag]': {
          padding: '0.125rem 0.375rem',
          fontSize: '0.75rem',
        },
        '& input': {
          fontSize: '0.875rem',
        },
      },
      md: {
        minHeight: '2.5rem',
        '& [data-tag]': {
          padding: '0.25rem 0.5rem',
          fontSize: '0.875rem',
        },
        '& input': {
          fontSize: '1rem',
        },
      },
      lg: {
        minHeight: '3rem',
        '& [data-tag]': {
          padding: '0.375rem 0.625rem',
          fontSize: '1rem',
        },
        '& input': {
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
(TagsInput as any).displayName = 'TagsInput';
