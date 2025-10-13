/**
 * Styled Stepper Component
 *
 * Step progress indicator for multi-step workflows.
 * Built on top of the Stepper primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Stepper as StepperPrimitive, type StepperProps as StepperPrimitiveProps } from '../../primitives/Stepper.js';

/**
 * Stepper - Step progress indicator component
 *
 * @example
 * ```tsx
 * <Stepper
 *   steps={[
 *     { label: 'Account', description: 'Create your account' },
 *     { label: 'Profile', description: 'Fill your profile' },
 *     { label: 'Verify', description: 'Verify your email' },
 *   ]}
 *   activeStep={1}
 *   orientation="horizontal"
 * />
 * ```
 */
export const Stepper = styled<
  {
    orientation?: 'horizontal' | 'vertical';
    size?: 'sm' | 'md' | 'lg';
    variant?: 'default' | 'simple' | 'circles';
  },
  StepperPrimitiveProps
>(StepperPrimitive, {
  base: {
    display: 'flex',
    width: '100%',
    '[data-stepper-item]': {
      display: 'flex',
      position: 'relative',
      flex: '1',
    },
    '[data-step-indicator]': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '2rem',
      height: '2rem',
      borderRadius: '50%',
      border: '2px solid #e5e7eb',
      backgroundColor: '#ffffff',
      fontSize: '0.875rem',
      fontWeight: '600',
      color: '#6b7280',
      flexShrink: '0',
      transition: 'all 0.2s ease',
    },
    '[data-step-content]': {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      marginLeft: '0.75rem',
    },
    '[data-step-title]': {
      fontSize: '0.875rem',
      fontWeight: '500',
      color: '#111827',
    },
    '[data-step-description]': {
      fontSize: '0.8125rem',
      color: '#6b7280',
    },
    '[data-step-separator]': {
      backgroundColor: '#e5e7eb',
      transition: 'all 0.2s ease',
    },
    // Active state
    '[data-state="active"]': {
      '[data-step-indicator]': {
        borderColor: '#3b82f6',
        backgroundColor: '#3b82f6',
        color: '#ffffff',
      },
      '[data-step-title]': {
        color: '#3b82f6',
      },
    },
    // Complete state
    '[data-state="complete"]': {
      '[data-step-indicator]': {
        borderColor: '#10b981',
        backgroundColor: '#10b981',
        color: '#ffffff',
      },
      '[data-step-separator]': {
        backgroundColor: '#10b981',
      },
    },
    // Error state
    '[data-state="error"]': {
      '[data-step-indicator]': {
        borderColor: '#ef4444',
        backgroundColor: '#fee2e2',
        color: '#ef4444',
      },
      '[data-step-title]': {
        color: '#ef4444',
      },
    },
  },
  variants: {
    orientation: {
      horizontal: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        '[data-stepper-item]': {
          flexDirection: 'column',
        },
        '[data-step-separator]': {
          position: 'absolute',
          top: '1rem',
          left: 'calc(2rem + 0.75rem)',
          right: 'calc(-100% + 2rem + 0.75rem)',
          height: '2px',
        },
        '[data-stepper-item]:last-child [data-step-separator]': {
          display: 'none',
        },
      },
      vertical: {
        flexDirection: 'column',
        '[data-stepper-item]': {
          flexDirection: 'row',
          paddingBottom: '1.5rem',
        },
        '[data-step-separator]': {
          position: 'absolute',
          left: '1rem',
          top: 'calc(2rem + 0.5rem)',
          bottom: '-0.5rem',
          width: '2px',
        },
        '[data-stepper-item]:last-child': {
          paddingBottom: '0',
        },
        '[data-stepper-item]:last-child [data-step-separator]': {
          display: 'none',
        },
      },
    },
    size: {
      sm: {
        '[data-step-indicator]': {
          width: '1.5rem',
          height: '1.5rem',
          fontSize: '0.75rem',
        },
        '[data-step-title]': {
          fontSize: '0.8125rem',
        },
        '[data-step-description]': {
          fontSize: '0.75rem',
        },
      },
      md: {
        '[data-step-indicator]': {
          width: '2rem',
          height: '2rem',
          fontSize: '0.875rem',
        },
      },
      lg: {
        '[data-step-indicator]': {
          width: '2.5rem',
          height: '2.5rem',
          fontSize: '1rem',
        },
        '[data-step-title]': {
          fontSize: '1rem',
        },
        '[data-step-description]': {
          fontSize: '0.875rem',
        },
      },
    },
    variant: {
      default: {},
      simple: {
        '[data-step-indicator]': {
          border: 'none',
          backgroundColor: '#e5e7eb',
        },
        '[data-state="active"] [data-step-indicator]': {
          backgroundColor: '#3b82f6',
        },
        '[data-state="complete"] [data-step-indicator]': {
          backgroundColor: '#10b981',
        },
      },
      circles: {
        '[data-step-indicator]': {
          width: '0.75rem',
          height: '0.75rem',
          fontSize: '0',
          padding: '0',
        },
      },
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
    size: 'md',
    variant: 'default',
  },
});

// Display name
Stepper.displayName = 'Stepper';

// Type exports
export type { StepperPrimitiveProps as StepperProps };
