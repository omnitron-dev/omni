/**
 * Styled Accordion Component
 *
 * Collapsible panels for organizing content.
 * Built on top of the Accordion primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Accordion as AccordionPrimitive,
  AccordionItem as AccordionItemPrimitive,
  AccordionTrigger as AccordionTriggerPrimitive,
  AccordionContent as AccordionContentPrimitive,
  type AccordionProps as AccordionPrimitiveProps,
} from '../../primitives/Accordion.js';

/**
 * Accordion - Root component
 */
export const Accordion = AccordionPrimitive;

/**
 * AccordionItem - Individual accordion item
 */
export const AccordionItem = styled(AccordionItemPrimitive, {
  base: {
    borderBottom: '1px solid #e5e7eb',
    '&:last-child': {
      borderBottom: 'none',
    },
  },
});

/**
 * AccordionTrigger - Trigger button
 */
export const AccordionTrigger = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(AccordionTriggerPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '1rem',
    fontSize: '1rem',
    fontWeight: '500',
    textAlign: 'left',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      backgroundColor: '#f9fafb',
    },
    '&:focus': {
      outline: 'none',
      backgroundColor: '#f9fafb',
    },
    '&[data-state="open"]': {
      color: '#3b82f6',
    },
    '&::after': {
      content: '"▼"',
      fontSize: '0.75rem',
      transition: 'transform 0.2s ease',
    },
    '&[data-state="open"]::after': {
      transform: 'rotate(180deg)',
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.75rem',
        fontSize: '0.875rem',
      },
      md: {
        padding: '1rem',
        fontSize: '1rem',
      },
      lg: {
        padding: '1.25rem',
        fontSize: '1.125rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * AccordionContent - Content panel
 */
export const AccordionContent = styled(AccordionContentPrimitive, {
  base: {
    overflow: 'hidden',
    padding: '0 1rem 1rem',
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: '#6b7280',
    '&[data-state="closed"]': {
      animation: 'accordion-close 0.2s ease-out',
    },
    '&[data-state="open"]': {
      animation: 'accordion-open 0.2s ease-out',
    },
  },
});

// Attach sub-components
(Accordion as any).Item = AccordionItem;
(Accordion as any).Trigger = AccordionTrigger;
(Accordion as any).Content = AccordionContent;

// Display names
Accordion.displayName = 'Accordion';
AccordionItem.displayName = 'AccordionItem';
AccordionTrigger.displayName = 'AccordionTrigger';
AccordionContent.displayName = 'AccordionContent';

// Type exports
export type { AccordionPrimitiveProps as AccordionProps };
