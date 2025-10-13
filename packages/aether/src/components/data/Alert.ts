/**
 * Alert Component (Styled)
 *
 * A styled alert component for displaying important messages:
 * - Multiple visual variants (solid, outline, subtle)
 * - Status-based color schemes
 * - Size variants
 * - Icon support
 */

import { styled } from '../../styling/styled.js';
import {
  Alert as AlertPrimitive,
  AlertIcon as AlertIconPrimitive,
  AlertTitle as AlertTitlePrimitive,
  AlertDescription as AlertDescriptionPrimitive,
  type AlertProps as AlertPrimitiveProps,
  type AlertIconProps,
  type AlertTitleProps,
  type AlertDescriptionProps,
} from '../../primitives/Alert.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * Alert Root - Styled alert container
 */
export const Alert = styled<
  {
    variant?: 'solid' | 'outline' | 'subtle' | 'left-accent';
    status?: 'default' | 'info' | 'success' | 'warning' | 'error';
    size?: 'sm' | 'md' | 'lg';
  },
  AlertPrimitiveProps
>(AlertPrimitive, {
  base: {
    display: 'flex',
    gap: '0.75rem',
    padding: '1rem',
    borderRadius: '0.5rem',
    position: 'relative',
  },
  variants: {
    variant: {
      solid: {},
      outline: {
        backgroundColor: 'transparent',
        borderWidth: '1px',
        borderStyle: 'solid',
      },
      subtle: {},
      'left-accent': {
        borderLeftWidth: '4px',
        borderLeftStyle: 'solid',
      },
    },
    status: {
      default: {},
      info: {},
      success: {},
      warning: {},
      error: {},
    },
    size: {
      sm: {
        padding: '0.75rem',
        fontSize: '0.875rem',
        gap: '0.5rem',
      },
      md: {
        padding: '1rem',
        fontSize: '0.875rem',
        gap: '0.75rem',
      },
      lg: {
        padding: '1.25rem',
        fontSize: '1rem',
        gap: '1rem',
      },
    },
  },
  compoundVariants: [
    // Solid variants
    {
      variant: 'solid',
      status: 'default',
      css: {
        backgroundColor: '#f3f4f6',
        color: '#111827',
      },
    },
    {
      variant: 'solid',
      status: 'info',
      css: {
        backgroundColor: '#3b82f6',
        color: '#ffffff',
      },
    },
    {
      variant: 'solid',
      status: 'success',
      css: {
        backgroundColor: '#10b981',
        color: '#ffffff',
      },
    },
    {
      variant: 'solid',
      status: 'warning',
      css: {
        backgroundColor: '#f59e0b',
        color: '#ffffff',
      },
    },
    {
      variant: 'solid',
      status: 'error',
      css: {
        backgroundColor: '#ef4444',
        color: '#ffffff',
      },
    },
    // Outline variants
    {
      variant: 'outline',
      status: 'default',
      css: {
        borderColor: '#d1d5db',
        color: '#111827',
      },
    },
    {
      variant: 'outline',
      status: 'info',
      css: {
        borderColor: '#3b82f6',
        color: '#1e40af',
      },
    },
    {
      variant: 'outline',
      status: 'success',
      css: {
        borderColor: '#10b981',
        color: '#065f46',
      },
    },
    {
      variant: 'outline',
      status: 'warning',
      css: {
        borderColor: '#f59e0b',
        color: '#92400e',
      },
    },
    {
      variant: 'outline',
      status: 'error',
      css: {
        borderColor: '#ef4444',
        color: '#991b1b',
      },
    },
    // Subtle variants
    {
      variant: 'subtle',
      status: 'default',
      css: {
        backgroundColor: '#f3f4f6',
        color: '#111827',
      },
    },
    {
      variant: 'subtle',
      status: 'info',
      css: {
        backgroundColor: '#dbeafe',
        color: '#1e40af',
      },
    },
    {
      variant: 'subtle',
      status: 'success',
      css: {
        backgroundColor: '#d1fae5',
        color: '#065f46',
      },
    },
    {
      variant: 'subtle',
      status: 'warning',
      css: {
        backgroundColor: '#fef3c7',
        color: '#92400e',
      },
    },
    {
      variant: 'subtle',
      status: 'error',
      css: {
        backgroundColor: '#fee2e2',
        color: '#991b1b',
      },
    },
    // Left accent variants
    {
      variant: 'left-accent',
      status: 'default',
      css: {
        backgroundColor: '#f3f4f6',
        borderLeftColor: '#6b7280',
        color: '#111827',
      },
    },
    {
      variant: 'left-accent',
      status: 'info',
      css: {
        backgroundColor: '#dbeafe',
        borderLeftColor: '#3b82f6',
        color: '#1e40af',
      },
    },
    {
      variant: 'left-accent',
      status: 'success',
      css: {
        backgroundColor: '#d1fae5',
        borderLeftColor: '#10b981',
        color: '#065f46',
      },
    },
    {
      variant: 'left-accent',
      status: 'warning',
      css: {
        backgroundColor: '#fef3c7',
        borderLeftColor: '#f59e0b',
        color: '#92400e',
      },
    },
    {
      variant: 'left-accent',
      status: 'error',
      css: {
        backgroundColor: '#fee2e2',
        borderLeftColor: '#ef4444',
        color: '#991b1b',
      },
    },
  ],
  defaultVariants: {
    variant: 'subtle',
    status: 'default',
    size: 'md',
  },
});

/**
 * Alert Icon - Styled alert icon container
 */
export const AlertIcon = styled(AlertIconPrimitive, {
  base: {
    flexShrink: '0',
    width: '1.25rem',
    height: '1.25rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Alert Title - Styled alert title
 */
export const AlertTitle = styled(AlertTitlePrimitive, {
  base: {
    fontWeight: '600',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    marginBottom: '0.25rem',
  },
});

/**
 * Alert Description - Styled alert description
 */
export const AlertDescription = styled(AlertDescriptionPrimitive, {
  base: {
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
    opacity: '0.9',
  },
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Alert as any).Icon = AlertIcon;
(Alert as any).Title = AlertTitle;
(Alert as any).Description = AlertDescription;

// ============================================================================
// Display names
// ============================================================================

Alert.displayName = 'Alert';
AlertIcon.displayName = 'Alert.Icon';
AlertTitle.displayName = 'Alert.Title';
AlertDescription.displayName = 'Alert.Description';

// ============================================================================
// Type exports
// ============================================================================

export type { AlertPrimitiveProps as AlertProps, AlertIconProps, AlertTitleProps, AlertDescriptionProps };
