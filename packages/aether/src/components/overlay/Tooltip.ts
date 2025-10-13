/**
 * Styled Tooltip Component
 *
 * Contextual tooltip for elements.
 * Built on top of the Tooltip primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Tooltip as TooltipPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
  TooltipContent as TooltipContentPrimitive,
  TooltipArrow as TooltipArrowPrimitive,
  // TooltipProvider as TooltipProviderPrimitive, // TODO: Not exported from primitive
  type TooltipProps as TooltipPrimitiveProps,
} from '../../primitives/Tooltip.js';
import { defineComponent } from '../../core/component/index.js';

// Temporary placeholder until primitive component is implemented
const TooltipProviderPrimitive = defineComponent<{children?: any}>((props) => () => props.children);

/**
 * TooltipProvider - Context provider
 */
export const TooltipProvider = TooltipProviderPrimitive;

/**
 * Tooltip - Root component
 */
export const Tooltip = TooltipPrimitive;

/**
 * TooltipTrigger - Trigger element
 */
export const TooltipTrigger = TooltipTriggerPrimitive;

/**
 * TooltipContent - Content container
 */
export const TooltipContent = styled<{
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'dark';
}>(TooltipContentPrimitive, {
  base: {
    borderRadius: '0.375rem',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    lineHeight: '1.25',
    zIndex: '50',
    maxWidth: '300px',
    animation: 'tooltip-show 0.15s ease-out',
    '&[data-state="closed"]': {
      animation: 'tooltip-hide 0.1s ease-in',
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.375rem 0.5rem',
        fontSize: '0.75rem',
      },
      md: {
        padding: '0.5rem 0.75rem',
        fontSize: '0.875rem',
      },
      lg: {
        padding: '0.625rem 1rem',
        fontSize: '1rem',
      },
    },
    variant: {
      default: {
        backgroundColor: '#ffffff',
        color: '#111827',
        border: '1px solid #e5e7eb',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      },
      dark: {
        backgroundColor: '#111827',
        color: '#ffffff',
        border: '1px solid #374151',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.3)',
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'dark',
  },
});

/**
 * TooltipArrow - Arrow indicator
 */
export const TooltipArrow = styled<{
  variant?: 'default' | 'dark';
}>(TooltipArrowPrimitive, {
  base: {},
  variants: {
    variant: {
      default: {
        fill: '#ffffff',
        stroke: '#e5e7eb',
        strokeWidth: '1px',
      },
      dark: {
        fill: '#111827',
        stroke: '#374151',
        strokeWidth: '1px',
      },
    },
  },
  defaultVariants: {
    variant: 'dark',
  },
});

// Attach sub-components
(Tooltip as any).Trigger = TooltipTrigger;
(Tooltip as any).Content = TooltipContent;
(Tooltip as any).Arrow = TooltipArrow;
(Tooltip as any).Provider = TooltipProvider;

// Display names
Tooltip.displayName = 'Tooltip';
TooltipTrigger.displayName = 'TooltipTrigger';
TooltipContent.displayName = 'TooltipContent';
TooltipArrow.displayName = 'TooltipArrow';

// Type exports
export type { TooltipPrimitiveProps as TooltipProps };
