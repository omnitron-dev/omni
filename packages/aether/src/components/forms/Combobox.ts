/**
 * Styled Combobox Component
 *
 * An autocomplete input with dropdown suggestions.
 * Built on top of the Combobox primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Combobox as ComboboxPrimitive,
  ComboboxTrigger,
  ComboboxInput,
  ComboboxIcon,
  ComboboxContent,
  ComboboxViewport,
  ComboboxItem,
  ComboboxEmpty,
} from '../../primitives/Combobox.js';

/**
 * Combobox - Autocomplete input with dropdown
 *
 * @example
 * ```tsx
 * <Combobox value={value} onValueChange={setValue}>
 *   <Combobox.Trigger>
 *     <Combobox.Input placeholder="Search..." />
 *     <Combobox.Icon>▼</Combobox.Icon>
 *   </Combobox.Trigger>
 *   <Combobox.Content>
 *     <Combobox.Viewport>
 *       <Combobox.Item value="1">Option 1</Combobox.Item>
 *       <Combobox.Empty>No results found</Combobox.Empty>
 *     </Combobox.Viewport>
 *   </Combobox.Content>
 * </Combobox>
 * ```
 */
export const Combobox = ComboboxPrimitive;

export const StyledComboboxTrigger = styled(ComboboxTrigger, {
  base: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    width: '100%',
    gap: '0.5rem',
  },
});

export const StyledComboboxInput = styled(ComboboxInput, {
  base: {
    flex: '1',
    width: '100%',
    padding: '0.5rem 1rem',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    fontSize: '1rem',
    lineHeight: '1.5',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    backgroundColor: '#ffffff',
    color: '#111827',
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
  },
  defaultVariants: {
    size: 'md',
  },
});

export const StyledComboboxIcon = styled(ComboboxIcon, {
  base: {
    position: 'absolute',
    right: '1rem',
    display: 'flex',
    alignItems: 'center',
    color: '#6b7280',
    pointerEvents: 'none',
  },
});

export const StyledComboboxContent = styled(ComboboxContent, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    marginTop: '0.25rem',
    overflow: 'hidden',
    zIndex: 50,
  },
});

export const StyledComboboxViewport = styled(ComboboxViewport, {
  base: {
    maxHeight: '300px',
    overflowY: 'auto',
    padding: '0.25rem',
  },
});

export const StyledComboboxItem = styled(ComboboxItem, {
  base: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.25rem',
    fontSize: '0.875rem',
    cursor: 'pointer',
    outline: 'none',
    userSelect: 'none',
    transition: 'background-color 0.15s',
    '&[data-highlighted]': {
      backgroundColor: '#f3f4f6',
    },
    '&[data-state="checked"]': {
      backgroundColor: '#eff6ff',
      color: '#3b82f6',
      fontWeight: '500',
    },
    '&[data-disabled]': {
      color: '#9ca3af',
      cursor: 'not-allowed',
      pointerEvents: 'none',
    },
  },
});

export const StyledComboboxEmpty = styled(ComboboxEmpty, {
  base: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    fontSize: '0.875rem',
    color: '#6b7280',
    fontStyle: 'italic',
  },
});

// Attach styled sub-components to Combobox
(Combobox as any).Trigger = StyledComboboxTrigger;
(Combobox as any).Input = StyledComboboxInput;
(Combobox as any).Icon = StyledComboboxIcon;
(Combobox as any).Content = StyledComboboxContent;
(Combobox as any).Viewport = StyledComboboxViewport;
(Combobox as any).Item = StyledComboboxItem;
(Combobox as any).Empty = StyledComboboxEmpty;

// Attach display name
(Combobox as any).displayName = 'Combobox';
