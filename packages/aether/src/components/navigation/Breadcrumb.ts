/**
 * Styled Breadcrumb Component
 *
 * Breadcrumb navigation trail.
 * Built on top of the Breadcrumb primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Breadcrumb as BreadcrumbPrimitive,
  BreadcrumbList as BreadcrumbListPrimitive,
  BreadcrumbItem as BreadcrumbItemPrimitive,
  BreadcrumbLink as BreadcrumbLinkPrimitive,
  BreadcrumbSeparator as BreadcrumbSeparatorPrimitive,
  BreadcrumbPage as BreadcrumbPagePrimitive,
  type BreadcrumbProps as BreadcrumbPrimitiveProps,
} from '../../primitives/Breadcrumb.js';

/**
 * Breadcrumb - Root component
 */
export const Breadcrumb = BreadcrumbPrimitive;

/**
 * BreadcrumbList - List container
 */
export const BreadcrumbList = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(BreadcrumbListPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
    listStyle: 'none',
    margin: '0',
    padding: '0',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.8125rem',
        gap: '0.375rem',
      },
      md: {
        fontSize: '0.875rem',
        gap: '0.5rem',
      },
      lg: {
        fontSize: '1rem',
        gap: '0.625rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * BreadcrumbItem - Individual breadcrumb item
 */
export const BreadcrumbItem = styled(BreadcrumbItemPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
});

/**
 * BreadcrumbLink - Clickable link
 */
export const BreadcrumbLink = styled(BreadcrumbLinkPrimitive, {
  base: {
    color: '#6b7280',
    textDecoration: 'none',
    transition: 'color 0.15s ease',
    '&:hover': {
      color: '#111827',
      textDecoration: 'underline',
    },
    '&:focus': {
      outline: 'none',
      color: '#3b82f6',
    },
  },
});

/**
 * BreadcrumbSeparator - Visual separator
 */
export const BreadcrumbSeparator = styled(BreadcrumbSeparatorPrimitive, {
  base: {
    color: '#9ca3af',
    userSelect: 'none',
  },
});

/**
 * BreadcrumbPage - Current page (non-clickable)
 */
export const BreadcrumbPage = styled(BreadcrumbPagePrimitive, {
  base: {
    color: '#111827',
    fontWeight: '500',
  },
});

// Attach sub-components
(Breadcrumb as any).List = BreadcrumbList;
(Breadcrumb as any).Item = BreadcrumbItem;
(Breadcrumb as any).Link = BreadcrumbLink;
(Breadcrumb as any).Separator = BreadcrumbSeparator;
(Breadcrumb as any).Page = BreadcrumbPage;

// Display names
Breadcrumb.displayName = 'Breadcrumb';
BreadcrumbList.displayName = 'BreadcrumbList';
BreadcrumbItem.displayName = 'BreadcrumbItem';
BreadcrumbLink.displayName = 'BreadcrumbLink';
BreadcrumbSeparator.displayName = 'BreadcrumbSeparator';
BreadcrumbPage.displayName = 'BreadcrumbPage';

// Type exports
export type { BreadcrumbPrimitiveProps as BreadcrumbProps };
