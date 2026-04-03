'use client';

/**
 * Field.Editor Component
 *
 * Rich text editor with React Hook Form integration.
 * Provides both a basic textarea fallback and a headless API for custom editors (TipTap, etc.)
 *
 * @module @omnitron-dev/prism/components/field
 */

import type { ReactNode, ComponentProps, ReactElement } from 'react';
import { Controller, useFormContext, type RegisterOptions } from 'react-hook-form';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Toolbar configuration for the editor.
 */
export interface EditorToolbarConfig {
  /** Enable bold formatting */
  bold?: boolean;
  /** Enable italic formatting */
  italic?: boolean;
  /** Enable underline formatting */
  underline?: boolean;
  /** Enable strikethrough formatting */
  strikethrough?: boolean;
  /** Enable heading levels */
  headings?: boolean | number[];
  /** Enable bullet list */
  bulletList?: boolean;
  /** Enable numbered list */
  orderedList?: boolean;
  /** Enable blockquote */
  blockquote?: boolean;
  /** Enable code block */
  codeBlock?: boolean;
  /** Enable link insertion */
  link?: boolean;
  /** Enable image insertion */
  image?: boolean;
  /** Enable text alignment */
  align?: boolean;
  /** Enable undo/redo */
  history?: boolean;
}

/**
 * Props passed to custom editor render function.
 */
export interface EditorRenderProps {
  /** Current HTML content */
  value: string;
  /** Update handler - call with new HTML content */
  onChange: (html: string) => void;
  /** Blur handler for form validation */
  onBlur: () => void;
  /** Error state */
  error: boolean;
  /** Field name */
  name: string;
  /** Disabled state */
  disabled?: boolean;
  /** Read-only state */
  readOnly?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Toolbar configuration */
  toolbar?: EditorToolbarConfig;
  /** Minimum height */
  minHeight?: number | string;
  /** Maximum height */
  maxHeight?: number | string;
  /** Custom CSS class */
  className?: string;
  /** Aria label for accessibility */
  'aria-label'?: string;
  /** Aria described-by for error messages */
  'aria-describedby'?: string;
}

/**
 * Props for Field.Editor component.
 */
export interface FieldEditorProps {
  /** Field name in the form */
  name: string;
  /** Field label */
  label?: string;
  /** Helper text displayed below the editor */
  helperText?: ReactNode;
  /** Validation rules for react-hook-form */
  rules?: RegisterOptions;
  /** Placeholder text */
  placeholder?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Read-only state */
  readOnly?: boolean;
  /** Toolbar configuration */
  toolbar?: EditorToolbarConfig;
  /** Minimum height */
  minHeight?: number | string;
  /** Maximum height */
  maxHeight?: number | string;
  /** Required field indicator */
  required?: boolean;
  /** Full width */
  fullWidth?: boolean;
  /** Custom editor render function (for TipTap, etc.) */
  renderEditor?: (props: EditorRenderProps) => ReactElement;
  /** Additional props for the wrapper Box */
  sx?: ComponentProps<typeof Box>['sx'];
  /** Aria label for accessibility */
  'aria-label'?: string;
}

/**
 * Default toolbar configuration.
 */
export const DEFAULT_EDITOR_TOOLBAR: EditorToolbarConfig = {
  bold: true,
  italic: true,
  underline: true,
  headings: [1, 2, 3],
  bulletList: true,
  orderedList: true,
  link: true,
  history: true,
};

// =============================================================================
// BASIC EDITOR (FALLBACK)
// =============================================================================

/**
 * Basic textarea-based editor as fallback.
 */
