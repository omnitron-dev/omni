/**
 * Styled Collapsible Component
 *
 * Single collapsible section.
 * Built on top of the Collapsible primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Collapsible as CollapsiblePrimitive,
  CollapsibleTrigger as CollapsibleTriggerPrimitive,
  CollapsibleContent as CollapsibleContentPrimitive,
  type CollapsibleProps as CollapsiblePrimitiveProps,
} from '../../primitives/Collapsible.js';

/**
 * Collapsible - Root component
 */
export const Collapsible = CollapsiblePrimitive;

/**
 * CollapsibleTrigger - Trigger button
 */
export const CollapsibleTrigger = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(CollapsibleTriggerPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    backgroundColor: '#ffffff',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      backgroundColor: '#f9fafb',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
    '&[data-state="open"]': {
      backgroundColor: '#eff6ff',
      borderColor: '#3b82f6',
      color: '#1e40af',
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.375rem 0.75rem',
        fontSize: '0.8125rem',
      },
      md: {
        padding: '0.5rem 1rem',
        fontSize: '0.875rem',
      },
      lg: {
        padding: '0.625rem 1.25rem',
        fontSize: '1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * CollapsibleContent - Content panel
 */
export const CollapsibleContent = styled(CollapsibleContentPrimitive, {
  base: {
    overflow: 'hidden',
    marginTop: '0.75rem',
    '&[data-state="closed"]': {
      animation: 'collapsible-close 0.2s ease-out',
    },
    '&[data-state="open"]': {
      animation: 'collapsible-open 0.2s ease-out',
    },
  },
});

// Attach sub-components
(Collapsible as any).Trigger = CollapsibleTrigger;
(Collapsible as any).Content = CollapsibleContent;

// Display names
Collapsible.displayName = 'Collapsible';
CollapsibleTrigger.displayName = 'CollapsibleTrigger';
CollapsibleContent.displayName = 'CollapsibleContent';

// Type exports
export type { CollapsiblePrimitiveProps as CollapsibleProps };
