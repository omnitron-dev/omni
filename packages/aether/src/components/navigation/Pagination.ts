/**
 * Styled Pagination Component
 *
 * Page navigation for long lists.
 * Built on top of the Pagination primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Pagination as PaginationPrimitive,
  PaginationContent as PaginationContentPrimitive,
  PaginationItem as PaginationItemPrimitive,
  PaginationLink as PaginationLinkPrimitive,
  PaginationPrevious as PaginationPreviousPrimitive,
  PaginationNext as PaginationNextPrimitive,
  PaginationEllipsis as PaginationEllipsisPrimitive,
  type PaginationProps as PaginationPrimitiveProps,
} from '../../primitives/Pagination.js';

/**
 * Pagination - Root component
 */
export const Pagination = PaginationPrimitive;

/**
 * PaginationContent - Container
 */
export const PaginationContent = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(PaginationContentPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    listStyle: 'none',
    margin: '0',
    padding: '0',
  },
  variants: {
    size: {
      sm: {
        gap: '0.125rem',
      },
      md: {
        gap: '0.25rem',
      },
      lg: {
        gap: '0.375rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * PaginationItem - Individual pagination item
 */
export const PaginationItem = styled(PaginationItemPrimitive, {
  base: {
    display: 'inline-flex',
  },
});

/**
 * PaginationLink - Page link
 */
export const PaginationLink = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(PaginationLinkPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '2.5rem',
    height: '2.5rem',
    padding: '0 0.75rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    backgroundColor: '#ffffff',
    color: '#111827',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    '&:hover:not([data-active]):not([data-disabled])': {
      backgroundColor: '#f9fafb',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
    '&[data-active]': {
      backgroundColor: '#3b82f6',
      borderColor: '#3b82f6',
      color: '#ffffff',
      pointerEvents: 'none',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
      cursor: 'not-allowed',
    },
  },
  variants: {
    size: {
      sm: {
        minWidth: '2rem',
        height: '2rem',
        padding: '0 0.5rem',
        fontSize: '0.8125rem',
      },
      md: {
        minWidth: '2.5rem',
        height: '2.5rem',
        padding: '0 0.75rem',
        fontSize: '0.875rem',
      },
      lg: {
        minWidth: '3rem',
        height: '3rem',
        padding: '0 1rem',
        fontSize: '1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * PaginationPrevious - Previous button
 */
export const PaginationPrevious = styled(PaginationPreviousPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    backgroundColor: '#ffffff',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover:not([data-disabled])': {
      backgroundColor: '#f9fafb',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
      cursor: 'not-allowed',
    },
  },
});

/**
 * PaginationNext - Next button
 */
export const PaginationNext = styled(PaginationNextPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    backgroundColor: '#ffffff',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover:not([data-disabled])': {
      backgroundColor: '#f9fafb',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
      cursor: 'not-allowed',
    },
  },
});

/**
 * PaginationEllipsis - Ellipsis indicator
 */
export const PaginationEllipsis = styled(PaginationEllipsisPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2.5rem',
    height: '2.5rem',
    color: '#9ca3af',
    userSelect: 'none',
  },
});

// Attach sub-components
(Pagination as any).Content = PaginationContent;
(Pagination as any).Item = PaginationItem;
(Pagination as any).Link = PaginationLink;
(Pagination as any).Previous = PaginationPrevious;
(Pagination as any).Next = PaginationNext;
(Pagination as any).Ellipsis = PaginationEllipsis;

// Display names
Pagination.displayName = 'Pagination';
PaginationContent.displayName = 'PaginationContent';
PaginationItem.displayName = 'PaginationItem';
PaginationLink.displayName = 'PaginationLink';
PaginationPrevious.displayName = 'PaginationPrevious';
PaginationNext.displayName = 'PaginationNext';
PaginationEllipsis.displayName = 'PaginationEllipsis';

// Type exports
export type { PaginationPrimitiveProps as PaginationProps };
