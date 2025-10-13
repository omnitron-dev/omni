/**
 * Styled RadioGroup Component
 *
 * A styled radio button group with descriptions.
 * Built on top of the RadioGroup primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { RadioGroup as RadioGroupPrimitive, RadioGroupItem, RadioGroupIndicator } from '../../primitives/RadioGroup.js';

/**
 * RadioGroup - Custom styled radio button group
 *
 * @example
 * ```tsx
 * <RadioGroup value={value} onValueChange={setValue} orientation="vertical">
 *   <RadioGroup.Item value="1" size="md">
 *     <RadioGroup.Indicator />
 *   </RadioGroup.Item>
 *   <label>Option 1</label>
 * </RadioGroup>
 * ```
 */
export const RadioGroup = styled(RadioGroupPrimitive, {
  base: {
    display: 'flex',
    gap: '0.75rem',
    '&[data-orientation="vertical"]': {
      flexDirection: 'column',
    },
    '&[data-orientation="horizontal"]': {
      flexDirection: 'row',
    },
  },
  variants: {
    spacing: {
      sm: {
        gap: '0.5rem',
      },
      md: {
        gap: '0.75rem',
      },
      lg: {
        gap: '1rem',
      },
    },
  },
  defaultVariants: {
    spacing: 'md',
  },
});

export const StyledRadioGroupItem = styled(RadioGroupItem, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.25rem',
    height: '1.25rem',
    borderRadius: '50%',
    border: '2px solid #d1d5db',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    transition: 'all 0.2s',
    '&:hover:not([data-disabled])': {
      borderColor: '#9ca3af',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
    },
    '&[data-state="checked"]': {
      borderColor: '#3b82f6',
    },
    '&[data-disabled]': {
      backgroundColor: '#f9fafb',
      borderColor: '#e5e7eb',
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
  variants: {
    size: {
      sm: {
        width: '1rem',
        height: '1rem',
      },
      md: {
        width: '1.25rem',
        height: '1.25rem',
      },
      lg: {
        width: '1.5rem',
        height: '1.5rem',
      },
    },
    colorScheme: {
      blue: {
        '&[data-state="checked"]': {
          borderColor: '#3b82f6',
        },
      },
      green: {
        '&[data-state="checked"]': {
          borderColor: '#10b981',
        },
      },
      red: {
        '&[data-state="checked"]': {
          borderColor: '#ef4444',
        },
      },
      purple: {
        '&[data-state="checked"]': {
          borderColor: '#8b5cf6',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
    colorScheme: 'blue',
  },
});

export const StyledRadioGroupIndicator = styled(RadioGroupIndicator, {
  base: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '50%',
    height: '50%',
    borderRadius: '50%',
    backgroundColor: '#3b82f6',
  },
  variants: {
    colorScheme: {
      blue: {
        backgroundColor: '#3b82f6',
      },
      green: {
        backgroundColor: '#10b981',
      },
      red: {
        backgroundColor: '#ef4444',
      },
      purple: {
        backgroundColor: '#8b5cf6',
      },
    },
  },
  defaultVariants: {
    colorScheme: 'blue',
  },
});

// Attach styled sub-components to RadioGroup
(RadioGroup as any).Item = StyledRadioGroupItem;
(RadioGroup as any).Indicator = StyledRadioGroupIndicator;

// Attach display name
(RadioGroup as any).displayName = 'RadioGroup';
