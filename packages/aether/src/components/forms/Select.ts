/**
 * Styled Select Component
 *
 * A custom styled select with search support.
 * Built on top of the Select primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Select as SelectPrimitive,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from '../../primitives/Select.js';

/**
 * Select - Custom styled select dropdown
 *
 * @example
 * ```tsx
 * <Select value={value} onValueChange={setValue}>
 *   <Select.Trigger size="md">
 *     <Select.Value placeholder="Select an option" />
 *     <Select.Icon>▼</Select.Icon>
 *   </Select.Trigger>
 *   <Select.Content>
 *     <Select.Viewport>
 *       <Select.Item value="1">Option 1</Select.Item>
 *       <Select.Item value="2">Option 2</Select.Item>
 *     </Select.Viewport>
 *   </Select.Content>
 * </Select>
 * ```
 */
export const Select = SelectPrimitive;

export const StyledSelectTrigger = styled(SelectTrigger, {
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
    '&:hover:not([data-disabled])': {
      borderColor: '#d1d5db',
    },
    '&[data-disabled]': {
      backgroundColor: '#f9fafb',
      color: '#9ca3af',
      cursor: 'not-allowed',
    },
    '&[data-placeholder]': {
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
        '&:hover:not([data-disabled])': {
          backgroundColor: '#e5e7eb',
        },
        '&:focus': {
          backgroundColor: '#ffffff',
          borderColor: '#3b82f6',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'outline',
  },
});

export const StyledSelectContent = styled(SelectContent, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    maxHeight: '300px',
    overflow: 'hidden',
    zIndex: 50,
  },
});

export const StyledSelectViewport = styled(SelectViewport, {
  base: {
    padding: '0.25rem',
    maxHeight: '300px',
    overflowY: 'auto',
  },
});

export const StyledSelectItem = styled(SelectItem, {
  base: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    padding: '0.5rem 2rem 0.5rem 0.75rem',
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
    },
    '&[data-disabled]': {
      color: '#9ca3af',
      cursor: 'not-allowed',
      pointerEvents: 'none',
    },
  },
});

export const StyledSelectItemIndicator = styled(SelectItemIndicator, {
  base: {
    position: 'absolute',
    right: '0.5rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1rem',
    height: '1rem',
    color: '#3b82f6',
  },
});

export const StyledSelectLabel = styled(SelectLabel, {
  base: {
    padding: '0.375rem 0.75rem',
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
});

export const StyledSelectSeparator = styled(SelectSeparator, {
  base: {
    height: '1px',
    backgroundColor: '#e5e7eb',
    margin: '0.25rem 0',
  },
});

// Attach styled sub-components to Select
(Select as any).Trigger = StyledSelectTrigger;
(Select as any).Value = SelectValue;
(Select as any).Icon = SelectIcon;
(Select as any).Content = StyledSelectContent;
(Select as any).Viewport = StyledSelectViewport;
(Select as any).Item = StyledSelectItem;
(Select as any).ItemText = SelectItemText;
(Select as any).ItemIndicator = StyledSelectItemIndicator;
(Select as any).Group = SelectGroup;
(Select as any).Label = StyledSelectLabel;
(Select as any).Separator = StyledSelectSeparator;

// Attach display name
(Select as any).displayName = 'Select';
