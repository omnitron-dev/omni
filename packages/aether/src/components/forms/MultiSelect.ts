/**
 * Styled MultiSelect Component
 *
 * A multi-selection dropdown with search, select all, and clear functionality.
 * Built on top of the MultiSelect primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  MultiSelect as MultiSelectPrimitive,
  MultiSelectTrigger,
  MultiSelectValue,
  MultiSelectContent,
  MultiSelectSearch,
  MultiSelectItem,
  MultiSelectItemIndicator,
  MultiSelectActions,
} from '../../primitives/MultiSelect.js';

/**
 * MultiSelect - Custom styled multi-selection dropdown
 *
 * @example
 * ```tsx
 * <MultiSelect value={selected} onValueChange={setSelected} searchable>
 *   <MultiSelect.Trigger size="md">
 *     <MultiSelect.Value placeholder="Select items..." />
 *   </MultiSelect.Trigger>
 *   <MultiSelect.Content>
 *     <MultiSelect.Search placeholder="Search..." />
 *     <MultiSelect.Actions />
 *     <MultiSelect.Item value="1">
 *       <MultiSelect.ItemIndicator />
 *       Option 1
 *     </MultiSelect.Item>
 *   </MultiSelect.Content>
 * </MultiSelect>
 * ```
 */
export const MultiSelect = MultiSelectPrimitive;

export const StyledMultiSelectTrigger = styled(MultiSelectTrigger, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '0.5rem 1rem',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    fontSize: '1rem',
    lineHeight: '1.5',
    backgroundColor: '#ffffff',
    color: '#111827',
    cursor: 'pointer',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:focus': {
      outline: 'none',
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
    },
    '&:hover:not([disabled])': {
      borderColor: '#d1d5db',
    },
    '&[disabled]': {
      backgroundColor: '#f9fafb',
      color: '#9ca3af',
      cursor: 'not-allowed',
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

export const StyledMultiSelectValue = styled(MultiSelectValue, {
  base: {
    flex: '1',
    textAlign: 'left',
    '& [data-multi-select-placeholder]': {
      color: '#9ca3af',
    },
    '& [data-multi-select-value]': {
      color: '#111827',
      fontWeight: '500',
    },
  },
});

export const StyledMultiSelectContent = styled(MultiSelectContent, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    maxHeight: '300px',
    overflow: 'hidden',
    marginTop: '0.25rem',
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
  },
});

export const StyledMultiSelectSearch = styled(MultiSelectSearch, {
  base: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: 'none',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '0.875rem',
    outline: 'none',
    '&:focus': {
      borderBottomColor: '#3b82f6',
    },
    '&::placeholder': {
      color: '#9ca3af',
    },
  },
});

export const StyledMultiSelectItem = styled(MultiSelectItem, {
  base: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    cursor: 'pointer',
    outline: 'none',
    userSelect: 'none',
    transition: 'background-color 0.15s',
    '&:hover:not([data-disabled])': {
      backgroundColor: '#f3f4f6',
    },
    '&[data-selected]': {
      backgroundColor: '#eff6ff',
      color: '#3b82f6',
    },
    '&[data-disabled]': {
      color: '#9ca3af',
      cursor: 'not-allowed',
      pointerEvents: 'none',
    },
  },
});

export const StyledMultiSelectItemIndicator = styled(MultiSelectItemIndicator, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1rem',
    height: '1rem',
    color: '#3b82f6',
    fontSize: '0.75rem',
  },
});

export const StyledMultiSelectActions = styled(MultiSelectActions, {
  base: {
    display: 'flex',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    borderBottom: '1px solid #e5e7eb',
    '& button': {
      padding: '0.25rem 0.5rem',
      fontSize: '0.75rem',
      borderRadius: '0.25rem',
      border: '1px solid #e5e7eb',
      backgroundColor: '#ffffff',
      color: '#374151',
      cursor: 'pointer',
      transition: 'background-color 0.15s',
      '&:hover:not(:disabled)': {
        backgroundColor: '#f3f4f6',
      },
      '&:disabled': {
        color: '#9ca3af',
        cursor: 'not-allowed',
        opacity: 0.5,
      },
    },
  },
});

// Attach styled sub-components to MultiSelect
(MultiSelect as any).Trigger = StyledMultiSelectTrigger;
(MultiSelect as any).Value = StyledMultiSelectValue;
(MultiSelect as any).Content = StyledMultiSelectContent;
(MultiSelect as any).Search = StyledMultiSelectSearch;
(MultiSelect as any).Item = StyledMultiSelectItem;
(MultiSelect as any).ItemIndicator = StyledMultiSelectItemIndicator;
(MultiSelect as any).Actions = StyledMultiSelectActions;

// Attach display name
(MultiSelect as any).displayName = 'MultiSelect';