function BasicEditor({
  value,
  onChange,
  onBlur,
  error,
  name,
  disabled,
  readOnly,
  placeholder,
  minHeight = 200,
  maxHeight,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: EditorRenderProps): ReactNode {
  return (
    <TextField
      multiline
      fullWidth
      minRows={6}
      maxRows={maxHeight ? 20 : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      error={error}
      disabled={disabled}
      slotProps={{
        input: {
          readOnly,
        },
        htmlInput: {
          'aria-label': ariaLabel || name,
          'aria-describedby': ariaDescribedBy,
        },
      }}
      placeholder={placeholder}
      sx={{
        '& .MuiOutlinedInput-root': {
          minHeight,
          maxHeight,
          alignItems: 'flex-start',
        },
        '& .MuiInputBase-input': {
          resize: 'vertical',
        },
      }}
    />
  );
}

// =============================================================================
// FIELD.EDITOR COMPONENT
// =============================================================================

/**
 * Field.Editor - Rich text editor with React Hook Form integration.
 *
 * Supports both a basic textarea fallback and custom editor implementations.
 *
 * @example
 * ```tsx
 * // Basic usage (textarea fallback)
 * <FormProvider {...methods}>
 *   <Field.Editor
 *     name="content"
 *     label="Article Content"
 *     placeholder="Write your article..."
 *     minHeight={300}
 *   />
 * </FormProvider>
 *
 * // With custom TipTap editor
 * <Field.Editor
 *   name="content"
 *   label="Article Content"
 *   renderEditor={({ value, onChange, onBlur, error }) => (
 *     <TipTapEditor
 *       content={value}
 *       onUpdate={({ editor }) => onChange(editor.getHTML())}
 *       onBlur={onBlur}
 *       editorProps={{
 *         attributes: {
 *           class: error ? 'editor-error' : '',
 *         },
 *       }}
 *     />
 *   )}
 * />
 * ```
 */
export function FieldEditor({
  name,
  label,
  helperText,
  rules,
  placeholder,
  disabled,
  readOnly,
  toolbar = DEFAULT_EDITOR_TOOLBAR,
  minHeight = 200,
  maxHeight,
  required,
  fullWidth = true,
  renderEditor,
  sx,
  'aria-label': ariaLabel,
}: FieldEditorProps): ReactNode {
  const { control } = useFormContext();
  const errorId = `${name}-error`;
  const helperId = `${name}-helper`;
  const describedBy = [helperText ? helperId : null, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <FormControl fullWidth={fullWidth} error={!!error} disabled={disabled} required={required} sx={sx}>
          {label && (
            <FormLabel htmlFor={name} sx={{ mb: 1, fontWeight: 500 }}>
              {label}
            </FormLabel>
          )}

          {renderEditor ? (
            // Custom editor implementation
            renderEditor({
              value: field.value ?? '',
              onChange: field.onChange,
              onBlur: field.onBlur,
              error: !!error,
              name,
              disabled,
              readOnly,
              placeholder,
              toolbar,
              minHeight,
              maxHeight,
              'aria-label': ariaLabel || label || name,
              'aria-describedby': describedBy,
            })
          ) : (
            // Basic textarea fallback
            <BasicEditor
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={!!error}
              name={name}
              disabled={disabled}
              readOnly={readOnly}
              placeholder={placeholder}
              toolbar={toolbar}
              minHeight={minHeight}
              maxHeight={maxHeight}
              aria-label={ariaLabel || label || name}
              aria-describedby={describedBy}
            />
          )}

          {(error?.message || helperText) && (
            <FormHelperText id={error ? errorId : helperId} error={!!error}>
              {error?.message ?? helperText}
            </FormHelperText>
          )}
        </FormControl>
      )}
    />
  );
}

// =============================================================================
// FIELD.CUSTOM EDITOR (RENDER PROP PATTERN)
// =============================================================================

/**
 * Props for Field.CustomEditor component.
 */
export interface FieldCustomEditorProps {
  /** Field name in the form */
  name: string;
  /** Field label */
  label?: string;
  /** Helper text displayed below the editor */
  helperText?: ReactNode;
  /** Validation rules for react-hook-form */
  rules?: RegisterOptions;
  /** Required field indicator */
  required?: boolean;
  /** Full width */
  fullWidth?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Additional props for the wrapper Box */
  sx?: ComponentProps<typeof Box>['sx'];
  /** Render function for custom editor */
  children: (props: {
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    error: boolean;
    errorMessage?: string;
    name: string;
    disabled?: boolean;
  }) => ReactElement;
}

/**
 * Field.CustomEditor - Headless editor field with render prop pattern.
 *
 * Provides maximum flexibility for integrating any editor library.
 *
 * @example
 * ```tsx
 * import { useEditor, EditorContent } from '@tiptap/react';
 * import StarterKit from '@tiptap/starter-kit';
 *
 * function ArticleForm() {
 *   return (
 *     <FormProvider {...methods}>
 *       <Field.CustomEditor name="content" label="Content" required>
 *         {({ value, onChange, onBlur, error }) => {
 *           const editor = useEditor({
 *             extensions: [StarterKit],
 *             content: value,
 *             onUpdate: ({ editor }) => onChange(editor.getHTML()),
 *             onBlur: () => onBlur(),
 *           });
 *
 *           return (
 *             <Box sx={{ border: error ? '1px solid red' : '1px solid gray' }}>
 *               <EditorContent editor={editor} />
 *             </Box>
 *           );
 *         }}
 *       </Field.CustomEditor>
 *     </FormProvider>
 *   );
 * }
 * ```
 */
export function FieldCustomEditor({
  name,
  label,
  helperText,
  rules,
  required,
  fullWidth = true,
  disabled,
  sx,
  children,
}: FieldCustomEditorProps): ReactNode {
  const { control } = useFormContext();
  const errorId = `${name}-error`;

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <FormControl fullWidth={fullWidth} error={!!error} disabled={disabled} required={required} sx={sx}>
          {label && (
            <FormLabel htmlFor={name} sx={{ mb: 1, fontWeight: 500 }}>
              {label}
            </FormLabel>
          )}

          {children({
            value: field.value ?? '',
            onChange: field.onChange,
            onBlur: field.onBlur,
            error: !!error,
            errorMessage: error?.message,
            name,
            disabled,
          })}

          {(error?.message || helperText) && (
            <FormHelperText id={errorId} error={!!error}>
              {error?.message ?? helperText}
            </FormHelperText>
          )}
        </FormControl>
      )}
    />
  );
}
