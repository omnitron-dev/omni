/**
 * Styled Button Component
 *
 * A beautiful, production-ready button component with comprehensive styling.
 * Built on top of the Button primitive with variants for appearance, size, and states.
 *
 * Features:
 * - Multiple visual variants (default, primary, secondary, danger, ghost, link)
 * - Five size options (xs, sm, md, lg, xl)
 * - Icon support with automatic sizing
 * - Loading states with spinner
 * - Disabled states
 * - Full width option
 * - Icon-only buttons
 * - Professional hover and focus states
 * - Smooth transitions
 * - Accessibility-friendly focus rings
 *
 * @example Basic button
 * ```tsx
 * <Button onClick={handleClick}>Click me</Button>
 * ```
 *
 * @example Primary button with icon
 * ```tsx
 * <Button variant="primary" leftIcon="check" onClick={save}>
 *   Save Changes
 * </Button>
 * ```
 *
 * @example Loading state
 * ```tsx
 * <Button loading={isLoading} onClick={handleSubmit}>
 *   Submit
 * </Button>
 * ```
 *
 * @example Icon-only button
 * ```tsx
 * <Button icon="trash" aria-label="Delete" size="sm" />
 * ```
 *
 * @example Danger button
 * ```tsx
 * <Button variant="danger" onClick={handleDelete}>
 *   Delete Account
 * </Button>
 * ```
 *
 * @example Full width button
 * ```tsx
 * <Button variant="primary" fullWidth>
 *   Sign In
 * </Button>
 * ```
 *
 * @example Ghost button
 * ```tsx
 * <Button variant="ghost" leftIcon="settings">
 *   Settings
 * </Button>
 * ```
 *
 * @example Link button
 * ```tsx
 * <Button variant="link" rightIcon="arrow-right">
 *   Learn more
 * </Button>
 * ```
 */

import { styled } from '../../styling/styled.js';
import { Button as ButtonPrimitive } from '../../primitives/Button.js';
import type { ButtonProps as ButtonPrimitiveProps } from '../../primitives/Button.js';

/**
 * Styled Button with comprehensive design system
 */
