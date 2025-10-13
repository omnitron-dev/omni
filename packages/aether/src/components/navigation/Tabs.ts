/**
 * Styled Tabs Component
 *
 * Tab navigation for switching between views.
 * Built on top of the Tabs primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Tabs as TabsPrimitive,
  TabsList as TabsListPrimitive,
  TabsTrigger as TabsTriggerPrimitive,
  TabsContent as TabsContentPrimitive,
  type TabsProps as TabsPrimitiveProps,
} from '../../primitives/Tabs.js';

/**
 * Tabs - Root component
 */
export const Tabs = TabsPrimitive;

/**
 * TabsList - Container for tab triggers
 */
export const TabsList = styled<{
  variant?: 'default' | 'enclosed' | 'pills';
  size?: 'sm' | 'md' | 'lg';
}>(TabsListPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  variants: {
    variant: {
      default: {
        borderBottom: '1px solid #e5e7eb',
      },
      enclosed: {
        backgroundColor: '#f3f4f6',
        padding: '0.25rem',
        borderRadius: '0.5rem',
      },
      pills: {
        gap: '0.5rem',
      },
    },
    size: {
      sm: {},
      md: {},
      lg: {},
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

/**
 * TabsTrigger - Individual tab button
 */
export const TabsTrigger = styled<{
  variant?: 'default' | 'enclosed' | 'pills';
  size?: 'sm' | 'md' | 'lg';
}>(TabsTriggerPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    '&:hover': {
      color: '#111827',
    },
    '&:focus': {
      outline: 'none',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
    },
  },
  variants: {
    variant: {
      default: {
        padding: '0.75rem 1rem',
        borderBottom: '2px solid transparent',
        marginBottom: '-1px',
        '&[data-state="active"]': {
          color: '#3b82f6',
          borderBottomColor: '#3b82f6',
        },
      },
      enclosed: {
        padding: '0.5rem 1rem',
        borderRadius: '0.375rem',
        '&[data-state="active"]': {
          backgroundColor: '#ffffff',
          color: '#111827',
          boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        },
      },
      pills: {
        padding: '0.5rem 1rem',
        borderRadius: '9999px',
        '&[data-state="active"]': {
          backgroundColor: '#eff6ff',
          color: '#1e40af',
        },
      },
    },
    size: {
      sm: {
        fontSize: '0.8125rem',
        padding: '0.5rem 0.75rem',
      },
      md: {
        fontSize: '0.875rem',
        padding: '0.75rem 1rem',
      },
      lg: {
        fontSize: '1rem',
        padding: '1rem 1.25rem',
      },
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

/**
 * TabsContent - Tab panel content
 */
export const TabsContent = styled(TabsContentPrimitive, {
  base: {
    marginTop: '1rem',
    '&:focus': {
      outline: 'none',
    },
    '&[data-state="inactive"]': {
      display: 'none',
    },
  },
});

// Attach sub-components
(Tabs as any).List = TabsList;
(Tabs as any).Trigger = TabsTrigger;
(Tabs as any).Content = TabsContent;

// Display names
Tabs.displayName = 'Tabs';
TabsList.displayName = 'TabsList';
TabsTrigger.displayName = 'TabsTrigger';
TabsContent.displayName = 'TabsContent';

// Type exports
export type { TabsPrimitiveProps as TabsProps };
