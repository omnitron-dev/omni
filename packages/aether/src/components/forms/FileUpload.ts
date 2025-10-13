/**
 * Styled FileUpload Component
 *
 * A drag-and-drop file upload component.
 * Built on top of the FileUpload primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { FileUpload as FileUploadPrimitive } from '../../primitives/FileUpload.js';

/**
 * FileUpload - Drag & drop file upload
 *
 * @example
 * ```tsx
 * <FileUpload
 *   onFilesChange={handleFiles}
 *   accept="image/*"
 *   multiple
 *   size="md"
 * />
 * ```
 */
export const FileUpload = styled(FileUploadPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '2rem',
    borderRadius: '0.5rem',
    border: '2px dashed #d1d5db',
    backgroundColor: '#f9fafb',
    color: '#6b7280',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background-color 0.2s',
    '&:hover:not([data-disabled])': {
      borderColor: '#9ca3af',
      backgroundColor: '#f3f4f6',
    },
    '&[data-dragging]': {
      borderColor: '#3b82f6',
      backgroundColor: '#eff6ff',
      color: '#3b82f6',
    },
    '&[data-disabled]': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  variants: {
    size: {
      sm: {
        padding: '1.5rem',
        fontSize: '0.875rem',
      },
      md: {
        padding: '2rem',
        fontSize: '1rem',
      },
      lg: {
        padding: '2.5rem',
        fontSize: '1.125rem',
      },
    },
    variant: {
      default: {
        border: '2px dashed #d1d5db',
        backgroundColor: '#f9fafb',
      },
      solid: {
        border: '1px solid #e5e7eb',
        backgroundColor: '#ffffff',
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'default',
  },
});

// Attach display name
(FileUpload as any).displayName = 'FileUpload';