export const Button = styled(ButtonPrimitive, {
  base: {
    // Layout
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    verticalAlign: 'middle',
    userSelect: 'none',
    outline: 'none',
    border: 'none',
    cursor: 'pointer',

    // Typography
    fontFamily: 'inherit',
    fontWeight: '500',
    lineHeight: '1',
    textDecoration: 'none',
    whiteSpace: 'nowrap',

    // Transitions
    transition: 'all 0.15s ease',

    // Focus ring (base)
    '&:focus-visible': {
      outline: 'none',
      boxShadow: '0 0 0 3px rgba(107, 114, 128, 0.4)',
    },

    // Disabled state
    '&[data-disabled]': {
      opacity: '0.6',
      cursor: 'not-allowed',
      pointerEvents: 'none',
    },

    // Loading state
    '&[data-loading]': {
      cursor: 'wait',
      pointerEvents: 'none',
    },

    // Full width
    '&[data-full-width]': {
      width: '100%',
      justifyContent: 'center',
    },

    // Icon spacing - left icon
    '& .button-icon-left': {
      marginRight: '0.5rem',
      display: 'inline-flex',
      alignItems: 'center',
      flexShrink: '0',
    },

    // Icon spacing - right icon
    '& .button-icon-right': {
      marginLeft: '0.5rem',
      display: 'inline-flex',
      alignItems: 'center',
      flexShrink: '0',
    },

    // Icon spacing - loading icon
    '& .button-icon-loading': {
      marginRight: '0.5rem',
      display: 'inline-flex',
      alignItems: 'center',
      flexShrink: '0',
    },

    // Icon-only buttons (no margins)
    '&[data-icon-only]': {
      '& .button-icon': {
        margin: '0',
      },
      '& .button-icon-left': {
        margin: '0',
      },
      '& .button-icon-right': {
        margin: '0',
      },
    },

    // Button content
    '& .button-content': {
      display: 'inline-flex',
      alignItems: 'center',
    },

    // Loading state - hide content but keep width
    '&[data-loading] .button-content': {
      opacity: '0',
      pointerEvents: 'none',
    },
  },

  variants: {
    // ========================================================================
    // Visual Variants
    // ========================================================================
    variant: {
      /**
       * Default variant - Neutral gray button
       */
      default: {
        backgroundColor: '#f3f4f6',
        color: '#111827',
        border: '1px solid #d1d5db',

        '&:hover:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#e5e7eb',
          borderColor: '#9ca3af',
        },

        '&:active:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#d1d5db',
        },

        '&:focus-visible': {
          boxShadow: '0 0 0 3px rgba(107, 114, 128, 0.4)',
        },
      },

      /**
       * Primary variant - Brand blue button
       */
      primary: {
        backgroundColor: '#3b82f6',
        color: '#ffffff',
        border: 'none',

        '&:hover:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#2563eb',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
        },

        '&:active:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#1d4ed8',
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.1)',
        },

        '&:focus-visible': {
          boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.4)',
        },
      },

      /**
       * Secondary variant - Purple button
       */
      secondary: {
        backgroundColor: '#8b5cf6',
        color: '#ffffff',
        border: 'none',

        '&:hover:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#7c3aed',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
        },

        '&:active:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#6d28d9',
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.1)',
        },

        '&:focus-visible': {
          boxShadow: '0 0 0 3px rgba(139, 92, 246, 0.4)',
        },
      },

      /**
       * Danger variant - Red button for destructive actions
       */
      danger: {
        backgroundColor: '#ef4444',
        color: '#ffffff',
        border: 'none',

        '&:hover:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#dc2626',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
        },

        '&:active:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#b91c1c',
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.1)',
        },

        '&:focus-visible': {
          boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.4)',
        },
      },

      /**
       * Ghost variant - Transparent background with subtle hover
       */
      ghost: {
        backgroundColor: 'transparent',
        color: '#374151',
        border: 'none',

        '&:hover:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#f3f4f6',
        },

        '&:active:not([data-disabled]):not([data-loading])': {
          backgroundColor: '#e5e7eb',
        },

        '&:focus-visible': {
          boxShadow: '0 0 0 3px rgba(107, 114, 128, 0.4)',
        },
      },

      /**
       * Link variant - Styled as hyperlink
       */
      link: {
        backgroundColor: 'transparent',
        color: '#3b82f6',
        border: 'none',
        padding: '0',
        height: 'auto',

        '&:hover:not([data-disabled]):not([data-loading])': {
          color: '#2563eb',
          textDecoration: 'underline',
        },

        '&:active:not([data-disabled]):not([data-loading])': {
          color: '#1d4ed8',
        },

        '&:focus-visible': {
          boxShadow: 'none',
          textDecoration: 'underline',
          outline: '2px solid rgba(59, 130, 246, 0.5)',
          outlineOffset: '2px',
        },
      },
    },

    // ========================================================================
    // Size Variants
    // ========================================================================
    size: {
      /**
       * Extra small - Compact button for tight spaces
       */
      xs: {
        height: '1.75rem',
        padding: '0 0.625rem',
        fontSize: '0.75rem',
        borderRadius: '0.25rem',

        // Icon sizing for xs
        '& .button-icon': {
          width: '0.875rem',
          height: '0.875rem',
        },

        '& .button-icon-left': {
          marginRight: '0.25rem',
        },

        '& .button-icon-right': {
          marginLeft: '0.25rem',
        },

        '& .button-icon-loading': {
          marginRight: '0.25rem',
        },

        // Icon-only: square button
        '&[data-icon-only]': {
          width: '1.75rem',
          padding: '0',
        },
      },

      /**
       * Small - Slightly smaller than default
       */
      sm: {
        height: '2rem',
        padding: '0 0.75rem',
        fontSize: '0.8125rem',
        borderRadius: '0.3125rem',

        // Icon sizing for sm
        '& .button-icon': {
          width: '1rem',
          height: '1rem',
        },

        '& .button-icon-left': {
          marginRight: '0.375rem',
        },

        '& .button-icon-right': {
          marginLeft: '0.375rem',
        },

        '& .button-icon-loading': {
          marginRight: '0.375rem',
        },

        // Icon-only: square button
        '&[data-icon-only]': {
          width: '2rem',
          padding: '0',
        },
      },

      /**
       * Medium - Default size (balanced for most use cases)
       */
      md: {
        height: '2.5rem',
        padding: '0 1rem',
        fontSize: '0.875rem',
        borderRadius: '0.375rem',

        // Icon sizing for md
        '& .button-icon': {
          width: '1.25rem',
          height: '1.25rem',
        },

        '& .button-icon-left': {
          marginRight: '0.5rem',
        },

        '& .button-icon-right': {
          marginLeft: '0.5rem',
        },

        '& .button-icon-loading': {
          marginRight: '0.5rem',
        },

        // Icon-only: square button
        '&[data-icon-only]': {
          width: '2.5rem',
          padding: '0',
        },
      },

      /**
       * Large - Prominent button for primary actions
       */
      lg: {
        height: '3rem',
        padding: '0 1.25rem',
        fontSize: '1rem',
        borderRadius: '0.5rem',

        // Icon sizing for lg
        '& .button-icon': {
          width: '1.5rem',
          height: '1.5rem',
        },

        '& .button-icon-left': {
          marginRight: '0.625rem',
        },

        '& .button-icon-right': {
          marginLeft: '0.625rem',
        },

        '& .button-icon-loading': {
          marginRight: '0.625rem',
        },

        // Icon-only: square button
        '&[data-icon-only]': {
          width: '3rem',
          padding: '0',
        },
      },

      /**
       * Extra large - Hero buttons for landing pages
       */
      xl: {
        height: '3.5rem',
        padding: '0 1.5rem',
        fontSize: '1.125rem',
        borderRadius: '0.625rem',

        // Icon sizing for xl
        '& .button-icon': {
          width: '1.75rem',
          height: '1.75rem',
        },

        '& .button-icon-left': {
          marginRight: '0.75rem',
        },

        '& .button-icon-right': {
          marginLeft: '0.75rem',
        },

        '& .button-icon-loading': {
          marginRight: '0.75rem',
        },

        // Icon-only: square button
        '&[data-icon-only]': {
          width: '3.5rem',
          padding: '0',
        },
      },
    },
  },

  // ========================================================================
  // Default Variants
  // ========================================================================
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

// Attach display name for debugging
(Button as any).displayName = 'Button';

// Export types
export type { ButtonPrimitiveProps as ButtonProps };
