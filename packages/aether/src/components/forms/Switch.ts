/**
 * Styled Switch Component
 *
 * An iOS-style toggle switch with smooth animations.
 * Built on top of the Switch primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Switch as SwitchPrimitive, SwitchThumb } from '../../primitives/Switch.js';

/**
 * Switch - iOS-style toggle switch
 *
 * @example
 * ```tsx
 * <Switch checked={isEnabled} onCheckedChange={setIsEnabled} size="md">
 *   <Switch.Thumb />
 * </Switch>
 * ```
 */
export const Switch = styled(SwitchPrimitive, {
  base: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    width: '2.75rem',
    height: '1.5rem',
    borderRadius: '9999px',
    backgroundColor: '#d1d5db',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    border: 'none',
    padding: 0,
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
    },
    '&[data-state="checked"]': {
      backgroundColor: '#3b82f6',
    },
    '&[data-disabled]': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  variants: {
    size: {
      sm: {
        width: '2rem',
        height: '1.125rem',
      },
      md: {
        width: '2.75rem',
        height: '1.5rem',
      },
      lg: {
        width: '3.5rem',
        height: '2rem',
      },
    },
    colorScheme: {
      blue: {
        '&[data-state="checked"]': {
          backgroundColor: '#3b82f6',
        },
      },
      green: {
        '&[data-state="checked"]': {
          backgroundColor: '#10b981',
        },
      },
      red: {
        '&[data-state="checked"]': {
          backgroundColor: '#ef4444',
        },
      },
      purple: {
        '&[data-state="checked"]': {
          backgroundColor: '#8b5cf6',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
    colorScheme: 'blue',
  },
});

export const StyledSwitchThumb = styled(SwitchThumb, {
  base: {
    display: 'block',
    width: '1.25rem',
    height: '1.25rem',
    borderRadius: '9999px',
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    transition: 'transform 0.2s',
    transform: 'translateX(0.125rem)',
    '&[data-state="checked"]': {
      transform: 'translateX(1.375rem)',
    },
  },
  variants: {
    size: {
      sm: {
        width: '0.875rem',
        height: '0.875rem',
        transform: 'translateX(0.125rem)',
        '&[data-state="checked"]': {
          transform: 'translateX(0.875rem)',
        },
      },
      md: {
        width: '1.25rem',
        height: '1.25rem',
        transform: 'translateX(0.125rem)',
        '&[data-state="checked"]': {
          transform: 'translateX(1.375rem)',
        },
      },
      lg: {
        width: '1.75rem',
        height: '1.75rem',
        transform: 'translateX(0.125rem)',
        '&[data-state="checked"]': {
          transform: 'translateX(1.625rem)',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Attach styled thumb to Switch
(Switch as any).Thumb = StyledSwitchThumb;

// Attach display name
(Switch as any).displayName = 'Switch';
